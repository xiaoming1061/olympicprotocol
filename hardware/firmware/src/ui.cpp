#include "ui.h"

#include <GxEPD2_BW.h>
#include <SPI.h>
#include <ctype.h>
#include <stdio.h>
#include <string.h>

#include "board_config.h"
#include "font8x8.h"
#include "ui_theme.h"

/* 1.54 寸 200×200、SSD1681 那一族。GxEPD2 里对应 GxEPD2_154_D67。
 * 万一刷出来画面不对（花屏、只有半屏），按 GxEPD2 的说明换成
 * GxEPD2_154 / GxEPD2_154_M09 / GxEPD2_154_M10 试——这几块屏长得很像。 */
#define EPD_PANEL GxEPD2_154_D67

static GxEPD2_BW<EPD_PANEL, EPD_PANEL::HEIGHT> display(
    EPD_PANEL(EPD_CS_PIN, EPD_DC_PIN, EPD_RST_PIN, EPD_BUSY_PIN));

namespace {

/* ---------- 一屏要画的字，先算好再画 ---------- */

struct Row {
  char time[8];      /* "11:30" */
  char code[16];     /* "ELEC1100" */
  char room[10];     /* "303" */
  char venue[40];    /* "Ho Sin Hang Engineering Building 303" 切短后 */
};

struct Model {
  char day[8];       /* "Mon" */
  char date[8];      /* "10-12" */
  int battery;       /* -1 = 读不到 */
  char big[20];      /* 大字：下一节的时间，或 NO CLASSES */
  char tag[16];      /* 大字右边小字：in 30m / NOW / Tomorrow */
  char meta[48];     /* "BMEG2210 Lecture" */
  char title1[40];
  char title2[40];
  char venue[40];
  char listHead[40]; /* "TODAY - 2 LEFT" */
  bool tall;         /* 课少的时候一节占两行（多一行地点） */
  int rowCount;
  Row rows[UI_LIST_ROWS_SHORT];
  char footer[40];   /* "updated 09:00" */
};

/* ---------- 画点、画字（和预览里的 Canvas 同一套逻辑） ---------- */

void putPixel(int x, int y) {
  if (x < 0 || y < 0 || x >= UI_W || y >= UI_H) return;   /* 出界就丢，和预览一致 */
  display.drawPixel((int16_t)x, (int16_t)y, GxEPD_BLACK);
}

void drawGlyph(int x, int y, unsigned char ch, uint8_t scale) {
  int index = (ch >= 32 && ch <= 126) ? (ch - 32) : ('?' - 32);
  const unsigned char *rows = FONT8X8[index];
  for (int row = 0; row < 8; row++) {
    const unsigned char bits = rows[row];
    for (int col = 0; col < 8; col++) {
      if (((bits >> col) & 1) == 0) continue;             /* bit0 = 最左边那个像素 */
      for (uint8_t dy = 0; dy < scale; dy++) {
        for (uint8_t dx = 0; dx < scale; dx++) {
          putPixel(x + col * scale + dx, y + row * scale + dy);
        }
      }
    }
  }
}

void drawText(int x, int y, const char *text, uint8_t scale = 1) {
  if (!text) return;
  int cursor = x;
  for (const unsigned char *p = (const unsigned char *)text; *p; p++) {
    drawGlyph(cursor, y, *p, scale);
    cursor += UI_ADVANCE * scale;
  }
}

int textWidth(const char *text, uint8_t scale) {
  if (!text) return 0;
  return (int)strlen(text) * UI_ADVANCE * scale;
}

void drawTextRight(int y, const char *text, uint8_t scale = 1) {
  if (!text) return;
  drawText(UI_W - UI_MARGIN - textWidth(text, scale), y, text, scale);
}

void drawRule(int y, int thickness) {
  for (int line = 0; line < thickness; line++) {
    for (int x = UI_MARGIN; x < UI_W - UI_MARGIN; x++) putPixel(x, y + line);
  }
}

/* ---------- 字串处理：和预览里的 sanitize / cut / wrapText 一一对应 ---------- */

/* 非 ASCII 一律变 '?'。UTF-8 的中文一个字三个字节，这里逐字节处理，于是变三个
 * '?'；预览那侧也按字节算，所以两边画出来一样宽。 */
void sanitizeInto(const char *src, char *out, size_t capacity) {
  if (!out || capacity == 0) return;
  size_t n = 0;
  if (src) {
    for (const unsigned char *p = (const unsigned char *)src; *p && n + 1 < capacity; p++) {
      out[n++] = (*p >= 32 && *p <= 126) ? (char)*p : '?';
    }
  }
  out[n] = '\0';
}

void cutInto(char *out, size_t capacity, const char *src, int maxChars) {
  char clean[192];
  sanitizeInto(src, clean, sizeof(clean));
  size_t limit = (size_t)maxChars;
  if (limit > capacity - 1) limit = capacity - 1;
  if (strlen(clean) < limit) limit = strlen(clean);
  memcpy(out, clean, limit);
  out[limit] = '\0';
}

/* 按空格折行，超长单词硬切，固定折成 UI_TITLE_LINES 行（不足补空行） */
void wrapInto(char lines[UI_TITLE_LINES][64], const char *src, int maxChars) {
  char clean[192];
  sanitizeInto(src, clean, sizeof(clean));

  int lineCount = 0;
  char current[64];
  current[0] = '\0';
  int currentLen = 0;

  char *cursor = clean;
  while (lineCount < UI_TITLE_LINES) {
    while (*cursor == ' ') cursor++;
    if (!*cursor) break;

    char *word = cursor;
    while (*cursor && *cursor != ' ') cursor++;
    const bool more = (*cursor != '\0');
    if (more) *cursor++ = '\0';

    while ((int)strlen(word) > maxChars) {
      if (currentLen > 0) {
        snprintf(lines[lineCount], sizeof(lines[0]), "%s", current);
        lineCount++;
        current[0] = '\0';
        currentLen = 0;
        if (lineCount >= UI_TITLE_LINES) break;
      }
      if (lineCount >= UI_TITLE_LINES) break;
      snprintf(lines[lineCount], sizeof(lines[0]), "%.*s", maxChars, word);
      lineCount++;
      word += maxChars;
    }
    if (lineCount >= UI_TITLE_LINES) break;

    const int wordLen = (int)strlen(word);
    if (wordLen == 0) continue;
    const int joined = (currentLen == 0) ? wordLen : (currentLen + 1 + wordLen);
    if (joined <= maxChars) {
      if (currentLen > 0) current[currentLen++] = ' ';
      memcpy(current + currentLen, word, wordLen);
      currentLen += wordLen;
      current[currentLen] = '\0';
    } else {
      snprintf(lines[lineCount], sizeof(lines[0]), "%s", current);
      lineCount++;
      if (lineCount >= UI_TITLE_LINES) break;
      snprintf(current, sizeof(current), "%s", word);
      currentLen = (int)strlen(current);
    }
  }
  if (lineCount < UI_TITLE_LINES && currentLen > 0) {
    snprintf(lines[lineCount], sizeof(lines[0]), "%s", current);
    lineCount++;
  }
  while (lineCount < UI_TITLE_LINES) {
    lines[lineCount][0] = '\0';
    lineCount++;
  }
}

void setTitles(Model &model, const char *text) {
  char lines[UI_TITLE_LINES][64];
  wrapInto(lines, text, UI_CHARS_MAX);
  snprintf(model.title1, sizeof(model.title1), "%s", lines[0]);
  snprintf(model.title2, sizeof(model.title2), "%s", lines[1]);
}

/* "0930" → "09:30" */
void clockOf(const char *hhmm, char *out, size_t capacity) {
  if (hhmm && strlen(hhmm) == 4) {
    snprintf(out, capacity, "%.2s:%.2s", hhmm, hhmm + 2);
  } else {
    snprintf(out, capacity, "--:--");
  }
}

void clockOfIso(const char *iso, char *out, size_t capacity) {
  const char *hit = iso ? strchr(iso, 'T') : nullptr;
  if (hit && strlen(hit) >= 6) {
    /* "2026-10-17T16:34+08:00"：T 后面第 1、4 个字符才是 "16" 和 "34"。
       之前写成 +2/+5，页脚会变成 "6::4+"——预览那侧是对的，这里是镜像时写偏了。 */
    snprintf(out, capacity, "%.2s:%.2s", hit + 1, hit + 4);
  } else {
    snprintf(out, capacity, "--:--");
  }
}

/* "20261012" → "10-12" */
void monthDayOf(const char *ymd, char *out, size_t capacity) {
  if (ymd && strlen(ymd) == 8) {
    snprintf(out, capacity, "%.2s-%.2s", ymd + 4, ymd + 6);
  } else {
    out[0] = '\0';
  }
}

/* 地点那一行：楼名太长就把楼名切短，教室号一定要留（不然找不到教室） */
void joinVenue(char *out, size_t capacity, const char *building, const char *room) {
  char roomClean[16];
  sanitizeInto(room, roomClean, sizeof(roomClean));
  if (roomClean[0]) {
    const int tail = (int)strlen(roomClean) + 1;
    int headMax = UI_CHARS_MAX - tail;
    if (headMax < 0) headMax = 0;
    char head[64];
    cutInto(head, sizeof(head), building, headMax);
    snprintf(out, capacity, "%s %s", head, roomClean);
  } else {
    cutInto(out, capacity, building, UI_CHARS_MAX);
  }
}

/* 和预览里的 buildModel 对应 */
void buildModel(JsonDocument &doc, Model &model, int batteryPercent, bool stale,
                const char *cachedAt) {
  memset(&model, 0, sizeof(model));
  model.battery = batteryPercent;

  snprintf(model.day, sizeof(model.day), "%s", (const char *)(doc["day"] | ""));
  monthDayOf(doc["today"] | "", model.date, sizeof(model.date));

  char hhmm[8];
  if (stale) {
    snprintf(model.footer, sizeof(model.footer), "OFFLINE - %s",
             (cachedAt && cachedAt[0]) ? cachedAt : "--:--");
  } else {
    clockOfIso(doc["now"] | "", hhmm, sizeof(hhmm));
    snprintf(model.footer, sizeof(model.footer), "updated %s", hhmm);
  }

  if (doc["empty"] | false) {
    snprintf(model.big, sizeof(model.big), "NO CLASSES");
    setTitles(model, "nothing in the next 7 days");
    return;
  }

  JsonObject next = doc["next"];
  if (next.isNull()) {
    snprintf(model.big, sizeof(model.big), "NO UPCOMING");
    setTitles(model, "all classes are past");
    return;
  }

  const int dayOffset = next["dayOffset"] | 0;
  clockOf(next["start"] | "", model.big, sizeof(model.big));

  if (dayOffset == 0) {
    if (next["inProgress"] | false) {
      snprintf(model.tag, sizeof(model.tag), "NOW");
    } else {
      int minutes = next["startsInMinutes"] | 0;
      if (minutes < 0) minutes = 0;
      snprintf(model.tag, sizeof(model.tag), "in %dm", minutes);
    }
  } else if (dayOffset == 1) {
    snprintf(model.tag, sizeof(model.tag), "Tomorrow");
  } else {
    snprintf(model.tag, sizeof(model.tag), "%s", (const char *)(next["day"] | ""));
  }

  char code[32];
  char type[16];
  char joined[56];
  cutInto(code, sizeof(code), next["code"] | "", 16);
  cutInto(type, sizeof(type), next["type"] | "", 12);
  if (type[0]) {
    snprintf(joined, sizeof(joined), "%s %s", code, type);
  } else {
    snprintf(joined, sizeof(joined), "%s", code);
  }
  cutInto(model.meta, sizeof(model.meta), joined, UI_CHARS_MAX);

  setTitles(model, next["title"] | "");
  joinVenue(model.venue, sizeof(model.venue), next["building"] | "", next["room"] | "");

  JsonArray classes = doc["days"][dayOffset]["classes"];
  const int total = (int)classes.size();
  const char *nextStart = next["start"] | "";

  int after = 0;
  for (JsonObject item : classes) {
    if (strcmp(item["start"] | "", nextStart) > 0) after++;
  }

  if (dayOffset == 0) {
    if (after == 0) snprintf(model.listHead, sizeof(model.listHead), "TODAY - LAST ONE");
    else snprintf(model.listHead, sizeof(model.listHead), "TODAY - %d LEFT", after);
  } else {
    char dayUpper[8];
    cutInto(dayUpper, sizeof(dayUpper), next["day"] | "", 6);
    for (char *p = dayUpper; *p; p++) *p = (char)toupper((unsigned char)*p);
    snprintf(model.listHead, sizeof(model.listHead), "%s - %d CLASS%s",
             dayUpper, total, total == 1 ? "" : "ES");
  }

  /* 课少 → 一节占两行（多一行地点）；课多 → 一行一节，能多列几节 */
  model.tall = (after <= UI_LIST_TALL_MAX);
  const int limit = model.tall ? UI_LIST_ROWS_TALL : UI_LIST_ROWS_SHORT;
  for (JsonObject item : classes) {
    if (strcmp(item["start"] | "", nextStart) <= 0) continue;
    if (model.rowCount >= limit) break;
    Row &row = model.rows[model.rowCount];
    clockOf(item["start"] | "", row.time, sizeof(row.time));
    cutInto(row.code, sizeof(row.code), item["code"] | "", 12);
    cutInto(row.room, sizeof(row.room), item["room"] | "", 8);
    joinVenue(row.venue, sizeof(row.venue), item["building"] | "", item["room"] | "");
    model.rowCount++;
  }
}

/* 和预览里的 drawScreen 对应 */
void drawModel(const Model &model) {
  char header[24];
  snprintf(header, sizeof(header), "%s %s", model.day, model.date);
  if (model.day[0] || model.date[0]) drawText(UI_MARGIN, UI_Y_HEADER, header);

  char battery[8];
  if (model.battery < 0) snprintf(battery, sizeof(battery), "--%%");
  else snprintf(battery, sizeof(battery), "%d%%", model.battery);
  drawTextRight(UI_Y_HEADER, battery);
  drawRule(UI_Y_RULE1, UI_RULE1_H);

  if (model.big[0]) drawText(UI_MARGIN, UI_Y_BIG_TIME, model.big, UI_BIG);
  if (model.tag[0]) drawTextRight(UI_Y_BIG_TAG, model.tag);
  if (model.meta[0]) drawText(UI_MARGIN, UI_Y_META, model.meta);

  drawText(UI_MARGIN, UI_Y_TITLE1, model.title1);
  drawText(UI_MARGIN, UI_Y_TITLE2, model.title2);
  if (model.venue[0]) drawText(UI_MARGIN, UI_Y_VENUE, model.venue);

  drawRule(UI_Y_RULE2, UI_RULE2_H);
  if (model.listHead[0]) drawText(UI_MARGIN, UI_Y_LIST_HEAD, model.listHead);

  const int step = model.tall ? UI_LIST_STEP_TALL : UI_LIST_STEP_SHORT;
  for (int i = 0; i < model.rowCount; i++) {
    const Row &row = model.rows[i];
    const int y = UI_Y_LIST_TOP + i * step;
    char line[32];
    snprintf(line, sizeof(line), "%s %s", row.time, row.code);
    drawText(UI_MARGIN, y, line);
    if (model.tall) {
      if (row.venue[0]) drawText(UI_MARGIN, y + UI_LIST_VENUE_DY, row.venue);
    } else if (row.room[0]) {
      drawTextRight(y, row.room);
    }
  }

  drawText(UI_MARGIN, UI_Y_FOOTER, model.footer);
}

void paint(const Model &model) {
  display.setFullWindow();
  display.firstPage();
  do {
    display.fillScreen(GxEPD_WHITE);
    drawModel(model);
  } while (display.nextPage());
}

}  /* namespace */

