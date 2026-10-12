/* 屏幕：把那一小包数据画到 200×200 墨水屏上
 *
 * 绘制顺序和 `hardware/preview/layout.mjs` 是一一对应的（那边是电脑上的预览）。
 * **改这里记得改那边**，不然买板子之前看到的图和真机就对不上了。
 */

#ifndef OP_UI_H
#define OP_UI_H

#include <Arduino.h>
#include <ArduinoJson.h>

namespace Ui {

void begin();          /* SPI + 墨水屏初始化（要先 Board::begin() 把屏幕电打开） */

/* 画一屏课表。cachedAt 形如 "07:10"，只在 stale 为真时用得上 */
void renderPayload(JsonDocument &doc, int batteryPercent, bool stale, const char *cachedAt);

/* 画一屏提示（没数据、连不上网、配置没填……） */
void renderNotice(const char *big, const char *line1, const char *line2, int batteryPercent);

void sleepPanel();     /* 刷完让屏幕休眠，然后就能切断屏幕供电了 */

}  /* namespace Ui */

#endif /* OP_UI_H */
