/* 自检脚本：不开浏览器，直接验证课表、距离、坐标转换和路线计算的正确性
 *
 * 运行方式：  node tools/selftest.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

/* 用最小的替身把浏览器环境补齐，才能直接加载这几个模块 */
global.window = global;
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};

["data/buildings.js", "data/dorms.js", "data/shuttle.js", "data/holidays.js", "data/defaults.js", "js/store.js", "js/zh.js", "js/dorm.js", "js/geo.js", "js/shuttle.js",
  "js/elevation.js", "js/speech.js",
  "js/planner.js", "js/map.js", "js/realmaps.js", "js/places.js", "js/ocr.js", "js/timetable.js",
  "js/exportimage.js"]
  .forEach((file) => {
    const code = fs.readFileSync(path.join(root, file), "utf8");
    // eslint-disable-next-line no-eval
    eval(code);
  });

const OP = global.OP;
const P = OP.Planner;
const Geo = OP.Geo;

/* 算例自带一套固定数据。
   页面的默认楼栋已经换成真实校区数据（data/buildings.js，241 栋），
   不适合拿来当"已知答案"的算例——名字和数量一变，几十个用例都得跟着改。
   所以课表、距离、播报这些用例统一用下面这套小数据。 */
const FIXTURE = {
  version: 1,
  campus: {
    name: "测试校区",
    buildings: [
      { id: "A", name: "第一教学楼", alias: ["一教", "A楼", "教一"], lat: 31.2320, lng: 121.4710 },
      { id: "B", name: "第二教学楼", alias: ["二教", "B楼", "教二"], lat: 31.2315, lng: 121.4760 },
      { id: "C", name: "实验楼", alias: ["C楼", "机房"], lat: 31.2290, lng: 121.4745 },
      { id: "D", name: "图书馆", alias: ["馆"], lat: 31.2298, lng: 121.4700 },
      { id: "E", name: "体育馆", alias: ["操场", "体育场"], lat: 31.2268, lng: 121.4762 },
      { id: "F", name: "学生食堂", alias: ["食堂", "饭堂"], lat: 31.2302, lng: 121.4788 },
      { id: "G", name: "宿舍区", alias: ["宿舍", "寝室"], lat: 31.2338, lng: 121.4752 },
      { id: "H", name: "音乐厅", alias: ["礼堂"], lat: 31.2278, lng: 121.4712 }
    ]
  },
  courses: [
    { id: "c1", name: "高等数学", teacher: "张老师", buildingId: "A", room: "A301", weekdays: [1, 3], start: "08:00", end: "09:40", weeks: [1, 16] },
    { id: "c2", name: "线性代数", teacher: "孙老师", buildingId: "A", room: "A208", weekdays: [1], start: "14:00", end: "15:40", weeks: [1, 16] },
    { id: "c3", name: "大学英语", teacher: "李老师", buildingId: "B", room: "B205", weekdays: [1, 4], start: "10:00", end: "11:40", weeks: [1, 16] },
    { id: "c4", name: "数据结构", teacher: "王老师", buildingId: "C", room: "C401", weekdays: [2, 5], start: "08:00", end: "09:40", weeks: [1, 16] },
    { id: "c5", name: "大学物理", teacher: "陈老师", buildingId: "A", room: "A102", weekdays: [2], start: "14:00", end: "15:40", weeks: [1, 16] },
    { id: "c6", name: "概率论", teacher: "吴老师", buildingId: "A", room: "A305", weekdays: [3], start: "10:00", end: "11:40", weeks: [1, 16] },
    { id: "c7", name: "体育（羽毛球）", teacher: "刘老师", buildingId: "E", room: "主馆", weekdays: [3], start: "16:00", end: "17:30", weeks: [1, 16] },
    { id: "c8", name: "算法实验", teacher: "王老师", buildingId: "C", room: "C501", weekdays: [4], start: "08:00", end: "09:40", weeks: [1, 16] },
    { id: "c9", name: "音乐鉴赏", teacher: "周老师", buildingId: "H", room: "音乐厅", weekdays: [4], start: "14:00", end: "15:40", weeks: [1, 16] },
    { id: "c10", name: "软件工程", teacher: "赵老师", buildingId: "C", room: "C302", weekdays: [5], start: "14:00", end: "15:40", weeks: [1, 16] }
  ],
  settings: OP.Store.defaults().settings
};

function demo() {
  return JSON.parse(JSON.stringify(FIXTURE));
}

const data = demo();

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (detail !== undefined ? "  → " + detail : ""));
  }
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

console.log("\n[1] 时间与星期");
// 2026-09-28 是星期一
check("2026-09-28 判定为星期一", P.isoDow(new Date(2026, 8, 28)) === 1, P.isoDow(new Date(2026, 8, 28)));
check("2026-09-27 判定为星期日", P.isoDow(new Date(2026, 8, 27)) === 7, P.isoDow(new Date(2026, 8, 27)));
check("08:00 → 480 分钟", P.hm("08:00") === 480);
check("470 → 07:50", P.fmtHM(470) === "07:50", P.fmtHM(470));
check("14:00 读作「下午2 点整」", P.cnTime("14:00") === "下午2 点整", P.cnTime("14:00"));
/* 学期 9/1 开学，第 1 周是 9/1–9/7，所以 9/28 落在第 4 周 */
check("教学周计算（9/28 是第 4 周）", P.weekNumber(new Date(2026, 8, 28), "2026-09-01") === 4,
  P.weekNumber(new Date(2026, 8, 28), "2026-09-01"));

console.log("\n[2] 距离与坐标转换");
const dLat = Geo.haversine({ lat: 31.2304, lng: 121.4737 }, { lat: 31.2314, lng: 121.4737 });
check("0.001 度纬度 ≈ 111 米", near(dLat, 110.5, 2), dLat.toFixed(1) + " 米");

const dLng = Geo.haversine({ lat: 31.2304, lng: 121.4737 }, { lat: 31.2304, lng: 121.4747 });
check("0.001 度经度 ≈ 95 米（北纬 31 度）", near(dLng, 95, 3), dLng.toFixed(1) + " 米");

const gcj = Geo.wgs84ToGcj02(31.2304, 121.4737);
const offset = Geo.haversine({ lat: 31.2304, lng: 121.4737 }, { lat: gcj.lat, lng: gcj.lng });
check("火星坐标偏移在国内落在 100–800 米区间", offset > 100 && offset < 800, offset.toFixed(0) + " 米");

const bd = Geo.gcj02ToBd09(gcj.lat, gcj.lng);
check("百度坐标偏移继续增加", Geo.haversine(gcj, bd) > 100, Geo.haversine(gcj, bd).toFixed(0) + " 米");

check("距离格式化：320 米", Geo.formatDistance(318) === "320 米", Geo.formatDistance(318));
check("距离格式化：1.4 公里", Geo.formatDistance(1420) === "1.4 公里", Geo.formatDistance(1420));
check("时长格式化：5 分钟", Geo.formatDuration(5.2) === "5 分钟", Geo.formatDuration(5.2));

console.log("\n[3] 今日课程与下一节课");
const monday = new Date(2026, 8, 28, 7, 0, 0);
const mondayCourses = P.todayCourses(data, monday);
check("周一有 3 节课", mondayCourses.length === 3, mondayCourses.map((c) => c.name).join("/"));
check("按开始时间排序", mondayCourses[0].name === "高等数学" && mondayCourses[2].name === "线性代数",
  mondayCourses.map((c) => c.name).join("/"));

const sunday = new Date(2026, 8, 27, 10, 0, 0);
check("周日没有课", P.todayCourses(data, sunday).length === 0);

const atNine = P.nextCourse(data, new Date(2026, 8, 28, 9, 0, 0));
check("09:00 时正在上的课被识别为正在进行",
  atNine && atNine.course.name === "高等数学" && atNine.status === "ongoing", atNine && atNine.status);

const atTen = P.nextCourse(data, new Date(2026, 8, 28, 10, 30, 0));
check("10:30 时下一节是大学英语", atTen && atTen.course.name === "大学英语", atTen && atTen.course.name);

const atEvening = P.nextCourse(data, new Date(2026, 8, 28, 20, 0, 0));
check("晚上没有下一节课", atEvening === null);

console.log("\n[4] 步行与出发时间");
const buildingA = P.buildingById(data, "A");
const metric = P.walkMetrics({ lat: 31.2300, lng: 121.4710 }, buildingA, data.settings);
check("步行时间 = 折算距离 / 速度",
  near(metric.minutes, metric.distance / data.settings.walkingSpeed, 0.01),
  metric.minutes.toFixed(2) + " 分钟");
check("折算距离大于直线距离", metric.distance > metric.straight,
  metric.straight.toFixed(0) + " → " + metric.distance.toFixed(0) + " 米");

const legs = P.buildLegs(data, { lat: 31.2300, lng: 121.4710 }, monday);
check("周一生成了 3 段行程", legs.length === 3, legs.length);
check("第一段的起点是「我的位置」", legs[0].fromName === "我的位置", legs[0].fromName);
check("第二段的起点是上一节课的楼栋", legs[1].fromName === buildingA.name, legs[1].fromName);

const first = legs[0];
const expectedDepart = P.hm("08:00") - first.metrics.minutes - data.settings.bufferMinutes;
check("第一段的出发时间不含上一节课限制",
  near(P.hm(P.fmtHM(expectedDepart)), P.hm(P.fmtHM(expectedDepart)), 0.001) &&
  first.departAt.getTime() >= monday.getTime(),
  P.fmtHM(expectedDepart));

/* 第三段是 14:00 的线性代数，必须先等 11:40 的大学英语下课 */
const third = legs[2];
check("第三段出发时间不早于上一节课下课（11:40）",
  (third.departAt.getHours() * 60 + third.departAt.getMinutes()) >= P.hm("11:40"),
  third.departAt.getHours() + ":" + third.departAt.getMinutes());
check("第三段在课间空档里出发（12:00–14:00）",
  (third.departAt.getHours() * 60 + third.departAt.getMinutes()) >= P.hm("12:00"),
  third.departAt.getHours() + ":" + third.departAt.getMinutes());

/* 09:30 时高等数学已经在上课了，导航不该再让你赶过去 */
const midClass = P.buildLegs(data, null, new Date(2026, 8, 28, 9, 30, 0));
check("09:30 时仍在进行中的课被标为 ongoing",
  midClass[0].status === "ongoing", midClass[0].status);
const midRoute = P.routeLegs(data, null, new Date(2026, 8, 28, 9, 30, 0));
check("路线链排除了正在上的课", midRoute.length === 2, midRoute.length);
check("没有定位时第一段没有距离（起点不明）", midClass[0].metrics === null);
check("没有定位时后续段按上一节课的楼栋估算",
  midRoute[0].metrics !== null && midRoute[0].metrics.distance > 0,
  midRoute[0].metrics && midRoute[0].metrics.distance.toFixed(0) + " 米");
check("没有定位时也能算出出发时间",
  midRoute[0].departAt instanceof Date, String(midRoute[0].departAt));

console.log("\n[5] 播报文案");
const brief = P.briefingText(data, monday, { lat: 31.2300, lng: 121.4710 });
check("课表播报包含课程名", brief.indexOf("高等数学") >= 0);
check("课表播报包含节次", brief.indexOf("第 1 节") >= 0);
check("课表播报包含步行建议", brief.indexOf("步行约") >= 0);
check("课表播报以句号收尾", brief.slice(-1) === "。", brief.slice(-12));

const noClass = P.briefingText(data, sunday, null);
check("无课时播报给出休息提示", noClass.indexOf("今天没有安排课程") >= 0, noClass);

const nextLine = P.nextText(data, monday, { lat: 31.2300, lng: 121.4710 });
check("下一节播报包含课程名", nextLine.indexOf("高等数学") >= 0);
check("下一节播报包含地点", nextLine.indexOf(buildingA.name) >= 0);

const leaveLine = P.leaveText(legs[0], new Date(2026, 8, 28, 7, 40, 0));
check("出发提醒以「该出发了」开头", leaveLine.indexOf("该出发了") === 0, leaveLine.slice(0, 8));

console.log("\n[6] 导航链接");
const links = Geo.navLinks("第一教学楼", 31.2320, 121.4710);
check("提供 5 个地图入口", links.length === 5, links.map((l) => l.label).join("/"));
check("高德使用火星坐标", links[0].url.indexOf("coordinate=gaode") > 0);
check("百度使用 BD-09 坐标", links[1].url.indexOf("api.map.baidu.com") > 0);
check("Google 地图用步行路线链接",
  links[2].url.indexOf("google.com/maps/dir") > 0 &&
  links[2].url.indexOf("travelmode=walking") > 0, links[2].url);
check("Google 用标准 WGS-84 坐标，不做火星坐标转换",
  links[2].url.indexOf("destination=31.232000,121.471000") > 0, links[2].url);
check("苹果地图使用步行模式", links[3].url.indexOf("dirflg=w") > 0);
check("链接里的中文已编码", links[0].url.indexOf("%E7%AC%AC") > 0);

/* 唤起 App 的关键：用 https 通用链接（universal link）。
   装了 App 系统就直接交给 App，没装才退回网页——比自定义 scheme 稳，
   自定义 scheme 在没装 App 时是死链，Safari 还会弹一次确认框。 */
check("地图跳转用的是 https 通用链接（装了 App 会直接唤起 App）",
  links[0].url.indexOf("https://") === 0 &&
  links[1].url.indexOf("https://") === 0 &&
  links[2].url.indexOf("https://") === 0 &&
  links[3].url.indexOf("https://") === 0);

/* 第 5 个原来是 geo: 协议——那是安卓的标准，iOS 根本不认，
   在 iPhone 上点了没反应。改成复制坐标，两端都能用。 */
check("第 5 个是「复制坐标」而不是失效的 geo: 链接",
  links[4].label === "复制坐标" && !links[4].url && !!links[4].copy,
  JSON.stringify(links[4]));
check("复制的是「纬度, 经度」格式",
  links[4].copy === "31.232000, 121.471000", links[4].copy);
check("代码里不再使用 geo: 协议（iOS 不支持）",
  Geo.navLinks("x", 31.23, 121.47).every(function (l) {
    return !l.url || l.url.indexOf("geo:") !== 0;
  }));

console.log("\n[7] 地图渲染");
const fakeSvg = { innerHTML: "" };
OP.MapView.render(fakeSvg, {
  buildings: data.campus.buildings,
  position: { lat: 31.2300, lng: 121.4710 },
  stops: legs.map((leg, i) => ({
    building: leg.building,
    order: i + 1,
    time: leg.course.start,
    isNext: i === 0
  })),
  detourFactor: data.settings.detourFactor
});
check("生成了 SVG 内容", fakeSvg.innerHTML.length > 200, fakeSvg.innerHTML.length + " 字符");
check("包含我的位置标记", fakeSvg.innerHTML.indexOf("我的位置") >= 0);
/* 用户要求：地点之间那条"行程链"不再画，改画"我去车站 / 车站去教室" */
check("不再画地点之间的行程链", fakeSvg.innerHTML.indexOf("route-line") === -1 &&
  fakeSvg.innerHTML.indexOf("dist-label") === -1);
const linkSvg = { innerHTML: "" };
OP.MapView.render(linkSvg, {
  buildings: data.campus.buildings,
  position: { lat: 31.2300, lng: 121.4710 },
  stops: legs.map((leg, i) => ({
    building: leg.building, order: i + 1, time: leg.course.start, isNext: i === 0
  })),
  busStops: [{ id: "A", stop: data.campus.buildings[0], roles: { board: true } }],
  busLinks: [{ from: { lat: 31.2300, lng: 121.4710 }, to: data.campus.buildings[0] }]
});
check("画的是「我的位置 → 车站」这条连线", linkSvg.innerHTML.indexOf('class="bus-link"') > 0);
check("车站也画在图上", linkSvg.innerHTML.indexOf('class="bus-stop"') > 0 &&
  linkSvg.innerHTML.indexOf(data.campus.buildings[0].name) > 0);

/* 地图重点：今天要去的楼栋写名字，其余的只当背景 */
const todayBuildings = legs.map((leg) => leg.building);
const otherBuildings = data.campus.buildings.filter(
  (b) => todayBuildings.indexOf(b) === -1);

check("今天要去的楼栋都标了名字",
  todayBuildings.every((b) => fakeSvg.innerHTML.indexOf(b.name) >= 0),
  todayBuildings.map((b) => b.name).join(" / "));
check("地图上只出现今天要去的楼栋",
  otherBuildings.every((b) => fakeSvg.innerHTML.indexOf(b.name) === -1),
  otherBuildings.filter((b) => fakeSvg.innerHTML.indexOf(b.name) >= 0).map((b) => b.name).join(" / "));
check("其余楼栋连暗点都不画",
  (fakeSvg.innerHTML.match(/bld-ghost/g) || []).length === 0,
  (fakeSvg.innerHTML.match(/<circle/g) || []).length + " 个圆圈");
const bldRadii = Array.from(fakeSvg.innerHTML.matchAll(/<circle class="bld[^"]*"[^>]*r="(\d+)"/g))
  .map((m) => m[1]);
check("简图的楼栋圈够大（下一节 18、其余 15）",
  bldRadii.indexOf("18") >= 0 && bldRadii.indexOf("15") >= 0 &&
  bldRadii.every((r) => r === "15" || r === "18"),
  bldRadii.join(" "));
check("我的位置标记也跟着放大",
  /class="me-ring"[^>]*r="13"/.test(fakeSvg.innerHTML) &&
  /class="me-dot"[^>]*r="10"/.test(fakeSvg.innerHTML),
  (fakeSvg.innerHTML.match(/me-(?:ring|dot)[^>]*r="\d+"/g) || []).join(" | "));

/*
 * 踩过的坑：Leaflet 内部把图层面板设成 z-index 400、控件 1000，
 * 而地图容器自己没有层叠上下文，于是这两个值直接跟整页比高低——
 * 路线页往下滑，地图就盖在顶栏「Olympic Protocol」和底部导航上面。
 * 给容器加 position/z-index/isolation 之后，Leaflet 的层级只在自己这块地盘里算。
 */
const mapCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const mapWrapRule = (/\.map-wrap\s*\{([^}]*)\}/.exec(mapCss) || [null, ""])[1];
check("地图容器建了自己的层叠上下文",
  /position:\s*relative/.test(mapWrapRule) &&
  /z-index:\s*0/.test(mapWrapRule) &&
  /isolation:\s*isolate/.test(mapWrapRule),
  mapWrapRule.replace(/\s+/g, " ").trim());
const topbarZ = Number((/\.topbar\s*\{[^}]*z-index:\s*(\d+)/.exec(mapCss) || [])[1]);
const tabbarZ = Number((/\.tabbar\s*\{[^}]*z-index:\s*(\d+)/.exec(mapCss) || [])[1]);
check("顶栏和底部导航都压在地图容器之上",
  topbarZ > 0 && tabbarZ > topbarZ,
  "topbar=" + topbarZ + " tabbar=" + tabbarZ + " map-wrap=0");
check("下一节课有专门的标记",
  fakeSvg.innerHTML.indexOf("is-next") > 0 && fakeSvg.innerHTML.indexOf("下一节") > 0);
check("今天要去的楼栋带编号和时间",
  fakeSvg.innerHTML.indexOf("bld-order") > 0 && fakeSvg.innerHTML.indexOf("bld-time") > 0);
check("第一栋的编号是 1", fakeSvg.innerHTML.indexOf('class="bld-order is-next"') > 0);

/* 没定位时要在图上说明，不然会以为"我的位置"坏了 */
const noPosSvg = { innerHTML: "" };
OP.MapView.render(noPosSvg, {
  buildings: data.campus.buildings,
  position: null,
  stops: [{ building: data.campus.buildings[0], order: 1, time: "08:00", isNext: true }]
});
check("没有定位时地图上会说明",
  noPosSvg.innerHTML.indexOf("打开定位后会显示你的位置") > 0);
check("没有定位时不会画我的位置标记",
  noPosSvg.innerHTML.indexOf("我的位置") === -1);

const emptySvg = { innerHTML: "" };
OP.MapView.render(emptySvg, { buildings: [], position: null, legs: [] });
check("没有楼栋时给出提示而不是报错", emptySvg.innerHTML.indexOf("还没有楼栋坐标") >= 0);

console.log("\n[8] 数据存取");
const restored = OP.Store.merge({ settings: { leadMinutes: 25 } });
check("旧存档缺字段时用默认值补齐", restored.settings.leadMinutes === 25 && restored.settings.walkingSpeed === 75);
check("默认楼栋来自 data/buildings.js，不是示例数据",
  OP.Store.defaults().campus.buildings.length === OP.DEFAULT_BUILDINGS.buildings.length &&
  OP.Store.defaults().campus.buildings.length > 100,
  OP.Store.defaults().campus.buildings.length + " 栋");
check("默认校区名跟着楼栋数据走",
  OP.Store.defaults().campus.name === OP.DEFAULT_BUILDINGS.name,
  OP.Store.defaults().campus.name);
check("课表默认是空的（课表是每个人自己的）",
  OP.Store.defaults().courses.length === 0);

console.log("\n[9] 页面结构与脚本引用");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");

const htmlIds = new Set(
  Array.from(html.matchAll(/\bid="([^"]+)"/g)).map((m) => m[1])
);

/* app.js 里所有 $("#xxx") / $$("#xxx ...") 引用 */
const idRefs = new Set(
  Array.from(appSource.matchAll(/\$\$?\(\s*"#([A-Za-z0-9_-]+)/g)).map((m) => m[1])
);

const missingIds = Array.from(idRefs).filter((id) => !htmlIds.has(id));
check("代码引用的界面元素都存在于 index.html（共 " + idRefs.size + " 个）",
  missingIds.length === 0, missingIds.join(", "));

/* app.js 不参与下面的模块加载（它要用 DOM），至少要保证能编译——
   少一个括号、中文引号写错，页面会整块白掉，而只做字符串匹配的检查看不出来 */
const appSyntaxError = (function () {
  try {
    // eslint-disable-next-line no-new-func
    new Function(appSource);
    return "";
  } catch (err) {
    return err.message;
  }
})();
check("app.js 语法正确（能编译）", appSyntaxError === "", appSyntaxError);

/* 页签按钮和视图要一一对应 */
const tabNames = new Set(Array.from(html.matchAll(/data-tab="([^"]+)"/g)).map((m) => m[1]));
const viewNames = new Set(Array.from(html.matchAll(/data-view="([^"]+)"/g)).map((m) => m[1]));
check("四个页签都有对应的视图",
  tabNames.size === 4 && viewNames.size === 4 &&
  Array.from(tabNames).every((n) => viewNames.has(n)),
  Array.from(tabNames).join("/") + " vs " + Array.from(viewNames).join("/"));

/* script / link 引用的文件要真实存在 */
const assetRefs = Array.from(html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g))
  .map((m) => m[1]);
const missingAssets = assetRefs.filter((ref) => !fs.existsSync(path.join(root, ref)));
check("script / stylesheet 引用的文件都存在", missingAssets.length === 0, missingAssets.join(", "));

/* 加载顺序：被依赖的模块必须排在使用它的模块之前 */
const order = assetRefs.filter((r) => r.endsWith(".js"));
const idx = (f) => order.findIndex((r) => r.endsWith(f));
check("模块加载顺序正确（geo → planner → places → app）",
  idx("defaults.js") < idx("store.js") &&
  idx("store.js") < idx("geo.js") &&
  idx("geo.js") < idx("planner.js") &&
  idx("planner.js") < idx("map.js") &&
  idx("map.js") < idx("places.js") &&
  idx("places.js") < idx("ocr.js") &&
  idx("ocr.js") < idx("app.js"),
  order.join(" → "));

/* ---------- 页面结构的完整性 ----------
   踩过一个很不显眼的坑：有两个视图区块被写到了 </html> 后面。
   浏览器会把文档结束之后的内容甩到 body 末尾，于是那两个页面
   既不在 .app 里也不在 .views 里，整个布局从根上是坏的——
   而"标签数量配平"这种检查根本发现不了。 */

check("</html> 之后没有多余内容",
  html.slice(html.indexOf("</html>") + 7).trim() === "",
  JSON.stringify(html.slice(html.indexOf("</html>") + 7, html.indexOf("</html>") + 60)));
check("html / body 各只有一个结束标签",
  (html.match(/<\/html>/g) || []).length === 1 &&
  (html.match(/<\/body>/g) || []).length === 1);

const mainEnd = html.indexOf("</main>");
const outsideMain = ["today", "settings", "route", "course"].filter(function (name) {
  var at = html.indexOf('data-view="' + name + '"');
  return !(at > 0 && at < mainEnd);
});
check("四个视图区块都在 <main> 里面（漏一个整页布局就塌）",
  outsideMain.length === 0, outsideMain.join(" / "));

check("导航栏在 </main> 之后，属于 .app 的末尾",
  html.indexOf('class="tabbar"') > mainEnd);
/* 认"标签"而不是"这个词"：注释里提到 js/app.js 不算（被坑过一次） */
check("外部样式表在 <head> 里，脚本在 </main> 之后",
  html.indexOf('<link rel="stylesheet" href="styles.css"') < html.indexOf("<body") &&
  html.indexOf('<script src="js/app.js"') > mainEnd);

/* 开闭数量也要配平 */
function tagCounts(source, name) {
  return [
    (source.match(new RegExp("<" + name + "\\b", "g")) || []).length,
    (source.match(new RegExp("</" + name + ">", "g")) || []).length
  ];
}
const unbalancedTags = ["div", "section", "article", "nav", "main", "label", "form"]
  .filter(function (name) {
    const c = tagCounts(html, name);
    return c[0] !== c[1];
  });
check("主要标签的开闭数量一致", unbalancedTags.length === 0,
  unbalancedTags.map(function (n) {
    const c = tagCounts(html, n);
    return n + "(" + c[0] + "/" + c[1] + ")";
  }).join(", "));

console.log("\n[10] 样式覆盖");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const requiredClasses = [
  "app", "topbar", "brand", "views", "view", "card", "hero", "stat",
  "btn", "timeline", "tl-item", "map-wrap", "route-line", "leg", "course-item",
  "field", "weekday-picker", "form-actions", "building-item", "tabbar", "tab", "toast"
];
const missingCss = requiredClasses.filter((c) => css.indexOf("." + c) === -1);
check("主要样式类都已定义（共 " + requiredClasses.length + " 个）",
  missingCss.length === 0, missingCss.join(", "));

/* app.js 里动态生成的 class 必须在 CSS 里有对应规则 */
const dynamicClasses = ["is-active", "is-next", "is-now", "is-past", "is-imminent", "nav-link", "tl-badge", "leg-warn", "empty", "count-line", "progress-text", "debug-summary"];
const missingDynamic = dynamicClasses.filter((c) => css.indexOf("." + c) === -1);
check("动态状态类都有样式", missingDynamic.length === 0, missingDynamic.join(", "));

/* hidden 属性会被作者样式里的 display 顶掉：.form{display:flex}、
   .hero-actions{display:flex}、.switch{display:inline-flex} 都会让
   hidden="hidden" 的元素照样显示出来。必须有全局兜底。 */
check("hidden 属性有全局兜底，不会被 display 顶掉",
  /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css),
  (css.match(/\[hidden\][^}]*\}/g) || []).join(" | "));

console.log("\n[11] 地图服务读取楼栋");
const Places = OP.Places;
const originPt = { lat: 31.2300, lng: 121.4710 };

check("已彻底移除高德与 Google 的来源代码",
  Places.PROVIDERS === undefined && Places.AMAP_ERRORS === undefined &&
  Places.buildAmapUrl === undefined && Places.parseAmap === undefined &&
  Places.buildGoogleRequest === undefined && Places.parseGoogle === undefined &&
  Places.detectProxy === undefined);
check("Overpass 配了备用节点", Places.ENDPOINTS.length >= 2,
  Places.ENDPOINTS.join(" / "));

/* --- OpenStreetMap --- */
const opQuery = Places.buildOverpassQuery(31.23, 121.47, 800);
check("Overpass 查询限定半径和坐标",
  opQuery.indexOf("around:800,31.230000,121.470000") > 0, opQuery.slice(0, 40));
check("Overpass 只取有名字的建筑",
  opQuery.indexOf('["building"]["name"]') > 0);

const opJson = {
  elements: [
    { type: "way", id: 1, center: { lat: 31.2325, lon: 121.4705 }, tags: { building: "university", name: "第一教学楼" } },
    { type: "way", id: 2, center: { lat: 31.2330, lon: 121.4700 }, tags: { building: "yes", name: "学生食堂" } },
    { type: "node", id: 3, lat: 31.2300, lon: 121.4710, tags: { name: "无名点" } },
    { type: "way", id: 4, center: { lat: 31.2400, lon: 121.4700 }, tags: { building: "yes", name: "很远的楼" } },
    { type: "way", id: 5, center: { lat: 31.2326, lon: 121.4706 }, tags: { building: "yes" } }
  ]
};
const opParsed = Places.parseOverpass(opJson, originPt, 800);
check("超出半径的建筑被排除", opParsed.every((x) => x.name !== "很远的楼"));
check("没有名字的建筑被跳过", opParsed.every((x) => x.name !== ""));
check("解析出 3 个有效建筑", opParsed.length === 3, opParsed.map((x) => x.name).join("/"));
check("名字像教学楼的排在最前面", opParsed[0].name === "第一教学楼", opParsed[0].name);
check("「第一教学楼」被标记为教学楼", opParsed[0].teaching === true);
check("「学生食堂」不被标记为教学楼",
  opParsed.filter((x) => x.name === "学生食堂")[0].teaching === false);
check("每个结果都带距离",
  opParsed.every((x) => typeof x.distance === "number" && x.distance <= 800));

/* ---------- 中英文名统一 ----------
   下面这几个 tag 是从 OpenStreetMap 上港中文的真实数据里取的。 */

const cuhkTags = {
  building: "university",
  name: "科學館東座 Science Centre East Block",
  "name:zh": "科學館東座",
  "name:en": "Science Centre East Block"
};
const piChiuTags = {
  building: "university",
  name: "碧秋樓 Pi Ch'iu Building",
  "name:zh": "碧秋樓",
  "name:en": "Pi Ch'iu Building"
};

check("OSM 的多个名字标记全部被收集",
  Places.collectNames(cuhkTags).length === 3,
  Places.collectNames(cuhkTags).join(" / "));

const namesEn = Places.pickNames(cuhkTags, true);
check("优先英文时主名取英文", namesEn.name === "Science Centre East Block", namesEn.name);
check("中文名进入别名", namesEn.alias.indexOf("科學館東座") >= 0, namesEn.alias.join(" / "));
check("中英拼接的那个 name 不会再重复当别名",
  namesEn.alias.indexOf("科學館東座 Science Centre East Block") === -1, namesEn.alias.join(" / "));
check("两个名字都单独保留了下来",
  namesEn.nameEn === "Science Centre East Block" && namesEn.nameZh === "科學館東座");

const namesZh = Places.pickNames(cuhkTags, false);
check("不优先英文时主名取中文", namesZh.name === "科學館東座", namesZh.name);
check("英文名进入别名", namesZh.alias.indexOf("Science Centre East Block") >= 0, namesZh.alias.join(" / "));

/* 走一遍完整的 parseOverpass */
const cuhkJson = {
  elements: [
    { type: "way", id: 1, center: { lat: 22.4196, lon: 114.2068 }, tags: cuhkTags },
    { type: "way", id: 2, center: { lat: 22.4200, lon: 114.2072 }, tags: piChiuTags }
  ]
};
const cuhkOrigin = { lat: 22.4196, lng: 114.2068 };
const cuhkParsed = Places.parseOverpass(cuhkJson, cuhkOrigin, 800, { preferEnglish: true });

check("从 OSM 解析出英文主名", cuhkParsed[0].name === "Science Centre East Block", cuhkParsed[0].name);
check("同时保留了中文别名", cuhkParsed[0].alias.indexOf("科學館東座") >= 0,
  cuhkParsed[0].alias.join(" / "));
check("主名是中文时，靠英文标记也能认出是教学楼",
  Places.parseOverpass(
    { elements: [{ type: "way", id: 9, center: { lat: 22.4196, lon: 114.2068 }, tags: cuhkTags }] },
    cuhkOrigin, 800, { preferEnglish: false }
  )[0].teaching === true);

check("用中文名筛选也能筛到（别名参与筛选）",
  Places.filterByName(cuhkParsed, "碧秋樓").length === 1,
  Places.filterByName(cuhkParsed, "碧秋樓").map((x) => x.name).join("/"));
check("用英文名筛选同样能筛到",
  Places.filterByName(cuhkParsed, "pi ch'iu").length === 1);

/* 导入成楼栋之后，课表里的英文名要能匹配上 */
const importedBuildings = cuhkParsed.map((p, i) => ({
  id: "b" + i, name: p.name, alias: p.alias, lat: p.lat, lng: p.lng
}));
check("课表里的英文楼名能按别名精确匹配",
  OP.Ocr.matchBuilding("Pi Ch'iu Building", importedBuildings).id === "b1");
check("课表里的英文楼名能做模糊匹配",
  OP.Ocr.matchBuilding("Science Centre", importedBuildings) !== null,
  JSON.stringify(OP.Ocr.matchBuilding("Science Centre", importedBuildings)));
check("中文课表也能匹配上（别名里有中文）",
  OP.Ocr.matchBuilding("碧秋樓", importedBuildings).id === "b1");

/* 已经录过的楼栋，别名相同也算重复 */
const aliasDedup = Places.splitDuplicates(cuhkParsed, [
  { name: "科學館東座", alias: ["Science Centre East Block"], lat: 22.4196, lng: 114.2068 }
], 25);
check("别名相同也算已经录过，不会重复导入",
  aliasDedup.fresh.every((x) => x.name !== "Science Centre East Block"), aliasDedup.duplicated);

/* 只导入过中文名的老数据，可以一键把英文名补进别名 */
const oldBuilding = { id: "old", name: "科學館東座", alias: [], lat: 22.4196, lng: 114.2068 };
check("能认出这就是已有的那栋楼",
  Places.findExisting(cuhkParsed[0], [oldBuilding], 25) === oldBuilding);

const added = Places.mergeAliases(cuhkParsed[0], oldBuilding);
check("英文名被补进了别名", added === 1 && oldBuilding.alias.indexOf("Science Centre East Block") >= 0,
  added + " 个: " + oldBuilding.alias.join(" / "));
check("补充之后课表里的英文名就能匹配上了",
  OP.Ocr.matchBuilding("Science Centre East Block", [oldBuilding]) !== null);
check("重复补充不会产生重复的名字",
  Places.mergeAliases(cuhkParsed[0], oldBuilding) === 0 && oldBuilding.alias.length === 1,
  oldBuilding.alias.join(" / "));
check("楼栋显示名不会被改掉", oldBuilding.name === "科學館東座");

/* --- 去重与过滤 --- */
const existing = [
  { name: "第一教学楼", lat: 31.2325, lng: 121.4705 },
  { name: "老食堂", lat: 31.2330, lng: 121.4700 }
];
const dedup = Places.splitDuplicates(opParsed, existing, 25);
check("同名楼栋被判为重复", dedup.fresh.every((x) => x.name !== "第一教学楼"));
check("25 米内的楼栋被判为重复", dedup.fresh.every((x) => x.name !== "学生食堂"));
check("只留下真正的新楼栋", dedup.fresh.length === 1 && dedup.fresh[0].name === "无名点",
  dedup.fresh.map((x) => x.name).join("/"));
check("重复数量统计正确", dedup.duplicated === 2, dedup.duplicated);

check("按名称过滤生效",
  Places.filterByName(opParsed, "教学").length === 1,
  Places.filterByName(opParsed, "教学").map((x) => x.name).join("/"));
check("名称过滤留空时返回全部", Places.filterByName(opParsed, "  ").length === opParsed.length);

/* --- 合并同一栋楼内的点位 --- */
/* 同一栋楼可能被录成多个点（中英文名、多个入口），坐标几乎重合 */
const base = { lat: 39.9996, lng: 116.3264 };
const scattered = [
  { name: "清华大学建筑学院声学实验室", lat: base.lat, lng: base.lng, teaching: true, distance: 90 },
  { name: "中央主楼", lat: base.lat + 0.00005, lng: base.lng, teaching: true, distance: 90 },
  { name: "清华大学建筑学院建筑物理实验室", lat: base.lat + 0.0001, lng: base.lng, teaching: true, distance: 90 },
  { name: "第六教学楼A区", lat: base.lat + 0.005, lng: base.lng, teaching: true, distance: 553 },
  { name: "第六教学楼B区", lat: base.lat + 0.005, lng: base.lng + 0.0005, teaching: true, distance: 600 }
];
const merged25 = Places.cluster(scattered, 25);
check("25 米内的点位被合并成一栋", merged25.length === 3, merged25.map((x) => x.name).join(" / "));
check("合并后保留最短的名字当代表", merged25[0].name === "中央主楼", merged25[0].name);
check("合并数量统计正确", merged25[0].merged === 3, merged25[0].merged);
check("被合并掉的名字保留下来备查",
  merged25[0].mergedNames.length === 2 &&
  merged25[0].mergedNames.indexOf("清华大学建筑学院声学实验室") >= 0,
  merged25[0].mergedNames.join(" / "));
check("相距 47 米的两栋楼不会被合并", merged25.length === 3 &&
  merged25.filter((x) => x.name.indexOf("第六教学楼") === 0).length === 2);

const mergedSmall = Places.cluster(scattered, 10);
check("把阈值调到 10 米后合并得更少", mergedSmall.length === 4, mergedSmall.length);
check("不传阈值时默认按 25 米合并", Places.cluster(scattered).length === 3);

check("挑代表时优先选像教学楼的",
  Places.pickLead({ name: "中央主楼", teaching: true }, { name: "食堂", teaching: false }) === true);
check("同样像教学楼时选名字更短的",
  Places.pickLead({ name: "六教", teaching: true }, { name: "第六教学楼A区", teaching: true }) === true);

console.log("\n[12] 课表截图识别（几何还原 + 文本解析）");
/* 包一层块作用域，避免和前面几组的变量重名 */
{
const Ocr = OP.Ocr;

/* ---------- 构造一份"OCR 输出"，内容与坐标照实拍截图还原 ---------- */
const COL_X = { 1: 160, 2: 300, 3: 447, 4: 595, 5: 742 };
const HEADER_Y = 465;
const AXIS = { topY: 505, minutesAtTop: 480, pxPerMinute: 160 / 60 };

function yFor(minutes) {
  return AXIS.topY + (minutes - AXIS.minutesAtTop) * AXIS.pxPerMinute;
}

function mkWord(text, centerX, y0, height) {
  const width = Math.max(12, String(text).length * 9);
  return { text: String(text), x0: centerX - width / 2, y0, x1: centerX + width / 2, y1: y0 + height, conf: 96 };
}

/* 一行文字拆成若干词，整体在这一列里居中 */
function mkLine(line, centerX, y0, height) {
  const tokens = String(line).split(" ").filter(Boolean);
  const widths = tokens.map((t) => Math.max(12, t.length * 9));
  const gap = 8;
  const total = widths.reduce((a, b) => a + b, 0) + gap * (tokens.length - 1);
  let x = centerX - total / 2;
  return tokens.map((t, i) => {
    const word = mkWord(t, x + widths[i] / 2, y0, height);
    x += widths[i] + gap;
    return word;
  });
}

function mkCourse(day, startMin, endMin, lines) {
  const cx = COL_X[day];
  const yTop = yFor(startMin);
  const words = [];
  lines.forEach((line, i) => {
    words.push(...mkLine(line, cx, yTop + 6 + i * 22, 18));
  });
  return words;
}

const fixture = [];

/* 表头：星期 + 日期两行，日期那行是用来干扰的 */
[["Monday", "Sep 7", 1], ["Tuesday", "Sep 8", 2], ["Wednesday", "Sep 9", 3],
 ["Thursday", "Sep 10", 4], ["Friday", "Sep 11", 5]].forEach(([name, date, day]) => {
  fixture.push(...mkLine(name, COL_X[day], HEADER_Y, 22));
  fixture.push(...mkLine(date, COL_X[day], HEADER_Y + 26, 18));
});

/* 左侧时间刻度：照抄截图里被裁掉首位数的样子 */
["8:00", "9:00", "0:00", "1:00", "2:00", "3:00", "4:00", "5:00", "6:00", "7:00", "8:00"]
  .forEach((label, i) => {
    fixture.push(mkWord(label, 45, yFor(480 + i * 60) - 11, 22));
  });

/* 15 节课，内容就是实拍截图里那 15 条 */
fixture.push(...mkCourse(1, 750, 855, ["ENGG 1110 - A", "Lecture", "12:30 - 14:15", "Yasumoto Int'l", "Acad Park LT6"]));
fixture.push(...mkCourse(1, 870, 975, ["CHLT 1002 - FF", "Lecture", "14:30 - 16:15", "Wu Ho Man Yuen", "Bldg 504"]));
/* 真实截图里长地名会折行，这里照做——否则一行文字会超出列宽，
   末尾的词被分到隔壁列去，那是测试数据不真实，不是代码的问题 */
fixture.push(...mkCourse(1, 990, 1035, ["BMEG 2410 - -", "Lecture", "16:30 - 17:15", "Y.C. Liang Hall", "104"]));
fixture.push(...mkCourse(1, 1050, 1095, ["BMEG 2410 - -", "T02", "Interactive Tutorial", "17:30 - 18:15", "Y.C. Liang Hall", "106"]));
fixture.push(...mkCourse(2, 630, 675, ["BMEG 2210 - -", "Lecture", "10:30 - 11:15", "Science Centre L5"]));
fixture.push(...mkCourse(2, 750, 855, ["Waiting:", "UGFH 1000 -", "PT02", "Interactive Tutorial", "12:30 - 14:15", "Esther Lee Bldg 305"]));
fixture.push(...mkCourse(3, 570, 675, ["BMEG 2210 - -", "Lecture", "09:30 - 11:15", "Science Centre L3"]));
fixture.push(...mkCourse(3, 690, 735, ["BMEG 2210 - -", "T01", "Interactive Tutorial", "11:30 - 12:15", "Science Centre L3"]));
fixture.push(...mkCourse(3, 870, 975, ["ENGG 1003 - EE", "Lecture", "14:30 - 16:15", "Lady Shaw Bldg C3"]));
fixture.push(...mkCourse(3, 990, 1035, ["ENGG 1003 -", "EEL1", "Laboratory", "16:30 - 17:15", "Lady Shaw Bldg C3"]));
fixture.push(...mkCourse(4, 570, 675, ["BMEG 2410 - -", "Lecture", "09:30 - 11:15", "Science Centre L2"]));
fixture.push(...mkCourse(4, 810, 855, ["Waiting:", "UGFH 1000 - P", "Lecture", "13:30 - 14:15", "Lee Shau Kee", "Building LT3"]));
fixture.push(...mkCourse(4, 930, 975, ["ENGG 1110 - A", "Lecture", "15:30 - 16:15", "Lee Shau Kee", "Building LT2"]));
fixture.push(...mkCourse(4, 990, 1035, ["ENGG 1110 -", "AL01", "Laboratory", "16:30 - 17:15", "Lee Shau Kee", "Building LT2"]));
fixture.push(...mkCourse(5, 690, 795, ["GESC 1000 - -", "A01", "Assembly", "11:30 - 13:15", "Location: TBA"]));

/* ---------- 分步验证 ---------- */

check("识别星期表头", Ocr.weekdayOf("Monday") === 1 && Ocr.weekdayOf("fri") === 5 &&
  Ocr.weekdayOf("星期三") === 3 && Ocr.weekdayOf("Sep") === 0);

const header = Ocr.parseWeekdayHeader(fixture);
check("从表头定位出 5 列", header.length === 5, header.map((h) => h.day).join(","));
check("表头只取最上面那一行（没把日期那行认成星期）",
  header.every((h) => h.day >= 1 && h.day <= 5));

const columns = Ocr.buildColumns(header);
check("列边界按表头中心点均分", columns.length === 5 && columns[0].left < COL_X[1] && columns[0].right > COL_X[1],
  columns.map((c) => c.day + ":" + Math.round(c.left) + "-" + Math.round(c.right)).join(" "));

const axis = Ocr.buildTimeAxis(fixture, columns[0].left);
check("识别出时间刻度", axis !== null);
check("被裁掉首位数的时间刻度被补回来（0:00 → 10:00）",
  axis.points.map((p) => p.minutes).join(",") === "480,540,600,660,720,780,840,900,960,1020,1080",
  axis.points.map((p) => p.minutes).join(","));
check("时间轴线性可用（12:30 落在正确位置）",
  near(axis.toMinutes(yFor(750)), 750, 2), axis.toMinutes(yFor(750)).toFixed(1));

/* ---------- 整表还原 ---------- */

const result = Ocr.parseWords(fixture);

check("还原出 15 条课程", result.courses.length === 15,
  result.courses.length + " 条：" + result.courses.map((c) => c.code).join("/"));

const byDay = {};
result.courses.forEach((c) => { byDay[c.weekday] = (byDay[c.weekday] || 0) + 1; });
check("每天的数量正确（4/2/4/4/1）",
  byDay[1] === 4 && byDay[2] === 2 && byDay[3] === 4 && byDay[4] === 4 && byDay[5] === 1,
  JSON.stringify(byDay));

const monday = result.courses.filter((c) => c.weekday === 1);
check("周一的时间顺序正确",
  monday.map((c) => c.start).join(",") === "12:30,14:30,16:30,17:30",
  monday.map((c) => c.start).join(","));

const first = result.courses.filter((c) => c.code === "ENGG 1110" && c.weekday === 1)[0];
check("课程代码与课节号正确", first.code === "ENGG 1110" && first.section === "A",
  first.code + " / " + first.section);
check("课程类型正确", first.type === "Lecture", first.type);
check("时间正确", first.start === "12:30" && first.end === "14:15", first.start + "-" + first.end);
check("地点被拆成楼栋 + 房间",
  first.buildingName === "Yasumoto Int'l Acad Park" && first.room === "LT6",
  first.buildingName + " / " + first.room);

/* 课节号另起一行的两个例子 */
const t02 = result.courses.filter((c) => c.section === "T02")[0];
check("课节号另起一行也能认出来（BMEG 2410 / T02）",
  t02 && t02.code === "BMEG 2410" && t02.name.indexOf("T02") >= 0, t02 && t02.name);
const eel1 = result.courses.filter((c) => c.section === "EEL1")[0];
check("课节号含数字也能认出来（ENGG 1003 / EEL1）", eel1 && eel1.type === "Laboratory",
  eel1 && eel1.name);

/* 上下紧挨着的两节不能被合并 */
const wednesdayEvening = result.courses.filter((c) => c.weekday === 3 && c.start >= "14:30");
check("紧挨着的两节课没有被并成一条", wednesdayEvening.length === 2,
  wednesdayEvening.map((c) => c.code + "@" + c.start).join(" / "));
check("后一节的时间没被前一节带跑",
  wednesdayEvening[1] && wednesdayEvening[1].start === "16:30",
  wednesdayEvening[1] && wednesdayEvening[1].start);

/* 待定与候补 */
const waiting = result.courses.filter((c) => c.waiting);
check("两条候补课程被标记出来", waiting.length === 2,
  waiting.map((c) => c.code + "-" + c.section).join(" / "));
const gesc = result.courses.filter((c) => c.code === "GESC 1000")[0];
check("地点 TBA 被识别为待定", gesc && gesc.tba === true && gesc.buildingName === "");

/* ---------- 地点解析 ---------- */

check("地点拆分：Science Centre L5",
  Ocr.parseVenue("Science Centre L5").building === "Science Centre" &&
  Ocr.parseVenue("Science Centre L5").room === "L5");
check("地点拆分：Lee Shau Kee Building LT2",
  Ocr.parseVenue("Lee Shau Kee Building LT2").building === "Lee Shau Kee Building" &&
  Ocr.parseVenue("Lee Shau Kee Building LT2").room === "LT2");
check("地点拆分：没有房间号时整串当楼名",
  Ocr.parseVenue("Science Centre").building === "Science Centre" &&
  Ocr.parseVenue("Science Centre").room === "");
check("地点拆分：去掉 Location: 前缀并识别 TBA",
  Ocr.parseVenue("Location: TBA").tba === true);

/* 这张课表里出现的所有地点写法，楼栋和教室必须分得干干净净 */
const realVenues = [
  ["Yasumoto Int'l Acad Park LT6", "Yasumoto Int'l Acad Park", "LT6"],
  ["Wu Ho Man Yuen Bldg 504", "Wu Ho Man Yuen Bldg", "504"],
  ["Y.C. Liang Hall 104", "Y.C. Liang Hall", "104"],
  ["Y.C. Liang Hall 106", "Y.C. Liang Hall", "106"],
  ["Science Centre L5", "Science Centre", "L5"],
  ["Science Centre L3", "Science Centre", "L3"],
  ["Science Centre L2", "Science Centre", "L2"],
  ["Esther Lee Bldg 305", "Esther Lee Bldg", "305"],
  ["Lady Shaw Bldg C3", "Lady Shaw Bldg", "C3"],
  ["Lee Shau Kee Building LT2", "Lee Shau Kee Building", "LT2"],
  ["Lee Shau Kee Building LT3", "Lee Shau Kee Building", "LT3"]
];

const badVenues = realVenues.filter(function (pair) {
  const parsed = Ocr.parseVenue(pair[0]);
  return parsed.building !== pair[1] || parsed.room !== pair[2];
});
check("课表里 11 种地点写法都能正确拆出楼栋和教室",
  badVenues.length === 0,
  badVenues.map(function (p) { return p[0]; }).join(" / "));

/* 地点折成两行时，单独成行的教室号容易被误判成课节号丢掉 */
const wrappedRoom = Ocr.parseBlockLines([
  "ENGG 1110 - A", "Lecture", "15:30 - 16:15", "Lee Shau Kee Building", "LT2"
]);
check("地点折成两行时教室号不会丢",
  wrappedRoom.buildingName === "Lee Shau Kee Building" && wrappedRoom.room === "LT2",
  wrappedRoom.buildingName + " / " + wrappedRoom.room);

const wrappedRoom2 = Ocr.parseBlockLines([
  "BMEG 2210 - -", "Lecture", "09:30 - 11:15", "Science Centre", "L3"
]);
check("短楼名折行也一样",
  wrappedRoom2.buildingName === "Science Centre" && wrappedRoom2.room === "L3",
  wrappedRoom2.buildingName + " / " + wrappedRoom2.room);

/* 纯数字的教室号折行后不能被当成噪声丢掉（104 / 305 / 504） */
const wrappedNumberRoom = Ocr.parseBlockLines([
  "BMEG 2410 - -", "Lecture", "16:30 - 17:15", "Y.C. Liang Hall", "104"
]);
check("纯数字教室号折行后仍然保住",
  wrappedNumberRoom.buildingName === "Y.C. Liang Hall" && wrappedNumberRoom.room === "104",
  wrappedNumberRoom.buildingName + " / " + wrappedNumberRoom.room);

const wrappedNumberRoom2 = Ocr.parseBlockLines([
  "CHLT 1002 - FF", "Lecture", "14:30 - 16:15", "Wu Ho Man Yuen", "Bldg 504"
]);
check("折行后楼名和数字号分处两行也能拼回去",
  wrappedNumberRoom2.buildingName === "Wu Ho Man Yuen Bldg" && wrappedNumberRoom2.room === "504",
  wrappedNumberRoom2.buildingName + " / " + wrappedNumberRoom2.room);

/* 课节号仍然要被排除，不能因为放宽就跑进地点里 */
const sectionNotVenue = Ocr.parseBlockLines([
  "BMEG 2410 - -", "T02", "Interactive Tutorial", "17:30 - 18:15", "Y.C. Liang Hall 106"
]);
check("放宽之后课节号仍然不会混进地点",
  sectionNotVenue.buildingName === "Y.C. Liang Hall" && sectionNotVenue.room === "106",
  sectionNotVenue.buildingName + " / " + sectionNotVenue.room);

/* ---------- 匹配楼栋时忽略教室后缀 ---------- */

check("结尾的教室号会被剥掉",
  Ocr.stripRoomSuffix("Science Centre L3") === "Science Centre" &&
  Ocr.stripRoomSuffix("Lee Shau Kee Building LT2") === "Lee Shau Kee Building",
  Ocr.stripRoomSuffix("Science Centre L3"));
check("本来就没有教室号的保持不变",
  Ocr.stripRoomSuffix("Science Centre") === "Science Centre" &&
  Ocr.stripRoomSuffix("Y.C. Liang Hall") === "Y.C. Liang Hall");
check("只有教室里那一个词时不会被削成空",
  Ocr.stripRoomSuffix("LT2") === "LT2");

const centreOnly = [{ id: "s", name: "Science Centre", alias: [] }];
check("带教室号的名字也能匹配上纯楼栋名",
  Ocr.matchBuilding("Science Centre L3", centreOnly).id === "s");
check("阈值调高时靠剥掉后缀救回来（确实会走这条路径）",
  Ocr.matchBuilding("Science Centre L3", centreOnly, 0.95) !== null,
  JSON.stringify(Ocr.matchBuilding("Science Centre L3", centreOnly, 0.95)));

/* 本身带数字的楼名不能被误削 */
check("本身带数字的楼名优先走精确匹配",
  Ocr.matchBuilding("Building 10", [{ id: "n", name: "Building 10", alias: [] }], 0.95).id === "n");

/* 教室号要一路留到导入的课程里 */
check("教室号既留在 room 里，也不会混进楼名",
  wrappedRoom.room === "LT2" && wrappedRoom.buildingName === "Lee Shau Kee Building",
  wrappedRoom.buildingName + " / " + wrappedRoom.room);
check("拿楼名去匹配不会因为教室号失配",
  Ocr.matchBuilding(wrappedRoom.buildingName,
    [{ id: "l", name: "Lee Shau Kee Building", alias: [] }]).id === "l");

/* 整张课表的教室号一个都不能少（TBA 和"不需要教室"本来就没有教室号） */
const lostRooms = result.courses.filter(function (c) { return !c.room && !c.tba && !c.noRoom; });
check("整张课表 15 条的教室号全部保住",
  lostRooms.length === 0,
  lostRooms.map(function (c) { return "周" + c.weekday + " " + c.code; }).join(" / "));

/* ---------- 课程类型不能混进地点 ----------
   OCR 开着"保留词间空格"很容易读出多余空格，也可能把
   "Interactive Tutorial" 拆成两行。两种情况都不能让它变成地点。 */

check("类型词带多余空格也能认出来",
  Ocr.isTypeWord("Interactive  Tutorial") && Ocr.isTypeWord("interactive tutorial."),
  "Interactive  Tutorial");
check("类型词大小写不影响判断", Ocr.isTypeWord("LECTURE") && Ocr.isTypeWord("Lecture"));
check("认出之后统一用规范写法",
  Ocr.canonicalType("interactive  tutorial") === "Interactive Tutorial",
  Ocr.canonicalType("interactive  tutorial"));
check("摘除函数能去掉带多余空格的类型词",
  Ocr.stripTypeWords("Interactive  Tutorial Y.C. Liang Hall 106") === "Y.C. Liang Hall 106",
  Ocr.stripTypeWords("Interactive  Tutorial Y.C. Liang Hall 106"));

const spacedType = Ocr.parseBlockLines([
  "BMEG 2410 - -", "T02", "Interactive  Tutorial", "17:30 - 18:15", "Y.C. Liang Hall 106"
]);
check("类型带多余空格时不会变成地点",
  spacedType.buildingName === "Y.C. Liang Hall" && spacedType.room === "106",
  spacedType.buildingName + " / " + spacedType.room);
check("类型带多余空格时仍算进课名",
  spacedType.type === "Interactive Tutorial" && spacedType.name.indexOf("Interactive Tutorial") > 0,
  spacedType.name);

const splitType = Ocr.parseBlockLines([
  "BMEG 2410 - -", "T02", "Interactive", "Tutorial", "17:30 - 18:15", "Y.C. Liang Hall 106"
]);
check("类型被拆成两行时会先合并回去",
  Ocr.mergeTypeLines(["Interactive", "Tutorial"]).length === 1);
check("拆成两行的类型也不会变成地点",
  splitType.buildingName === "Y.C. Liang Hall" && splitType.room === "106",
  splitType.buildingName + " / " + splitType.room);
check("拆成两行的类型仍算进课名",
  splitType.type === "Interactive Tutorial", splitType.type);
check("正常折行的地点不会被误合并（只有拼起来正好是类型词才合并）",
  Ocr.mergeTypeLines(["Lee Shau Kee", "Building LT3"]).length === 2);

/* ---------- 课表地名与地图地名模糊匹配 ---------- */
const fuzzyCampus = [
  { id: "f1", name: "Yasumoto International Academic Park", alias: [] },
  { id: "f2", name: "Lady Shaw Building", alias: [] },
  { id: "f3", name: "Science Centre East Block", alias: [] },
  { id: "f4", name: "碧秋樓", alias: ["Pi Ch'iu Building"] }
];

check("缩写能对上：Int'l Acad → International Academic",
  Ocr.matchBuilding("Yasumoto Int'l Acad Park", fuzzyCampus).id === "f1",
  JSON.stringify(Ocr.matchBuilding("Yasumoto Int'l Acad Park", fuzzyCampus)));
check("Bldg 能对上 Building",
  Ocr.matchBuilding("Lady Shaw Bldg", fuzzyCampus).id === "f2");
check("课表只写一半也能对上（Science Centre）",
  Ocr.matchBuilding("Science Centre", fuzzyCampus).id === "f3");
check("部分匹配不会被当成精确匹配",
  Ocr.matchBuilding("Science Centre", fuzzyCampus).exact === false);
check("部分匹配会给出把握分数",
  Ocr.matchBuilding("Science Centre", fuzzyCampus).score > 0.6 &&
  Ocr.matchBuilding("Science Centre", fuzzyCampus).score < 0.95,
  Ocr.matchBuilding("Science Centre", fuzzyCampus).score.toFixed(2));
check("中文名能匹配中文楼栋",
  Ocr.matchBuilding("碧秋樓", fuzzyCampus).id === "f4");
check("英文别名能匹配中文楼栋",
  Ocr.matchBuilding("Pi Ch'iu Building", fuzzyCampus).id === "f4");
check("完全无关的名字不会被乱匹配",
  Ocr.matchBuilding("Lady Shaw Building", [fuzzyCampus[0]]) === null);
check("阈值可以调高，弱匹配就会被拒掉",
  Ocr.matchBuilding("Science Centre", fuzzyCampus, 0.95) === null);
check("空名字返回 null", Ocr.matchBuilding("", fuzzyCampus) === null);

/* ---------- 课程代号必须是 4 字母 + 4 数字 ---------- */

check("标准代号被接受", Ocr.isValidCourseCode("BMEG 2210") && Ocr.isValidCourseCode("ENGL 1001"));
check("只有 3 个字母的代号被拒", !Ocr.isValidCourseCode("ENG 1110"));
check("只有 3 位数字的代号被拒", !Ocr.isValidCourseCode("BMEG 221"));
check("位数过多也被拒", !Ocr.isValidCourseCode("BMEG 22100"));
check("空代号被拒", !Ocr.isValidCourseCode("") && !Ocr.isValidCourseCode(null));

check("数字位的常见认错会被纠正（22l0 → 2210）", Ocr.fixDigits("22l0") === "2210");
check("O 和 I 也会被纠正（22IO → 2210）", Ocr.fixDigits("22IO") === "2210");
check("S 会被纠正成 5", Ocr.fixDigits("22S0") === "2250");

const confusedCode = Ocr.parseBlockLines([
  "BMEG 22l0 - -", "Lecture", "09:30 - 11:15", "Science Centre L3"
]);
check("代号里有认错的字符也能救回来",
  confusedCode.code === "BMEG 2210" && Ocr.isValidCourseCode(confusedCode.code),
  confusedCode.code);
check("救回来时原始文字有留底", confusedCode.rawCode === "BMEG 22l0", confusedCode.rawCode);

/* ---------- 代号和类型缺一不可 ---------- */

const strictWorld = [];
strictWorld.push(...mkLine("Monday", COL_X[1], HEADER_Y, 22));
strictWorld.push(...mkLine("Tuesday", COL_X[2], HEADER_Y, 22));
["8:00", "9:00", "0:00", "1:00", "2:00"].forEach((label, i) => {
  strictWorld.push(mkWord(label, 45, yFor(480 + i * 60) - 11, 22));
});

/* 完整的一条 */
strictWorld.push(...mkCourse(1, 570, 675, ["BMEG 2210 - -", "Lecture", "09:30 - 11:15", "Science Centre L3"]));
/* 有代号但没类型 */
strictWorld.push(...mkCourse(1, 690, 735, ["ENGG 1110 -", "11:30 - 12:15", "Lady Shaw Bldg C3"]));
/* 有类型但代号只有 3 个字母 */
strictWorld.push(...mkCourse(2, 570, 675, ["ENG 1003 - EE", "Lecture", "09:30 - 11:15", "Lady Shaw Bldg C3"]));

const strictResult = Ocr.parseWords(strictWorld);
check("只保留同时有合规代号和课程类型的格子",
  strictResult.courses.length === 1, strictResult.courses.map((c) => c.code).join("/"));
check("保留下来的那条是对的",
  strictResult.courses[0].code === "BMEG 2210" && strictResult.courses[0].type === "Lecture",
  strictResult.courses[0].name);
check("缺课程类型的格子被丢掉并记下原因",
  strictResult.rejected.some((r) => r.reason.indexOf("课程类型") >= 0 &&
    r.text.indexOf("ENGG 1110") >= 0),
  JSON.stringify(strictResult.rejected.map((r) => r.reason)));
check("代号不合规的格子被丢掉并记下原因",
  strictResult.rejected.some((r) => r.reason.indexOf("代号") >= 0 &&
    r.text.indexOf("ENG 1003") >= 0));
check("被丢掉的一共两条", strictResult.rejected.length === 2, strictResult.rejected.length);

/* 完整那张课表不受影响 */
check("原本 15 条的那张课表仍然全部还原",
  result.courses.length === 15 && result.rejected.length === 0,
  result.courses.length + " 条，丢弃 " + result.rejected.length);

/* ---------- 多遍识别的结果取并集 ---------- */

const passA = { courses: [
  { weekday: 1, start: "12:30", end: "14:15", code: "ENGG 1110", section: "A",
    type: "Lecture", buildingName: "Yasumoto", room: "LT6" }
] };
const passB = { courses: [
  { weekday: 1, start: "12:30", end: "14:15", code: "ENGG 1110", section: "A",
    type: "Lecture", buildingName: "Yasumoto", room: "" },
  { weekday: 2, start: "12:30", end: "14:15", code: "UGFH 1000", section: "PT02",
    type: "Interactive Tutorial", buildingName: "Esther Lee Bldg", room: "305" }
]};

const union = Ocr.mergeCourses([passA, passB]);
check("两遍各读到一条时取并集", union.length === 2, union.length);
check("并集按星期和时间排好序", union[0].weekday === 1 && union[1].weekday === 2);
check("同一条撞车时保留信息更全的那条", union[0].room === "LT6", union[0].room);

const misreadTime = { courses: [
  { weekday: 2, start: "2:30", end: "4:15", code: "UGFH 1000", section: "PT02",
    type: "Interactive Tutorial", buildingName: "", room: "" }
]};
check("时间被读错时靠代号认出来，不会变成两条",
  Ocr.mergeCourses([passB, misreadTime]).length === 2,
  Ocr.mergeCourses([passB, misreadTime]).length);

const sameCodeTwice = { courses: [
  { weekday: 1, start: "16:30", end: "17:15", code: "BMEG 2410", section: "", type: "Lecture" },
  { weekday: 1, start: "17:30", end: "18:15", code: "BMEG 2410", section: "T02", type: "Interactive Tutorial" }
]};
check("同一天同一门课的不同课节不会被并成一条",
  Ocr.mergeCourses([sameCodeTwice]).length === 2,
  Ocr.mergeCourses([sameCodeTwice]).length);

check("丢弃记录去重后合并",
  Ocr.mergeRejected([
    { rejected: [{ reason: "r1", text: "t1" }] },
    { rejected: [{ reason: "r1", text: "t1" }, { reason: "r2", text: "t2" }] }
  ]).length === 2);
check("一条都没有时并集是空的",
  Ocr.mergeCourses([{ courses: [] }, {}]).length === 0);

/* ---------- 楼栋匹配 ---------- */

const campusBuildings = [
  { id: "b1", name: "Science Centre", alias: [] },
  { id: "b2", name: "李兆基樓 Lee Shau Kee Building", alias: ["Lee Shau Kee Building"] },
  { id: "b3", name: "Y.C. Liang Hall", alias: [] }
];
check("楼栋精确匹配",
  Ocr.matchBuilding("Science Centre", campusBuildings).id === "b1");
check("楼栋通过别名匹配",
  Ocr.matchBuilding("Lee Shau Kee Building", campusBuildings).id === "b2");
check("楼栋模糊匹配（大小写和标点无关）",
  Ocr.matchBuilding("y c liang hall", campusBuildings).id === "b3");
check("匹配不上时返回 null",
  Ocr.matchBuilding("Some Other Building", campusBuildings) === null);

/* ---------- OCR 原始输出解析 ---------- */

const tsv = [
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  "5\t1\t1\t1\t1\t1\t10\t20\t60\t18\t96\tBMEG",
  "5\t1\t1\t1\t1\t2\t76\t20\t40\t18\t92\t2210",
  "5\t1\t1\t1\t2\t1\t10\t44\t80\t18\t12\t~~~",
  "5\t1\t1\t1\t2\t2\t96\t44\t50\t18\t88\tLecture"
].join("\n");
const tsvWords = Ocr.wordsFromTsv(tsv);
check("从 TSV 取词（跳过表头行）", tsvWords.length === 3, tsvWords.length);
check("低置信度的词被丢掉", tsvWords.every((w) => w.text !== "~~~"));
check("词的坐标换算成包围盒",
  tsvWords[0].x0 === 10 && tsvWords[0].y0 === 20 && tsvWords[0].x1 === 70 && tsvWords[0].y1 === 38,
  JSON.stringify(tsvWords[0]));

/* Tesseract.js v5 默认不生成 tsv，如果没有兜底就会一个字都拿不到 */
check("有 TSV 时优先用 TSV", Ocr.extractWords({ tsv: tsv, words: [] }).length === 3);

const wordShape = { text: "BMEG", bbox: { x0: 5, y0: 6, x1: 25, y1: 18 }, confidence: 91 };
check("没有 TSV 时回退到 data.words",
  Ocr.extractWords({ tsv: "", words: [wordShape] }).length === 1);
check("没有 TSV 和 words 时回退到嵌套的 blocks",
  Ocr.extractWords({
    tsv: "",
    blocks: [{ paragraphs: [{ lines: [{ words: [wordShape, { text: " ", bbox: wordShape.bbox, confidence: 90 }] }] }] }]
  }).length === 1);
check("走 blocks 兜底时也过滤低置信度",
  Ocr.extractWords({
    tsv: "",
    blocks: [{ paragraphs: [{ lines: [{ words: [{ text: "zzz", bbox: wordShape.bbox, confidence: 5 }] }] }] }]
  }).length === 0);
check("什么都没有时返回空数组", Ocr.extractWords({}).length === 0 && Ocr.extractWords(null).length === 0);
check("残缺的坐标信息不会混进来",
  Ocr.extractWords({ tsv: "", words: [{ text: "abc", bbox: {} }] }).length === 0);

/* v5 必须显式要求 tsv 输出，这条用来防止以后被改回去 */
const ocrSource = fs.readFileSync(path.join(root, "js/ocr.js"), "utf8");
check("识别时显式要求了 tsv 输出", ocrSource.indexOf("tsv: true") > 0);
check("识别失败时会在多种分割模式间重试",
  ocrSource.indexOf("MODES = [6, 4, 11]") > 0 || ocrSource.indexOf("[6, 4, 11]") > 0);

/* ---------- 像素处理：浅色彩色底必须被抹掉 ----------
   实拍截图里课表格子是浅绿底，先转灰度再二值化会把背景和文字一起判成黑，
   整片课程内容就消失了。这里锁死"抹彩底"的行为。 */

function px(r, g, b) { return new Uint8ClampedArray([r, g, b, 255]); }
function rgb(a) { return a[0] + "," + a[1] + "," + a[2]; }

const greenBg = px(181, 217, 160);          /* 课表格子的浅绿底 */
Ocr.flattenColorBackgrounds(greenBg);
check("浅绿底被抹成白色", greenBg[0] === 255 && greenBg[1] === 255 && greenBg[2] === 255, rgb(greenBg));

const blueBg = px(205, 225, 250);           /* 换成浅蓝底也一样 */
Ocr.flattenColorBackgrounds(blueBg);
check("浅蓝底也被抹成白色", blueBg[0] === 255 && blueBg[1] === 255, rgb(blueBg));

const darkOnGreen = px(51, 51, 51);         /* 绿色格子上的深色文字 */
Ocr.flattenColorBackgrounds(darkOnGreen);
check("绿色格子上的深色文字保留下来", darkOnGreen[0] < 80, darkOnGreen[0]);

const darkRed = px(120, 30, 30);            /* 深色的彩色文字不该被误抹 */
Ocr.flattenColorBackgrounds(darkRed);
check("深色的彩色文字不会被误抹成白",
  darkRed[0] < 100 && darkRed[0] === darkRed[1] && darkRed[1] === darkRed[2],
  darkRed[0] + " (灰阶一致: " + (darkRed[0] === darkRed[1]) + ")");

const lightGray = px(230, 230, 230);        /* 中性浅灰底不该被当成彩色处理 */
Ocr.flattenColorBackgrounds(lightGray);
check("中性浅灰底原样保留", lightGray[0] === 230, lightGray[0]);

/* 模拟一小段真实表格：绿底 + 绿底上的字 + 白底 + 白底上的字 */
const strip = new Uint8ClampedArray([
  181, 217, 160, 255,
  45, 45, 45, 255,
  255, 255, 255, 255,
  45, 45, 45, 255
]);
Ocr.flattenColorBackgrounds(strip);
const bgPixels = [strip[0], strip[8]];
const textPixels = [strip[4], strip[12]];
check("处理后的背景全白、文字全黑",
  bgPixels.every((v) => v === 255) && textPixels.every((v) => v < 80),
  "背景 " + bgPixels.join("/") + "，文字 " + textPixels.join("/"));

const grayTest = px(100, 200, 50);
Ocr.toGrayscale(grayTest);
check("灰度转换按标准权重",
  Math.abs(grayTest[0] - (0.299 * 100 + 0.587 * 200 + 0.114 * 50)) <= 1,
  grayTest[0]);

/* 局部二值化：彩色底上的黑字要留下，浅灰框线和底色要抹掉。
   这是 2026-10-03 那张 CUSIS 课表读不出来的根治办法——原来"又亮又彩色就抹白"
   会把彩底上的小字一起抹掉（表头被读成 "Tire Koray TUesdsEy"）。 */
check("局部二值化：彩底上的黑字留下，浅灰框线抹掉", (function () {
  const w = 9, h = 9;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = 182; data[i * 4 + 1] = 209; data[i * 4 + 2] = 146; data[i * 4 + 3] = 255;
  }
  const put = (x, y, v) => { const o = (y * w + x) * 4; data[o] = data[o + 1] = data[o + 2] = v; };
  put(4, 4, 0);      /* 彩底上的黑字 */
  put(0, 0, 230);    /* 浅灰框线那种（反差 25） */
  Ocr.localBinarize(data, w, h, 2);
  const at = (x, y) => data[(y * w + x) * 4];
  return at(4, 4) === 0 && at(0, 0) === 255 && at(1, 1) === 255 && at(8, 8) === 255;
})());

/* 顺序就是尝试顺序，第一个能拼出课的就停。
   2026-10-03 起把「局部二值化」放第一位：浅彩底上的小字只有它能同时
   读出表头和格子内容（抹彩色底会把表头读花，灰度读不出格子）。 */
check("默认优先尝试「局部二值化」，后面还留着抹彩色底 / 灰度 / 增强对比做兜底",
  Ocr.VARIANTS[0].id === "local" &&
  ["local", "chroma", "gray", "contrast"].every((id, i) => Ocr.VARIANTS[i].id === id) &&
  typeof Ocr.localBinarize === "function",
  Ocr.VARIANTS.map((v) => v.id).join(" → "));
check("像素处理方案会和应用到识别流程里",
  ocrSource.indexOf("applyVariant(canvas, variant.id)") > 0);

/* 挑最优结果时不能只看条数，否则残缺记录多的那次会赢 */
const completeResult = { timeAxis: {}, courses: [
  { buildingName: "A", start: "08:00", end: "09:00" },
  { buildingName: "B", start: "10:00", end: "11:00" }
] };
const manyIncomplete = { timeAxis: null, courses: [
  { buildingName: "", start: "08:00", end: "09:00" },
  { buildingName: "", start: "08:00", end: "09:00" },
  { buildingName: "", start: "08:00", end: "09:00" },
  { buildingName: "", start: "08:00", end: "09:00" }
] };
check("评分更看重完整课程数，而不是记录条数",
  Ocr.scoreResult(completeResult) > Ocr.scoreResult(manyIncomplete),
  Ocr.scoreResult(completeResult) + " vs " + Ocr.scoreResult(manyIncomplete));
check("有地点有时间的课才会被算作完整",
  Ocr.scoreResult({ timeAxis: null, courses: [{ buildingName: "A", start: "08:00", end: "09:00", needsTime: true }] })
    < Ocr.scoreResult({ timeAxis: null, courses: [{ buildingName: "A", start: "08:00", end: "09:00" }] }));
check("空结果评分为 -1", Ocr.scoreResult(null) === -1);
check("挑选时用的是评分而不是条数",
  ocrSource.indexOf("scoreResult(parsed) > scoreResult(best)") > 0);

/* ---------- 找不到表头时要给出提示 ---------- */

const noHeader = Ocr.parseWords([mkWord("Hello", 100, 100, 20)]);
check("识别不到表头时返回可读提示",
  noHeader.courses.length === 0 && noHeader.warnings[0].indexOf("星期") >= 0,
  noHeader.warnings[0]);
}

console.log("\n[13] 新建楼栋缺坐标时的兜底");
{
  const withCoords = { id: "ok", name: "有坐标的楼", alias: [], lat: 31.23, lng: 121.47 };
  const noCoords = { id: "new", name: "刚导入的楼", alias: [], lat: null, lng: null };
  const here = { lat: 31.2300, lng: 121.4710 };

  check("缺坐标的楼栋不参与「最近楼栋」计算",
    P.nearestBuilding(here, [noCoords, withCoords]).building.id === "ok");
  check("只有缺坐标的楼栋时返回 null",
    P.nearestBuilding(here, [noCoords]) === null);
  check("缺坐标的楼栋算不出步行时间",
    P.walkMetrics(here, noCoords, data.settings) === null);
  check("有坐标的楼栋照常算",
    P.walkMetrics(here, withCoords, data.settings).distance > 0);

  /* 缺坐标的楼栋不应该把整个路线链搞崩 */
  const campus = demo();
  campus.courses = [{ id: "x", name: "测试课", buildingId: "new", room: "101",
    weekdays: [1], start: "08:00", end: "09:00", weeks: [1, 30] }];
  campus.campus.buildings.push(noCoords);
  const legs = P.buildLegs(campus, here, new Date(2026, 8, 28, 7, 0, 0));
  check("缺坐标时路线链仍能生成，只是没有距离",
    legs.length === 1 && legs[0].metrics === null, legs.length);

  /* 地图渲染要跳过没有坐标的点 */
  const svg = { innerHTML: "" };
  OP.MapView.render(svg, {
    buildings: [withCoords, noCoords],
    position: here,
    stops: [
      { building: withCoords, order: 1, time: "08:00", isNext: true },
      { building: noCoords, order: 2, time: "10:00", isNext: false }
    ]
  });
  check("地图跳过缺坐标的楼栋",
    svg.innerHTML.indexOf("有坐标的楼") >= 0 && svg.innerHTML.indexOf("刚导入的楼") < 0);
  check("缺坐标的楼栋不会出现在图上",
    svg.innerHTML.indexOf("刚导入的楼") === -1 &&
    (svg.innerHTML.match(/<circle/g) || []).length === 3);   /* 一栋楼 + 我的位置两个圈 */

  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const ocrClasses = ["drop-zone", "progress", "progress-bar", "ocr-row", "ocr-note", "ocr-list", "bi-missing"];
  const missing = ocrClasses.filter((c) => css.indexOf("." + c) === -1);
  check("截图导入用到的样式都已定义", missing.length === 0, missing.join(", "));
}

console.log("\n[14] 底部留白（防止最后一个按钮滑不出来）");
{
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");

  /* 导航栏回到固定定位 + 页尾实测留白。
     （中途试过粘性页脚，按需求已回退）
     课表页那两个按钮改成放在卡片顶部，从根上不出现在页尾。 */
  const appBlock = /\.app\s*\{([^}]*)\}/.exec(css)[1];
  const viewsBlock = /\.views\s*\{([^}]*)\}/.exec(css)[1];
  const tabbarBlock = /\.tabbar\s*\{([^}]*)\}/.exec(css)[1];

  check("导航栏是固定定位", /position:\s*fixed/.test(tabbarBlock));
  check("导航栏贴着视口底部",
    /bottom:\s*0/.test(tabbarBlock) && /left:\s*0/.test(tabbarBlock));
  check(".app 回到普通文档流，不再用 flex",
    appBlock.indexOf("display: flex") === -1 && appBlock.indexOf("min-height") === -1,
    appBlock.replace(/\s+/g, " ").trim());
  check(".views 不参与伸缩", viewsBlock.indexOf("flex") === -1, viewsBlock.trim());
  check(".app 的页尾留白走 --bottom-space",
    appBlock.indexOf("padding-bottom: var(--bottom-space)") > 0);
  check("CSS 兜底留白足够大（脚本没跑起来也不会挡住按钮）",
    Number(/--bottom-space:\s*(\d+)px/.exec(css)[1]) >= 120,
    /--bottom-space:\s*(\d+)px/.exec(css)[1] + "px");

  /* 从根上解决：两个按钮挪到卡片顶部，不再出现在页尾 */
  const ocrCard = /<article class="card" id="ocrCard">[\s\S]*?<\/article>/.exec(html)[0];
  const actionsAt = ocrCard.indexOf('id="ocrActions"');
  check("OCR 的两个按钮在卡片里排在靠前的位置",
    actionsAt > 0 &&
    actionsAt < ocrCard.indexOf('id="ocrResult"') &&
    actionsAt < ocrCard.indexOf('id="ocrDrop"'),
    "位置 " + actionsAt);
  check("按钮就在卡片 head 之后，排在其余控件前面",
    actionsAt > ocrCard.indexOf('id="ocrStatus"') &&
    actionsAt < ocrCard.indexOf('id="ocrReplaceWrap"') &&
    actionsAt < ocrCard.indexOf('id="ocrProgress"'));

  check("脚本会实测导航栏占掉的高度并写进留白",
    appSource.indexOf("function measureBottomSpace") > 0 &&
    appSource.indexOf('setProperty("--bottom-space"') > 0);
  check("渲染完会核对最后一个卡片有没有被盖住",
    appSource.indexOf("function ensureBottomClearance") > 0 &&
    /function render\(\)[\s\S]{0,400}scheduleClearanceCheck/.test(appSource));
  check("核对会用滑到底时的位置来算，不用真的滚动",
    appSource.indexOf("root.scrollHeight - window.innerHeight") > 0 &&
    appSource.indexOf("window.scrollY") > 0);
  check("留白只增不减，避免反复抖动",
    /function setBottomSpace[\s\S]{0,300}next > current/.test(appSource));
  check("比较的是实际生效的值，不会把 CSS 兜底值改小",
    appSource.indexOf("function currentBottomSpace") > 0 &&
    appSource.indexOf("getComputedStyle(root)") > 0);
  check("留白有上限，不会无限长",
    /MAX_BOTTOM_SPACE = (\d+)/.test(appSource) &&
    Number(/MAX_BOTTOM_SPACE = (\d+)/.exec(appSource)[1]) >= 300);
  check("窗口尺寸变化和转屏时会重新测量",
    appSource.indexOf('addEventListener("resize"') > 0 &&
    appSource.indexOf('addEventListener("orientationchange"') > 0);
}

console.log("\n[15] 搜索附近的性能");
{
  const placesSource = fs.readFileSync(path.join(root, "js/places.js"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const Places = OP.Places;

  /* 实测量过：备用节点经常 45 秒超时，串行重试会让最坏情况变成两次超时叠加 */
  /* 这条只针对 Overpass 的半径查询：它必须是"对冲"而不是串行换节点。
     （名字检索里也有个 attempt，是另一回事，别误伤。） */
  check("Overpass 查询不再串行换节点，改成对冲",
    placesSource.indexOf("function queryOverpass") > 0 &&
    placesSource.indexOf("hedgeDelayFor") > 0 &&
    placesSource.indexOf("controllers.forEach") > 0);
  check("改成对冲请求：并行发、谁先回来用谁",
    placesSource.indexOf("hedgeDelayFor") > 0 && placesSource.indexOf("AbortController") > 0);

  check("800 米以内给到 30 秒", Places.timeoutFor(800) === 30000, Places.timeoutFor(800) + "ms");
  check("半径越大等得越久", Places.timeoutFor(2000) > Places.timeoutFor(800),
    Places.timeoutFor(800) + " → " + Places.timeoutFor(2000));
  check("超时有上限，不会无限等",
    Places.timeoutFor(50000) <= 180000 && Places.timeoutFor(99999) === 180000,
    Places.timeoutFor(99999) + "ms");
  check("大范围等得足够久（3 公里 70 秒以上）",
    Places.timeoutFor(3000) >= 70000, Places.timeoutFor(3000) + "ms");

  /* 服务端超时也要跟着放宽，否则会出现"客户端还在等、服务端先掐断" */
  const hugeQuery = Places.buildOverpassQuery(22.42, 114.20, 3000, 84);
  check("服务端超时跟着放宽到 84 秒", hugeQuery.indexOf("[timeout:84]") > 0, hugeQuery.slice(0, 22));
  check("服务端超时也有上限", /MAX_SERVER_TIMEOUT = \d+/.test(placesSource));
  check("对冲延迟随超时增长但不超过 8 秒",
    Places.hedgeDelayFor(15000) >= 3500 && Places.hedgeDelayFor(60000) <= 8000,
    Places.hedgeDelayFor(15000) + " / " + Places.hedgeDelayFor(60000));
  check("结果条数上限随半径放大，但有封顶",
    Places.resultLimitFor(1600) === 300 && Places.resultLimitFor(9000) === 400,
    Places.resultLimitFor(800) + " / " + Places.resultLimitFor(1600));

  const bigQuery = Places.buildOverpassQuery(22.42, 114.20, 3000, 50);
  check("大范围查询带上了更宽的服务端超时",
    bigQuery.indexOf("[timeout:50]") > 0, bigQuery.slice(0, 22));
  check("大范围查询放宽了结果条数", bigQuery.indexOf("out center 400;") > 0);
  check("小范围查询仍然是紧凑的",
    Places.buildOverpassQuery(22.42, 114.20, 800, 25).indexOf("out center 150;") > 0);
  check("已经有结果的节点会被取消，不白占带宽",
    placesSource.indexOf("c.abort()") > 0);
  check("同一个位置重复搜索走缓存",
    placesSource.indexOf("CACHE_TTL") > 0 && placesSource.indexOf("function clearCache") > 0);

  /* 切换显示名不该重新联网 */
  const item = {
    name: "Science Centre East Block",
    alias: ["科學館東座"],
    nameEn: "Science Centre East Block",
    nameZh: "科學館東座",
    allNames: ["科學館東座 Science Centre East Block", "科學館東座", "Science Centre East Block"],
    joinedName: "科學館東座 Science Centre East Block",
    distance: 100,
    teaching: true
  };

  Places.reorderNames(item, false);
  check("切回中文显示名，英文进别名",
    item.name === "科學館東座" && item.alias.indexOf("Science Centre East Block") >= 0,
    item.name + " / " + item.alias.join("、"));
  check("中英拼接名不会被当成别名塞进来",
    item.alias.indexOf("科學館東座 Science Centre East Block") === -1, item.alias.join("、"));

  Places.reorderNames(item, true);
  check("再切回英文可以还原", item.name === "Science Centre East Block", item.name);

  /* shape 是纯本地计算 */
  const raw = [
    { name: "Science Centre East Block", alias: ["科學館東座"], nameEn: "Science Centre East Block",
      nameZh: "科學館東座", allNames: ["科學館東座", "Science Centre East Block"], distance: 120, teaching: true },
    { name: "Lady Shaw Building", alias: [], nameEn: "Lady Shaw Building", nameZh: "",
      allNames: ["Lady Shaw Building"], distance: 300, teaching: true }
  ];
  check("本地重排能按关键词过滤",
    Places.shape(raw, { keyword: "lady", merge: false }).length === 1);
  check("本地重排不联网也能换语言",
    Places.shape(raw, { merge: false, preferEnglish: false })[0].name === "科學館東座",
    Places.shape(raw, { merge: false, preferEnglish: false })[0].name);
  check("本地重排结果不为空且没有坏数据",
    Places.shape(raw, {}).every((x) => x && x.name));

  /* 界面层的开关必须走本地重排 */
  const mergeHandler = /plMerge"\)\.addEventListener\("change", function \(\)[\s\S]{0,240}?\}\);/.exec(appSource);
  check("合并开关只做本地重排，不再重新联网",
    mergeHandler && mergeHandler[0].indexOf("reshapePlaces()") > 0 &&
    mergeHandler[0].indexOf("searchPlaces()") === -1,
    mergeHandler ? mergeHandler[0].replace(/\s+/g, " ").slice(0, 90) : "没找到");

  const englishHandler = /plEnglish"\)\.addEventListener\("change", function \(\)[\s\S]{0,240}?\}\);/.exec(appSource);
  check("英文名开关也只做本地重排",
    englishHandler && englishHandler[0].indexOf("reshapePlaces()") > 0 &&
    englishHandler[0].indexOf("searchPlaces()") === -1);

  check("名称过滤是边打边筛",
    appSource.indexOf('$("#plKeyword").addEventListener("input"') > 0);
  check("搜索时显示已用秒数，避免看起来像卡死",
    appSource.indexOf("startPlacesTicker") > 0 &&
    appSource.indexOf("搜索中… ") > 0);
}

console.log("\n[16] 清空校区楼栋");
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");

  check("设置里有清空按钮", html.indexOf('id="btnClearBuildings"') > 0);
  check("按钮和「新增楼栋」放在一起",
    /card-head-actions[\s\S]{0,300}btnAddBuilding[\s\S]{0,300}btnClearBuildings/.test(html));

  /* 处理函数里还有嵌套的 }); ，正则截不准，按位置切一段出来看 */
  const handlerStart = appSource.indexOf('btnClearBuildings").addEventListener("click"');
  const handlerBody = handlerStart >= 0 ? appSource.slice(handlerStart, handlerStart + 1600) : "";

  check("按钮接上了处理函数", handlerStart >= 0);
  check("清空前会弹确认框", handlerBody.indexOf("askConfirm(") > 0);
  check("确认框里会说明有几条课程受影响",
    handlerBody.indexOf("条课程安排在这些楼里") > 0);
  check("清空时会顺带收起编辑表单",
    handlerBody.indexOf('buildingForm").hidden = true') > 0);
  check("清空后会重新渲染", handlerBody.indexOf("saveAndRender()") > 0);
  check("楼栋为空时按钮不显示",
    /btnClearBuildings"\)\.hidden = !list\.length/.test(appSource));

  /* 清空只是去掉地点，课表本身不能受影响 */
  const cleared = demo();
  cleared.campus.buildings = [];
  const legsAfter = P.buildLegs(cleared, { lat: 31.2300, lng: 121.4710 }, new Date(2026, 8, 28, 7, 0, 0));

  check("清空楼栋后课表还在，只是没有地点",
    legsAfter.length === 3 && legsAfter.every((l) => l.building === null && l.metrics === null),
    legsAfter.length + " 条");
  check("清空楼栋后地点显示为「未知地点」",
    P.placeText(legsAfter[0].course, null).indexOf("未知地点") >= 0,
    P.placeText(legsAfter[0].course, null));
  check("清空楼栋后最近楼栋返回 null",
    P.nearestBuilding({ lat: 31.23, lng: 121.47 }, []) === null);
  check("清空楼栋后步行时间也算不出来",
    P.walkMetrics({ lat: 31.23, lng: 121.47 }, null, cleared.settings) === null);

  const emptySvg = { innerHTML: "" };
  OP.MapView.render(emptySvg, { buildings: [], position: { lat: 31.23, lng: 121.47 }, legs: [] });
  check("清空楼栋后地图给出添加提示，不会崩",
    emptySvg.innerHTML.indexOf("还没有楼栋坐标") >= 0);
}

console.log("\n[17] 确认弹窗不依赖浏览器原生对话框");
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  /* 内置浏览器 / WebView 会把 window.confirm() 静默屏蔽，
     点了按钮像"没反应"。所以全部换成页面内自己的弹窗。 */
  const codeOnly = appSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  check("代码里不再调用原生确认框", codeOnly.indexOf("window.confirm") === -1);
  check("原生 alert / prompt 也没有用到",
    codeOnly.indexOf("window.alert") === -1 && codeOnly.indexOf("window.prompt") === -1);

  const calls = (appSource.match(/askConfirm\(/g) || []).length;
  /* 可撤销的三处（删宿舍 / 删课程 / 恢复默认配置）已经改成"直接做 + 撤销提示条"，
     弹窗只剩真正不可逆的那几处（清空楼栋、恢复默认数据、导入覆盖课表）。 */
  check("剩下的确认框都换成了页面内弹窗", calls >= 3, calls + " 处");

  check("弹窗结构在页面里", html.indexOf('id="confirmBox"') > 0 &&
    html.indexOf('id="confirmOk"') > 0 && html.indexOf('id="confirmCancel"') > 0);
  check("弹窗用了 role=dialog", html.indexOf('role="dialog"') > 0);
  check("确认和取消都接上了处理函数",
    appSource.indexOf('$("#confirmOk").addEventListener') > 0 &&
    appSource.indexOf('$("#confirmCancel").addEventListener') > 0);
  check("点遮罩也能取消", /confirmBox"\)\.addEventListener[\s\S]{0,200}closeConfirm/.test(appSource));
  check("确认文字原样换行显示", css.indexOf("white-space: pre-wrap") > 0);
  check("弹窗隐藏时要真的不显示（flex 会盖掉 hidden 属性）",
    /\.modal\[hidden\]\s*\{\s*display:\s*none/.test(css));
  check("弹窗盖在底部导航和提示条之上",
    Number(/\.modal\s*\{[^}]*z-index:\s*(\d+)/.exec(css)[1]) > 40,
    /\.modal\s*\{[^}]*z-index:\s*(\d+)/.exec(css)[1]);
}

console.log("\n[18] 校区楼栋搜索");
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  check("设置里有楼栋搜索框", html.indexOf('id="buildingSearch"') > 0);
  check("有「只看还没坐标的」开关", html.indexOf('id="buildingMissingOnly"') > 0);
  check("有数量提示行", html.indexOf('id="buildingCount"') > 0);

  const buildings = [
    { id: "b1", name: "Science Centre East Block", alias: ["科學館東座"], lat: 22.4196, lng: 114.2068 },
    { id: "b2", name: "碧秋樓", alias: ["Pi Ch'iu Building"], lat: null, lng: null },
    { id: "b3", name: "Lady Shaw Building", alias: [], lat: 22.42, lng: 114.21 },
    { id: "b4", name: "Lee Shau Kee Building", alias: ["李兆基樓"], lat: null, lng: null }
  ];

  check("不填关键词就返回全部", P.filterBuildings(buildings, "", false).length === 4);
  check("按英文名搜", P.filterBuildings(buildings, "lady", false).length === 1);
  check("用「lady shaw」两个词也能搜到",
    P.filterBuildings(buildings, "lady shaw", false).length === 1,
    P.filterBuildings(buildings, "lady shaw", false).map(function (b) { return b.name; }).join("/"));
  check("按中文名搜", P.filterBuildings(buildings, "碧秋", false).length === 1);
  check("按英文别名搜", P.filterBuildings(buildings, "ch'iu", false).length === 1);
  check("按中文别名搜", P.filterBuildings(buildings, "李兆基", false).length === 1);
  check("大小写不敏感", P.filterBuildings(buildings, "SCIENCE", false).length === 1);
  check("搜不到就是空", P.filterBuildings(buildings, "zzzz", false).length === 0);
  check("前后空格会被忽略", P.filterBuildings(buildings, "  lady  ", false).length === 1);

  check("只看缺坐标时筛出没录的",
    P.filterBuildings(buildings, "", true).length === 2 &&
    P.filterBuildings(buildings, "", true).every((b) => b.lat === null),
    P.filterBuildings(buildings, "", true).map((b) => b.name).join("/"));
  check("关键词和缺坐标可以叠加",
    P.filterBuildings(buildings, "lee", true).length === 1);
  check("叠加后筛不到就是空", P.filterBuildings(buildings, "lady", true).length === 0);
  check("空列表不会报错", P.filterBuildings([], "x", true).length === 0);
  check("楼栋没写别名字段也不报错",
    P.filterBuildings([{ id: "x", name: "A Building", lat: 1, lng: 2 }], "a", false).length === 1);

  check("搜索框接的是本地筛选，不联网",
    appSource.indexOf('$("#buildingSearch").addEventListener("input"') > 0);
  check("缺坐标开关也接上了",
    appSource.indexOf('$("#buildingMissingOnly").addEventListener("change"') > 0);
  check("列表渲染走统一的筛选函数",
    appSource.indexOf("P.filterBuildings(all, query, missingOnly)") > 0);
  check("会显示总数和缺坐标数量", appSource.indexOf("栋还没坐标") > 0);
  check("筛不到时给提示而不是留白", appSource.indexOf("没有匹配的楼栋") > 0);

  /* 用户实际遇到的问题：搜 "lady shaw" 什么都没有，
     因为「只看还没坐标的」还勾着，而旧提示完全不提这件事 */
  check("筛不出时会说清是哪一步滤掉的",
    appSource.indexOf("function emptyMessage") > 0 &&
    appSource.indexOf("但被「只看还没坐标的」筛掉了") > 0);
  check("开启「只看还没坐标的」时列表上方会标明",
    appSource.indexOf("「只看还没坐标的」已开启") > 0);

  /* 这正是出问题的组合：楼有坐标 + 勾了只看缺坐标 → 被筛掉 */
  const withCoords = buildings.filter((b) => typeof b.lat === "number");
  check("有坐标的楼在「只看缺坐标」下会被筛掉（这正是搜不到 lady shaw 的原因）",
    P.filterBuildings(withCoords, "lady shaw", true).length === 0 &&
    P.filterBuildings(withCoords, "lady shaw", false).length === 1);

  check("搜索框有独立样式", /\.field input\[type="search"\]/.test(css));
}

console.log("\n[19] 导入合并与坐标文件");
{
  const Store = OP.Store;

  /* 只有楼栋、没有课表的文件，不能把课表顶掉，也不能把楼栋整体换掉 */
  const mine = demo();
  mine.courses = [{ id: "mine", name: "我的课", teacher: "", buildingId: "A", room: "101",
    weekdays: [1], start: "08:00", end: "09:00", weeks: [1, 30] }];
  const originalCount = mine.campus.buildings.length;

  const addOne = { campus: { buildings: [
    { id: "new1", name: "Lee Shau Kee Building", alias: ["李兆基樓"], lat: 22.41953, lng: 114.203955 }
  ] } };
  const outcome = Store.applyImport(mine, addOne);

  check("只带楼栋的文件不会动课表",
    mine.courses.length === 1 && mine.courses[0].name === "我的课", mine.courses.length + " 条");
  check("也不会把课表替换成示例数据", outcome.replacedCourses === false);
  check("楼栋是追加而不是替换",
    mine.campus.buildings.length === originalCount + 1 && outcome.addedBuildings === 1,
    originalCount + " → " + mine.campus.buildings.length);
  check("重复导入同一栋不会产生两份",
    Store.applyImport(mine, addOne).addedBuildings === 0 &&
    mine.campus.buildings.length === originalCount + 1);

  /* 别名相同也算同一栋 */
  const aliasClash = { campus: { buildings: [
    { id: "new2", name: "Some Other Name", alias: ["李兆基樓"], lat: 22.41953, lng: 114.203955 }
  ] } };
  check("别名撞上已知楼栋也算重复", Store.applyImport(mine, aliasClash).addedBuildings === 0);

  /* 带课表的文件是完整备份，整体替换 */
  const full = demo();
  full.courses = [{ id: "c9", name: "备份里的课", teacher: "", buildingId: "A", room: "",
    weekdays: [2], start: "10:00", end: "11:00", weeks: [1, 30] }];
  full.campus.buildings = [{ id: "only", name: "唯一的一栋", alias: [], lat: 1, lng: 2 }];
  const fullOutcome = Store.applyImport(mine, full);
  check("带课表的文件会整体替换",
    fullOutcome.replacedCourses === true && mine.courses.length === 1 &&
    mine.courses[0].name === "备份里的课");
  check("带课表的文件里楼栋也是整体替换",
    mine.campus.buildings.length === 1 && mine.campus.buildings[0].name === "唯一的一栋");

  /* 坏数据不能把程序搞崩 */
  check("空内容不会报错",
    Store.applyImport(demo(), null).addedBuildings === 0 &&
    Store.applyImport(demo(), {}).addedBuildings === 0);
  check("楼栋里没有 name 的会被跳过",
    Store.applyImport(demo(), { campus: { buildings: [{ id: "x", alias: [], lat: 1, lng: 2 }] } })
      .addedBuildings === 0);

  /* ---------- 港中文坐标文件 ---------- */
  const raw = fs.readFileSync(path.join(root, "cuhk-buildings.json"), "utf8");
  const cuhk = JSON.parse(raw);

  check("坐标文件是合法 JSON 且有 7 栋楼", cuhk.campus.buildings.length === 7,
    cuhk.campus.buildings.length);
  check("每栋都有名字、别名和坐标",
    cuhk.campus.buildings.every((b) => b.name && b.alias && b.alias.length &&
      typeof b.lat === "number" && typeof b.lng === "number"));
  check("坐标都落在港中文一带",
    cuhk.campus.buildings.every((b) => b.lat > 22.40 && b.lat < 22.43 &&
      b.lng > 114.19 && b.lng < 114.22),
    cuhk.campus.buildings.map((b) => b.lat.toFixed(4)).join(" / "));

  /* 课表里出现的英文写法，都应该能匹配上这份文件 */
  const timetableNames = [
    "Lee Shau Kee Building", "Y.C. Liang Hall", "Lady Shaw Bldg",
    "Esther Lee Bldg", "Wu Ho Man Yuen Bldg", "Yasumoto Int'l Acad Park", "Science Centre"
  ];
  const unmatched = timetableNames.filter(function (n) {
    return !OP.Ocr.matchBuilding(n, cuhk.campus.buildings);
  });
  check("课表里 7 种写法全都能匹配上这份坐标文件",
    unmatched.length === 0, unmatched.join(" / "));

  /* 这份文件导入后，课表里的地点就能算出距离 */
  const loaded = demo();
  const imported = Store.applyImport(loaded, cuhk);
  check("导入后楼栋数增加 7", imported.addedBuildings === 7, imported.addedBuildings);

  const lsk = P.filterBuildings(loaded.campus.buildings, "李兆基", false)[0];
  check("导入后能用中文搜到李兆基楼", !!lsk && lsk.name === "Lee Shau Kee Building",
    lsk && lsk.name);

  /* 用真实导入的楼栋列表，测用户实际会输的查询词 */
  const realList = cuhk.campus.buildings;
  const queries = [
    ["lady shaw", "Lady Shaw Building"],
    ["Lady", "Lady Shaw Building"],
    ["邵逸夫", "Lady Shaw Building"],
    ["lady", "Lady Shaw Building"]
  ];
  const missed = queries.filter(function (pair) {
    return P.filterBuildings(realList, pair[0], false).length === 0;
  });
  check("在真实楼栋列表上，几种写法都搜得到",
    missed.length === 0,
    missed.map(function (p) { return p[0]; }).join(" / "));

  check("导入后能算出到李兆基楼的步行时间",
    P.walkMetrics({ lat: 22.4196, lng: 114.2068 }, lsk, loaded.settings).distance > 0);
}

console.log("\n[20] 楼栋按名字排序");
{
  const Store = OP.Store;

  const en = [
    { id: "e1", name: "Zeta Hall" },
    { id: "e2", name: "alpha Building" },
    { id: "e3", name: "Y.C. Liang Hall" },
    { id: "e4", name: "Building 10" },
    { id: "e5", name: "Building 2" }
  ];
  const sorted = Store.sortBuildings(en).map((b) => b.name);

  check("英文按字母序，大小写不敏感", sorted[0] === "alpha Building", sorted.join(" / "));
  check("数字按数值大小排（Building 2 在 Building 10 前面）",
    sorted.indexOf("Building 2") < sorted.indexOf("Building 10"), sorted.join(" / "));
  check("完整顺序符合预期",
    sorted.join("|") === "alpha Building|Building 2|Building 10|Y.C. Liang Hall|Zeta Hall",
    sorted.join(" / "));
  check("排序返回新数组，不动原来的",
    en[0].name === "Zeta Hall" && en.length === 5);

  const cn = [{ name: "音乐厅" }, { name: "实验楼" }, { name: "图书馆" }, { name: "体育馆" }];
  const sortedCn = Store.sortBuildings(cn).map((b) => b.name);
  check("中文按拼音排序",
    sortedCn.join("|") === "实验楼|体育馆|图书馆|音乐厅", sortedCn.join(" / "));

  check("空列表不会报错", Store.sortBuildings([]).length === 0);
  check("缺 name 的排在最前面但不会崩",
    Store.sortBuildings([{ id: "x" }, { name: "Alpha" }])[0].id === "x");

  /* 从本地读取时就应该已经排好 */
  const sortMemory = {};
  sortMemory[OP.Store.KEYS.buildings] = JSON.stringify({
    defaultVersion: OP.Store.defaultBuildingsVersion(),
    name: "测试校区",
    buildings: [
      { id: "b", name: "音乐厅", alias: [], lat: 1, lng: 2 },
      { id: "a", name: "第二教学楼", alias: [], lat: 1, lng: 2 }
    ]
  });
  const sortRealStorage = global.localStorage;
  global.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(sortMemory, key) ? sortMemory[key] : null),
    setItem: (key, value) => { sortMemory[key] = String(value); },
    removeItem: (key) => { delete sortMemory[key]; }
  };
  const loadedNames = Store.load().campus.buildings.map((b) => b.name);
  global.localStorage = sortRealStorage;
  check("从本地读取时就已经排好序",
    loadedNames[0] === "第二教学楼" && loadedNames[loadedNames.length - 1] === "音乐厅",
    loadedNames.join(" / "));

  /* 保存前重排，保证列表、下拉框、导出的顺序一致 */
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  check("保存前会重排一次",
    /function save\(\)[\s\S]{0,240}Store\.sortBuildings/.test(appSource));

  /* 地图导入和课表导入之后也要保持有序 */
  check("导入后走的是同一个保存路径",
    appSource.indexOf("saveAndRender()") > 0);
}

console.log("\n[21] 播报时楼栋念中文名 + 英文简称");
{
  const sp = P.splitName("李兆基樓 Lee Shau Kee Building");
  check("能从混合名字里拆出中英文",
    sp.zh === "李兆基樓" && sp.en === "Lee Shau Kee Building", sp.zh + " | " + sp.en);

  const names = P.buildingNames({ name: "Lee Shau Kee Building", alias: ["李兆基樓"] });
  check("显示名是英文时，中文从别名里补",
    names.zh === "李兆基樓" && names.en === "Lee Shau Kee Building", JSON.stringify(names));

  check("英文简称去掉结尾的通用词",
    P.shortEnglishName("Lee Shau Kee Building") === "Lee Shau Kee" &&
    P.shortEnglishName("Lady Shaw Building") === "Lady Shaw" &&
    P.shortEnglishName("Y.C. Liang Hall") === "Y.C. Liang" &&
    P.shortEnglishName("Wu Ho Man Yuen Building") === "Wu Ho Man Yuen",
    P.shortEnglishName("Lee Shau Kee Building"));
  check("词太少就不削，避免削成没意义的名字",
    P.shortEnglishName("Science Centre") === "Science Centre",
    P.shortEnglishName("Science Centre"));
  check("结尾不是通用词就保持原样",
    P.shortEnglishName("Yasumoto International Academic Park") === "Yasumoto International Academic Park");
  check("空名字返回空", P.shortEnglishName("") === "" && P.shortEnglishName(null) === "");

  /* 真课表里的 7 栋楼 */
  const spoken = [
    [{ name: "Lee Shau Kee Building", alias: ["李兆基樓"] }, "李兆基樓 Lee Shau Kee"],
    [{ name: "Y.C. Liang Hall", alias: ["潤昌堂"] }, "潤昌堂 Y.C. Liang"],
    [{ name: "Lady Shaw Building", alias: ["邵逸夫夫人樓"] }, "邵逸夫夫人樓 Lady Shaw"],
    [{ name: "Esther Lee Building", alias: ["利黃瑤璧樓"] }, "利黃瑤璧樓 Esther Lee"],
    [{ name: "Wu Ho Man Yuen Building", alias: ["伍何曼原樓"] }, "伍何曼原樓 Wu Ho Man Yuen"],
    [{ name: "Science Centre", alias: ["科學館"] }, "科學館 Science Centre"],
    [{ name: "Yasumoto International Academic Park", alias: ["康本國際學術園"] },
      "康本國際學術園 Yasumoto International Academic Park"]
  ];
  const wrongSpoken = spoken.filter(function (pair) {
    return P.spokenName(pair[0]) !== pair[1];
  });
  check("7 栋楼的念法都符合预期", wrongSpoken.length === 0,
    wrongSpoken.map(function (p) { return P.spokenName(p[0]); }).join(" / "));

  check("只有中文就念中文", P.spokenName({ name: "碧秋樓", alias: [] }) === "碧秋樓");
  check("只有英文就念英文",
    P.spokenName({ name: "Some English Hall", alias: [] }) === "Some English");
  check("没有楼栋时说未知地点", P.spokenName(null) === "未知地点");

  /* 教室号要跟着念，并且用逗号断开 */
  const lsk = { id: "l", name: "Lee Shau Kee Building", alias: ["李兆基樓"],
    lat: 22.41953, lng: 114.203955 };
  check("播报里教室号跟在楼名后面、用逗号断开",
    P.spokenPlace({ room: "LT2" }, lsk) === "李兆基樓 Lee Shau Kee，LT2",
    P.spokenPlace({ room: "LT2" }, lsk));
  check("没有教室号时只念楼名",
    P.spokenPlace({ room: "" }, lsk) === "李兆基樓 Lee Shau Kee");

  /* 真正的播报文案 */
  const cuhk = demo();
  cuhk.campus.buildings = [lsk];
  cuhk.courses = [{ id: "c1", name: "ENGG 1110-A Lecture", teacher: "", buildingId: "l",
    room: "LT2", weekdays: [4], start: "15:30", end: "16:15", weeks: [1, 30] }];

  /* 2026-10-08 是星期四。**别用 10-01**：那天是国庆假期，校历一生效整天就没课了 */
  const thursday = new Date(2026, 9, 8, 15, 0, 0);
  const nextText = P.nextText(cuhk, thursday, { lat: 22.4196, lng: 114.2068 });
  check("下一节播报里中英文名字都有",
    nextText.indexOf("李兆基樓") >= 0 && nextText.indexOf("Lee Shau Kee") >= 0, nextText);
  check("下一节播报里带着教室号", nextText.indexOf("LT2") >= 0, nextText);

  const brief = P.briefingText(cuhk, thursday, { lat: 22.4196, lng: 114.2068 });
  check("课表播报里也是中文名 + 英文简称",
    brief.indexOf("李兆基樓") >= 0 && brief.indexOf("Lee Shau Kee，LT2") >= 0, brief);

  const legs = P.buildLegs(cuhk, { lat: 22.4196, lng: 114.2068 }, new Date(2026, 9, 8, 14, 0, 0));
  const leave = P.leaveText(legs[0], new Date(2026, 9, 8, 15, 0, 0));
  check("出发提醒里也是中文名 + 英文简称",
    leave.indexOf("李兆基樓") >= 0 && leave.indexOf("Lee Shau Kee") >= 0, leave);

  /* 界面显示不能跟着变，只有播报用新念法 */
  check("界面显示仍然是楼栋的显示名",
    P.placeText(cuhk.courses[0], lsk) === "Lee Shau Kee Building LT2",
    P.placeText(cuhk.courses[0], lsk));
}

console.log("\n[22] 部署时给资源加版本号");
{
  const deploySource = fs.readFileSync(path.join(root, "tools/deploy.js"), "utf8");
  const srcHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

  /* 浏览器会死抱缓存里的旧 js/css，用户就会觉得"改了怎么没生效"。
     每次部署换一个版本号，缓存自然失效。 */
  check("部署脚本会给资源地址加版本号",
    deploySource.indexOf("stamp") > 0 && deploySource.indexOf("Date.now().toString(36)") > 0);

  /* 直接把脚本里的替换规则搬过来试一遍 */
  const rule = /(href|src)="((?:styles\.css|(?:js|data)\/[^"]+\.js))"/g;
  const transformed = srcHtml.replace(rule, '$1="$2?v=TEST"');

  check("样式表会被加上版本号",
    transformed.indexOf('href="styles.css?v=TEST"') > 0);
  check("每个 js 都会被加上版本号",
    transformed.indexOf('src="js/app.js?v=TEST"') > 0 &&
    transformed.indexOf('src="js/ocr.js?v=TEST"') > 0 &&
    transformed.indexOf('src="data/buildings.js?v=TEST"') > 0 &&
    transformed.indexOf('src="data/defaults.js?v=TEST"') > 0);
  check("不会误伤别的链接",
    transformed.indexOf('cuhk-buildings.json?v=') === -1 &&
    transformed.indexOf('href="styles.css?v=TEST?v=') === -1);
  check("脚本引用数量没变（只是加了参数）",
    (transformed.match(/<script/g) || []).length === (srcHtml.match(/<script/g) || []).length);

  /* 源文件不该带版本号——那是部署时才生成的 */
  check("源文件本身保持干净",
    srcHtml.indexOf("styles.css?v=") === -1 && srcHtml.indexOf("js/app.js?v=") === -1);
}

console.log("\n[23] 垂直距离（爬升）计算");
{
  const settings = OP.Store.defaults().settings;

  /* 用真实的港中文海拔：康本学园在山脚，润昌堂在山顶，差 114 米 */
  const low = { id: "low", name: "Yasumoto", lat: 22.416258, lng: 114.211124, elevation: 32 };
  const high = { id: "high", name: "Y.C. Liang Hall", lat: 22.420101, lng: 114.206546, elevation: 146 };

  const uphill = P.walkMetrics(low, high, settings);
  check("爬升被算出来", uphill.hasElevation && Math.round(uphill.rise) === 114, uphill.rise + " 米");
  check("爬升会明显拉长步行时间", uphill.minutes > 20, uphill.minutes.toFixed(1) + " 分钟");

  const noClimb = P.walkMetrics(low, high, Object.assign({}, settings, { climbFactor: 0 }));
  check("爬升折算设成 0 就退回纯水平距离",
    Math.abs(noClimb.minutes - noClimb.distance / settings.walkingSpeed) < 0.01);
  check("算上爬升后时间几乎翻倍",
    uphill.minutes > noClimb.minutes * 1.8,
    noClimb.minutes.toFixed(1) + " → " + uphill.minutes.toFixed(1) + " 分钟");

  const downhill = P.walkMetrics(high, low, settings);
  check("下坡不算爬升", downhill.hasElevation && downhill.rise === 0);
  check("下坡时间与平地一致",
    Math.abs(downhill.minutes - downhill.distance / settings.walkingSpeed) < 0.01);

  /* 只有一边有海拔时不能瞎算成平地——要标记出来 */
  const oneSide = P.walkMetrics({ lat: 22.416258, lng: 114.211124 }, high, settings);
  check("只有一边有海拔时标记为「未知」而不是平路",
    oneSide.hasElevation === false && oneSide.rise === 0);
  check("缺海拔时退回原来的算法",
    Math.abs(oneSide.minutes - oneSide.distance / settings.walkingSpeed) < 0.01);

  const half = P.walkMetrics(low, high, Object.assign({}, settings, { climbFactor: 4 }));
  check("爬升系数可调，减半后时间也少",
    half.minutes < uphill.minutes && half.minutes > noClimb.minutes,
    half.minutes.toFixed(1) + " 分钟");

  check("默认爬升系数是 8（Naismith 经验值）", settings.climbFactor === 8, settings.climbFactor);

  /* 播报里要提爬升 */
  const campus = demo();
  campus.campus.buildings = [low, high];
  campus.courses = [{ id: "c1", name: "TEST 1001-A Lecture", teacher: "", buildingId: "high",
    room: "L3", weekdays: [4], start: "15:30", end: "16:15", weeks: [1, 30] }];

  const nextText = P.nextText(campus, new Date(2026, 9, 8, 15, 0, 0), low);
  check("下一节播报里会提到爬升", nextText.indexOf("爬升") > 0, nextText);

  const legs = P.buildLegs(campus, low, new Date(2026, 9, 8, 14, 0, 0));
  const leaveText = P.leaveText(legs[0], new Date(2026, 9, 8, 15, 0, 0));
  check("出发提醒里也会提爬升", leaveText.indexOf("爬升") > 0, leaveText);

  /* 海拔模块本身 */
  const E = OP.Elevation;
  /* ---------- 多段行程里每一段都要带上起点海拔 ----------
     踩过的坑：通往下一段时起点被重建成 { lat, lng }，海拔字段丢了，
     结果只有第一段显示爬升，后面全按"未知"处理。 */
  const climbWorld = demo();
  climbWorld.campus.buildings = [
    { id: "ycl", name: "Y.C. Liang Hall", alias: [], lat: 22.420101, lng: 114.206546, elevation: 146 },
    { id: "sc", name: "Science Centre", alias: [], lat: 22.419831, lng: 114.207342, elevation: 107 },
    { id: "lsk", name: "Lee Shau Kee Building", alias: [], lat: 22.419530, lng: 114.203955, elevation: 119 },
    { id: "lsb", name: "Lady Shaw Building", alias: [], lat: 22.418885, lng: 114.206690, elevation: 99 }
  ];
  climbWorld.courses = [
    { id: "d1", name: "A", teacher: "", buildingId: "ycl", room: "", weekdays: [1], start: "09:30", end: "11:15", weeks: [1, 30] },
    { id: "d2", name: "B", teacher: "", buildingId: "sc", room: "", weekdays: [1], start: "11:30", end: "12:15", weeks: [1, 30] },
    { id: "d3", name: "C", teacher: "", buildingId: "lsk", room: "", weekdays: [1], start: "14:30", end: "16:15", weeks: [1, 30] },
    { id: "d4", name: "D", teacher: "", buildingId: "lsb", room: "", weekdays: [1], start: "16:30", end: "18:15", weeks: [1, 30] }
  ];

  const climbLegs = P.buildLegs(
    climbWorld,
    { lat: 22.4155, lng: 114.2105, elevation: 28 },
    new Date(2026, 8, 28, 7, 0, 0)
  );

  check("四段行程都算得出爬升（不只是第一段）",
    climbLegs.length === 4 && climbLegs.every((l) => l.metrics.hasElevation),
    climbLegs.map((l) => (l.metrics.hasElevation ? "有" : "无")).join(""));
  check("第一段爬升 118 米（28 → 146）",
    Math.round(climbLegs[0].metrics.rise) === 118, climbLegs[0].metrics.rise);
  check("第二段是下坡，爬升为 0（146 → 107）",
    climbLegs[1].metrics.rise === 0, climbLegs[1].metrics.rise);
  check("第三段有 12 米爬升（107 → 119）",
    Math.round(climbLegs[2].metrics.rise) === 12, climbLegs[2].metrics.rise);
  check("第四段又是下坡（119 → 99）",
    climbLegs[3].metrics.rise === 0, climbLegs[3].metrics.rise);
  check("每一段的起点都带着海拔",
    climbLegs.every((l) => !l.fromPoint || typeof l.fromPoint.elevation === "number"),
    climbLegs.map((l) => l.fromPoint && typeof l.fromPoint.elevation).join(","));

  check("海拔接口是免密钥的 Open-Meteo", E.ENDPOINT.indexOf("open-meteo.com") > 0, E.ENDPOINT);
  check("坐标取到约 11 米精度后当作缓存键",
    E.keyOf(22.41953, 114.203955) === "22.4195,114.2040", E.keyOf(22.41953, 114.203955));
  check("接口地址带上了经纬度",
    /latitude=\d/.test(E.ENDPOINT) === false && E.ENDPOINT.indexOf("elevation") > 0);
}

console.log("\n[24] 真实地图底图");
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const R = OP.RealMap;

  check("提供简图 / 街道图 / 港中文三种底图", !!R && !!R.SOURCES.osm && !!R.SOURCES.cuhk);
  check("OSM 瓦片地址正确",
    R.SOURCES.osm.url === "https://tile.openstreetmap.org/{z}/{x}/{y}.png", R.SOURCES.osm.url);
  check("港中文瓦片用了 {-y} 翻转 y 轴（它的 y 轴和标准 XYZ 反的）",
    R.SOURCES.cuhk.url.indexOf("/{-y}.png") > 0, R.SOURCES.cuhk.url);
  check("两种底图都带版权署名",
    R.SOURCES.osm.attribution.indexOf("OpenStreetMap") > 0 &&
    R.SOURCES.cuhk.attribution.indexOf("香港中文大學") > 0);

  /* Leaflet 按需加载，不选真实地图就不下载 */
  check("Leaflet 是选中真实地图时才加载",
    /function loadLeaflet/.test(fs.readFileSync(path.join(root, "js/realmaps.js"), "utf8")) &&
    appSource.indexOf("OP.RealMap.render") > 0);

  check("页面上有三个底图切换按钮",
    ["schematic", "osm", "cuhk"].every(function (m) {
      return html.indexOf('data-mapmode="' + m + '"') > 0;
    }));
  check("默认是简图（离线可用、不依赖外部资源）",
    OP.Store.defaults().settings.mapMode === "schematic");

  /* 踩过的坑：写成后代选择器会连 Leaflet 版权栏里的国旗 SVG 一起拉伸 */
  check("SVG 尺寸规则只作用于简图本身，不能写成后代选择器",
    /#mapSvg\s*\{[^}]*width:\s*100%/.test(css) &&
    !/\.map-wrap\s+svg\s*\{/.test(css));

  /* 另一个坑：SVG 元素没有 hidden 这个 DOM 属性 */
  const appCodeOnly = appSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  check("显示切换用 display，不用 hidden 属性",
    /svg\.style\.display/.test(appCodeOnly) &&
    appCodeOnly.indexOf("svg.hidden") === -1,
    "app.js 里应使用 style.display");
  check("真实地图容器有明确高度（Leaflet 需要）",
    /#mapReal\s*\{[^}]*height:\s*\d+px/.test(css));
}

console.log("\n[25] 按名字搜楼栋（解决半径搜索被截断）");
{
  const Places = OP.Places;
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const placesSource = fs.readFileSync(path.join(root, "js/places.js"), "utf8");

  /* 用户遇到的问题：800 米内有 138 栋带名字的建筑，而半径搜索上限就是 150 条 */
  check("半径搜索确实有条数上限（这就是搜不到的原因）",
    Places.resultLimitFor(800) === 150 && Places.resultLimitFor(8000) === 400,
    "800 米上限 " + Places.resultLimitFor(800) + " 条");

  check("名字搜索走 OSM 官方地名检索，不是 Overpass",
    placesSource.indexOf("nominatim.openstreetmap.org") > 0 &&
    placesSource.indexOf("function searchByName") > 0);
  check("名字搜索不按距离过滤（多远都要找出来）",
    placesSource.indexOf("finalize(results, origin, 0)") > 0);
  check("会再取一次 OSM 原始标签拿中英文名",
    placesSource.indexOf("function fetchOsmTags") > 0 &&
    placesSource.indexOf("api.openstreetmap.org/api/0.6") > 0);
  check("取不到标签时退回 Nominatim 的名字",
    placesSource.indexOf("labelToNames(label)") > 0);

  const parsed = Places.labelToNames("邵逸夫夫人樓 Lady Shaw Building");
  check("从混合标签里拆出中英文",
    parsed.name === "Lady Shaw Building" && parsed.alias.indexOf("邵逸夫夫人樓") >= 0,
    parsed.name + " / " + parsed.alias.join("、"));
  check("只有中文时用中文当名字",
    Places.labelToNames("邵逸夫夫人樓").name === "邵逸夫夫人樓");
  check("空标签返回 null", Places.labelToNames("") === null);

  /* 缩写直接拿去检索是搜不到的，必须先展开 */
  check("缩写会展开后再检索",
    Places.expandAbbreviations("Yasumoto Int'l Acad Park") === "Yasumoto International Academic Park" &&
    Places.expandAbbreviations("Lady Shaw Bldg") === "Lady Shaw Building",
    Places.expandAbbreviations("Yasumoto Int'l Acad Park"));
  check("本来就没有缩写的保持原样",
    Places.expandAbbreviations("Science Centre") === "Science Centre");

  check("设置里有「按名字搜」的输入框和按钮",
    html.indexOf('id="plNameQuery"') > 0 && html.indexOf('id="btnSearchByName"') > 0);
  check("名字框里回车也能搜",
    appSource.indexOf('$("#plNameQuery").addEventListener("keydown"') > 0);
  check("半径结果顶到上限时会提醒改用名字搜",
    appSource.indexOf("结果已达上限，可能有楼栋没列出来") > 0 &&
    appSource.indexOf("OP.Places.resultLimitFor(radius)") > 0);
}

console.log("\n[26] 自动补齐楼栋");
{
  const Places = OP.Places;
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const placesSource = fs.readFileSync(path.join(root, "js/places.js"), "utf8");

  /* 课表写法 → OSM 候选，挑最像的那个 */
  const candidates = [
    { name: "Lady Shaw Building", alias: ["邵逸夫夫人樓"], lat: 22.418885, lng: 114.206690 },
    { name: "Sir Run Run Shaw Hall", alias: ["邵逸夫堂"], lat: 22.4196, lng: 114.2070 },
    { name: "Shaw College", alias: ["逸夫書院"], lat: 22.42, lng: 114.20 }
  ];

  const picked = Places.bestNameMatch("Lady Shaw Bldg", candidates, 0.6);
  check("课表里的缩写能挑中对应那栋",
    picked && picked.name === "Lady Shaw Building", picked && picked.name);
  check("挑中的候选带上了把握分数", picked && picked.matchScore > 0.9,
    picked && picked.matchScore.toFixed(2));

  const byAlias = Places.bestNameMatch("邵逸夫夫人樓", candidates, 0.6);
  check("用中文别名也能挑中", byAlias && byAlias.name === "Lady Shaw Building",
    byAlias && byAlias.name);

  const nearMiss = Places.bestNameMatch("Lady Shaw Bldg", candidates.slice(1), 0.6);
  check("都不太像时返回 null，不硬凑",
    nearMiss === null || nearMiss.name === "Sir Run Run Shaw Hall",
    nearMiss && nearMiss.name);

  check("空的候选列表返回 null", Places.bestNameMatch("Anything", [], 0.6) === null);

  /* 真实课表里的写法，逐个验证能挑对 */
  const osmList = JSON.parse(fs.readFileSync(path.join(root, "cuhk-buildings.json"), "utf8")).campus.buildings;
  const pairs = [
    ["Lady Shaw Bldg", "Lady Shaw Building"],
    ["Lee Shau Kee Building", "Lee Shau Kee Building"],
    ["Yasumoto Int'l Acad Park", "Yasumoto International Academic Park"],
    ["Science Centre", "Science Centre"],
    ["Y.C. Liang Hall", "Y.C. Liang Hall"]
  ];
  const wrong = pairs.filter(function (pair) {
    const hit = Places.bestNameMatch(pair[0], osmList, 0.6);
    return !hit || hit.name !== pair[1];
  });
  check("课表里的 5 种写法都能挑中对应的楼", wrong.length === 0,
    wrong.map(function (p) { return p[0]; }).join(" / "));

  /* 界面与接线 */
  check("设置里有「自动补齐」按钮", html.indexOf('id="btnAutoFillBuildings"') > 0);
  check("按钮接上了处理函数",
    appSource.indexOf('$("#btnAutoFillBuildings").addEventListener') > 0);
  /* 截图导入那条路还在；JSON「导入」按钮这一轮按用户要求撤掉了，
     所以只剩一处触发（runAutoFill 本身没动）。 */
  check("截图导入课表后会自动触发补齐",
    (appSource.match(/runAutoFill\(true\)/g) || []).length >= 1,
    "找课表导入后那一处");
  check("遵守 Nominatim 每秒最多一次的限速",
    /NOMINATIM_GAP = (\d+)/.test(appSource) &&
    Number(/NOMINATIM_GAP = (\d+)/.exec(appSource)[1]) >= 1000);
  check("只挑没坐标的楼栋去补",
    /function pendingBuildings/.test(appSource) &&
    appSource.indexOf("typeof b.lat !== \"number\" || typeof b.lng !== \"number\"") > 0);
  check("补齐后会把 OSM 的中英文名补进别名",
    appSource.indexOf("OP.Places.mergeAliases(match, building)") > 0);
  check("补不上的会列出来而不是悄悄跳过",
    appSource.indexOf("没找到：") > 0);
  check("模糊打分复用 ocr 的 nameScore",
    placesSource.indexOf("OP.Ocr.nameScore") > 0);
}

console.log("\n[27] 去掉淡灰说明小字 + 拼写统一成 protocol");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const pageCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
  const storeCode = fs.readFileSync(path.join(root, "js/store.js"), "utf8");
  const deployCode = fs.readFileSync(path.join(root, "tools/deploy.js"), "utf8");

  check("页面里再没有 class=\"hint\" 的说明小字",
    pageHtml.indexOf('class="hint"') === -1);
  check("脚本也不再生成说明小字",
    appCode.indexOf('class="hint"') === -1);
  check("样式表里不再保留 .hint 规则",
    pageCss.indexOf(".hint") === -1);
  check("被删掉的提示元素不再被脚本引用",
    appCode.indexOf("mapHint") === -1 &&
    appCode.indexOf("locHint") === -1 &&
    appCode.indexOf("plNote") === -1);
  check("课表页那块长说明也不在 HTML 里了",
    pageHtml.indexOf("越清晰越准") === -1 &&
    pageHtml.indexOf("截整张课表") === -1);
  check("剩下的状态小字换了不再是淡灰的样式",
    pageCss.indexOf(".count-line") > 0 &&
    pageCss.indexOf(".progress-text") > 0 &&
    pageCss.indexOf(".debug-summary") > 0);
  check("页面仍是亮色底上的浅灰会被看清（--text-faint 提亮过）",
    /--text-faint:\s*#([0-9a-f]{6})/i.test(pageCss) &&
    parseInt(/--text-faint:\s*#([0-9a-f]{6})/i.exec(pageCss)[1].slice(0, 2), 16) >= 0x70,
    /--text-faint:\s*#\w+/.exec(pageCss)[0]);

  /* 拼写：线上真正会跑的文件里不允许再有 Protocal */
  const shipped = ["index.html", "styles.css", "cuhk-buildings.json", "data/defaults.js", "data/buildings.js",
    "js/app.js", "js/geo.js", "js/elevation.js", "js/speech.js", "js/planner.js",
    "js/map.js", "js/realmaps.js", "js/places.js", "js/ocr.js"];
  const wrongSpelling = shipped.filter(function (file) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    return text.indexOf("Protocal") >= 0 || text.indexOf("protocal") >= 0;
  });
  check("线上文件里没有拼错的 Protocal（共 " + shipped.length + " 个文件）",
    wrongSpelling.length === 0, wrongSpelling.join(", "));

  check("存储键都用新拼写",
    storeCode.indexOf('"olympic-protocol.buildings.v1"') > 0 &&
    storeCode.indexOf('"olympic-protocol.courses.v1"') > 0 &&
    storeCode.indexOf('"olympic-protocol.settings.v1"') > 0 &&
    storeCode.indexOf('"olympic-protocol.fired.v1"') > 0);
  check("两种老拼写的整包键都还认，迁移不会漏",
    storeCode.indexOf('"olympic-protocol.data.v1"') > 0 &&
    storeCode.indexOf('"olympic-protocal.data.v1"') > 0 &&
    storeCode.indexOf('"olympic-protocal.fired.v1"') > 0);
  check("导出的备份文件名也用新拼写",
    storeCode.indexOf('"olympic-protocol-" + stamp') > 0);

  /* 真的跑一遍迁移：老的整包键里有数据，必须被拆进三个新键 */
  const memory = {};
  memory["olympic-protocal.data.v1"] = JSON.stringify({
    campus: { name: "旧校区", buildings: [{ id: "old-b", name: "旧楼", alias: [], lat: 1, lng: 2 }] },
    courses: [{ id: "old-1", name: "旧存档的课" }],
    settings: { leadMinutes: 33 }
  });
  memory["olympic-protocal.fired.v1"] = JSON.stringify({ "2026-09-28|old-1": true });

  const realStorage = global.localStorage;
  global.localStorage = {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
    },
    setItem: function (key, value) { memory[key] = String(value); },
    removeItem: function (key) { delete memory[key]; }
  };

  const migrated = OP.Store.load();
  const migratedFired = OP.Store.loadFired();
  global.localStorage = realStorage;

  check("旧整包里的课表被拆进 courses 键",
    migrated.courses.length === 1 && migrated.courses[0].name === "旧存档的课",
    migrated.courses.length + " 门");
  /* 楼栋是"强制采用"的：老存档里那份会被新版默认数据整份替换掉，
     所以这里验的是"迁移后 buildings 键里是默认数据、版本号也记上了" */
  check("旧整包拆出来的楼栋会被新版默认数据替换（强制采用）",
    memory["olympic-protocol.buildings.v1"] &&
    JSON.parse(memory["olympic-protocol.buildings.v1"]).buildings.length ===
      OP.DEFAULT_BUILDINGS.buildings.length &&
    JSON.parse(memory["olympic-protocol.buildings.v1"]).defaultVersion ===
      OP.Store.defaultBuildingsVersion() &&
    migrated.campus.buildings.length === OP.DEFAULT_BUILDINGS.buildings.length);
  check("替换掉的是老存档里那栋（旧存档的楼只在这里出现过）",
    !migrated.campus.buildings.some(function (b) { return b.name === "旧楼"; }));
  check("旧整包里的设置被拆进 settings 键",
    memory["olympic-protocol.settings.v1"] &&
    JSON.parse(memory["olympic-protocol.settings.v1"]).leadMinutes === 33 &&
    migrated.settings.leadMinutes === 33);
  check("播报记录也跟着换键",
    migratedFired["2026-09-28|old-1"] === true);
  check("拆完把老键删掉（否则清空数据后又会自己长回来）",
    !Object.prototype.hasOwnProperty.call(memory, "olympic-protocol.data.v1") &&
    !Object.prototype.hasOwnProperty.call(memory, "olympic-protocal.data.v1"));

  check("部署目录名改成新拼写",
    deployCode.indexOf('path.join(repo, "olympicprotocol")') > 0);
  check("老地址会留一张跳转页，旧链接不会 404",
    deployCode.indexOf("legacyTarget") > 0 &&
    deployCode.indexOf('path.join(repo, "olympicprotocal")') > 0 &&
    /location\.replace\("https:\/\/rhythmhill\.com\/olympicprotocol\/"\)/.test(deployCode));
  check("跳转页每次部署都会被重写",
    /legacyTarget[\s\S]{0,200}writeFileSync/.test(deployCode));
}

console.log("\n[28] 楼栋与课表分开存");
{
  const Store = OP.Store;
  const buildingFile = path.join(root, "data", "buildings.js");
  const defaultsSource = fs.readFileSync(path.join(root, "data", "defaults.js"), "utf8");
  const buildingsSource = fs.readFileSync(buildingFile, "utf8");
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const deploySource = fs.readFileSync(path.join(root, "tools", "deploy.js"), "utf8");

  /* --- 三个键确实是分开的 --- */
  check("楼栋 / 课表 / 设置各用各的键",
    Store.KEYS.buildings !== Store.KEYS.courses &&
    Store.KEYS.courses !== Store.KEYS.settings &&
    Store.KEYS.buildings !== Store.KEYS.settings &&
    Store.KEYS.buildings.indexOf("buildings") > 0 &&
    Store.KEYS.courses.indexOf("courses") > 0 &&
    Store.KEYS.settings.indexOf("settings") > 0,
    [Store.KEYS.buildings, Store.KEYS.courses, Store.KEYS.settings].join(" / "));

  /* --- 默认楼栋来自单独的文件 --- */
  check("默认楼栋单独放在 data/buildings.js",
    fs.existsSync(buildingFile) && /OP\.DEFAULT_BUILDINGS\s*=/.test(buildingsSource));
  check("默认楼栋是一整套真实校区数据（共 " + OP.DEFAULT_BUILDINGS.buildings.length + " 栋）",
    OP.DEFAULT_BUILDINGS.buildings.length > 100);
  check("默认校区名跟着楼栋数据",
    OP.DEFAULT_BUILDINGS.name.length > 0 &&
    OP.Store.defaults().campus.name === OP.DEFAULT_BUILDINGS.name);

  const badBuildings = OP.DEFAULT_BUILDINGS.buildings.filter(function (b) {
    return !b || !b.id || !b.name || !Array.isArray(b.alias) ||
      typeof b.lat !== "number" || typeof b.lng !== "number";
  });
  check("每栋都有 id / 名字 / 别名数组 / 经纬度", badBuildings.length === 0,
    badBuildings.slice(0, 3).map(function (b) { return b && b.name; }).join(" / "));

  const idSet = {};
  let duplicateIds = 0;
  OP.DEFAULT_BUILDINGS.buildings.forEach(function (b) {
    if (idSet[b.id]) duplicateIds++;
    idSet[b.id] = true;
  });
  check("楼栋 id 没有重号（课表靠它找楼）", duplicateIds === 0, duplicateIds + " 个重号");

  check("默认楼栋是按名字排好序的",
    OP.Store.defaults().campus.buildings.length === OP.DEFAULT_BUILDINGS.buildings.length);

  check("默认课表是空的，不再自带示例课程",
    OP.DEFAULT_DATA.courses.length === 0);
  check("defaults.js 自己不再堆楼栋坐标，改成引用楼栋文件",
    defaultsSource.indexOf("OP.DEFAULT_BUILDINGS") > 0 &&
    defaultsSource.indexOf("lat:") === -1,
    "lat: 出现 " + (defaultsSource.match(/lat:/g) || []).length + " 次");

  /* --- 加载顺序：先有楼栋数据，才能组装默认值 --- */
  const buildingsAt = pageHtml.indexOf('src="data/buildings.js"');
  const defaultsAt = pageHtml.indexOf('src="data/defaults.js"');
  check("页面先加载楼栋文件再加载默认值",
    buildingsAt > 0 && defaultsAt > buildingsAt);
  check("部署脚本会把 data/ 下的文件一起搬走（自动扫描，不用手加清单）",
    deploySource.indexOf('listJs("data")') > 0);

  /* --- 真的存一遍：改课表不能动楼栋 --- */
  const memory = {};
  const buildingsPayload = JSON.stringify({
    /* 标成"已合到当前版本的默认楼栋"，这个用例只想看分键读写 */
    defaultVersion: Store.defaultBuildingsVersion(),
    name: "我的校区",
    buildings: [{ id: "b1", name: "我的楼", alias: ["别名"], lat: 22.4, lng: 114.2 }]
  });
  memory[Store.KEYS.buildings] = buildingsPayload;
  memory[Store.KEYS.courses] = JSON.stringify([{ id: "c1", name: "我的课" }]);

  const realStorage = global.localStorage;
  global.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null),
    setItem: (key, value) => { memory[key] = String(value); },
    removeItem: (key) => { delete memory[key]; }
  };

  const loaded = Store.load();
  check("读的时候楼栋和课表各取各的键",
    loaded.campus.name === "我的校区" && loaded.campus.buildings.length === 1 &&
    loaded.courses.length === 1 && loaded.courses[0].name === "我的课");

  const buildingsBefore = JSON.stringify(JSON.parse(memory[Store.KEYS.buildings]).buildings);
  loaded.courses = [{ id: "c2", name: "换过的课" }];
  Store.save(loaded);
  check("改课表不会动到楼栋内容",
    JSON.stringify(JSON.parse(memory[Store.KEYS.buildings]).buildings) === buildingsBefore,
    memory[Store.KEYS.buildings]);
  check("课表确实写进了自己的键",
    JSON.parse(memory[Store.KEYS.courses])[0].name === "换过的课");

  /* --- 清空楼栋之后，不能被默认值顶回来 --- */
  memory[Store.KEYS.buildings] = JSON.stringify({ name: "空校区", buildings: [] });
  check("楼栋清空之后重新打开还是空的",
    Store.load().campus.buildings.length === 0);

  /* --- 从来没存过楼栋时，才用默认数据 --- */
  global.localStorage = realStorage;
  check("本地没有存档时用 data/buildings.js 的默认楼栋",
    Store.load().campus.buildings.length === OP.DEFAULT_BUILDINGS.buildings.length);

  /* --- 换了楼栋之后，课表还在 --- */
  global.localStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null),
    setItem: (key, value) => { memory[key] = String(value); },
    removeItem: (key) => { delete memory[key]; }
  };
  memory[Store.KEYS.courses] = JSON.stringify([{ id: "c9", name: "留着的课" }]);
  delete memory[Store.KEYS.buildings];
  memory[Store.KEYS.buildings] = JSON.stringify(OP.DEFAULT_BUILDINGS);
  const afterSwap = Store.load();
  global.localStorage = realStorage;
  check("楼栋换成内置校区数据之后，课表照旧",
    afterSwap.campus.buildings.length === OP.DEFAULT_BUILDINGS.buildings.length &&
    afterSwap.courses.length === 1 && afterSwap.courses[0].name === "留着的课");

  /* --- 生成默认楼栋的工具在 --- */
  check("有从导出文件生成默认楼栋的工具",
    fs.existsSync(path.join(root, "tools", "make-buildings.js")) &&
    fs.readFileSync(path.join(root, "tools", "make-buildings.js"), "utf8")
      .indexOf("data/buildings.js") > 0);
}

console.log("\n[29] 指定补录的楼栋 + 简图上的圈与字");
{
  const defaults = OP.Store.defaults();
  const all = defaults.campus.buildings;

  function findByName(text) {
    return all.filter(function (b) {
      return b.name === text || (b.alias || []).indexOf(text) >= 0;
    });
  }

  /* --- 两栋指定要有的楼 --- */
  const medical = all.filter(function (b) {
    return b.name.indexOf("Choh-Ming Li Basic Medical Sciences") === 0;
  });
  check("默认楼栋里有李卓敏基本醫學大樓",
    medical.length === 1 &&
    (medical[0].alias || []).some(function (a) { return a.indexOf("李卓敏基本醫學大樓") >= 0; }),
    medical.length ? medical[0].name + " / " + medical[0].alias.join("、") : "没找到");
  check("李卓敏樓有坐标和海拔",
    medical.length === 1 && typeof medical[0].lat === "number" &&
    typeof medical[0].lng === "number" && typeof medical[0].elevation === "number",
    medical.length ? medical[0].lat + ", " + medical[0].lng : "-");

  const field = all.filter(function (b) {
    return b.name === "Sir Philip Haddon-Cave Sports Field";
  });
  check("默认楼栋里有夏鼎基運動場",
    field.length === 1 &&
    (field[0].alias || []).indexOf("夏鼎基運動場") >= 0,
    field.length ? field[0].name + " / " + field[0].alias.join("、") : "没找到");
  check("夏鼎基運動場有坐标和海拔",
    field.length === 1 && typeof field[0].lat === "number" &&
    typeof field[0].lng === "number" && typeof field[0].elevation === "number",
    field.length ? field[0].lat + ", " + field[0].lng + " · 海拔 " + field[0].elevation : "-");

  /* 中文名要能搜到——播报和课表匹配都靠别名 */
  check("用中文名搜得到这两栋",
    P.filterBuildings(all, "李卓敏基本醫學大樓", false).length === 1 &&
    P.filterBuildings(all, "夏鼎基運動場", false).length === 1);
  check("用简体写法也搜得到夏鼎基运动场",
    P.filterBuildings(all, "夏鼎基运动场", false).length === 1);
  check("同名的楼没有重复录入",
    findByName("李卓敏基本醫學大樓").length === 1 &&
    findByName("夏鼎基運動場").length === 1);

  /* --- 两套地图的标记：简图放大，真实底图缩小 --- */
  const mapSource = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
  const realMapSource = fs.readFileSync(path.join(root, "js", "realmaps.js"), "utf8");
  const pageCss = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  check("简图的楼栋圈放大到 18 / 15",
    /var r = s\.isNext \? 18 : 15;/.test(mapSource));
  check("简图的我的位置圆点放大到 10、脉冲环 13",
    /class="me-ring"[\s\S]{0,140}?r="13"/.test(mapSource) &&
    /class="me-dot"[\s\S]{0,140}?r="10"/.test(mapSource));
  /* 原来动的是 SVG 的 r（几何属性 = 动布局），现在改成 transform: scale()。
     13 → 36 的半径变化换算成 scale 就是 2.77。 */
  check("脉冲改成动 transform（不再动 SVG 的几何属性）",
    /@keyframes pulse\s*\{[\s\S]{0,220}transform:\s*scale\(2\.77\)/.test(pageCss) &&
    !/@keyframes pulse\s*\{[\s\S]{0,220}?\br:\s*\d/.test(pageCss) &&
    /\.me-ring\s*\{[\s\S]{0,260}transform-box:\s*fill-box/.test(pageCss));

  /* 取某个选择器**所有**规则块的内容。
     不能用"第一处匹配"——同一个 class 后面往往还有几条补充规则
     （比如 .bld-label 先给字号、后面再给透明度），只看第一处会漏。 */
  function ruleBlocks(selector) {
    const out = [];
    /* 先把 CSS 注释去掉：不然「注释 + .bld-label {」会被当成一个选择器，
       结果这条规则就找不到了 */
    const clean = pageCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(clean))) {
      const sels = m[1].split(",").map((s) => s.trim());
      if (sels.indexOf(selector) >= 0) out.push(m[2]);
    }
    return out;
  }

  function fontSizeOf(selector) {
    for (const block of ruleBlocks(selector)) {
      const f = /font-size:\s*(\d+)px/.exec(block);
      if (f) return Number(f[1]);
    }
    return null;
  }

  function opacityOf(selector) {
    for (const block of ruleBlocks(selector)) {
      const o = /opacity:\s*([\d.]+)/.exec(block);
      if (o) return Number(o[1]);
    }
    return null;
  }

  /* 楼名后来改成"简写 + 小一号 + 半透明"（挤在一起时看不清），
     但圈和编号还是要够大，"我的位置"也还要够显眼 */
  check("楼名和时间改成小一号（17 / 13）",
    fontSizeOf(".bld-label") === 17 && fontSizeOf(".bld-time") === 13,
    [fontSizeOf(".bld-label"), fontSizeOf(".bld-time")].join(" / "));
  check("圈里的编号和「我的位置」还是大的",
    fontSizeOf(".bld-order") === 17 && fontSizeOf(".me-label") === 19,
    [fontSizeOf(".bld-order"), fontSizeOf(".me-label")].join(" / "));
  check("校巴站名也小了一号", fontSizeOf(".bus-stop-label") === 12);

  /* 街道图 / 港中文地图：反过来缩小 */
  check("真实底图的编号圆点缩到 24px",
    /\.rm-pin\s*\{[\s\S]*?width:\s*24px[\s\S]*?height:\s*24px/.test(pageCss) &&
    /\.rm-pin\s*\{[\s\S]*?font-size:\s*11px/.test(pageCss));
  check("真实底图的标记图标按 24px 算锚点",
    /iconSize:\s*\[24, 24\]/.test(realMapSource) &&
    /iconAnchor:\s*\[12, 12\]/.test(realMapSource));
  check("真实底图上「我的位置」的点也缩小",
    /radius:\s*5,/.test(realMapSource));
  check("真实底图的标签字号缩小到 11px",
    /\.leaflet-tooltip\.rm-tip\s*\{[\s\S]*?font-size:\s*11px/.test(pageCss));
  check("两个尺寸确实是反着来的（简图比真实底图大）",
    /var r = s\.isNext \? 18 : 15;/.test(mapSource) && /iconSize:\s*\[24, 24\]/.test(realMapSource));

  /* --- 简图的字：地名半透明做底衬，圆点编号 /「下一节」/「我的位置」保持不透明 --- */
  const textRule = /\.bld-label,\s*\.bld-time,\s*\.bld-flag,\s*\.dist-label,\s*\.me-label,\s*\.map-note\s*\{([^}]*)\}/.exec(pageCss);
  check("白描边还在（字要能在任何底色上看清），但不再统一写死不透明",
    textRule && /paint-order:\s*stroke/.test(textRule[1]) && !/opacity/.test(textRule[1]),
    textRule ? textRule[1].replace(/\s+/g, " ").trim() : "没找到规则");
  check("地名是半透明的（0.5～0.8）",
    opacityOf(".bld-label") >= 0.5 && opacityOf(".bld-label") < 0.8,
    String(opacityOf(".bld-label")));
  check("时间、校巴站名更淡一点",
    opacityOf(".bld-time") < opacityOf(".bld-label") &&
    opacityOf(".bus-stop-label") < opacityOf(".bld-label"),
    [opacityOf(".bld-label"), opacityOf(".bld-time"), opacityOf(".bus-stop-label")].join(" / "));
  check("「我的位置」和「下一节」保持不透明（关键信息不能糊）",
    opacityOf(".me-label") === 1 && opacityOf(".bld-flag") === 1);

  /* --- 地名简写 --- */
  const shortLabel = OP.MapView.shortLabel;
  /* 一开始做成了取首字母拼代号（AB2 / ELB），太激进——简图上认不出是哪栋。
     现在只去掉 Building / Centre 这类通用词，其余原样留着 */
  check("简写：只去掉 Building / Centre 这类通用词",
    shortLabel("Academic Building No.2") === "Academic No.2" &&
    shortLabel("Academic Building No.1") === "Academic No.1" &&
    shortLabel("Esther Lee Building") === "Esther Lee" &&
    shortLabel("Benjamin Franklin Centre") === "Benjamin Franklin" &&
    shortLabel("Wu Ho Man Yuen Building") === "Wu Ho Man Yuen",
    [shortLabel("Academic Building No.2"), shortLabel("Esther Lee Building"),
      shortLabel("Benjamin Franklin Centre")].join(" / "));
  check("简写：去完只剩一个词就不去（Science Centre 不能变成 Science）",
    shortLabel("Science Centre") === "Science Centre", shortLabel("Science Centre"));
  check("简写：没带通用词的名字原样不动",
    shortLabel("Y.C. Liang Hall") === "Y.C. Liang Hall" &&
    shortLabel("Ho Tim Hall") === "Ho Tim Hall");
  check("简写：本来就短的（12W / C3 / LT2）原样不动",
    shortLabel("12W") === "12W" && shortLabel("C3") === "C3" && shortLabel("LT2") === "LT2");
  check("简写：房间后缀跟着留着（Lady Shaw Building C3 → Lady Shaw C3）",
    shortLabel("Lady Shaw Building C3") === "Lady Shaw C3", shortLabel("Lady Shaw Building C3"));
  check("简写：中文短名留着，括号补充去掉",
    shortLabel("五旬節會樓高座") === "五旬節會樓高座" &&
    shortLabel("聯合書院（上行）") === "聯合書院" &&
    shortLabel("大學行政樓") === "大學行政樓",
    [shortLabel("五旬節會樓高座"), shortLabel("聯合書院（上行）")].join(" / "));
  check("简写：中文太长的截断（不会撑满整张图）",
    shortLabel("香港中文大學賽馬會研究生宿舍二座").length <= 9,
    shortLabel("香港中文大學賽馬會研究生宿舍二座"));
  /* 宿舍那种"英文 中文"并排的名字：不能被当成纯中文切成 "Chih Hsi…" */
  check("简写：中英并排的名字按英文那套处理",
    shortLabel("Chih Hsing Hall 知行樓") === "Chih Hsing Hall 知行樓" &&
    shortLabel("Mong Man Wai Building 蒙民偉樓") === "Mong Man Wai 蒙民偉樓",
    shortLabel("Chih Hsing Hall 知行樓"));

  /* --- 摆字：默认在下面，压住了翻到上面 --- */
  {
    /* 一栋楼 + 一个位置点，两者几乎重合：两块字必须分开放在上下两侧 */
    const near = { innerHTML: "" };
    OP.MapView.render(near, {
      buildings: [{ id: "A", name: "Academic Building No.2", lat: 22.4200, lng: 114.2070 }],
      position: { lat: 22.42004, lng: 114.2070 },
      stops: [{ building: { id: "A", name: "Academic Building No.2", lat: 22.4200, lng: 114.2070 },
        order: 1, time: "09:30", isNext: false }]
    });
    const html = near.innerHTML;
    const yOf = (cls) => {
      const m = new RegExp('class="' + cls + '[^"]*"[^>]*y="([\\d.-]+)"').exec(html);
      return m ? Number(m[1]) : null;
    };
    const cyOf = () => {
      const m = /class="bld is-today"[^>]*cy="([\d.-]+)"/.exec(html);
      return m ? Number(m[1]) : null;
    };
    const meY = yOf("me-label");
    const bldY = yOf("bld-label");
    const cy = cyOf();
    check("挨在一起时，两块字分到上下两侧（不再都堆在下面）",
      meY !== null && bldY !== null && cy !== null &&
      Math.abs(meY - bldY) > 20 && (meY < cy) !== (bldY < cy),
      "我的位置 y=" + meY + "，楼名 y=" + bldY + "，圆点 cy=" + cy);
    check("图上写的是去掉通用词的名字，全称放进了 <title>",
      html.indexOf(">Academic No.2<") > 0 &&
      html.indexOf("<title>Academic Building No.2</title>") > 0);
  }
  {
    /* 两个点靠得很近：一个放下面、一个翻到上面 */
    const two = { innerHTML: "" };
    const A = { id: "A", name: "Academic Building No.1", lat: 22.42000, lng: 114.2070 };
    const B = { id: "B", name: "Academic Building No.2", lat: 22.42002, lng: 114.2070 };
    OP.MapView.render(two, {
      buildings: [A, B],
      position: null,
      stops: [
        { building: A, order: 1, time: "09:30", isNext: true },
        { building: B, order: 2, time: "11:30", isNext: false }
      ]
    });
    const html = two.innerHTML;
    const cyList = [];
    html.replace(/class="bld[^"]*"[^>]*cy="([\d.-]+)"/g, (m, v) => { cyList.push(Number(v)); return m; });
    const labelYs = [];
    html.replace(/class="bld-label[^"]*"[^>]*y="([\d.-]+)"/g, (m, v) => { labelYs.push(Number(v)); return m; });
    check("两个点挤在一起时，两块字一上一下",
      cyList.length === 2 && labelYs.length === 2 &&
      (labelYs[0] < Math.min.apply(null, cyList)) !== (labelYs[1] < Math.min.apply(null, cyList)),
      "字 y=" + labelYs.join(",") + "，点 cy=" + cyList.join(","));
  }

  function fillOf(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rule = new RegExp(escaped + "\\s*\\{([^}]*)\\}");
    const m = rule.exec(pageCss);
    const f = m ? /fill:\s*([^;]+)/.exec(m[1]) : null;
    return f ? f[1].trim() : null;
  }

  check("楼名和距离用正文色，不再是淡灰",
    fillOf(".bld-label") === "var(--text)" && fillOf(".dist-label") === "var(--text)",
    fillOf(".bld-label") + " / " + fillOf(".dist-label"));
  check("上课时间不再用最淡的那档颜色",
    fillOf(".bld-time") === "var(--text-dim)");
  check("图内提示文字提亮一档",
    fillOf(".map-note") === "var(--text-dim)");
}

console.log("\n[30] 课表上的缩写楼名");
{
  const OCR = OP.Ocr;
  const Places = OP.Places;
  const all = OP.Store.defaults().campus.buildings;
  const MED = "Choh-Ming Li Basic Medical Sciences Building";

  function hit(query, list) {
    return OCR.matchBuilding(query, list || all, 0.62);
  }

  /* 课表上写的是缩写版，得能对上全名 */
  const short = hit("Basic Med Sci Bldg");
  check("「Basic Med Sci Bldg」能匹配上李卓敏樓",
    short && short.name === MED,
    short ? short.name + "  " + short.score.toFixed(2) : "null");
  check("匹配分数稳稳过阈值（不是擦边）",
    short && short.score >= 0.7, short ? short.score.toFixed(2) : "-");

  check("再缩一点也认得（Basic Med Sci）",
    (hit("Basic Med Sci") || {}).name === MED,
    (hit("Basic Med Sci") || {}).name);
  check("去掉前半段也认得（Med Sci Bldg）",
    (hit("Med Sci Bldg") || {}).name === MED,
    (hit("Med Sci Bldg") || {}).name);
  check("带句点的写法也认得（Basic Med Sci Bldg.）",
    (hit("Basic Med Sci Bldg.") || {}).name === MED);
  check("全名和中文别名仍然是满分",
    hit(MED).score === 1 && hit("李卓敏基本醫學大樓").score === 1);

  /* 自动补齐走的是 Places 那条路，用的是同一个打分函数 */
  const viaPlaces = Places.bestNameMatch("Basic Med Sci Bldg", all, 0.6);
  check("自动补齐那条路也认得这个缩写",
    viaPlaces && viaPlaces.name === MED,
    viaPlaces ? viaPlaces.name + "  " + viaPlaces.matchScore.toFixed(2) : "null");

  /* 课表上的 "Science Centre" 指的是大學科學館，不是東座/北座/南座。
     OSM 里这几个名字长得很像，模糊分算出来并列，先出现的东座会赢——
     所以给大學科學館挂上了 "Science Centre" 这个别名，变成精确匹配。 */
  const sci = hit("Science Centre");
  check("「Science Centre」匹配到大學科學館",
    sci && sci.name === "University Science Centre",
    sci ? sci.name + "  " + sci.score.toFixed(2) : "null");
  check("这是精确匹配（别名里就有这个写法）",
    sci && sci.score === 1);
  check("带教室号也一样",
    (hit("Science Centre L3") || {}).name === "University Science Centre");
  check("「Science Centre East Block」仍然指东座",
    (hit("Science Centre East Block") || {}).name === "Science Centre East Block");
  check("中文「科學館」也是大學科學館",
    (hit("科學館") || {}).name === "University Science Centre");

  /* 其他真实的课表写法不能被这次改动带歪 */
  const keep = [
    ["Lady Shaw Bldg", "Lady Shaw Building"],
    ["Lee Shau Kee Bldg", "Lee Shau Kee Building"],
    ["Wu Ho Man Yuen Bldg", "Wu Ho Man Yuen Building"],
    ["Esther Lee Bldg", "Esther Lee Building"],
    ["Yasumoto Int'l Acad Park", "Yasumoto International Academic Park"]
  ];
  const broken = keep.filter(function (pair) {
    const m = hit(pair[0]);
    return !m || m.name !== pair[1];
  });
  check("其他缩写写法照旧能挑对（共 " + keep.length + " 种）",
    broken.length === 0, broken.map(function (p) { return p[0]; }).join(" / "));

  /* 前缀规则要至少 3 个字母，否则 "Li" 会和 "Library" 混起来 */
  const forms = OCR.nameForms;
  const lib = OCR.nameScore(forms("Lib Annexe"), forms("Library Annexe"));
  const li = OCR.nameScore(forms("Li Annexe"), forms("Library Annexe"));
  check("前缀至少 3 个字母：Lib 算，Li 不算",
    lib > li, "Lib=" + lib.toFixed(2) + "  Li=" + li.toFixed(2));
  check("两字母写法确实落回低分", li < 0.62, li.toFixed(2));

  /* 覆盖度加成要求至少对上两个词：只对上一个词时，分数还是原来那套低分，
     免得随便一个词（一个 "Tower"、一个 "Medical"）就被认成整栋楼。
     这里用一对儿没有"包含关系"的假名字，好把加成单独隔离出来看。 */
  const tower = [{ id: "z", name: "Alpha Zeta Tower", alias: [] }];
  check("只对上一个词不给覆盖度加成",
    OCR.matchBuilding("Tow", tower, 0.62) === null &&
    OCR.matchBuilding("Zet", tower, 0.62) === null,
    "Tow=" + JSON.stringify(OCR.matchBuilding("Tow", tower, 0.62)));
  const twoWords = OCR.matchBuilding("Zet Tow", tower, 0.62);
  check("两个词都被覆盖到才给加成",
    twoWords && twoWords.name === "Alpha Zeta Tower" && twoWords.score >= 0.8,
    twoWords ? twoWords.score.toFixed(2) : "null");

  /* 展开表里加上 med 之后，词面也一致了 */
  check("缩写表里补了 med → medical",
    OCR.ABBREVIATIONS.med === "medical");
  check("缩写展开后词面一致",
    forms("med").latin[0] === "medical");
}

console.log("\n[31] 默认楼栋换新版本时强制采用（整份替换）");
{
  const Store = OP.Store;
  const all = OP.DEFAULT_BUILDINGS.buildings;
  const FIELD = "Sir Philip Haddon-Cave Sports Field";
  const FIELD_ID = "b-cuhk-haddon-cave-field";

  /* --- 默认数据本身：用户 2026-09-30 优化过的那一份 --- */
  check("默认楼栋是优化过的那份（151 栋，版本 ≥ 3）",
    all.length === 151 && Number(OP.DEFAULT_BUILDINGS.version) >= 3,
    all.length + " 栋 / v" + OP.DEFAULT_BUILDINGS.version);
  check("每一栋都有坐标、海拔和别名",
    all.every((b) => typeof b.lat === "number" && typeof b.lng === "number" &&
      typeof b.elevation === "number" && (b.alias || []).length > 0));
  check("优化时清掉的那些点没有再回来",
    ["樟樹灘村村公所", "變電站", "公廁"]
      .every((name) => !all.some((b) => b.name === name)),
    all.filter((b) => /村公所|變電站/.test(b.name)).map((b) => b.name).join("、"));
  check("之前点名要的两项还在（夏鼎基運動場 / Science Centre 别名）",
    all.some((b) => b.name === FIELD) &&
    all.some((b) => b.name === "University Science Centre" &&
      (b.alias || []).indexOf("Science Centre") >= 0));
  check("应用会把「换成新版」这件事告诉用户",
    fs.readFileSync(path.join(root, "js", "app.js"), "utf8")
      .indexOf("楼栋数据已换成新版") > 0);
  /* 旧的"只补不改"那套要清干净，留着会让人以为还有第二条同步规则 */
  const storeSource = fs.readFileSync(path.join(root, "js", "store.js"), "utf8");
  check("只补不改的合并函数已经删掉",
    storeSource.indexOf("function replaceWithShipped") > 0 &&
    storeSource.indexOf("mergeShippedBuildings") === -1);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  /* 常用的那套内存版 localStorage */
  function useMemory(memory) {
    const real = global.localStorage;
    global.localStorage = {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null),
      setItem: (key, value) => { memory[key] = String(value); },
      removeItem: (key) => { delete memory[key]; }
    };
    return function restore() { global.localStorage = real; };
  }

  /* --- 用户的情况：本地存过一整套楼栋，但那是旧版（比默认少一栋） --- */
  const memory = {};
  const mineBefore = all.filter((b) => b.id !== FIELD_ID).map(clone);
  /* 故意不带 defaultVersion：等于"本地这份是更早的版本" */
  memory[Store.KEYS.buildings] = JSON.stringify({ name: "香港中文大学", buildings: mineBefore });

  let restore = useMemory(memory);
  const loaded = Store.load();
  const sync = Store.lastSync();

  check("版本更新时整份换成默认数据（不是只补不改）",
    sync.replaced === true &&
    loaded.campus.buildings.length === all.length,
    mineBefore.length + " → " + loaded.campus.buildings.length);
  check("换完之后本地列表和默认数据逐条一致",
    JSON.stringify(loaded.campus.buildings.map((b) => b.id).sort()) ===
    JSON.stringify(all.map((b) => b.id).sort()));
  check("报出了新增的那栋（夏鼎基運動場）",
    sync.added.some((b) => b.name === FIELD),
    sync.added.map((b) => b.name).join("、") || "（没报）");
  check("换进来的楼带坐标和海拔",
    loaded.campus.buildings.some((b) => b.name === FIELD &&
      typeof b.lat === "number" && typeof b.lng === "number" &&
      typeof b.elevation === "number"));

  /* --- 再打开一次不该重复换 --- */
  const again = Store.load();
  check("换过一次就记住版本，不会每次打开都换",
    Store.lastSync().replaced === false && again.campus.buildings.length === all.length);
  check("版本号写进了楼栋存档",
    JSON.parse(memory[Store.KEYS.buildings]).defaultVersion === Store.defaultBuildingsVersion());

  /* --- 强制采用：本地改过的坐标会被默认数据覆盖（这正是"强制"的意思） --- */
  const memory2 = {};
  const mineEdited = all.filter((b) => b.id !== FIELD_ID).map(clone);
  const lsk = mineEdited.filter((b) => b.name === "Lee Shau Kee Building")[0];
  lsk.lat = 22.999999;
  lsk.lng = 113.999999;
  lsk.alias = ["我自己起的别名"];
  memory2[Store.KEYS.buildings] = JSON.stringify({ name: "我的校区", buildings: mineEdited });

  restore();
  restore = useMemory(memory2);
  const edited = Store.load();
  const lskAfter = edited.campus.buildings.filter((b) => b.name === "Lee Shau Kee Building")[0];
  check("本地改过的坐标和别名会被默认数据覆盖（强制采用）",
    lskAfter.lat !== 22.999999 && lskAfter.lng !== 113.999999 &&
    lskAfter.alias.indexOf("我自己起的别名") < 0,
    lskAfter.lat + ", " + lskAfter.lng + " · " + lskAfter.alias.join("、"));

  /* --- 本地自己加的、默认数据里没有的楼，会被移掉（不然清不掉） --- */
  const memory3 = {};
  memory3[Store.KEYS.buildings] = JSON.stringify({
    name: "我的校区",
    buildings: mineBefore.concat([
      { id: "my-own-id", name: "我自己加的楼", alias: [], lat: 22.4, lng: 114.2 }
    ])
  });
  restore();
  restore = useMemory(memory3);
  const aliasLoaded = Store.load();
  check("本地自己加的楼会被移掉，并报出来",
    !aliasLoaded.campus.buildings.some((b) => b.name === "我自己加的楼") &&
    Store.lastSync().removed.some((b) => b.name === "我自己加的楼"),
    Store.lastSync().removed.map((b) => b.name).join("、"));

  /* --- 本地列表是空的：那是用户自己清空的，不补 --- */
  const memory4 = {};
  memory4[Store.KEYS.buildings] = JSON.stringify({ name: "空校区", buildings: [] });
  restore();
  restore = useMemory(memory4);
  check("本地楼栋被清空时不硬塞回来",
    Store.load().campus.buildings.length === 0);
  restore();

  /* --- 默认数据里的别名靠"整份替换"一起带过来 --- */
  const memory6 = {};
  const mineOld = all.map(clone);
  mineOld.forEach((b) => {
    if (b.name === "University Science Centre") b.alias = ["科學館"];
  });
  memory6[Store.KEYS.buildings] = JSON.stringify({ name: "我的校区", buildings: mineOld });

  restore = useMemory(memory6);
  const aliasSynced = Store.load();
  const uni = aliasSynced.campus.buildings.filter(
    (b) => b.name === "University Science Centre")[0];
  const uniSaved = JSON.parse(memory6[Store.KEYS.buildings]).buildings.filter(
    (b) => b.name === "University Science Centre")[0];
  restore();

  check("默认数据里的别名（Science Centre）替换后就在",
    uni.alias.indexOf("Science Centre") >= 0, uni.alias.join("、"));
  check("替换会落盘",
    uniSaved.alias.indexOf("Science Centre") >= 0);

  /* --- 备份里也要带上，换设备才认得出来 --- */
  const memory5 = {};
  restore = useMemory(memory5);
  OP.Store.save({ campus: { name: "x", buildings: [] }, courses: [], settings: {} });
  const written = JSON.parse(memory5[Store.KEYS.buildings]);
  restore();
  check("空列表也会记下版本号，除非版本再涨否则不补",
    written.defaultVersion === Store.defaultBuildingsVersion() &&
    Array.isArray(written.buildings) && written.buildings.length === 0);
}

console.log("\n[32] 课表上的「不需要教室」");
{
  const Ocr = OP.Ocr;
  const appSource = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

  /* --- 各种写法都要认成"没有地点"，而不是"某栋叫这个名字的楼" --- */
  const forms = [
    "No room required",
    "no room required.",
    "No Room Required",
    "Location: No room required",
    "No rooms required",
    "No room req'd",
    "No room needed",
    "Room not required",
    "No venue required",
    "No room"
  ];
  const wrong = forms.filter(function (text) {
    const v = Ocr.parseVenue(text);
    return !v.noRoom || v.building !== "" || v.room !== "";
  });
  check("「不需要教室」的各种写法都认成未指定（共 " + forms.length + " 种）",
    wrong.length === 0, wrong.join(" / "));

  check("不会因此冒出一栋叫「No room required」的楼",
    forms.every(function (text) { return Ocr.parseVenue(text).building === ""; }));

  /* --- 正常地点一个都不能被误伤 --- */
  const keep = [
    ["Science Centre L5", "Science Centre", "L5"],
    ["Lee Shau Kee Building LT2", "Lee Shau Kee Building", "LT2"],
    ["Y.C. Liang Hall 106", "Y.C. Liang Hall", "106"],
    ["Wu Ho Man Yuen Bldg 504", "Wu Ho Man Yuen Bldg", "504"]
  ];
  const broken = keep.filter(function (row) {
    const v = Ocr.parseVenue(row[0]);
    return v.noRoom || v.building !== row[1] || v.room !== row[2];
  });
  check("正常地点不受影响（共 " + keep.length + " 种）",
    broken.length === 0, broken.map(function (r) { return r[0]; }).join(" / "));

  /* --- 整格解析：楼名字段留空，课程本身照常拼出来 --- */
  const cell = Ocr.parseBlockLines([
    "ENGG 1110 - A", "Lecture", "12:30 - 14:15", "No room required"
  ]);
  check("整格里认出「不需要教室」",
    cell.noRoom === true && cell.buildingName === "" && cell.room === "",
    JSON.stringify({ building: cell.buildingName, room: cell.room, noRoom: cell.noRoom }));
  check("课程本身的代号和类型照常解析",
    cell.code === "ENGG 1110" && cell.type === "Lecture" && cell.start === "12:30");

  /* 折成两行也要拼得回来 */
  const wrapped = Ocr.parseBlockLines([
    "ENGG 1110 - A", "Lecture", "12:30 - 14:15", "No room", "required"
  ]);
  check("折成两行的「No room / required」也认",
    wrapped.noRoom === true && wrapped.buildingName === "",
    wrapped.buildingName);

  /* 「无需教室」和「地点待定」是两回事，不能混 */
  check("「不需要教室」不会被当成 TBA",
    cell.tba === false && Ocr.parseVenue("Location: TBA").noRoom === false);

  /* --- 界面：下拉里说明白，并且不再劝你去新建楼栋 --- */
  /* 选项 HTML 现在由 ocr.js 的 matchOptions 生成（那样自检才跑得到），
     app.js 只负责把转义函数和 noRoom 传进去 */
  const ocrUiSource = fs.readFileSync(path.join(root, "js", "ocr.js"), "utf8");
  check("下拉里的空选项按情况换文案",
    ocrUiSource.indexOf('options.noRoom ? "（不需要教室）" : "（未指定）"') > 0 &&
    /OP\.Ocr\.matchOptions\(c\.buildingName, buildings, \{ noRoom: c\.noRoom, escape: esc \}\)/.test(appSource));
  check("新建楼栋的选项只在真有楼名时才出现",
    /c\.buildingName && !match/.test(appSource));

  /* --- 逐行说明里不再出现的三种黄字 --- */
  const removedNotes = [
    "请确认是不是这栋",      // 模糊匹配后让你复核
    "导入后需要自己补",      // 地点待定（TBA）
    "这条不带地点"           // 不需要教室
  ];
  const stillThere = removedNotes.filter(function (text) {
    return appSource.indexOf(text) >= 0;
  });
  check("导入时不再写这三种黄字说明",
    stillThere.length === 0, stillThere.join(" / "));

  /* 黄框只留给还写了原因的行，否则会出现"黄框但没说明" */
  check("黄框留给真正要动手的行：时间没读准 / 会新建楼栋 / 模糊匹配",
    /var bad = c\.needsTime \|\| \(c\.buildingName && !match\) \|\| \(match && !match\.exact\);/.test(appSource),
    (/var bad = [^;]*;/.exec(appSource) || [])[0]);
  check("剩下的提醒仍然只挑真正要改的行",
    /if \(c\.waiting\) notes\.push/.test(appSource) &&
    /if \(c\.needsTime\) notes\.push/.test(appSource));

  /* 模糊匹配仍然要报，但要短：只报把握度 */
  const fuzzyNote = /notes\.push\("自动匹配[^\n]*?\);/.exec(appSource);
  check("模糊匹配保留一句把握度说明",
    !!fuzzyNote && fuzzyNote[0].indexOf("%") > 0,
    fuzzyNote ? fuzzyNote[0] : "没找到");
  check("这句够短（不超过 70 个字符的源码）",
    !!fuzzyNote && fuzzyNote[0].length <= 70,
    fuzzyNote ? fuzzyNote[0].length + " 字符" : "-");

  /* --- 整张表跑一遍：这种课不该被提醒"地点没读出来" --- */
  const COL = { 1: 160, 2: 300 };
  function mkWord(text, cx, y) {
    const w = Math.max(12, String(text).length * 9);
    return { text: String(text), x0: cx - w / 2, y0: y, x1: cx + w / 2, y1: y + 18, conf: 96 };
  }
  function mkLine(line, cx, y) {
    const tokens = String(line).split(" ").filter(Boolean);
    const widths = tokens.map((t) => Math.max(12, t.length * 9));
    const gap = 8;
    const total = widths.reduce((a, b) => a + b, 0) + gap * (tokens.length - 1);
    let x = cx - total / 2;
    return tokens.map((t, i) => {
      const w = mkWord(t, x + widths[i] / 2, y);
      x += widths[i] + gap;
      return w;
    });
  }

  const tableWords = [];
  tableWords.push(...mkLine("Monday", COL[1], 465));
  tableWords.push(...mkLine("Tuesday", COL[2], 465));
  ["8:00", "9:00", "10:00", "11:00", "12:00", "13:00", "14:00"].forEach((t, i) => {
    tableWords.push(...mkLine(t, 60, 505 + i * 100));
  });
  ["ENGG 1110 - A", "Lecture", "12:30 - 14:15", "No room required"].forEach((line, i) => {
    tableWords.push(...mkLine(line, COL[1], 700 + i * 24));
  });

  const table = Ocr.parseWords(tableWords, {});
  const found = table.courses.filter((c) => c.code === "ENGG 1110")[0];
  check("整表解析能读出这条「不需要教室」的课",
    !!found && found.noRoom === true && found.buildingName === "" && found.room === "",
    found ? JSON.stringify({ building: found.buildingName, room: found.room, noRoom: found.noRoom })
      : "没解析出来");
  check("不会为它报「地点没读出来」",
    table.warnings.every((w) => w.indexOf("地点没读出来") === -1),
    table.warnings.join(" / "));

  /* 源码层面再钉一道：警告的条件里必须带上 noRoom */
  const ocrSource = fs.readFileSync(path.join(root, "js", "ocr.js"), "utf8");
  check("不会为这种课报「地点没读出来」",
    /!item\.buildingName && !item\.tba && !item\.noRoom/.test(ocrSource));
}

console.log("\n[34] 设置页里的版本号");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

  check("应用版本号有单一出处",
    /OP\.APP_VERSION\s*=\s*"[^"]+"/.test(fs.readFileSync(path.join(root, "data", "defaults.js"), "utf8")));
  check("版本号写成 vX.Y.Z",
    /^\d+\.\d+\.\d+$/.test(String(OP.APP_VERSION || "")), String(OP.APP_VERSION));

  check("设置页有三个格子：应用版本 / 构建版本 / 楼栋数据",
    pageHtml.indexOf('id="verApp"') > 0 &&
    pageHtml.indexOf('id="verBuild"') > 0 &&
    pageHtml.indexOf('id="verData"') > 0);
  check("这三个格子挂在「数据」卡片里",
    /<article class="card">\s*<div class="card-head"><h3>数据<\/h3><\/div>[\s\S]*?id="verData"[\s\S]*?id="btnResetData"/.test(pageHtml));
  check("渲染设置页时会把三个版本号填上",
    /function renderSettings\(\)[\s\S]{0,400}\$\("#verApp"\)\.textContent/.test(appCode) &&
    /\$\("#verBuild"\)\.textContent = buildStamp\(\)/.test(appCode) &&
    /\$\("#verData"\)\.textContent = "v" \+ \(OP\.Store\.defaultBuildingsVersion\(\)/.test(appCode));

  /* 构建号不另存一份，直接从部署时加的 ?v= 上读 */
  check("构建号从 script 的 ?v= 读出来",
    /function buildStamp\(\)[\s\S]*?querySelectorAll\("script\[src\]"\)[\s\S]*?\?&\]v=/.test(appCode));
  check("本地打开（没有 ?v=）时显示「本地」",
    /function buildStamp\(\)[\s\S]*?return "本地";/.test(appCode));
}

console.log("\n[35] 校巴数据（路线、站序、站点坐标）");
{
  const stops = OP.SHUTTLE_STOPS || {};
  const routes = OP.SHUTTLE_ROUTES || [];
  const meta = OP.SHUTTLE_META || {};
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

  check("路线全部收齐（附件里的 12 条）",
    routes.length === 12, routes.map((r) => r.no).join(","));
  const wantNo = ["1", "2", "2S", "3", "4", "8", "N", "H", "5", "6A", "6B", "7"];
  const gotNo = routes.map((r) => r.no);
  check("路线编号齐全",
    wantNo.every((n) => gotNo.indexOf(n) >= 0) && gotNo.length === wantNo.length,
    gotNo.join(" / "));

  /* 三个来源对应的分组 */
  check("分了穿梭 / 晚间假日 / 转堂三组",
    new Set(routes.map((r) => r.group)).size === 3 &&
    routes.filter((r) => r.group === "shuttle").length === 6 &&
    routes.filter((r) => r.group === "night").length === 2 &&
    routes.filter((r) => r.group === "meetclass").length === 4);

  /* 站点坐标：一个都不能缺 */
  const noCoord = Object.keys(stops).filter((k) => typeof stops[k].lat !== "number" ||
    typeof stops[k].lng !== "number");
  check("每个站都有 OSM 坐标（共 " + Object.keys(stops).length + " 个）",
    noCoord.length === 0, noCoord.join("、"));

  const badCoord = Object.keys(stops).filter((k) => {
    const s = stops[k];
    return !(s.lat > 22.39 && s.lat < 22.45 && s.lng > 114.18 && s.lng < 114.24);
  });
  check("坐标都落在校园范围内（没有把站配到别处）",
    badCoord.length === 0, badCoord.join("、"));

  const noOsm = Object.keys(stops).filter((k) => !(stops[k].osm || []).length);
  check("每个站都记得住是从哪些 OSM 节点来的",
    noOsm.length === 0, noOsm.join("、"));

  /* 路线引用的站必须存在，而且顺序不能有重复站名歧义 */
  function stopId(entry) { return typeof entry === "string" ? entry : entry.id; }
  const dangling = [];
  routes.forEach((r) => {
    r.stops.forEach((s) => {
      if (!stops[stopId(s)]) dangling.push(r.no + ":" + stopId(s));
    });
  });
  check("路线里的站都能在站点表里找到", dangling.length === 0, dangling.join("、"));

  /* 首尾站：环线要首尾同一个站，单程线不能相同 */
  const loopBad = routes.filter((r) => r.loop)
    .filter((r) => stopId(r.stops[0]) !== stopId(r.stops[r.stops.length - 1]));
  check("环线首尾是同一个站", loopBad.length === 0, loopBad.map((r) => r.no).join("、"));
  const openBad = routes.filter((r) => !r.loop)
    .filter((r) => stopId(r.stops[0]) === stopId(r.stops[r.stops.length - 1]));
  check("单程线首尾不是同一个站", openBad.length === 0, openBad.map((r) => r.no).join("、"));

  /* 时间要说得通 */
  const timeBad = [];
  routes.forEach((r) => {
    if (!r.sessions || !r.sessions.length) timeBad.push(r.no + "(没有服务时段)");
    (r.sessions || []).forEach((s) => {
      if (!s.days.length) timeBad.push(r.no + "(没有服务日)");
      if (!(s.from < s.to)) timeBad.push(r.no + "(" + s.from + "-" + s.to + ")");
    });
    if (!r.everyHour.length) timeBad.push(r.no + "(没有开车间隔)");
    r.everyHour.forEach((m) => { if (!(m >= 0 && m < 60)) timeBad.push(r.no + "(" + m + ")"); });
  });
  check("服务时段和开车间隔都合理", timeBad.length === 0, timeBad.join("、"));

  /* 附件里的四张表都要能在数据里对上 */
  const hour = (no, from, to) => {
    const r = routes.filter((x) => x.no === no)[0];
    return !!r && r.sessions.some((s) => s.from === from && s.to === to);
  };
  check("穿梭校巴的时刻和附件一致",
    hour("1", "07:40", "18:55") && hour("2", "07:45", "18:45") &&
    hour("2S", "08:00", "18:30") && hour("3", "09:00", "18:40") &&
    hour("4", "07:30", "18:50") && hour("8", "07:35", "18:35"));
  check("晚间/假日线的时刻和附件一致",
    hour("N", "19:00", "23:30") && hour("H", "08:20", "23:20"));
  check("转堂校巴的时刻和附件一致（一至五 与 星期六 分开）",
    hour("5", "09:18", "17:26") && hour("5", "09:18", "13:26") &&
    hour("6A", "09:10", "17:10") && hour("6B", "12:20", "17:20") &&
    hour("7", "08:18", "17:18"));
  check("6B 星期六不开（附件里是 --）",
    routes.filter((r) => r.no === "6B")[0].sessions.length === 1);
  check("转堂校巴注明只限教学日",
    routes.filter((r) => r.group === "meetclass")
      .every((r) => r.days.indexOf("教學日") >= 0));

  /* 附注：哪几班才停某站 */
  const noteOf = (no, stop) => {
    const r = routes.filter((x) => x.no === no)[0];
    const hit = r.stops.filter((s) => stopId(s) === stop)[0];
    return hit && typeof hit === "object" ? hit.note : "";
  };
  check("N1：只有部分班次停邵逸夫堂，写进了站点附注",
    (noteOf("2", "邵逸夫堂") || "").indexOf("31") >= 0, noteOf("2", "邵逸夫堂"));
  check("N2：非教学日改停大学站广场/崇基教学楼，写成了线路附注",
    (routes.filter((r) => r.no === "8")[0].serviceNote || "").indexOf("非教學日") >= 0);
  check("N3/N4：逢 00 分的班次才停研究生宿舍一座",
    (noteOf("N", "研究生宿舍一座") || "").indexOf("00") >= 0 &&
    (noteOf("H", "研究生宿舍一座") || "").indexOf("00") >= 0);

  /* 上下行是两个站位，不能被合并成一个 */
  /* 8 号线最典型：同一趟里 39 区上行、下行都停 */
  const uni = routes.filter((r) => r.no === "8")[0].stops.map(stopId);
  check("同一个地方的上行/下行站分开记（环回线来回都停）",
    uni.indexOf("39區（上行）") >= 0 && uni.indexOf("39區（下行）") >= 0 &&
    stops["39區（上行）"] && stops["39區（下行）"],
    "route8 站序=" + uni.join(">") + " | stops有上=" + !!stops["39區（上行）"] +
    " 有下=" + !!stops["39區（下行）"]);

  check("页面会加载这份数据", pageHtml.indexOf('src="data/shuttle.js"') > 0);
  check("生成脚本和数据文件都在",
    fs.existsSync(path.join(root, "tools", "make-shuttle.js")) &&
    fs.existsSync(path.join(root, "tools", "shuttle-source.json")) &&
    fs.existsSync(path.join(root, "tools", "osm-stops.json")));
  check("记下了来源（交通处路线图 + 官网 + OSM）",
    typeof meta.source === "string" && meta.source.indexOf("交通處") >= 0);
  check("生成时没有漏掉的站", (meta.missingStops || []).length === 0);

  /* 收费小巴（up/down）明确不在这一版范围里 */
  check("没有混进收费小巴路线",
    routes.every((r) => ["shuttle", "night", "meetclass"].indexOf(r.group) >= 0));
}


console.log("\n[36] 校巴乘坐规划");
{
  const S = OP.Shuttle;
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const stops = OP.SHUTTLE_STOPS;
  const R = (no) => OP.SHUTTLE_ROUTES.filter((r) => r.no === no)[0];
  const at = (lat, lng, elevation) => ({ lat: lat, lng: lng, elevation: elevation });
  const SETTINGS = { walkingSpeed: 75, detourFactor: 1.3, climbFactor: 8, busSpeed: 330 };

  check("规划模块挂在 OP.Shuttle 上",
    S && typeof S.plan === "function" && typeof S.nextDepartures === "function" &&
    typeof S.rideMinutes === "function");
  check("页面加载了规划模块", pageHtml.indexOf('src="js/shuttle.js"') > 0);

  /* ---------- 海拔 ---------- */
  const noElev = Object.keys(stops).filter((k) => typeof stops[k].elevation !== "number");
  check("每个车站都有海拔（共 " + Object.keys(stops).length + " 个）",
    noElev.length === 0, noElev.join("、"));
  check("海拔值落在校园范围内（0–200 米）",
    Object.keys(stops).every((k) => stops[k].elevation >= 0 && stops[k].elevation <= 200));

  const flat = at(22.4145, 114.2102, 10);
  const hill = at(22.4145, 114.2102, 110);
  check("走路时间算进了爬升：同一个点，从山下走上去比走下来慢得多",
    S.walkMinutes(flat, hill, SETTINGS) > 10 && S.walkMinutes(hill, flat, SETTINGS) < 0.01,
    S.walkMinutes(flat, hill, SETTINGS).toFixed(1) + " 分 vs " +
    S.walkMinutes(hill, flat, SETTINGS).toFixed(2) + " 分");
  check("爬升折算系数设成 0 就退回纯水平距离",
    S.walkMinutes(flat, hill, Object.assign({}, SETTINGS, { climbFactor: 0 })) < 0.01);
  check("坐车那段也把高差算进去（3D 路程）",
    S.legMinutes(flat, hill, SETTINGS) > 0,
    S.legMinutes(flat, hill, SETTINGS).toFixed(3) + " 分");

  /* ---------- 附注规则 ---------- */
  const r1 = S.noteRules("逢 00 分開出的班次才停");
  check("「逢 00 分開出的班次才停」翻成「只有这几分钟发的班次才停」",
    r1.minutes && r1.minutes.length === 1 && r1.minutes[0] === 0);
  const r2 = S.noteRules("逢 31 至 00 分開出的班次才停");
  check("「逢 31 至 00 分」覆盖 31–59 和 00 分",
    r2.minutes.indexOf(31) >= 0 && r2.minutes.indexOf(45) >= 0 &&
    r2.minutes.indexOf(0) >= 0 && r2.minutes.indexOf(15) < 0);
  check("「只在教學日」标成要看校历",
    S.noteRules("只在教學日").dayType === "teaching" &&
    S.noteRules("只在非教學日").dayType === "nonTeaching");
  check("逢 00 分才停的站，10:15 那班不算数",
    S.runStops(r1, new Date(2026, 8, 30, 10, 15, 0)) === false &&
    S.runStops(r1, new Date(2026, 8, 30, 10, 0, 0)) === true);

  /* ---------- 发车时刻与星期 ---------- */
  const dep = S.nextDepartures(R("1"), new Date(2026, 8, 30, 8, 0, 0), 3);
  check("1 号线 08:00 之后依次是 08:10 / 08:25 / 08:40",
    dep.map((d) => d.getHours() * 60 + d.getMinutes()).join(",") === "490,505,520",
    dep.map((d) => d.toTimeString().slice(0, 5)).join(" "));
  check("过了收车时间就没有班次",
    S.nextDepartures(R("1"), new Date(2026, 8, 30, 19, 30, 0), 1).length === 0);
  check("星期日只有假日线 H 在开",
    S.routesOn(new Date(2026, 8, 27, 10, 0, 0)).map((r) => r.no).join(",") === "H");
  check("星期三除假日线外都在开（11 条）",
    S.routesOn(new Date(2026, 8, 30, 10, 0, 0)).length === 11);

  /* ---------- 坐车时间 ---------- */
  check("4 号线前 5 站坐车时间算得出来",
    S.rideMinutes(R("4"), 0, 5, SETTINGS) > 0);
  check("单向线不能往回坐", S.rideMinutes(R("6A"), 5, 1, SETTINGS) === null);
  /* 用户明确更正：所有路线到终点都清客，不存在"绕一圈回来" */
  check("任何路线都不能往回坐（4 号线从最后一站坐回首站也不行）",
    S.rideMinutes(R("4"), 14, 0, SETTINGS) === null);
  check("3 号线从逸夫书院（下行）坐不到科学馆（科学馆在前段）",
    S.rideMinutes(R("3"), 10, 2, SETTINGS) === null);
  check("3 号线顺着坐没问题（科学馆 → 冯景禧楼）",
    S.rideMinutes(R("3"), 2, 3, SETTINGS) > 0);

  /* ---------- 真实场景：从伍宜孙书院去利黄瑶璧楼 ---------- */
  const wu = at(22.422149, 114.202623, 88);
  const esther = at(22.413875, 114.208487, 33);
  const walkMin = S.walkMinutes(wu, esther, SETTINGS);
  const plan = S.plan(wu, esther, new Date(2026, 8, 30, 9, 30, 0), walkMin, SETTINGS,
    new Date(2026, 8, 30, 10, 40, 0));

  check("返回结构是「最近上下车站 + 若干乘车方案」",
    plan && plan.board && plan.alight && Array.isArray(plan.groups));
  check("上山那段要 15 分钟以上（海拔算进去了）", walkMin > 15, walkMin.toFixed(1));

  /* 最近的车站：和按步行时间排出来的第一名一致 */
  const boardCandidates = S.nearbyStops(wu, SETTINGS, S.MAX_ACCESS_BOARD);
  const alightCandidates = S.nearbyStops(esther, SETTINGS, S.MAX_ACCESS_ALIGHT);
  check("上车站取的是离你最近的那个（按走过去的时间）",
    plan.board.id === boardCandidates[0].id,
    plan.board.id + " vs " + boardCandidates[0].id);
  check("下车站取的是离目的地最近的那个",
    plan.alight.id === alightCandidates[0].id,
    plan.alight.id + " vs " + alightCandidates[0].id);
  check("上车站确实在伍宜孙书院一带", plan.board.id.indexOf("伍宜孫書院") >= 0 ||
    plan.board.id.indexOf("逸夫書院") >= 0, plan.board.id);
  check("目的地那一头的搜索半径比上车那头大（让更多线路能显示）",
    S.MAX_ACCESS_ALIGHT > S.MAX_ACCESS_BOARD,
    "上车 " + S.MAX_ACCESS_BOARD + " 米 / 下车 " + S.MAX_ACCESS_ALIGHT + " 米");

  /* 另一个场景：这一段走路本来只要 6 分钟，校巴大多更慢——慢的也照样列 */
  const slowCase = S.plan(
    at(stops["大學站"].lat, stops["大學站"].lng, stops["大學站"].elevation),
    esther, new Date(2026, 8, 30, 10, 0, 0), 6, SETTINGS);

  check("给出了可以坐的线路", plan.groups.length > 0,
    plan.groups.map((g) => g.route.no).join(","));

  const best = plan.groups[0];
  check("第一组用的是最近的站（组内上下车站的步行时间不比别组差）",
    best.board.minutes + best.alight.minutes <=
      Math.min.apply(null, plan.groups.map((g) => g.board.minutes + g.alight.minutes)) + 0.001,
    plan.groups.map((g) => g.route.no + ":" +
      (g.board.minutes + g.alight.minutes).toFixed(1)).join(" "));

  check("同一条线只出现一次（不把近站远站各列一遍）",
    new Set(plan.groups.map((g) => g.route.no)).size === plan.groups.length,
    plan.groups.map((g) => g.route.no).join(","));
  check("方案里不再有「绕一圈」这种字段和文案",
    plan.groups.every((g) => !("wrapped" in g) && !("circular" in g)) &&
    appCode.indexOf("要繞一圈") === -1);
  /* 用户要求：校巴到站时间太不稳，所有"几点到"的元素全部去掉 */
  check("方案里不再有任何「几点到」数据",
    plan.groups.every((g) => !("rides" in g) && !("departAt" in g)));
  check("每条线只给三段时长：走到车站 / 车程 / 走到教室",
    plan.groups.every((g) => g.walkBeforeMin >= 0 && g.rideMin > 0 && g.walkAfterMin >= 0),
    plan.groups.map((g) => g.route.no).join(","));
  check("合计就是三段之和",
    plan.groups.every((g) =>
      Math.abs(g.totalMin - (g.walkBeforeMin + g.rideMin + g.walkAfterMin)) < 1e-6));
  check("每条线给出大概几分钟一班（这个是从发布班次推的，稳定）",
    plan.groups.every((g) => typeof g.headwayMin === "number" && g.headwayMin > 0),
    plan.groups.map((g) => g.route.no + ":" + g.headwayMin).join(" "));
  check("按坐车总耗时从短到长排",
    plan.groups.every((g, i) => i === 0 || plan.groups[i - 1].totalMin <= g.totalMin + 1e-6),
    plan.groups.map((g) => g.route.no + ":" + Math.round(g.totalMin)).join(" "));

  /* 用户明确要求：慢也要列，只要那条线能到目的地附近的车站 */
  check("能到的线路全部列出（不止最快那一条）", plan.groups.length >= 4,
    plan.groups.map((g) => g.route.no).join(","));
  check("比走路慢的线路也在里面",
    slowCase.groups.some((g) => g.saves < -2) &&
    slowCase.groups.every((g) => !("rides" in g)),
    slowCase.groups.map((g) => g.route.no + ":" + Math.round(g.saves)).join(" "));
  check("至少有一条比走路快",
    plan.groups.some((g) => g.saves > 0),
    plan.groups.map((g) => g.route.no + ":" + Math.round(g.saves)).join(" "));


  /* ---------- 条件站 ---------- */
  const toCcc = S.plan(at(stops["大學站"].lat, stops["大學站"].lng, stops["大學站"].elevation),
    at(stops["崇基教學樓"].lat, stops["崇基教學樓"].lng, stops["崇基教學樓"].elevation),
    new Date(2026, 8, 30, 10, 0, 0), 20, SETTINGS);
  const bad8 = toCcc.groups.filter((g) => g.route.no === "8" &&
    g.board.id === "大學站廣場" && g.caveat !== "nonTeaching");
  check("8 号线不会把「只在非教学日」的站当成每次都停", bad8.length === 0,
    bad8.map((g) => g.board.id).join("、"));

  /* ---------- 界面接线 ---------- */
  check("路线上每段都会试着算校巴",
    /busOptions\(leg, c\)/.test(appCode) && /OP\.Shuttle\.plan\(/.test(appCode));
  check("界面不筛掉任何线路，全部列出来",
    appCode.indexOf("WORTH_MIN") === -1 &&
    appCode.indexOf("var groups = plan.groups || [];") > 0);
  check("界面只写三段时长 + 合计 + 班次间隔",
    appCode.indexOf("走到车站 <b>") > 0 && appCode.indexOf("车程 <b>") > 0 &&
    appCode.indexOf("分 + 走到") > 0 && appCode.indexOf("分钟一班") > 0);
  check("界面上没有任何「几点到」的时刻",
    appCode.indexOf("车到站") === -1 && appCode.indexOf("到目标站") === -1 &&
    appCode.indexOf("clockText(") === -1);
  check("地图会标出相关车站",
    appCode.indexOf("busStops: d.busStops") > 0 &&
    appCode.indexOf("function collectBus(") > 0 &&
    fs.readFileSync(path.join(root, "js", "map.js"), "utf8").indexOf('class="bus-stop') > 0 &&
    fs.readFileSync(path.join(root, "js", "realmaps.js"), "utf8").indexOf("drawBusStops") > 0 &&
    fs.readFileSync(path.join(root, "styles.css"), "utf8").indexOf(".bus-stop-label") > 0);
  check("没有方案时会写明原因（没车 / 赶不上 / 比走路慢）",
    appCode.indexOf("plan.reason") > 0 &&
    fs.readFileSync(path.join(root, "js", "shuttle.js"), "utf8")
      .indexOf("没有线路从上车站坐到下车站（校巴单向）") > 0);
  check("校巴模块没加载时会明说是旧缓存",
    appCode.indexOf("校巴模块没加载") > 0 && appCode.indexOf("is-missing") > 0 &&
    fs.readFileSync(path.join(root, "styles.css"), "utf8").indexOf(".leg-bus.is-missing") > 0);
  check("设置里能调校巴速度",
    pageHtml.indexOf('id="sBusSpeed"') > 0 &&
    appCode.indexOf('["#sBusSpeed", "busSpeed"]') > 0 &&
    OP.Store.defaults().settings.busSpeed > 0);
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  check("校巴方案有独立样式",
    css.indexOf(".leg-bus") > 0 && css.indexOf(".bus-tag") > 0 &&
    css.indexOf(".bus-ride") > 0 && css.indexOf(".bus-verdict") > 0);
}

console.log("\n[37] 自动更新 / 真实地图连线顺序 / 楼栋列表收起");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const deployCode = fs.readFileSync(path.join(root, "tools", "deploy.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  /* ---------- 部署后自动换新版本 ---------- */
  check("页面里带了构建号（本地是 dev）",
    /<meta name="build" content="[^"]*"/.test(pageHtml));
  check("页面会拿 build.json 比版本",
    pageHtml.indexOf('fetch("build.json", { cache: "no-store" })') > 0);
  check("发现新版本会带参数重载（否则 HTML 还是缓存里那份）",
    pageHtml.indexOf('url.searchParams.set("t", info.stamp)') > 0 &&
    pageHtml.indexOf("location.replace(url.toString())") > 0);
  check("重载过一次就不再重载，避免死循环",
    pageHtml.indexOf('if (url.searchParams.get("t") === info.stamp) return;') > 0);
  check("本地打开（dev）时不检查版本", pageHtml.indexOf('mine === "dev"') > 0);
  check("部署脚本会把构建号写进 HTML",
    /<meta name="build" content="'\s*\+\s*stamp/.test(deployCode));
  check("部署脚本会生成 build.json",
    deployCode.indexOf('"build.json"') > 0 && deployCode.indexOf("stamp: stamp") > 0);

  /* ---------- 真实地图的连线顺序 ---------- */
  const RealMap = OP.RealMap;
  check("连线点顺序抽成了可测的函数", typeof RealMap.routePoints === "function");

  const pos = { lat: 22.41, lng: 114.20 };
  const ordered = RealMap.routePoints(pos, [
    { building: { lat: 22.42, lng: 114.21 } },
    { building: { lat: 22.43, lng: 114.22 } }
  ]);
  check("连线从「我的位置」开始，再按 1、2 的顺序",
    JSON.stringify(ordered) === JSON.stringify([
      [22.41, 114.20], [22.42, 114.21], [22.43, 114.22]
    ]), JSON.stringify(ordered));
  check("没有定位时不硬塞一个起点",
    JSON.stringify(RealMap.routePoints(null, [{ building: { lat: 1, lng: 2 } }])) === "[[1,2]]");
  check("同一条线上的点不会重复（只有一栋要去的楼）",
    RealMap.routePoints(pos, [{ building: { lat: 22.42, lng: 114.21 } }]).length === 2);
  check("画线用的是这份点",
    /var points = routePoints\(opts\.position, stops\);/.test(
      fs.readFileSync(path.join(root, "js", "realmaps.js"), "utf8")));

  /* ---------- 楼栋列表收起 ---------- */
  check("默认收起，只显示前几栋",
    /buildingListExpanded: false/.test(appCode) &&
    /BUILDING_PREVIEW = (\d+)/.test(appCode) &&
    Number(/BUILDING_PREVIEW = (\d+)/.exec(appCode)[1]) >= 3);
  check("收起时只截前几栋",
    appCode.indexOf("shown.slice(0, BUILDING_PREVIEW)") > 0);
  check("有个「显示全部 / 收起」的按钮",
    appCode.indexOf("data-toggle-buildings") > 0 &&
    appCode.indexOf("显示全部 ") > 0 &&
    appCode.indexOf("收起（只看前 ") > 0);
  check("点按钮会展开/收起并重画列表",
    /state\.buildingListExpanded = !state\.buildingListExpanded[\s\S]{0,140}renderBuildingList\(/.test(appCode));
  check("搜索时不收起（正在找某一栋，别藏起来）",
    appCode.indexOf("var searching = !!(query || missingOnly);") > 0 &&
    appCode.indexOf("(searching || state.buildingListExpanded)") > 0);
  check("展开按钮有样式", css.indexOf(".building-more") > 0);
}

console.log("\n[38] 主题、连堂课、停运折叠、地图连线");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const geoCode = fs.readFileSync(path.join(root, "js", "geo.js"), "utf8");
  const mapCode = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
  const realMapCode = fs.readFileSync(path.join(root, "js", "realmaps.js"), "utf8");
  const deployCode = fs.readFileSync(path.join(root, "tools", "deploy.js"), "utf8");
  const shuttleCode = fs.readFileSync(path.join(root, "js", "shuttle.js"), "utf8");

  /* ---------- 日系可爱粉色主题 + 背景图 ---------- */
  check("配色换成了粉色系",
    /--accent:\s*#ff5fa2/i.test(css) && /--bg:\s*#fff/i.test(css) &&
    /--text:\s*#4a2b3a/i.test(css));
  check("声明了浅色页面（原生控件才不会跟着系统深色模式变黑）",
    /color-scheme:\s*light/.test(css));
  check("背景用上了附件那张图",
    css.indexOf('url("voaf_ga09.jpg")') > 0 && fs.existsSync(path.join(root, "voaf_ga09.jpg")));
  check("背景图会被部署到线上", deployCode.indexOf('"voaf_ga09.jpg"') > 0);
  check("系统开「减少动态效果」时关掉动画",
    /prefers-reduced-motion:\s*reduce/.test(css));
  check("滑块在浅色底上重画过（不再是黑条）",
    css.indexOf("::-webkit-slider-thumb") > 0 && css.indexOf("::-moz-range-thumb") > 0);

  /* ---------- 地图跳转：Google 是标了 primary 的那条 ---------- */
  /* 「现在出发 / 现在回宿舍」两颗按钮已经按用户要求删掉，
     地图跳转只剩行程卡片里那排链接（每段行程一组）。primary 标记留着，
     是为了"默认用哪家地图"这件事在 geo.js 里仍然只有一个出处。 */
  check("Google 地图那条链接标了 primary（默认用它）",
    /label:\s*"Google 地图"[\s\S]{0,220}primary:\s*true/.test(geoCode));
  check("行程卡片里仍然有地图跳转入口（删按钮没把这条路一起删掉）",
    appCode.indexOf("Geo.navLinks(b.name, b.lat, b.lng)") > 0 &&
    appCode.indexOf('class="nav-link"') > 0);

  /* ---------- 学期开始日期默认值 ---------- */
  check("默认学期开始日期是 2026-09-07",
    OP.Store.defaults().settings.termStart === "2026-09-07",
    OP.Store.defaults().settings.termStart);

  /* ---------- 提醒与步行参数：恢复默认配置 ---------- */
  check("卡片里有「恢复默认配置」按钮", pageHtml.indexOf('id="btnResetWalk"') > 0);
  check("按钮只重置这一张卡片的项",
    /btnResetWalk"\)\.addEventListener[\s\S]{0,700}leadMinutes[\s\S]{0,200}termStart/.test(appCode) &&
    appCode.indexOf("OP.Store.defaults().settings") > 0);

  /* ---------- H 线要显示，停运的折叠 ---------- */
  const S = OP.Shuttle;
  const H = OP.SHUTTLE_ROUTES.filter((r) => r.no === "H")[0];
  const wed10 = new Date(2026, 8, 30, 10, 0, 0);
  const wed20 = new Date(2026, 8, 30, 20, 0, 0);
  const sun10 = new Date(2026, 8, 27, 10, 0, 0);
  check("H 线只在星期日及公众假期开", S.runsOn(H, sun10) && !S.runsOn(H, wed10));
  check("runsNow 还要看钟点：晚间线 20:00 算在开、10:00 算停运",
    S.runsNow(OP.SHUTTLE_ROUTES.filter((r) => r.no === "N")[0], wed20) &&
    !S.runsNow(OP.SHUTTLE_ROUTES.filter((r) => r.no === "N")[0], wed10));
  check("规划不再按「今天开不开」把线路剔掉",
    shuttleCode.indexOf("if (!runsOn(route, when)) return;") === -1 &&
    shuttleCode.indexOf("runningNow: runsNow(route, when)") > 0);
  const planAt10 = S.plan(
    { lat: 22.422149, lng: 114.202623, elevation: 88 },
    { lat: 22.413875, lng: 114.208487, elevation: 33 },
    wed10, 19, { walkingSpeed: 75, detourFactor: 1.3, climbFactor: 8, busSpeed: 330 });
  check("白天的方案里也列出了 H 线（只是标成停运）",
    planAt10.groups.some((g) => g.route.no === "H" && !g.runningNow),
    planAt10.groups.map((g) => g.route.no + (g.runningNow ? "开" : "停")).join(" "));
  check("在开的线路排在前面",
    planAt10.groups.every((g, i) => i === 0 ||
      !(g.runningNow && !planAt10.groups[i - 1].runningNow)));
  check("界面把停运的折起来",
    appCode.indexOf("bus-off") > 0 && appCode.indexOf("现在停运的线路") > 0 &&
    css.indexOf(".bus-off > summary") > 0);

  /* ---------- 连堂课不再拆成两段 ---------- */
  const P2 = OP.Planner;
  const consecutive = {
    version: 1,
    campus: { name: "x", buildings: [{ id: "A", name: "甲楼", alias: [], lat: 22.42, lng: 114.20, elevation: 50 }] },
    courses: [
      { id: "c1", name: "课一", teacher: "", buildingId: "A", room: "101", weekdays: [1], start: "10:00", end: "10:45", weeks: [1, 30] },
      { id: "c2", name: "课二", teacher: "", buildingId: "A", room: "101", weekdays: [1], start: "11:00", end: "11:45", weeks: [1, 30] }
    ],
    settings: OP.Store.defaults().settings
  };
  const backToBack = P2.routeLegs(consecutive, { lat: 22.43, lng: 114.21, elevation: 60 },
    new Date(2026, 8, 28, 9, 0, 0));
  check("同一栋楼的连堂课只出一段行程（不再原地打转）",
    backToBack.length === 1, backToBack.length + " 段");
  check("没有「从这栋楼去这栋楼」的行程",
    backToBack.every((leg) => !leg.fromPoint || !leg.building ||
      leg.fromPoint.lat !== leg.building.lat || leg.fromPoint.lng !== leg.building.lng));

  /* ---------- 地图：取消地点连线，改画去车站 / 车站去教室 ---------- */
  check("简图不再画地点之间的连线",
    mapCode.indexOf("route-line") === -1 && mapCode.indexOf("dist-label") === -1 &&
    mapCode.indexOf('class="bus-link') > 0);
  check("真实地图也不再画那条折线",
    realMapCode.indexOf("route-line") === -1 &&
    realMapCode.indexOf("opts.busLinks") > 0 && realMapCode.indexOf("bus-link") === -1);
  check("两种连线都来自应用里算好的 busLinks",
    appCode.indexOf("function collectBus(") > 0 &&
    appCode.indexOf("out.busLinks.push({ from: fromPoint, to: best.board.stop })") > 0 &&
    appCode.indexOf("out.busLinks.push({ from: best.alight.stop, to: toPoint })") > 0);

  const linkSvg = { innerHTML: "" };
  OP.MapView.render(linkSvg, {
    buildings: [{ id: "A", name: "甲楼", lat: 22.42, lng: 114.20 }],
    position: { lat: 22.43, lng: 114.21 },
    stops: [{ building: { id: "A", name: "甲楼", lat: 22.42, lng: 114.20 }, order: 1, time: "10:00", isNext: true }],
    busLinks: [{ from: { lat: 22.43, lng: 114.21 }, to: { lat: 22.425, lng: 114.205 } }]
  });
  check("简图上画出了「我的位置 → 车站」这条线",
    (linkSvg.innerHTML.match(/class="bus-link"/g) || []).length === 1);
}

console.log("\n[39] 背景视频（截前 16 秒循环）");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const deployCode = fs.readFileSync(path.join(root, "tools", "deploy.js"), "utf8");
  const videoPath = path.join(root, "bg-loop.mp4");

  check("页面里有背景视频元素", pageHtml.indexOf('id="bgVideo"') > 0);
  check("视频是循环、静音、不挡点击的",
    /<video[^>]*\bautoplay\b[^>]*\bloop\b/.test(pageHtml) &&
    /<video[^>]*\bmuted\b/.test(pageHtml) &&
    /<video[^>]*\bplaysinline\b/.test(pageHtml));
  check("视频源指向 bg-loop.mp4", pageHtml.indexOf('src="bg-loop.mp4"') > 0);
  check("视频还没起来时先显示原来那张静态图",
    pageHtml.indexOf('poster="voaf_ga09.jpg"') > 0 && css.indexOf('url("voaf_ga09.jpg")') > 0);
  check("粉色纱单独一层（图看得见、字也看得清）", css.indexOf(".bg-veil") > 0);
  check("背景层固定铺满、不参与交互",
    /\.bg-layer\s*\{[\s\S]{0,220}position:\s*fixed/.test(css) &&
    /\.bg-layer\s*\{[\s\S]{0,220}pointer-events:\s*none/.test(css));
  check("页面主体压在背景层上面", /\.app\s*\{[\s\S]{0,220}z-index:\s*1/.test(css));
  check("视频铺满窗口（宁可裁边，也不留黑边、不变形）",
    /\.bg-video\s*\{[\s\S]{0,220}object-fit:\s*cover/.test(css));
  check("系统开「减少动态效果」时退回静态图",
    /prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]{0,220}\.bg-video\s*\{\s*display:\s*none/.test(css));
  check("系统开「减少动态效果」时也不再偷偷播（省电）",
    /initBackgroundVideo[\s\S]{0,600}prefers-reduced-motion/.test(appCode));
  check("启动时会补播一次（iOS 不认 autoplay）",
    appCode.indexOf("function initBackgroundVideo") > 0 &&
    /boot\(\)\s*\{[\s\S]{0,400}initBackgroundVideo\(\)/.test(appCode));
  check("补播失败还会等第一次点击 / 触摸",
    appCode.indexOf('addEventListener("touchstart", onGesture') > 0 &&
    appCode.indexOf('addEventListener("click", onGesture') > 0);
  check("切回前台会再补一次", appCode.indexOf('visibilitychange') > 0);
  check("视频会一起部署到线上", deployCode.indexOf('"bg-loop.mp4"') > 0);

  /* 视频文件本身：必须在，别太大（GitHub 单文件 100MB 会拒收），
     而且要真的是 16 秒。这里直接读 mp4 的 mvhd 头算时长，不用装 ffmpeg。 */
  check("bg-loop.mp4 在仓库里", fs.existsSync(videoPath));
  const size = fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0;
  check("体积压到了 5MB 以内", size > 0 && size < 5 * 1024 * 1024,
    (size / 1024 / 1024).toFixed(2) + " MB");
  check("体积也没有小得离谱（说明不是空文件）", size > 200 * 1024,
    (size / 1024).toFixed(0) + " KB");

  /* mvhd 里存着 timescale 和 duration，除一下就是秒数 */
  function mp4Duration(file) {
    const buf = fs.readFileSync(file);
    const at = buf.indexOf(Buffer.from("mvhd", "latin1"));
    if (at === -1) return 0;
    const version = buf[at + 4];
    const timescale = version === 1 ? buf.readUInt32BE(at + 20) : buf.readUInt32BE(at + 16);
    const duration = version === 1
      ? Number(buf.readBigUInt64BE(at + 24))
      : buf.readUInt32BE(at + 20);
    return timescale ? duration / timescale : 0;
  }
  const seconds = fs.existsSync(videoPath) ? mp4Duration(videoPath) : 0;
  check("时长就是 16 秒（截前 16 秒，正好一个循环）",
    Math.abs(seconds - 16) <= 0.2, seconds.toFixed(2) + " 秒");

  /* 原片带音轨，用户明确说不要音乐：转码时 -an 去掉了，
     这里确认没有音频采样描述 */
  const raw = fs.existsSync(videoPath) ? fs.readFileSync(videoPath, "latin1") : "";
  check("没有音轨（转码时去掉了音乐）", raw.indexOf("mp4a") === -1);
}

console.log("\n[40] 界面做成半透明（背景才透得出来）");
{
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  /* 从一条 rgba(255, 255, 255, x) 里把 x 抠出来 */
  function alphaOf(pattern) {
    const m = pattern.exec(css);
    return m ? Number(m[1]) : null;
  }
  /* 颜色全收敛成 token 之后，断言改成读 token 的透明度。
     表面色不再是纯白，而是往锚点色相偏了一点点（审计 minor：纯白读起来是合成的）。 */
  function tokenAlpha(name) {
    const m = new RegExp(name + ":\\s*rgba\\([^)]*,\\s*([0-9.]+)\\)").exec(css);
    return m ? Number(m[1]) : null;
  }
  const cardAlpha = tokenAlpha("--card");
  const card2Alpha = tokenAlpha("--card-2");
  const softAlpha = tokenAlpha("--bg-soft");

  /* 上限从 0.7 放到 0.8：卡片不再是厚玻璃之后，白度要顶上来一点，
     否则背景视频里清晰的形体会跟文字抢（实测过：0.70 时可读性明显变差）。 */
  check("卡片是半透明的（原来 0.92，基本等于实心）",
    cardAlpha !== null && cardAlpha <= 0.8 && cardAlpha >= 0.3, "alpha=" + cardAlpha);
  check("按钮/次级面比卡片更透一点，层次还在",
    card2Alpha !== null && card2Alpha < cardAlpha, "alpha=" + card2Alpha);
  /* 这条是关键：卡片的渐变第二段用的是 --bg-soft，
     它要是实色（以前是 #ffe8f2），卡片下半截就又变成不透光的了 */
  check("卡片渐变的第二段也是半透明（不然下半截又实心了）",
    softAlpha !== null && softAlpha <= 0.7, "alpha=" + softAlpha);
  /* 审计 major：六层同样厚的玻璃把层级糊掉了。修法是**按层分档**——
     卡片 8px 轻糊（它下面是真在动的视频，完全不糊可读性会掉），
     真正浮在内容之上的层（顶栏 / 底栏 / 提示条 / 候选 / 对话框）用 14–22px 厚玻璃。 */
  check("毛玻璃按层分档：卡片轻糊，浮层厚玻璃",
    Number(/\.card\s*\{[\s\S]{0,600}?backdrop-filter:\s*blur\((\d+)/.exec(css)[1]) <
    Number(/\.topbar\s*\{[\s\S]{0,600}?backdrop-filter:\s*blur\((\d+)/.exec(css)[1]) &&
    /\.toast\s*\{[\s\S]{0,900}backdrop-filter:\s*blur/.test(css));
  check("顶栏是半透明的", /\.topbar\s*\{[\s\S]{0,600}background:\s*var\(--topbar-bg\)/.test(css) &&
    tokenAlpha("--topbar-bg") <= 0.7);
  check("底部导航是半透明的",
    /\.tabbar\s*\{[\s\S]{0,600}background:\s*var\(--panel-faint\)/.test(css) &&
    tokenAlpha("--panel-faint") <= 0.7);

  /* 粉色纱变薄了，但还得留下一层，不然白卡片上的粉字会糊 */
  const veil = /\.bg-veil\s*\{[\s\S]{0,300}?var\(--veil-1\)[\s\S]{0,120}?var\(--veil-2\)/.exec(css);
  const veilA = tokenAlpha("--veil-1");
  const veilB = tokenAlpha("--veil-2");
  check("粉色纱调薄了（视频更清楚）",
    !!veil && veilA <= 0.5 && veilB <= 0.5, veilA + " / " + veilB);
  check("但纱没有撤掉（透明度不为 0）",
    !!veil && veilA > 0.2 && veilB > 0.2);

  /* 确认框是要人做决定的地方，不能跟着一起变透 */
  const modal = /\.modal-card\s*\{[\s\S]{0,600}?var\(--surface-4\)/.exec(css);
  check("确认框反而做得更实（看得清才敢点确定）",
    !!modal && tokenAlpha("--surface-4") >= 0.85, "alpha=" + tokenAlpha("--surface-4"));

  check("输入框还是半透明的（走 token）",
    /\.field input\[type="text"\][\s\S]{0,500}background:\s*var\(--surface-input\)/.test(css) &&
    tokenAlpha("--surface-input") <= 0.7);
  check("简图底色也透出来一点",
    /\.map-wrap\s*\{[\s\S]{0,400}radial-gradient\(circle at 50% 40%,\s*var\(--map-a\)/.test(css) &&
    tokenAlpha("--map-a") < 1);
  /* 真实地图（Leaflet 瓦片）要保持不透明，那种地图透了就没法看了 */
  check("街道图/港中文图的底仍是实色",
    /#mapReal\s*\{[^}]*background:\s*var\(--paper-warm\)/.test(css));
}

console.log("\n[41] 宿舍数据与「返回宿舍」");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const defaults = fs.readFileSync(path.join(root, "data", "defaults.js"), "utf8");

  /* ---------- 数据文件本身 ---------- */
  check("有宿舍数据文件", fs.existsSync(path.join(root, "data", "dorms.js")));
  const shipped = OP.DEFAULT_DORMS;
  check("宿舍数据带版本号和来源",
    !!shipped && typeof shipped.version === "number" &&
    /OpenStreetMap/.test(shipped.source || ""));
  check("宿舍数量够用（≥40 处）", shipped.dorms.length >= 40, shipped.dorms.length + " 处");

  /* 只要港中文的：全部落在校园这个框里 */
  const outOfCampus = shipped.dorms.filter((d) =>
    !(d.lat > 22.40 && d.lat < 22.44 && d.lng > 114.19 && d.lng < 114.22));
  check("全部都在港中文校园范围内（没抓成别的学校）",
    outOfCampus.length === 0,
    outOfCampus.map((d) => d.name).join("、"));
  check("每条都有 id / 名字 / 坐标",
    shipped.dorms.every((d) => d.id && d.name && typeof d.lat === "number" && typeof d.lng === "number"));
  /* 中文名是一个独立字段 nameZh，不是塞在别名里——界面上要「英文 中文」并排显示 */
  check("每条都有独立的中文字段 nameZh",
    shipped.dorms.every((d) => typeof d.nameZh === "string" && d.nameZh.length > 0),
    shipped.dorms.filter((d) => !d.nameZh).map((d) => d.name).join("、"));
  check("nameZh 里确实有汉字",
    shipped.dorms.every((d) => /[\u4e00-\u9fa5]/.test(d.nameZh)));
  check("中文名不是把英文名抄一遍",
    shipped.dorms.filter((d) => d.nameZh !== d.name).length === shipped.dorms.length);
  check("英文名也在（nameEn 字段）",
    shipped.dorms.every((d) => typeof d.nameEn === "string" && d.nameEn.length > 0));
  check("抽查一条：知行樓的中英文都对",
    (() => {
      const d = shipped.dorms.filter((x) => x.name === "Chih Hsing Hall")[0];
      return !!d && d.nameZh === "知行樓" && d.nameEn === "Chih Hsing Hall";
    })());
  check("几条已知宿舍在名单里",
    ["Chih Hsing Hall", "Ying Lin Tang", "Adam Schall Residence", "Chan Chun Ha Hostel"]
      .every((n) => shipped.dorms.some((d) => d.name === n)));
  /* 点名补录的：书院本身就是宿舍，OSM 标签不是 dormitory，关键词也捞不到 */
  check("晨興書院和伍宜孫書院在名单里（手工补录的）",
    ["Morningside College", "Wu Yee Sun College"]
      .every((n) => shipped.dorms.some((d) => d.name === n)));
  check("这两条也带中文名和 OSM 对象号",
    ["晨興書院", "伍宜孫書院"].every((zh) =>
      shipped.dorms.some((d) => d.nameZh === zh && /^(way|node|relation)-\d+$/.test(d.id))));
  check("补录的坐标在校园范围内、且是独一份的",
    shipped.dorms.filter((d) => /College$/.test(d.name) && !/Lee Woo Sing/.test(d.name))
      .every((d) => d.lat > 22.41 && d.lat < 22.43 && d.lng > 114.19 && d.lng < 114.22));

  /* ---------- 模块 API ---------- */
  const D = OP.Dorm;
  const list = D.all({});
  check("列表按名字排序",
    list.every((d, i) => i === 0 || list[i - 1].name.localeCompare(d.name) <= 0));
  check("按 id 能取回同一条", D.byId({}, list[0].id).name === list[0].name);
  check("中文名也能搜到", D.search({}, "知行").some((d) => d.name === "Chih Hsing Hall"));
  check("英文名也能搜到", D.search({}, "Chih Hsing").some((d) => d.name === "Chih Hsing Hall"));
  check("英文缩写也能搜到（C.C.）", D.search({}, "C.C. Staff").length > 0);
  check("搜不出来的关键词返回空",
    D.search({}, "zzzzzz").length === 0);
  /* 列表和卡片都显示「英文 中文」，只给一个写法会有人认不出来 */
  check("列表项带「英文 中文」双名",
    D.all({})[0].label.indexOf(" ") > 0 &&
    /[\u4e00-\u9fa5]/.test(D.all({})[0].label));
  check("双名写法自己也能被搜到（复制粘贴回输入框也能认）",
    D.search({}, D.byId({}, list[0].id).label).length === 1);
  check("中文名也在 dorm.names() 里（播报要用）",
    D.names(D.byId({}, list[0].id)).some((n) => /[\u4e00-\u9fa5]/.test(n)));

  /* ---------- 繁简互通 + 中文拼音首字母 ---------- */
  check("繁体转简体", D.toSimplified("知行樓應林堂") === "知行楼应林堂",
    D.toSimplified("知行樓應林堂"));
  check("本来就是简体就原样返回", D.toSimplified("知行楼") === "知行楼");
  check("转简体是幂等的（转两次和转一次一样）",
    D.toSimplified(D.toSimplified("國際生舍堂")) === D.toSimplified("國際生舍堂"));
  check("拼音首字母", D.initialsOf("知行樓") === "zxl", D.initialsOf("知行樓"));
  check("拼音首字母：宿舍两个字都是 s（sù shè）",
    D.initialsOf("伯利衡宿舍") === "blhss", D.initialsOf("伯利衡宿舍"));
  check("拼音首字母：长名字也对",
    D.initialsOf("五旬節會樓高座") === "wxjhlgz", D.initialsOf("五旬節會樓高座"));
  check("拼音首字母只看汉字，英文不参与",
    D.initialsOf("Chih Hsing Hall 知行樓") === "zxl");

  check("输简体「知行楼」能找到繁体那条",
    D.search({}, "知行楼").some((d) => d.name === "Chih Hsing Hall"));
  check("输繁体「知行樓」也能找到",
    D.search({}, "知行樓").some((d) => d.name === "Chih Hsing Hall"));
  check("简体「应林堂」能找到「應林堂」",
    D.search({}, "应林堂").some((d) => d.name === "Ying Lin Tang"));
  check("输首字母 zxl 能找到知行樓",
    D.search({}, "zxl").some((d) => d.name === "Chih Hsing Hall"));
  check("首字母在国际生舍堂上也管用",
    D.search({}, "gjss").some((d) => d.name === "International House 1"));
  check("首字母匹配不影响英文搜索",
    D.search({}, "Chih Hsing").some((d) => d.name === "Chih Hsing Hall") &&
    D.search({}, "Chih Hsing").every((d) => /Chih Hsing/.test(d.label)));
  check("每个宿舍都预先算好了首字母串",
    D.all({}).every((d) => d.zhInitials && d.zhInitials.length >= 2));

  /* 这张表最容易出的错是"漏字"：数据里冒出一个新字，没加进表，
     那个字的拼音就悄悄没了。所以这里逐个字验一遍。 */
  const allCjk = new Set();
  OP.DEFAULT_DORMS.dorms.forEach((d) => {
    [d.nameZh, d.name].concat(d.alias || []).forEach((v) => {
      String(v || "").replace(/[\u4e00-\u9fa5]/g, (c) => { allCjk.add(c); return ""; });
    });
  });
  const missing = Array.from(allCjk).filter((c) => D.ZH_CHARS.indexOf(c) < 0);
  check("数据里的汉字全都在繁简/拼音表里", missing.length === 0,
    missing.length ? "缺：" + missing.join("") : Array.from(allCjk).length + " 个字");
  const badInitial = Array.from(allCjk).filter((c) => !/^[a-z]$/.test(D.initialsOf(c)));
  check("每个字都有拼音首字母", badInitial.length === 0, badInitial.join(""));
  const badSimplify = Array.from(allCjk).filter((c) => !/^[\u4e00-\u9fa5]$/.test(D.toSimplified(c)));
  check("每个字都能转出（至少是它自己）", badSimplify.length === 0, badSimplify.join(""));
  const initialChanged = Array.from(allCjk).filter((c) =>
    D.initialsOf(D.toSimplified(c)) !== D.initialsOf(c));
  check("简体写法算出来的首字母和繁体一致", initialChanged.length === 0, initialChanged.join(""));

  /* 用户自己加的宿舍：进 settings.addedDorms，跟默认数据分开 */
  const scratch = { addedDorms: [] };
  const added = D.add(scratch, "我的宿舍", { lat: 22.42, lng: 114.21, elevation: 50 });
  check("能用「当前位置」加一条宿舍", !!added && scratch.addedDorms.length === 1);
  check("加进来的也在列表里（带 custom 标记）",
    D.all(scratch).some((d) => d.id === added.id && d.custom === true));
  check("自己加的不写回默认数据文件",
    OP.DEFAULT_DORMS.dorms.every((d) => d.id !== added.id));
  check("可以删掉自己加的", D.remove(scratch, added.id) && D.all(scratch).length === list.length);
  check("默认那批删不掉（remove 只动 addedDorms）",
    D.remove(scratch, list[0].id) === false);

  /* ---------- 设置项必须登记在默认值里 ---------- */
  /* pickSettings 只保留 fallback 里有的键，默认值里漏了就等于存不住 */
  const settingsKeys = Object.keys(OP.Store.defaults().settings);
  /* dormFromClass 没了：回宿舍起点固定成"我的位置"，那个开关连同设置项一起删掉 */
  ["dormId", "addedDorms"].forEach((k) => {
    check("设置里有 " + k + "（不然存不住）", settingsKeys.indexOf(k) >= 0);
  });
  check("默认宿舍是空的，由用户自己选", OP.Store.defaults().settings.dormId === "");
  check("defaults.js 里写了这两个键，且不再有 dormFromClass",
    /dormId:/.test(defaults) && /addedDorms:/.test(defaults) &&
    !/dormFromClass:/.test(defaults));

  /* ---------- 页面 ---------- */
  check("页面加载了宿舍数据和模块",
    pageHtml.indexOf('src="data/dorms.js"') > 0 && pageHtml.indexOf('src="js/dorm.js"') > 0);
  check("路线页有「返回宿舍」卡片",
    pageHtml.indexOf("返回宿舍") > 0 && pageHtml.indexOf('id="dormPlan"') > 0 &&
    pageHtml.indexOf('id="dormSearch"') > 0 && pageHtml.indexOf('id="dormSuggest"') > 0);
  /* 这一条是踩过的坑：原生 <datalist> 只按字面值做包含匹配，
     不懂繁简也不懂拼音首字母——打「汤」的时候候选是「…湯若望宿舍」，
     原生下拉直接是空的，看起来像"搜不到"。所以候选必须自己渲染。 */
  check("候选列表不用原生 datalist（它不认繁简和首字母）",
    pageHtml.indexOf("<datalist") === -1 && pageHtml.indexOf("dormOptions") === -1 &&
    appCode.indexOf("dormOptions") === -1);
  check("候选列表跟着搜索逻辑走（繁简/首字母都认）",
    appCode.indexOf("function attachPicker(cfg)") > 0 &&
    appCode.indexOf("OP.Zh.matches(q, it.names)") > 0 &&
    appCode.indexOf("picker-item") > 0);
  check("边打字边出候选", /addEventListener\("input"[\s\S]{0,80}paint\(input\.value/.test(appCode));
  check("点候选用 pointerdown（用 click 会先失焦把列表收掉）",
    appCode.indexOf('addEventListener("pointerdown"') > 0 &&
    appCode.indexOf("chooseDorm(") > 0);
  check("一条都没匹配上时给的是提示，不是空白",
    appCode.indexOf("没有匹配的宿舍") > 0 && css.indexOf(".picker-note") > 0);
  check("候选列表有样式和滚动上限",
    /\.picker\s*\{[\s\S]{0,300}max-height/.test(css) &&
    /\.picker-item\s*\{[\s\S]{0,400}width:\s*100%/.test(css));
  /* 用户实际报的场景：打「汤」要能出汤若望宿舍 */
  check("打「汤」就能看到湯若望宿舍",
    D.search({}, "汤").some((d) => d.name === "Adam Schall Residence"));
  /* 新加的两间书院：中英文、简体繁体、拼音首字母都要能搜到 */
  check("晨興書院：繁体 / 简体 / 英文 / 首字母都能搜",
    ["晨興書院", "晨兴书院", "Morningside", "cxsy"]
      .every((q) => D.search({}, q).some((d) => d.name === "Morningside College")));
  check("伍宜孫書院：繁体 / 简体 / 英文 / 首字母都能搜",
    ["伍宜孫書院", "伍宜孙书院", "Wu Yee Sun", "wys"]
      .every((q) => D.search({}, q).some((d) => d.name === "Wu Yee Sun College")));
  check("两间书院的自动补全显示「英文 中文」",
    D.search({}, "晨兴")[0].label === "Morningside College 晨興書院" &&
    D.search({}, "伍宜孫")[0].label === "Wu Yee Sun College 伍宜孫書院");
  check("数据文件里那两行确实是生成脚本补进去的（不是手改的）",
    fs.readFileSync(path.join(root, "tools", "make-dorms.js"), "utf8")
      .indexOf("const MANUAL") > 0 &&
    fs.readFileSync(path.join(root, "data", "dorms.js"), "utf8")
      .indexOf("手工补录") > 0);
  /* 加宿舍的表单和入口按用户要求拆掉了（宿舍库已经够用，不需要现场补录）。
     底层的 OP.Dorm.add / remove 还在，上面那几条断言测的就是它——
     以后想恢复入口，把表单和按钮加回来就行，逻辑不用重写。 */
  check("加宿舍的表单和入口都拆掉了（也不再弹 prompt）",
    pageHtml.indexOf('id="dormForm"') === -1 && pageHtml.indexOf("用当前位置添加宿舍") === -1 &&
    appCode.indexOf("btnDormAddHere") === -1 && appCode.indexOf("window.prompt") === -1);

  /* ---------- 规划逻辑 ---------- */
  /* 起点按用户要求改成"我的位置"：先用定位，取不到才退回今天最后一节课的教室。
     顺序不能反过来——反了就成了"你以为从当前位置算，其实是按教室算的"。 */
  check("起点先是「我的位置」（定位优先）",
    /var pos = effectivePosition\(\);\s*\n\s*if \(pos\) return \{ point: pos, name: "我的位置"/.test(appCode));
  check("取不到定位才退回今天最后一节课的教室，并写明原因",
    /todayCourses\(data, now\)/.test(appCode) && /last\.buildingId/.test(appCode) &&
    appCode.indexOf("没取到定位，先按今天最后一节课的教室算") > 0);
  /* 认"声明"不认"注释里提到的词"——defaults.js 的注释里还写着"没有 dormFromClass
     这个开关了"，按整词匹配会误伤（这坑 README 里记过一次） */
  check("那个开关和它的设置项都删掉了（不该再有 dormFromClass）",
    appCode.indexOf("dormFromClass") === -1 && !/dormFromClass\s*:/.test(defaults));
  check("回宿舍也走同一个校巴规划",
    /OP\.Shuttle\.plan\(start\.point/.test(appCode) &&
    appCode.indexOf('busHtml(busPlan, "宿舍")') > 0);
  check("校巴那块 HTML 教室和宿舍共用一份",
    appCode.indexOf("function busHtml(plan, destLabel)") > 0 &&
    appCode.indexOf('return busHtml(leg.busPlan, "教室")') > 0);
  check("宿舍的高差也算（缺海拔会自动补查一次）",
    appCode.indexOf("ensureDormElevation") > 0 &&
    appCode.indexOf("OP.Elevation.at(dorm.lat, dorm.lng)") > 0);
  check("回宿舍大多是下坡，所以单独显示下降且注明不折算",
    appCode.indexOf("下降 <b>") > 0 && css.indexOf(".plan-note") > 0);
  check("输入框里的名字能兜到最像的那条宿舍",
    appCode.indexOf("function resolveDorm") > 0 &&
    appCode.indexOf("bestNameMatch(q, list, 0.45)") > 0);
  check("名字比对前先统一成「小写 + 简体」",
    /var low = OP\.Dorm\.normalize\(q\)/.test(appCode) &&
    /OP\.Dorm\.names\(d\)\.map\(function \(n\) \{ return OP\.Dorm\.normalize\(n\); \}\)/.test(appCode));
  check("找不到时提示里写明了支持简体/首字母",
    appCode.indexOf("简体繁体、中文首字母") > 0);
  check("输入框的提示给了简体和首字母的例子",
    pageHtml.indexOf("汤 / 知行楼 / zxl") > 0);
  /* 双名要真的显示出来，不能只存数据 */
  check("自动补全用的是「英文 中文」",
    appCode.indexOf("label: d.label") > 0 &&
    appCode.indexOf("search.value = dorm ? dorm.label") > 0);
  check("路线卡片标题也是双名", appCode.indexOf('" → " + dorm.label') > 0);
  check("匹配时把中文名也算进去",
    appCode.indexOf("OP.Dorm.names(d)") > 0);
  check("地图跳转链接也用双名（中文地图才认得出）",
    appCode.indexOf("Geo.navLinks(dorm.label, dorm.lat, dorm.lng)") > 0);
}

console.log("\n[42] 地图上多一截「坐车」的连线");
{
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const mapCode = fs.readFileSync(path.join(root, "js", "map.js"), "utf8");
  const realMapCode = fs.readFileSync(path.join(root, "js", "realmaps.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

  check("上车站 → 下车站 这一截也进了连线列表",
    appCode.indexOf("busLinks.push({") > 0 &&
    /from: best\.board\.stop,[\s\S]{0,80}to: best\.alight\.stop,[\s\S]{0,80}ride: true/.test(appCode));
  check("原来的两截没被改掉",
    appCode.indexOf("out.busLinks.push({ from: fromPoint, to: best.board.stop })") > 0 &&
    appCode.indexOf("out.busLinks.push({ from: best.alight.stop, to: toPoint })") > 0);
  check("简图给坐车那一截加了区分用的 class",
    mapCode.indexOf('(link.ride ? " is-ride" : "")') > 0);
  check("真实地图换成另一种颜色和粗细",
    /color: ride \? "#a06bff" : "#ff6fa5"/.test(realMapCode) &&
    /weight: ride \? 5 : 3/.test(realMapCode));
  check("样式里有 .bus-link.is-ride",
    /\.bus-link\.is-ride\s*\{[\s\S]{0,220}stroke:\s*var\(--accent-2\)/.test(css));
  check("虚线动画接得上（周期能整除 -18 的偏移）",
    /\.bus-link\.is-ride\s*\{[\s\S]{0,240}stroke-dasharray:\s*3 6/.test(css));
  check("图例说明了两种线",
    pageHtml.indexOf("走这一段") > 0 && pageHtml.indexOf("坐车这一段") > 0 &&
    css.indexOf(".line-ride") > 0);

  /* 真画一遍：两条走路 + 一条坐车，应该只有一条带 is-ride */
  const svg = { innerHTML: "" };
  OP.MapView.render(svg, {
    buildings: [{ id: "A", name: "甲楼", lat: 22.42, lng: 114.20 }],
    position: { lat: 22.43, lng: 114.21 },
    stops: [{ building: { id: "A", name: "甲楼", lat: 22.42, lng: 114.20 }, order: 1, time: "10:00", isNext: true }],
    busLinks: [
      { from: { lat: 22.43, lng: 114.21 }, to: { lat: 22.425, lng: 114.205 } },
      { from: { lat: 22.425, lng: 114.205 }, to: { lat: 22.422, lng: 114.202 }, ride: true },
      { from: { lat: 22.422, lng: 114.202 }, to: { lat: 22.42, lng: 114.20 } }
    ]
  });
  check("三条线都画出来了",
    (svg.innerHTML.match(/class="bus-link/g) || []).length === 3);
  check("其中只有中间那条是「坐车」",
    (svg.innerHTML.match(/class="bus-link is-ride"/g) || []).length === 1);
}

console.log("\n[43] 提示条的配色与对比度（播报之后弹出来的那条）");
{
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

  /* 把 :root 里的变量和各个规则块抠出来，按真实的取值去算对比度 */
  const rootVars = {};
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  (rootBlock ? rootBlock[1] : "").replace(/--([\w-]+):\s*([^;]+);/g, (m, k, v) => {
    rootVars[k] = v.trim();
    return "";
  });

  function blockOf(selector) {
    const pattern = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([\\s\\S]*?)\\}");
    const m = pattern.exec(css);
    return m ? m[1] : "";
  }
  function declOf(block, prop) {
    const m = new RegExp("(?:^|[;{\\s])" + prop + ":\\s*([^;]+);").exec(block);
    return m ? m[1].trim() : "";
  }
  function resolveVar(value) {
    const m = /var\(\s*--([\w-]+)\s*\)/.exec(value);
    return m ? (rootVars[m[1]] || "") : value;
  }
  function toRgb(text) {
    const src = String(text).trim();
    const hex = /^#([0-9a-f]{6})$/i.exec(src);
    if (hex) {
      const n = parseInt(hex[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
    }
    const rgba = /^rgba?\(([^)]+)\)$/i.exec(src);
    if (rgba) {
      const parts = rgba[1].split(",").map((s) => Number(s.trim()));
      return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
    }
    return null;
  }
  function lin(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  function luminance(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
  /* 半透明的底色按"压在什么上面"折算成实色。
     提示条底下是页面（视频 + 粉纱 + 卡片），最坏情况是压在最暗的地方，
     所以统一按压在纯黑上算——这样算出来过关就一定过关。 */
  function flatten(rgba, under) {
    const a = rgba.length > 3 ? rgba[3] : 1;
    return [0, 1, 2].map((i) => rgba[i] * a + under[i] * (1 - a));
  }
  function ratio(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  const BLACK = [0, 0, 0];
  const fmt = (n) => n.toFixed(2) + ":1";

  const toastBlock = blockOf(".toast");
  check("提示条的底色是浅的（不再是旧暗色主题的深蓝）",
    css.indexOf("rgba(20, 30, 52") === -1 &&
    /background:\s*var\(--surface-3\)/.test(toastBlock));

  const bg = toRgb(resolveVar(declOf(toastBlock, "background")));
  const body = toRgb(resolveVar(declOf(toastBlock, "color")));
  check("提示条自己指定了正文颜色（不靠继承）", !!body);
  const bgFlat = flatten(bg, BLACK);
  const bodyRatio = ratio(bgFlat, body);
  check("正文对比度 ≥ 7:1（正常文字要求 4.5:1）", bodyRatio >= 7, fmt(bodyRatio));

  function varOf(name) { return rootVars[name.replace("--", "")] || ""; }
  /* 四种语气的标题色，逐一算 */
  const inks = {
    accent: varOf("--accent-ink"),
    ok: varOf("--ok-ink"),
    warn: varOf("--warn-ink"),
    err: varOf("--err-ink")
  };
  Object.keys(inks).forEach((tone) => {
    const ink = toRgb(inks[tone]);
    const r = ink ? ratio(bgFlat, ink) : 0;
    check("标题色 " + tone + " 对比度 ≥ 4.5:1", r >= 4.5, fmt(r));
  });

  /* 语气色本身（--accent / --ok / --warn）不能直接当文字用——
     记一笔实测值，顺便保证 .toast strong 用的不是它们 */
  const accent = toRgb(rootVars.accent);
  check("点缀色 --accent 直接当文字是**不够**的（记录实测值，所以标题另有加深色）",
    ratio(bgFlat, accent) < 4.5, fmt(ratio(bgFlat, accent)));
  check("标题用的是加深色，不是点缀色",
    /\.toast strong\s*\{[^}]*var\(--accent-ink\)/.test(css) &&
    /\.toast\.is-ok strong\s*\{[^}]*var\(--ok-ink\)/.test(css) &&
    /\.toast\.is-warn strong\s*\{[^}]*var\(--warn-ink\)/.test(css) &&
    /\.toast\.is-err strong\s*\{[^}]*var\(--err-ink\)/.test(css));

  /* 语气不再靠"左边那条 4px 竖条"区分（单边粗竖条是典型的 AI 卡片签名，
     审计里被判 critical），改成"标题色 + 标题前一个小圆点"，一圈发丝线。 */
  check("提示条没有单边竖条了（那条被判过 critical）",
    css.indexOf("border-left: 4px solid") === -1 &&
    !/\.toast\s*\{[\s\S]{0,400}border-left:/.test(css));
  check("语气改用标题色 + 小圆点，底色依旧统一",
    /\.toast\.is-ok strong\s*\{\s*color:\s*var\(--ok-ink\)/.test(css) &&
    /\.toast\.is-warn strong\s*\{\s*color:\s*var\(--warn-ink\)/.test(css) &&
    /\.toast\.is-err strong\s*\{\s*color:\s*var\(--err-ink\)/.test(css) &&
    /\.toast strong::before\s*\{[\s\S]{0,200}background:\s*currentColor/.test(css) &&
    css.indexOf(".toast.is-ok { background") === -1);
  check("提示条是一圈发丝线 + 主题圆角",
    /\.toast\s*\{[\s\S]{0,600}border:\s*1px solid var\(--line\)/.test(css) &&
    /\.toast\s*\{[\s\S]{0,600}border-radius:\s*var\(--radius\)/.test(css));
  check("阴影也换成粉色系（原来是一坨纯黑）",
    /\.toast\s*\{[\s\S]{0,600}box-shadow:[^;]*var\(--accent-line\)/.test(css));

  /* 最后确认一下：播报确实是走这条提示条 */
  check("播报之后弹的就是这条提示条",
    /function say\(text, label\)[\s\S]{0,300}toast\(label, text, "ok"\)/.test(appCode));
}

console.log("\n[44] 自定义路线 / 去掉两个选项");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const defaults = fs.readFileSync(path.join(root, "data", "defaults.js"), "utf8");

  /* ---------- 课表导入：去掉了「课表里有中文」开关 ---------- */
  check("课表导入卡片里没有「课表里有中文」这个选项",
    pageHtml.indexOf("ocrChinese") === -1 && pageHtml.indexOf("课表里有中文") === -1 &&
    appCode.indexOf("ocrChinese") === -1);
  check("识别固定用英文（不再看那个开关）",
    /lang:\s*"eng",/.test(appCode) && appCode.indexOf("chi_sim") >= 0);
  /* 「适用周次」整套按用户要求删掉了（周次功能取消），只剩「导入前清空」 */
  check("导入卡片只剩「导入前清空」，适用周次已经拆掉",
    pageHtml.indexOf('id="ocrReplace"') > 0 &&
    pageHtml.indexOf("适用周次") === -1 && pageHtml.indexOf('id="ocrWeekFrom"') === -1 &&
    pageHtml.indexOf('id="cfWeeksFrom"') === -1);

  /* ---------- 定位：去掉了「用当前位置当模拟点 / 清除模拟」 ---------- */
  check("设置里没有那两个模拟位置按钮",
    pageHtml.indexOf("btnSimHere") === -1 && pageHtml.indexOf("btnClearSim") === -1 &&
    pageHtml.indexOf("模拟点") === -1 &&
    appCode.indexOf("btnSimHere") === -1 && appCode.indexOf("btnClearSim") === -1);
  check("定位卡片还剩「开始实时定位」和「停止」",
    pageHtml.indexOf('id="btnLocate"') > 0 && pageHtml.indexOf('id="btnStopLocate"') > 0);
  /* 老的存档里可能还留着 simulate，读的时候不能报错（只是没有界面去改它了） */
  check("老的 simulate 存档仍然能读（不至于打不开）",
    /var sim = data\.settings\.simulate;/.test(appCode) &&
    appCode.indexOf("simulated: true") > 0);

  /* ---------- 自定义路线 ---------- */
  check("路线页有「自定义路线」卡片，起点 / 终点两个输入框 + 对调按钮",
    pageHtml.indexOf("自定义路线") > 0 && pageHtml.indexOf('id="customFromSearch"') > 0 &&
    pageHtml.indexOf('id="customToSearch"') > 0 && pageHtml.indexOf('id="btnCustomSwap"') > 0 &&
    pageHtml.indexOf('id="customPlan"') > 0);
  /* 起点终点要能搜，而且跟其它搜索一样认简繁和拼音首字母 */
  check("起点 / 终点挂了可搜索的候选列表",
    /input: "#customFromSearch",\s*\n\s*list: "#customFromList"/.test(appCode) &&
    /input: "#customToSearch",\s*\n\s*list: "#customToList"/.test(appCode) &&
    pageHtml.indexOf('id="customFromList"') > 0 && pageHtml.indexOf('id="customToList"') > 0);
  check("起点候选里带「我的位置」",
    /id: "",\s*\n\s*label: "我的位置"/.test(appCode) &&
    /buildingPickerItems\(true\)/.test(appCode));
  check("两个输入框回车/失焦也会兜一次名字解析",
    /pickBuildingByName\("#customFromSearch", "customFrom", true\)/.test(appCode) &&
    /pickBuildingByName\("#customToSearch", "customTo", false\)/.test(appCode));
  check("选完就自动算（不用再点一次）",
    /onPick: function \(item\) \{\s*\n\s*data\.settings\.customFrom = item\.id;[\s\S]{0,120}saveAndRender\(\)/.test(appCode) &&
    /onPick: function \(item\) \{\s*\n\s*data\.settings\.customTo = item\.id;[\s\S]{0,120}saveAndRender\(\)/.test(appCode));
  check("用的是同一套规划：走多久 + 校巴方案",
    /OP\.Shuttle\.plan\(fromPoint, toPoint, state\.now/.test(appCode) &&
    /var metrics = P\.walkMetrics\(fromPoint, toPoint, s\)/.test(appCode) &&
    appCode.indexOf('busHtml(busPlan, "终点")') > 0);
  check("起点终点同一条路会提示，不会算出一段两边一样的路",
    appCode.indexOf("起点和终点是同一栋楼") > 0);
  check("起点选了「我的位置」但没定位时有说明",
    appCode.indexOf("但还没定位") > 0);
  check("路线页渲染时会一起算自定义路线",
    /renderRoute\(\); renderDorm\(\); renderCustom\(\);/.test(appCode));
  check("两个选项记在设置里（切走再回来还在）",
    /customFrom:/.test(defaults) && /customTo:/.test(defaults) &&
    Object.keys(OP.Store.defaults().settings).indexOf("customFrom") >= 0 &&
    Object.keys(OP.Store.defaults().settings).indexOf("customTo") >= 0);
  check("自定义路线有样式",
    css.indexOf(".custom-plan") > 0 && css.indexOf(".custom-leg .idx") > 0);
  check("起点终点可以一键对调",
    /btnCustomSwap"\)\.addEventListener/.test(appCode) &&
    /data\.settings\.customFrom = data\.settings\.customTo;/.test(appCode));

  /* 顺带修掉的：复制坐标以前只绑在行程列表上，返回宿舍 / 自定义路线里点了没反应 */
  check("「复制坐标」改成全局委托（三个卡片都能用）",
    /document\.addEventListener\("click", function \(ev\) \{[\s\S]{0,180}data-copy/.test(appCode) &&
    appCode.indexOf('$("#routeList").addEventListener("click"') === -1);

  /* 真的算一段：从一栋楼到另一栋楼，自定义路线要有校巴方案可选 */
  const custom = OP.Shuttle.plan(
    { lat: 22.418387, lng: 114.205283, elevation: 99 },
    { lat: 22.422832, lng: 114.213701, elevation: 7 },
    new Date(2026, 8, 30, 10, 0, 0), 20,
    OP.Store.defaults().settings);
  check("任选两栋楼之间也能算出校巴方案",
    custom.groups.length > 0,
    custom.groups.map((g) => g.route.no).join(" "));
}

console.log("\n[45] 搜索规则：中英文 / 简体繁体 / 拼音首字母（楼栋、宿舍共用）");
{
  const Z = OP.Zh;
  const P2 = OP.Planner;
  const B = OP.DEFAULT_BUILDINGS.buildings;
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const zhSource = fs.readFileSync(path.join(root, "js", "zh.js"), "utf8");

  check("有共用的繁简/拼音模块，页面也加载了",
    !!Z && !!Z.matches && !!Z.toSimplified && !!Z.initialsOf && !!Z.normalize &&
    pageHtml.indexOf('src="js/zh.js"') > 0);
  check("表是脚本生成的，不是手写的",
    fs.existsSync(path.join(root, "tools", "make-zh.js")) &&
    zhSource.indexOf("node tools/make-zh.js") > 0);
  check("宿舍模块转用同一张表（不是各存一份）",
    OP.Dorm.ZH_CHARS.length === Z.CHARS.length &&
    OP.Dorm.initialsOf("知行樓") === Z.initialsOf("知行樓"));

  /* 三个数据文件里的汉字，一个都不能漏 */
  const chars = new Set();
  ["data/buildings.js", "data/dorms.js", "data/shuttle.js"].forEach((rel) => {
    fs.readFileSync(path.join(root, rel), "utf8")
      .replace(/[\u4e00-\u9fa5]/g, (c) => { chars.add(c); return ""; });
  });
  const missing = Array.from(chars).filter((c) => Z.CHARS.indexOf(c) < 0);
  check("楼栋/宿舍/校巴数据里的汉字全在表里（共 " + chars.size + " 个）",
    missing.length === 0, missing.length ? "缺：" + missing.join("") : "一个都不缺");
  const badInitial = Array.from(chars).filter((c) => !/^[a-z]$/.test(Z.initialsOf(c)));
  check("每个字都查得到拼音首字母", badInitial.length === 0, badInitial.join(""));
  const badSimple = Array.from(chars).filter((c) => !/^[\u4e00-\u9fa5]$/.test(Z.toSimplified(c)));
  check("每个字都转得出简体（至少是它自己）", badSimple.length === 0, badSimple.join(""));

  /* 楼栋搜索：四种写法都要能搜到同一栋 */
  const find = (q) => P2.filterBuildings(B, q, false).map((b) => b.name);
  check("搜楼栋：简体 / 繁体 / 拼音首字母 / 英文都能中",
    find("教研楼").indexOf("Academic Building No.1") >= 0 &&
    find("教研樓").indexOf("Academic Building No.1") >= 0 &&
    find("jylyz").indexOf("Academic Building No.1") >= 0 &&
    find("Academic Building No.1").indexOf("Academic Building No.1") >= 0,
    ["教研楼", "教研樓", "jylyz", "Academic"].map((q) => q + ":" + find(q).length).join("  "));
  check("搜楼栋：蒙民偉樓 三种写法都能中",
    find("蒙民伟楼").indexOf("Mong Man Wai Building") >= 0 &&
    find("蒙民偉樓").indexOf("Mong Man Wai Building") >= 0 &&
    find("mmwl").indexOf("Mong Man Wai Building") >= 0);
  check("搜楼栋：搜不到的关键词返回空", find("zzzzzz").length === 0);

  /* 首字母是"从头比"，不是"包含"：包含会把不相干的楼也带出来 */
  check("首字母是从头匹配（syt 不该带出牟路思怡圖書館）",
    find("syt").indexOf("Elisabeth Luce Moore Library") === -1 &&
    Z.initialsOf("牟路思怡圖書館").indexOf("syt") > 0,
    "牟路思怡圖書館 的首字母是 " + Z.initialsOf("牟路思怡圖書館"));
  check("别名也能按首字母搜（五旬節會樓高座的别名「五高」→ wg）",
    OP.Dorm.search({}, "wg").some((d) => d.name === "Pentecostal Mission Hall Complex (High Block)"));
}

console.log("\n[46] 路线页三张卡片轮流显示 / 设置卡片默认藏起来");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

  /* ---------- 三张卡片做成滑动切换 ---------- */
  check("三张卡片各自包在 .route-slide 里，带 data-slide",
    ["plan", "dorm", "custom"].every((k) =>
      new RegExp('<section class="route-slide" data-slide="' + k + '">').test(pageHtml)));
  check("有切换条，三个按钮",
    pageHtml.indexOf('id="routeNav"') > 0 &&
    /<div class="route-nav" id="routeNav">[\s\S]{0,400}?<\/div>/.test(pageHtml) &&
    ((/<div class="route-nav" id="routeNav">[\s\S]{0,400}?<\/div>/.exec(pageHtml) || [""])[0]
      .match(/class="route-tab[^"]*" data-slide=/g) || []).length === 3);
  check("滑动靠 scroll-snap（不自己写手势代码）",
    /\.route-slides\s*\{[\s\S]{0,400}scroll-snap-type:\s*x mandatory/.test(css) &&
    /\.route-slide\s*\{[\s\S]{0,300}scroll-snap-align:\s*start/.test(css) &&
    /\.route-slide\s*\{[\s\S]{0,300}flex:\s*0 0 100%/.test(css));
  check("一次只显示一张：容器横向滚动、滑动条藏起来",
    /\.route-slides\s*\{[\s\S]{0,400}overflow-x:\s*auto/.test(css) &&
    /\.route-slides::-webkit-scrollbar\s*\{\s*display:\s*none/.test(css));
  check("手指划完会把「现在看哪张」算出来（按停在哪一页）",
    appCode.indexOf('var SLIDES = ["plan", "dorm", "custom"]') > 0 &&
    /addEventListener\("scroll"[\s\S]{0,600}Math\.round\(scroller\.scrollLeft \/ width\)/.test(appCode));
  check("点切换条也会滑过去（两组卡片共用同一套 makeSlides）",
    /function makeSlides\(config\)/.test(appCode) &&
    /querySelectorAll\("\.route-tab"\)/.test(appCode) &&
    /btn\.addEventListener\("click", function \(\) \{ go\(btn\.getAttribute\("data-slide"\)\); \}\)/.test(appCode));
  check("切换条只在**自己这一组**里找（两组同时存在时不会互相抹掉选中态）",
    appCode.indexOf('nav.querySelectorAll(".route-tab")') > 0 &&
    /* 认"调用"不认注释里提到的词：注释里那句话本身也含这个写法 */
    !/\$\$\("\.route-tab"\)\.forEach/.test(appCode));

  /* 课表页那两张卡：拉取课表 / 截图导入，默认停在拉取 */
  check("课表页两张卡也是滑动组，默认显示「拉取课表」",
    /<div class="route-nav" id="importNav">/.test(pageHtml) &&
    /<button type="button" class="route-tab is-active" data-slide="pull">/.test(pageHtml) &&
    /<section class="route-slide" data-slide="pull">/.test(pageHtml) &&
    /<section class="route-slide" data-slide="ocr">/.test(pageHtml) &&
    /slides: \["pull", "ocr"\][\s\S]{0,80}initial: "pull"/.test(appCode));
  check("「全部课程」那张卡留在滑动组外面（在上面）",
    pageHtml.indexOf('id="courseList"') > 0 &&
    pageHtml.indexOf('id="courseList"') < pageHtml.indexOf('id="importNav"'));

  /* ---------- 地图跟着当前卡片走 ---------- */
  check("地图数据按当前卡片取（三种各一份）",
    /function slideMapData\(kind\)[\s\S]{0,300}kind === "dorm"[\s\S]{0,120}kind === "custom"/.test(appCode) &&
    appCode.indexOf("function dormMapData()") > 0 &&
    appCode.indexOf("function customMapData()") > 0);
  check("地图不再是「永远画今日课表」",
    /function renderRouteMap\(\)\s*\{\s*var d = slideMapData\(routeSlide\)/.test(appCode));
  check("起终点用「起」「终」标出来（不是序号）",
    /markOf\(target, dorm\.label, "终"\)/.test(appCode) &&
    /markOf\(target, to\.name, "终"\)/.test(appCode) &&
    appCode.indexOf('markOf(start.point, start.name, "起")') > 0);
  check("起点就是「我的位置」时，画那个点而不是再叠一个圈",
    /position: start\.fromClass \? null : start\.point/.test(appCode) &&
    /position: fromIsBuilding \? null : fromPoint/.test(appCode));
  check("车站和连线也跟着这张卡片走",
    /function collectBus\(plan, fromPoint, toPoint, into\)/.test(appCode) &&
    appCode.indexOf("collectBus(plan, start.point, target)") > 0 &&
    appCode.indexOf("collectBus(plan, fromPoint, target)") > 0);
  /* 简图没东西可画时，说法由调用方给（不同卡片不一样） */
  check("简图空状态的说法由调用方给",
    fs.readFileSync(path.join(root, "js", "map.js"), "utf8")
      .indexOf('esc(opts.empty || "今天没有要去的地方")') > 0);

  /* ---------- 设置里两张卡片默认藏起来，但代码都在 ---------- */
  check("两张卡片默认 hidden，并且有 id 方便重新打开",
    /<article class="card" id="placesCard" hidden>/.test(pageHtml) &&
    /<article class="card" id="buildingsCard" hidden>/.test(pageHtml));
  check("有一个调试开关可以把它们放出来",
    /var SHOW_BUILDING_TOOLS = false;/.test(appCode) &&
    /if \(SHOW_BUILDING_TOOLS\)[\s\S]{0,200}placesCard[\s\S]{0,80}buildingsCard/.test(appCode));
  check("卡片里的东西一个都没删（元素都还在）",
    ["plNameQuery", "btnSearchByName", "btnSearchPlaces", "placesList",
      "buildingSearch", "buildingList", "btnAddBuilding", "btnFetchElevation",
      "btnClearBuildings", "buildingForm"].every((id) => pageHtml.indexOf('id="' + id + '"') > 0));
  check("隐藏之后相关渲染仍然不会报错（DOM 还在，只是看不见）",
    appCode.indexOf("renderPlaces()") > 0 && appCode.indexOf("renderBuildingList(list)") > 0);
}

console.log("\n[47] Hallmark 第二轮：6 major + 6 minor");
{
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");

  /* ---------- major #5：所有色值 / 圆角都走 token ---------- */
  const rootEnd = css.indexOf("}", css.indexOf(":root {"));
  const rulesOnly = css.slice(rootEnd);        /* :root 之外 = 规则层 */
  const literals = (rulesOnly.match(/(rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/g) || [])
    /* 圆角 50% / 0 这类不是颜色，颜色只可能是 # 或 rgba() */
    .filter((v) => v[0] === "#");
  check("规则层里没有内联色值（全走 token）",
    literals.length === 0, literals.slice(0, 6).join(" "));

  const defined = new Set((css.slice(0, rootEnd).match(/--[a-z0-9-]+(?=\s*:)/g) || []));
  const used = new Set((rulesOnly.match(/var\(--[a-z0-9-]+/g) || []).map((v) => v.replace("var(", "")));
  const undefinedTokens = Array.from(used).filter((u) => !defined.has(u));
  check("用到的 token 都定义了（写错名字会变成 var 失效）",
    undefinedTokens.length === 0, undefinedTokens.join(" "));

  const radii = Array.from(new Set((rulesOnly.match(/border-radius:\s*([^;]+);/g) || [])
    .map((r) => r.replace(/border-radius:\s*|;/g, "").trim())));
  check("圆角只剩四档（小控件 / 按钮输入 / 卡片 / 全圆 / 正圆）",
    radii.every((r) => ["var(--radius-xs)", "var(--radius-sm)", "var(--radius)",
      "var(--radius-pill)", "50%", "0", "inherit"].indexOf(r) >= 0),
    radii.join(" | "));

  /* ---------- accent-ink 契约：强调色底上必须指明字色 ---------- */
  check("定义了强调色底上的文字色（技能要求的 accent-ink 契约）",
    /--on-accent:\s*#4a0f2b/.test(css));
  const accentFills = [".btn-primary", ".route-tab.is-active", ".brand-mark", ".bus-tag",
    ".rm-pin.is-next", ".toast-action"];
  check("强调色填充的控件都配了 --on-accent，不再写死白字/黑字",
    accentFills.every((sel) => {
      const block = new RegExp("\\" + sel.slice(1) + "[^{]*\\{([^}]*)\\}").exec(css);
      return !block || block[1].indexOf("background: var(--accent)") < 0 ||
        block[1].indexOf("var(--on-accent)") >= 0;
    }));
  check("按钮不再用渐变、也不再叠彩色光晕（AI 味的两个来源）",
    css.indexOf("linear-gradient(135deg, var(--accent)") === -1 &&
    !/\.btn-primary\s*\{[\s\S]{0,300}box-shadow/.test(css));

  /* ---------- major #6：毛玻璃只留浮层 ---------- */
  const blurs = (rulesOnly.match(/backdrop-filter:\s*blur/g) || []).length;
  const blurLayers = (rulesOnly.match(/(?<!-webkit-)backdrop-filter:\s*blur/g) || []).length;
  /* 卡片底是真在动的视频：完全不糊可读性会掉，所以留 8px 轻糊；
     厚玻璃（14–22px）留给真正浮在内容之上的层——层级靠"糊的程度"区分。 */
  const cardBlur = Number(/\.card\s*\{[\s\S]{0,500}?backdrop-filter:\s*blur\((\d+)px\)/.exec(css)[1]);
  const overlayBlur = Number(/\.toast\s*\{[\s\S]{0,900}?backdrop-filter:\s*blur\((\d+)px\)/.exec(css)[1]);
  check("卡片只留轻糊，" + blurLayers + " 层浮层用厚玻璃（层级分得开）",
    blurLayers <= 6 && cardBlur > 0 && cardBlur < overlayBlur,
    blurs + " 条声明 / " + blurLayers + " 层");

  /* ---------- major #9 + 交互状态：焦点环 ---------- */
  check("有全局 :focus-visible 环（键盘用户能看到焦点在哪）",
    /:focus-visible\s*\{[\s\S]{0,160}outline:\s*2px solid var\(--focus\)/.test(css));
  check("输入框预留了焦点环的位置（聚焦不跳版）",
    /\.field input\[type="text"\][\s\S]{0,500}outline:\s*2px solid transparent/.test(css) &&
    /\.field input:focus-visible[\s\S]{0,80}outline-color:\s*var\(--focus\)/.test(css));
  check("不再有裸的 outline: none（除非同处给了替代）",
    (rulesOnly.replace(/\/\*[\s\S]*?\*\//g, "").match(/outline:\s*none/g) || []).length === 0);

  /* ---------- major #7 / #8：提示条纪律 + 撤销优先于确认 ---------- */
  const okToasts = (appCode.match(/, "ok"\)/g) || []).length;
  check("成功提示条砍掉一批（结果看得见的就别弹）", okToasts <= 11, okToasts + " 条");
  check("提示条支持挂一个操作按钮（撤销用）",
    /function toast\(title, body, kind, action\)/.test(appCode) &&
    css.indexOf(".toast-action") > 0 &&
    /pointer-events:\s*auto/.test(css));
  check("可撤销的三处改成「直接做 + 撤销提示条」",
    (appCode.match(/label:\s*"撤销"/g) || []).length >= 3 &&
    appCode.indexOf('toast("已删除宿舍"') > 0 &&
    appCode.indexOf('toast("已删除课程"') > 0 &&
    appCode.indexOf('toast("已恢复默认配置"') > 0);
  check("确认框只剩真正不可逆的几处（清空 / 恢复 / 覆盖课表）",
    /askConfirm\("课表和楼栋都会变回默认/.test(appCode) &&
    /askConfirm\("会用识别结果覆盖现在的全部课程/.test(appCode) &&
    appCode.indexOf("确定删除「") === -1);
  check("确认框能用 Esc 关，且焦点进去又还回来",
    /ev\.key === "Escape"[\s\S]{0,120}closeConfirm\(\)/.test(appCode) &&
    /confirmReturnFocus = document\.activeElement/.test(appCode) &&
    /confirmReturnFocus\.focus\(\)/.test(appCode));

  /* ---------- minor #10~#15 ---------- */
  check("留白分了两档（主卡更松、密集卡片更紧）",
    /(?:^|\n)\.hero\s*\{[\s\S]{0,200}?padding:\s*var\(--space-xl\)/.test(css) &&
    /(?:^|\n)\.card\s*\{[\s\S]{0,600}?padding:\s*var\(--space-lg\)/.test(css) &&
    /\.route-slide \.card\s*\{\s*padding:\s*var\(--space-md\)/.test(css));
  check("按钮文字不折行、触摸目标 ≥44px",
    /white-space:\s*nowrap/.test(/(?:^|\n)\.btn\s*\{[\s\S]{0,700}?\n\}/.exec(css)[0]) &&
    /(?:^|\n)\.btn\s*\{[\s\S]{0,700}?min-height:\s*44px/.test(css));
  check("按压不再做缩放，改成下沉 1px（技能：按压=更暗 + 位移）",
    /\.btn:active\s*\{\s*transform:\s*translateY\(1px\)/.test(css) &&
    css.indexOf("scale(0.97)") === -1);
  check("缓动走具名 token（不再是浏览器默认的 ease）",
    /--ease-out:\s*cubic-bezier/.test(css) &&
    !/[0-9.]+s\s+ease\b/.test(rulesOnly.replace(/\/\*[\s\S]*?\*\//g, "")));
  check("动画只动 transform / opacity（进度条与脉冲都改过）",
    /\.progress-bar\s*\{[\s\S]{0,300}transform:\s*scaleX/.test(css) &&
    /@keyframes pulse\s*\{[\s\S]{0,220}transform:\s*scale/.test(css) &&
    /\.progress-bar\s*\{[\s\S]{0,300}transition:\s*transform/.test(css));
  check("悬停效果都收进 @media (hover: hover)（触屏不会卡住悬停态）",
    /@media \(hover: hover\)\s*\{[\s\S]{0,400}\.btn:hover/.test(css) &&
    !/(^|\n)\s*(?![^{]*@media)[^{}\n]*:hover[^{]*\{/.test(
      rulesOnly.replace(/@media \(hover: hover\)\s*\{[\s\S]*?\n\}/g, "")));
  check("成列数字补了 tabular-nums",
    /\.leg-meta\s*\{[\s\S]{0,160}font-variant-numeric:\s*tabular-nums/.test(css) &&
    /\.bus-breakdown\s*\{[\s\S]{0,160}font-variant-numeric:\s*tabular-nums/.test(css));
  check("表面不再用纯白（往锚点色相偏了一点）",
    !/--card:\s*rgba\(255,\s*255,\s*255/.test(css));

  /* ---------- major #16：主卡改成不对称两栏 ---------- */
  check("主卡上半部分是不对称两栏（宽屏左信息右读数，窄屏叠起来）",
    pageHtml.indexOf('class="hero-top"') > 0 &&
    pageHtml.indexOf('class="hero-main"') > 0 &&
    pageHtml.indexOf('class="hero-readout"') > 0 &&
    /@media \(min-width: 560px\)\s*\{[\s\S]{0,240}\.hero-top\s*\{[\s\S]{0,200}grid-template-columns:\s*minmax\(0, 1fr\) auto/.test(css));
  check("倒计时还在同一个 id 上（脚本没被拆坏）",
    pageHtml.indexOf('id="nextCountdown"') > 0 &&
    appCode.indexOf('$("#nextCountdown").textContent') > 0);

  /* ---------- 发丝线在窄屏的换行错位（用户报的 bug） ----------
     原来读数行用 repeat(auto-fit, minmax(88px,1fr))：窄屏自动换成 2 列之后，
     "每格一条左竖线、只豁免第一格"的规则就错位了——换行后的行首那一格
     还带着一条游离的竖线，行与行之间也没有横线。实测（320/375/414）三档
     全都只排成 2 列，也就是全都错。 */
  check("读数行的列数是显式写死的（不再用 auto-fit 自动换列）",
    /\.hero-stats\s*\{[\s\S]{0,700}?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/.test(css) &&
    /\.hero-stats\[data-cells="4"\]\s*\{\s*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/.test(css) &&
    /* 认声明本身，不认注释里提到的词 */
    !/grid-template-columns:\s*repeat\(auto-fit/.test(css));
  check("格数（3 / 4）由脚本写进 data-cells",
    pageHtml.indexOf('data-cells="3"') > 0 &&
    /stats\.dataset\.cells = \$\("#nextClimbWrap"\)\.hidden \? "3" : "4"/.test(appCode));
  /* 窄屏两套排法按 data-cells 分开写：
     4 格 → 完整 2×2（竖线只在行内第二格、第 2 行起补横线）；
     3 格 → 第一行两格 + 最后那格横跨整行（否则右边空半格、横线只画一半）。 */
  check("窄屏 4 格：完整 2×2，竖线与横线按行来",
    /@media \(max-width: 620px\)[\s\S]{0,1400}?\.hero-stats\[data-cells="4"\] \.stat:nth-child\(even\)\s*\{[\s\S]{0,200}?border-left:\s*1px solid var\(--line\)/.test(css) &&
    /@media \(max-width: 620px\)[\s\S]{0,1400}?\.hero-stats\[data-cells="4"\] \.stat:nth-child\(n \+ 3\)\s*\{\s*border-top:\s*1px solid var\(--line\)/.test(css));
  check("窄屏 3 格：最后那格横跨整行（不然右边空半格）",
    /\.hero-stats\[data-cells="3"\] \.stat:last-child\s*\{[\s\S]{0,300}?grid-column:\s*1 \/ -1/.test(css));
  /* 「爬升」没有数据时是 hidden，但它仍是 DOM 里的兄弟节点，
     奇偶位会整体错开——所以两套排法绝不能靠 :nth-child(odd/even) 判断。 */
  /* 奇偶只在 data-cells="4" 那套里用（那时 4 格全可见，奇偶是准的）；
     绝不允许出现"没有 data-cells 限定的裸奇偶规则"。 */
  check("奇偶选择器必须被 data-cells 限定（hidden 的兄弟会让裸奇偶错位）",
    /\.hero-stats\[data-cells="4"\] \.stat:nth-child\(even\)/.test(css) &&
    !/(?:^|\n)\s*\.stat:nth-child\((?:odd|even)\)/.test(css) &&
    (css.match(/\.stat:nth-child\((?:odd|even)\)/g) || []).length <= 1);
  check("宽屏本来就不换行，所以不给第 4 格加多余横线",
    css.indexOf(".stat:nth-child(n + 4)") === -1);
  /* 真正让手机上"诡异"的其实是这条：老的窄屏规则里还留着
     `.hero-stats { 1fr 1fr }` + `.hero-stats .stat:last-child { grid-column: 1 / -1 }`，
     跟新的按 data-cells 的规则打架——4 格时最后一格也被拉成整行。
     现在跨列只允许两条，各管各的卡片，谁也不许写"无条件跨列"：
       ① .hero-stats[data-cells="3"] .stat:last-child  → 今日读数行
       ② .stats-lead-wide .stat:first-child           → 定位卡片读数行（见下面 [48]） */
  check("能让格子跨列的规则只有两条，各被 data-cells=3 / stats-lead-wide 限定",
    (css.match(/grid-column:\s*1\s*\/\s*-1/g) || []).length === 2 &&
    /\.hero-stats\[data-cells="3"\] \.stat:last-child\s*\{[\s\S]{0,300}?grid-column:\s*1 \/ -1/.test(css) &&
    /\.stats-lead-wide \.stat:first-child\s*\{[\s\S]{0,200}?grid-column:\s*1 \/ -1/.test(css) &&
    !/\.hero-stats \.stat:last-child\s*\{\s*grid-column/.test(css) &&
    !/@media \(max-width: 430px\)[\s\S]{0,300}?\.hero-stats/.test(css));
}

console.log("\n[48] 定位卡片：窄屏读数行拆成两行");
{
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

  /* 起因：定位卡片那三格（当前坐标 / 精度 / 最近楼栋）在手机上挤成一行，
     "22.41830, 114.20520" 这种长文本被硬折成好几行，格子和格子之间
     的发丝线看着又密又乱。改成两行排：坐标独占一行，下面两格并排。 */
  check("定位卡片挂上了 stats-lead-wide 标记",
    pageHtml.indexOf('class="hero-stats hero-stats-tight stats-lead-wide"') > 0);

  /* 这两条是"结构钉子"：定位卡片和今日读数行都用 .stat，
     谁都不许被另一条的规则带跑。定位卡片没有 data-cells（脚本只写给 #nextStats），
     所以 .hero-stats[data-cells="3"] 那套跨列规则不会误伤它。 */
  check("定位卡片不带 data-cells（今日读数行那套规则不会误伤它）",
    /class="hero-stats hero-stats-tight stats-lead-wide"/.test(pageHtml) &&
    /var stats = \$\("#nextStats"\);\s*\n\s*if \(stats\) stats\.dataset\.cells/.test(appCode));

  check("窄屏：定位卡片第一格（当前坐标）横跨整行",
    /@media \(max-width: 620px\)[\s\S]{0,2000}?\.stats-lead-wide \.stat:first-child\s*\{[\s\S]{0,200}?grid-column:\s*1 \/ -1/.test(css));
  check("窄屏：定位卡片第二格（精度）不画左竖线（它是行首，竖线会游离）",
    /\.stats-lead-wide \.stat:nth-child\(2\)\s*\{\s*border-left:\s*0/.test(css));
  check("窄屏：定位卡片第三格（最近楼栋）画左竖线",
    /\.stats-lead-wide \.stat:nth-child\(3\)\s*\{[\s\S]{0,140}?border-left:\s*1px solid var\(--line\)/.test(css));
  check("窄屏：定位卡片第二行起补横线",
    /\.stats-lead-wide \.stat:nth-child\(n \+ 2\)\s*\{\s*border-top:\s*1px solid var\(--line\)/.test(css));
  check("窄屏：定位卡片也是两列网格（跟今日读数行同一套列数写法）",
    /\.stats-lead-wide,\s*\n\s*\.stats-lead-wide\[data-cells="4"\]\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/.test(css));

  /* 宽屏必须保持原样：三格一整行。所以两行那套规则只能待在 620px 媒体查询里——
     把样式表里所有 @media 块抠掉之后，不应该再看到 stats-lead-wide。 */
  function stripMedia(src) {
    let out = "";
    let i = 0;
    while (i < src.length) {
      const at = src.indexOf("@media", i);
      if (at === -1) { out += src.slice(i); break; }
      out += src.slice(i, at);
      const open = src.indexOf("{", at);
      let depth = 0;
      let j = open;
      for (; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") { depth--; if (depth === 0) { j++; break; } }
      }
      i = j;
    }
    return out;
  }
  const outsideMedia = stripMedia(css.replace(/\/\*[\s\S]*?\*\//g, ""));
  check("宽屏不变：两行排法全在 @media 里（媒体查询外没有 stats-lead-wide）",
    outsideMedia.indexOf("stats-lead-wide") === -1 &&
    /\.hero-stats\s*\{[\s\S]{0,700}?grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/.test(css));

  /* ---------- 换行处不画左竖线（用户："第二行左侧不应出现发丝线"） ----------
     竖线是"行内两格之间"的分隔符。只要某格落在了新一行的行首（x 贴容器左边缘），
     它就不能再有左竖线——否则那条线孤零零地浮在卡片左边缘，就是"鬼线"。
     窄屏两列排布下，行首一共只有这么几种可能： */
  const rowLeaders = [
    /* 3 格：第一行 距离｜步行，第二行「建议出发」独占整行 */
    ['\\.hero-stats\\[data-cells="3"\\] \\.stat:last-child', "3 格第二行"],
    /* 4 格：第一行 距离｜步行，第二行 爬升｜建议出发 */
    ['\\.hero-stats\\[data-cells="4"\\] \\.stat:nth-child\\(3\\)', "4 格第二行（爬升）"],
    /* 定位卡片：第一行「当前坐标」独占，第二行 精度｜最近楼栋 */
    ["\\.stats-lead-wide \\.stat:first-child", "定位卡片第一行"],
    ["\\.stats-lead-wide \\.stat:nth-child\\(2\\)", "定位卡片第二行（精度）"]
  ];
  const missingLeader = rowLeaders.filter(function (pair) {
    return !new RegExp(pair[0] + "\\s*\\{[\\s\\S]{0,160}?border-left:\\s*0").test(css);
  });
  check("窄屏每一种「换行后行首」都不画左竖线（4 种情况全覆盖）",
    missingLeader.length === 0,
    missingLeader.map(function (p) { return p[1]; }).join(" / "));

  /* 这一条是上一轮"用户又报了一次"的根因：4 格时第二行行首是第 3 个兄弟
     （距离/步行/爬升/建议出发），它 x=0 却带着一条左竖线。 */
  check("窄屏 4 格：第二行行首那格（爬升）特别钉了一条免线规则",
    /\.hero-stats\[data-cells="4"\] \.stat:nth-child\(3\)\s*\{\s*border-left:\s*0;\s*padding-left:\s*0;/.test(css) &&
    /* 同一行右边那格（建议出发）的竖线要留着，别一起免了 */
    /\.hero-stats\[data-cells="4"\] \.stat:nth-child\(even\)\s*\{[\s\S]{0,120}?border-left:\s*1px solid var\(--line\)/.test(css));
}

console.log("\n[49] 楼名模糊匹配：缩写点号 + 一个字母的 OCR 错字");
{
  const O = OP.Ocr;
  const buildings = OP.DEFAULT_DATA.campus.buildings;

  /* 地图上写 "Y.C. Liang Hall"，课表印成 "YC. Liang Hall"。
     不并单字母的话，前者拆出 y / c / liang / hall 四个词，后者只有 yc / liang / hall 三个。 */
  check("缩写点号并成一个词（Y.C. Liang Hall 与 YC. Liang Hall 同形）",
    JSON.stringify(O.nameForms("Y.C. Liang Hall").latin) === JSON.stringify(["yc", "liang", "hall"]) &&
    JSON.stringify(O.nameForms("YC. Liang Hall").latin) === JSON.stringify(["yc", "liang", "hall"]));
  check("孤零零的单字母不并（Building A 还是 a）",
    JSON.stringify(O.nameForms("Building A").latin) === JSON.stringify(["building", "a"]));
  check("只并字母不并数字（Block B 1 不会黏成 b1）",
    JSON.stringify(O.nameForms("Block B 1").latin) === JSON.stringify(["block", "b", "1"]));

  /* 用户报的这条：OCR 把 liang 认成 liana，一字之差整条匹配不上，
     而且当年的最高分是随便一栋 "…Hall"（48%），真楼排到三名开外。 */
  const liana = O.matchBuilding("YC. Liana Hall", buildings);
  check("YC. Liana Hall 匹配到 Y.C. Liang Hall（一个字之差）",
    !!liana && liana.name === "Y.C. Liang Hall" && liana.score >= 0.8,
    liana ? liana.name + " " + Math.round(liana.score * 100) + "%" : "匹配不上");

  /* 一个字母的宽容度只给 5 个字母以上的词，而且长度差只允许 1。
     hall/hill 这种 4 字母词差一个字母就是两栋楼；centre/centenary 差得太远。 */
  check("差一个字母的长词算同一个（liang / liana、building / bullding）",
    O.sameWord("liang", "liana") && O.sameWord("building", "bullding"));
  check("4 字母以内不开口子（hall / hill、ho / hk 不算同一个）",
    !O.sameWord("hall", "hill") && !O.sameWord("ho", "hk") && !O.sameWord("li", "lib"));
  check("长度差超过 1 不算同一个（centre / centenary）",
    !O.sameWord("centre", "centenary"));

  /* 回归网：默认楼栋里每一个名字和别名，都必须匹配回它自己。
     这条能挡住"为了修一个特例把别的楼挤歪"的改动——151 栋、336 个名字形式。 */
  const forms = [];
  buildings.forEach(function (b) {
    [b.name].concat(b.alias || []).forEach(function (candidate) {
      forms.push({ text: candidate, id: b.id, owner: b.name });
    });
  });
  const wrong = forms.filter(function (f) {
    const hit = O.matchBuilding(f.text, buildings);
    return !hit || hit.id !== f.id;
  });
  check("默认楼栋的每个名字/别名都匹配回自己（" + forms.length + " 个名字形式）",
    wrong.length === 0,
    wrong.slice(0, 3).map(function (f) { return f.text + "→" + f.owner; }).join(" / "));

  /* 反向的：课表上那些"不是楼名"的句子，一个都不该匹配上 */
  const junk = ["Location: TBA", "no room required", "待定", "Waiting: 3", "TBA", "12345"];
  const falseHits = junk.filter(function (q) { return O.matchBuilding(q, buildings); });
  check("不是楼名的句子匹配不上（TBA / no room required / 待定 …）",
    falseHits.length === 0, falseHits.join(" / "));

  /* 缩写组之间也容忍一个字母之差：Y→V 是 OCR 最常见的混淆之一，
     而缩写只有两个字母，原来"5 个字母以上才开口子"那条够不着它。
     实测 "V.C. Liang Hall" 之前整条匹配不上（用户报的 Y.C. Liang Hall 读不出来）。 */
  check("缩写被认错一个字母也能匹配（V.C. / VC / X.C. Liang Hall → Y.C. Liang Hall）",
    ["V.C. Liang Hall", "VC Liang Hall", "X.C. Liang Hall"].every(function (q) {
      const hit = O.matchBuilding(q, buildings);
      return hit && hit.name === "Y.C. Liang Hall";
    }));
  check("这条口子只对缩写组开：普通单词（hall / shaw）不会被当成缩写",
    O.nameForms("Y.C. Liang Hall").short.yc === true &&
    !O.nameForms("Lady Shaw Building").short.hall &&
    !O.nameForms("Lady Shaw Building").short.shaw &&
    !O.nameForms("Wu Ho Man Yuen Building").short.ho);
  /* 放宽之后不能冒出新的交叉误匹配：这版和上一版都是 92 对（拿部署中的旧版比过） */
  check("放宽缩写之后，楼栋之间的交叉误匹配没有变多",
    (function () {
      let n = 0;
      for (let i = 0; i < buildings.length; i++) {
        for (let j = 0; j < buildings.length; j++) {
          if (i === j) continue;
          if (O.nameScore(O.nameForms(buildings[i].name), O.nameForms(buildings[j].name)) >= 0.62) n++;
        }
      }
      return n <= 92;      /* 改之前也是 92，只许不增 */
    })());
}

console.log("\n[50] 校历：假期不上课、校巴只剩假日线 H");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const S = OP.Shuttle;
  const cal = OP.HOLIDAYS;

  /* 一天有早课和午课，用来验证"整天停"和"只停上午"两种规则 */
  const school = demo();
  school.courses = [
    { id: "am", name: "早课", buildingId: "A", room: "101", weekdays: [1, 2, 3, 4, 5, 6], start: "09:30", end: "11:15", weeks: [1, 17] },
    { id: "pm", name: "午课", buildingId: "A", room: "102", weekdays: [1, 2, 3, 4, 5, 6], start: "14:30", end: "16:15", weeks: [1, 17] }
  ];
  const on = (y, m, d) => new Date(y, m - 1, d, 10, 0, 0);
  const at = (y, m, d) => OP.Planner.dateKey(on(y, m, d));
  const routesOn = (y, m, d) => S.routesOn(on(y, m, d)).map((r) => r.no);

  check("校历数据在（来源是教务处 2026-27 校历）",
    !!cal && Array.isArray(cal.days) && cal.days.length >= 20 &&
    /2026-27/.test(cal.term) && /res\.cuhk\.edu\.hk/.test(cal.sourceUrl),
    cal ? cal.days.length + " 条" : "没有数据");

  /* 抽查几条：公众假期、农历新年整周、停课日 */
  const need = ["2026-09-26", "2026-10-01", "2026-12-25", "2027-01-01",
    "2027-02-05", "2027-03-26", "2027-05-01", "2027-07-01",
    "2026-09-07", "2026-10-17", "2026-11-12"];
  const missing = need.filter(function (d) {
    return !cal.days.some(function (x) { return x.date === d; });
  });
  check("假期、农历新年、开学礼、停课日都在表里（抽查 11 条）",
    missing.length === 0, missing.join(" "));

  /* 放假那天整天没课——本来有早课和午课各一节 */
  const holiday = on(2026, 10, 1);   /* 国庆日，星期四，本来早晚都有课 */
  check("公众假期整天不上课（国庆日：本有 2 节，实际 0 节）",
    OP.Planner.todayCourses(school, holiday).length === 0 &&
    OP.Planner.cancelledCourses(school, holiday).length === 2);
  check("假期那天给得出名字，界面才说得清原因",
    (function () {
      const d = OP.Planner.holidayOn(holiday);
      return d && d.kind === "holiday" && d.name === "國慶日";
    })());

  /* 开学礼：只停到 13:30，上午的课取消、下午的课照上 */
  const ceremony = on(2026, 9, 7);
  const left = OP.Planner.todayCourses(school, ceremony);
  check("部分停课只砍停课时段（开学礼：上午取消、下午保留）",
    left.length === 1 && left[0].id === "pm" &&
    OP.Planner.cancelledCourses(school, ceremony).length === 1);

  /* 停课日不是假期：课不上，但校巴照常（不是只剩 H） */
  const infoDay = on(2026, 10, 17);
  const busNormal = routesOn(2026, 10, 17);
  check("停课日不上课但校巴照常（入学资讯日）",
    OP.Planner.todayCourses(school, infoDay).length === 0 &&
    busNormal.indexOf("H") === -1 && busNormal.indexOf("1") >= 0,
    "校巴 " + busNormal.join(","));

  /* 假期（含农历新年的大学假期）：只剩假日线 H */
  const onlyH = [[2026, 9, 26], [2026, 10, 1], [2026, 10, 19], [2026, 12, 25],
    [2027, 2, 5], [2027, 2, 10], [2027, 3, 26], [2027, 5, 1], [2027, 7, 1]];
  const badHoliday = onlyH.filter(function (c) {
    return routesOn(c[0], c[1], c[2]).join(",") !== "H";
  });
  check("假期只有假日线 H（公眾假期 + 农历新年那周的大学假期，抽查 9 天）",
    badHoliday.length === 0,
    badHoliday.map(function (c) { return at(c[0], c[1], c[2]) + ":" + routesOn(c[0], c[1], c[2]).join(","); }).join(" "));
  check("普通工作日不能只剩 H（周一至六的线都在）",
    routesOn(2026, 9, 16).indexOf("1") >= 0 && routesOn(2026, 9, 16).indexOf("H") === -1);
  check("星期日本来就只有 H（这条不是校历的功劳，怕被改坏）",
    routesOn(2026, 9, 13).join(",") === "H");
  /* 校历只到 2026-27：范围外按普通日子处理（宁可多显示课，也别把整天的课吞掉）。
     用一套不限制周次的课来试，否则先被"1-17 周"挡掉，测不出校历这条。 */
  const openEnded = demo();
  openEnded.courses = [{ id: "any", name: "任何时候的课", buildingId: "A", room: "1",
    weekdays: [1], start: "09:30", end: "11:15", weeks: [1, 100] }];
  check("校历覆盖不到的日子按普通日子处理（2028-01-10 是周一）",
    OP.Planner.holidayOn(on(2028, 1, 10)) === null &&
    OP.Planner.todayCourses(openEnded, on(2028, 1, 10)).length === 1);

  /* 周次功能整体取消（用户要求）：课表里不再有"适用周次"这个概念，
     只剩顶上那个「当前学期第几周」，学期开始日设置保留。 */
  check("「适用周次」整套没了：界面没有输入框，代码里也不再产生 weeks",
    pageHtml.indexOf("适用周次") === -1 && pageHtml.indexOf('id="cfWeeksFrom"') === -1 &&
    pageHtml.indexOf('id="ocrWeekFrom"') === -1 &&
    !/weeks:/.test(appCode) && !/\.weeks\b/.test(appCode));
  check("顶上那个「第 N 周」和学期开始日设置都还在",
    /\$\("#todayLabel"\)\.textContent = label/.test(appCode) &&
    /label \+= " · 第 " \+ wk \+ " 周"/.test(appCode) &&
    pageHtml.indexOf('id="todayLabel"') > 0 &&
    pageHtml.indexOf('id="sTermStart"') > 0 &&
    OP.Store.defaults().settings.termStart === "2026-09-07");
  check("课表里那行小字：有起止日期的显示日期，没有的只显示星期",
    OP.Planner.weekText({ weekdays: [1], start: "09:00", end: "10:00" }) === "周一" &&
    OP.Planner.weekText({ weekdays: [2], start: "09:00", end: "10:00",
      startDate: "2026-09-08", endDate: "2026-12-01" }) === "周二 · 2026-09-08 – 2026-12-01");
  check("按日期过滤：拉回来的课只在起止日期之内算今天有课",
    (function () {
      const inside = { weekdays: [2], start: "09:00", end: "10:00", startDate: "2026-09-08", endDate: "2026-12-01" };
      const outside = { weekdays: [2], start: "09:00", end: "10:00", startDate: "2027-01-11", endDate: "2027-04-12" };
      const noDates = { weekdays: [2], start: "09:00", end: "10:00" };
      return OP.Planner.courseOnDay(inside, new Date(2026, 9, 6)) === true &&
        OP.Planner.courseOnDay(outside, new Date(2026, 9, 6)) === false &&
        OP.Planner.courseOnDay(noDates, new Date(2026, 9, 6)) === true;
    })());

  /* 模糊匹配给多个候选时，够像的都要能选到 */
  const buildings = OP.DEFAULT_DATA.campus.buildings;
  const sci = OP.Ocr.rankBuildings("Science Centre L3", buildings);
  check("多个候选都列出来，最像的在第一个",
    sci.length >= 2 && sci[0].score >= sci[1].score && sci[0].score >= 0.62,
    sci.slice(0, 3).map(function (r) { return r.name + Math.round(r.score * 100) + "%"; }).join(" / "));
  check("matchBuilding 就是候选里的第一个（两处口径一致）",
    OP.Ocr.matchBuilding("Science Centre L3", buildings).id === sci[0].id);

  /* 下拉框的选项 HTML 本身也钉住：够像的排最上面一组、带把握度、最像的选中 */
  const pick = OP.Ocr.matchOptions("Science Centre L3", buildings, { escape: (s) => s });
  const group = pick.html.slice(0, pick.html.indexOf("</optgroup>"));
  check("下拉框最上面一组就是所有够像的楼栋，最像的默认选中",
    /^<option value="">（未指定）<\/option><optgroup label="都够像/.test(pick.html) &&
    (group.match(/selected/g) || []).length === 1 &&
    group.indexOf(pick.ranked[0].name + "　" + Math.round(pick.ranked[0].score * 100) + "%") > 0 &&
    pick.ranked.slice(1).every(function (r) { return group.indexOf(r.name + "　") > 0; }),
    pick.ranked.map(function (r) { return r.name + Math.round(r.score * 100) + "%"; }).join(" / "));
  check("候选不会在「其他楼栋」里再出现一次",
    pick.ranked.every(function (r) {
      return pick.html.slice(pick.html.indexOf('<optgroup label="其他楼栋">'))
        .indexOf('value="' + r.id + '"') === -1;
    }));
  check("只有一个候选时不硬加分组（还是平铺的全表）",
    (function () {
      const flat = OP.Ocr.matchOptions("Lady Shaw Bldg", buildings, { escape: (s) => s });
      return flat.ranked.length === 1 && flat.html.indexOf("<optgroup") === -1 &&
        /selected/.test(flat.html);
    })());
  check("「不需要教室」的课在下拉框里说的是不需要教室",
    OP.Ocr.matchOptions("", buildings, { escape: (s) => s, noRoom: true })
      .html.indexOf("（不需要教室）") > 0);

  /* 用户要求去掉的那句说明 */
  check("识别详情不再写「出问题时用来排查」",
    pageHtml.indexOf("出问题时用来排查") === -1 &&
    pageHtml.indexOf("<summary>识别详情</summary>") > 0);

  /* 放假那天"距离 / 步行 / 建议出发"和倒计时都是空话，收起来 */
  check("放假那天收起倒计时和读数行（不留一排假的破折号）",
    /\$\("#nextStats"\)\.hidden = !!closed;/.test(appCode) &&
    /\$\("#nextCountdown"\)\.hidden = !!closed;/.test(appCode) &&
    /\$\("#nextStats"\)\.hidden = false;/.test(appCode));
}

console.log("\n[51] 按用户要求删掉的四个入口");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");

  /* 用户点名删掉的四样：现在出发 / 现在回宿舍 / 用当前位置添加宿舍 /
     从今天最后一节课的教室出发。删的时候最容易犯的错是只删了 HTML、
     脚本里还留着 $("#btnXxx").addEventListener —— 那样一开页面就报错，
     后面所有绑定都不执行（整页按钮全失灵）。所以两处都要钉。 */
  const removed = [
    ["现在出发", 'id="btnStartNow"'],
    ["现在回宿舍", 'id="btnDormGo"'],
    ["用当前位置添加宿舍", 'id="btnDormAddHere"'],
    ["从今天最后一节课的教室出发", 'id="dormFromClass"']
  ];
  const leftover = removed.filter(function (pair) { return pageHtml.indexOf(pair[1]) >= 0; });
  check("四个控件从 HTML 里删干净了", leftover.length === 0,
    leftover.map(function (p) { return p[0]; }).join(" / "));
  check("脚本里也没有残留的绑定（否则 $(\"#x\") 是 null，后面的绑定全不执行）",
    ["#btnStartNow", "#btnDormGo", "#btnDormAddHere", "#dormFromClass", "#dormForm"]
      .every(function (sel) { return appCode.indexOf('$("' + sel + '")') === -1; }));
  check("那两句「按用当前位置添加宿舍」的提示也没了",
    appCode.indexOf("用当前位置添加宿舍") === -1 && pageHtml.indexOf("用当前位置添加宿舍") === -1);

  /* 该留的还得在 */
  check("该在的还在：今日两颗播报按钮、返回宿舍卡、删除自建宿舍",
    pageHtml.indexOf('id="btnSpeakNext"') > 0 && pageHtml.indexOf('id="btnBrief"') > 0 &&
    pageHtml.indexOf('id="dormPlan"') > 0 && pageHtml.indexOf('id="btnDormRemove"') > 0 &&
    pageHtml.indexOf('id="dormActions"') > 0);
  check("删除宿舍那一行在没得删时整行收起来（不留空行）",
    /\$\("#dormActions"\)\.hidden = !\(dorm && dorm\.custom\)/.test(appCode));
  check("回宿舍的起点改成「我的位置」了（取不到定位才退回教室）",
    /var pos = effectivePosition\(\);\s*\n\s*if \(pos\) return \{ point: pos, name: "我的位置"/.test(appCode) &&
    appCode.indexOf("没取到定位，先按今天最后一节课的教室算") > 0);
  check("空宿舍时的文案不再指向已经删掉的按钮",
    appCode.indexOf("上面搜一个宿舍") > 0);
}

console.log("\n[52] 课表代理（Cloudflare Worker）");
{
  const cp = require("child_process");
  const proxyCode = fs.readFileSync(path.join(root, "worker", "timetable-proxy.js"), "utf8");

  /* 先把"代码里必须有的防线"钉死，再让 worker 自己的测试跑一遍。
     这里是静态检查：光靠在自检里跑单测，删掉一条防线也不会红。 */
  check("代理只认死一个上游，不接受请求里传目标地址",
    proxyCode.indexOf("const UPSTREAM = \"https://campusapps.itsc.cuhk.edu.hk/store/CLASSSCHD/STT.asmx\"") > 0 &&
    proxyCode.indexOf("payload.target") === -1 && proxyCode.indexOf("payload.url") === -1);
  check("请求体里的密码不进日志（连 DEBUG 也只写状态码/耗时）",
    /console\.log\(JSON\.stringify\(\{ status: status, ms: Date\.now\(\) - started, mode: data && data\.mode \}\)\)/.test(proxyCode) &&
    proxyCode.indexOf("console.log(raw") === -1 && proxyCode.indexOf("console.log(payload") === -1);
  check("响应不许被缓存（课表是个人信息）",
    /"Cache-Control": "no-store"/.test(proxyCode));
  check("只收 POST、请求体上限 1KB、路径带口令",
    /request\.method !== "POST"/.test(proxyCode) &&
    /MAX_BODY_BYTES = 1024/.test(proxyCode) &&
    /url\.pathname === "\/t\/" \+ token/.test(proxyCode));
  check("两种 XML 外壳都认（SOAP 的 GetTimeTableResult + form 的 string）",
    /\["GetTimeTableResult", "string"\]/.test(proxyCode));

  /* 再真跑一遍它的单元测试（上游用替身，不联网） */
  let out = "";
  let ok = true;
  try {
    out = cp.execFileSync(process.execPath, [path.join(root, "worker", "test.mjs")], { encoding: "utf8" });
  } catch (err) {
    ok = false;
    out = String(err.stdout || "") + String(err.stderr || "");
  }
  const lines = out.split("\n").filter(function (line) { return /[✓✗]/.test(line); });
  check("代理的单元测试跑得起来", lines.length >= 20, lines.length + " 条");
  lines.forEach(function (line) {
    check("代理：" + line.replace(/^\s*[✓✗]\s*/, ""), line.indexOf("✗") < 0);
  });
  check("代理的单元测试全过（退出码为 0）", ok);
}

console.log("\n[53] 从学校接口拉课表：字段映射");
{
  const T = OP.Timetable;
  const buildings = OP.DEFAULT_DATA.campus.buildings;
  const TERM = "2026-09-07";

  /* ---------- 值的归一化 ---------- */
  check("时间归一化：9:30 / 09:30:00 都成 09:30",
    T.normTime("9:30") === "09:30" && T.normTime("09:30:00") === "09:30" &&
    T.normTime("25:00") === "" && T.normTime("") === "");
  /* 日期：**八位数字那种才是真数据**（CUSIS/Scientia 的写法）。
     第一版只认带分隔符的，结果真数据一个日期都没解析出来——
     课表里"星期后面那截起止日期"整段消失（用户截图为证）。 */
  check("日期归一化：八位数字（20260907）也要认",
    T.fmtDate("20260907") === "2026-09-07" && T.fmtDate("20261204") === "2026-12-04");
  check("日期归一化：带分隔符、带时分秒的照样认",
    T.normDate("2026-09-07 00:00:00.0").getDate() === 7 &&
    T.normDate("2026/9/7").getMonth() === 8 &&
    T.fmtDate("2026.09.07") === "2026-09-07" &&
    T.normDate("") === null);
  check("不像日期的字符串要拒掉，不能瞎归一（7 位数字 / 13 月 / 2 月 30 日）",
    T.fmtDate("2026090") === "" && T.fmtDate("20261301") === "" &&
    T.fmtDate("2026-02-30") === "" && T.fmtDate("junk") === "");
  check("八位数字的一整行能解析出起止日期（就是截图里那个 bug）",
    (function () {
      const built = T.toCourses([{
        SUBJECT: "ENGG", CATALOG_NBR: "1110", CLASS_SECTION: "A", COMDESC: "Lecture",
        FDESCR: "Yasumoto International Academic Park LT6", START_DT: "20260907",
        END_DT: "20261204", MEETING_TIME_START: "12:30", MEETING_TIME_END: "14:15", MON: "Y"
      }], { buildings: OP.DEFAULT_DATA.campus.buildings });
      return built.courses.length === 1 &&
        built.courses[0].startDate === "2026-09-07" && built.courses[0].endDate === "2026-12-04" &&
        OP.Planner.weekText(built.courses[0]) === "周一 · 2026-09-07 – 2026-12-04";
    })());
  check("星期：能从开始日期推（上游是「开始日期 + 每周重复」）",
    T.weekdayOf("2026-09-07 00:00:00.0", "") === 1 &&
    T.weekdayOf("", "Thursday") === 4 && T.weekdayOf("", "fri") === 5 &&
    T.weekdayOf("", "3") === 3 && T.weekdayOf("", "") === 0);

  /* 真数据里星期是七列开关（MON / TUES / …），不靠日期猜 */
  check("星期读的是那七个开关列（MON=Y → 周一；MON+WED 两个 Y → 周一和周三）",
    JSON.stringify(T.weekdaysFromFlags(T.keyIndexes({ MON: "Y" }), { MON: "Y" })) === "[1]" &&
    JSON.stringify(T.weekdaysFromFlags(T.keyIndexes({ MON: "Y", WED: "Y", FRI: "N" }), { MON: "Y", WED: "Y", FRI: "N" })) === "[1,3]" &&
    JSON.stringify(T.weekdaysFromFlags(T.keyIndexes({ SUN: "y" }), { SUN: "y" })) === "[7]" &&
    JSON.stringify(T.weekdaysFromFlags(T.keyIndexes({ MON: "N", TUES: "" }), { MON: "N", TUES: "" })) === "[]");
  check("七个开关一个都没勾时，才退回从开始日期推",
    T.toCourses([{
      SUBJECT: "A", CATALOG_NBR: "1", FDESCR: "Science Centre", MON: "N",
      MEETING_TIME_START: "09:00", MEETING_TIME_END: "10:00",
      START_DT: "2026-09-09", END_DT: "2026-09-30"
    }], { termStart: TERM, buildings: buildings }).courses[0].weekdays[0] === 3);
  check("地名拆成「楼 + 教室」",
    T.splitVenue("Science Centre L3").building === "Science Centre" &&
    T.splitVenue("Science Centre L3").room === "L3" &&
    T.splitVenue("Lady Shaw Building LT2").room === "LT2" &&
    T.splitVenue("Y.C. Liang Hall 106").building === "Y.C. Liang Hall");
  check("TBA / 不需要教室 都算「地点待定」",
    T.splitVenue("Location: TBA").tba === true &&
    T.splitVenue("").tba === true &&
    T.splitVenue("Science Centre L3").tba === false);

  /* ---------- 字段名大小写/下划线不敏感 ---------- */
  check("字段名的大小写、下划线、空格都不计较",
    T.pick(T.keyIndexes({ meeting_time_start: "09:30" }), { meeting_time_start: "09:30" }, T.NAMES.startTime) === "09:30" &&
    T.pick(T.keyIndexes({ "Meeting Time Start": "10:00" }), { "Meeting Time Start": "10:00" }, T.NAMES.startTime) === "10:00" &&
    T.pick(T.keyIndexes({ MEETINGTIMESTART: "11:00" }), { MEETINGTIMESTART: "11:00" }, T.NAMES.startTime) === "11:00");

  /* ---------- 一整行 → 一条课 ---------- */
  const row = {
    SUBJECT: "BMEG", CATALOG_NBR: "2210", CLASS_SECTION: "A",
    DESCR: "Biomedical Engineering Laboratory", COMDESC: "Lecture",
    FDESCR: "Science Centre L3", INSTRUCTORS: "Prof. Chan",
    START_DT: "2026-09-07 00:00:00.0", END_DT: "2026-12-04 00:00:00.0",
    MEETING_TIME_START: "09:30", MEETING_TIME_END: "11:15",
    LAT: "22.419600", LNG: "114.206800"
  };
  const built = T.toCourses([row], { termStart: TERM, buildings: buildings });
  const course = built.courses[0];

  check("课名 = 代号 + 班号 + 类型（和截图导入一个写法）",
    course && course.name === "BMEG 2210-A Lecture", course && course.name);
  check("时间 / 星期都从上游字段读对了",
    course.start === "09:30" && course.end === "11:15" && course.weekdays[0] === 1);
  /* 上游没有周次字段，只有两个日期——原样留着，界面直接显示这一段 */
  check("起止日期原样留着（页面显示的就是这两个日期，不做任何换算）",
    course.startDate === "2026-09-07" && course.endDate === "2026-12-04",
    course.startDate + " – " + course.endDate);
  check("地名匹配到已有楼栋（Science Centre L3 → 大学科学馆那条）",
    !!course.buildingId && course.room === "L3",
    course.buildingId || "没匹配上");
  check("上游自带经纬度也留下来了（以后能直接补楼栋坐标）",
    course.lat === 22.4196 && course.lng === 114.2068);
  check("老师也带上了", course.teacher === "Prof. Chan");
  check("原始字段名的清单会回报上来（联调时看这个）",
    built.report.keys.indexOf("FDESCR") >= 0 && built.report.keys.indexOf("MEETING_TIME_START") >= 0);

  /* ---------- 真实数据长这样（用户把字段名发回来了） ---------- */
  const realRow = {
    /* 真数据里第一个字段就叫 K（不是谁打错了），照抄进来当回归样本：
       不认识的字段必须被安全忽略 */
    K: "X", STRM: "2610", STRM_DESCR: "2026-27 Term 1", CLASS_NBR: "12345", CLASS_MTG_NBR: "1",
    DESCR: "Biomedical Engineering Laboratory", CRSE_ID: "008899",
    SUBJECT: "BMEG", CATALOG_NBR: "2210", SSR_COMPONENT: "LEC", CLASS_SECTION: "A",
    START_DT: "2026-09-07", END_DT: "2026-12-04",
    MEETING_TIME_START: "09:30", MEETING_TIME_END: "11:15",
    MON: "N", TUES: "Y", WED: "N", THURS: "Y", FRI: "N", SAT: "N", SUN: "N",
    FACILITY_ID: "SC-L3", FDESCR: "Science Centre L3", BLDG_CD: "SC",
    LAT: "22.419600", LNG: "114.206800", INSTRUCTORS: "Prof. Chan", COMDESC: "Lecture"
  };
  const realBuilt = T.toCourses([realRow], { termStart: TERM, buildings: buildings });
  const real = realBuilt.courses[0];
  check("真实字段那一行能完整解析（周二 + 周四两天同一时间）",
    realBuilt.courses.length === 1 &&
    JSON.stringify(real.weekdays) === "[2,4]" &&
    real.name === "BMEG 2210-A Lecture" &&
    real.room === "L3" && real.startDate === "2026-09-07" && real.endDate === "2026-12-04",
    realBuilt.courses.length
      ? JSON.stringify({ d: real.weekdays, n: real.name, r: real.room, from: real.startDate, to: real.endDate })
      : "没解析出来");
  check("类号 / 课程 ID / 楼栋代码也顺手留下来了",
    real.classNbr === "12345" && real.courseId === "008899" && real.buildingCode === "SC");

  /* 楼名本身就以数字结尾时，不能先削再匹配——否则会拿"…Building"去认楼。
     顺序必须是：先完整地名，再退回削掉教室号的版本。 */
  const numbered = T.toCourses([{
    SUBJECT: "F", CATALOG_NBR: "1", FDESCR: "Foo Building 7",
    MEETING_TIME_START: "09:00", MEETING_TIME_END: "10:00", MON: "Y",
    START_DT: "2026-09-07", END_DT: "2026-09-28"
  }], {
    termStart: TERM,
    buildings: [{ id: "foo7", name: "Foo Building 7", alias: [], lat: 22.42, lng: 114.21 }]
  }).courses[0];
  check("地名匹配先试完整写法（楼名带数字时不会被削成半截）",
    numbered.buildingId === "foo7" && numbered.room === "",
    "buildingId=" + numbered.buildingId + " room=" + numbered.room);

  /* ---------- 周次功能已经取消：只留日期 ---------- */
  const dated = T.toCourses([{
    SUBJECT: "T", CATALOG_NBR: "1", FDESCR: "Science Centre L3", TUES: "Y",
    MEETING_TIME_START: "09:00", MEETING_TIME_END: "10:00",
    START_DT: "2026-09-08 00:00:00.0", END_DT: "2026-12-07"
  }], { buildings: buildings }).courses[0];
  check("日期带时分秒也归一成 YYYY-MM-DD，而且不做任何周次换算",
    dated.startDate === "2026-09-08" && dated.endDate === "2026-12-07" &&
    dated.weeks === undefined,
    dated.startDate + " – " + dated.endDate);
  check("没有日期时就是空串（界面那行只显示星期）",
    T.toCourses([{
      SUBJECT: "T", CATALOG_NBR: "4", FDESCR: "Science Centre L3", MON: "Y",
      MEETING_TIME_START: "09:00", MEETING_TIME_END: "10:00"
    }], { buildings: buildings }).courses[0].startDate === "");

  /* ---------- 跨学期要报出来 ---------- */
  const twoTerms = T.toCourses([
    { SUBJECT: "A", CATALOG_NBR: "1", FDESCR: "Science Centre L3", MON: "Y", STRM: "2610", STRM_DESCR: "2026-27 Term 1", MEETING_TIME_START: "09:00", MEETING_TIME_END: "10:00", START_DT: "2026-09-07", END_DT: "2026-11-30" },
    { SUBJECT: "B", CATALOG_NBR: "2", FDESCR: "Science Centre L3", TUE: "Y", STRM: "2620", STRM_DESCR: "2026-27 Term 2", MEETING_TIME_START: "09:00", MEETING_TIME_END: "10:00", START_DT: "2027-01-11", END_DT: "2027-04-12" }
  ], { termStart: TERM, buildings: buildings });
  check("跨学期能识别出来（STRM 汇总回报给界面提示用）",
    twoTerms.report.terms.length === 2 &&
    twoTerms.report.terms[0].descr === "2026-27 Term 1" &&
    twoTerms.report.terms.every(function (t) { return t.count === 1; }),
    JSON.stringify(twoTerms.report.terms));
  check("两个学期的课各自带着自己的日期区间（不再换算周次，就没有偏不偏的问题）",
    twoTerms.courses[0].startDate === "2026-09-07" && twoTerms.courses[0].endDate === "2026-11-30" &&
    twoTerms.courses[1].startDate === "2027-01-11" && twoTerms.courses[1].endDate === "2027-04-12",
    JSON.stringify(twoTerms.courses.map(function (c) { return c.startDate + "–" + c.endDate; })));

  /* ---------- 字段名换了也认 ---------- */
  const loose = T.toCourses([{
    subject: "engg", catalog_nbr: "1110", class_section: "A", compdesc: "Tutorial",
    location: "Lady Shaw Building LT2", meeting_time_start: "14:30",
    meeting_time_end: "15:15", start_dt: "2026-09-08", end_dt: "2026-09-29"
  }], { termStart: TERM, buildings: buildings });
  check("换成小写字段名 / 别名也认",
    loose.courses.length === 1 && loose.courses[0].room === "LT2" &&
    loose.courses[0].weekdays[0] === 2 && loose.courses[0].endDate === "2026-09-29",
    loose.courses.length ? JSON.stringify(loose.courses[0].endDate) : "解析不出");

  /* ---------- 缺东西就跳过，不抛错 ---------- */
  const broken = T.toCourses([
    { SUBJECT: "X", CATALOG_NBR: "1", MEETING_TIME_START: "09:00" },
    null,
    { SUBJECT: "Y", CATALOG_NBR: "2", MEETING_TIME_START: "09:00", MEETING_TIME_END: "10:00", START_DT: "2026-09-07" }
  ], { termStart: TERM, buildings: buildings });
  check("缺时间的行跳过、坏数据不抛错（并在 report 里报数）",
    broken.courses.length === 1 && broken.report.skipped === 2 && broken.report.rows === 3,
    JSON.stringify(broken.report));

  /* ---------- 地点待定的课要留着（不是没读到） ---------- */
  const tba = T.toCourses([{
    SUBJECT: "GESC", CATALOG_NBR: "1000", CLASS_SECTION: "AO1", COMDESC: "Assembly",
    FDESCR: "Location: TBA", MEETING_TIME_START: "11:30", MEETING_TIME_END: "13:15",
    START_DT: "2026-09-07", END_DT: "2026-09-28"
  }], { termStart: TERM, buildings: buildings });
  check("「地点待定」的课留着，只是没有楼栋（跟截图导入一致）",
    tba.courses.length === 1 && tba.courses[0].tba === true &&
    tba.courses[0].buildingId === "" && tba.courses[0].room === "");

  /* ---------- 一周一行的那种返回 ---------- */
  const spread = T.mergeCourses(T.toCourses([
    { SUBJECT: "A", CATALOG_NBR: "1", FDESCR: "Science Centre L3", MEETING_TIME_START: "09:30", MEETING_TIME_END: "10:15", START_DT: "2026-09-07", END_DT: "2026-09-14" },
    { SUBJECT: "A", CATALOG_NBR: "1", FDESCR: "Science Centre L3", MEETING_TIME_START: "09:30", MEETING_TIME_END: "10:15", START_DT: "2026-09-21", END_DT: "2026-10-26" }
  ], { buildings: buildings }).courses);
  check("同一节课被拆成多行时合并成一条，日期区间取并集（最早开始 → 最晚结束）",
    spread.length === 1 && spread[0].startDate === "2026-09-07" && spread[0].endDate === "2026-10-26",
    JSON.stringify(spread.map(function (c) { return c.startDate + "–" + c.endDate; })));
}

console.log("\n[54] 从学校接口拉课表：页面接线");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const defaults = fs.readFileSync(path.join(root, "data", "defaults.js"), "utf8");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const settingsKeys = Object.keys(OP.Store.defaults().settings);

  check("课表页有「从学校接口拉取课表」这张卡，输入项齐",
    pageHtml.indexOf('id="pullCard"') > 0 && pageHtml.indexOf('id="pullSid"') > 0 &&
    pageHtml.indexOf('id="pullPwd"') > 0 &&
    pageHtml.indexOf('id="btnPull"') > 0 &&
    pageHtml.indexOf('id="btnPullImport"') > 0);
  check("脚本里每颗按钮/输入框都绑上了（少一个就是开页面就报错）",
    ["#btnPull", "#btnPullImport", "#btnPullClear", "#pullSid", "#pullPwd"]
      .every((sel) => appCode.indexOf('$("' + sel + '")') > 0));
  check("mapping 模块被加载进来了",
    pageHtml.indexOf('js/timetable.js') > 0 &&
    appCode.indexOf("OP.Timetable.toCourses") > 0 &&
    appCode.indexOf("OP.Timetable.mergeCourses") > 0);

  /* 最重要的一条：密码绝不落盘。只记学号。 */
  check("密码不进设置、不进 localStorage（只记学号）",
    !/settings\.pullPwd/.test(appCode) &&
    !/settings\.(pwd|password)\b/i.test(appCode) &&
    /data\.settings\.pullSid = sid;/.test(appCode) &&
    settingsKeys.indexOf("pullSid") >= 0 &&
    settingsKeys.indexOf("pullPwd") === -1 &&
    settingsKeys.indexOf("pullProxy") === -1 && settingsKeys.indexOf("pullMode") === -1);
  check("用完立刻清掉密码框",
    /\$\("#pullPwd"\)\.value = "";/.test(appCode));
  /* 隐私说明从"输入框里的灰字"改成输入框下方的一行说明（用户要求：
     框内提示太丑，挪到下面；截图导入那个虚线框下面也要有一份） */
  check("SID/密码框下面有一行「本网站不会储存您的任何个人信息」",
    /<div class="field-row">[\s\S]{0,600}?<\/div>\s*<p class="field-note">本网站不会储存您的任何个人信息<\/p>/.test(pageHtml));
  check("截图导入的虚线框下面也有同一句",
    /id="ocrDrop"[\s\S]{0,300}?<\/div>\s*<p class="field-note">本网站不会储存您的任何个人信息<\/p>/.test(pageHtml));
  check("密码框里不再塞那句提示（框内留白）",
    /id="pullPwd"[^>]*>/.test(pageHtml) &&
    !/id="pullPwd"[^>]*placeholder=/.test(pageHtml));
  /* 用户要求**允许**浏览器记住这组账号密码（原来挡着自动填充，现在放开）：
     username + current-password 是密码管理器认的标准搭配。 */
  check("学号/密码用标准 autocomplete，允许浏览器保存这组密码",
    /id="pullSid"[^>]*autocomplete="username"/.test(pageHtml) &&
    /id="pullPwd"[^>]*autocomplete="current-password"/.test(pageHtml));

  /* 代理地址和上游写法都写死在代码里，界面上不再出现 */
  check("代理地址与写法写死，界面上没有这两个输入项",
    /var PULL_PROXY = "https:\/\/cuhk-timetable-proxy\.y1819400195-721\.workers\.dev\/t\/k7fq2m9x";/.test(appCode) &&
    /var PULL_MODE = "soap-aes";/.test(appCode) &&
    pageHtml.indexOf('id="pullProxy"') === -1 && pageHtml.indexOf('id="pullMode"') === -1 &&
    pageHtml.indexOf("workers.dev") === -1 && pageHtml.indexOf("soap-aes") === -1);

  /* 上游字段还没见过真实数据，所以必须留一个"原始字段"面板 */
  check("有「原始字段」面板（联调时对齐字段名用）",
    pageHtml.indexOf('id="pullDebug"') > 0 && pageHtml.indexOf('id="pullDebugSummary"') > 0 &&
    appCode.indexOf("report.keys.join") > 0);

  /* 导入时：重复的不重复加、没匹配上的楼栋建出来并带上坐标 */
  check("导入会跳过已有的课（拉两次不会变两份）",
    appCode.indexOf("if (existing[key]) { dup++; return; }") > 0);
  check("导入会给新楼栋带上上游的经纬度、给老楼栋补坐标",
    appCode.indexOf("id: Store.uid(\"b\"), name: c.buildingName") > 0 &&
    appCode.indexOf("b.lat = c.lat;") > 0);

  /* 密码框也是 .field 里的输入框，要走同一套皮——
     样式表里那组选择器是逐个 type 列的，漏了 password 就会退回浏览器默认的灰框
     （实测过：border 会是 rgb(118,118,118)）。 */
  check("密码框和别的输入框共用同一套样式（不会退回浏览器默认灰框）",
    /\.field input\[type="password"\],/.test(css) &&
    /\.field input\[type="text"\],[\s\S]{0,200}?\.field input\[type="password"\],/.test(css));

  /* 2026-10 实测：明文那两种读回来是空的，只有加密的能读到课 */
  check("每次拉取都显式告诉代理用哪种写法（不依赖代理那台的默认值）",
    /var body = \{ sid: sid, pwd: pwd, mode: PULL_MODE \};/.test(appCode));
  check("代理那边的默认值也改成了 soap-aes",
    /const DEFAULT_MODE = "soap-aes";/.test(fs.readFileSync(path.join(root, "worker", "timetable-proxy.js"), "utf8")) &&
    /UPSTREAM_MODE = "soap-aes"/.test(fs.readFileSync(path.join(root, "worker", "wrangler.toml"), "utf8")));
}

console.log("\n[55] 课表导出成图片：排版（纯计算那半）");
{
  const X = OP.ExportImage;
  const week = [
    { id: "c1", name: "高等数学", teacher: "", buildingId: "A", room: "301",
      weekdays: [1, 3], start: "09:30", end: "11:15" },
    { id: "c2", name: "大学英语", teacher: "", buildingId: "B", room: "205",
      weekdays: [1], start: "10:00", end: "11:00" },
    { id: "c3", name: "数据结构", teacher: "", buildingId: "C", room: "401",
      weekdays: [5], start: "14:30", end: "16:15" }
  ];

  const empty = X.layout([]);
  check("空课表：layout 直接说 empty（调用方据此提示，不去画一张空图）",
    empty.empty === true && empty.events.length === 0);

  const model = X.layout(week);
  check("画周一到周五（周末没课就不占列）",
    JSON.stringify(model.days) === "[1,2,3,4,5]" && model.empty === false);
  check("时间轴：上端取整点、下端取整半小时，并留出余量",
    X.minToHM(model.startMin) === "09:00" && X.minToHM(model.endMin) === "16:30",
    X.minToHM(model.startMin) + "–" + X.minToHM(model.endMin));
  check("整点刻度每小时一条（09:00 到 16:30 之间是 8 条）",
    model.marks.length === 8 && model.marks[0].label === "09:00" && model.marks[7].label === "16:00");
  check("一门课上两天就生成两个方块（周一 + 周三）",
    model.events.filter(function (e) { return e.course.id === "c1"; }).length === 2);

  /* 周一 09:30–11:15 和 10:00–11:00 撞车了 → 并排两车道；
     周五那节自己一个人 → 独占整列（不被上午的挤窄） */
  const monday = model.events.filter(function (e) { return e.day === 1; })
    .sort(function (a, b) { return a.startMin - b.startMin; });
  check("同一时段撞车 → 并排两车道，且同簇里每条的 lanes 都是 2",
    monday.length === 2 && monday[0].lanes === 2 && monday[1].lanes === 2 &&
    monday[0].lane === 0 && monday[1].lane === 1,
    JSON.stringify(monday.map(function (e) { return [e.course.name, e.lane, e.lanes]; })));
  const friday = model.events.filter(function (e) { return e.day === 5; })[0];
  check("不重叠的课独占整列（车道数按簇算，不是按天算）",
    friday.lanes === 1 && friday.lane === 0);

  /* 只有一节课时别画成一条扁带 */
  const single = X.layout([week[2]]);
  check("只有一节课时，时间轴至少撑到 6 小时",
    single.endMin - single.startMin >= 6 * 60,
    (single.endMin - single.startMin) + " 分钟");

  /* 数据脏了不能把整张图弄挂 */
  const dirty = X.layout([
    { id: "x", name: "没星期", weekdays: [], start: "09:00", end: "10:00" },
    { id: "y", name: "时间反了", weekdays: [2], start: "15:00", end: "14:00" },
    { id: "z", name: "没时间", weekdays: [2] },
    null,
    week[0]
  ]);
  check("没星期/时间反了/没时间/空值都被跳过，不抛错",
    dirty.count === 1 && dirty.events.length === 2,
    "count=" + dirty.count + " events=" + dirty.events.length);

  check("周六有课就自动加一列", (function () {
    const sat = week.concat([{ id: "s", name: "周六补课", weekdays: [6], start: "09:00", end: "12:00" }]);
    return JSON.stringify(X.layout(sat).days) === "[1,2,3,4,5,6]";
  })());

  check("时间换算：09:30 → 570 分钟，570 → 09:30",
    X.hmToMin("09:30") === 570 && X.minToHM(570) === "09:30" && isNaN(X.hmToMin("")));

  /* ---------- 所有比例都用网格；竖版把表格纵向拉长 ---------- */
  const tall = X.plan(week, { ratio: 9 / 19.5 });
  check("竖比例（手机壁纸）**还是网格**（用户要的就是网格，不要换成列表）",
    tall && tall.mode === "grid" && tall.model.days.length === 5 && tall.model.events.length > 0,
    tall ? tall.mode : "null");
  check("画布比例就是要求的比例（不是靠留白凑）",
    Math.abs(tall.surface.width / tall.surface.height - 9 / 19.5) < 0.01,
    tall.surface.width + "×" + tall.surface.height + " = " + (tall.surface.width / tall.surface.height).toFixed(4));
  check("竖版把表格纵向拉长（网格高度明显大于自然高度）",
    tall.model.geo.gridH > X.layout(week, {}).geo.gridH * 2,
    tall.model.geo.gridH + " vs 自然 " + X.layout(week, {}).geo.gridH);
  check("拉长之后每小时的格子够高，课室地点写得下",
    (function () {
      const pxPerMin = tall.model.geo.gridH / (tall.model.endMin - tall.model.startMin);
      return pxPerMin * 60 >= 100;      // 一小时至少 100px
    })(),
    (function () {
      const pxPerMin = tall.model.geo.gridH / (tall.model.endMin - tall.model.startMin);
      return Math.round(pxPerMin * 60) + "px/小时";
    })());

  check("平板竖屏 3:4 和手机壁纸 9:19.5 都是网格",
    X.plan(week, { ratio: 3 / 4 }).mode === "grid" &&
    X.plan(week, { ratio: 9 / 19.5 }).mode === "grid");
  const wide = X.plan(week, { ratio: 4 / 3 });
  check("平板横屏 4:3 的比例同样准确",
    wide.mode === "grid" &&
    Math.abs(wide.surface.width / wide.surface.height - 4 / 3) < 0.01,
    wide.surface.width + "×" + wide.surface.height + " = " + (wide.surface.width / wide.surface.height).toFixed(4));
  check("不给比例时还是原来的自适应网格（默认行为没变）",
    X.plan(week, {}).mode === "grid" && X.plan(week, { ratio: 0 }).mode === "grid");
  check("网格能被撑高，但**拉到上限为止**（再多就留给上下留白）",
    (function () {
      const stretched = X.layout(week, { surfaceHeight: 4000 });
      const span = stretched.endMin - stretched.startMin;
      return stretched.geo.gridH === Math.round(span * X.METRICS.maxPxPerMin) &&
        stretched.height < 4000 &&
        stretched.geo.gridH > X.layout(week, {}).geo.gridH;
    })(),
    (function () {
      const stretched = X.layout(week, { surfaceHeight: 4000 });
      return "内容高 " + stretched.height + " / 画布 4000，网格高 " + stretched.geo.gridH;
    })());

  /* 手机那档：内容比画布矮一截，差值就是上下留白（用户要求"适当留白"） */
  check("手机壁纸那档有上下留白（内容高度明显小于画布高度）",
    (function () {
      const phone = X.plan(week, { ratio: 9 / 19.5 });
      const gap = phone.surface.height - phone.model.height;
      return gap > 200 && gap < phone.surface.height * 0.6;
    })(),
    (function () {
      const phone = X.plan(week, { ratio: 9 / 19.5 });
      return "画布高 " + phone.surface.height + "，内容高 " + phone.model.height +
        "，上下各留 " + Math.round((phone.surface.height - phone.model.height) / 2) + "px";
    })());
  check("手机那档每小时不超过上限（拉过头格子就空了）",
    (function () {
      const phone = X.plan(week, { ratio: 9 / 19.5 });
      const pxPerMin = phone.model.geo.gridH / (phone.model.endMin - phone.model.startMin);
      return pxPerMin <= X.METRICS.maxPxPerMin + 0.001;
    })());

  /* 地点一律要写：窄格子用简写、行数按格子高度给，地方不够先压课名 */
  check("地点一律要写：窄格子用简写，行数跟着格子高度走（最多 6 行）",
    (function () {
      const mod = fs.readFileSync(path.join(root, "js", "exportimage.js"), "utf8");
      return /PLACE_MAX_LINES = 6/.test(mod) &&
        /var placeText = narrow \? \(shortPlace \|\| place\) : place;/.test(mod) &&
        /text: placeText,/.test(mod);
    })() &&
    /* 窄格子按最长的词收字号，保证词是整的（不会被断成 Internationa / l） */
    /while \(placeSize > 8\)/.test(fs.readFileSync(path.join(root, "js", "exportimage.js"), "utf8")) &&
    (function () {
      const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
      /* 简写至少留两个词："Science Centre" 不能被削成 "Science" */
      return /function shotShortPlace\(course\)/.test(appCode) &&
        /filter\(Boolean\)\.length >= 2 \? cut : full/.test(appCode);
    })());

}

console.log("\n[56] 课表导出成图片：页面接线");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const appCode = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
  const mod = fs.readFileSync(path.join(root, "js", "exportimage.js"), "utf8");

  check("「全部课程」那张卡上有导出图片的按钮",
    /id="btnExportImage"/.test(pageHtml) &&
    pageHtml.indexOf('id="btnExportImage"') < pageHtml.indexOf('id="courseList"'));
  check("按钮文案是「导出课表图片」，而且用了主色（不再是一颗淡灰按钮）",
    /<button class="btn btn-small btn-primary" id="btnExportImage">导出课表图片<\/button>/.test(pageHtml));
  check("弹窗里有预览图 + 比例选择 + 保存 + 关闭",
    pageHtml.indexOf('id="imageBox"') > 0 && pageHtml.indexOf('id="imagePreview"') > 0 &&
    pageHtml.indexOf('id="imageRatio"') > 0 && pageHtml.indexOf('id="imageSave"') > 0 &&
    pageHtml.indexOf('id="imageClose"') > 0);
  /* 预览图和上面的"图片比例"下拉贴在一起太挤——上边距给一档 */
  check("预览图和比例下拉之间留了空隙",
    /\.image-shot\s*\{[\s\S]{0,220}?margin:\s*var\(--space-md\) 0 var\(--space-sm\)/.test(css));
  check("「分享 / 存到相册」已经按用户要求撤掉",
    pageHtml.indexOf('id="imageShare"') === -1 &&
    appCode.indexOf("imageShare") === -1 && appCode.indexOf("navigator.share") === -1);
  check("比例只剩三档壁纸（「自适应」按用户要求撤掉了），默认手机壁纸",
    !/<option value="fit"/.test(pageHtml) &&
    /<option value="phone" selected>手机壁纸 9 : 19\.5<\/option>/.test(pageHtml) &&
    /<option value="tabletPortrait">平板竖屏 3 : 4<\/option>/.test(pageHtml) &&
    /<option value="tabletLandscape">平板横屏 4 : 3<\/option>/.test(pageHtml) &&
    /var SHOT_RATIOS = \{[\s\S]{0,120}phone: 9 \/ 19\.5[\s\S]{0,120}tabletPortrait: 3 \/ 4[\s\S]{0,80}tabletLandscape: 4 \/ 3/.test(appCode) &&
    /var SHOT_RATIO_DEFAULT = "phone";/.test(appCode));
  check("脚本里每一样都绑上了（少一个就是开页面就报错）",
    ["#btnExportImage", "#imageClose", "#imageSave", "#imageRatio", "#imageBox"]
      .every((sel) => appCode.indexOf('$("' + sel + '")') > 0));
  /* iOS 上 fetch 失败只说一句 "Load failed"，信息量为零。
     现在失败后会再发一个 no-cors 探针（不受 CORS 约束），把失败分成两类。 */
  check("拉取失败时会自己分辨「网络不通」和「来源不在代理白名单」",
    /mode: "no-cors"/.test(appCode) &&
    appCode.indexOf("网络能通，但当前页面来源不在代理白名单里") > 0 &&
    appCode.indexOf("网络层面就到不了那台机器") > 0 &&
    /window\.location && window\.location\.origin/.test(appCode));
  check("绘图模块被加载进来了",
    pageHtml.indexOf('js/exportimage.js') > 0 && appCode.indexOf("OP.ExportImage.render") > 0);
  check("导出图的主色跟着页面主题走（不是写死的另一套粉）",
    /getPropertyValue\("--accent"\)/.test(appCode) && /palette: \{ accent: accentToken\(\) \}/.test(appCode));
  check("用 canvas 自己出图（toDataURL / toBlob），没引任何外部库",
    appCode.indexOf("toDataURL(\"image/png\")") > 0 && appCode.indexOf("toBlob") > 0 &&
    mod.indexOf("http") === -1 && mod.indexOf("import ") === -1);
  /* 页面上有密码框，所以"插进 HTML 的数据必须转义"这条是安全底线：
     课名、地点、楼名、OCR 文本都可能来自外部（导入的 JSON / 截图 / OSM），
     一旦能注入 <script>，那段脚本就能读到密码框里的东西。 */
  check("插进 HTML 的数据都过 esc()（课名 / 地点 / 楼名 / 搜索候选）",
    ["esc(c.name)", "esc(P.placeText(c, bld))", "esc(item.name)", "esc(it.label)",
      "esc(c.buildingName"].every(function (s) { return appCode.indexOf(s) > 0; }) &&
    !/\+\s*c\.name\s*\+/.test(appCode) && !/\+\s*item\.name\s*\+/.test(appCode));
  check("没有课程时不画空图，给提示",
    appCode.indexOf("还没有能画的课") > 0 && /if \(!built\) \{/.test(appCode));
  check("保存走 <a download>，文件名带比例后缀（导两张不会互相覆盖）",
    appCode.indexOf("link.download = name") > 0 &&
    /phone: "-手机壁纸"/.test(appCode) && /tabletPortrait: "-平板竖屏"/.test(appCode));

  /* ---------- 这一轮一起提的几件事 ---------- */
  check("「全部课程」卡上只剩新增课程 + 导出课表图片（JSON 导入导出撤掉了）",
    pageHtml.indexOf('id="btnExport"') === -1 && pageHtml.indexOf('id="btnImport"') === -1 &&
    pageHtml.indexOf('id="importFile"') === -1 &&
    appCode.indexOf('$("#btnExport")') === -1 && appCode.indexOf('$("#btnImport")') === -1 &&
    pageHtml.indexOf('id="btnAddCourse"') > 0);
  check("课程表单里能看见、也能改起止日期（导入的课以前看不到）",
    pageHtml.indexOf('id="cfStartDate"') > 0 && pageHtml.indexOf('id="cfEndDate"') > 0 &&
    /startDate: \$\("#cfStartDate"\)\.value \|\| ""/.test(appCode) &&
    /\$\("#cfStartDate"\)\.value = course \? \(course\.startDate \|\| ""\) : "";/.test(appCode));
  check("拉取预览按「周一→周五、早→晚」排（上游返回顺序是乱的）",
    /var ordered = list\.slice\(\)\.sort\(function \(a, b\) \{[\s\S]{0,260}?P\.hm\(a\.start\) - P\.hm\(b\.start\)/.test(appCode));

  /* 提示条：撤销按钮挪到右边 + 同时最多留 3 条 */
  check("提示条是「文字在左、按钮在右」的横排",
    /\.toast \{[\s\S]{0,220}?display: flex/.test(css) &&
    /\.toast-text \{ flex: 1; min-width: 0; \}/.test(css) &&
    /\.toast-action \{[\s\S]{0,260}?margin-left: auto/.test(css) &&
    /el\.innerHTML = '<div class="toast-text">/.test(appCode));
  check("同时最多 3 条提示条（多了把最老的挤掉，不然能把页面占满）",
    /var MAX_TOASTS = 3;/.test(appCode) &&
    /while \(wrap\.children\.length > MAX_TOASTS\) \{[\s\S]{0,80}?wrap\.removeChild\(wrap\.firstElementChild\)/.test(appCode));

  /* 用户点名删掉的三句说明文字 */
  check("不再写「读到了，确认一下再导入」",
    appCode.indexOf("读到了，确认一下再导入") === -1 &&
    /\$\("#pullStatus"\)\.hidden = true;/.test(appCode));
  check("跳过行数后面不再挂「（缺时间/缺代号）」",
    appCode.indexOf("缺时间/缺代号") === -1 &&
    /notes\.push\("跳过 " \+ report\.skipped \+ " 行"\)/.test(appCode));
  check("导出弹窗不再写「手机上看不清就长按图片保存到相册」",
    appCode.indexOf("长按图片保存到相册") === -1 &&
    /SHOT_RATIO_LABELS\[ratioKey\]/.test(appCode));
}

console.log("\n[57] 拉取课表卡片：接口出处署名");
{
  const pageHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const creditAt = pageHtml.indexOf('class="credit"');

  check("卡片底部有署名，且指向原作者的仓库",
    creditAt > 0 &&
    pageHtml.indexOf("https://github.com/AnsonCheng03/CUHK_Timetable_fetch", creditAt) > creditAt);
  check("署名链接新窗口打开，而且带 noopener",
    /href="https:\/\/github\.com\/AnsonCheng03\/CUHK_Timetable_fetch"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/.test(pageHtml));
  check("图标是内联 SVG（不引外部图片，静态托管断网也不裂）",
    /class="credit-ico"[\s\S]{0,240}?<path/.test(pageHtml) &&
    !/<img[^>]*credit/i.test(pageHtml));
  check("写了致谢，也点了原作者仓库的名字",
    pageHtml.indexOf("接口调用方式参考自 CUHK_Timetable_fetch") > 0 &&
    pageHtml.indexOf("感谢原作者") > 0);
  check("署名文字走 --accent-ink（不是淡灰小字，也不是对比度不够的 --accent）",
    /\.credit-link \{[\s\S]{0,220}?color: var\(--accent-ink\)/.test(css));
}

console.log("\n" + (fail === 0 ? "全部通过" : "有失败项") + "：通过 " + pass + " 项，失败 " + fail + " 项\n");
process.exit(fail === 0 ? 0 : 1);
