/* 生成 data/dorms.js —— 默认宿舍数据
 *
 * 数据来自 OpenStreetMap（Overpass API），按关键词搜校园里的宿舍：
 *   宿舍 / 舍堂 / 書院 / 书院 / Hostel / Residence / Dormitory / Hall，
 * 再加上三种"看标签就知道是宿舍"的：
 *   building=dormitory、amenity=student_accommodation、tourism=hostel。
 *
 * 用法：
 *   node tools/make-dorms.js --fetch     # 联网抓一次，存成 tools/dorms-overpass.json
 *   node tools/make-dorms.js --list      # 只打印原始候选，先看看抓到了啥
 *   node tools/make-dorms.js             # 按规则筛完写进 data/dorms.js
 *
 * 筛不干净是常态：OSM 里 "Hall" 既有宿舍也有演讲厅，书院既是宿舍区也是
 * 行政单位。所以下面有明确的"要"和"不要"名单，改名单比改正则靠谱。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const RAW = path.join(__dirname, "dorms-overpass.json");
const OUT = path.join(root, "data", "dorms.js");

/* 港中文，和 tools/places-live.js 里用的默认点一致 */
const CENTER = { lat: 22.4196, lng: 114.2068 };
const RADIUS = 2500;

/* 主节点经常 504（一个请求里塞太多条件更是必超时），
   所以拆成几条小查询、分别重试，最后合起来。 */
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

function buildQueries() {
  const around = "(around:" + RADIUS + "," + CENTER.lat + "," + CENTER.lng + ")";
  const wrap = (sel) => "[out:json][timeout:60];" + sel + around + ";out center tags;";
  const nameRe = "宿舍|舍堂|書院|书院|Hostel|Residence|Dormitory|Student Hall";
  return [
    wrap('nwr["building"="dormitory"]'),
    wrap('nwr["amenity"="student_accommodation"]'),
    wrap('nwr["tourism"="hostel"]'),
    wrap('nwr["name"~"' + nameRe + '",i]'),
    /* "Hall" 单独一条：这条最容易超时，放最后 */
    wrap('nwr["name"~"Hall",i]')
  ];
}

/* ---------- 名字处理 ---------- */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;

function names(tags) {
  const zh = tags["name:zh"] || tags["name:zh-Hant"] || tags["name:zh-Hans"] || "";
  const en = tags["name:en"] || "";
  const main = tags.name || "";
  /* alt_name 里也常有有用的写法，比如五旬節會樓的「五高」「五低」 */
  const alt = [
    tags["alt_name"], tags["alt_name:zh"], tags["alt_name:en"],
    tags["short_name"], tags["loc_name"], tags["old_name"]
  ].filter((v) => v && v !== main);
  return { zh, en, main, alt };
}

/* ---------- 筛 ---------- */

/*
 * 手工补录。
 *
 * 有些宿舍在 OSM 里查得到，但标签不是 building=dormitory、名字也没被上面那串
 * 关键词捞进来——典型的就是"书院本身就是宿舍"这种（晨興書院、伍宜孫書院）。
 * 这类只能点名补，坐标和对象号都从 OSM 取（查法：用 Nominatim 按名字搜，
 * 取 building 那个对象，别取同一处的 amenity=college 面，两者差几十米）。
 *
 * 加这里之前先确认：用 Nominatim 或 Overpass 能在 OSM 上查到这栋楼。
 * 自己编坐标比"没有这条"更糟。
 */
const MANUAL = [
  {
    osm: "way/230185998",
    name: "Morningside College",
    nameZh: "晨興書院",
    nameEn: "Morningside College",
    alias: ["晨興書院 Morningside College"],
    lat: 22.419081,
    lng: 114.210516,
    kind: "college"
  },
  {
    osm: "way/194547401",
    name: "Wu Yee Sun College",
    nameZh: "伍宜孫書院",
    nameEn: "Wu Yee Sun College",
    alias: ["伍宜孫書院 Wu Yee Sun College"],
    lat: 22.422205,
    lng: 114.202394,
    kind: "college"
  }
];

