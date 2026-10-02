/* 把页面同步到 clubwebsite 仓库的 olympicprotocol/ 子目录
 *
 * 为什么需要它：rhythmhill.com 由 clubwebsite 仓库托管，
 * GitHub Pages 的自定义域名只能由一个仓库占整站根路径，
 * 所以这个页面要作为子目录放进去，才能通过
 *     https://rhythmhill.com/olympicprotocol/
 * 打开。这个脚本负责把源文件同步过去，避免两边各改各的。
 *
 * 用法：
 *   node tools/deploy.js            只同步文件
 *   node tools/deploy.js --push     同步 + 提交 + 推送（推送后会由 GitHub Pages 自动发布）
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const repo = path.join(root, "clubwebsite");
const target = path.join(repo, "olympicprotocol");

/* 目录名以前拼错成 olympicprotocal，已改成 olympicprotocol。
   老地址留在原地做一个跳转页，之前发出去的链接不会变成 404。 */
const legacyTarget = path.join(repo, "olympicprotocal");

/* 只搬运页面运行真正需要的文件，开发用的 tools/ 不上线。
   自动扫描 js/ 和 data/，避免以后加了新模块忘了加进清单。 */
function listJs(folder) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => folder + "/" + name);
}

const FILES = ["index.html", "styles.css", "cuhk-buildings.json", "voaf_ga09.jpg", "bg-loop.mp4"]
  .concat(listJs("data"), listJs("js"));

/* 防呆：index.html 里引用到的本地文件必须都在搬运清单里，
   否则线上会出现"少一个 js 文件、页面功能整个坏掉"的情况 */
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const referenced = Array.from(html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g))
  .map((m) => m[1])
  .filter((ref) => !/^(https?:|data:|#|\/)/.test(ref));

const missingFromList = referenced.filter((ref) => FILES.indexOf(ref) === -1);
if (missingFromList.length) {
  console.error("index.html 引用了但没在搬运清单里的文件：" + missingFromList.join(", "));
  process.exit(1);
}

const SUB_README = `# Olympic Protocol · 校园通行指挥台

课表 / 语音播报 / 定位 / 路线规划的静态页面，访问地址：
<https://rhythmhill.com/olympicprotocol/>

**这个目录是部署副本，请不要直接改这里。** 源文件在 Olympic Protocol 工程里，
改完运行 \`node tools/deploy.js --push\` 同步过来。

页面完全跑在浏览器端，没有任何后端依赖；数据存在访问者自己的浏览器里。
读取附近楼栋用的是 OpenStreetMap，免费、免密钥，静态托管上也能正常使用。
`;

/* 老地址的跳转页。内容固定，每次部署都重写一遍，
   保证它不会被别的东西覆盖掉。 */
const LEGACY_PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Olympic Protocol · 页面已换地址</title>
  <link rel="canonical" href="https://rhythmhill.com/olympicprotocol/" />
  <meta http-equiv="refresh" content="0; url=https://rhythmhill.com/olympicprotocol/" />
  <style>
    body { margin: 0; padding: 40px 22px; background: #070b14; color: #e8eefc;
           font-family: -apple-system, "Segoe UI", system-ui, sans-serif; line-height: 1.8; }
    a { color: #38e1ff; }
  </style>
</head>
<body>
  <p>这个页面换地址了，正在跳到
    <a href="https://rhythmhill.com/olympicprotocol/">rhythmhill.com/olympicprotocol/</a>…</p>
  <p>如果没有自动跳转，点上面的链接。</p>
  <script>location.replace("https://rhythmhill.com/olympicprotocol/");</script>
</body>
</html>
`;

if (!fs.existsSync(repo)) {
  console.error("找不到 clubwebsite 仓库：" + repo);
  process.exit(1);
}

/* ---------- 同步文件 ---------- */

let copied = 0;

/* 每次部署给资源地址加一个版本号。
   浏览器会死抱着缓存里的旧 js/css，用户就会觉得"改了怎么没生效"——
   地址一变，缓存自然失效。 */
const stamp = Date.now().toString(36);

FILES.forEach((file) => {
  const from = path.join(root, file);
  const to = path.join(target, file);
  if (!fs.existsSync(from)) {
    console.error("源文件不存在：" + file);
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });

  if (file === "index.html") {
    const html = fs.readFileSync(from, "utf8")
      .replace(/(href|src)="((?:styles\.css|(?:js|data)\/[^"]+\.js))"/g, '$1="$2?v=' + stamp + '"')
      /* 把自己的构建号也写进去，页面靠它跟 build.json 对比、自动换新版本 */
      .replace(/<meta name="build" content="[^"]*"/, '<meta name="build" content="' + stamp + '"');
    fs.writeFileSync(to, html, "utf8");
  } else {
    fs.copyFileSync(from, to);
  }
  copied++;
});

console.log("资源版本号：" + stamp);

fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(path.join(target, "README.md"), SUB_README, "utf8");

/* 版本检查用的文件。必须小、而且页面是不缓存地取它——
   HTML 有 10 分钟缓存，只能靠这个文件发现"有新版本了" */
fs.writeFileSync(path.join(target, "build.json"), JSON.stringify({
  stamp: stamp,
  built: new Date().toISOString()
}, null, 1) + "\n", "utf8");

/* 老地址那边只留一张跳转页。
   之前同步进去的页面文件要从这儿清掉，否则老地址上还挂着一整套旧页面，
   改完新地址、老地址却还在跑旧代码，两边看起来完全不一样。
   只删这个脚本自己搬过的文件名，不用递归删目录。 */
fs.mkdirSync(legacyTarget, { recursive: true });
let pruned = 0;
FILES.concat(["README.md"]).filter((file) => file !== "index.html").forEach((file) => {
  const stale = path.join(legacyTarget, file);
  if (fs.existsSync(stale) && fs.statSync(stale).isFile()) {
    fs.unlinkSync(stale);
    pruned++;
  }
});
fs.writeFileSync(path.join(legacyTarget, "index.html"), LEGACY_PAGE, "utf8");

console.log("已同步 " + copied + " 个文件到 clubwebsite/olympicprotocol/");
if (pruned) console.log("老地址清掉了 " + pruned + " 个陈旧文件，只留跳转页");

/* ---------- 提交并推送 ---------- */

if (process.argv.indexOf("--push") === -1) {
  console.log("（只同步了文件。加 --push 可以顺便提交并推送）");
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

git(identity.concat(["commit", "-m", "feat: 新增 Olympic Protocol 校园通行指挥台页面"]), { stdio: "inherit" });

console.log("\n正在推送…");
git(["push", "origin", "HEAD"], { stdio: "inherit" });

console.log("\n推送完成。GitHub Pages 大概一分钟后生效：");
console.log("  https://rhythmhill.com/olympicprotocol/");
