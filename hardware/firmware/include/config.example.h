/* 复制成 config.h 再填（config.h 不进 Git，密码别提交）
 *
 *     cp include/config.example.h include/config.h      (Linux / macOS)
 *     copy include\config.example.h include\config.h    (Windows)
 *
 * 里面有 WiFi、取数地址、学号密码。填完直接 `pio run -t upload`。
 */

#ifndef OP_CONFIG_H
#define OP_CONFIG_H

/* ---------- WiFi（手机热点也行，2.4GHz） ---------- */
#define OP_WIFI_SSID "你的WiFi名"
#define OP_WIFI_PASS "你的WiFi密码"

/* ---------- 取数地址 ----------
 * 就是 Cloudflare Worker 上那条给手表用的入口：
 *   https://<你的worker>.workers.dev/d/<DEVICE_TOKEN>
 * DEVICE_TOKEN 在 Worker 的环境变量里配（见 worker/README.md）。
 * 这条地址等于一个口令，别发到公开的地方。
 */
#define OP_DEVICE_ENDPOINT "https://example.workers.dev/d/replace-me"

/* ---------- 学校账号（和网页「拉取课表」用的是同一个） ---------- */
#define OP_SID "1155xxxxxx"
#define OP_PWD "你的密码"

/* ---------- 想调才动的几个旋钮 ---------- */
#define OP_LEAD_MINUTES 15      /* 上课前多少分钟醒一次（默认提前 15 分钟刷新） */
#define OP_WIFI_TIMEOUT_MS 20000
#define OP_HTTP_TIMEOUT_MS 25000
#define OP_SERIAL_LOG 1         /* 串口打印流程日志；省电可以关掉 */

#endif /* OP_CONFIG_H */
