/* 把导出的存档变成「默认楼栋」数据文件
 *
 * 用法：
 *   node tools/make-buildings.js <导出的 JSON 路径>
 *
 * 导出办法：页面里「课表 → 导出」，或者「设置 → 数据」拿到一个
 * olympic-protocol-日期.json，里面同时有楼栋、课表和设置。
 * 这个脚本只取其中的楼栋，写成 data/buildings.js。
 *
 * 楼栋默认数据只有这一个来源，页面用 <script> 直接加载它，不联网也能用。
 * 课表和设置不写进默认数据——那两样是每个人自己的。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const source = process.argv[2];
if (!source) {
  console.error("用法：node tools/make-buildings.js <导出的 JSON 路径>");
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const raw = JSON.parse(fs.readFileSync(source, "utf8"));

/**
 * 导出里没有、但页面上要有的楼栋。
 *
 * 这些是后补的（当时的导出没有录进去），写在这里是为了重新生成时不被抹掉。
 * 坐标从 OpenStreetMap 查，海拔用页面同一个接口（Open-Meteo）取。
 */
const EXTRA = [
  {
    id: "b-cuhk-haddon-cave-field",
    name: "Sir Philip Haddon-Cave Sports Field",
    alias: ["夏鼎基運動場", "夏鼎基运动场"],
    lat: 22.4187663,
    lng: 114.2119536,
    elevation: 27
  }
];

/**
 * 给已有的楼栋补别名。
 *
 * 课表上写的是简称，而这个简称在 OSM 上散落在好几条里，模糊分算出来是并列的，
 * 于是先出现的那条就赢了——但赢的那条不是课表指的。
 *   "Science Centre" → OSM 里有科學館東座、科學館北座、科學館南座、大學科學館…
 *   课表上的 Science Centre 指的是大學科學館（University Science Centre）。
 * 把课表那种写法挂到正确的楼栋上，它就变成精确匹配，不用再靠分数碰运气。
 */
const ALIAS_EXTRA = {
  "University Science Centre": ["Science Centre"]
};

