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
export function normDate(value) {
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
export function normTime(value) {
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
export function weekdayOf(ymd) {
  if (!ymd) return 0;
  const day = new Date(ymdToUtc(ymd)).getUTCDay();
  return day === 0 ? 7 : day;
}

export function shiftDate(ymd, deltaDays) {
  const stamp = new Date(ymdToUtc(ymd) + deltaDays * 86400000);
  return "" + stamp.getUTCFullYear() + pad2(stamp.getUTCMonth() + 1) + pad2(stamp.getUTCDate());
}

export function dayName(weekday) {
  return DAY_NAMES[weekday] || "";
}

/** 现在的香港时间。传进来的毫秒数只为方便测试固定「现在」。 */
export function hkNow(nowMs) {
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

export function buildDevicePayload(rows, nowMs, options) {
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

export function diagnoseRows(rows, nowMs, options) {
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

export const __internal = {
  bare: bare,
  keyIndex: keyIndex,
  pick: pick,
  toMeeting: toMeeting,
  occursOn: occursOn,
  splitRoom: splitRoom,
  DAY_FLAGS: DAY_FLAGS,
  HK_OFFSET_MS: HK_OFFSET_MS
};
