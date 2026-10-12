/* 板级驱动：供电、按键、电池电压、板载实时时钟
 *
 * 都是这块板子特有的东西，跟"课表"没关系，所以单独一层。
 */

#ifndef OP_BOARD_H
#define OP_BOARD_H

#include <Arduino.h>

struct RtcTime {
  uint16_t year;    /* 2026 */
  uint8_t month;    /* 1-12 */
  uint8_t day;      /* 1-31 */
  uint8_t weekday;  /* 1 = 周一 … 7 = 周日 */
  uint8_t hour;
  uint8_t minute;
  uint8_t second;
};

namespace Board {

/* 起 I2C、打开供电（屏幕那一路 + 电源保持位）。false = I/O 扩展芯片没应答 */
bool begin();

float batteryVolts();
int batteryPercent();       /* -1 = 没接电池或用 USB 供电读不准 */

bool pwrButtonHeld();
bool bootButtonHeld();

bool rtcOk();
bool rtcRead(RtcTime &out);       /* false = 掉过电/没走表，时间不可信 */
bool rtcWrite(const RtcTime &value);

void panelPower(bool on);         /* 墨水屏那一路电（刷完就能关掉） */
void powerOff();                  /* 长按 PWR 关机：拉低电源保持位 → 板子断电 */

}  /* namespace Board */

#endif /* OP_BOARD_H */
