# 隐私说明 / Privacy Notice

**一句话：这是一个纯浏览器端的页面。我们不设账号、不做数据库、不接入任何统计或广告
脚本。你输入的东西默认只留在你自己的浏览器里，除非某个功能明确需要联系外部服务。**

> English summary: Olympic Protocol runs entirely in your browser. We operate no
> accounts and no database, and we load no analytics or advertising scripts.
> Data you enter stays on your device unless a feature explicitly needs to
> contact a third-party map or the timetable service.

最近更新：2026-10-03

## 1. 存在你浏览器里的数据

全部用 `localStorage` 保存，只在本机、只在本浏览器：

| 存储键 | 内容 |
|---|---|
| `olympic-protocol.courses.v1` | 你的课表 |
| `olympic-protocol.buildings.v1` | 校区与楼栋，含你自己添加的 |
| `olympic-protocol.settings.v1` | 各项设置，**其中包含你填过的学号（SID）** |
| `olympic-protocol.fired.v1` | 语音播报"已经提醒过"的记录 |

这些内容不会上传到我们的服务器。导出成 JSON 时，文件直接下载到你的设备，由你保管。

## 2. 我们不做的事

- 不设账号、不做登录、没有用户表
- 没有服务器数据库，服务端不保存任何课表或楼栋
- 不接入统计、埋点、广告、热图、崩溃上报等任何第三方脚本
- 本站自身不使用 Cookie
- 不记录、不出售、不分享你的课表、位置或课程安排

## 3. 什么时候数据会离开你的设备

只有你主动使用某个功能时才会发生：

| 功能 | 发往 | 发出去的内容 |
|---|---|---|
| 搜索附近楼栋 | Overpass API | 当前地图的坐标范围，不含身份信息 |
| 楼栋名称转坐标 | Nominatim | 你输入的楼栋名称文字 |
| 街道图底图 | OpenStreetMap 瓦片服务 | 你正在查看的瓦片编号 |
| 计算海拔与爬升 | Open-Meteo | 沿途坐标点 |
| 从学校拉取课表 | 本项目自建的 Cloudflare Worker | 见第 4 节 |
| 截图导入课表 | jsDelivr / unpkg / tessdata | **只下载识别引擎与语言模型，图片不上传** |
| 点"出发"打开导航 | Google / Apple / 高德 / 百度地图 | 目的地坐标 |
| 查看校巴与假期来源 | transport.cuhk.edu.hk、res.cuhk.edu.hk 等 | 仅链接跳转，不自动发送数据 |

## 4. 从学校接口拉取课表（重点）

这是唯一会接触到账号信息的功能。

- 你填的 **SID 与密码**，只在按下拉取时发到本项目自建的 Cloudflare Worker，由它转发给
  港中文的课表接口。
- Worker **不写数据库、不写日志文件、不落盘**；响应头为 `Cache-Control: no-store`。
- Worker 只有一条运行日志，内容仅三项：HTTP 状态码、耗时、调用模式。
  **不含 SID、密码，也不含任何课程内容。**
- **密码用后立即清空**，不会被保存。
- **SID 会保留在你浏览器的设置里**，省得每次重填。不想留就在设置里清空，或清除本站数据。
- 你完全可以不用这个功能：截图导入和 JSON 导入同样能建课表，且不需要任何账号信息。

## 5. 定位

定位只在你点"用当前位置"时才读取，坐标只在本地用于计算距离与路线，不会上传到我们的
服务器。浏览器每次都会向你请求授权，你随时可以在系统设置里收回。

## 6. 截图导入课表

识别在**你的浏览器里**用本地引擎完成。图片不会上传，只会从 CDN 下载引擎程序与语言
模型。如果你完全不打开这个功能，这些文件也不会被下载。

## 7. 怎么删掉你的数据

- 页面设置里的「清空」按钮
- 浏览器的"清除本站数据"
- 从主屏移除这个网页应用

## 8. 第三方服务各自的隐私政策

- OpenStreetMap / Nominatim：https://osmfoundation.org/wiki/Privacy_Policy
- Overpass API：https://overpass-api.de/
- Open-Meteo：https://open-meteo.com/en/terms
- Cloudflare（Worker 运行商）：https://www.cloudflare.com/privacypolicy/
- Google 地图：https://policies.google.com/privacy
- Apple 地图：https://www.apple.com/legal/privacy/

## 9. 说明的变更

本说明如有修改，会体现在仓库的提交记录里。

## 10. 联系方式

有隐私方面的疑问：y1819400195@hotmail.com
