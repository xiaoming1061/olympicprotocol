/* 老地址的跳转页
 *
 * 页面已经搬到 https://olympicprotocol.com/ —— 由 olympicprotocol 仓库
 * 直接托管（仓库根目录就是站点根，所以不再需要"同步副本"这一步）。
 *
 * 为什么还要这个脚本：rhythmhill.com 是另一个仓库（clubwebsite）的站点。
 * GitHub Pages 的自定义域名只能由一个仓库占整站根路径，所以
 *     https://rhythmhill.com/olympicprotocol/
 *     https://rhythmhill.com/olympicprotocal/     （当年拼错的那个）
 * 这两个老地址只能留在 clubwebsite 里做跳转。
 *
 * 它做两件事：
 *   1. 把两个老目录的 index.html 写成跳转页；
 *   2. 清掉以前同步过去、现在已经用不上的旧页面文件。
 *
 * 用法：
 *   node tools/deploy.js            只写跳转页
 *   node tools/deploy.js --push     写 + 提交 + 推送
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const repo = path.join(root, "clubwebsite");
const target = path.join(repo, "olympicprotocol");

/* 目录名以前拼错成 olympicprotocal，后来改成 olympicprotocol。
   两个都得留跳转页——之前发出去的链接不能变成 404。 */
const legacyTarget = path.join(repo, "olympicprotocal");

/* 页面的正式地址。老地址一律跳到这里。 */
const LIVE_URL = "https://olympicprotocol.com/";

/* 以前搬过去的文件，现在一个都不需要了。
   自动扫 js/ 和 data/，免得以后加了模块忘了加进清理清单。 */
function listJs(folder) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => folder + "/" + name);
}

const STALE = ["styles.css", "cuhk-buildings.json", "voaf_ga09.jpg", "bg-loop.mp4", "README.md", "build.json"]
  .concat(listJs("data"), listJs("js"));

/* 跳转页。内容固定，每次跑都重写一遍，
   保证它不会被别的东西覆盖掉。 */
const REDIRECT_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Olympic Protocol · 页面已换地址</title>
  <link rel="canonical" href="${LIVE_URL}" />
  <meta http-equiv="refresh" content="0; url=${LIVE_URL}" />
  <style>
    body { margin: 0; padding: 40px 22px; background: #070b14; color: #e8eefc;
           font-family: -apple-system, "Segoe UI", system-ui, sans-serif; line-height: 1.8; }
    a { color: #38e1ff; }
  </style>
</head>
<body>
  <p>这个页面换地址了，正在跳到
    <a href="${LIVE_URL}">olympicprotocol.com</a>…</p>
  <p>如果没有自动跳转，点上面的链接。</p>
  <script>location.replace("${LIVE_URL}");</script>
</body>
</html>
`;

if (!fs.existsSync(repo)) {
  console.error("找不到 clubwebsite 仓库：" + repo);
  process.exit(1);
}

/* ---------- 两个老地址：清掉旧页面，只留跳转页 ---------- */

let pruned = 0;

[target, legacyTarget].forEach((dir) => {
  fs.mkdirSync(dir, { recursive: true });

  STALE.forEach((file) => {
    const stale = path.join(dir, file);
    if (fs.existsSync(stale) && fs.statSync(stale).isFile()) {
      fs.unlinkSync(stale);
      pruned++;
    }
  });

  fs.writeFileSync(path.join(dir, "index.html"), REDIRECT_PAGE, "utf8");
});

console.log("两个老地址已写成跳转页，指向 " + LIVE_URL);
if (pruned) console.log("清掉 " + pruned + " 个用不上的旧页面文件");

/* ---------- 提交并推送 ---------- */

if (process.argv.indexOf("--push") === -1) {
  console.log("（只写了跳转页。加 --push 可以顺便提交并推送）");
  process.exit(process.exitCode || 0);
}

function git(args, options) {
  return execFileSync("git", args, Object.assign({ cwd: repo, encoding: "utf8" }, options || {}));
}

/* 仓库里没配身份时，沿用最近一次提交的作者，避免提交被拒 */
let identity = [];
try {
  const name = git(["config", "--get", "user.name"]).trim();
  const email = git(["config", "--get", "user.email"]).trim();
  if (!name || !email) throw new Error("no identity");
} catch (err) {
  const last = git(["log", "-1", "--format=%an%n%ae"]).trim().split("\n");
  identity = ["-c", "user.name=" + last[0], "-c", "user.email=" + last[1]];
  console.log("仓库未配置提交身份，本次沿用：" + last[0] + " <" + last[1] + ">");
}

git(["add", "olympicprotocol", "olympicprotocal"]);

const status = git(["status", "--porcelain", "olympicprotocol", "olympicprotocal"]).trim();
if (!status) {
  console.log("内容没有变化，跳过提交");
  process.exit(0);
}

git(identity.concat(["commit", "-m", "chore: Olympic Protocol 换到 olympicprotocol.com，老地址留跳转"]), { stdio: "inherit" });

console.log("\n正在推送…");
git(["push", "origin", "HEAD"], { stdio: "inherit" });

console.log("\n推送完成。GitHub Pages 大概一分钟后生效。");
console.log("正式地址：" + LIVE_URL);
console.log("老地址会跳到上面那个。");
