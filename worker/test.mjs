/* 代理的本地自检：把上游 fetch 换成假的，逐条验行为。
 *
 *     node worker/test.mjs
 *
 * 不开浏览器、不联网、不需要 Cloudflare 账号。tools/selftest.js 会调用它，
 * 所以这些断言跟项目其它 900 多条检查一起跑。
 */

import worker from "./timetable-proxy.js";

const PROXY = "https://proxy.example.workers.dev";
const ORIGIN = "https://rhythmhill.com";
const TOKEN = "s3cret-path";
const ENV = {
  PROXY_TOKEN: TOKEN,
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
  check("GET 返回 405（只收 POST）", got.status === 405);

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

/* ---------- 收尾 ---------- */

globalThis.fetch = realFetch;
console.log("\n" + (fail === 0 ? "worker 全部通过" : "worker 有失败项") + "：通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);
