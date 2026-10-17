/* 代理的本地自检：把上游 fetch 换成假的，逐条验行为。
 *
 *     node worker/test.mjs
 *
 * 不开浏览器、不联网、不需要 Cloudflare 账号。tools/selftest.js 会调用它，
 * 所以这些断言跟项目其它 900 多条检查一起跑。
 */

import worker from "./timetable-proxy.js";
import bundleWorker from "./timetable-proxy.bundle.js";
import { diagnoseRows, normTime } from "./device-payload.js";

const PROXY = "https://proxy.example.workers.dev";
const ORIGIN = "https://rhythmhill.com";
const TOKEN = "s3cret-path";
const DEVICE = "watch-path";
const ENV = {
  PROXY_TOKEN: TOKEN,
  DEVICE_TOKEN: DEVICE,
  ALLOWED_ORIGINS: ORIGIN + ",http://localhost:5173",
  UPSTREAM_MODE: "soap-plain"
};

let pass = 0;
let fail = 0;

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name + (detail === undefined ? "" : "  → " + detail));
  }
}

/* ---------- 上游替身 ---------- */

let calls = [];
let upstream = function () {
  return new Response('<string xmlns="http://tempuri.org/">[]</string>', { status: 200 });
};

const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, init) {
  calls.push({ url: String(url), init: init });
  return upstream(url, init);
};

function setUpstream(fn) {
  calls = [];
  upstream = fn;
}

/* ---------- 请求替身 ---------- */

let ipSeed = 0;
function ask(path, options) {
  const opt = options || {};
  ipSeed++;
  const headers = Object.assign({
    "Origin": opt.origin === undefined ? ORIGIN : opt.origin,
    "CF-Connecting-IP": opt.ip || ("10.0.0." + ipSeed)
  }, opt.headers || {});
  return worker.fetch(new Request(PROXY + path, {
    method: opt.method || "POST",
    headers: headers,
    body: opt.body
  }), Object.assign({}, ENV, opt.env || {}));
}

const withToken = (suffix) => "/t/" + TOKEN + (suffix || "");
const withDevice = (suffix) => "/d/" + DEVICE + (suffix || "");
const XML = (json) => '<string xmlns="http://tempuri.org/">' + json + "</string>";

/* ================= 1. 来源与路径 ================= */

console.log("\n[worker] 来源、路径、方法");
{
  const pre = await ask(withToken(), { method: "OPTIONS" });
  check("预检返回 204，且只给白名单来源发 CORS 头",
    pre.status === 204 && pre.headers.get("Access-Control-Allow-Origin") === ORIGIN &&
    /POST/.test(pre.headers.get("Access-Control-Allow-Methods") || ""));

  const foreign = await ask(withToken(), { origin: "https://evil.example" });
  check("不在白名单的来源拿不到 CORS 头（浏览器读不到结果）",
    foreign.headers.get("Access-Control-Allow-Origin") === null);

  const missing = await ask("/wrong-path", { body: "{}" });
  check("路径不对返回 404（不告诉扫描器这里有个代理）",
    missing.status === 404 && (await missing.json()).error === "not_found");

  const noToken = await ask("/timetable", { body: "{}", env: { PROXY_TOKEN: "" } });
  check("没配口令时退回 /timetable，配了口令就只认带口令的路径",
    noToken.status === 400 && (await noToken.json()).error === "missing_credentials");

  const got = await ask(withToken(), { method: "GET" });
  const gotBody = await got.json();
  check("GET 回部署版本信息（用来确认线上是不是新代码）",
    got.status === 200 && gotBody.deviceRoute === true && gotBody.build === "2026-10-17");

  const put = await ask(withToken(), { method: "PUT" });
  check("POST 以外的方法（PUT）仍然 405", put.status === 405);

  const badBody = await ask(withToken(), { body: "not json" });
  check("请求体不是 JSON 返回 400", badBody.status === 400 && (await badBody.json()).error === "bad_json");

  const noCreds = await ask(withToken(), { body: JSON.stringify({ sid: "1155000000" }) });
  check("缺密码返回 400", noCreds.status === 400 && (await noCreds.json()).error === "missing_credentials");

  const big = await ask(withToken(), { body: JSON.stringify({ sid: "1", pwd: "x".repeat(2000) }) });
  check("请求体超过 1KB 返回 413（不给别人当上传口）",
    big.status === 413 && (await big.json()).error === "body_too_large");
}

