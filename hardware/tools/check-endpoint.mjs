#!/usr/bin/env node
/* 在电脑上先试一次手表那条接口
 *
 *     node hardware/tools/check-endpoint.mjs https://<worker域名>/d/<设备口令>
 *     node hardware/tools/check-endpoint.mjs https://<worker域名>/t/<网页口令>
 *         ↑ 用网页那条入口时会逐行诊断：哪一行进得去、哪一行被什么原因丢掉
 *     node hardware/tools/check-endpoint.mjs --fixture        # 不联网，看输出长什么样
 *     node hardware/tools/check-endpoint.mjs --fixture-raw    # 看诊断模式长什么样
 *
 * 为什么先做这一步：板子刷起来慢、屏幕上只有黑白两色、出错信息就几个字符。
 * 先在电脑上把「地址对不对、学号密码能不能读到课、那一包数据长什么样」验掉，
 * 剩下到板子上的问题就只剩接线和烧录了。
 *
 * 密码是提示输入的、输入时**不回显**，也不会出现在命令历史里。
 * 也可以不走提示，用环境变量：OP_SID / OP_PWD。
 */

import { buildDevicePayload, diagnoseRows } from "../../worker/device-payload.js";

const WEEK = ["MON", "TUES", "WED", "THURS", "FRI", "SAT", "SUN"];
const WEEK_CN = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function clock(hhmm) {
  const value = String(hhmm || "");
  return value.length === 4 ? value.slice(0, 2) + ":" + value.slice(2) : value || "--:--";
}

function niceDate(ymd) {
  const value = String(ymd || "");
  return value.length === 8 ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
}

/* ---------- 把那一包数据讲成人话 ---------- */

export function describe(payload) {
  const lines = [];
  const next = payload.next;

  if (payload.empty) {
    lines.push("这一周没有任何课（上游回的是空数组）。");
    lines.push("两种可能：这学期还没选课，或者学号密码不对——上游分不清这两种。");
  } else if (!next) {
    lines.push("有课，但都已经过去了（最近七天里没有还没上的）。");
  } else {
    const when = next.dayOffset === 0
      ? (next.inProgress ? "正在上" : `还有 ${next.startsInMinutes} 分钟`)
      : (next.dayOffset === 1 ? "明天" : `${next.day}（${next.dayOffset} 天后）`);
    lines.push(`下一节：${clock(next.start)}-${clock(next.end)}  ${next.code} ${next.type}`);
    lines.push(`        ${next.venue}${next.teacher ? "  ·  " + next.teacher : ""}   （${when}）`);
  }

  lines.push("");
  lines.push(`今天 ${niceDate(payload.today)} ${WEEK_CN[payload.weekday] || ""}，一共 ${payload.count} 节（七天以内）`);

  (payload.days || []).forEach((day) => {
    if (!day.classes.length) return;
    lines.push("");
    lines.push(`  ${niceDate(day.date)} ${WEEK_CN[day.weekday] || ""}  ${day.classes.length} 节`);
    day.classes.forEach((item) => {
      lines.push(`    ${clock(item.start)}-${clock(item.end)}  ${item.code.padEnd(9)} ` +
        `${item.type.padEnd(10)} ${item.venue}`);
    });
  });

  lines.push("");
  lines.push(`这一包 ${Buffer.byteLength(JSON.stringify(payload))} 字节` +
    `（手表最多收 4096 字节${payload.truncated ? "；**已经裁过**" : ""}）`);
  return lines.join("\n");
}

/* ---------- 一个和真实数据同构的示例（自检也用它） ---------- */

export function fixturePayload(nowMs) {
  const onDays = (days) => {
    const flags = {};
    WEEK.forEach((name) => { flags[name] = days.indexOf(name) >= 0 ? "Y" : "N"; });
    return flags;
  };
  const rows = [
    Object.assign({
      SUBJECT: "BMEG", CATALOG_NBR: "2210", DESCR: "Biomedical Engineering",
      COMDESC: "Lecture", FDESCR: "Science Centre L3", INSTRUCTORS: "CHAN TAI MAN",
      START_DT: "20260907", END_DT: "20261204",
      MEETING_TIME_START: "09:30", MEETING_TIME_END: "10:15"
    }, onDays(["MON", "WED"])),
    Object.assign({
      SUBJECT: "ELEC", CATALOG_NBR: "1100", DESCR: "Digital Logic Design",
      COMDESC: "Tutorial", FDESCR: "Ho Sin Hang Engineering Building 303",
      INSTRUCTORS: "WONG KA MING",
      START_DT: "20260907", END_DT: "20261204",
      MEETING_TIME_START: "11:30", MEETING_TIME_END: "12:15"
    }, onDays(["MON"]))
  ];
  return buildDevicePayload(rows, nowMs, {});
}

