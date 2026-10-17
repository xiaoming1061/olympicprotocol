/* 把 worker 的两个模块拼成一个单文件（给 Cloudflare 控制台用）
 *
 *     node worker/make-bundle.mjs           # 重新生成 timetable-proxy.bundle.js
 *     node worker/make-bundle.mjs --check   # 只检查有没有过期（自检用）
 *
 * 为什么需要：wrangler 部署会自动打包 import；但控制台的编辑器是按单个文件
 * 粘贴的，直接贴 timetable-proxy.js 会因为找不到 ./device-payload.js 而报错。
 * 所以这里机械地拼一份「能直接贴」的版本，生成物入库（不进 .gitignore），
 * 自检里有一条盯着它别过期。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerFile = path.join(here, "timetable-proxy.js");
const payloadFile = path.join(here, "device-payload.js");
const outFile = path.join(here, "timetable-proxy.bundle.js");

const IMPORT_LINE = 'import { buildDevicePayload } from "./device-payload.js";';

const worker = fs.readFileSync(workerFile, "utf8");
const payload = fs.readFileSync(payloadFile, "utf8");

if (worker.indexOf(IMPORT_LINE) < 0) {
  console.error("timetable-proxy.js 里找不到那行 import，脚本要跟着改。");
  process.exit(2);
}

/* device-payload.js 里的 export 去掉就行——拼进同一个模块作用域后，
   函数和常量本来就在一起（两边没有重名，自检会盯着）。 */
const inlined = payload.replace(/^export\s+/gm, "").trim();

const header = [
  "/* 自动生成，别手改 —— node worker/make-bundle.mjs 重新生成",
  " *",
  " * 来源：worker/timetable-proxy.js + worker/device-payload.js",
  " * 用途：Cloudflare 控制台只能贴一个文件时，贴这一份。",
  " *      用 wrangler 部署的话直接用源文件，它会自己打包。",
  " */",
  ""
].join("\n");

const bundle = header + "\n" +
  worker.replace(IMPORT_LINE + "\n", "") +
  "\n/* ---------- 设备载荷（原 worker/device-payload.js） ---------- */\n\n" +
  inlined + "\n";

if (process.argv.indexOf("--check") >= 0) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  if (current !== bundle) {
    console.error("单文件版过期了，跑一次 node worker/make-bundle.mjs");
    process.exit(1);
  }
  console.log("单文件版是最新的");
  process.exit(0);
}

fs.writeFileSync(outFile, bundle);
console.log("已生成 " + path.relative(process.cwd(), outFile) + "（" + bundle.length + " 字节）");
