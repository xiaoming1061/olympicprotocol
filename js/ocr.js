/* 从课表截图里读出课程
 *
 * 思路不是"把字认出来"就完事，而是靠表格的几何结构还原内容：
 *   表头（Monday…Friday）决定列 → 左侧时间刻度决定纵轴 → 每个格子是一节课
 * 所以 OCR 只负责给出"哪些文字、在什么位置"，剩下的都是规则问题。
 *
 * 分两层：
 *   parseWords() 及以下全是纯函数，喂进去带坐标的文字就能出课程，可离线单测
 *   run() 是浏览器驱动层，负责图片预处理、调用 Tesseract、串起整条流程
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  /* Tesseract 从 CDN 按需加载，不打开 OCR 功能就不会下载 */
  var SCRIPT_CDNS = [
    "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist",
    "https://unpkg.com/tesseract.js@5.1.1/dist"
  ];
  var DEFAULT_LANG_PATH = "https://tessdata.projectnaptha.com/4.0.0";
  /* 语言包的备用站点。国内访问 projectnaptha 有时不稳，多备一个。 */
  var LANG_PATHS = [
    DEFAULT_LANG_PATH,
    "https://cdn.jsdelivr.net/gh/naptha/tessdata@gh-pages/4.0.0"
  ];

  var WEEKDAY_EN = {
    monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, weds: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5,
    saturday: 6, sat: 6, sunday: 7, sun: 7
  };

  var WEEKDAY_CN = {
    "星期一": 1, "星期一": 1, "周一": 1, "礼拜一": 1,
    "星期二": 2, "周二": 2, "礼拜二": 2,
    "星期三": 3, "周三": 3, "礼拜三": 3,
    "星期四": 4, "周四": 4, "礼拜四": 4,
    "星期五": 5, "周五": 5, "礼拜五": 5,
    "星期六": 6, "周六": 6, "礼拜六": 6,
    "星期日": 7, "星期天": 7, "周日": 7, "周天": 7, "礼拜日": 7, "礼拜天": 7
  };

  /* 表里存的是显示用的规范写法，比较时统一忽略大小写和空格 */
  var TYPE_WORDS = [
    "Lecture", "Tutorial", "Interactive Tutorial", "Laboratory", "Lab", "Seminar",
    "Assembly", "Workshop", "Class", "Practical", "Studio", "Field Study",
    "讲座", "导修", "实验", "实验课", "大会", "研讨", "实践", "课程", "课"
  ];

  /**
   * 课程代号：4 个字母 + 4 位数字，例如 BMEG 2210、ENGL 1001。
   * 中间允许空格或连字符，字母必须大写——这样 "Room 1234" 这类不会被误判。
   */
  var COURSE_CODE_RE = /\b([A-Z]{4})[\s\-–—]*([0-9A-Za-z]{4})\b/;

  /* OCR 在数字位置常把 0/O、1/I、5/S、8/B 认混，这里纠回来 */
  var DIGIT_FIXES = [
    [/[OoQq]/g, "0"],
    [/[Il|!]/g, "1"],
    [/[Zz]/g, "2"],
    [/[Ss]/g, "5"],
    [/[Gg]/g, "6"],
    [/[Bb]/g, "8"]
  ];

  function fixDigits(text) {
    var result = String(text);
    DIGIT_FIXES.forEach(function (pair) { result = result.replace(pair[0], pair[1]); });
    return result;
  }

  function isValidCourseCode(code) {
    return /^[A-Z]{4} [0-9]{4}$/.test(String(code || ""));
  }

  var NON_SECTION = ["lecture", "tutorial", "laboratory", "assembly", "waiting",
    "location", "venue", "tba", "am", "pm"];

  /* ================= 基础工具 ================= */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function hm(text) {
    var p = String(text || "0:00").split(":");
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function fmtMinutes(minutes) {
    var total = ((Math.round(minutes) % 1440) + 1440) % 1440;
    return pad2(Math.floor(total / 60)) + ":" + pad2(total % 60);
  }

  function snap5(minutes) { return Math.round(minutes / 5) * 5; }

  function median(numbers) {
    if (!numbers.length) return 0;
    var sorted = numbers.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /* 把 OCR 常见的形近字符规整一下：时间里的 O/o 当 0，l/I 当 1 */
  function cleanTimeToken(token) {
    return String(token).replace(/[Oo]/g, "0").replace(/[lI]/g, "1");
  }

  function lower(text) { return String(text || "").toLowerCase(); }

  /**
   * 比较短语时先把空格和标点全去掉。
   *
   * 识别引擎开着"保留词间空格"，很容易把 "Interactive Tutorial" 读成
   * "Interactive  Tutorial"（双空格）甚至带上标点。严格相等会漏掉，
   * 结果课程类型被当成地点——踩过这个坑。
   */
  function phraseKey(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "");
  }

  function isTypeWord(text) {
    var key = phraseKey(text);
    if (!key) return false;
    for (var i = 0; i < TYPE_WORDS.length; i++) {
      if (phraseKey(TYPE_WORDS[i]) === key) return true;
    }
    return false;
  }

  /* 命中的话返回表里的规范写法，让显示大小写统一 */
  function canonicalType(text) {
    var key = phraseKey(text);
    if (!key) return "";
    for (var i = 0; i < TYPE_WORDS.length; i++) {
      if (phraseKey(TYPE_WORDS[i]) === key) return TYPE_WORDS[i];
    }
    return "";
  }

  /**
   * 把混进地点里的课程类型短语摘掉。
   *
   * 除了空格问题，OCR 还可能把 "Interactive Tutorial" 拆成两行，
   * 那样两行都不是完整的类型词，光靠 isTypeWord 拦不住。
   * 所以拼成整段地点之后再扫一遍。
   */
  function stripTypeWords(text) {
    var result = String(text || "");

    /* 长的先处理：不然 "Tutorial" 会先把 "Interactive Tutorial" 拆散 */
    var byLength = TYPE_WORDS.slice().sort(function (a, b) {
      return phraseKey(b).length - phraseKey(a).length;
    });

    byLength.forEach(function (word) {
      if (phraseKey(word).length < 4) return;
      /* 词与词之间允许插任意非字母字符，匹配 OCR 读出来的多余空格 */
      var pattern = word.split(/\s+/).map(function (part) {
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      }).join("[^A-Za-z\\u4e00-\\u9fa5]*");

      result = result.replace(new RegExp(pattern, "gi"), " ");
    });

    return result.replace(/\s+/g, " ").trim();
  }

  /* ================= 1. 表头：找出星期几在哪一列 ================= */

  function weekdayOf(text) {
    var raw = String(text || "").trim();
    if (!raw) return 0;
    var key = raw.replace(/[\s.,:：]/g, "");
    if (WEEKDAY_CN[key]) return WEEKDAY_CN[key];
    var en = lower(raw).replace(/[^a-z]/g, "");
    if (WEEKDAY_EN[en]) return WEEKDAY_EN[en];
    return 0;
  }

  /**
   * @returns {Array} 按 x 排序的表头 [{ day, x, y0, y1 }]
   */
  function parseWeekdayHeader(words) {
    var hits = [];
    (words || []).forEach(function (w) {
      var day = weekdayOf(w.text);
      if (!day) return;
      hits.push({
        day: day,
        x: (w.x0 + w.x1) / 2,
        y: (w.y0 + w.y1) / 2,
        y0: w.y0,
        y1: w.y1
      });
    });
    if (!hits.length) return [];

    hits.sort(function (a, b) { return a.y - b.y; });

    /* 只保留最上面那一组，避免把正文里出现的星期字样也算进来 */
    var heights = hits.map(function (h) { return h.y1 - h.y0; });
    var tolerance = Math.max(median(heights) * 1.6, 12);
    var top = hits[0].y;
    var header = hits.filter(function (h) { return Math.abs(h.y - top) <= tolerance; });

    /* 同一天只留最靠左的那个 */
    var byDay = {};
    header.forEach(function (h) {
      if (!byDay[h.day] || h.x < byDay[h.day].x) byDay[h.day] = h;
    });

    return Object.keys(byDay).map(function (k) { return byDay[k]; })
      .sort(function (a, b) { return a.x - b.x; });
  }

  /* 表头中心点之间取中点当列边界 */
  function buildColumns(header) {
    if (!header || header.length < 2) return [];

    return header.map(function (h, i) {
      var left, right;
      if (i === 0) {
        left = h.x - (header[1].x - header[0].x) / 2;
        right = (h.x + header[1].x) / 2;
      } else if (i === header.length - 1) {
        left = (header[i - 1].x + h.x) / 2;
        right = h.x + (h.x - header[i - 1].x) / 2;
      } else {
        left = (header[i - 1].x + h.x) / 2;
        right = (h.x + header[i + 1].x) / 2;
      }
      return { day: h.day, center: h.x, left: Math.max(0, left), right: right };
    });
  }

  /* ================= 2. 时间轴：纵坐标 → 时刻 ================= */

  /**
   * @param {Array} words
   * @param {number} maxX 只看这个 x 左边的文字（也就是左侧那一列刻度）
   */
  function buildTimeAxis(words, maxX) {
    var hits = [];

    (words || []).forEach(function (w) {
      var text = cleanTimeToken(String(w.text).trim());
      var m = /^([0-9]{1,2})[:.·]([0-9]{2})$/.exec(text);
      if (!m) return;
      var cx = (w.x0 + w.x1) / 2;
      if (maxX !== undefined && cx > maxX) return;
      hits.push({ y: (w.y0 + w.y1) / 2, minutes: parseInt(m[1], 10) * 60 + parseInt(m[2], 10) });
    });

    if (hits.length < 3) return null;
    hits.sort(function (a, b) { return a.y - b.y; });

    /* 截图常常把左边的时间刻度裁掉首位数（10:00 显示成 0:00），
       所以强制让时刻严格递增，靠加 60 分钟把缺掉的十位补回来 */
    for (var i = 1; i < hits.length; i++) {
      var guard = 0;
      while (hits[i].minutes <= hits[i - 1].minutes && guard < 40) {
        hits[i].minutes += 60;
        guard++;
      }
    }

    /* 最小二乘拟合 y → 分钟 */
    var n = hits.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    hits.forEach(function (h) {
      sx += h.y; sy += h.minutes; sxx += h.y * h.y; sxy += h.y * h.minutes;
    });
    var denom = n * sxx - sx * sx;
    if (!denom) return null;

    var k = (n * sxy - sx * sy) / denom;
    var b = (sy - k * sx) / n;

    return {
      points: hits,
      minutesPerPixel: k,
      toMinutes: function (y) { return k * y + b; },
      toY: function (minutes) { return (minutes - b) / k; }
    };
  }

  /* ================= 3. 把一列里的文字切成一个个格子 ================= */

  function splitBlocks(words, options) {
    options = options || {};
    var list = (words || []).slice().sort(function (a, b) { return a.y0 - b.y0; });
    if (!list.length) return [];

    var heights = list.map(function (w) { return w.y1 - w.y0; });
    var lineHeight = median(heights) || 20;

    if (list.length === 1) {
      return [{ words: list, y0: list[0].y0, y1: list[0].y1 }];
    }

    var gaps = [];
    for (var i = 1; i < list.length; i++) {
      gaps.push(Math.max(0, list[i].y0 - list[i - 1].y1));
    }
    var threshold = options.gap || Math.max(median(gaps) * 2.5, lineHeight * 0.8);

    var blocks = [];
    var current = { words: [list[0]], y0: list[0].y0, y1: list[0].y1 };
    blocks.push(current);

    for (var j = 1; j < list.length; j++) {
      if (list[j].y0 - current.y1 > threshold) {
        current = { words: [list[j]], y0: list[j].y0, y1: list[j].y1 };
        blocks.push(current);
      } else {
        current.words.push(list[j]);
        current.y1 = Math.max(current.y1, list[j].y1);
        current.y0 = Math.min(current.y0, list[j].y0);
      }
    }

    return blocks;
  }

  /* 一个格子里的文字按行合并成字符串数组 */
  function groupLines(words, tolerance) {
    var list = (words || []).slice().sort(function (a, b) {
      return a.y0 - b.y0 || a.x0 - b.x0;
    });
    if (!list.length) return [];

    var lineHeight = median(list.map(function (w) { return w.y1 - w.y0; })) || 20;
    var tol = tolerance || lineHeight * 0.6;

    var lines = [];
    var current = null;

    list.forEach(function (w) {
      var cy = (w.y0 + w.y1) / 2;
      if (current && Math.abs(cy - current.cy) <= tol) {
        current.words.push(w);
      } else {
        current = { cy: cy, words: [w] };
        lines.push(current);
      }
    });

    return lines.map(function (line) {
      return line.words
        .sort(function (a, b) { return a.x0 - b.x0; })
        .map(function (w) { return String(w.text).trim(); })
        .filter(function (t) { return t; })
        .join(" ");
    });
  }

  /* ================= 4. 解析一个格子 ================= */

  /**
   * 课表上说"这节课不需要教室"的写法。
   *
   * CUSIS 上体育、实习、线上课之类的会写 "No room required"；
   * 那不是地点，是"没有地点"。要是当楼名收进来，
   * 会平白多出一栋叫「No room required」的楼，之后还得手工删。
   */
  var NO_ROOM_RE = new RegExp(
    "(?:" +
      "no\\s+(?:room|rooms|venue|classroom|classrooms|location)\\s+(?:is\\s+)?" +
        "(?:required|needed|necessary|req['\u2019]?d|reqd)" +
    "|(?:room|venue|classroom|location)\\s+(?:is\\s+)?not\\s+(?:required|needed)" +
      /* 识别漏词时只剩 "No room" 的短版本 */
    "|(?:^|\\s)no\\s+(?:room|rooms|venue|classroom|location)(?=\\s*(?:[.。]|$))" +
    ")[.。]?",
    "i"
  );

  /* "Science Centre L5" → 楼栋 Science Centre，房间 L5 */
  function parseVenue(text) {
    var t = String(text || "")
      .replace(/^\s*(location|venue|地点|地點|教室|上课地点)\s*[:：]\s*/i, "")
      .trim();

    /* "No room required" 先摘掉：它可能单独占一行，
       也可能跟在别的文字后面，先摘再解析剩下的 */
    var noRoom = NO_ROOM_RE.test(t);
    if (noRoom) {
      t = t.replace(NO_ROOM_RE, " ")
        .replace(/\s+/g, " ")
        .trim()
        /* 摘掉之后可能剩个孤零零的句号 */
        .replace(/^[.。]+|[.。]+$/g, "")
        .trim();
    }

    if (!t) return { building: "", room: "", tba: false, noRoom: noRoom };
    if (/^(tba|t\.b\.a\.?|待定|另定|to be announced|to be confirmed|tbc)$/i.test(t)) {
      return { building: "", room: "", tba: true, noRoom: noRoom };
    }

    var parts = t.split(/\s+/);
    if (parts.length >= 2) {
      var last = parts[parts.length - 1];
      /* 房间号长得像 504 / L5 / LT2 / C3 / 301A */
      if (/^[A-Z]{0,3}\d{1,4}[A-Z]?$/i.test(last)) {
        return { building: parts.slice(0, -1).join(" "), room: last, tba: false, noRoom: noRoom };
      }
    }
    return { building: t, room: "", tba: false, noRoom: noRoom };
  }

  /* 把 "BMEG 2410 - -" / "T02" 这类拼成课程全名 */
  /**
   * OCR 有时会把 "Interactive Tutorial" 拆成两行分别输出。
   * 这里把"相邻两行拼起来正好是一个完整类型词"的情况合并回去，
   * 否则这两行谁都拦不住，会一起被当成地点。
   *
   * 只有拼起来**恰好等于**已知类型词才合并，所以
   * "Lee Shau Kee" + "Building LT3" 这种正常折行不受影响。
   */
  function mergeTypeLines(lines) {
    var out = [];

    for (var i = 0; i < lines.length; i++) {
      if (i + 1 < lines.length) {
        var joined = String(lines[i]).trim() + " " + String(lines[i + 1]).trim();
        if (canonicalType(joined)) {
          out.push(joined);
          i++;
          continue;
        }
      }
      out.push(lines[i]);
    }

    return out;
  }

  function composeName(code, section, type) {
    var parts = [];
    if (code) parts.push(section ? code + "-" + section : code);
    if (type) parts.push(type);
    return parts.join(" ");
  }

  function parseBlockLines(lines) {
    lines = mergeTypeLines(lines || []);
    var flat = lines.join(" ");
    var out = {
      code: "", section: "", type: "", start: "", end: "",
      buildingName: "", room: "", tba: false, noRoom: false,
      waiting: /\bwaiting\b|候补|候補|待補|待补/i.test(flat),
      raw: lines.slice()
    };

    /* --- 时间 --- */
    var timeRegex = /([0-9OoIl]{1,2})\s*[:.·]\s*([0-9OoIl]{2})\s*[-–—~～至]\s*([0-9OoIl]{1,2})\s*[:.·]\s*([0-9OoIl]{2})/;
    var tm = timeRegex.exec(cleanTimeToken(flat));
    if (tm) {
      out.start = pad2(parseInt(tm[1], 10)) + ":" + tm[2];
      out.end = pad2(parseInt(tm[3], 10)) + ":" + tm[4];
    }

    /* --- 课程代号：必须是 4 字母 + 4 数字 --- */
    var cm = COURSE_CODE_RE.exec(flat);
    var codeLineIndex = -1;
    if (cm) {
      var digits = fixDigits(cm[2]);
      out.code = /^[0-9]{4}$/.test(digits) ? cm[1] + " " + digits : "";
      out.rawCode = cm[1] + " " + cm[2];

      for (var i = 0; i < lines.length; i++) {
        if (lines[i].indexOf(cm[1]) >= 0 && lines[i].indexOf(cm[2]) >= 0) { codeLineIndex = i; break; }
      }

      /* 代号同一行的破折号后面就是课节号 */
      if (out.code && codeLineIndex >= 0) {
        var after = lines[codeLineIndex].slice(lines[codeLineIndex].indexOf(cm[2]) + cm[2].length);
        var sm = /\b([A-Z]{1,5}[0-9]{0,3})\b/.exec(after.replace(/[-–—]/g, " "));
        if (sm && !isTypeWord(sm[1]) && NON_SECTION.indexOf(lower(sm[1])) === -1) {
          out.section = sm[1];
        }
      }
    }

    /* --- 课节号另起一行的情况（BMEG 2410 - - / T02） --- */
    if (!out.section && codeLineIndex >= 0) {
      for (var k = codeLineIndex + 1; k < lines.length; k++) {
        var token = lines[k].trim();
        if (/^[0-9]/.test(token)) break;
        if (/^[A-Z]{1,5}[0-9]{0,3}$/.test(token) &&
            !isTypeWord(token) && NON_SECTION.indexOf(lower(token)) === -1) {
          out.section = token;
          break;
        }
      }
    }

    /* --- 类型 --- */
    for (var t = 0; t < lines.length; t++) {
      var canon = canonicalType(lines[t]);
      if (canon) { out.type = canon; break; }
    }

    /* 类型被 OCR 拆成两行时上面找不到，退回在整段文字里找。
       按长度从长到短试，"Interactive Tutorial" 要优先于 "Tutorial"。 */
    if (!out.type) {
      var flatLower = lower(flat);
      var byLength = TYPE_WORDS.slice().sort(function (a, b) { return b.length - a.length; });
      for (var t2 = 0; t2 < byLength.length; t2++) {
        var word = byLength[t2];
        if (word.length > 3 && flatLower.indexOf(lower(word)) >= 0) { out.type = word; break; }
      }
    }

    /* --- 地点：时间那一行之后的内容 ---
       OCR 会把地点折成两行（"Lee Shau Kee Building" / "LT2"）。原来靠"长得像
       课节号就排除"的规则会把单独成行的 LT2 当成课节号丢掉，教室号就没了。
       课表的顺序固定是「代号 → 课节 → 类型 → 时间 → 地点」，
       所以只取时间行之后的内容，比按形状猜稳得多。 */
    var timeLineIndex = -1;
    for (var tl = 0; tl < lines.length; tl++) {
      if (/[0-9OoIl]{1,2}\s*[:.·]\s*[0-9OoIl]{2}\s*[-–—~～至]/.test(cleanTimeToken(lines[tl]))) {
        timeLineIndex = tl;
        break;
      }
    }

    var venuePool = timeLineIndex >= 0 ? lines.slice(timeLineIndex + 1) : lines;

    var venueCandidates = venuePool.filter(function (line, idx) {
      var t3 = line.trim();
      if (!t3) return false;
      if (isTypeWord(t3)) return false;
      if (/[0-9OoIl]{1,2}\s*[:.·]\s*[0-9OoIl]{2}/.test(cleanTimeToken(t3))) return false;
      if (/^waiting\b/i.test(t3)) return false;

      /* 只有找不到时间行时，才需要靠形状排掉课节号和代号行 */
      if (timeLineIndex < 0) {
        if (idx === codeLineIndex) return false;
        if (/^[-–—\s]*[A-Z]{1,5}[0-9]{0,3}[-–—\s]*$/.test(t3) &&
            t3.replace(/[-–—\s]/g, "").length <= 5) return false;
      }

      /* 时间行之后的内容里，纯数字也是合法的教室号（104、305、504），
         所以这里要放宽到数字；只在没找到时间行时才要求含字母 */
      if (timeLineIndex >= 0) return /[A-Za-z0-9\u4e00-\u9fa5]/.test(t3);
      return /[A-Za-z\u4e00-\u9fa5]/.test(t3);
    });

    if (venueCandidates.length) {
      /* 地点常常折成两行（"Lee Shau Kee" / "Building LT3"），要拼起来再解析；
         拼完再摘一次课程类型词，防止它被拆成两行漏进来 */
      var venue = parseVenue(stripTypeWords(venueCandidates.join(" ")));
      out.buildingName = venue.building;
      out.room = venue.room;
      out.tba = venue.tba;
      out.noRoom = venue.noRoom;
    }

    out.name = composeName(out.code, out.section, out.type);
    return out;
  }

  /* ================= 5. 整张表的还原 ================= */

  function parseWords(words, options) {
    options = options || {};
    var warnings = [];

    var header = parseWeekdayHeader(words);
    if (header.length < 2) {
      return {
        courses: [], columns: [], timeAxis: null,
        warnings: ["没找到表头里的星期行，无法确定每一列是哪一天。确认截图里包含 Monday…Friday 那一行。"]
      };
    }

    var columns = buildColumns(header);
    var timeAxis = buildTimeAxis(words, columns[0].left);
    if (!timeAxis) {
      warnings.push("没找到左侧的时间刻度，将只用格子内写的时间。");
    }

    var headerBottom = Math.max.apply(null, header.map(function (h) { return h.y1; }));
    var tableLeft = columns[0].left;
    var tableRight = columns[columns.length - 1].right;

    var content = (words || []).filter(function (w) {
      var cx = (w.x0 + w.x1) / 2;
      var cy = (w.y0 + w.y1) / 2;
      if (cy <= headerBottom) return false;
      return cx >= tableLeft && cx <= tableRight;
    });

    var courses = [];
    var rejected = [];

    columns.forEach(function (col) {
      var colWords = content.filter(function (w) {
        var cx = (w.x0 + w.x1) / 2;
        return cx >= col.left && cx < col.right;
      });
      if (!colWords.length) return;

      splitBlocks(colWords, options).forEach(function (block) {
        var lines = groupLines(block.words);
        var item = parseBlockLines(lines);

        /* 收紧判定：必须同时有「4 字母 + 4 数字」的课程代号，和已知的课程类型。
           宁可漏掉，也不要把零碎文字当成课程。
           被丢掉的格子记下来，否则出错时只会看到"少了几条课"而不知道为什么。 */
        if (!isValidCourseCode(item.code) || !item.type) {
          if (rejected.length < 12 && lines.join(" ").trim().length > 6) {
            rejected.push({
              reason: !item.code ? "没有找到 4 字母 + 4 数字的课程代号" : "没有找到课程类型",
              text: lines.join(" / ")
            });
          }
          return;
        }

        item.weekday = col.day;

        if (!item.start && timeAxis) {
          item.start = fmtMinutes(snap5(timeAxis.toMinutes(block.y0)));
          item.end = fmtMinutes(snap5(timeAxis.toMinutes(block.y1)));
          item.timeFromGrid = true;
        }
        if (!item.start || !item.end || hm(item.end) <= hm(item.start)) {
          warnings.push(item.code + " 的时间没读出来，需要手工补。");
          item.needsTime = true;
        }
        if (!item.buildingName && !item.tba && !item.noRoom) {
          warnings.push((item.code || item.name) + " 的地点没读出来。");
        }

        courses.push(item);
      });
    });

    courses.sort(function (a, b) {
      return a.weekday - b.weekday || hm(a.start) - hm(b.start);
    });

    return {
      courses: courses,
      columns: columns,
      timeAxis: timeAxis,
      warnings: warnings,
      rejected: rejected
    };
  }

  /**
   * 给一次识别的结果打分，用来在多种尝试里挑最好的那个。
   *
   * 不能只看课程条数：某种像素处理可能把同一段文字重复识别成好几条
   * 残缺记录，条数反而更多。所以完整（有地点、有时间）的课权重最高。
   */
  function scoreResult(parsed) {
    if (!parsed) return -1;
    var complete = 0;
    (parsed.courses || []).forEach(function (c) {
      if (c.buildingName && c.start && c.end && !c.needsTime) complete++;
    });
    return complete * 10 + (parsed.courses || []).length * 2 + (parsed.timeAxis ? 3 : 0);
  }

  /* 单条课程的质量分，多遍结果撞车时留高的那个 */
  function courseQuality(c) {
    var score = 0;
    if (c.code) score += 4;
    if (c.type) score += 2;
    if (c.buildingName) score += 2;
    if (c.room) score += 1;
    if (!c.needsTime) score += 2;
    return score;
  }

  /**
   * 合并多遍识别的结果。
   *
   * 换一种页面分割模式，读漏的格子往往不一样：这一遍丢了周二那节，
   * 换一遍可能就读出来了。取并集能把这些补回来。
   * 同一条记录按「星期 + 起止时间」或「星期 + 代号 + 课节 + 类型」判定，
   * 撞车时留信息更全的那条。
   */
  function mergeCourses(parsedList) {
    var merged = [];

    function keysOf(c) {
      return [
        c.weekday + "|" + c.start + "|" + c.end,
        c.weekday + "|" + c.code + "|" + c.section + "|" + c.type
      ];
    }

    (parsedList || []).forEach(function (parsed) {
      (parsed.courses || []).forEach(function (course) {
        var keys = keysOf(course);
        var existing = null;

        for (var i = 0; i < merged.length && !existing; i++) {
          var other = keysOf(merged[i]).filter(function (k) { return keys.indexOf(k) >= 0; });
          if (other.length) existing = i;
        }

        if (existing === null) {
          merged.push(course);
        } else if (courseQuality(course) > courseQuality(merged[existing])) {
          merged[existing] = course;
        }
      });
    });

    return merged.sort(function (a, b) {
      return a.weekday - b.weekday || hm(a.start) - hm(b.start);
    });
  }

  function mergeRejected(parsedList) {
    var seen = {};
    var out = [];

    (parsedList || []).forEach(function (parsed) {
      (parsed.rejected || []).forEach(function (item) {
        var key = item.reason + "|" + item.text;
        if (seen[key] || out.length >= 12) return;
        seen[key] = true;
        out.push(item);
      });
    });

    return out;
  }

  /* ================= 6. 楼栋匹配 ================= */

  /* 常见缩写先展开再比对，这样 "Bldg" 和 "Building" 不会被当成两个词 */
  var ABBREVIATIONS = {
    bldg: "building", bldgs: "building", bld: "building",
    intl: "international", acad: "academic", univ: "university",
    ctr: "centre", center: "centre", labs: "laboratory", lab: "laboratory",
    dept: "department", sci: "science", tech: "technology",
    eng: "engineering", stud: "student", admin: "administration",
    med: "medical", meds: "medical"
  };

  /**
   * 两个词算不算同一个。
   *
   * 课表上的名字是缩写版，展开表不可能列全，所以再补一条前缀规则：
   * med / medical、science / sciences、eng / engineering 都算同一个词。
   * 最短要 3 个字母——"Li" 这种两字母的要是也认前缀，
   * 会把 "Li" 和 "Library" 拼到一起。
   */
  function sameWord(a, b) {
    if (a === b) return true;
    var short = a.length <= b.length ? a : b;
    var long = short === a ? b : a;
    if (short.length >= 3 && long.indexOf(short) === 0) return true;
    return nearWord(short, long);
  }

  /**
   * 差一个字母的词也算同一个（只对 5 个字母以上的词开口子）。
   *
   * OCR 最常犯的错就是这个量级：liang → liana、building → bullding、
   * Yasumoto → Yasumoto… 一个字母之差，词还是那个词。
   * 4 个字母以内不开这个口子——hall / hill、ho / hk 差一个字母就是两栋楼了。
   * 长度差也只允许 1，免得拿 "centre" 去凑 "centenary"。
   */
  function nearWord(a, b) {
    if (a.length < 5 || b.length < 5) return false;
    if (Math.abs(a.length - b.length) > 1) return false;
    return editSimilarity(a, b) >= 0.8;
  }

  /**
   * 两个**缩写组**之间容忍一个字母之差。
   *
   * 缩写只有两个字母，`nearWord` 那条"5 个字母以上"的门槛够不着，
   * 于是 "Y.C. Liang Hall" 被 OCR 读成 "V.C. Liang Hall" 就整条匹配不上
   * （Y→V 是最常见的混淆之一，实测确实挂了）。
   *
   * 只对"由连续单字母并起来的组"开口子，普通单词不在此列——
   * `hall` / `hill` 差一个字母仍然是两栋楼，这条底线不能松。
   */
  function looseInitials(a, b) {
    if (a.length < 2 || b.length < 2) return false;
    if (Math.abs(a.length - b.length) > 1) return false;
    var diff = 0;
    var len = Math.min(a.length, b.length);
    for (var i = 0; i < len; i++) {
      if (a.charAt(i) !== b.charAt(i)) diff++;
      if (diff > 1) return false;
    }
    return true;
  }

  /**
   * 把连着出现的单个字母并成一个词。
   *
   * 缩写点名两种写法都常见：地图上是 "Y.C. Liang Hall"，课表上印成
   * "YC. Liang Hall"——前者拆出 y / c / liang / hall 四个词，
   * 后者只有 yc / liang / hall 三个，逐词比对就对不上。
   * 只并"连续两个以上"的单字母（Building A 里孤零零那个 A 保持原样），
   * 而且只并字母、不并数字，免得把 "Block B 1" 黏成 b1。
   */
  function collapseInitials(tokens) {
    var out = [];
    var run = [];
    var short = {};

    /* 除了"并起来的缩写组"，还有一种是**本来就写在一起**的缩写：
       课表/OCR 常把 "Y.C." 写成 "VC"（点号丢了、Y 看成 V），这时它是单独一个词，
       不会被并起来，但仍然是缩写。判据：2–4 个字母、**全是辅音**——
       普通单词（hall / ho / wu）都带元音，不会被卷进来。 */
    function looksInitial(token) {
      return token.length >= 2 && token.length <= 4 && /^[bcdfghjklmnpqrstvwxyz]+$/.test(token);
    }

    function flush() {
      if (run.length >= 2) {
        var merged = run.join("");
        short[merged] = true;       /* 记下哪些词是"并起来的缩写组" */
        out.push(merged);
      } else {
        out = out.concat(run);
      }
      run = [];
    }

    tokens.forEach(function (token) {
      if (token.length === 1 && /[a-z]/.test(token)) {
        run.push(token);
        return;
      }
      flush();
      if (looksInitial(token)) short[token] = true;
      out.push(token);
    });
    flush();
    return { list: out, short: short };
  }

  /**
   * 把一个名字拆成可比较的几种形式。
   * 中英文分开处理：英文按词（并展开缩写），中文连着看。
   */
  function nameForms(text) {
    var raw = String(text || "").toLowerCase().replace(/[\u2019']/g, "");

    var collapsed = collapseInitials((raw.match(/[a-z0-9]+/g) || []).map(function (token) {
      return ABBREVIATIONS[token] || token;
    }));
    var latin = collapsed.list;
    var cjk = (raw.match(/[\u4e00-\u9fa5]+/g) || []).join("");

    return { latin: latin, cjk: cjk, compact: latin.join("") + cjk, short: collapsed.short };
  }

  /* 编辑距离换算成 0–1 的相似度，用来容忍拼写差异 */
  function editSimilarity(a, b) {
    if (a === b) return 1;
    var m = a.length, n = b.length;
    if (!m || !n) return 0;
    if (Math.abs(m - n) / Math.max(m, n) > 0.5) return 0;

    var prev = new Array(n + 1);
    var curr = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;

    for (var i = 1; i <= m; i++) {
      curr[0] = i;
      for (var k = 1; k <= n; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        curr[k] = Math.min(prev[k] + 1, curr[k - 1] + 1, prev[k - 1] + cost);
      }
      var swap = prev; prev = curr; curr = swap;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  /**
   * 给两个名字的像不像打分（0–1）。
   * 从最可靠的判断开始：完全相同 → 一方包含另一方 → 英文词重合 → 拼写近似。
   */
  function nameScore(a, b) {
    if (!a.compact || !b.compact) return 0;
    if (a.compact === b.compact) return 1;

    var short = a.compact.length <= b.compact.length ? a.compact : b.compact;
    var long = short === a.compact ? b.compact : a.compact;
    if (short.length >= 4 && long.indexOf(short) >= 0) {
      return 0.7 + 0.25 * (short.length / long.length);
    }

    if (a.cjk.length >= 2 && b.cjk.length >= 2) {
      if (a.cjk.indexOf(b.cjk) >= 0 || b.cjk.indexOf(a.cjk) >= 0) {
        var s = a.cjk.length <= b.cjk.length ? a.cjk : b.cjk;
        var l = s === a.cjk ? b.cjk : a.cjk;
        return 0.6 + 0.3 * (s.length / l.length);
      }
    }

    var setA = {}, setB = {};
    a.latin.forEach(function (t) { setA[t] = true; });
    b.latin.forEach(function (t) { setB[t] = true; });
    var keysA = Object.keys(setA), keysB = Object.keys(setB);

    if (keysA.length && keysB.length) {
      /* 一对一地配对，同一个词不会被重复算两次 */
      var usedB = {};
      var shared = 0;
      keysA.forEach(function (ta) {
        for (var i = 0; i < keysB.length; i++) {
          if (usedB[keysB[i]]) continue;
          var tb = keysB[i];
          /* 普通单词照旧；缩写组额外容忍一个字母之差（Y.C. 被读成 V.C.） */
          var hit = sameWord(ta, tb) ||
            (a.short[ta] && b.short[tb] && looseInitials(ta, tb));
          if (hit) {
            usedB[keysB[i]] = true;
            shared++;
            return;
          }
        }
      });

      if (shared) {
        var jaccard = shared / (keysA.length + keysB.length - shared);
        var score = 0.35 + 0.5 * jaccard;

        /* 课表上的名字常常是缩得很短的版本：
             "Basic Med Sci Bldg" → "Choh-Ming Li Basic Medical Sciences Building"
           词面上只有 basic / building 一模一样，靠 med→medical、science→sciences
           这两条前缀规则才凑齐。这种情况下 jaccard 会被"目标名字长"拖低，
           但"短的一边几乎全被覆盖"其实是很强的信号，所以再补一次分。
           要求至少对上两个词，否则单独一个 "Building" 也会拿到高分。 */
        var coverage = shared / Math.min(keysA.length, keysB.length);
        if (shared >= 2 && coverage >= 0.8) {
          score = Math.max(score, 0.55 + 0.25 * coverage);
        }
        return score;
      }
    }

    var sim = editSimilarity(a.compact, b.compact);
    return sim >= 0.8 ? sim * 0.75 : 0;
  }

  /**
   * 把识别出来的楼名对应到已录入的楼栋，用模糊匹配。
   *
   * 课表上的写法很少和地图上一字不差：
   *   "Yasumoto Int'l Acad Park" → "Yasumoto International Academic Park"
   *   "Lady Shaw Bldg"           → "Lady Shaw Building"
   *   "Science Centre"           → "Science Centre East Block"（部分匹配）
   *   "碧秋樓"                    → "碧秋樓 Pi Ch'iu Building"（中文部分匹配）
   *
   * @returns {object|null} { id, name, score, exact }，分数低于阈值就当匹配不上
   */
  function bestMatch(query, buildings, min) {
    var list = rankMatch(query, buildings, min);
    return list.length ? list[0] : null;
  }

  /**
   * 所有够像的楼栋，分数高的在前（一格都没有时返回空数组）。
   *
   * 同一栋楼的正式名和别名取最高的那个分，所以一栋楼最多出现一次。
   * 分数相同就保持楼栋原来的顺序（数组排序是稳定的）。
   */
  function rankMatch(query, buildings, min) {
    var out = [];
    var floor = (min === undefined) ? 0.62 : min;

    (buildings || []).forEach(function (b) {
      var score = 0;
      [b.name].concat(b.alias || []).forEach(function (candidate) {
        var s = nameScore(query, nameForms(candidate));
        if (s > score) score = s;
      });
      if (score >= floor) out.push({ id: b.id, name: b.name, score: score, exact: score >= 1 });
    });

    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* 去掉结尾的教室号 / 门牌号："Science Centre L3" → "Science Centre" */
  function stripRoomSuffix(name) {
    var text = String(name || "").trim();
    var parts = text.split(/\s+/);

    if (parts.length >= 2 && /^[A-Z]{0,3}[0-9]{1,4}[A-Z]?$/i.test(parts[parts.length - 1])) {
      return parts.slice(0, -1).join(" ");
    }
    return text;
  }

  /**
   * 把识别出来的楼名对应到已录入的楼栋。
   *
   * 先拿完整名字匹配；匹配不上时再把结尾的教室号去掉试一次。
   * 顺序不能反过来——否则 "Building 10" 这种本身带数字的楼名会被误削成 "Building"。
   * 正常流程里 parseVenue 已经把教室号拆出去了，这里是双保险，
   * 万一有教室号残留在楼名里也能对上。
   */
  function matchBuilding(name, buildings, threshold) {
    var list = rankBuildings(name, buildings, threshold);
    return list.length ? list[0] : null;
  }

  /**
   * 所有够像的楼栋，最像的在第一个——导入界面拿它排下拉框。
   *
   * 课表上写 "Science Centre" 时，东座、西座、大学科学馆可能都过阈值；
   * 只给"最像的那一栋"等于把选择藏起来了，用户还得自己去翻 150 栋找另一栋。
   * 所以这里把够像的全部按分数列出来，最像的排第一（界面里默认选中它），
   * 其余紧跟其后，一眼就能看到"还有哪几栋也说得通"。
   */
  function rankBuildings(name, buildings, threshold) {
    var min = threshold === undefined ? 0.62 : threshold;
    var query = nameForms(name);
    if (!query.compact) return [];

    var direct = rankMatch(query, buildings, min);

    /* 楼名后面可能还粘着教室号，去掉再试一次 */
    var stripped = stripRoomSuffix(name);
    if (stripped === String(name || "").trim()) return direct;

    var loose = rankMatch(nameForms(stripped), buildings, min);
    if (!loose.length) return direct;
    /* 两次都比的时候直接那次一个都没中，就用去掉教室号那次 */
    if (!direct.length) return loose;

    /* 两次的名单并起来，**但直接那次的第一名钉在最前面**——
       matchBuilding 选的就是它，不能让 "Building 10" 被削成 "Building" 反超。
       去掉教室号后新冒出来的那些排在后面（往往是用户真正想选的，
       比如 "Science Centre L3" 去掉 L3 之后，东座、大学科学馆才一起浮出来）。 */
    var seen = {};
    var head = direct[0];
    seen[head.id] = true;

    var tail = direct.slice(1).concat(loose).filter(function (r) {
      if (seen[r.id]) return false;
      seen[r.id] = true;
      return true;
    });
    tail.sort(function (a, b) { return b.score - a.score; });

    return [head].concat(tail);
  }

  /**
   * 导入界面那个"楼栋"下拉框的选项 HTML。
   *
   * 课表上的名字可能同时像好几栋楼（"Science Centre" 就同时像东座、大学科学馆、
   * 科学馆北座/南座），所以够像的全部排在**最上面一组**、带上把握度，
   * 最像的那个默认选中；其余楼栋放在第二组，不跟候选混在一起。
   * 一个候选都没有时才退回成一张平铺的全表（外加"新建楼栋"那一项由调用方补）。
   *
   * 逻辑写在 ocr.js 而不是 app.js：app.js 那层全是 DOM 闭包，自检跑不到，
   * 放这里就能直接断言"哪几个候选、什么顺序、谁被选中"。
   *
   * @param name      课表上写的楼名
   * @param buildings 已录入的楼栋
   * @param opts      { noRoom, escape } —— escape 传 app.js 的转义函数
   * @returns { html, ranked }
   */
  function matchOptions(name, buildings, opts) {
    var options = opts || {};
    var escape = options.escape || function (s) { return String(s); };
    var list = buildings || [];
    var ranked = rankBuildings(name, list);
    var alternates = ranked.slice(1);

    var html = '<option value="">' + (options.noRoom ? "（不需要教室）" : "（未指定）") + "</option>";

    if (!alternates.length) {
      /* 只有一个候选（或一个都没有）：平铺全表，命中的那栋选中 */
      return {
        ranked: ranked,
        html: html + list.map(function (b) {
          return '<option value="' + escape(b.id) + '"' +
            (ranked.length && ranked[0].id === b.id ? " selected" : "") + ">" +
            escape(b.name) + "</option>";
        }).join("")
      };
    }

    var used = {};
    ranked.forEach(function (r) { used[r.id] = true; });

    return {
      ranked: ranked,
      html: html +
        '<optgroup label="都够像（按把握度，选中的是第 1 个）">' +
        ranked.map(function (r, k) {
          return '<option value="' + escape(r.id) + '"' + (k === 0 ? " selected" : "") + ">" +
            escape(r.name) + "　" + Math.round(r.score * 100) + "%</option>";
        }).join("") +
        "</optgroup>" +
        '<optgroup label="其他楼栋">' +
        list.filter(function (b) { return !used[b.id]; }).map(function (b) {
          return '<option value="' + escape(b.id) + '">' + escape(b.name) + "</option>";
        }).join("") +
        "</optgroup>"
    };
  }

  /* ================= 7. 浏览器驱动层 ================= */

  function loadEngine(cdnBase) {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);

    var sources = cdnBase ? [cdnBase].concat(SCRIPT_CDNS) : SCRIPT_CDNS;

    function attempt(i) {
      if (i >= sources.length) {
        return Promise.reject(new Error("加载识别引擎失败，检查网络后重试"));
      }
      return new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = sources[i] + "/tesseract.min.js";
        script.onload = function () {
          if (window.Tesseract) resolve(window.Tesseract);
          else reject(new Error("引擎脚本加载了但不可用"));
        };
        script.onerror = function () { reject(new Error("这个 CDN 不通")); };
        document.head.appendChild(script);
      }).catch(function () { return attempt(i + 1); });
    }

    return attempt(0);
  }

  /**
   * 解码图片并放大。
   *
   * 这里只做放大，不做任何颜色处理——因为不同的课表页面配色差别很大，
   * 用哪种像素处理最好要试过才知道，见 applyVariant()。
   */
  function preprocess(file, options) {
    options = options || {};
    /* 手机截图上的课表字号很小，放大到 2000 像素宽左右识别率最好 */
    var targetWidth = options.targetWidth || 2000;

    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        var scale = Math.min(3.5, Math.max(1, targetWidth / img.width));
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        var ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("这张图片读不出来，换一张试试"));
      };

      img.src = url;
    });
  }

  /* 像素处理方案。顺序就是尝试顺序：最可能对的那个放前面。 */
  var VARIANTS = [
    { id: "local", label: "局部二值化" },
    { id: "chroma", label: "抹掉彩色底" },
    { id: "gray", label: "只转灰度" },
    { id: "contrast", label: "增强对比" }
  ];

  /* 判定"比周围背景暗多少才算文字"（0–255）。取 32 是为了顺手把表格框线
     （白底上的浅灰线，反差约 25）也去掉，只留字。 */
  var LOCAL_MARGIN = 32;

  /**
   * 局部二值化（自适应阈值）：拿"周围一圈的平均亮度"当背景，比它暗一截的算文字。
   *
   * 为什么需要它——原来那套是"又亮又彩色就整片抹白"（见 flattenColorBackgrounds），
   * 对浅色底的大字没问题，但**彩色底上的小字会被误抹**：反锯齿的笔画本来就被底色
   * 染成浅色，一亮就被当成背景抹掉，笔画断成几截。
   * 实测（CUSIS 课表截图）：抹彩色底那遍把绿格子里的课名读出来了，却把星期表头
   * 读成 "Tire Koray TUesdsEy"；灰度那遍反过来，表头清清楚楚、绿格子里一个字没有。
   * 两遍都缺一半，最后一条课也拼不出来。
   *
   * 局部二值化两件都能干：浅绿底（亮度约 194）上的黑字照样是"比背景暗"，
   * 彩底上的反锯齿小字只要比周围暗一截也能保住。
   * 用积分图算邻域均值，2000×2000 也就几十毫秒。
   */
  function localBinarize(data, width, height, radius, margin) {
    var r = radius || 10;
    var floor = margin === undefined ? LOCAL_MARGIN : margin;
    var n = width * height;

    var lum = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var o = i * 4;
      lum[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
    }

    /* 积分图：前缀和之后任意矩形求和都是 O(1) */
    var stride = width + 1;
    var sum = new Float64Array(stride * (height + 1));
    for (var y = 0; y < height; y++) {
      var rowSum = 0;
      for (var x = 0; x < width; x++) {
        rowSum += lum[y * width + x];
        sum[(y + 1) * stride + (x + 1)] = sum[y * stride + (x + 1)] + rowSum;
      }
    }

    for (var yy = 0; yy < height; yy++) {
      var y0 = Math.max(0, yy - r);
      var y1 = Math.min(height - 1, yy + r);
      for (var xx = 0; xx < width; xx++) {
        var x0 = Math.max(0, xx - r);
        var x1 = Math.min(width - 1, xx + r);
        var area = (x1 - x0 + 1) * (y1 - y0 + 1);
        var s = sum[(y1 + 1) * stride + (x1 + 1)] - sum[y0 * stride + (x1 + 1)] -
          sum[(y1 + 1) * stride + x0] + sum[y0 * stride + x0];
        var bg = s / area;
        var idx = yy * width + xx;
        var value = (lum[idx] < bg - floor) ? 0 : 255;
        var p = idx * 4;
        data[p] = data[p + 1] = data[p + 2] = value;
        data[p + 3] = 255;
      }
    }
  }

  /**
   * 按指定方案处理像素。
   *
   * 课表格子常常是浅绿、浅蓝这类彩色底。直接转灰度再去二值化，
   * 背景会和深色文字一起被判成"黑"，字就没了——实拍截图里踩过这个坑。
   * 所以默认先把浅色彩色底整片抹成白色，只留文字。
   */
  function applyVariant(base, variant) {
    var canvas = document.createElement("canvas");
    canvas.width = base.width;
    canvas.height = base.height;

    var ctx = canvas.getContext("2d");
    ctx.drawImage(base, 0, 0);

    try {
      var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      if (variant === "local") localBinarize(image.data, canvas.width, canvas.height);
      else if (variant === "chroma") flattenColorBackgrounds(image.data);
      else if (variant === "contrast") stretchContrast(image.data);
      else toGrayscale(image.data);
      ctx.putImageData(image, 0, 0);
    } catch (err) {
      /* 取不到像素就用原图，至少还能识别纯白底的部分 */
    }

    return canvas;
  }

  /* 浅色的彩色底 → 白；深色文字（不论有没有颜色）保留 */
  function flattenColorBackgrounds(data) {
    var n = data.length / 4;
    for (var p = 0; p < n; p++) {
      var o = p * 4;
      var r = data[o], g = data[o + 1], b = data[o + 2];
      var max = Math.max(r, g, b);
      var min = Math.min(r, g, b);
      var lum = 0.299 * r + 0.587 * g + 0.114 * b;

      var value = (max - min > 25 && lum > 110) ? 255 : lum;
      data[o] = data[o + 1] = data[o + 2] = value;
      data[o + 3] = 255;
    }
  }

  function toGrayscale(data) {
    var n = data.length / 4;
    for (var p = 0; p < n; p++) {
      var o = p * 4;
      var v = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
  }

  function stretchContrast(data) {
    var histogram = new Array(256);
    for (var i = 0; i < 256; i++) histogram[i] = 0;

    var n = data.length / 4;
    var gray = new Uint8ClampedArray(n);

    for (var p = 0; p < n; p++) {
      var o = p * 4;
      var v = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
      gray[p] = v;
      histogram[v]++;
    }

    var lowTarget = n * 0.02;
    var highTarget = n * 0.98;
    var acc = 0, lo = 0, hi = 255;

    for (var a = 0; a < 256; a++) {
      acc += histogram[a];
      if (acc >= lowTarget) { lo = a; break; }
    }
    acc = 0;
    for (var b = 255; b >= 0; b--) {
      acc += histogram[b];
      if (acc >= n - highTarget) { hi = b; break; }
    }
    if (hi - lo < 20) { lo = 0; hi = 255; }

    var span = hi - lo;
    for (var q = 0; q < n; q++) {
      var out = ((gray[q] - lo) * 255) / span;
      out = out < 0 ? 0 : out > 255 ? 255 : out;
      var idx = q * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = out;
      data[idx + 3] = 255;
    }
  }

  /* Tesseract 的 TSV 输出格式跨版本最稳定，就从它取词和坐标 */
  function wordsFromTsv(tsv) {
    var out = [];
    String(tsv || "").split("\n").forEach(function (line, index) {
      if (index === 0) return;
      var cells = line.split("\t");
      if (cells.length < 12) return;
      if (cells[0] !== "5") return;                 /* level 5 = 词 */

      var conf = parseFloat(cells[10]);
      var text = cells.slice(11).join("\t").trim();
      if (!text || (conf === conf && conf < 30)) return;

      var x0 = Number(cells[6]), y0 = Number(cells[7]);
      var width = Number(cells[8]), height = Number(cells[9]);
      if (!isFinite(x0) || !isFinite(y0) || !isFinite(width) || !isFinite(height)) return;

      out.push({ text: text, x0: x0, y0: y0, x1: x0 + width, y1: y0 + height, conf: conf });
    });
    return out;
  }

  function pushWord(out, raw, bbox, confidence) {
    var text = String(raw || "").trim();
    if (!text) return;
    var conf = Number(confidence);
    if (isFinite(conf) && conf < 30) return;
    if (!bbox || typeof bbox.x0 !== "number" || typeof bbox.y0 !== "number") return;
    out.push({ text: text, x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1, conf: conf });
  }

  /**
   * 从识别结果里取词。
   *
   * Tesseract.js v5 改了默认输出：tsv 不再默认生成，只给 blocks。
   * 所以这里按 TSV → words → lines → blocks 依次兜底，哪个版本都不会空手而归。
   */
  function extractWords(data) {
    if (!data) return [];

    var words = wordsFromTsv(data.tsv);
    if (words.length) return words;

    var out = [];

    if (Array.isArray(data.words)) {
      data.words.forEach(function (w) { pushWord(out, w.text, w.bbox, w.confidence); });
      if (out.length) return out;
    }

    if (Array.isArray(data.lines)) {
      data.lines.forEach(function (line) {
        (line.words || []).forEach(function (w) { pushWord(out, w.text, w.bbox, w.confidence); });
      });
      if (out.length) return out;
    }

    (data.blocks || []).forEach(function (block) {
      (block.paragraphs || []).forEach(function (para) {
        (para.lines || []).forEach(function (line) {
          (line.words || []).forEach(function (w) { pushWord(out, w.text, w.bbox, w.confidence); });
        });
      });
    });
    return out;
  }

  /* v5 必须显式声明要哪些输出，否则 tsv 是空的 */
  var OUTPUT = { text: true, tsv: true, blocks: true };

  async function recognizeOnce(worker, canvas, psm) {
    await worker.setParameters({
      tessedit_pageseg_mode: String(psm),
      preserve_interword_spaces: "1"
    });
    const result = await worker.recognize(canvas, {}, OUTPUT);
    const data = result.data || {};
    return { words: extractWords(data), text: data.text || "" };
  }

  /* 建 worker 时要把语言包下下来，站点不通就换下一个 */
  async function createWorker(Tesseract, lang, langPath, logger) {
    const paths = langPath ? [langPath].concat(LANG_PATHS) : LANG_PATHS;
    let lastError = null;

    for (let i = 0; i < paths.length; i++) {
      try {
        return await Tesseract.createWorker(lang, 1, { logger: logger, langPath: paths[i] });
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("下载识别模型失败，检查网络后重试");
  }

  /**
   * 完整流程：图片 → 预处理 → OCR → 结构化课程
   * @param {File|Blob} file
   * @param {object} options { lang, cdnBase, langPath, onProgress, onStage }
   */
  async function run(file, options) {
    options = options || {};
    const report = options.onProgress || function () {};

    report("正在处理图片", 0.02);
    const canvas = await preprocess(file, options);

    report("正在加载识别引擎", 0.08);
    const Tesseract = await loadEngine(options.cdnBase);

    report("正在下载识别模型", 0.12);
    const worker = await createWorker(Tesseract, options.lang || "eng", options.langPath, function (m) {
      if (m && m.status === "loading language traineddata") report("正在下载识别模型", 0.12 + (m.progress || 0) * 0.2);
      if (m && m.status === "initializing api") report("正在初始化识别引擎", 0.34);
    });

    try {
      /* 用哪种像素处理、哪种页面分割模式最好，因图和引擎版本而异。
         同一个像素方案把三种分割模式都跑一遍再取并集——换一遍读漏的格子
         往往不一样，取并集能把丢掉的课补回来。这个方案能出结果就不再试别的。 */
      const MODES = [6, 4, 11];
      let best = null;
      let tries = 0;
      let result = null;

      for (let v = 0; v < VARIANTS.length && !result; v++) {
        const variant = VARIANTS[v];
        const prepared = applyVariant(canvas, variant.id);
        const parsedList = [];

        for (let i = 0; i < MODES.length; i++) {
          tries++;
          report("正在识别（" + variant.label + " · 第 " + (i + 1) + "/" + MODES.length + " 遍）",
            Math.min(0.9, 0.1 + tries * 0.09));

          const attempt = await recognizeOnce(worker, prepared, MODES[i]);
          const parsed = parseWords(attempt.words, options);
          parsed.words = attempt.words;
          parsed.text = attempt.text;
          parsed.mode = MODES[i];
          parsed.variant = variant.label;
          parsedList.push(parsed);

          if (!best || scoreResult(parsed) > scoreResult(best)) best = parsed;
        }

        const merged = mergeCourses(parsedList);
        if (merged.length) {
          /* 报告信息取识别得最好那一遍的，课程用并集 */
          const lead = parsedList.reduce(function (a, b) {
            return scoreResult(b) > scoreResult(a) ? b : a;
          });
          result = Object.assign({}, lead, {
            courses: merged,
            rejected: mergeRejected(parsedList)
          });
        }
      }

      if (!result) result = Object.assign({}, best, { tries: tries });

      result.tries = tries;
      result.canvas = canvas;
      result.wordCount = (result.words || []).length;
      return result;
    } finally {
      await worker.terminate();
    }
  }

  OP.Ocr = {
    SCRIPT_CDNS: SCRIPT_CDNS,
    ABBREVIATIONS: ABBREVIATIONS,
    DEFAULT_LANG_PATH: DEFAULT_LANG_PATH,
    LANG_PATHS: LANG_PATHS,
    VARIANTS: VARIANTS,
    applyVariant: applyVariant,
    flattenColorBackgrounds: flattenColorBackgrounds,
    localBinarize: localBinarize,
    looseInitials: looseInitials,
    toGrayscale: toGrayscale,
    stretchContrast: stretchContrast,
    weekdayOf: weekdayOf,
    parseWeekdayHeader: parseWeekdayHeader,
    buildColumns: buildColumns,
    buildTimeAxis: buildTimeAxis,
    splitBlocks: splitBlocks,
    groupLines: groupLines,
    parseVenue: parseVenue,
    COURSE_CODE_RE: COURSE_CODE_RE,
    fixDigits: fixDigits,
    isValidCourseCode: isValidCourseCode,
    stripTypeWords: stripTypeWords,
    mergeTypeLines: mergeTypeLines,
    canonicalType: canonicalType,
    phraseKey: phraseKey,
    isTypeWord: isTypeWord,
    parseBlockLines: parseBlockLines,
    parseWords: parseWords,
    scoreResult: scoreResult,
    courseQuality: courseQuality,
    mergeCourses: mergeCourses,
    mergeRejected: mergeRejected,
    nameForms: nameForms,
    nameScore: nameScore,
    editSimilarity: editSimilarity,
    sameWord: sameWord,
    collapseInitials: collapseInitials,
    stripRoomSuffix: stripRoomSuffix,
    matchBuilding: matchBuilding,
    rankBuildings: rankBuildings,
    matchOptions: matchOptions,
    wordsFromTsv: wordsFromTsv,
    extractWords: extractWords,
    preprocess: preprocess,
    loadEngine: loadEngine,
    run: run
  };
})(window.OP);
