#include "board.h"

#include <Wire.h>
#include <esp_sleep.h>

#include "board_config.h"

namespace {

bool gExioOk = false;
bool gRtcOk = false;

/* ---------- TCA9554：八位 I/O 扩展，管着屏幕供电和电源保持 ----------
 * 寄存器：0x00 输入、0x01 输出、0x02 极性、0x03 方向（1 = 输入） */

bool exioWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);
  Wire.write(value);
  return Wire.endTransmission() == 0;
}

bool exioRead(uint8_t reg, uint8_t &out) {
  Wire.beginTransmission(TCA9554_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)TCA9554_ADDR, (uint8_t)1) != 1) return false;
  out = (uint8_t)Wire.read();
  return true;
}

bool exioMakeOutput(uint8_t mask) {
  uint8_t current = 0;
  if (!exioRead(0x03, current)) return false;
  return exioWrite(0x03, (uint8_t)(current & ~mask));
}

bool exioSetLevel(uint8_t mask, bool high) {
  uint8_t current = 0;
  if (!exioRead(0x01, current)) return false;
  const uint8_t next = high ? (uint8_t)(current | mask) : (uint8_t)(current & ~mask);
  return exioWrite(0x01, next);
}

/* ---------- PCF85063A：板载实时时钟（时间和日期都是 BCD 存的） ---------- */

uint8_t bcdToDec(uint8_t value) {
  return (uint8_t)((value / 16 * 10) + (value % 16));
}

uint8_t decToBcd(uint8_t value) {
  return (uint8_t)((value / 10 * 16) + (value % 10));
}

/* 上电先确认这颗芯片在，并把 Control_1 写成"走表 + 24 小时制"。
 * 官方示例里还开了 CAP_SEL（晶振电容档位），这里跟着开，免得走时偏。 */
bool rtcInit() {
  Wire.beginTransmission(PCF85063_ADDR);
  if (Wire.endTransmission() != 0) {
    gRtcOk = false;
    return false;
  }
  Wire.beginTransmission(PCF85063_ADDR);
  Wire.write(0x00);
  Wire.write(0x80);
  gRtcOk = (Wire.endTransmission() == 0);
  return gRtcOk;
}

}  /* namespace */

bool Board::begin() {
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN, I2C_HZ);
  delay(20);

  const uint8_t outputs = (uint8_t)((1 << EXIO_EPD_PWR) | (1 << EXIO_AUDIO_PWR) |
                                    (1 << EXIO_POWER_HOLD));
  gExioOk = exioMakeOutput(outputs);
  if (gExioOk) {
    /* 先把电源保持位和屏幕那一路拉高，再做别的 */
    gExioOk = exioSetLevel((uint8_t)((1 << EXIO_EPD_PWR) | (1 << EXIO_POWER_HOLD)), true);
  }

  pinMode(PWR_BUTTON_PIN, INPUT_PULLUP);
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  pinMode(VBAT_ADC_PIN, INPUT);

  rtcInit();
  return gExioOk;
}

float Board::batteryVolts() {
  /* 官方示例是 ADC1 通道 0 + 曲线校准，Arduino 这边 analogReadMilliVolts 做的
     就是同一件事（内部走 eFuse 校准），读到的毫伏乘 2 就是电池电压 */
  const uint32_t millivolts = analogReadMilliVolts(VBAT_ADC_PIN);
  return (float)millivolts * VBAT_DIVIDER / 1000.0f;
}

int Board::batteryPercent() {
  const float volts = batteryVolts();
  if (volts < 1.0f) return -1;               /* 读不到（没接电池或刚上电） */
  if (volts <= VBAT_EMPTY) return 0;
  if (volts >= VBAT_FULL) return 100;
  return (int)((volts - VBAT_EMPTY) / (VBAT_FULL - VBAT_EMPTY) * 100.0f);
}

bool Board::pwrButtonHeld() {
  return digitalRead(PWR_BUTTON_PIN) == LOW;
}

bool Board::bootButtonHeld() {
  return digitalRead(BOOT_BUTTON_PIN) == LOW;
}

bool Board::rtcOk() {
  return gRtcOk;
}

bool Board::rtcRead(RtcTime &out) {
  if (!gRtcOk) return false;
  Wire.beginTransmission(PCF85063_ADDR);
  Wire.write(0x02);                          /* 从"秒"开始，一次读 7 个字节 */
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)PCF85063_ADDR, (uint8_t)7) != 7) return false;

  uint8_t raw[7];
  for (int i = 0; i < 7; i++) raw[i] = (uint8_t)Wire.read();

  /* 秒寄存器的最高位是 OS（掉电标志）：置着说明中间断过电，时间不能信 */
  if (raw[0] & 0x80) return false;

  out.second = bcdToDec((uint8_t)(raw[0] & 0x7F));
  out.minute = bcdToDec((uint8_t)(raw[1] & 0x7F));
  out.hour = bcdToDec((uint8_t)(raw[2] & 0x3F));
  out.day = bcdToDec((uint8_t)(raw[3] & 0x3F));
  out.weekday = bcdToDec((uint8_t)(raw[4] & 0x07));
  out.month = bcdToDec((uint8_t)(raw[5] & 0x1F));
  out.year = (uint16_t)(bcdToDec(raw[6]) + 2000);

  if (out.year < 2020 || out.year > 2100) return false;
  if (out.month < 1 || out.month > 12) return false;
  if (out.day < 1 || out.day > 31) return false;
  if (out.hour > 23 || out.minute > 59 || out.second > 59) return false;
  return true;
}

bool Board::rtcWrite(const RtcTime &value) {
  if (!gRtcOk) return false;
  Wire.beginTransmission(PCF85063_ADDR);
  Wire.write(0x02);
  Wire.write(decToBcd(value.second));
  Wire.write(decToBcd(value.minute));
  Wire.write(decToBcd(value.hour));
  Wire.write(decToBcd(value.day));
  Wire.write(decToBcd(value.weekday < 1 || value.weekday > 7 ? 1 : value.weekday));
  Wire.write(decToBcd(value.month));
  Wire.write(decToBcd((uint8_t)(value.year % 100)));
  return Wire.endTransmission() == 0;
}

void Board::panelPower(bool on) {
  if (!gExioOk) return;
  exioSetLevel((uint8_t)(1 << EXIO_EPD_PWR), on);
}

void Board::powerOff() {
  if (gExioOk) {
    /* 官方示例"长按 PWR 关机"就是把这一位拉低——这一路是电池供电的保持线，
       拉低之后板子自己断电 */
    exioSetLevel((uint8_t)(1 << EXIO_POWER_HOLD), false);
    delay(200);
  }
  /* 拔不掉电的情况（比如插着 USB），退化成深度睡眠等按键，一样安静 */
  esp_deep_sleep_start();
}
