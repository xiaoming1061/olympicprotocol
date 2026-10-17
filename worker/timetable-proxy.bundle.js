/* 自动生成，别手改 —— node worker/make-bundle.mjs 重新生成
 *
 * 来源：worker/timetable-proxy.js + worker/device-payload.js
 * 用途：Cloudflare 控制台只能贴一个文件时，贴这一份。
 *      用 wrangler 部署的话直接用源文件，它会自己打包。
 */

/* CUHK 课表代理（Cloudflare Worker）
 *
 * 为什么需要它：浏览器直接调 campusapps.itsc.cuhk.edu.hk 那个 SOAP 接口
 * 过不了 CORS（预检和响应都没有 Access-Control-Allow-Origin），
 * 而且网页 JS 不允许设 User-Agent。所以中间放这一层。
 *
 * 上游是什么（都已实测确认）：
 *   POST https://campusapps.itsc.cuhk.edu.hk/store/CLASSSCHD/STT.asmx
 *   方法 GetTimeTable(asP1=学号, asP2=密码, asP3=客户端标识)
 *   → 返回 <string xmlns="http://tempuri.org/">一段 JSON 数组</string>
 *   这是港中大官方 App「Student Class Timetable」（bundle id hk.edu.cuhk.ClassTT）
 *   的私有后端，没有公开文档；参数含义是社区逆向出来的。
 *
 * 这个 worker 只做四件事：校验来源 → 转发一次 → 把 XML 里的 JSON 抠出来 → 原样返回。
 * 它**不写日志、不落盘、不缓存**，密码只在这一次请求的内存里待着。
 *
 * 环境变量（见 wrangler.toml / 控制台 Variables）：
 *   PROXY_TOKEN     访问口令，URL 形如 /t/<口令>；不设的话只认 /timetable
 *   DEVICE_TOKEN    给墨水屏手表用的口令，URL 形如 /d/<口令>；不设的话这条入口就当不存在
 *   ALLOWED_ORIGINS 允许的网页来源，逗号分隔
 *   UPSTREAM_MODE   默认 soap-plain，见下面 MODES
 *   DEBUG           设成 "1" 才往日志里写状态码/耗时（永远不写请求体）
 *   ALLOW_EMPTY_CREDENTIALS
 *                   设成 "1" 才允许空学号/空密码。只用来确认"管道通不通"
 *                   （空凭据本来就登不进去，放开它没有风险），平时别开。
 */

/* 手表要的数据只有「今天/接下来」，映射规则单独一个文件，纯函数、可单测 */

/* ---------- 常量 ---------- */

const UPSTREAM = "https://campusapps.itsc.cuhk.edu.hk/store/CLASSSCHD/STT.asmx";
const APP_ID = "hk.edu.cuhk.ClassTT";
const APP_UA = "ClassTT/2.4 CFNetwork/1333.0.4 Darwin/21.5.0";

/* 官方 App 用来加密学号/密码的 AES-256-CBC 钥匙和 IV。
   来源：公开的逆向项目 AnsonCheng03/CUHK_Timetable_fetch。
   上游两种写法都收：明文，或者 base64(AES-CBC(字面量))。 */
const AES_KEY = "e3ded030ce294235047550b8f69f5a28";
const AES_IV = "e0b2ea987a832e24";

/* 上游一次要串好几个校园系统，慢的时候十几秒；超过就放弃，不再重试 */
const UPSTREAM_TIMEOUT_MS = 20000;

/* 学号 + 密码远用不到 1KB，写死上限免得有人拿它当文件上传口 */
const MAX_BODY_BYTES = 1024;

const DEFAULT_ORIGINS = "https://rhythmhill.com,http://localhost:5173,http://127.0.0.1:5173";
/* 2026-10 实测：四种写法都能连通，但**明文那两种读回来是空的**，
   只有加密的两种能读到课（跟逆向项目后来改成加密也是对上的）。
   所以默认换成 soap-aes；页面会显式带 mode，不依赖这里的默认值。 */
const DEFAULT_MODE = "soap-aes";

/* 四种种发，一次请求只用一种（**不自动重试**：密码错的情况下
   连发几次等于连错几次，会把学校账号试到锁定）。
   默认用官方 App 走的那种，其它三种留给第一次联调时手动比。 */
const MODES = {
  "soap-plain": { transport: "soap", encrypted: false },
  "soap-aes": { transport: "soap", encrypted: true },
  "form-plain": { transport: "form", encrypted: false },
  "form-aes": { transport: "form", encrypted: true }
};

/* 免费版 Workers 没有 KV / Durable Objects，限流只能按"单个 isolate 的内存"做，
   也就是尽力而为：换个机房、冷启动之后计数就归零了。
   真正的保护是"地址不公开 + 口令在 URL 里"，以及控制台里那条 Rate limiting 规则。 */
