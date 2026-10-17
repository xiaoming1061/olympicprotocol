# CUHK 课表代理（Cloudflare Worker 免费版）

浏览器**不能**直接调学校的课表接口——预检和响应都没有 CORS 头，而且网页 JS 不允许
设 `User-Agent`。所以中间加这一层：它只做「转发一次 → 把 XML 里的 JSON 抠出来 → 原样返回」，
**不写日志、不落盘、不缓存**，密码只在这一次请求的内存里待着。

免费版 Workers 的额度（10 万次/天、每次 10ms CPU）对我们绰绰有余：
一次请求几乎全程在等 CUHK 回话，不算 CPU 时间。

## 三种跑法

### 1. 本地先试（不用注册任何账号）

```bash
node worker/dev-server.mjs
# → http://127.0.0.1:8788/timetable

# 只想确认"管道通不通"（空凭据登不进去，安全）：
ALLOW_EMPTY_CREDENTIALS=1 node worker/dev-server.mjs
curl -s -X POST http://127.0.0.1:8788/timetable \
  -H "Content-Type: application/json" -d '{"sid":"","pwd":""}'
# → {"ok":true,"mode":"soap-plain","count":0,"courses":[]}
```

### 2. Cloudflare 控制台（最省事，不用装命令行）

1. 登录 Cloudflare → **Workers & Pages** → **Create** → **Worker** → 取个名字（例如 `cuhk-timetable-proxy`）
2. 把 **`worker/timetable-proxy.bundle.js`** 的内容整个粘进编辑器 → **Deploy**
   （控制台的编辑器一次只认一个文件。源文件拆成了两个模块，直接贴
   `timetable-proxy.js` 会报「找不到 ./device-payload.js」；单文件版是
   `node worker/make-bundle.mjs` 机械拼出来的，内容一样）
3. 进 **Settings → Variables and Secrets**，加两个变量：
   - `PROXY_TOKEN` = 一段随机串（例如 `k7fq2m9x`），**类型选 Secret**，别用可读的明文变量
   - `DEVICE_TOKEN` = 另一段随机串（手表那条入口用；不配的话 `/d/…` 是 404）
   - `ALLOWED_ORIGINS` = `https://rhythmhill.com,http://localhost:5173`
4. 部署完你会拿到 `https://<名字>.<你的账号>.workers.dev`
5. 你的代理地址就是：`https://<名字>.<你的账号>.workers.dev/t/k7fq2m9x`

> 不设 `PROXY_TOKEN` 时它只认 `/timetable` 这个路径；设了之后只有
> `/t/<口令>` 能通，别的路径一律 404（装作没有这个服务）。

### 3. 命令行

```bash
npx wrangler deploy                       # 读同目录的 wrangler.toml
npx wrangler secret put PROXY_TOKEN        # 口令用 secret 配，不写进文件
```

## 接口

**请求** `POST /t/<口令>`，`Content-Type: application/json`

```json
{ "sid": "1155xxxxxx", "pwd": "你的密码", "mode": "soap-plain" }
```

`mode` 可以不填（默认 `soap-plain`）。

**成功** `200`

```json
{ "ok": true, "mode": "soap-plain", "count": 12, "courses": [ { "SUBJECT": "BMEG", "CATALOG_NBR": "2210", "FDESCR": "Science Centre L3", "LAT": "22.42", "LNG": "114.21", "..." : "..." } ] }
```

`courses` 就是上游那段 JSON 数组，**字段名保持原样**，不做二次加工——
等拿到真实数据再决定怎么映射到我们自己的课程结构（那时才写进 `js/`）。

**失败**

| 状态 | `error` | 意思 |
| --- | --- | --- |
| 400 | `bad_json` / `missing_credentials` / `unknown_mode` | 请求本身有问题 |
| 404 | `not_found` | 路径（口令）不对 |
| 405 | `method_not_allowed` | 只收 POST（GET 是给部署自查用的，见下） |
| 413 | `body_too_large` | 请求体超过 1KB |
| 429 | `too_many_requests` | 限流（每 IP 每分钟 6 次） |
| 502 | `upstream_status` / `upstream_unparseable` | 上游报错或回了个不是 JSON 的东西（会带一小段原文） |
| 504 | `upstream_timeout` / `upstream_unreachable` | 20 秒没等到上游 |

**部署后自查**：用浏览器打开 `https://<域名>/t/<网页口令>`（GET 就行）。新代码会回

```json
{ "ok": true, "service": "cuhk-timetable-proxy", "build": "2026-10-17", "deviceRoute": true, "hasDeviceToken": true }
```

- 回 `405 method_not_allowed` → **线上还是旧代码**，没贴上去或没点 Deploy；
- 回 `404` → 口令/域名不对；
- 回 200 但 `hasDeviceToken: false` → 代码是新的，但 `DEVICE_TOKEN` 还没配。

## 墨水屏手表那条入口（`/d/<口令>`）

