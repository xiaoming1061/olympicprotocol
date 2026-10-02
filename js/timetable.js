/* 从学校接口拉回来的课表 → 我们自己的课程结构
 *
 * 上游是港中大官方 App「Student Class Timetable」的私有后端（见 worker/README.md），
 * 通过我们自己那台 Cloudflare Worker 代理转发回来。返回的是一个 JSON 数组，
 * 每一条是"一节课的一次安排"——同一门课有 Lecture + Tutorial 就是两条。
 *
 * 字段名是照着公开的逆向项目抄的（SUBJECT / FDESCR / MEETING_TIME_START …），
 * 但**没人见过真实数据**，不同学期还可能微调。所以这里取字段时：
 *
 *   1. 大小写、下划线、空格、连字符一律不计较（`Meeting_Time_Start` = `MEETINGTIMESTART`）；
 *   2. 每个概念留几个候选名，取到哪个算哪个；
 *   3. 一年到头取不到就留空，**绝不抛错**——宁可少一条信息，也不能整个导入挂掉。
 *
 * 真跑一次之后，看页面「原始字段」面板把对的留下、缺的补上就行。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  /* ---------- 字段名 ---------- */

  var NAMES = {
    subject: ["SUBJECT", "SUBJ", "SUBJECT_CODE", "COURSE_SUBJECT"],
    catalog: ["CATALOG_NBR", "CATALOG", "CATALOG_NUMBER", "CATALOGNO", "COURSE_NBR"],
    section: ["CLASS_SECTION", "SECTION", "CLASS_NBR", "SECTION_CODE"],
    descr: ["DESCR", "DESCRIPTION", "COURSE_TITLE", "TITLE", "COURSE_DESCR"],
    type: ["COMDESC", "SSR_COMPONENT", "COMPONENT", "COMPONENT_DESCR", "CLASS_TYPE"],
    venue: ["FDESCR", "FACILITY_DESCR", "ROOM_DESCR", "LOCATION", "FACILITY", "VENUE"],
    roomField: ["ROOM", "ROOM_NBR", "FACILITY_ID"],
    startDate: ["START_DT", "START_DATE", "MEETING_START_DT"],
    endDate: ["END_DT", "END_DATE", "MEETING_END_DT"],
    startTime: ["MEETING_TIME_START", "START_TIME", "MEETING_START_TIME"],
    endTime: ["MEETING_TIME_END", "END_TIME", "MEETING_END_TIME"],
    weekDay: ["MEETING_DAY", "DAY_OF_WEEK", "WEEKDAY", "MEETDAY"],
    strm: ["STRM", "TERM", "TERM_CODE"],
    strmDescr: ["STRM_DESCR", "TERM_DESCR", "TERM_DESCRIPTION"],
    classNbr: ["CLASS_NBR"],
    meetingNbr: ["CLASS_MTG_NBR"],
    courseId: ["CRSE_ID"],
    buildingCode: ["BLDG_CD"],
    teacher: ["INSTRUCTORS", "INSTRUCTOR", "TEACHER", "STAFF"],
    lat: ["LAT", "LATITUDE"],
    lng: ["LNG", "LON", "LONG", "LONGITUDE"]
  };

  /**
   * 上游把星期做成了七列开关（真数据里的字段名就是这几个）：
   *
   *   MON  TUES  WED  THURS  FRI  SAT  SUN
   *   Y    N     Y    N      N    N    N     ← 这行表示周一和周三都上
   *
   * 所以一门课一周上几天是能直接读出来的，**不要**从 START_DT 去猜
   * （START_DT 是这套上课安排的起止日期，不等于"第一节课那天"）。
   */
  var DAY_FLAGS = [
    [1, "MON"], [2, "TUES"], [3, "WED"], [4, "THURS"],
    [5, "FRI"], [6, "SAT"], [7, "SUN"]
  ];

  function isYes(value) {
    var text = String(value === null || value === undefined ? "" : value).trim().toLowerCase();
    return text === "y" || text === "yes" || text === "true" || text === "1";
  }

  /* 两个地名是不是同一个（大小写、空格、点、撇号、连字符都不计较）。
     用来判断"整串地名就是楼名"还是"末尾还挂着教室号"。 */
  function samePlace(a, b) {
    var clean = function (text) {
      return String(text || "").toLowerCase().replace(/[\s.,'’\u2019-]/g, "");
    };
    return !!clean(a) && clean(a) === clean(b);
  }

  /* 七个开关里打了勾的那几天；一个都没打勾才退回"从开始日期推" */
  function weekdaysFromFlags(index, row) {
    var days = [];
    DAY_FLAGS.forEach(function (pair) {
      var key = index[bare(pair[1])];
      if (key !== undefined && isYes(row[key])) days.push(pair[0]);
    });
    return days;
  }

  /* 日期统一成 "2026-09-07" 这种写法，界面上照原样显示 */
  function fmtDate(value) {
    var date = normDate(value);
    if (!date) return "";
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function bare(text) {
    return String(text || "").toLowerCase().replace(/[_\s-]/g, "");
  }

  /* 一行数据的字段名索引：`MEETING_TIME_START` 也认 `meetingtimestart` */
  function keyIndexes(row) {
    var index = {};
    Object.keys(row || {}).forEach(function (key) {
      index[bare(key)] = key;
    });
    return index;
  }

  function pick(index, row, names) {
    for (var i = 0; i < names.length; i++) {
      var key = index[bare(names[i])];
      if (key === undefined) continue;
      var value = row[key];
      if (value === null || value === undefined) continue;
      var text = String(value).trim();
      if (text) return text;
    }
    return "";
  }

  /* ---------- 值的归一化 ---------- */

  /**
   * 日期解析。**两种写法都要收**：
   *
   *   20260907             ← CUSIS / Scientia 真数据就是这种八位数字
   *   2026-09-07 / 2026/9/7 / 2026.09.07   ← 带分隔符的，日期框里存的就是这种
   *
   * 第一版只写了带分隔符那种，结果真实数据一个日期都没解析出来：
   * 课表里"星期后面那截起止日期"整段消失（用户截图为证）。
   */
  function normDate(text) {
    var raw = String(text || "").trim();
    if (!raw) return null;

    var m = /^(\d{4})[-/.]?(\d{1,2})[-/.]?(\d{1,2})/.exec(raw);
    if (!m) return null;

    var year = Number(m[1]);
    var month = Number(m[2]);
    var day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    /* 后面还跟着数字说明这不是一个完整日期（比如 7 位的 "2026090"） */
    if (/^\d/.test(raw.slice(m[0].length))) return null;

    var date = new Date(year, month - 1, day);
    /* 别让 Date 把 2 月 30 日悄悄归一成 3 月 2 日 */
    if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  /* "9:30"、"09:30:00" 都收成 "09:30" */
  function normTime(text) {
    var raw = String(text || "").trim();
    if (!raw) return "";
    var m = /^(\d{1,2})[:.](\d{2})/.exec(raw);
    if (!m) return "";
    var h = Number(m[1]);
    var mm = Number(m[2]);
    if (h > 23 || mm > 59) return "";
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  var DAY_WORDS = {
    mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
    sun: 7, sunday: 7
  };

  /* 星期几：优先从日期推（上游那种"开始日期 + 每周重复"的写法就靠它），
     实在没有日期才看专门的星期字段 */
  function weekdayOf(dateText, dayText) {
    var date = normDate(dateText);
    if (date) return OP.Planner.isoDow(date);

    var raw = String(dayText || "").trim();
    if (!raw) return 0;
    if (/^[1-7]$/.test(raw)) return Number(raw);
    return DAY_WORDS[raw.toLowerCase()] || 0;
  }

  /* 地名拆成"楼 + 教室"："Science Centre L3" → 楼 Science Centre、教室 L3 */
  function splitVenue(venue) {
    var text = String(venue || "").trim();
    if (!text) return { building: "", room: "", tba: true };
    if (/tba|to be announced|待定|no room|\u4e0d\u9700/.test(text.toLowerCase())) {
      return { building: "", room: "", tba: true };
    }

    var stripped = (OP.Ocr && OP.Ocr.stripRoomSuffix) ? OP.Ocr.stripRoomSuffix(text) : text;
    var room = text.slice(stripped.length).trim();
    return { building: stripped, room: room, tba: false };
  }

  /* ---------- 主函数 ---------- */

  /**
   * 把上游那批行转成我们的课程。
   *
   * @param rows   上游返回的数组（原样，别改）
   * @param opts   { buildings }（termStart 已经用不上了：不再换算周次）
   * @returns { courses, report }
   *          courses 里每条：{ name, teacher, buildingId, buildingName, room,
   *                           weekdays, start, end, startDate, endDate,
   *                           lat, lng, code, type, raw }
   *          report：{ rows, kept, skipped, keys }
   */
  function toCourses(rows, opts) {
    var options = opts || {};
    var buildings = options.buildings || [];

    var courses = [];
    var keys = [];
    var seenKey = {};
    var terms = {};
    var skipped = 0;

    (rows || []).forEach(function (row) {
      if (!row || typeof row !== "object") { skipped++; return; }

      Object.keys(row).forEach(function (key) {
        if (!seenKey[key]) { seenKey[key] = true; keys.push(key); }
      });

      var index = keyIndexes(row);
      var subject = pick(index, row, NAMES.subject);
      var catalog = pick(index, row, NAMES.catalog);
      var section = pick(index, row, NAMES.section);
      var descr = pick(index, row, NAMES.descr);
      var type = pick(index, row, NAMES.type);

      var code = [subject, catalog].filter(Boolean).join(" ") +
        (section ? "-" + section : "");
      /* 名字照课表上的写法：代号 + 类型（Tutorial / Lecture …），跟截图导入那边一致 */
      var name = [code, type].filter(Boolean).join(" ").trim() || descr;
      if (!name) { skipped++; return; }

      var start = normTime(pick(index, row, NAMES.startTime));
      var end = normTime(pick(index, row, NAMES.endTime));
      if (!start || !end) { skipped++; return; }

      var startDate = pick(index, row, NAMES.startDate);
      var endDate = pick(index, row, NAMES.endDate);
      /* 星期优先看那七个开关；一个都没勾才退回从日期/星期字段推 */
      var weekdays = weekdaysFromFlags(index, row);
      if (!weekdays.length) {
        var guess = weekdayOf(startDate, pick(index, row, NAMES.weekDay));
        if (guess) weekdays = [guess];
      }
      if (!weekdays.length) { skipped++; return; }

      /* 上游没有"周次"字段，只有 START_DT / END_DT 两个日期。
         所以就照原样留着这两个日期，页面上直接显示"开始日期 – 结束日期"。 */
      var fromIso = fmtDate(startDate);
      var toIso = fmtDate(endDate);

      /* 顺便记下这批数据属于哪个学期（STRM）。跨学期时周次会按同一个学期开始日算，
         第二学期就是偏的——界面要提示，见 app.js 的 renderPullResult。 */
      var strm = pick(index, row, NAMES.strm);
      var strmDescr = pick(index, row, NAMES.strmDescr);
      var termKey = strm || strmDescr;
      if (termKey) {
        if (!terms[termKey]) terms[termKey] = { strm: strm, descr: strmDescr, count: 0 };
        terms[termKey].count++;
      }

      var venueText = pick(index, row, NAMES.venue);
      var venue = splitVenue(venueText);
      var directRoom = pick(index, row, NAMES.roomField);

      var lat = Number(pick(index, row, NAMES.lat));
      var lng = Number(pick(index, row, NAMES.lng));
      var hasCoords = isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0;

      var buildingId = "";
      var matchedName = "";
      if (!venue.tba && OP.Ocr && OP.Ocr.matchBuilding) {
        /* 先用**完整地名**匹配（"Lady Shaw Building LT2" 这种整体就是像一个楼栋名），
           匹配不上再退回削掉教室号的版本。
           顺序反过来会出事：楼名本身以数字结尾时（"…Building 7"）会被削成
           "…Building"，于是拿一个残缺的名字去匹配。 */
        [venueText, venue.building].forEach(function (candidate) {
          if (buildingId || !candidate) return;
          var hit = OP.Ocr.matchBuilding(candidate, buildings);
          if (hit) {
            buildingId = hit.id;
            matchedName = hit.name;
          }
        });
      }

      /* 万一命中的那栋楼名字**就是整串地名**（说明末尾那个数字是楼名的一部分，
         不是教室号），就别再把它当教室显示 */
      var room = venue.room || directRoom;
      if (room && matchedName && samePlace(matchedName, venueText)) room = "";

      courses.push({
        name: name,
        teacher: pick(index, row, NAMES.teacher),
        code: code,
        type: type,
        descr: descr,
        classNbr: pick(index, row, NAMES.classNbr),
        courseId: pick(index, row, NAMES.courseId),
        buildingCode: pick(index, row, NAMES.buildingCode),
        buildingId: buildingId,
        buildingName: venue.building,
        room: room,
        weekdays: weekdays,
        start: start,
        end: end,
        startDate: fromIso,
        endDate: toIso,
        lat: hasCoords ? lat : null,
        lng: hasCoords ? lng : null,
        tba: venue.tba,
        raw: row
      });
    });

    return {
      courses: courses,
      report: {
        rows: (rows || []).length,
        kept: courses.length,
        skipped: skipped,
        keys: keys,
        terms: Object.keys(terms).map(function (k) { return terms[k]; })
          .sort(function (a, b) { return b.count - a.count; })
      }
    };
  }

  /**
   * 上游可能把"同一节课"拆成好几行（比如每个星期一行）。
   * 这里按"代号 + 星期 + 时间 + 地点"合并，日期区间取并集（最早开始到最晚结束）。
   */
  function mergeCourses(list) {
    var out = [];
    var index = {};

    (list || []).forEach(function (c) {
      var key = [c.code, c.weekdays.join("+"), c.start, c.end, c.buildingName, c.room].join("|");
      var hit = index[key];
      /* 注意是 `=== undefined` 不是 `!hit`：排在第一个的课位置是 0，
         用 `!hit` 判断的话它永远不是合并目标（第二行会另起一条）。 */
      if (hit === undefined) {
        index[key] = out.length;
        out.push(c);
        return;
      }
      var merged = out[hit];
      if (c.startDate && (!merged.startDate || c.startDate < merged.startDate)) merged.startDate = c.startDate;
      if (c.endDate && (!merged.endDate || c.endDate > merged.endDate)) merged.endDate = c.endDate;
    });

    return out;
  }

  OP.Timetable = {
    NAMES: NAMES,
    bare: bare,
    keyIndexes: keyIndexes,
    pick: pick,
    normDate: normDate,
    normTime: normTime,
    weekdayOf: weekdayOf,
    weekdaysFromFlags: weekdaysFromFlags,
    DAY_FLAGS: DAY_FLAGS,
    samePlace: samePlace,
    fmtDate: fmtDate,
    splitVenue: splitVenue,
    toCourses: toCourses,
    mergeCourses: mergeCourses
  };
})(window.OP);