const RATE_WINDOW_MS = 60 * 1000;
const RATE_PER_IP = 6;        // 每个 IP 每分钟
const RATE_GLOBAL = 60;       // 单个 isolate 每分钟总量

/* ---------- 小工具 ---------- */

function json(data, status, headers) {
  const body = JSON.stringify(data);
  return new Response(body, {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      /* 课表是个人信息，不让浏览器和 Cloudflare 边缘留副本 */
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }, headers || {})
  });
}

function allowedOrigins(env) {
  return String((env && env.ALLOWED_ORIGINS) || DEFAULT_ORIGINS)
    .split(",")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

/* 只给白名单里的来源发 CORS 头；其它来源照样能发请求，
   但浏览器拿不到响应内容（等于白跑一趟）。 */
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const list = allowedOrigins(env);
  const headers = { "Vary": "Origin" };
  if (origin && list.indexOf(origin) >= 0) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

/* URL 里那段口令对不对。不设 PROXY_TOKEN 时退回 /timetable。 */
function pathAllowed(url, env) {
  const token = env && env.PROXY_TOKEN;
  if (token) return url.pathname === "/t/" + token;
  return url.pathname === "/timetable";
}

/* 手表那条入口：口令单独配（DEVICE_TOKEN），跟网页那条互不影响。
   没配就整条入口不存在——手表地址是写死在固件里的，多一条暴露面不如少一条。 */
function devicePathAllowed(url, env) {
  const token = env && env.DEVICE_TOKEN;
  if (!token) return false;
  return url.pathname === "/d/" + token;
}

function clientIp(request) {
  return request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    "unknown";
}

const rateBuckets = new Map();

function rateAllow(ip) {
  const now = Date.now();
  if (rateBuckets.size > 2000) rateBuckets.clear();   // 别让这张表无限长大

  const ipKey = "ip:" + ip;
  const hit = rateBuckets.get(ipKey);
  if (!hit || now > hit.resetAt) rateBuckets.set(ipKey, { count: 1, resetAt: now + RATE_WINDOW_MS });
  else if (hit.count >= RATE_PER_IP) return false;
  else hit.count++;

  const globalKey = "all";
  const all = rateBuckets.get(globalKey);
  if (!all || now > all.resetAt) rateBuckets.set(globalKey, { count: 1, resetAt: now + RATE_WINDOW_MS });
  else if (all.count >= RATE_GLOBAL) return false;
  else all.count++;

  return true;
}

function toBase64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

/* AES-256-CBC + PKCS#7（WebCrypto 默认就是 PKCS#7，和 PHP 的 openssl_encrypt 一致），
   再 base64——和官方 App 那套一模一样。 */
async function encryptValue(plain) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(AES_KEY), { name: "AES-CBC" }, false, ["encrypt"]);
  const buf = await crypto.subtle.encrypt({ name: "AES-CBC", iv: enc.encode(AES_IV) }, key, enc.encode(plain));
  return toBase64(new Uint8Array(buf));
}