/* 名字里出现这些词的，不管标签怎么写都不是宿舍 */
const NEVER = [
  "lecture hall", "lecture theatre", "lecture room", "seminar room", "function room",
  "exhibition hall", "art museum", "sports centre", "sports center", "swimming pool",
  "library", "gymnasium", "canteen", "restaurant", "bookstore", "bank", "clinic",
  "auditorium", "theatre", "theater", "conference", "administration", "office",
  "講堂", "演讲厅", "演講廳", "演講室", "展覽廳", "展览厅", "体育", "體育", "圖書館", "图书馆",
  "飯堂", "饭堂", "餐廳", "餐厅", "停車場", "停车场", "變電站", "变电站", "公廁", "洗手間",
  "診所", "诊所", "銀行", "银行", "書店", "书店"
];

/* 名字里出现这些词的，基本可以确定是宿舍 */
const DORM_WORDS = [
  "宿舍", "舍堂", "書院", "书院", "residence", "hostel", "dormitory",
  "學生宿舍", "学生宿舍", "研究生宿舍", "staff quarter"
];

function looksLikeDorm(el) {
  const tags = el.tags || {};
  const name = (tags.name || "").toLowerCase();
  const zh = (tags["name:zh"] || tags["name:zh-Hant"] || "").toLowerCase();
  const haystack = name + " " + zh + " " + (tags["name:en"] || "").toLowerCase();

  if ((tags.building || "") === "dormitory") return true;
  if ((tags.amenity || "") === "student_accommodation") return true;
  if ((tags.tourism || "") === "hostel") return true;

  if (NEVER.some((w) => haystack.indexOf(w.toLowerCase()) >= 0)) return false;
  if (DORM_WORDS.some((w) => haystack.indexOf(w.toLowerCase()) >= 0)) return true;

  /* 只剩 "Hall" 这一类要判断：OSM 里 xxxx Hall 是宿舍的居多，
     但已经排掉了 Lecture/Exhibition 这些，剩下的先留着，靠人工名单兜。 */
  return /\bhall\b/.test(haystack);
}

function pickCoords(el) {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center && typeof el.center.lat === "number") {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

function toDorm(el) {
  const coords = pickCoords(el);
  if (!coords) return null;
  const tags = el.tags || {};
  const n = names(tags);

  /* 英文名当主名（课表、地图上大多是英文写法），中文名单独一个字段存着，
     不是塞进别名——界面上要「英文 中文」并排显示，播报时也要念中文。 */
  const nameEn = n.en || (CJK.test(n.main) ? "" : n.main) || "";
  const nameZh = n.zh || (CJK.test(n.main) ? n.main : "") || "";
  const name = nameEn || nameZh;
  if (!name) return null;

  const alias = [];
  [n.main, n.zh, n.en].concat(n.alt).forEach((v) => {
    if (!v || v === name || v === nameZh || v === nameEn) return;
    if (alias.indexOf(v) < 0) alias.push(v);
  });

  return {
    osm: el.type + "/" + el.id,
    name: name,
    nameZh: nameZh,
    nameEn: nameEn,
    alias: alias,
    lat: Number(coords.lat.toFixed(6)),
    lng: Number(coords.lng.toFixed(6)),
    kind: tags.building || tags.amenity || tags.tourism || tags.residential || "",
    /* 书院名，用来分组显示 */
    college: tags["addr:city"] || ""
  };
}

/* ---------- 主流程 ---------- */

const args = process.argv.slice(2);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function askOne(query) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Olympic-Protocol/1.0 (CUHK campus timetable demo)"
        },
        body: "data=" + encodeURIComponent(query)
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      lastError = err;
      console.log("  第 " + (attempt + 1) + " 次失败（" + err.message + "），换节点重试…");
      await sleep(2500);
    }
  }
  throw lastError;
}

async function fetchRaw() {
  const queries = buildQueries();
  const merged = { elements: [] };

  for (let i = 0; i < queries.length; i++) {
    console.log("查第 " + (i + 1) + "/" + queries.length + " 条…");
    const json = await askOne(queries[i]);
    merged.elements = merged.elements.concat(json.elements || []);
    await sleep(600);
  }

  fs.writeFileSync(RAW, JSON.stringify(merged, null, 1), "utf8");
  console.log("共抓到 " + merged.elements.length + " 条原始记录 → " + path.relative(root, RAW));
  return merged;
}

function readRaw() {
  if (!fs.existsSync(RAW)) {
    console.error("还没有 " + path.relative(root, RAW) + "，先跑一次：node tools/make-dorms.js --fetch");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(RAW, "utf8"));
}

