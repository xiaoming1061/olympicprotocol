/* 生成校巴数据文件 data/shuttle.js
 *
 * 用法：
 *   node tools/make-shuttle.js
 *
 * 输入两个文件：
 *   tools/shuttle-source.json  路线与站序（来自交通处路线图 PDF + 官网路线页）
 *   tools/osm-stops.json       OpenStreetMap 巴士站快照（只取坐标用）
 *
 * 为什么站序不能从 OSM 拿：用户明确要求"只从 OSM 读位置"，路线本身以
 * 交通处的资料为准。OSM 上的车站节点带中文名和站号，拿来配坐标正合适。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = JSON.parse(fs.readFileSync(path.join(__dirname, "shuttle-source.json"), "utf8"));
const osm = JSON.parse(fs.readFileSync(path.join(__dirname, "osm-stops.json"), "utf8"));
/* 车站海拔：和页面「获取海拔」用的是同一个接口（Open-Meteo），
   查一次存下来，生成时不再联网 */
const elevations = JSON.parse(fs.readFileSync(path.join(__dirname, "stop-elevations.json"), "utf8"));

/* 站名对齐用的归一化：全角括号、CJK 兼容字、"／"都要统一 */
function normName(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/⼀/g, "一")
    .replace(/／/g, "/")
    .replace(/\s+/g, "");
}

/* 官网/图上写法和 OSM 写法不一致的，在这里对上 */
const ALIAS = {
  "大學站廣場": "港鐵大學站廣場",
  "康本園": "康本國際學術園",
  "研究生宿舍一座": "研究生宿舍⼀座"
};

function nameVariants(name) {
  const base = ALIAS[name] || name;
  const out = [normName(base)];
  const bare = base.replace(/[（(](上行|下行)[)）]$/, "");
  if (bare !== base) out.push(normName(bare));
  return out;
}

/* 按名字建立 OSM 索引（同 id 只算一次） */
const osmById = new Map();
osm.elements.forEach((el) => { if (!osmById.has(el.id)) osmById.set(el.id, el); });

const osmIndex = new Map();
osmById.forEach((el) => {
  const tags = el.tags || {};
  const names = new Set();
  ["name:zh", "name:zh-Hant"].forEach((key) => { if (tags[key]) names.add(tags[key]); });
  if (tags.name) {
    names.add(/[A-Za-z]/.test(tags.name) ? tags.name.split(" ")[0] : tags.name);
  }
  names.forEach((nm) => {
    const key = normName(nm);
    if (!osmIndex.has(key)) osmIndex.set(key, []);
    osmIndex.get(key).push(el);
  });
});

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/* 同一个站名可能对应 OSM 上好几个站点（同一条路的两个方向等），取中位数位置 */
function locate(name) {
  /* 指定的节点优先：有些站（比如大學站）在 OSM 上有一堆站亭节点，
     取中位数会落在中间，不如直接钉住某一个 */
  const override = (source.meta.stopOverrides || {})[name];
  if (override && override.osm) {
    const el = osmById.get(override.osm);
    if (el) {
      const tags = el.tags || {};
      return {
        lat: Number(el.lat.toFixed(6)),
        lng: Number(el.lon.toFixed(6)),
        en: tags["name:en"] || "",
        osm: [el.id],
        candidates: 1
      };
    }
  }

  const keys = nameVariants(name);
  for (const key of keys) {
    const hits = osmIndex.get(key);
    if (!hits || !hits.length) continue;
    const uniq = Array.from(new Map(hits.map((el) => [el.id, el])).values());
    const en = uniq.map((el) => (el.tags || {})["name:en"]).filter(Boolean)[0] || "";
    const refs = uniq.map((el) => (el.tags || {}).ref).filter(Boolean);
    return {
      lat: Number(median(uniq.map((el) => el.lat)).toFixed(6)),
      lng: Number(median(uniq.map((el) => el.lon)).toFixed(6)),
      en: en,
      osm: uniq.map((el) => el.id).slice(0, 6),
      candidates: uniq.length
    };
  }
  return null;
}

const stops = {};
const missing = [];
const multi = [];

/* 直接用站名当键：上行/下行是地图上的两个不同站位，不能合并成一个 id，
   否则路线里"39區（上行）→…→39區（下行）"这种来回就丢信息了。 */
source.routes.forEach((route) => {
  route.stops.forEach((entry) => {
    const name = entry.name;
    if (stops[name]) return;
    const hit = locate(name);
    if (!hit) {
      missing.push(name);
      stops[name] = { zh: name, en: "", lat: null, lng: null, osm: [] };
      return;
    }
    if (hit.candidates > 1) multi.push(name + "(" + hit.candidates + ")");
    stops[name] = {
      zh: name, en: hit.en, lat: hit.lat, lng: hit.lng,
      elevation: typeof elevations[name] === "number" ? elevations[name] : null,
      osm: hit.osm
    };
  });
});