/* ---------- 诊断模式：逐行解释"为什么这节没显示" ---------- */

export function formatDiagnosis(diag) {
  const lines = [];
  const dayNames = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  lines.push(`上游一共回了 ${diag.total} 行（每行 = 一次上课安排），按今天 ${diag.today} 算`);
  lines.push("");
  diag.result.forEach((item) => {
    const days = item.weekdays.map((n) => dayNames[n] || String(n)).join("/") || "—";
    const range = item.from ? `${item.from}-${item.to || item.from}` : "没写日期";
    const time = item.start ? `${item.start}-${item.end || "??"}` : "—";
    const verdict = item.ok
      ? "✅ 进得去：" + item.hits.map((d) => d.slice(4, 6) + "-" + d.slice(6)).join("、")
      : "❌ " + item.reason;
    lines.push(`#${String(item.index).padStart(2)}  ${(item.code || "(无代号)").padEnd(9)} ` +
      `${(item.type || "").padEnd(10)} ${days.padEnd(9)} ${range.padEnd(19)} ${time.padEnd(11)} ${verdict}`);
    if (item.note) lines.push(`      ↳ ${item.note}`);
    if (item.venue) lines.push(`      ${item.venue}${item.teacher ? "  ·  " + item.teacher : ""}`);
  });
  const ok = diag.result.filter((item) => item.ok).length;
  lines.push("");
  lines.push(`合计：${ok} 行进得去，${diag.total - ok} 行没进（原因写在各行后面）`);
  return lines.join("\n");
}

/* 三行"陷阱数据"，用来看诊断模式怎么报原因 */
export function fixtureRawRows() {
  const flags = (on) => {
    const out = {};
    WEEK.forEach((name) => { out[name] = on.indexOf(name) >= 0 ? "Y" : "N"; });
    return out;
  };
  return [
    Object.assign({
      SUBJECT: "BMEG", CATALOG_NBR: "2210", DESCR: "Biomedical Engineering",
      COMDESC: "Lecture", FDESCR: "Science Centre L3", INSTRUCTORS: "CHAN TAI MAN",
      STRM: "2610", STRM_DESCR: "2026-27 Term 1",
      START_DT: "20260907", END_DT: "20261016",
      MEETING_TIME_START: "09:30", MEETING_TIME_END: "10:15"
    }, flags(["MON", "WED"])),
    /* 周四，时间带秒：以前会被整行丢掉，现在能认 */
    Object.assign({
      SUBJECT: "ELEC", CATALOG_NBR: "1100", DESCR: "Digital Logic Design",
      COMDESC: "Laboratory", FDESCR: "Ho Sin Hang Engineering Building 303",
      INSTRUCTORS: "WONG KA MING", STRM: "2610",
      START_DT: "20260907", END_DT: "20261204",
      MEETING_TIME_START: "14:30:00", MEETING_TIME_END: "15:15:00"
    }, flags(["THURS"])),
    /* 上学期的周四课：日期范围已经过了，正常该排除 */
    Object.assign({
      SUBJECT: "UGEA", CATALOG_NBR: "2100", DESCR: "Chinese Culture",
      COMDESC: "Tutorial", FDESCR: "Lee Shau Kee Building L3",
      INSTRUCTORS: "LEE SIU FUNG", STRM: "2520", STRM_DESCR: "2025-26 Term 2",
      START_DT: "20260105", END_DT: "20260430",
      MEETING_TIME_START: "10:30", MEETING_TIME_END: "11:15"
    }, flags(["THURS"])),
    /* 没有七列开关，只给了一个 MEETING_DAY 文本：也能认 */
    Object.assign({
      SUBJECT: "ENGG", CATALOG_NBR: "1000", DESCR: "Engineering Seminar",
      COMDESC: "Seminar", FDESCR: "Yasumoto International Academic Park L0",
      INSTRUCTORS: "LAU CHI WAI", STRM: "2610",
      START_DT: "20260907", END_DT: "20261204",
      MEETING_TIME_START: "16:30", MEETING_TIME_END: "17:15",
      MEETING_DAY: "THU"
    }, flags([])),
    /* 连上课时间都没有：只能丢 */
    Object.assign({
      SUBJECT: "PHYS", CATALOG_NBR: "1001", DESCR: "Physics Lab",
      COMDESC: "Laboratory", FDESCR: "Physics Building 101",
      STRM: "2610", START_DT: "20260907", END_DT: "20261204",
      MEETING_TIME_START: "", MEETING_TIME_END: ""
    }, flags(["THURS"]))
    ,
    /* 同一节的后半学期：日期范围不同，要合并而不是当成重复丢掉 */
    Object.assign({
      SUBJECT: "BMEG", CATALOG_NBR: "2210", DESCR: "Biomedical Engineering",
      COMDESC: "Lecture", FDESCR: "Science Centre L3", INSTRUCTORS: "CHAN TAI MAN",
      STRM: "2610", STRM_DESCR: "2026-27 Term 1",
      START_DT: "20261019", END_DT: "20261204",
      MEETING_TIME_START: "09:30", MEETING_TIME_END: "10:15"
    }, flags(["MON", "WED"]))
  ];
}

