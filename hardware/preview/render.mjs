#!/usr/bin/env node
/* 把墨水屏的几个典型画面画成 PNG，买板子之前就能挑排版
 *
 *     node hardware/preview/render.mjs                  # 画到 hardware/preview/out/
 *     node hardware/preview/render.mjs --scale 4        # 放大 4 倍看细节
 *     node hardware/preview/render.mjs --ascii          # 顺手在终端里也打一份
 *     node hardware/preview/render.mjs --check          # 只检查有没有画出界（自检用）
 *
 * 数据不是编的：先用 `worker/device-payload.js`（线上手表拿到的就是它算的）
 * 从假的课表算出一包，再按固件的排版参数画出来。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDevicePayload } from "../../worker/device-payload.js";
import { encodeGrayPng } from "./png.mjs";
import { buildModel, loadFont, loadTheme, renderFrame } from "./layout.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { out: path.join(here, "out"), scale: 3, ascii: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--out") args.out = path.resolve(argv[++i]);
    else if (token === "--scale") args.scale = Number(argv[++i]) || 3;
    else if (token === "--ascii") args.ascii = true;
    else if (token === "--check") args.check = true;
  }
  return args;
}

/* ---------- 假课表：够画满几种情况就行 ---------- */

const WEEK = ["MON", "TUES", "WED", "THURS", "FRI", "SAT", "SUN"];

function onDays(days) {
  const flags = {};
  WEEK.forEach((name) => { flags[name] = days.indexOf(name) >= 0 ? "Y" : "N"; });
  return flags;
}

function session(over) {
  return Object.assign({
    START_DT: "20260907", END_DT: "20261204"
  }, over);
}

const TIMETABLE = [
  session(Object.assign({
    SUBJECT: "BMEG", CATALOG_NBR: "2210", DESCR: "Biomedical Engineering",
    COMDESC: "Lecture", FDESCR: "Science Centre L3", INSTRUCTORS: "CHAN TAI MAN",
    MEETING_TIME_START: "09:30", MEETING_TIME_END: "10:15"
  }, onDays(["MON", "WED"]))),
  session(Object.assign({
    SUBJECT: "ELEC", CATALOG_NBR: "1100", DESCR: "Digital Logic Design",
    COMDESC: "Lecture", FDESCR: "Ho Sin Hang Engineering Building 303",
    INSTRUCTORS: "WONG KA MING",
    MEETING_TIME_START: "11:30", MEETING_TIME_END: "12:15"
  }, onDays(["MON"]))),
  session(Object.assign({
    SUBJECT: "UGEA", CATALOG_NBR: "2100", DESCR: "Chinese Culture and Society",
    COMDESC: "Tutorial", FDESCR: "Lee Shau Kee Building L3", INSTRUCTORS: "LEE SIU FUNG",
    MEETING_TIME_START: "14:30", MEETING_TIME_END: "15:15"
  }, onDays(["MON"]))),
  session(Object.assign({
    SUBJECT: "ELEC", CATALOG_NBR: "1100", DESCR: "Digital Logic Design",
    COMDESC: "Laboratory", FDESCR: "Ho Sin Hang Engineering Building 303",
    INSTRUCTORS: "WONG KA MING",
    MEETING_TIME_START: "13:30", MEETING_TIME_END: "15:15"
  }, onDays(["WED"]))),
  session(Object.assign({
    SUBJECT: "UGEA", CATALOG_NBR: "2100", DESCR: "Chinese Culture and Society",
    COMDESC: "Lecture", FDESCR: "Yasumoto International Academic Park L0",
    INSTRUCTORS: "LEE SIU FUNG",
    MEETING_TIME_START: "16:30", MEETING_TIME_END: "17:15"
  }, onDays(["WED"]))),
  session(Object.assign({
    SUBJECT: "ENGG", CATALOG_NBR: "1000", DESCR: "Engineering Seminar Series",
    COMDESC: "Seminar", FDESCR: "William M W Mong Engineering Building 601",
    INSTRUCTORS: "LAU CHI WAI",
    MEETING_TIME_START: "15:30", MEETING_TIME_END: "16:15"
  }, onDays(["THURS"])))
];

