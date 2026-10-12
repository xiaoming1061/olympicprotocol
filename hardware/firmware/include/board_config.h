/* 板级定义：微雪 ESP32-C6-ePaper-1.54
 *
 * 这些数字不是猜的，是从官方仓库里抄的：
 *   waveshareteam/ESP32-C6-ePaper-1.54
 *   02_Example/arduino_v3.3.0/07_BATT_PWR_Test/epaper_config.h
 *   （以及 01_ADC_Test/port_adc.cpp 里的电池分压系数）
 *
 * 实物上要留意的两件事，都在下面注释里标了：
 *   1. 墨水屏和电池分压的供电都挂在 TCA9554 这颗 I/O 扩展芯片上，
 *      上电后必须先把那两位拉高，屏幕才会亮、电池才读得准；
 *   2. 关机的开关也是这颗扩展芯片的一位（官方示例长按 PWR 就是这么关的）。
 */

#ifndef OP_BOARD_CONFIG_H
#define OP_BOARD_CONFIG_H

/* ---------- 墨水屏（SPI2，注意和 TF 卡共用同一组 SPI） ---------- */
#define EPD_SCK_PIN 6
#define EPD_MOSI_PIN 5
#define EPD_MISO_PIN 4
#define EPD_CS_PIN 7
#define EPD_DC_PIN 15
#define EPD_RST_PIN 11
#define EPD_BUSY_PIN 10

/* ---------- I2C（RTC、温湿度、I/O 扩展都在这条总线上） ---------- */
#define I2C_SDA_PIN 18
#define I2C_SCL_PIN 8
#define I2C_HZ 400000

#define TCA9554_ADDR 0x20   /* I/O 扩展芯片 */
#define PCF85063_ADDR 0x51  /* 实时时钟 */

/* TCA9554 的哪一位管什么（EXIO 号 = TCA9554 的 P0…P7） */
#define EXIO_EPD_PWR 0      /* 墨水屏供电：不拉高屏幕不亮 */
#define EXIO_AUDIO_PWR 1    /* 音频芯片供电（本项目用不到） */
#define EXIO_LED 4          /* 板载可控灯 */
#define EXIO_POWER_HOLD 5   /* 电池供电的保持/关机位（拉低即断电） */

/* ---------- 按键 ---------- */
#define PWR_BUTTON_PIN 2
#define BOOT_BUTTON_PIN 9

/* ---------- 电池 ---------- */
#define VBAT_ADC_PIN 0      /* GPIO0 = ADC1_CH0，官方就是这么量的 */
#define VBAT_DIVIDER 2.0f   /* 分压一半，读到的电压要乘回来 */
#define VBAT_FULL 4.12f
#define VBAT_EMPTY 3.0f

#endif /* OP_BOARD_CONFIG_H */
