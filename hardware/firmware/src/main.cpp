/* 墨水屏课表牌 · 主流程
 *
 * 一次"醒来"干这几件事（干完就睡，不在电网里泡着）：
 *
 *   1. 打开供电（屏幕那一路挂在 I/O 扩展芯片上）
 *   2. 连 WiFi → 向课表代理 POST 学号密码 → 拿到一小包「今天/接下来」
 *   3. 顺手用服务器的时间校准板载时钟（自己不用去连 NTP）
 *   4. 画一屏
 *   5. 算下一次该什么时候醒（上课前 OP_LEAD_MINUTES 分钟、下课时、每天 07:00）
 *   6. 屏幕断电、进深度睡眠
 *
 * 深度睡眠时这块内存是不掉电的（RTC 慢速内存），所以上一包数据、上次刷新时间
 * 都留在里面：睡一觉醒来接着用，不用写 Flash，也不怕醒来时断网。
 */

#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp_sleep.h>
#include <stdio.h>
#include <string.h>

#include "board.h"
#include "board_config.h"
#include "net.h"
#include "ui.h"

#if !__has_include("config.h")
#error "缺少 src/config.h：把 src/config.example.h 复制一份改名成 config.h，填上 WiFi 和账号。"
#endif
#include "config.h"

namespace {

/* 服务端保证这一包不超过 4096 字节（见 worker/device-payload.js），留点余量 */
const size_t kCacheBytes = 4200;

RTC_DATA_ATTR char gCache[kCacheBytes];
RTC_DATA_ATTR uint32_t gCacheLen;
RTC_DATA_ATTR bool gCacheValid;
RTC_DATA_ATTR char gCachedAt[8];   /* "07:10" */
RTC_DATA_ATTR uint32_t gWakeCount;

int minutesOf(const char *hhmm) {
  if (!hhmm || strlen(hhmm) < 4) return -1;
  const int hour = (hhmm[0] - '0') * 10 + (hhmm[1] - '0');
  const int minute = (hhmm[2] - '0') * 10 + (hhmm[3] - '0');
  if (hour > 23 || minute > 59) return -1;
  return hour * 60 + minute;
}

/* 1 = 周一 … 7 = 周日 */
int isoWeekday(int year, int month, int day) {
  static const int offset[12] = { 0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4 };
  int y = year;
  if (month < 3) y -= 1;
  const int weekday = (y + y / 4 - y / 100 + y / 400 + offset[month - 1] + day) % 7;
  return weekday == 0 ? 7 : weekday;
}

/* 解析服务端给的 "2026-10-12T09:00+08:00"（已经是香港时间，不用再换算） */
bool parseIsoTime(const char *iso, RtcTime &out) {
  if (!iso) return false;
  int year = 0;
  int month = 0;
  int day = 0;
  int hour = 0;
  int minute = 0;
  if (sscanf(iso, "%4d-%2d-%2dT%2d:%2d", &year, &month, &day, &hour, &minute) != 5) return false;
  if (year < 2020 || year > 2100) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour > 23 || minute > 59) return false;

  out.year = (uint16_t)year;
  out.month = (uint8_t)month;
  out.day = (uint8_t)day;
  out.hour = (uint8_t)hour;
  out.minute = (uint8_t)minute;
  out.second = 0;
  out.weekday = (uint8_t)isoWeekday(year, month, day);
  return true;
}

/* 下一次醒来安排在什么时候（分钟）。规则都写在这儿，想改就改这一处。 */
int planSleepMinutes(JsonDocument &doc, bool haveDoc, bool fetched,
                     const RtcTime &now, bool clockOk, int batteryPercent) {
  if (!fetched) return 30;                      /* 没取到 → 半小时后再试 */
  if (!haveDoc || !clockOk) return 60;
  if (batteryPercent >= 0 && batteryPercent < 10) return 240;  /* 电量低，少醒几次 */

  const int nowMinutes = now.hour * 60 + now.minute;
  int best = 12 * 60;

  JsonArray today = doc["days"][0]["classes"];
  bool nextSeen = false;
  for (JsonObject item : today) {
    const int start = minutesOf(item["start"] | "");
    if (start < 0) continue;
    int end = minutesOf(item["end"] | "");
    if (end < 0) end = start + 60;

    /* 每节课前 OP_LEAD_MINUTES 分钟醒一次：把"还有几分钟"刷成新的 */
    const int lead = start - OP_LEAD_MINUTES - nowMinutes;
    if (lead >= 1 && lead < best) best = lead;

    /* 眼下这一节：开课那一分钟把大字从倒计时换成"正在上"，
       下课那一分钟再刷一次，屏幕上就不会一直挂着"还有 0 分钟" */
    if (!nextSeen && end >= nowMinutes) {
      nextSeen = true;
      const int atStart = start + 1 - nowMinutes;
      if (atStart >= 1 && atStart < best) best = atStart;
      const int afterEnd = end + 1 - nowMinutes;
      if (afterEnd >= 1 && afterEnd < best) best = afterEnd;
    }
  }

  /* 每天 07:00 一个锚点：就算整天没课，也刷一次日期和电量 */
  const int dawn = 7 * 60 - nowMinutes;
  if (dawn >= 1 && dawn < best) best = dawn;

  if (best < 5) best = 5;                       /* 别醒得太勤 */
  if (best > 12 * 60) best = 12 * 60;           /* 也别睡过头 */
  return best;
}