const SCENARIOS = [
  { name: "01-monday-morning", title: "周一早上，下一节还有 30 分钟", now: "2026-10-12T09:00:00+08:00", battery: 87, rows: TIMETABLE },
  { name: "02-in-class", title: "正在上课", now: "2026-10-12T09:45:00+08:00", battery: 62, rows: TIMETABLE },
  { name: "03-tomorrow", title: "今天没课了，明天三节", now: "2026-10-13T20:00:00+08:00", battery: 41, rows: TIMETABLE },
  { name: "04-no-classes", title: "这学期还没导入课表", now: "2026-10-12T09:00:00+08:00", battery: 15, rows: [] },
  { name: "05-offline", title: "连不上网，显示上次的结果", now: "2026-10-12T09:00:00+08:00", battery: null, rows: TIMETABLE, stale: true, cachedAt: "07:10" }
];

/* ---------- 画 ---------- */

const args = parseArgs(process.argv.slice(2));
const theme = loadTheme();
const glyphs = loadFont();

if (!args.check) fs.mkdirSync(args.out, { recursive: true });

const summary = [];
let problems = 0;

for (const scenario of SCENARIOS) {
  const payload = buildDevicePayload(scenario.rows, Date.parse(scenario.now), {});
  const canvas = renderFrame(payload, {
    theme: theme,
    glyphs: glyphs,
    battery: scenario.battery,
    stale: scenario.stale,
    cachedAt: scenario.cachedAt
  });
  const model = buildModel(payload, {
    theme: theme, battery: scenario.battery, stale: scenario.stale, cachedAt: scenario.cachedAt
  });

  if (canvas.clipped > 0 || canvas.unknown > 0) problems++;

  if (!args.check) {
    const gray = canvas.toGray();
    fs.writeFileSync(path.join(args.out, scenario.name + ".png"),
      encodeGrayPng(canvas.w, canvas.h, gray, args.scale));
    fs.writeFileSync(path.join(args.out, scenario.name + "-1x.png"),
      encodeGrayPng(canvas.w, canvas.h, gray, 1));
  }

  summary.push({
    name: scenario.name,
    title: scenario.title,
    head: model.listHead,
    big: model.bigTime + (model.bigTag ? "  " + model.bigTag : ""),
    lines: [model.meta].concat(model.titleLines).filter(Boolean),
    rows: model.rows.map((row) => row.time + " " + row.code),
    clipped: canvas.clipped,
    unknown: canvas.unknown
  });

  if (args.ascii) {
    console.log("\n" + scenario.name + " · " + scenario.title);
    const bits = canvas.bits;
    for (let y = 0; y < canvas.h; y++) {
      let line = "";
      for (let x = 0; x < canvas.w; x++) line += bits[y * canvas.w + x] ? " " : "#";
      console.log(line.replace(/\s+$/, ""));
    }
  }
}

for (const item of summary) {
  console.log(item.name.padEnd(20) + " | " + String(item.big).padEnd(14) + " | " +
    String(item.head).padEnd(20) + " | 出界 " + item.clipped + " 越界字符 " + item.unknown);
  item.lines.forEach((line) => console.log(" ".repeat(21) + line));
  if (item.rows.length) {
    console.log(" ".repeat(21) + item.rows.join(" / "));
  }
}

if (args.check) {
  console.log(problems === 0
    ? "\n屏幕排版自检通过：" + SCENARIOS.length + " 种画面都没有画出界，也没有字库里没有的字符"
    : "\n屏幕排版自检不通过：有 " + problems + " 种画面有问题");
  process.exit(problems === 0 ? 0 : 1);
}

console.log("\n图写好了：" + args.out);
