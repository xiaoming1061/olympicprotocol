/* 联网实测：拿真实坐标去 OpenStreetMap 查一次附近建筑
 *
 * 用来验证「从地图读取附近楼栋」在真实数据上能不能跑通，不参与页面运行。
 *
 * 用法：
 *   node tools/places-live.js
 *   node tools/places-live.js 31.2304 121.4737 1000
 *   node tools/places-live.js 22.4196 114.2068 800 --merge=off
 */

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

["data/defaults.js", "js/store.js", "js/geo.js", "js/places.js"].forEach((file) => {
  // eslint-disable-next-line no-eval
  eval(fs.readFileSync(path.join(root, file), "utf8"));
});

const OP = global.OP;

/* Overpass 会拒绝没有 User-Agent 的请求；浏览器会自动带上，Node 不会，
   所以这里只给这个测试脚本补一个。页面代码不受影响。 */
const realFetch = global.fetch;
global.fetch = (url, options) => {
  const opts = Object.assign({}, options);
  opts.headers = Object.assign({}, opts.headers, {
    "User-Agent": "Olympic-Protocol/1.0 (campus timetable demo)"
  });
  return realFetch(url, opts);
};

const args = {};
const positional = [];

process.argv.slice(2).forEach((arg) => {
  const match = /^--([^=]+)=?(.*)$/.exec(arg);
  if (match) args[match[1]] = match[2];
  else if (arg.trim() !== "") positional.push(arg);
});

const lat = Number(args.lat || positional[0]) || 22.4196;      // 默认：香港中文大学
const lng = Number(args.lng || positional[1]) || 114.2068;
const radius = Number(args.radius || positional[2]) || 800;
const merge = args.merge !== "off";

console.log("数据来源：OpenStreetMap / Overpass API");
console.log("查询位置：" + lat + ", " + lng + "，半径 " + radius + " 米");
console.log("合并同一点位：" + (merge ? "开" : "关") + "\n");

const started = Date.now();

OP.Places.search({
  lat: lat,
  lng: lng,
  radius: radius,
  keyword: args.keyword || "",
  merge: merge,
  mergeMeters: Number(args.mergeMeters) || 25
})
  .then((list) => {
    console.log("耗时 " + (Date.now() - started) + "ms，返回 " + list.length + " 个有名字的建筑：\n");

    if (!list.length) {
      console.log("（这个位置在 OSM 里没有录入带名称的建筑，换个大一点的校园通常会有）");
      return;
    }

    list.slice(0, 25).forEach((item) => {
      const flag = item.teaching ? "★" : " ";
      const merged = item.merged > 1 ? "  ⊞合并 " + item.merged + " 个点" : "";
      console.log(
        "  " + flag + " " + item.name.padEnd(28, " ") +
        OP.Geo.formatDistance(item.distance).padStart(9, " ") + "  " +
        (item.kind || "") + merged
      );
    });
    if (list.length > 25) console.log("\n  …（还有 " + (list.length - 25) + " 个）");
    console.log("\n  带 ★ 的是名字看起来像教学楼的");
  })
  .catch((err) => {
    console.error("查询失败：" + err.message);
    process.exitCode = 1;
  });
