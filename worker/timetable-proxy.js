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
 *   ALLOWED_ORIGINS 允许的网页来源，逗号分隔
 *   UPSTREAM_MODE   默认 soap-plain，见下面 MODES
 *   DEBUG           设成 "1" 才往日志里写状态码/耗时（永远不写请求体）
 *   ALLOW_EMPTY_CREDENTIALS
 *                   设成 "1" 才允许空学号/空密码。只用来确认"管道通不通"
 *                   （空凭据本来就登不进去，放开它没有风险），平时别开。
 */

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

    /* 路径不对就装作没有这个服务，别告诉扫描器"这里有个代理" */
    if (!pathAllowed(url, env)) return done({ ok: false, error: "not_found" }, 404);

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

    return done({
      ok: true,
      mode: modeName,
      count: courses.length,
      courses: courses
    }, 200);
  }
};