function unescapeXml(text) {
  /* &amp; 放最后：不然 "&amp;lt;" 会被解成 "<" */
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * 上游用 XML 包着一段 JSON，两种绑定的外壳不一样（都实测过）：
 *
 *   走 SOAP（官方 App 那条）：
 *     <soap:Envelope><soap:Body><GetTimeTableResponse>
 *       <GetTimeTableResult>[{...}]</GetTimeTableResult>
 *     </GetTimeTableResponse></soap:Body></soap:Envelope>
 *
 *   走 HTTP POST（/STT.asmx/GetTimeTable）：
 *     <string xmlns="http://tempuri.org/">[{...}]</string>
 *
 * 只认 <string> 的话 SOAP 那条会被当成"解析失败"——本机联调时就是这么发现的。
 */
function unwrapPayload(xmlText) {
  const raw = String(xmlText || "");

  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(raw);
  if (cdata) return cdata[1].trim();

  /* 从最里面那层往外试。**不能**写成"三个标签名任选"，那样会从
     <GetTimeTableResponse> 开始匹配、到 </GetTimeTableResult> 结束，
     把里面那层开标签一起吃进去（第一版就是这么错的）。 */
  for (const tag of ["GetTimeTableResult", "string"]) {
    const hit = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i").exec(raw);
    if (hit && hit[1].trim()) return unescapeXml(hit[1]).trim();
  }

  /* 兜底：把标签全摘掉剩下的就是那个字符串 */
  return unescapeXml(raw.replace(/<[^>]*>/g, " ")).trim();
}

function extractJson(xmlText) {
  const text = unwrapPayload(xmlText);
  if (!text) return [];
  return JSON.parse(text);
}

function soapBody(sid, pwd) {
  return "<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
    "<soap:Envelope xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"" +
    " xmlns:xsd=\"http://www.w3.org/2001/XMLSchema\"" +
    " xmlns:soap=\"http://schemas.xmlsoap.org/soap/envelope/\">" +
    "<soap:Body><GetTimeTable xmlns=\"http://tempuri.org/\">" +
    "<asP1>" + sid + "</asP1><asP2>" + pwd + "</asP2><asP3>" + APP_ID + "</asP3>" +
    "</GetTimeTable></soap:Body></soap:Envelope>";
}

function formBody(sid, pwd) {
  return "asP1=" + encodeURIComponent(sid) +
    "&asP2=" + encodeURIComponent(pwd) +
    "&asP3=" + encodeURIComponent(APP_ID);
}

/* 有些平台会拦自定义 User-Agent（设置直接抛错），所以带 UA 失败就再来一次不带 UA 的 */
async function postUpstream(url, headers, body, signal) {
  try {
    return await fetch(url, { method: "POST", headers: headers, body: body, signal: signal });
  } catch (err) {
    const bare = Object.assign({}, headers);
    delete bare["User-Agent"];
    return await fetch(url, { method: "POST", headers: bare, body: body, signal: signal });
  }
}

async function callUpstream(modeName, sid, pwd) {
  const mode = MODES[modeName] || MODES[DEFAULT_MODE];
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, UPSTREAM_TIMEOUT_MS);

  const a = mode.encrypted ? await encryptValue(sid) : sid;
  const b = mode.encrypted ? await encryptValue(pwd) : pwd;

  const isSoap = mode.transport === "soap";
  const url = isSoap ? UPSTREAM : UPSTREAM + "/GetTimeTable";
  const headers = {
    "User-Agent": APP_UA,
    "Content-Type": isSoap ? "text/xml; charset=utf-8" : "application/x-www-form-urlencoded"
  };
  const body = isSoap ? soapBody(a, b) : formBody(a, b);

  try {
    const res = await postUpstream(url, headers, body, controller.signal);
    const text = await res.text();
    return { status: res.status, text: text };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 入口 ---------- */

/**
 * 手表那条入口的响应：上游给的是一行行「上课安排」（28 个字段），
 * 这里压成很小的一包「今天 / 接下来」，字段都短、都好解析。
 *
 * `now` 只在联调和自检时传，用来把"现在"钉死，不然断言会随真实时间飘。
 */
function deviceResponse(rows, payload, modeName) {
  const asked = payload && payload.now ? Date.parse(payload.now) : NaN;
  const data = buildDevicePayload(
    rows,
    Number.isFinite(asked) ? asked : Date.now(),
    { days: payload && payload.days, perDay: payload && payload.perDay }
  );
  data.mode = modeName;
  return data;
}

export default {
  async fetch(request, env) {
    const started = Date.now();
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    const debug = env && env.DEBUG === "1";

    const done = function (data, status) {
      if (debug) {
        /* 只写状态码和耗时：路径里有口令、请求体里有密码，都不能进日志 */
        console.log(JSON.stringify({ status: status, ms: Date.now() - started, mode: data && data.mode }));
      }
      return json(data, status, cors);
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    /* 两条入口：/d/<口令> 给墨水屏手表，其余按原来那套（网页用） */
    const isDevice = devicePathAllowed(url, env);

    /* 路径不对就装作没有这个服务，别告诉扫描器"这里有个代理" */
    if (!isDevice && !pathAllowed(url, env)) return done({ ok: false, error: "not_found" }, 404);

    /* GET 只用来回答"线上跑的是哪一版"，方便部署后自查。
       这条路也是先过了口令校验才走到这里的，不会给扫描器透露什么。
       旧版代码没有这一段（会对 GET 回 405），所以它正好能区分新旧。 */
    if (request.method === "GET") {
      return done({
        ok: true,
        service: "cuhk-timetable-proxy",
        build: "2026-10-17",
        deviceRoute: true,
        hasDeviceToken: !!(env && env.DEVICE_TOKEN)
      }, 200);
    }

    if (request.method !== "POST") return done({ ok: false, error: "method_not_allowed" }, 405);

    if (!rateAllow(clientIp(request))) {
      return done({ ok: false, error: "too_many_requests" }, 429);
    }

    const declared = Number(request.headers.get("Content-Length") || 0);
    if (declared > MAX_BODY_BYTES) return done({ ok: false, error: "body_too_large" }, 413);

    let raw = "";
    try {
      raw = await request.text();
    } catch (err) {
      return done({ ok: false, error: "body_unreadable" }, 400);
    }
    if (raw.length > MAX_BODY_BYTES) return done({ ok: false, error: "body_too_large" }, 413);

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      return done({ ok: false, error: "bad_json" }, 400);
    }

    const sid = String((payload && payload.sid) || "").trim();
    const pwd = String((payload && payload.pwd) || "");
    const allowEmpty = env && env.ALLOW_EMPTY_CREDENTIALS === "1";
    if ((!sid || !pwd) && !allowEmpty) return done({ ok: false, error: "missing_credentials" }, 400);

    const modeName = (payload && payload.mode) || (env && env.UPSTREAM_MODE) || DEFAULT_MODE;
    if (!MODES[modeName]) return done({ ok: false, error: "unknown_mode" }, 400);

    let upstream;
    try {
      upstream = await callUpstream(modeName, sid, pwd);
    } catch (err) {
      const aborted = err && (err.name === "AbortError" || String(err).indexOf("abort") >= 0);
      return done({ ok: false, error: aborted ? "upstream_timeout" : "upstream_unreachable" }, 504);
    }

    if (upstream.status !== 200) {
      return done({ ok: false, error: "upstream_status", status: upstream.status }, 502);
    }

    let courses;
    try {
      courses = extractJson(upstream.text);
    } catch (err) {
      /* 上游偶尔会回一页 HTML 错误页。把开头一小段带回去好排查——
         这些内容本来就是这位用户自己的数据，不涉及别人 */
      return done({
        ok: false,
        error: "upstream_unparseable",
        sample: unwrapPayload(upstream.text).slice(0, 200)
      }, 502);
    }

    if (!Array.isArray(courses)) courses = [];

    if (isDevice) return done(deviceResponse(courses, payload, modeName), 200);

    return done({
      ok: true,
      mode: modeName,
      count: courses.length,
      courses: courses
    }, 200);
  }
};

/* ---------- 设备载荷（原 worker/device-payload.js） ---------- */

/* 设备载荷：把学校那 28 个字段的行，压成墨水屏手表要显示的那点东西
 *
 * 为什么单独一层：网页那边（js/timetable.js）把行映射成课程结构，是为了
 * 排课表、算路线、做播报；手表只要「今天上什么、下一节几点、在哪栋楼」。
 * 两者的取舍不一样——手表每多带一个字节，就要多花一点电、多占一点内存，
 * 所以这里单独做一份「尽量小」的映射，并且能脱离网络、用假数据逐条验。
 *
 * 这个文件是纯函数，不碰 fetch、不碰 Request/Response，所以浏览器、Worker、
 * 本地 Node 都能跑，也方便 worker/test.mjs 直接喂数据进来。
 *
 * 上游字段名一律不信任（大小写、下划线、空格、连字符不计较，每个概念留几个
 * 候选名），取不到就留空，**绝不抛错**——手表上宁可少一行字，也不能整屏空着。
 */

/* 香港没有夏令时，全年 UTC+8，直接加偏移算，不引时区库 */
const HK_OFFSET_MS = 8 * 60 * 60 * 1000;

/* 一分钟都不要白花：设备天天求一次，返回体越小越省电 */
const DEFAULT_LIMIT_BYTES = 4096;
const DEFAULT_DAYS = 7;
const DEFAULT_PER_DAY = 8;

/* 一天之内的课上完就没事了，留几个字够用 */
const MAX_TITLE = 28;
const MAX_VENUE = 26;
const MAX_TEACHER = 18;
const MAX_TYPE = 10;

const NAMES = {
  subject: ["SUBJECT", "SUBJ", "SUBJECT_CODE"],
  catalog: ["CATALOG_NBR", "CATALOG", "CATALOG_NUMBER", "COURSE_NBR"],
  descr: ["DESCR", "DESCRIPTION", "COURSE_TITLE", "TITLE"],
  type: ["COMDESC", "SSR_COMPONENT", "COMPONENT", "CLASS_TYPE"],
  venue: ["FDESCR", "FACILITY_DESCR", "ROOM_DESCR", "LOCATION", "VENUE"],
  startDate: ["START_DT", "START_DATE"],
  endDate: ["END_DT", "END_DATE"],
  startTime: ["MEETING_TIME_START", "START_TIME"],
  endTime: ["MEETING_TIME_END", "END_TIME"],
  teacher: ["INSTRUCTORS", "INSTRUCTOR", "TEACHER"],
  section: ["CLASS_SECTION", "SECTION"],
  term: ["STRM", "TERM", "TERM_CODE"],
  termDescr: ["STRM_DESCR", "TERM_DESCR", "TERM_DESCRIPTION"],
  meetingDay: ["MEETING_DAY", "DAY_OF_WEEK", "WEEKDAY", "MEETDAY"]
};

const DAY_FLAGS = [
  [1, "MON"], [2, "TUES"], [3, "WED"], [4, "THURS"],
  [5, "FRI"], [6, "SAT"], [7, "SUN"]
];

const DAY_NAMES = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/* 限制的是**字节数**不是字符数：标题截断后带一个省略号，那是三个字节。
   Worker 和 Node 都有 TextEncoder，这里不引依赖。 */
const byteEncoder = typeof TextEncoder === "function" ? new TextEncoder() : null;

function sizeOf(value) {
  const text = JSON.stringify(value);
  return byteEncoder ? byteEncoder.encode(text).length : text.length;
}

/* ---------- 字段名 ---------- */

function bare(text) {
  return String(text === null || text === undefined ? "" : text)
    .toLowerCase()
    .replace(/[_\s-]/g, "");
}

function keyIndex(row) {
  const index = {};
  if (!row || typeof row !== "object") return index;
  Object.keys(row).forEach(function (key) {
    index[bare(key)] = key;
  });
  return index;
}

function pick(index, row, names) {
  for (let i = 0; i < names.length; i++) {
    const key = index[bare(names[i])];
    if (key === undefined) continue;
    const value = row[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function isYes(value) {
  const text = String(value === null || value === undefined ? "" : value)
    .trim().toLowerCase();
  return text === "y" || text === "yes" || text === "true" || text === "1";
}

/* ---------- 日期与时间 ---------- */

function pad2(number) {
  return (number < 10 ? "0" : "") + number;
}

/**
 * 上游的日期是**八位数字**（`20260907`），不是 `2026-09-07`；
 * 两种都认，其余一律拒掉（7 位、13 月、2 月 30 日这种不瞎归一，
 * 宁可当成"没写"，也不要显示一个错的日期）。
 */
function normDate(value) {
  const digits = String(value === null || value === undefined ? "" : value)
    .replace(/[^0-9]/g, "");
  if (digits.length !== 8) return null;
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return digits;
}

function daysInMonth(year, month) {
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const table = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return table[month - 1];
}

/**
 * 上游的上课时间见过 `09:30` 这种写法，也见过不带分隔符的；
 * 带 AM/PM 的一并认下来。返回 `HHMM`（四位），设备端直接按字符串切。
 */
function normTime(value) {
  const raw = String(value === null || value === undefined ? "" : value).trim();
  if (!raw) return null;

  let hour;
  let minute;
  /* 有分隔符的（`9:30` / `14:30:00` / `9.30`）先按分隔符切；秒直接忽略 */
  const withSeparator = /^(\d{1,2})\s*[:.]\s*(\d{1,2})(?:\s*[:.]\s*\d{1,2})?/.exec(raw);
  if (withSeparator) {
    hour = Number(withSeparator[1]);
    minute = Number(withSeparator[2]);
  } else {
    /* 没有分隔符的（`0930` / `930` / `143000`）按位数推 */
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits || digits.length > 6) return null;
    if (digits.length <= 2) {
      hour = Number(digits);
      minute = 0;
    } else if (digits.length <= 4) {
      hour = Number(digits.slice(0, digits.length - 2));
      minute = Number(digits.slice(-2));
    } else {
      hour = Number(digits.slice(0, 2));
      minute = Number(digits.slice(2, 4));
    }
  }
  const pm = /pm/i.test(raw);
  const am = /am/i.test(raw);
  if (pm && hour < 12) hour += 12;
  if (am && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return pad2(hour) + pad2(minute);
}

/* 有的学期上游只给一个 `MEETING_DAY` 文本（"THU" / "Thursday" / "星期四"），
   网页那边认这个名字，这边也跟着认——不然同一门课网页有、手表没有 */
function weekdayFromText(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return 0;
  const table = [
    [1, ["MON", "MONDAY", "星期一", "周一", "週一"]],
    [2, ["TUE", "TUES", "TUESDAY", "星期二", "周二", "週二"]],
    [3, ["WED", "WEDNESDAY", "星期三", "周三", "週三"]],
    [4, ["THU", "THUR", "THURS", "THURSDAY", "星期四", "周四", "週四"]],
    [5, ["FRI", "FRIDAY", "星期五", "周五", "週五"]],
    [6, ["SAT", "SATURDAY", "星期六", "周六", "週六"]],
    [7, ["SUN", "SUNDAY", "星期日", "星期天", "周日", "週日"]]
  ];
  for (let i = 0; i < table.length; i++) {
    if (table[i][1].indexOf(text) >= 0) return table[i][0];
  }
  return 0;
}

function ymdToUtc(ymd) {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
}

/* 1=周一 … 7=周日（跟 data 里的 weekday 记法一致） */
function weekdayOf(ymd) {
  if (!ymd) return 0;
  const day = new Date(ymdToUtc(ymd)).getUTCDay();
  return day === 0 ? 7 : day;
}

function shiftDate(ymd, deltaDays) {
  const stamp = new Date(ymdToUtc(ymd) + deltaDays * 86400000);
  return "" + stamp.getUTCFullYear() + pad2(stamp.getUTCMonth() + 1) + pad2(stamp.getUTCDate());
}

function dayName(weekday) {
  return DAY_NAMES[weekday] || "";
}

/** 现在的香港时间。传进来的毫秒数只为方便测试固定「现在」。 */
function hkNow(nowMs) {
  const stamp = Number.isFinite(nowMs) ? nowMs : Date.now();
  const shifted = new Date(stamp + HK_OFFSET_MS);
  const ymd = "" + shifted.getUTCFullYear() +
    pad2(shifted.getUTCMonth() + 1) + pad2(shifted.getUTCDate());
  const hhmm = pad2(shifted.getUTCHours()) + pad2(shifted.getUTCMinutes());
  const iso = shifted.getUTCFullYear() + "-" + pad2(shifted.getUTCMonth() + 1) + "-" +
    pad2(shifted.getUTCDate()) + "T" + pad2(shifted.getUTCHours()) + ":" +
    pad2(shifted.getUTCMinutes()) + "+08:00";
  return { ymd: ymd, hhmm: hhmm, iso: iso, minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2)) };
}

/* ---------- 一行课 → 一条安排 ---------- */

function trimTo(text, limit) {
  const value = String(text || "").trim().replace(/\s+/g, " ");
  if (value.length <= limit) return value;
  /* 省略号必须是 ASCII 的两个点：屏幕字库只有 ASCII 32–126，
     用了「…」真机会显示成三个问号（自检里有一条盯着这个） */
  return value.slice(0, Math.max(1, limit - 2)).trim() + "..";
}

/**
 * `Science Centre L3` 这种地名，末尾那截像教室号的切出来单独放。
 *
 * 判断"像教室号"的门槛要高：楼名本身常常以数字结尾（`Foo Building 7`），
 * 见着末尾有数字就切会把楼名削掉一半。所以只有下面两种才认：
 *   带字母的（L3、G01、ERB 303、ELB303）
 *   三到四位纯数字（201、1002）
 * 光一个 "7" 那种一律当成楼名的一部分。切不了就整串当地点——对屏幕来说，
 * 整串反而更不容易让人认错楼。
 */
function splitRoom(venue) {
  const text = String(venue || "").trim();
  const hit = /^(.*?)[\s,]+([A-Za-z]{1,4}[\s-]?\d{1,4}[A-Za-z]{0,2}|0?\d{3,4}[A-Za-z]?)$/
    .exec(text);
  if (!hit) return { building: text, room: "" };
  const head = hit[1].trim();
  if (!head) return { building: text, room: "" };
  return { building: head, room: hit[2].trim() };
}

function minutesOf(hhmm) {
  if (!hhmm) return -1;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));
}

/**
 * 一行上游数据 → 一条「某天某一节」，取不齐就返回 null。
 *
 * 星期读七列开关（MON…SUN），不拿 START_DT 去猜——START_DT 是这套上课
 * 安排的起止日期，不等于「第一节课那天」（js/timetable.js 里也是这么判的）。
 */
/* 返回 { meeting } 或者 { meeting: null, reason }——reason 给诊断工具用，
   手表拿到的包里不会有它 */
function toMeetingWithReason(row) {
  const index = keyIndex(row);
  const rawStart = pick(index, row, NAMES.startTime);
  const start = normTime(rawStart);
  if (!start) {
    return {
      meeting: null,
      reason: rawStart ? "上课时间认不出（" + rawStart + "）" : "这一行没有上课时间"
    };
  }

  const startDate = normDate(pick(index, row, NAMES.startDate));
  const endDate = normDate(pick(index, row, NAMES.endDate)) || startDate;

  let weekdays = [];
  DAY_FLAGS.forEach(function (pair) {
    const key = index[bare(pair[1])];
    if (key !== undefined && isYes(row[key])) weekdays.push(pair[0]);
  });
  /* 一个开关都没勾，再退两步：先看 MEETING_DAY 文本，最后才按开始日期推 */
  if (!weekdays.length) {
    const fromText = weekdayFromText(pick(index, row, NAMES.meetingDay));
    if (fromText) weekdays = [fromText];
  }
  if (!weekdays.length && startDate) weekdays = [weekdayOf(startDate)];
  if (!weekdays.length) {
    return { meeting: null, reason: "星期七列都没勾，也没有可用的 MEETING_DAY / 开始日期" };
  }

  const subject = pick(index, row, NAMES.subject);
  const catalog = pick(index, row, NAMES.catalog);
  const code = (subject + catalog).trim() || pick(index, row, NAMES.descr);
  const venue = splitRoom(pick(index, row, NAMES.venue));
  const end = normTime(pick(index, row, NAMES.endTime));

  return { meeting: {
    code: trimTo(code, 16),
    type: trimTo(pick(index, row, NAMES.type), MAX_TYPE),
    title: trimTo(pick(index, row, NAMES.descr), MAX_TITLE),
    venue: trimTo([venue.building, venue.room].filter(Boolean).join(" "), MAX_VENUE),
    building: trimTo(venue.building, MAX_VENUE),
    room: trimTo(venue.room, 8),
    teacher: trimTo(pick(index, row, NAMES.teacher), MAX_TEACHER),
    start: start,
    end: end || "",
    weekdays: weekdays,
    from: startDate || "",
    to: endDate || ""
  }, reason: "" };
}

function toMeeting(row) {
  return toMeetingWithReason(row).meeting;
}

/* 同一门课同一节，上游会给多条，而且**日期范围可能不同**（前六周一间教室、
   后七周同一时段同一教室）。所以"是不是同一节"的判据里不能含日期；
   但也不能只留第一条——要把各条的日期范围**合并**起来，否则后面的周次整段消失。 */
function meetingKey(meeting) {
  return [meeting.code, meeting.type, meeting.start, meeting.end,
    meeting.venue, meeting.weekdays.join("")].join("|");
}

/* 多段日期范围里只要有一段罩住这一天就算（缺 from/to 视为那一边不限） */
function covers(ranges, ymd) {
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];
    if (range.from && ymd < range.from) continue;
    if (range.to && ymd > range.to) continue;
    return true;
  }
  return false;
}