/* ================= 2. 转发与解析 ================= */

console.log("\n[worker] 转发与解析");
{
  setUpstream(() => new Response(XML('[{"SUBJECT":"BMEG","CATALOG_NBR":"2210","FDESCR":"Science Centre L3","LAT":"22.42","LNG":"114.21"}]'), { status: 200 }));
  const res = await ask(withToken(), { body: JSON.stringify({ sid: "1155000000", pwd: "pw" }) });
  const data = await res.json();
  check("XML 里的 JSON 被抠出来原样返回",
    res.status === 200 && data.ok === true && data.count === 1 &&
    data.courses[0].SUBJECT === "BMEG" && data.courses[0].FDESCR === "Science Centre L3");
  check("响应里不带密码/学号", JSON.stringify(data).indexOf("pw") === -1);
  check("响应不许被缓存（课表是个人信息）",
    (res.headers.get("Cache-Control") || "").indexOf("no-store") >= 0);
  check("发出去的确实是官方 App 那套 SOAP 信封",
    calls.length === 1 && calls[0].url === "https://campusapps.itsc.cuhk.edu.hk/store/CLASSSCHD/STT.asmx" &&
    calls[0].init.headers["Content-Type"].indexOf("text/xml") === 0 &&
    calls[0].init.body.indexOf("<GetTimeTable") >= 0 &&
    calls[0].init.body.indexOf("hk.edu.cuhk.ClassTT") >= 0 &&
    calls[0].init.headers["User-Agent"].indexOf("ClassTT/") === 0);

  setUpstream(() => new Response(XML("[]"), { status: 200 }));
  const empty = await ask(withToken(), { body: JSON.stringify({ sid: "1155000000", pwd: "pw" }) });
  const emptyData = await empty.json();
  check("空表返回 ok:true 且 count:0（密码错和没选课上游给的是一样的，不能瞎猜）",
    empty.status === 200 && emptyData.ok === true && emptyData.count === 0);

  /* 走 SOAP 时的外壳是 <GetTimeTableResult>，跟 form 那条的 <string> 不是一回事。
     只认 <string> 会把 SOAP 的结果当成解析失败（本机联调时真踩了）。 */
  setUpstream(() => new Response(
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    '<soap:Body><GetTimeTableResponse xmlns="http://tempuri.org/">' +
    "<GetTimeTableResult>[{\"SUBJECT\":\"ENGG\",\"CATALOG_NBR\":\"1110\"}]</GetTimeTableResult>" +
    "</GetTimeTableResponse></soap:Body></soap:Envelope>", { status: 200 }));
  const soapRes = await ask(withToken(), { body: JSON.stringify({ sid: "1", pwd: "pw" }) });
  const soapData = await soapRes.json();
  check("SOAP 外壳（GetTimeTableResult）也能解出来",
    soapRes.status === 200 && soapData.ok === true && soapData.courses[0].SUBJECT === "ENGG");

  setUpstream(() => new Response(
    '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
    "<soap:Body><soap:Fault><faultstring>Server was unable to process request.</faultstring>" +
    "</soap:Fault></soap:Body></soap:Envelope>", { status: 200 }));
  const fault = await ask(withToken(), { body: JSON.stringify({ sid: "1", pwd: "pw" }) });
  const faultData = await fault.json();
  check("SOAP Fault 当成解析失败，并把 faultstring 带回去好排查",
    fault.status === 502 && faultData.error === "upstream_unparseable" &&
    faultData.sample.indexOf("unable to process request") >= 0);

  setUpstream(() => new Response(XML('[{"DESCR":"Tom &amp; Jerry &lt;Lab&gt;"}]'), { status: 200 }));
  const escaped = await ask(withToken(), { body: JSON.stringify({ sid: "1", pwd: "pw" }) });
  check("XML 实体还原正确（&amp; &lt; 不会被解错）",
    (await escaped.json()).courses[0].DESCR === "Tom & Jerry <Lab>");

  setUpstream(() => new Response("<html><body>Service Unavailable</body></html>", { status: 200 }));
  const broken = await ask(withToken(), { body: JSON.stringify({ sid: "1", pwd: "pw" }) });
  const brokenData = await broken.json();
  check("上游回 HTML 错误页时返回 502 并带一小段原文好排查",
    broken.status === 502 && brokenData.error === "upstream_unparseable" &&
    brokenData.sample.indexOf("Service Unavailable") >= 0);

  setUpstream(() => new Response("boom", { status: 500 }));
  const down = await ask(withToken(), { body: JSON.stringify({ sid: "1", pwd: "pw" }) });
  check("上游 500 映射成 502 upstream_status",
    down.status === 502 && (await down.json()).error === "upstream_status");

  setUpstream(() => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
  const timeout = await ask(withToken(), { body: JSON.stringify({ sid: "1", pwd: "pw" }) });
  check("上游超时/连不上分别映射成 504（而且只发一次，不偷偷重试）",
    timeout.status === 504 && (await timeout.json()).error === "upstream_timeout");
}

/* ================= 3. 两种写法 ================= */

console.log("\n[worker] 明文 / 加密 / form 三种写法");
{
  const secret = "MyPassword123";

  setUpstream(() => new Response(XML("[]"), { status: 200 }));
  await ask(withToken(), { body: JSON.stringify({ sid: "1155000000", pwd: secret, mode: "soap-aes" }) });
  const aes = calls[0];
  check("soap-aes：发出去的报文里没有明文密码，asP2 是 base64",
    aes.init.body.indexOf(secret) === -1 &&
    /<asP2>[A-Za-z0-9+/=]+<\/asP2>/.test(aes.init.body));

  setUpstream(() => new Response(XML("[]"), { status: 200 }));
  const formRes = await ask(withToken(), { body: JSON.stringify({ sid: "1155000000", pwd: secret, mode: "form-plain" }) });
  const form = calls[0];
  check("form-plain：打到 /GetTimeTable，用 form-urlencoded",
    form.url.endsWith("/STT.asmx/GetTimeTable") &&
    form.init.headers["Content-Type"].indexOf("application/x-www-form-urlencoded") === 0 &&
    form.init.body.indexOf("asP3=hk.edu.cuhk.ClassTT") >= 0 &&
    (await formRes.json()).mode === "form-plain");

  const unknown = await ask(withToken(), { body: JSON.stringify({ sid: "1", pwd: "pw", mode: "nope" }) });
  check("不认识的 mode 返回 400", unknown.status === 400 && (await unknown.json()).error === "unknown_mode");
}

/* ================= 4. 日志与限流 ================= */

console.log("\n[worker] 日志与限流");
{
  const logged = [];
  const realLog = console.log;
  /* 只在"发请求"这一小段里换掉 console.log，不然 check() 自己的输出
     也会被记进去，把断言搅乱（第一次写就踩了） */
  const spy = async function (run) {
    logged.length = 0;
    console.log = (...args) => { logged.push(args.join(" ")); };
    try {
      await run();
    } finally {
      console.log = realLog;
    }
  };

  setUpstream(() => new Response(XML("[]"), { status: 200 }));
  await spy(() => ask(withToken(), { body: JSON.stringify({ sid: "1155000000", pwd: "TopSecret" }) }));
  check("默认不写任何日志（连状态码都不写）", logged.length === 0);

  setUpstream(() => new Response(XML("[]"), { status: 200 }));
  await spy(() => ask(withToken(), {
    body: JSON.stringify({ sid: "1155000000", pwd: "TopSecret" }), env: { DEBUG: "1" }
  }));
  check("开 DEBUG 也只写状态码和耗时，绝不写密码/学号",
    logged.length === 1 && logged[0].indexOf("TopSecret") === -1 && logged[0].indexOf("1155000000") === -1);

  /* 同一个 IP 连点：第 6 次之后就该被挡住 */
  const ip = "203.0.113.9";
  setUpstream(() => new Response(XML("[]"), { status: 200 }));
  const codes = [];
  for (let i = 0; i < 7; i++) {
    const r = await ask(withToken(), { ip: ip, body: JSON.stringify({ sid: "1", pwd: "pw" }) });
    codes.push(r.status);
  }
  check("同一个 IP 一分钟内点到第 7 次会被限流（429）",
    codes.slice(0, 6).every((c) => c === 200) && codes[6] === 429,
    codes.join(","));
}

/* ================= 4. 墨水屏手表那条入口 ================= */

console.log("\n[worker] 手表入口 /d/<口令>：小、准、不泄密");
{
  /* 上游一行真实数据的形状（字段名照抄 worker/README.md 里那份清单）。
     固定成「周一 + 周三」上课，起止 2026-09-07 – 2026-12-04。
     用来当锚点的几天：10-12 周一、10-13 周二（不上）、12-09 周三（已过 END_DT）。 */
  const row = (over) => Object.assign({
    SUBJECT: "BMEG", CATALOG_NBR: "2210", DESCR: "Biomedical Engineering",
    COMDESC: "Lecture", FDESCR: "Science Centre L3",
    START_DT: "20260907", END_DT: "20261204",
    MEETING_TIME_START: "09:30", MEETING_TIME_END: "10:15",
    INSTRUCTORS: "CHAN TAI MAN",
    MON: "Y", TUES: "N", WED: "Y", THURS: "N", FRI: "N", SAT: "N", SUN: "N"
  }, over);

  const serveRows = (rows) => setUpstream(() => new Response(XML(JSON.stringify(rows)), { status: 200 }));
  const askWatch = (body, options) =>
    ask(withDevice(), Object.assign({ body: JSON.stringify(body) }, options || {}));
  const watchAt = async (now, rows) => {
    serveRows(rows === undefined ? [row({})] : rows);
    const res = await askWatch({ sid: "1155000000", pwd: "pw", now: now });
    return await res.json();
  };

  const offEntry = await askWatch({ sid: "1", pwd: "pw" }, { env: { DEVICE_TOKEN: "" } });
  check("没配 DEVICE_TOKEN 时这条入口就当不存在（404）",
    offEntry.status === 404 && (await offEntry.json()).error === "not_found");

  const wrongEntry = await ask("/d/nope", { body: JSON.stringify({ sid: "1", pwd: "pw" }) });
  check("手表口令不对同样是 404", wrongEntry.status === 404);

  const gotEntry = await ask(withDevice(), { method: "GET" });
  const gotEntryBody = await gotEntry.json();
  check("手表入口用 GET 也能自查（会告诉你 DEVICE_TOKEN 配了没有）",
    gotEntry.status === 200 && gotEntryBody.hasDeviceToken === true);

  const noCredsEntry = await askWatch({ sid: "1155000000" });
  check("手表入口缺密码也返回 400",
    noCredsEntry.status === 400 && (await noCredsEntry.json()).error === "missing_credentials");

  const before = await watchAt("2026-10-12T09:00:00+08:00");
  check("周一 09:00 请求：09:30 那节就是 next，还差 30 分钟",
    before.ok === true && before.mode === "soap-plain" && before.day === "Mon" &&
    before.next && before.next.code === "BMEG2210" && before.next.start === "0930" &&
    before.next.startsInMinutes === 30 && before.next.inProgress === false);

  const during = await watchAt("2026-10-12T10:00:00+08:00");
  check("正在上的那节仍指向它，并标成 inProgress（而不是跳过它）",
    during.next && during.next.code === "BMEG2210" &&
    during.next.inProgress === true && during.next.startsInMinutes === -30);

  const tuesday = await watchAt("2026-10-13T09:00:00+08:00");
  check("星期开关说了算：周二不上，next 落到周三那节",
    tuesday.days[0].classes.length === 0 &&
    tuesday.next && tuesday.next.day === "Wed" && tuesday.next.dayOffset === 1);

  const expired = await watchAt("2026-12-09T09:00:00+08:00");
  check("过了 END_DT 那天排不出课：当天为空、next 为 null",
    expired.days[0].classes.length === 0 && expired.next === null);

  const loose = await watchAt("2026-10-12T09:00:00+08:00",
    [row({ START_DT: "2026-09-07", END_DT: "2026-12-04", MEETING_TIME_START: "9:30 AM", MEETING_TIME_END: "1015" })]);
  check("八位日期 / 带分隔符日期、`9:30 AM` / `1015` 两种时间写法都认",
    loose.next && loose.next.start === "0930" && loose.next.end === "1015");

  const broken = await watchAt("2026-10-12T09:00:00+08:00", [row({ START_DT: "20261301", END_DT: "" })]);
  check("日期不合法（13 月）就当没写，课仍按星期开关出现",
    broken.next !== null && broken.next.code === "BMEG2210");

  const dup = await watchAt("2026-10-12T09:00:00+08:00", [row({}), row({})]);
  check("同一门课重复的行只出现一次", dup.count === 1 && dup.days[0].classes.length === 1);

  /* 用户报的那个 bug：同一节的多条日期范围不同，以前只留第一条，
     后半学期整段消失。正确做法是合并日期范围。 */
  const splitRange = await watchAt("2026-10-17T09:00:00+08:00", [
    row({ START_DT: "20260907", END_DT: "20261016" }),
    row({ START_DT: "20261019", END_DT: "20261204" })
  ]);
  const nextMonday = splitRange.days.find((day) => day.date === "20261019");
  check("同一节、两段日期范围：后半学期那节不会被当成重复丢掉",
    splitRange.count === 1 && nextMonday &&
    nextMonday.classes.filter((item) => item.code === "BMEG2210").length === 1);

  const overlapping = await watchAt("2026-10-17T09:00:00+08:00", [
    row({ START_DT: "20260907", END_DT: "20261030" }),
    row({ START_DT: "20261019", END_DT: "20261204" })
  ]);
  const overlapMonday = overlapping.days.find((day) => day.date === "20261019");
  check("两段日期范围有重叠时，同一天也只出现一条（不会重复）",
    overlapMonday && overlapMonday.classes.filter((item) => item.code === "BMEG2210").length === 1);

  const sorted = await watchAt("2026-10-12T07:00:00+08:00", [
    row({ MEETING_TIME_START: "14:30", MEETING_TIME_END: "15:15" }),
    row({ MEETING_TIME_START: "09:30", MEETING_TIME_END: "10:15" }),
    row({ MEETING_TIME_START: "11:30", MEETING_TIME_END: "12:15" })
  ]);
  check("一天里按上课时间排好序",
    sorted.days[0].classes.map((c) => c.start).join(",") === "0930,1130,1430");

  const split = await watchAt("2026-10-12T07:00:00+08:00", [
    row({}),
    row({ SUBJECT: "ELEC", CATALOG_NBR: "1100", FDESCR: "Foo Building 7",
      MEETING_TIME_START: "11:00", MEETING_TIME_END: "11:45" })
  ]);
  check("地名里的教室号切出来单独放；楼名本身以数字结尾就不拆",
    split.days[0].classes[0].building === "Science Centre" && split.days[0].classes[0].room === "L3" &&
    split.days[0].classes[1].building === "Foo Building 7" && split.days[0].classes[1].room === "");

  const none = await watchAt("2026-10-12T09:00:00+08:00", []);
  check("这学期没课：ok 仍是 true，用 empty 标出来，next 为 null",
    none.ok === true && none.empty === true && none.next === null);

  /* 屏上那套字库只有 ASCII 32–126，多一个字节就会画成问号 */
  const long = await watchAt("2026-10-12T09:00:00+08:00", [row({
    DESCR: "Advanced Biomedical Engineering Seminar Series 2026",
    FDESCR: "Ho Sin Hang Engineering Building 303"
  })]);
  const longText = JSON.stringify(long);
  check("截断长课名用的是 ASCII 的两个点，不是中文省略号",
    long.next.title.indexOf("\u2026") === -1 && /\.\.$/.test(long.next.title) &&
    longText.indexOf("\u2026") === -1);

  /* 七天 × 每天八节、标题地点都写满，逼它把体积裁下来 */
  const flags = ["MON", "TUES", "WED", "THURS", "FRI", "SAT", "SUN"];
  const fat = [];
  flags.forEach(function (flag) {
    const day = {};
    flags.forEach(function (name) { day[name] = name === flag ? "Y" : "N"; });
    for (let i = 0; i < 8; i++) {
      fat.push(row(Object.assign({
        SUBJECT: "ABCD", CATALOG_NBR: "10" + i,
        DESCR: "Biomedical Engineering Seminar Series " + i,
        FDESCR: "Yasumoto International Academic Park L" + i,
        MEETING_TIME_START: (8 + i) + ":00", MEETING_TIME_END: (8 + i) + ":50"
      }, day)));
    }
  });
  serveRows(fat);
  const fatRes = await askWatch({ sid: "1155000000", pwd: "pw", now: "2026-10-12T07:00:00+08:00" });
  const fatText = await fatRes.text();
  check("七天塞满也只回一包小数据（不超过 4096 字节）",
    new TextEncoder().encode(fatText).length <= 4096 && JSON.parse(fatText).days.length >= 1);

  /* 密码/学号不能出现在给手表的那包里，DEBUG 日志里也不能有 */
  const realLog = console.log;
  const logged = [];
  let leaked;
  try {
    console.log = (...args) => { logged.push(args.join(" ")); };
    serveRows([row({})]);
    const secret = await askWatch(
      { sid: "1155000000", pwd: "TopSecret", now: "2026-10-12T09:00:00+08:00" },
      { env: { DEBUG: "1" } });
    const secretText = await secret.text();
    leaked = secretText.indexOf("TopSecret") >= 0 || secretText.indexOf("1155000000") >= 0 ||
      logged.some((line) => line.indexOf("TopSecret") >= 0 || line.indexOf("1155000000") >= 0);
  } finally {
    console.log = realLog;
  }
  check("手表拿到的这包里没有学号密码，DEBUG 日志里也没有", leaked === false);

  /* 控制台只能贴一个文件，所以还有一份机械拼出来的单文件版 */
  serveRows([row({})]);
  const bundled = await bundleWorker.fetch(new Request(PROXY + withDevice(), {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "10.9.9.9" },
    body: JSON.stringify({ sid: "1155000000", pwd: "pw", now: "2026-10-12T09:00:00+08:00" })
  }), ENV);
  const bundledData = await bundled.json();
  check("控制台粘贴用的单文件版能跑通同一条手表入口",
    bundled.status === 200 && bundledData.next && bundledData.next.code === "BMEG2210");
}