const stopLines = Object.keys(stops).sort().map((name) => {
  const s = stops[name];
  return "    " + JSON.stringify(name) + ": { zh: " + JSON.stringify(s.zh) +
    ", en: " + JSON.stringify(s.en) +
    ", lat: " + (s.lat === null ? "null" : s.lat) +
    ", lng: " + (s.lng === null ? "null" : s.lng) +
    ", elevation: " + (s.elevation === null ? "null" : s.elevation) +
    ", osm: [" + s.osm.join(", ") + "] }";
});

const routeLines = source.routes.map((route) => {
  const stopsJs = route.stops.map((entry) => {
    const id = JSON.stringify(entry.name);
    return entry.note ? '{ id: ' + id + ', note: ' + JSON.stringify(entry.note) + " }" : id;
  });
  return [
    "    {",
    "      id: " + JSON.stringify(route.id) + ",",
    "      no: " + JSON.stringify(route.no) + ",",
    "      nameZh: " + JSON.stringify(route.nameZh) + ",",
    "      nameEn: " + JSON.stringify(route.nameEn) + ",",
    "      group: " + JSON.stringify(route.group) + ",",
    "      days: " + JSON.stringify(route.days) + ",",
    "      sessions: [",
    route.sessions.map((s) => "        { days: " + JSON.stringify(s.days) +
      ", from: " + JSON.stringify(s.from) + ", to: " + JSON.stringify(s.to) + " }").join(",\n"),
    "      ],",
    route.serviceNote ? "      serviceNote: " + JSON.stringify(route.serviceNote) + "," : "",
    "      everyHour: [" + route.everyHour.join(", ") + "],",
    /* 环线 = 起点和终点是同一个站（官网上起终点标记在同一处） */
    "      loop: " + (route.stops.length > 1 &&
      route.stops[0].name === route.stops[route.stops.length - 1].name ? "true" : "false") + ",",
    "      stops: [",
    stopsJs.map((s) => "        " + s).join(",\n"),
    "      ]",
    "    }"
  ].filter(Boolean).join("\n");
});

const output = `/* Olympic Protocol — 校巴数据（自动生成，不要手改）
 *
 * 由 tools/make-shuttle.js 生成。改内容请改 tools/shuttle-source.json 再重新生成：
 *     node tools/make-shuttle.js
 *
 * 路线、服务时间、站序：香港中文大学交通处路线图（穿梭/晚间及假日/转堂校巴）
 *   以及交通处官网路线页 https://transport.cuhk.edu.hk/tc/route/<路线>/
 * 站点坐标：OpenStreetMap（© OpenStreetMap 贡献者，ODbL）
 *   只取位置，路线本身以交通处资料为准。
 *
 * 站序约定（官网站序图的画法）：左列自下而上，右列自上而下，
 * 起点在左下、终点在右下——"起点 → 左列倒序 → 右列正序 → 终点"。
 * 生成时间：${new Date().toISOString().slice(0, 10)}
 */

"use strict";
window.OP = window.OP || {};

/* 一个站名在 OSM 上可能对应多个站点节点（同一条路两个方向等），
   这里取它们位置的中位数；osm 数组列出用到的节点 id。 */
window.OP.SHUTTLE_STOPS = {
${stopLines.join(",\n")}
};

window.OP.SHUTTLE_ROUTES = [
${routeLines.join(",\n")}
];

/* 附件里没有、暂时不做的：收费穿梭小巴（up / down）没有收录 */
window.OP.SHUTTLE_META = {
  stopCount: ${Object.keys(stops).length},
  routeCount: ${source.routes.length},
  source: ${JSON.stringify(source.meta.source)},
  missingStops: ${JSON.stringify(missing)}
};
`;

fs.writeFileSync(path.join(root, "data", "shuttle.js"), output, "utf8");

console.log("已写入 data/shuttle.js");
console.log("  路线 " + source.routes.length + " 条，站点 " + Object.keys(stops).length + " 个");
if (missing.length) console.log("  ⚠ 没有 OSM 坐标的站：" + missing.join("、"));
if (multi.length) console.log("  · OSM 上有多个节点的站（取中位数）：" + multi.join("、"));
const noElev = Object.keys(stops).filter((n) => stops[n].elevation === null);
if (noElev.length) console.log("  ⚠ 没有海拔的站：" + noElev.join("、"));
else console.log("  海拔：" + Object.keys(stops).length + " 个站都有");
