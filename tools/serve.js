/* 零依赖本地静态服务器
 *
 * 为什么需要它：浏览器的定位功能只在 https 或 localhost 下可用，
 * 直接双击 index.html 打开时定位会被拦掉。用它跑起来就能正常测试。
 *
 * 运行方式：  node tools/serve.js          → http://localhost:5173
 *            node tools/serve.js 8080     → 换端口
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.argv[2]) || 5173;
const root = path.resolve(__dirname, "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".wasm": "application/wasm",
  ".gz": "application/gzip",
  ".traineddata": "application/octet-stream",
  ".ico": "image/x-icon"
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split("?")[0]);
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  let target = path.resolve(root, relative);

  /* 只允许读取项目目录内的文件 */
  if (!target.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  /* 目录地址自动补 index.html，和 GitHub Pages 的行为保持一致 */
  fs.stat(target, (statErr, stat) => {
    if (!statErr && stat.isDirectory()) target = path.join(target, "index.html");

    fs.readFile(target, (err, buf) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
          .end("404 Not Found: " + relative);
        return;
      }
      const type = TYPES[path.extname(target).toLowerCase()] || "application/octet-stream";
      const head = { "Content-Type": type, "Cache-Control": "no-cache", "Accept-Ranges": "bytes" };

      /* 视频（尤其 iOS Safari）会先发一个 Range 请求来探路，
         服务器不支持就干脆不给播。这里按 GitHub Pages 的行为支持一下，
         本地测出来的效果才跟线上一致。 */
      const range = req.headers.range;
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        const total = buf.length;
        let start = m[1] === "" ? total - Number(m[2] || 0) : Number(m[1]);
        let end = m[1] === "" || m[2] === "" ? total - 1 : Number(m[2]);
        start = Math.max(0, Math.min(start, total - 1));
        end = Math.max(start, Math.min(end, total - 1));
        res.writeHead(206, Object.assign({}, head, {
          "Content-Range": "bytes " + start + "-" + end + "/" + total,
          "Content-Length": end - start + 1
        }));
        res.end(buf.subarray(start, end + 1));
        return;
      }

      res.writeHead(200, Object.assign({}, head, { "Content-Length": buf.length }));
      res.end(buf);
    });
  });
});

server.listen(port, () => {
  console.log("Olympic Protocol 已启动： http://localhost:" + port);
  console.log("按 Ctrl+C 停止");
});
