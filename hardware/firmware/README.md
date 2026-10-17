# 固件：墨水屏课表牌

工具链是 **Arduino 官方 CLI（arduino-cli）+ ESP32 Arduino 内核 3.x**，
目标板 **微雪 ESP32-C6-ePaper-1.54**。

## 快速开始

```bash
cd hardware/firmware
# Windows: copy src\config.example.h src\config.h
cp src/config.example.h src/config.h
# 编辑 src/config.h：WiFi（学校网会自动拼用户名）、设备地址、学号密码

# 编译 + 烧录 + 看日志（把 COM5 换成你的串口）
..\tools\flash.cmd COM5
```

> 第一次上手先看 `../BRINGUP.md`（到货第一天清单）。里面第 0 步是**先别碰板子**，
> 在电脑上跑 `node hardware/tools/check-endpoint.mjs <设备地址>` 把接口验通——
> 不然屏幕上只显示几个字符，分不清是配置错了还是线没插好。

> **为什么不用 PlatformIO**：ESP32-C6 需要 Arduino-ESP32 3.x，而 PlatformIO 官方
> 平台里带的还是 2.0.17（编译会报 "This board doesn't support arduino framework"）；
> 社区分支 pioarduino 的包又缺 PlatformIO 要的 `package.json`。Arduino 官方 CLI
> 对 C6 是原生支持的，所以改用这条工具链。

不跑脚本、想手打命令的话：

```bash
arduino-cli compile --fqbn esp32:esp32:esp32c6:CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=no_ota --build-path D:\op-build .
arduino-cli upload -p COM5 --fqbn esp32:esp32:esp32c6:CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=no_ota --input-dir D:\op-build .
arduino-cli monitor -p COM5 -b esp32:esp32:esp32c6:CDCOnBoot=cdc,FlashSize=16M,PartitionScheme=no_ota --config baudrate=115200
```

> 构建目录一定要放在**没有空格**的路径（`D:\op-build`）。放在
> `...\Olympic Protocal\...` 这种带空格的路径下，Windows 的 `ar` 会在最后一步
> 打包 `core.a` 时报 "Invalid argument"。

## 文件都是干什么的

| 文件 | 作用 |
| --- | --- |
| `firmware.ino` | Arduino sketch 入口（空的；setup/loop 在 `src/main.cpp`） |
| `src/main.cpp` | 主流程：取数 → 画屏 → 算下次醒的时间 → 睡 |
| `src/board.h/.cpp` | 供电（I/O 扩展芯片）、按键、电池电压、板载实时时钟 |
| `src/net.h/.cpp` | 连 WiFi、向课表代理 POST、把响应原文交给调用方 |
| `src/ui.h/.cpp` | 把那一小包数据画到 200×200 屏上 |
| `src/font8x8.h` | 8×8 点阵字库（ASCII 32–126，公有领域） |
| `src/ui_theme.h` | 排版参数（坐标、边距、放大倍数）。**预览工具会读它** |
| `src/board_config.h` | 板级引脚，抄自官方仓库 |
| `src/config.example.h` | 配置模板（WiFi / 地址 / 账号） |

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
| 上课前提前多久醒 | `src/config.h` 的 `OP_LEAD_MINUTES` |
| 每天几点有个固定刷新 | `main.cpp` 里 `planSleepMinutes` 的 `07:00` |
| 屏幕排版 | `src/ui_theme.h`（改完跑一次预览就能看到效果） |
| 换墨水屏驱动 | `src/ui.cpp` 顶部的 `EPD_PANEL` |
| 串口日志开关 | `src/config.h` 的 `OP_SERIAL_LOG` |

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