function occursOn(meeting, ymd, weekday) {
  if (meeting.weekdays.indexOf(weekday) < 0) return false;
  return covers(meeting.ranges, ymd);
}

/* ---------- 组装 ---------- */

function buildDevicePayload(rows, nowMs, options) {
  const opt = options || {};
  const days = Math.max(1, Math.min(14, Number(opt.days) || DEFAULT_DAYS));
  const perDay = Math.max(1, Math.min(20, Number(opt.perDay) || DEFAULT_PER_DAY));
  const limitBytes = Math.max(512, Number(opt.limitBytes) || DEFAULT_LIMIT_BYTES);
  const now = hkNow(nowMs);

  const meetings = [];
  const byKey = Object.create(null);
  (Array.isArray(rows) ? rows : []).forEach(function (row) {
    const meeting = toMeeting(row);
    if (!meeting) return;
    const key = meetingKey(meeting);
    const at = byKey[key];
    if (at === undefined) {
      byKey[key] = meetings.length;
      meetings.push({
        code: meeting.code,
        type: meeting.type,
        title: meeting.title,
        venue: meeting.venue,
        building: meeting.building,
        room: meeting.room,
        teacher: meeting.teacher,
        start: meeting.start,
        end: meeting.end,
        weekdays: meeting.weekdays,
        ranges: [{ from: meeting.from, to: meeting.to }]
      });
      return;
    }
    /* 已有同一条：把这一段日期并进去，而不是丢掉 */
    const target = meetings[at];
    target.ranges.push({ from: meeting.from, to: meeting.to });
    if (!target.title && meeting.title) target.title = meeting.title;
    if (!target.teacher && meeting.teacher) target.teacher = meeting.teacher;
  });

  const todayWeekday = weekdayOf(now.ymd);
  const buckets = [];
  for (let offset = 0; offset < days; offset++) {
    const date = shiftDate(now.ymd, offset);
    const weekday = weekdayOf(date);
    const list = meetings
      .filter(function (meeting) { return occursOn(meeting, date, weekday); })
      .sort(function (a, b) {
        if (a.start !== b.start) return a.start < b.start ? -1 : 1;
        return a.code < b.code ? -1 : (a.code > b.code ? 1 : 0);
      })
      .slice(0, perDay)
      .map(function (meeting) {
        return {
          start: meeting.start,
          end: meeting.end,
          code: meeting.code,
          type: meeting.type,
          title: meeting.title,
          venue: meeting.venue,
          building: meeting.building,
          room: meeting.room,
          teacher: meeting.teacher
        };
      });
    buckets.push({ date: date, weekday: weekday, day: dayName(weekday), classes: list });
  }

  const nowMinutes = now.minutes;
  let next = null;
  for (let i = 0; i < buckets.length && !next; i++) {
    const bucket = buckets[i];
    for (let j = 0; j < bucket.classes.length; j++) {
      const item = bucket.classes[j];
      const endMinutes = minutesOf(item.end) || (minutesOf(item.start) + 60);
      /* 正在上的那节也算"接下来"——手表上正显示"现在这节"比显示"下一节"更有用 */
      if (i > 0 || endMinutes >= nowMinutes) {
        next = {
          date: bucket.date,
          day: bucket.day,
          dayOffset: i,
          start: item.start,
          end: item.end,
          code: item.code,
          type: item.type,
          title: item.title,
          venue: item.venue,
          building: item.building,
          room: item.room,
          teacher: item.teacher,
          startsInMinutes: i === 0 ? minutesOf(item.start) - nowMinutes : null,
          inProgress: i === 0 && minutesOf(item.start) <= nowMinutes && endMinutes >= nowMinutes
        };
        break;
      }
    }
  }

  const payload = {
    ok: true,
    v: 1,
    now: now.iso,
    today: now.ymd,
    weekday: todayWeekday,
    day: dayName(todayWeekday),
    next: next,
    days: buckets,
    count: meetings.length,
    empty: meetings.length === 0,
    truncated: false
  };

  /* 手表的缓冲区就那么大，宁可少显示明天，也不要整包收不下来 */
  while (buckets.length > 1 && sizeOf(payload) > limitBytes) {
    buckets.pop();
    payload.truncated = true;
  }
  if (sizeOf(payload) > limitBytes) {
    payload.days.forEach(function (bucket) {
      bucket.classes = bucket.classes.slice(0, 3);
    });
    payload.truncated = true;
  }

  return payload;
}