void goToSleep(int minutes) {
#if OP_SERIAL_LOG
  Serial.printf("[main] 睡 %d 分钟\n", minutes);
  Serial.flush();
#endif
  Ui::sleepPanel();
  Board::panelPower(false);   /* 屏幕那一路也断掉：墨水屏断电还留着画面 */
  esp_sleep_enable_timer_wakeup((uint64_t)minutes * 60ULL * 1000000ULL);
#if defined(ESP_GPIO_WAKEUP_GPIO_LOW)
  /* 按一下 PWR 就醒来刷新（低电平唤醒） */
  esp_deep_sleep_enable_gpio_wakeup(1ULL << PWR_BUTTON_PIN, ESP_GPIO_WAKEUP_GPIO_LOW);
#endif
  esp_deep_sleep_start();
}

}  /* namespace */

void setup() {
  Serial.begin(115200);
  gWakeCount++;
#if OP_SERIAL_LOG
  delay(300);
  Serial.printf("\n[main] 第 %lu 次开机/醒来（原因 %d）\n",
                (unsigned long)gWakeCount, (int)esp_sleep_get_wakeup_cause());
#endif

  Board::begin();

  /* 「开机时长按 PWR = 关机」这个功能默认关掉：
     PWR 同时是唤醒键，用电池开机时芯片启动的那一刻键还按着，很容易被
     误判成"想关机"→ 拉低电池开关 + 深睡，表现成"按什么都没反应、电脑也不认"。
     想用这个功能就把 config.h 里的 OP_PWR_LONG_PRESS_OFF 改成 1。 */
#if OP_PWR_LONG_PRESS_OFF
  bool wantsOff = false;
  if (Board::pwrButtonHeld()) {
    const uint32_t pressedAt = millis();
    while (Board::pwrButtonHeld() && (millis() - pressedAt) < 2500) delay(50);
    wantsOff = Board::pwrButtonHeld();
  }
  if (wantsOff) {
    Ui::begin();
    Ui::renderNotice("BYE", "power off", "", Board::batteryPercent());
    delay(1200);
    Board::powerOff();
  }
#endif

  Ui::begin();
  const int battery = Board::batteryPercent();

  RtcTime now;
  bool clockOk = Board::rtcRead(now);

  Net::Result result;
  result.code = 1;
  snprintf(result.message, sizeof(result.message), "no wifi");
  bool fetched = false;

  if (Net::connectWifi(OP_WIFI_TIMEOUT_MS)) {
    result = Net::fetch(OP_DEVICE_ENDPOINT, OP_SID, OP_PWD, gCache, sizeof(gCache));
    fetched = (result.code == 0);
    if (fetched) gCacheLen = (uint32_t)strlen(gCache);
    Net::stopWifi();
  }

  JsonDocument doc;
  bool haveDoc = false;

  if (fetched) {
    gCacheValid = true;
    haveDoc = (deserializeJson(doc, gCache, gCacheLen) == DeserializationError::Ok);
    RtcTime fromServer;
    if (haveDoc && parseIsoTime(doc["now"] | "", fromServer)) {
      Board::rtcWrite(fromServer);      /* 板载时钟拿服务器时间对表 */
      now = fromServer;
      clockOk = true;
      snprintf(gCachedAt, sizeof(gCachedAt), "%02u:%02u", fromServer.hour, fromServer.minute);
    }
#if OP_SERIAL_LOG
    Serial.printf("[main] 取到了：%u 字节，%s\n", (unsigned)gCacheLen,
                  haveDoc ? "解析成功" : "解析失败");
#endif
  } else if (gCacheValid) {
    haveDoc = (deserializeJson(doc, gCache, gCacheLen) == DeserializationError::Ok);
#if OP_SERIAL_LOG
    Serial.printf("[main] 没取到（%s），用上次缓存：%s\n", result.message,
                  haveDoc ? "可以显示" : "解析失败");
#endif
  }

  if (haveDoc) {
    Ui::renderPayload(doc, battery, !fetched, gCachedAt);
  } else if (result.code == 1) {
    /* 连不上网：多半是 config.h 里的 WiFi 名字/密码没填对，或者热点是 5GHz */
    Ui::renderNotice("NO WIFI", "check config.h", "retry in 30 min", battery);
  } else {
    Ui::renderNotice("NO DATA", result.message[0] ? result.message : "no cache yet",
                     "retry in 30 min", battery);
  }

  goToSleep(planSleepMinutes(doc, haveDoc, fetched, now, clockOk, battery));
}

void loop() {
  /* 醒来的活全在 setup 里干完了，这里不会跑到 */
}