void Ui::begin() {
  /* 先把 SPI 按这块板子的引脚起起来。GxEPD2 内部还会再叫一次 begin()，
     但 Arduino-ESP32 的 SPIClass::begin() 在总线已经起来时是**直接返回**的
     （源码里第一句就是 `if (_spi) return`），所以这里设的引脚不会被覆盖。
     别删这一行——删了就得看芯片默认引脚能不能凑巧对上。 */
  SPI.begin(EPD_SCK_PIN, EPD_MISO_PIN, EPD_MOSI_PIN, EPD_CS_PIN);
  display.init(0, true, 2, false);   /* 0 = 不要它自己的诊断输出，日志归我们自己 */
  display.setRotation(0);
  display.setTextColor(GxEPD_BLACK);
}

void Ui::renderPayload(JsonDocument &doc, int batteryPercent, bool stale,
                       const char *cachedAt) {
  Model model;
  buildModel(doc, model, batteryPercent, stale, cachedAt);
  paint(model);
}

void Ui::renderNotice(const char *big, const char *line1, const char *line2,
                      int batteryPercent) {
  Model model;
  memset(&model, 0, sizeof(model));
  model.battery = batteryPercent;
  snprintf(model.big, sizeof(model.big), "%s", big ? big : "");
  if (line1) cutInto(model.title1, sizeof(model.title1), line1, UI_CHARS_MAX);
  if (line2) cutInto(model.title2, sizeof(model.title2), line2, UI_CHARS_MAX);
  paint(model);
}

void Ui::sleepPanel() {
  display.powerOff();
}