/* ---------- 诊断：逐行说明它为什么进得来 / 进不来 ---------- */

function diagnoseRows(rows, nowMs, options) {
  const opt = options || {};
  const days = Math.max(1, Math.min(14, Number(opt.days) || DEFAULT_DAYS));
  const now = hkNow(nowMs);
  const list = Array.isArray(rows) ? rows : [];

  /* 体积上限也会让行"消失"：真的跑一遍打包，看哪些日子被裁掉了 */
  const packed = buildDevicePayload(list, nowMs, { days: days });
  const kept = Object.create(null);
  packed.days.forEach(function (bucket) {
    bucket.classes.forEach(function (item) {
      kept[bucket.date + "|" + item.start + "|" + item.code] = true;
    });
  });

  /* 先解析、再按"同一节"分组：同一组里几段日期范围合并起来看 */
  const parsedRows = list.map(function (row) { return toMeetingWithReason(row); });
  const groups = Object.create(null);
  parsedRows.forEach(function (parsed, index) {
    if (!parsed.meeting) return;
    const key = meetingKey(parsed.meeting);
    if (!groups[key]) groups[key] = { ranges: [], first: index + 1 };
    groups[key].ranges.push({ from: parsed.meeting.from, to: parsed.meeting.to });
  });

  const windowHits = function (weekdays, ranges) {
    const hits = [];
    for (let offset = 0; offset < days; offset++) {
      const date = shiftDate(now.ymd, offset);
      if (weekdays.indexOf(weekdayOf(date)) < 0) continue;
      if (covers(ranges, date)) hits.push(date);
    }
    return hits;
  };

  const result = parsedRows.map(function (parsed, index) {
    const rawRow = list[index];
    const idx = keyIndex(rawRow);
    const term = [pick(idx, rawRow, NAMES.term), pick(idx, rawRow, NAMES.termDescr)]
      .filter(Boolean).join(" ");
    const item = {
      index: index + 1,
      ok: false,
      reason: parsed.reason,
      note: "",
      hits: [],
      start: "", end: "", from: "", to: "",
      weekdays: [], code: "", type: "", venue: "", teacher: "", term: term
    };
    if (!parsed.meeting) return item;

    const m = parsed.meeting;
    item.start = m.start;
    item.end = m.end;
    item.from = m.from;
    item.to = m.to;
    item.weekdays = m.weekdays;
    item.code = m.code;
    item.type = m.type;
    item.venue = m.venue;
    item.teacher = m.teacher;

    const group = groups[meetingKey(m)];
    const ownHits = windowHits(m.weekdays, [{ from: m.from, to: m.to }]);
    const mergedHits = windowHits(m.weekdays, group.ranges);

    if (group.first !== item.index) {
      item.note = "和第 " + group.first + " 行同课同时段，日期范围合并处理";
    }
    if (mergedHits.length === 0) {
      item.reason = "日期范围不覆盖接下来 " + days + " 天";
      return item;
    }

    const survived = mergedHits.some(function (date) {
      return kept[date + "|" + m.start + "|" + m.code];
    });
    if (!survived) {
      item.reason = "包超过 4096 字节，这几天被裁掉了（从最后一天往回丢）";
      return item;
    }

    item.ok = true;
    item.reason = "";
    item.hits = ownHits.length ? ownHits : mergedHits;
    if (!ownHits.length) {
      item.note = "这行自己的日期不在窗口里；和同一节的其他行合并后仍会显示";
    }
    return item;
  });

  return { now: now.iso, today: now.ymd, total: list.length, result: result };
}

const __internal = {
  bare: bare,
  keyIndex: keyIndex,
  pick: pick,
  toMeeting: toMeeting,
  occursOn: occursOn,
  splitRoom: splitRoom,
  DAY_FLAGS: DAY_FLAGS,
  HK_OFFSET_MS: HK_OFFSET_MS
};
