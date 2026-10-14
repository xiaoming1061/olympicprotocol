/* 给 index.html 里的本地资源换一个新版本号
 *
 * 为什么需要：GitHub Pages 给 js/css 也是 10 分钟缓存。改完之后
 * 访问者可能拿到"新 HTML + 旧 js"这种半新半旧的状态，
 * 看着就像改动没生效（这个坑已经踩过好几次）。
 * 给资源地址挂一个版本号，地址一变浏览器就必须重新取。
 *
 * 这个项目没有构建步骤，版本号只能写进 index.html 本身。
 * 所以：**改完 js/ 或 styles.css 之后，提交前跑一次**
 *     node tools/bump.js
 *
 * 版本号用"年月日-时分"（20261015-1843），既能失效缓存，
 * 又能让人一眼看出这是哪次改的；设置页的「发布时间」也读它。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const file = path.resolve(__dirname, "..", "index.html");
const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) +
  "-" + pad(d.getHours()) + pad(d.getMinutes());

const before = fs.readFileSync(file, "utf8");

/* 只动这三类本地资源：样式表、js/ 下的脚本、data/ 下的脚本。
   外链（https:// 开头）和 favicon 之类一律不碰。
   已经有 ?v= 的就换成新的。 */
const after = before.replace(
  /(href|src)="((?:styles\.css|(?:js|data)\/[^"?]+\.js))(?:\?v=[^"]*)?"/g,
  (match, attr, url) => attr + '="' + url + "?v=" + stamp + '"'
);

if (after === before) {
  console.log("index.html 里没有找到本地资源引用，未改动。");
  console.log("（如果你刚加过 script 标签，检查一下路径是不是写在 js/ 或 data/ 下）");
  process.exit(0);
}

fs.writeFileSync(file, after, "utf8");

const count = (after.match(/\?v=/g) || []).length;
console.log("已把 " + count + " 处本地资源标成 ?v=" + stamp);
console.log("接着跑自检再提交：node tools/selftest.js");