手表只有一块 200×200 的黑白屏、一块小电池、一次只醒十几秒，所以它不要网页
拿的那份 28 字段原始数据，而要**一小包「今天 / 接下来」**：字段短、总量有上限。

| | 网页 `/t/<PROXY_TOKEN>` | 手表 `/d/<DEVICE_TOKEN>` |
| --- | --- | --- |
| 回来的东西 | 上游原始 28 字段行，原样 | 压好的「今天 + 未来 6 天」 |
| 筛选 / 排序 | 不筛、不排序 | 按星期七列 + 起止日期筛，按时间排序，算好 `next` / `inProgress` |
| 体积 | 可能几十 KB | ≤ 4096 字节（超了从最后一天往回丢） |
| 谁来解析 | 网页（`js/timetable.js`） | 手表（`src/ui.cpp`） |
| 用途 | 导入到网页课表 | 直接画到屏幕上 |

所以**「网页有、手表没有」是可能发生的**，常见四种原因：

1. 那节课不在接下来 7 天里（上学期的课、已经结课的课）；
2. 七列星期开关没勾，也没有 `MEETING_DAY` 文本或开始日期可推；
3. 上课时间写法认不出（`14:30:00` 这种带秒的现在能认了）；
4. 整包超过 4096 字节，从最后一天开始往回裁。

逐行查原因：把网页那条地址交给诊断工具，它会一行一行告诉你哪行进得去、哪行被什么
原因挡掉（包括"被体积裁掉"）：

```bash
node hardware/tools/check-endpoint.mjs https://<worker域名>/t/<网页口令>
```

这条入口跟网页那条**各配各的口令**：`DEVICE_TOKEN` 没配，`/d/…` 直接 404，
等于这条入口不存在。口令写在 URL 里 = 一个静态凭据，别发到公开的地方。

**请求** `POST /d/<DEVICE_TOKEN>`，`Content-Type: application/json`

```json
{ "sid": "1155xxxxxx", "pwd": "你的密码" }
```

可选两个字段：`days`（往前排几天，默认 7，最多 14）、`perDay`（每天最多几节，
默认 8，最多 20）。联调时还可以传 `now`（形如 `2026-10-12T09:00:00+08:00`）
把"现在"钉死，方便对着断言看结果——手表自己不会传。

**成功** `200`

```json
{
  "ok": true, "v": 1, "mode": "soap-aes",
  "now": "2026-10-12T09:00+08:00", "today": "20261012",
  "weekday": 1, "day": "Mon",
  "next": {
    "date": "20261012", "day": "Mon", "dayOffset": 0,
    "start": "0930", "end": "1015", "code": "BMEG2210", "type": "Lecture",
    "title": "Biomedical Engineering", "venue": "Science Centre L3",
    "building": "Science Centre", "room": "L3", "teacher": "CHAN TAI MAN",
    "startsInMinutes": 30, "inProgress": false
  },
  "days": [ { "date": "20261012", "weekday": 1, "day": "Mon", "classes": [ … ] } ],
  "count": 12, "empty": false, "truncated": false
}
```

几条约定（都有单测盯着）：

| 约定 | 为什么 |
| --- | --- |
| `start` / `end` 是 `HHMM` 四位字符串 | 手表不用解析时区、不用管冒号 |
| `inProgress` 为真时 `next` 仍指向**正在上**的那节 | 屏幕上显示"现在这节"比显示"下一节"有用 |
| 正在上时 `startsInMinutes` 是负数 | 一眼看出已经上课几分钟 |
| 总量压到 4096 字节以内（从最后一天开始丢，并给 `truncated: true`） | 手表的缓冲区就那么大 |
| 标题 28 字、地点 26 字、每天最多 8 节 | 屏上一行只有 23 个字符 |
| 星期读 `MON…SUN` 七列开关，不拿 `START_DT` 猜 | 和网页那边同一个判据 |
| `START_DT` 八位数字、带分隔符两种都认；13 月这种当没写 | 上游两种都出现过 |
| 地点末尾像教室号才切出来（`L3`、`303`）；`Foo Building 7` 不拆 | 拆错了比不拆更难看 |

**失败**：跟上面那张表一样（`bad_json` / `missing_credentials` / `not_found` /
`method_not_allowed` / `body_too_large` / `too_many_requests` / `upstream_*`），
只是 `not_found` 也涵盖"口令不对"。

## 四种上游写法（`mode`）

| mode | 打到哪 | 凭据 | 说明 |
| --- | --- | --- | --- |
| `soap-plain` | `STT.asmx`（SOAP） | 明文 | **默认**，官方 App 走的就是这条 |
| `soap-aes` | 同上 | AES-256-CBC + base64 | 官方 App 另一版本用的形式 |
| `form-plain` | `STT.asmx/GetTimeTable` | 明文 | ASP.NET 的 HTTP POST 绑定 |
| `form-aes` | 同上 | 加密 | 同上 |