/* ---------- 输入 ---------- */

function ask(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (chunk) => {
      process.stdin.pause();
      resolve(chunk.trim());
    });
  });
}

/* 密码不回显。管道里跑（不是终端）就退化成普通读取，免得 setRawMode 抛错 */
function askHidden(question) {
  if (!process.stdin.isTTY) return ask(question);
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const finish = (result) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw || false);
      stdin.pause();
      process.stdout.write("\n");
      resolve(result);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish(value);
        if (ch === "\u0003") { finish(""); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") {
          if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); }
          continue;
        }
        value += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

/* ---------- 主流程 ---------- */

async function main() {
  const args = process.argv.slice(2);
  const fixture = args.indexOf("--fixture") >= 0;
  const url = args.find((arg) => arg.indexOf("--") !== 0);

  if (fixture) {
    console.log(describe(fixturePayload(Date.parse("2026-10-12T09:00:00+08:00"))));
    return 0;
  }

  if (args.indexOf("--fixture-raw") >= 0) {
    console.log(formatDiagnosis(diagnoseRows(fixtureRawRows(), Date.parse("2026-10-17T09:00:00+08:00"), {})));
    return 0;
  }

  if (!url) {
    console.log("用法：node hardware/tools/check-endpoint.mjs https://<worker域名>/d/<设备口令>");
    console.log("     （加 --fixture 可以不联网，只看输出长什么样）");
    return 2;
  }
  if (!/^https?:\/\//.test(url)) {
    console.log("地址得是 http(s):// 开头，现在给的是：" + url);
    return 2;
  }

  const sid = process.env.OP_SID || await ask("学号（1155xxxxxx）：");
  const pwd = process.env.OP_PWD || await askHidden("密码（输入时不显示）：");
  if (!sid || !pwd) {
    console.log("学号和密码都得填。");
    return 2;
  }

  console.log("\n正在问 " + url + " …（上游有时要十几秒）");
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: sid, pwd: pwd })
    });
  } catch (err) {
    console.log("\n连不上：" + err.message);
    console.log("检查一下：地址有没有抄错、设备口令（DEVICE_TOKEN）在 Worker 里配了没有。");
    return 1;
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    console.log(`\nHTTP ${response.status}，但回来的不是 JSON：`);
    console.log(text.slice(0, 300));
    return 1;
  }

  if (response.status !== 200 || payload.ok !== true) {
    console.log(`\n没成功：HTTP ${response.status}，error = ${payload.error || "(没写)"}`);
    const hints = {
      not_found: "地址或设备口令不对（DEVICE_TOKEN 没配的话这条入口整个是 404）。",
      missing_credentials: "学号或密码是空的。",
      too_many_requests: "一分钟内问太多次了，等一分钟再试。",
      upstream_timeout: "学校那头的接口超时了（十几秒是常态），过一会儿再试。",
      upstream_unreachable: "连不上学校那头，可能是网络或机房出口的问题。",
      upstream_status: "学校那头返回了错误状态。",
      upstream_unparseable: "学校那头回了不是 JSON 的东西（通常是登录失败或维护）。",
      unknown_mode: "接口写法不认识（这个工具不会传，说明代理那台配错了）。"
    };
    if (hints[payload.error]) console.log("  " + hints[payload.error]);
    return 1;
  }

  /* 回的是网页那 28 字段的原始行 → 逐行诊断 */
  if (Array.isArray(payload.courses)) {
    console.log("\n" + formatDiagnosis(diagnoseRows(payload.courses, Date.now(), {})) + "\n");
    console.log("这一路是网页用的原始数据。手表那条 /d/ 只保留接下来 7 天、只留显示要的字段，");
    console.log("所以「网页有、手表没有」时，看上面哪一行写着 ❌ 就是原因。");
    return 0;
  }

  console.log("\n" + describe(payload) + "\n");
  console.log("这条入口是通的。接下来把同一个地址填进固件的 src/config.h 里就能烧板子了。");
  return 0;
}

main().then((code) => process.exit(code));