/* ---------- 收尾 ---------- */

/* ================= 5. 解析层的宽容度与诊断 ================= */

console.log("\n[worker] 解析层的宽容度与诊断");
{
  const row = (over) => Object.assign({
    SUBJECT: "BMEG", CATALOG_NBR: "2210", DESCR: "Biomedical Engineering",
    COMDESC: "Lecture", FDESCR: "Science Centre L3",
    START_DT: "20260907", END_DT: "20261204",
    MEETING_TIME_START: "14:30", MEETING_TIME_END: "15:15",
    MON: "N", TUES: "N", WED: "N", THURS: "Y", FRI: "N", SAT: "N", SUN: "N"
  }, over);
  const at = Date.parse("2026-10-17T09:00:00+08:00");   /* 周六 */

  check("带秒的时间（14:30:00）能认成 1430",
    normTime("14:30:00") === "1430" && normTime("9:05:00 AM") === "0905");

  const past = diagnoseRows([row({ STRM: "2520", START_DT: "20260105", END_DT: "20260430" })], at, {});
  check("上学期的周四课被排除，诊断里写明是日期范围",
    past.result[0].ok === false && /日期范围/.test(past.result[0].reason));

  const textual = diagnoseRows([row({
    MON: "N", THURS: "N", MEETING_DAY: "THU"
  })], at, {});
  check("七列开关都没勾、只给 MEETING_DAY 文本时也能认出周四",
    textual.result[0].ok === true && textual.result[0].weekdays[0] === 4 &&
    textual.result[0].hits[0] === "20261022");

  const broken = diagnoseRows([row({ MEETING_TIME_START: "" })], at, {});
  check("没有上课时间的行会被单独指出（不是悄悄消失）",
    broken.result[0].ok === false && /没有上课时间/.test(broken.result[0].reason));

  const splitDiag = diagnoseRows([
    row({ START_DT: "20260907", END_DT: "20261016" }),
    row({ START_DT: "20261019", END_DT: "20261204" })
  ], at, {});
  check("诊断里两段日期范围都算「进得去」，并注明是合并处理",
    splitDiag.result[0].ok === true && splitDiag.result[1].ok === true &&
    /合并/.test(splitDiag.result[1].note));
}

globalThis.fetch = realFetch;
console.log("\n" + (fail === 0 ? "worker 全部通过" : "worker 有失败项") + "：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
