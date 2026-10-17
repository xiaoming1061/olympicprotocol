# 固件：墨水屏课表牌

平台是 **PlatformIO + Arduino 框架**，目标板 **微雪 ESP32-C6-ePaper-1.54**。

## 快速开始

```bash
cd hardware/firmware
cp include/config.example.h include/config.h     # Windows: copy include\config.example.h include\config.h
# 编辑 include/config.h：WiFi、设备地址、学号密码
pio run -t upload
pio device monitor
```

> 第一次上手先看 `../BRINGUP.md`（到货第一天清单）。里面第 0 步是**先别碰板子**，
> 在电脑上跑 `node hardware/tools/check-endpoint.mjs <设备地址>` 把接口验通——
> 不然屏幕上只显示几个字符，分不清是配置错了还是线没插好。

没装 PlatformIO 的话：VS Code 装 PlatformIO 插件，用它打开这个目录，然后点 Upload。

> `platformio.ini` 里的 platform 不是官网那条 `espressif32`：ESP32-C6 需要
> Arduino-ESP32 3.x 内核，官方平台还停在 2.0.x。这里用的是社区维护的
> pioarduino 分支包，**版本锁死**，别人拿到也能编出一样的东西。

## 文件都是干什么的

| 文件 | 作用 |
| --- | --- |
| `src/main.cpp` | 主流程：取数 → 画屏 → 算下次醒的时间 → 睡 |
| `src/board.h/.cpp` | 供电（I/O 扩展芯片）、按键、电池电压、板载实时时钟 |
| `src/net.h/.cpp` | 连 WiFi、向课表代理 POST、把响应原文交给调用方 |
| `src/ui.h/.cpp` | 把那一小包数据画到 200×200 屏上 |
| `src/font8x8.h` | 8×8 点阵字库（ASCII 32–126，公有领域） |
| `src/ui_theme.h` | 排版参数（坐标、边距、放大倍数）。**预览工具会读它** |
| `include/board_config.h` | 板级引脚，抄自官方仓库 |
| `include/config.example.h` | 配置模板（WiFi / 地址 / 账号） |

## 一次"醒来"发生了什么

1. `Board::begin()`：起 I2C，把墨水屏那一路供电和电源保持位拉高；
2. 若开机时 PWR 是按着的 → 认为你想关机，画一屏 `BYE` 然后断电；
3. 连 WiFi（默认最多等 20 秒）→ `POST` 到 `/d/<口令>`，只要学号和密码；
4. 拿到的一小包 JSON 存进 **RTC 内存**（睡一觉不掉），顺手用服务器给的
   `now` 校准板载时钟——所以固件里**不用连 NTP、也不用管时区**；
5. 画一屏（整屏刷新约 2 秒）；
6. 算下次醒的时间：每天 07:00 一次 + 每节课前 15 分钟 + 开课那一分钟 + 下课那一分钟；
7. 屏幕断电 → 深度睡眠。

断网时会用 RTC 内存里那一包继续显示，页脚标 `OFFLINE`；半小时后重试。
一块屏显示旧课表，总比白屏强。

## 学校 Wi-Fi（802.1X）怎么连

学校那种「用户名 + 密码」的 Wi-Fi（`CUHK1x` / `eduroam`）不是家用 Wi-Fi，光填一个
密码是连不上的。固件里把开关打开即可：

| 配置项 | 学校 Wi-Fi | 家用 Wi-Fi |
| --- | --- | --- |
| `OP_WIFI_ENTERPRISE` | `1` | `0` |
| `OP_WIFI_SSID` | `CUHK1x`（不行再试 `eduroam`） | 你的 WiFi 名 |
| `OP_WIFI_PASS` | 留空 | 你的 WiFi 密码 |
| `OP_WIFI_USERNAME_SUFFIX` | `@link.cuhk.edu.hk`（Wi-Fi 用户名 = 学号 + 它） | 不用 |
| `OP_WIFI_IDENTITY` | 留空（= 拼好的用户名） | 不用 |
| `OP_WIFI_USERNAME` / `OP_WIFI_PASSWORD` | 留空 → 自动用「学号+后缀」/ `OP_PWD` | 不用 |

几个实际会遇到的情况：

- **密码**和查课表是同一组，不用填两遍；**用户名不一样**：Wi-Fi 是
  `学号@link.cuhk.edu.hk`，查课表是裸学号——固件会自动拼，别手动把课表的 SID 改成带后缀的；
- 首次连接要跟认证服务器来回，5–10 秒是正常的，20 秒超时够用；
- 连不上按顺序试：SSID 换 `eduroam`（后缀可能要改成 `@cuhk.edu.hk`）→ 确认账号没开二次验证；
- 学校可能限制**同一账号的并发设备数**（手机 + 电脑 + 手表）。认证失败时先把别的设备断开试试；
- 和 HTTPS 一样，这里不校验服务器证书（板子第一次上电没有可信时间）。真在意可以在
  `net.cpp` 里加 `esp_wifi_sta_wpa2_ent_set_ca_cert`，属于进阶操作。

## 想调的地方

| 想改 | 改哪儿 |
| --- | --- |
| 上课前提前多久醒 | `include/config.h` 的 `OP_LEAD_MINUTES` |
| 每天几点有个固定刷新 | `main.cpp` 里 `planSleepMinutes` 的 `07:00` |
| 屏幕排版 | `src/ui_theme.h`（改完跑一次预览就能看到效果） |
| 换墨水屏驱动 | `src/ui.cpp` 顶部的 `EPD_PANEL` |
| 串口日志开关 | `include/config.h` 的 `OP_SERIAL_LOG` |

## 排错

| 现象 | 多半是 |
| --- | --- |
| 屏幕全白/全黑，串口正常 | `EPD_PANEL` 那行换个驱动类试试（`GxEPD2_154` / `_M09` / `_M10`） |
| 屏幕花屏、只画一半 | 同上；也确认 SPI 引脚没被改过 |
| I2C 没反应（屏幕不亮、电量读不到） | 上电那两位没拉高；或 I2C 接触问题 |
| `NO WIFI` | 名字密码错了，或者热点是 5GHz（板子只认 2.4GHz） |
| `NO DATA` + `missing_credentials` | `config.h` 里学号/密码没填 |
| `NO DATA` + `upstream_timeout` | 学校那头上游慢（10–20 秒是常态），下次醒来会重试 |
| 刷不进去 | 按着 BOOT 再上电进下载模式；换根能传数据的 Type-C 线 |
| 深度睡眠时电流偏大 | 确认刷完屏有 `display.powerOff()` + 屏幕那一路断电（代码里已经做了） |

## 没接板子也能验的

```bash
node ../preview/render.mjs --check     # 屏幕排版有没有画出界、有没有字库里没有的字符
node ../../worker/test.mjs             # 设备接口那 41 条单测
```