**为什么要留四个**：到底哪种能拿到课表，只有用真实账号才知道（我们手上没有）。
所以第一次联调时，把四种各试一遍（`mode` 写在请求体里），看哪个 `count > 0`；
定了之后把 `UPSTREAM_MODE` 设成那个，平时就不用再传 `mode` 了。

**它不会自动重试**——这是故意的。密码错的情况下连发四次 = 连错四次，
有些学校系统会因此锁账号。一次请求只发一次上游调用。

## 已经实测过的（不是推测）

- 上游是 ASP.NET 的 ASMX SOAP 服务，方法签名 `GetTimeTable(asP1, asP2, asP3) → string`，
  帮助页和 WSDL 都能公开访问；参数含义是社区逆向出来的（`asP1` 学号、`asP2` 密码、
  `asP3` = `hk.edu.cuhk.ClassTT`，即官方 App 的 bundle id）。
- **两种外壳不一样**：SOAP 那条回的是 `<GetTimeTableResult>…</GetTimeTableResult>`，
  form 那条回的是 `<string>…</string>`。只认 `<string>` 的话 SOAP 会被误判成解析失败
  ——本机联调时真踩了这个坑，现在两条都认。
- **空凭据返回 `HTTP 200` + `[]`**：也就是说"密码错了"和"这学期没选课"上游给的
  完全一样。界面文案只能写"没读到课表"，不能断言密码错。
- 四条路（四种 mode）在**本机网络**下都通：都返回 200 + 空数组（空凭据本来就登不进去）。

## 部署后第一件事：验两件还说不准的事

1. **Cloudflare 的出口 IP 会不会被 CUHK 拦**（机房 IP 和家里宽带不是一回事）；
2. **Workers 能不能设自定义 `User-Agent`**（代码里带 UA 失败会自动退回不带 UA 再试一次，
   所以两种情况都能跑，但要确认走的是哪条）。

```bash
curl -s -X POST "https://<名字>.<账号>.workers.dev/t/<口令>" \
  -H "Content-Type: application/json" -d '{"sid":"","pwd":""}'
```

看到 `{"ok":true,...,"count":0}` 就说明出口 IP 和 UA 两关都过了（跟本机结果一致）；
如果看到 502 / 504，那就是被拦了或者连不上——那时候再考虑换香港的机器自托管。

## 安全清单（代码里对应的位置）

- 只有**一个**上游，写死在代码里；不接受请求里传目标地址 → 不可能被当开放代理用。
- **不写日志**（`DEBUG=1` 时才写状态码和耗时，永远不写请求体）；不落盘、不缓存
  （响应带 `Cache-Control: no-store`）。
- CORS 只给 `ALLOWED_ORIGINS` 里的来源发头。
- 只收 `POST`；请求体上限 1KB；上游超时 20 秒。
- 路径里带口令，扫不到它；路径不对返回 404。
- 限流每 IP 每分钟 6 次（尽力而为：免费版没有 KV/DO，换个机房就归零）。
  **想更稳可以再在 Cloudflare 控制台加一条 Rate limiting 规则**（按 IP 限制整站请求数）。

## 自检

```bash
node worker/test.mjs     # 25 条，全部离线（上游用替身），跑一遍不到 1 秒
```

`tools/selftest.js` 会自动带着它一起跑。

## 踩过的坑：控制台拖拽上传会被拒

```
This uploader does not yet support projects that require a build process.
At least one JavaScript file was found. Please use `wrangler deploy` instead...
```

这不是代码的问题，是**入口用错了**：控制台那个"拖文件/传文件夹"的地方是给静态资源
用的，一看到 `.js` 就当成"需要构建的源码工程"。Workers 的代码不该从那儿进。
（另外也别用 "Import a repository" 连 GitHub 仓库——那是 Pages 的流程，
它会拿整个站点去构建，而我们仓库里全是 `js/*.js`。）

**用控制台自带的在线编辑器就行，什么都不用装：**

1. Workers & Pages → **Create** → **Workers** → "Start with Hello World" → 起名 → **Deploy**
2. 进这个 Worker → **Edit code** → 把编辑器里的内容全选删掉 →
   粘贴本目录的 `timetable-proxy.js`（**只粘这一个文件**）→ **Deploy**
3. **Settings → Variables and Secrets** → 加 `PROXY_TOKEN`（类型选 Secret）
   和 `ALLOWED_ORIGINS` = `https://rhythmhill.com,http://localhost:5173` → 再 Deploy 一次

变量**一个都不配也能先跑**：不配 `PROXY_TOKEN` 时路径是 `/timetable`，
`ALLOWED_ORIGINS` 用内置默认值（正好就是上面那两个来源）。所以可以
"先粘上去 → 用 `/timetable` 验管道 → 再加口令"。

要用命令行的话（本机和 CI 都行），需要先有 npm：

```bash
cd worker
npx wrangler login
npx wrangler deploy
npx wrangler secret put PROXY_TOKEN
```