/* 比对名字时忽略大小写、空格和标点，避免"同一栋楼两种写法"混进来 */
function key(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

const campus = raw.campus || {};
const list = Array.isArray(campus.buildings) ? campus.buildings : [];
if (!list.length) {
  console.error("这份存档里没有楼栋（campus.buildings 是空的）");
  process.exit(1);
}

/* 和 store.js 里一样的排序：英文按字母、中文按拼音、数字按大小。
   放在文件里排好，改动时的 diff 才看得清。 */
function compare(a, b) {
  return String((a && a.name) || "").localeCompare(String((b && b.name) || ""), "zh-Hans", {
    numeric: true,
    sensitivity: "base"
  });
}

function num(value) {
  return typeof value === "number" && isFinite(value) ? value : null;
}

const seen = Object.create(null);
let dropped = 0;

const buildings = list
  .filter((b) => b && b.name)
  .map((b, index) => {
    let id = b.id ? String(b.id) : "";
    if (!id || seen[id]) {
      /* id 缺失或撞车时补一个，页面靠它把课和楼对起来 */
      id = "b-" + String(b.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + index;
    }
    seen[id] = true;

    const lat = num(b.lat);
    const lng = num(b.lng);
    const elevation = num(b.elevation);
    if (lat === null || lng === null) dropped++;

    const out = { id: id, name: String(b.name) };
    const alias = Array.isArray(b.alias) ? b.alias.filter((a) => a && String(a).trim()) : [];
    out.alias = alias.map((a) => String(a));
    out.lat = lat === null ? null : Number(lat.toFixed(6));
    out.lng = lng === null ? null : Number(lng.toFixed(6));
    if (elevation !== null) out.elevation = Math.round(elevation);
    return out;
  })
  .sort(compare);

/* 把额外补的楼栋并进来；已经在列表里的（同 id 或同名）就跳过 */
const taken = Object.create(null);
buildings.forEach((b) => {
  taken[b.id] = true;
  taken[key(b.name)] = true;
  b.alias.forEach((a) => { taken[key(a)] = true; });
});

const addedExtras = [];
const skippedExtras = [];

EXTRA.forEach((item) => {
  const id = item.id || "b-extra-" + key(item.name).slice(0, 16);
  if (taken[id] || taken[key(item.name)]) {
    skippedExtras.push(item.name);
    return;
  }
  const building = {
    id: id,
    name: String(item.name),
    alias: (item.alias || []).map(String),
    lat: Number(Number(item.lat).toFixed(6)),
    lng: Number(Number(item.lng).toFixed(6))
  };
  if (typeof item.elevation === "number") building.elevation = Math.round(item.elevation);
  buildings.push(building);
  taken[id] = true;
  taken[key(item.name)] = true;
  addedExtras.push(item.name);
});

buildings.sort(compare);

/* 补别名：按归一化后的名字找到那栋楼，把别名并进去（同名的跳过） */
const aliasAdded = [];
const aliasMissed = [];

Object.keys(ALIAS_EXTRA).forEach((name) => {
  const hit = buildings.filter((b) => key(b.name) === key(name))[0];
  if (!hit) {
    aliasMissed.push(name);
    return;
  }
  ALIAS_EXTRA[name].forEach((alias) => {
    if (!alias) return;
    if (hit.alias.some((a) => key(a) === key(alias))) return;
    hit.alias.push(String(alias));
    aliasAdded.push(hit.name + " ← " + alias);
  });
});

/**
 * 版本号：内容变了就 +1。
 *
 * 页面靠它判断"要不要把本地那份换成这一版"：用户本地存档里记着
 * defaultVersion，比这里小就**整份替换**（store.js 里的 replaceWithShipped）。
 * 不是"只补不改"——那样从默认数据里删掉的楼在用户那边永远删不掉。
 */
const target = path.join(root, "data", "buildings.js");

function readExisting(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const sandbox = { window: {} };
    // eslint-disable-next-line no-new-func
    new Function("window", fs.readFileSync(file, "utf8"))(sandbox.window);
    return (sandbox.window.OP && sandbox.window.OP.DEFAULT_BUILDINGS) || null;
  } catch (err) {
    return null;
  }
}

const existing = readExisting(target);
let version = (existing && Number(existing.version)) || 0;
/* 老文件可能还没有 version 字段：那种情况当成"要重新编号"，从 1 开始 */
const unchanged = !!existing && version > 0 &&
  JSON.stringify(existing.buildings) === JSON.stringify(buildings);
if (!unchanged) version = Math.max(1, version + 1);

const lines = buildings.map((b) => {
  const parts = [
    "id: " + JSON.stringify(b.id),
    "name: " + JSON.stringify(b.name),
    "alias: [" + b.alias.map((a) => JSON.stringify(a)).join(", ") + "]",
    "lat: " + (b.lat === null ? "null" : b.lat),
    "lng: " + (b.lng === null ? "null" : b.lng)
  ];
  if (b.elevation !== undefined) parts.push("elevation: " + b.elevation);
  return "    { " + parts.join(", ") + " }";
});

const output = "/* Olympic Protocol — 默认楼栋数据\n" +
  " *\n" +
  " * 这份数据是从浏览器里导出的真实校区楼栋（共 " + buildings.length + " 栋，含中英文别名和海拔），\n" +
  " * 用来当页面的默认楼栋：第一次打开、点了「恢复默认数据」、或者本地没存档时，用的就是它。\n" +
  " *\n" +
  " * version 是内容版本：改一次数据就 +1。页面**按版本强制采用**：\n" +
  " * 用户本地那份比这一版旧时，会被整份换成这份数据（不是「只补不改」——\n" +
  " * 那样从默认数据里删掉的楼在用户那边永远删不掉）。\n" +
  " *\n" +
  " * 不要手改这个文件，它由下面的命令生成：\n" +
  " *     node tools/make-buildings.js <导出的 JSON>\n" +
  " * 课表和设置是每个人自己的，放在浏览器本地，不在这里。\n" +
  " */\n" +
  "\n" +
  "window.OP = window.OP || {};\n" +
  "\n" +
  "window.OP.DEFAULT_BUILDINGS = {\n" +
  "  version: " + version + ",\n" +
  "  name: " + JSON.stringify(campus.name || "校区") + ",\n" +
  "  buildings: [\n" +
  lines.join(",\n") + "\n" +
  "  ]\n" +
  "};\n";

fs.writeFileSync(target, output, "utf8");

console.log("已写入 " + path.relative(root, target));
console.log("  版本：" + version + (unchanged ? "（内容没变，沿用）" : "（内容有变，已 +1）"));
console.log("  校区名：" + (campus.name || "校区"));
console.log("  楼栋：" + buildings.length + " 栋（有别名 " +
  buildings.filter((b) => b.alias.length).length + " 栋，有海拔 " +
  buildings.filter((b) => b.elevation !== undefined).length + " 栋）");
if (addedExtras.length) console.log("  额外补进：" + addedExtras.join("、"));
if (skippedExtras.length) console.log("  已在列表里，跳过：" + skippedExtras.join("、"));
if (aliasAdded.length) console.log("  补了别名：" + aliasAdded.join("、"));
if (aliasMissed.length) console.log("  想补别名但没找到这栋：" + aliasMissed.join("、"));
if (dropped) console.log("  注意：" + dropped + " 栋没有坐标，页面上会显示「还没坐标」");
console.log("  文件大小：" + Math.round(output.length / 1024) + " KB");