function label(el) {
  const t = el.tags || {};
  const bits = [
    t.name || "(无名)",
    t["name:en"] ? "en:" + t["name:en"] : "",
    t["name:zh"] ? "zh:" + t["name:zh"] : "",
    t.building ? "building=" + t.building : "",
    t.amenity ? "amenity=" + t.amenity : "",
    t.tourism ? "tourism=" + t.tourism : ""
  ].filter(Boolean);
  return bits.join("  |  ");
}

(async function main() {
  if (args.indexOf("--fetch") >= 0) {
    await fetchRaw();
  }

  const json = readRaw();
  const elements = (json.elements || []).filter((el) => el.tags && el.tags.name);

  if (args.indexOf("--list") >= 0) {
    const keep = [];
    const drop = [];
    elements.forEach((el) => (looksLikeDorm(el) ? keep : drop).push(el));
    console.log("\n=== 留下（" + keep.length + "） ===");
    keep.forEach((el) => console.log("  " + label(el)));
    console.log("\n=== 丢掉（" + drop.length + "） ===");
    drop.forEach((el) => console.log("  " + label(el)));
    return;
  }

  const dorms = elements.filter(looksLikeDorm).map(toDorm).filter(Boolean)
    .concat(MANUAL);

  /* 同一栋楼在 OSM 里常常既是 node 又是 way，坐标差几米——
     按名字去重，保留先遇到的 */
  const seen = {};
  const unique = [];
  dorms.forEach((d) => {
    const key = d.name.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    unique.push(d);
  });
  unique.sort((a, b) => a.name.localeCompare(b.name));

  const version = 2;
  const withZh = unique.filter((d) => d.nameZh).length;
  const body = [
    "/* Olympic Protocol — 默认宿舍数据",
    " *",
    " * 数据来自 OpenStreetMap（Overpass API），按关键词搜出来的：",
    " *   宿舍 / 舍堂 / 書院 / Hostel / Residence / Dormitory / Hall",
    " *   以及 building=dormitory、amenity=student_accommodation、tourism=hostel",
    " * 共 " + unique.length + " 处（其中 " + withZh + " 处有中文名），",
    " * 另有 " + MANUAL.length + " 处是手工补录的（书院本身就是宿舍，" +
      "标签不是 dormitory，关键词也捞不到）：",
    MANUAL.map((d) => " *   " + d.nameZh + " " + d.name + "  " + d.osm).join("\n"),
    " * 可能有缺漏或误判——发现不对就自己在页面上补一条。",
    " *",
    " * 每条两个名字：name 是英文（课表和地图上的写法），nameZh 是中文名。",
    " * 两个都要留着：列表和路线卡片「英文 中文」并排显示，中文名也是搜索和播报用的。",
    " *",
    " * 不要手改这个文件，它由下面的命令生成：",
    " *     node tools/make-dorms.js --fetch && node tools/make-dorms.js",
    " */",
    "",
    "window.OP = window.OP || {};",
    "",
    "window.OP.DEFAULT_DORMS = {",
    "  version: " + version + ",",
    "  source: \"OpenStreetMap (Overpass API)\",",
    "  dorms: [",
    unique.map((d) =>
      "    { id: " + JSON.stringify(d.osm.replace("/", "-")) +
      ", name: " + JSON.stringify(d.name) +
      ", nameZh: " + JSON.stringify(d.nameZh || "") +
      ", nameEn: " + JSON.stringify(d.nameEn || "") +
      ", alias: " + JSON.stringify(d.alias) +
      ", lat: " + d.lat + ", lng: " + d.lng +
      ", kind: " + JSON.stringify(d.kind) + " }").join(",\n"),
    "  ]",
    "};",
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, body, "utf8");

  console.log("\n共 " + unique.length + " 处宿舍（" + withZh + " 处有中文名）→ " +
    path.relative(root, OUT));
  if (withZh < unique.length) {
    console.log("没有中文名的：" + unique.filter((d) => !d.nameZh).map((d) => d.name).join("、"));
  }
  unique.forEach((d) => console.log(
    "  " + d.name.padEnd(44, " ") + (d.nameZh || "（无中文名）").padEnd(22, " ") +
    d.lat + ", " + d.lng));
})();
