/* 在电脑上把这块 200×200 墨水屏画出来
 *
 * 目的只有一个：**买板子之前就能把屏幕内容看明白**，而且看到的就是真机
 * 会画出来的东西。所以这里不自己定一套参数：
 *
 *   - 排版数字（行列坐标、边距、放大倍数）从固件的 `ui_theme.h` 里读；
 *   - 点阵字库从固件的 `font8x8.h` 里读；
 *   - 数据用 `worker/device-payload.js` 真实算出来的那一包。
 *
 * 剩下要"两边各写一遍"的只有绘制顺序（这个文件里的 drawScreen 和固件的
 * firmware/src/ui.cpp）。改其中一边记得改另一边——两边顶部都有这句提醒。
 *
 * 位约定跟墨水屏一致：缓冲区里 1 = 白、0 = 黑。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIRMWARE_SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "firmware", "src");

const FALLBACK_CHAR = "?";

/** 读固件的排版参数（只认 `#define UI_XXX 123` 这种写法） */
export function loadTheme(file) {
  const text = fs.readFileSync(file || path.join(FIRMWARE_SRC, "ui_theme.h"), "utf8");
  const theme = {};
  for (const hit of text.matchAll(/^#define\s+(UI_[A-Z0-9_]+)\s+(-?\d+)\s*$/gm)) {
    theme[hit[1]] = Number(hit[2]);
  }
  const needed = [
    "UI_W", "UI_H", "UI_MARGIN", "UI_ADVANCE", "UI_BIG", "UI_CHARS_MAX", "UI_TITLE_LINES",
    "UI_Y_RULE1", "UI_RULE1_H", "UI_Y_RULE2", "UI_RULE2_H", "UI_Y_HEADER",
    "UI_Y_BIG_TIME", "UI_Y_BIG_TAG", "UI_Y_META", "UI_Y_TITLE1", "UI_Y_TITLE2", "UI_Y_VENUE",
    "UI_Y_LIST_HEAD", "UI_Y_LIST_TOP", "UI_Y_FOOTER",
    "UI_LIST_TALL_MAX", "UI_LIST_STEP_TALL", "UI_LIST_ROWS_TALL", "UI_LIST_VENUE_DY",
    "UI_LIST_STEP_SHORT", "UI_LIST_ROWS_SHORT"
  ];
  const missing = needed.filter((key) => theme[key] === undefined);
  if (missing.length) throw new Error("ui_theme.h 里少了：" + missing.join("、"));
  return theme;
}

/** 读固件的 8×8 点阵字库，返回 95 个字形（ASCII 32–126），每个 8 字节 */
export function loadFont(file) {
  const text = fs.readFileSync(file || path.join(FIRMWARE_SRC, "font8x8.h"), "utf8");
  const glyphs = [];
  for (const hit of text.matchAll(/\{\s*((?:0x[0-9A-Fa-f]{2}\s*,\s*){7}0x[0-9A-Fa-f]{2})\s*\}/g)) {
    glyphs.push(hit[1].split(",").map((part) => parseInt(part.trim(), 16)));
  }
  if (glyphs.length !== 95) {
    throw new Error("字库应该是 95 个字形，现在读到 " + glyphs.length + " 个");
  }
  return glyphs;
}

/**
 * 屏幕只能显示 ASCII，其余一律落到 '?'。
 *
 * 这里**逐字节**处理（不是逐字）：固件那边拿到的是 UTF-8 字节流，一个汉字
 * 三个字节就会变成三个 '?'。两边规则一致，宽度才算得一样。
 */
export function sanitize(text) {
  const bytes = Buffer.from(String(text === null || text === undefined ? "" : text), "utf8");
  let out = "";
  for (const byte of bytes) {
    out += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : FALLBACK_CHAR;
  }
  return out;
}

/** 按字数硬切（不补省略号——省略号不在字库里，屏幕上也放不下） */
export function cut(text, max) {
  const value = sanitize(text);
  return value.length <= max ? value : value.slice(0, max);
}

/** 按空格折行，硬切超长单词，固定返回 UI_TITLE_LINES 行（不足补空行） */
export function wrapText(text, maxChars, maxLines) {
  const words = sanitize(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (let word of words) {
    while (word.length > maxChars) {
      if (current) {
        if (lines.length >= maxLines) return pad(lines, maxLines);
        lines.push(current);
        current = "";
      }
      if (lines.length >= maxLines) return pad(lines, maxLines);
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    const candidate = current ? current + " " + word : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      if (lines.length >= maxLines) return pad(lines, maxLines);
      lines.push(current);
      current = word;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return pad(lines, maxLines);
}

function pad(lines, maxLines) {
  const out = lines.slice(0, maxLines);
  while (out.length < maxLines) out.push("");
  return out;
}

/** "0930" → "09:30" */
export function clock(hhmm) {
  const value = String(hhmm || "");
  if (value.length === 4) return value.slice(0, 2) + ":" + value.slice(2);
  return value || "--:--";
}

/** "20261012" → "10-12" */
export function monthDay(ymd) {
  const value = String(ymd || "");
  return value.length === 8 ? value.slice(4, 6) + "-" + value.slice(6) : "";
}

/** ISO 时间串 → "07:10" */
export function clockOfIso(iso) {
  const text = String(iso || "");
  const hit = /T(\d{2}):(\d{2})/.exec(text);
  return hit ? hit[1] + ":" + hit[2] : "--:--";
}

/* ---------- 画布 ---------- */

export class Canvas {
  constructor(theme, glyphs) {
    this.theme = theme;
    this.glyphs = glyphs || loadFont();
    this.w = theme.UI_W;
    this.h = theme.UI_H;
    this.bits = new Uint8Array(this.w * this.h).fill(1);   /* 1 = 白 */
    this.clipped = 0;    /* 画到屏幕外面的次数：正常应该是 0 */
    this.unknown = 0;    /* 字库里没有的字符（非 ASCII）出现次数 */
  }

  pixel(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) {
      this.clipped++;
      return;
    }
    this.bits[y * this.w + x] = 0;
  }

  glyph(ch, x, y, scale) {
    const code = ch.codePointAt(0);
    let index = code - 32;
    if (code < 32 || code > 126) {
      index = FALLBACK_CHAR.codePointAt(0) - 32;
      this.unknown++;
    }
    const rows = this.glyphs[index];
    for (let row = 0; row < 8; row++) {
      const bits = rows[row];
      for (let col = 0; col < 8; col++) {
        if (!((bits >> col) & 1)) continue;   /* bit0 是最左边那个像素 */
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            this.pixel(x + col * scale + dx, y + row * scale + dy);
          }
        }
      }
    }
  }

  text(x, y, value, scale) {
    const factor = scale || 1;
    let cursor = x;
    for (const ch of sanitize(value)) {
      this.glyph(ch, cursor, y, factor);
      cursor += this.theme.UI_ADVANCE * factor;
    }
    return cursor;
  }

  rightText(y, value, scale) {
    const factor = scale || 1;
    const width = sanitize(value).length * this.theme.UI_ADVANCE * factor;
    this.text(this.w - this.theme.UI_MARGIN - width, y, value, factor);
  }

  rule(y, thickness) {
    for (let line = 0; line < thickness; line++) {
      for (let x = this.theme.UI_MARGIN; x < this.w - this.theme.UI_MARGIN; x++) {
        this.pixel(x, y + line);
      }
    }
  }

  /** 1（白）/ 0（黑）→ 0/255 的灰度图，写给 PNG */
  toGray() {
    const gray = new Uint8Array(this.bits.length);
    for (let i = 0; i < gray.length; i++) gray[i] = this.bits[i] ? 255 : 0;
    return gray;
  }
}

/* ---------- 一包数据 → 屏幕上要写的那几行字 ---------- */

/**
 * @param {object} payload 设备接口返回的那一包
 * @param {object} opts    { battery: 0-100 或 null, stale: 是否离线, cachedAt: "07:10" }
 */
export function buildModel(payload, opts) {
  const options = opts || {};
  const theme = options.theme || loadTheme();
  const max = theme.UI_CHARS_MAX;
  const model = {
    dayLabel: payload.day || "",
    dateLabel: monthDay(payload.today),
    battery: options.battery === undefined ? null : options.battery,
    bigTime: "",
    bigTag: "",
    meta: "",
    titleLines: ["", ""],
    venue: "",
    listHead: "",
    rows: [],
    footer: options.stale
      ? "OFFLINE - " + (options.cachedAt || "--:--")
      : "updated " + clockOfIso(payload.now)
  };

  if (payload.empty) {
    model.bigTime = "NO CLASSES";
    model.titleLines = wrapText("nothing in the next 7 days", max, theme.UI_TITLE_LINES);
    return model;
  }

  const next = payload.next;
  if (!next) {
    model.bigTime = "NO UPCOMING";
    model.titleLines = wrapText("all classes are past", max, theme.UI_TITLE_LINES);
    return model;
  }

  model.bigTime = clock(next.start);
  if (next.dayOffset === 0) {
    model.bigTag = next.inProgress ? "NOW" : "in " + Math.max(0, next.startsInMinutes || 0) + "m";
  } else {
    model.bigTag = next.dayOffset === 1 ? "Tomorrow" : (next.day || "");
  }

  model.meta = cut([next.code, next.type].filter(Boolean).join(" "), max);
  model.titleLines = wrapText(next.title, max, theme.UI_TITLE_LINES);
  model.venue = venueLine(next.building, next.room, max);

  const day = (payload.days && payload.days[next.dayOffset]) || { classes: [] };
  const after = day.classes.filter((item) => item.start > next.start);
  if (next.dayOffset === 0) {
    model.listHead = after.length === 0 ? "TODAY - LAST ONE" : "TODAY - " + after.length + " LEFT";
  } else {
    const total = day.classes.length;
    model.listHead = (next.day || "").toUpperCase() + " - " + total +
      (total === 1 ? " CLASS" : " CLASSES");
  }
  /* 课少 → 一节占两行（多一行地点）；课多 → 一行一节，能多列几节 */
  model.tallRows = after.length <= theme.UI_LIST_TALL_MAX;
  const limit = model.tallRows ? theme.UI_LIST_ROWS_TALL : theme.UI_LIST_ROWS_SHORT;
  model.rows = after.slice(0, limit).map((item) => ({
    time: clock(item.start),
    code: cut(item.code, 12),
    room: cut(item.room, 8),
    venue: venueLine(item.building, item.room, max)
  }));
  return model;
}

/** 地点那一行：楼名太长就把楼名切短，教室号一定要留（不然找不到教室） */
export function venueLine(building, room, max) {
  const tail = room ? " " + sanitize(room) : "";
  const head = cut(building, Math.max(0, max - tail.length));
  return (head + tail).slice(0, max);
}

/* ---------- 画一屏（和 firmware/src/ui.cpp 的绘制顺序一一对应） ---------- */

export function drawScreen(canvas, model) {
  const t = canvas.theme;

  canvas.text(t.UI_MARGIN, t.UI_Y_HEADER, model.dayLabel + " " + model.dateLabel);
  canvas.rightText(t.UI_Y_HEADER, model.battery === null ? "--%" : model.battery + "%");
  canvas.rule(t.UI_Y_RULE1, t.UI_RULE1_H);

  canvas.text(t.UI_MARGIN, t.UI_Y_BIG_TIME, model.bigTime, t.UI_BIG);
  if (model.bigTag) canvas.rightText(t.UI_Y_BIG_TAG, model.bigTag);

  if (model.meta) canvas.text(t.UI_MARGIN, t.UI_Y_META, model.meta);
  canvas.text(t.UI_MARGIN, t.UI_Y_TITLE1, model.titleLines[0] || "");
  canvas.text(t.UI_MARGIN, t.UI_Y_TITLE2, model.titleLines[1] || "");
  if (model.venue) canvas.text(t.UI_MARGIN, t.UI_Y_VENUE, model.venue);

  canvas.rule(t.UI_Y_RULE2, t.UI_RULE2_H);
  if (model.listHead) canvas.text(t.UI_MARGIN, t.UI_Y_LIST_HEAD, model.listHead);
  const step = model.tallRows ? t.UI_LIST_STEP_TALL : t.UI_LIST_STEP_SHORT;
  model.rows.forEach((row, index) => {
    const y = t.UI_Y_LIST_TOP + index * step;
    canvas.text(t.UI_MARGIN, y, row.time + " " + row.code);
    if (model.tallRows) {
      if (row.venue) canvas.text(t.UI_MARGIN, y + t.UI_LIST_VENUE_DY, row.venue);
    } else if (row.room) {
      canvas.rightText(y, row.room);
    }
  });

  canvas.text(t.UI_MARGIN, t.UI_Y_FOOTER, model.footer);
  return canvas;
}

/** 一次画完：拿一包数据 + 电池/离线状态，得到一张 200×200 的灰度图 */
export function renderFrame(payload, opts) {
  const theme = (opts && opts.theme) || loadTheme();
  const canvas = new Canvas(theme, (opts && opts.glyphs) || loadFont());
  drawScreen(canvas, buildModel(payload, opts));
  return canvas;
}
