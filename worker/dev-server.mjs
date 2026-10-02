/* 本地跑同一个代理：不开 Cloudflare 账号、不装 wrangler 也能先试。
 *
 *     node worker/dev-server.mjs
 *     → http://127.0.0.1:8788/timetable
 *
 * 用环境变量改配置，跟线上那套一一对应：
 *     PROXY_TOKEN / ALLOWED_ORIGINS / UPSTREAM_MODE / DEBUG
 *     ALLOW_EMPTY_CREDENTIALS=1   ← 只想确认"管道通不通"时开一下（空凭据登不进去）
 */

import http from "node:http";
import worker from "./timetable-proxy.js";

const PORT = Number(process.env.PORT || 8788);

const ENV = {
  PROXY_TOKEN: process.env.PROXY_TOKEN || "",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ||
    "https://rhythmhill.com,http://localhost:5173,http://127.0.0.1:5173",
  UPSTREAM_MODE: process.env.UPSTREAM_MODE || "soap-plain",
  DEBUG: process.env.DEBUG || "1",
  ALLOW_EMPTY_CREDENTIALS: process.env.ALLOW_EMPTY_CREDENTIALS || "0"
};

const server = http.createServer(async function (req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  /* 只挑用得上的头：Node 会把 host / connection 这些一起给过来，
     原样塞进 Request 容易撞上浏览器那套禁用头规则 */
  const headers = {};
  if (req.headers.origin) headers.Origin = req.headers.origin;
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  headers["CF-Connecting-IP"] = req.socket.remoteAddress || "127.0.0.1";

  const init = { method: req.method, headers: headers };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = body;

  let response;
  try {
    response = await worker.fetch(new Request("http://127.0.0.1:" + PORT + req.url, init), ENV, {});
  } catch (err) {
    response = new Response(
      JSON.stringify({ ok: false, error: "dev_server_error", detail: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }

  const out = {};
  response.headers.forEach(function (value, key) { out[key] = value; });
  res.writeHead(response.status, out);
  res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(PORT, "127.0.0.1", function () {
  console.log("课表代理（本地）跑在 http://127.0.0.1:" + PORT + "/timetable");
  console.log("  允许来源：" + ENV.ALLOWED_ORIGINS);
  console.log("  上游写法：" + ENV.UPSTREAM_MODE);
  console.log("  想只确认管道通不通（空凭据登不进去，安全）：");
  console.log("    ALLOW_EMPTY_CREDENTIALS=1 node worker/dev-server.mjs");
  console.log("    curl -s -X POST http://127.0.0.1:" + PORT + "/timetable " +
    "-H \"Content-Type: application/json\" -d '{\"sid\":\"\",\"pwd\":\"\"}'");
});
