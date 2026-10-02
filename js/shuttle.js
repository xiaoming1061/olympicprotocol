/* 校巴乘坐规划
 *
 * 数据在 data/shuttle.js（路线、有序站点、坐标、海拔、发车分钟）。
 * 这里只做"能不能坐、要多久、值不值得"：
 *
 *   走到上车站 → 等车 → 坐车 → 下车走到目的地
 *
 * 几条必须说清楚的规矩：
 *
 * 1. **车站就近**。上车站按"从这里走过去要多久"排序，取最近的；
 *    下车站按"从这里走到目的地要多久"排序，取离目的地最近的。
 *    最近的那个站如果没有车能坐，才退到第二近的。
 * 2. **海拔算进去**。车站和楼栋都有海拔：走路那段按"1 米爬升 ≈ N 米平路"
 *    折算（和页面算步行时间用的是同一个 climbFactor）；坐车那段把高差
 *    算进实际路程（√(水平² + 高差²)）。爬山校园里这条最要紧——
 *    同一个站，从山上走下去和从山下走上去，时间能差好几倍。
 * 3. **发车时间指"从该路线第一站开出"**，官网/路线图给的就是这个。
 *    所以到了后面的站要加上"首站 → 该站"的行驶时间，才是车到这个站的时刻。
 * 4. 行驶时间用站点之间的距离估算（乘道路系数），没有真实路网，只是量级参考。
 * 5. **所有路线都是单向的，不能绕回去**。到了终点站所有人必须下车——
 *    比如 3 号线从"逸夫书院（下行）"坐不到"科学馆"，因为科学馆在这条线的前段，
 *    而车开到终点（大学站广场）就清客了。
 *    要往回走只能换乘另一条线，或者走路。
 * 6. **公众假期按校历算**（data/holidays.js，来自教务处 2026-27 校历）：
 *    假期那天星期一至六的线全停，只剩假日线 H。停课日（入学资讯日、大会）
 *    不是假期，校巴照常开。教学日 / 非教学日仍然算不出来，受影响的站点
 *    会在结果里标出来，让人自己确认。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  var DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  var ROAD_FACTOR = 1.15;       // 站点直线距离 → 校巴实际走的路
  var DWELL_MIN = 0.25;         // 每停一站的时间
  /* 上车那一头走太远就没意义；下车那一头放宽，让更多线路能显示出来 */
  var MAX_ACCESS_BOARD = 650;
  var MAX_ACCESS_ALIGHT = 1200;
  var MAX_BOARD_CANDIDATES = 4;
  var MAX_ALIGHT_CANDIDATES = 6;
  var DEFAULT_BUS_SPEED = 330;  // 米/分钟，约 20 km/h（含停站）
  var DEFAULT_CLIMB = 8;        // 1 米爬升 ≈ 几米平路

  function stopTable() { return OP.SHUTTLE_STOPS || {}; }
  function routeTable() { return OP.SHUTTLE_ROUTES || []; }

  function stopIds(route) {
    return (route.stops || []).map(function (s) {
      return typeof s === "string" ? s : s.id;
    });
  }

  function stopNote(route, id) {
    var hit = (route.stops || []).filter(function (s) {
      return typeof s === "object" && s.id === id;
    })[0];
    return hit ? (hit.note || "") : "";
  }

  function hm(text) {
    var p = String(text || "0:00").split(":");
    return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0);
  }

  function positive(value, fallback) {
    var n = Number(value);
    return isFinite(n) && n >= 0 ? n : fallback;
  }

  function busSpeed(settings) {
    var v = Number((settings || {}).busSpeed);
    return isFinite(v) && v > 0 ? v : DEFAULT_BUS_SPEED;
  }

  /* climbFactor：0 是有效值（表示不考虑高差），只有缺字段或负数才回退 */
  function climbFactor(settings) {
    var v = Number((settings || {}).climbFactor);
    return isFinite(v) && v >= 0 ? v : DEFAULT_CLIMB;
  }

  function elevationOf(point) {
    return point && typeof point.elevation === "number" ? point.elevation : null;
  }

  /**
   * 走路时间：从 a 走到 b。
   *
   * 和页面算步行时间同一套算法——水平距离乘路程系数，再把爬升按
   * "1 米爬升 ≈ N 米平路"折成等效距离。走下山不算爬升。
   */
  function walkMinutes(a, b, settings) {
    if (!a || !b) return null;
    var straight = OP.Geo.haversine(a, { lat: b.lat, lng: b.lng });
    if (straight === null) return null;

    var detour = Number((settings || {}).detourFactor) || 1.3;
    var speed = Number((settings || {}).walkingSpeed) || 75;
    var distance = straight * detour;

    var rise = 0;
    var ea = elevationOf(a);
    var eb = elevationOf(b);
    if (ea !== null && eb !== null) rise = Math.max(0, eb - ea);

    return (distance + rise * climbFactor(settings)) / speed;
  }

  /**
   * 坐车时间：从 a 站坐到 b 站那一段。
   * 高差算进实际路程（3D 距离）——山路爬升就是实打实多走的路。
   */
  function legMinutes(a, b, settings) {
    if (!a || !b) return null;
    var straight = OP.Geo.haversine(a, { lat: b.lat, lng: b.lng });
    if (straight === null) return null;

    var horizontal = straight * ROAD_FACTOR;
    var ea = elevationOf(a);
    var eb = elevationOf(b);
    var rise = (ea !== null && eb !== null) ? Math.abs(eb - ea) : 0;
    var length = Math.sqrt(horizontal * horizontal + rise * rise);

    return length / busSpeed(settings);
  }

  /**
   * 从第 i 站坐到第 j 站要多久。
   *
   * **只能往后坐**：j 必须排在 i 后面。所有路线到终点都清客，
   * 不存在"绕一圈回来"这种事。
   */
  function rideMinutes(route, i, j, settings) {
    var ids = stopIds(route);
    var table = stopTable();
    if (i >= j) return null;

    var order = [];
    for (var k = i; k <= j; k++) order.push(k);

    var total = 0;
    for (var p = 0; p < order.length - 1; p++) {
      var one = legMinutes(table[ids[order[p]]], table[ids[order[p + 1]]], settings);
      if (one === null) return null;
      total += one;
      if (p > 0) total += DWELL_MIN;   // 中间站停一下
    }
    return total;
  }

  /**
   * 这一天算星期几。
   *
   * 校历里的公众假期 / 大学假期要换成 "holiday" 这个键：那些天星期一至六的线
   * 一律停开（数据里写的是"公眾假期停開"），只有假日线 H 开——它的服务时段
   * 本来就是 { days: ["sun","holiday"] }。
   * 停课日（入学资讯日、大会）不算假期，校巴照常，所以还是按星期几算。
   */
  function dayKeyFor(date) {
    var planner = OP.Planner;
    var day = planner && planner.holidayOn ? planner.holidayOn(date) : null;
    if (day && day.kind === "holiday") return "holiday";
    return DAY_KEYS[date.getDay()];
  }

  /* 这条路线今天开不开 */
  function sessionFor(route, date) {
    var key = dayKeyFor(date);
    return (route.sessions || []).filter(function (s) {
      return (s.days || []).indexOf(key) >= 0;
    })[0] || null;
  }

  function runsOn(route, date) {
    return !!sessionFor(route, date);
  }

  /**
   * 此刻在不在服务时间内。
   *
   * 两个条件：今天开，而且当前时刻落在服务时段里。
   * H 线只在星期日及公众假期开、N 线只在 19:00 之后——白天看路线页时
   * 它们都算"停运"，界面会把它们折叠起来。
   */
  function runsNow(route, now) {
    var session = sessionFor(route, now);
    if (!session) return false;
    var minutes = now.getHours() * 60 + now.getMinutes();
    return minutes >= hm(session.from) && minutes <= hm(session.to);
  }

  /* 从 after 起，这条路线（首站）接下来的发车时刻 */
  function nextDepartures(route, after, count) {
    var out = [];
    var session = sessionFor(route, after);
    if (!session) return out;

    var limit = hm(session.to);
    var from = hm(session.from);
    var minutes = route.everyHour || [];

    var cur = new Date(after.getTime());
    cur.setSeconds(0, 0);
    if (cur.getTime() < after.getTime()) cur = new Date(cur.getTime() + 60000);

    for (var step = 0; step < 60 * 6 && out.length < count; step++) {
      var now = cur.getHours() * 60 + cur.getMinutes();
      if (now > limit) break;
      if (now >= from && minutes.indexOf(cur.getMinutes()) >= 0) {
        out.push(new Date(cur.getTime()));
      }
      cur = new Date(cur.getTime() + 60000);
    }
    return out;
  }

  /**
   * 把站点附注翻译成可判断的规则。
   *
   * 两类条件：
   *   1. 「逢 00 分開出的班次才停」/「逢 31 至 00 分開出的班次才停」
   *      —— 说的是"哪几班车停"，用发车分钟就能精确判断；
   *   2. 「只在教學日」/「只在非教學日」
   *      —— 取决于校历，程序算不出来，只能标出来让人确认。
   */
  function noteRules(note) {
    var text = String(note || "");
    var rules = { minutes: null, dayType: "" };

    if (text.indexOf("非教學日") >= 0) rules.dayType = "nonTeaching";
    else if (text.indexOf("教學日") >= 0) rules.dayType = "teaching";

    var range = /逢\s*(\d{1,2})\s*至\s*(\d{1,2})\s*分/.exec(text);
    if (range) {
      var from = parseInt(range[1], 10);
      var to = parseInt(range[2], 10);
      rules.minutes = [];
      for (var i = from; i < 60; i++) rules.minutes.push(i);
      for (var j = 0; j <= to; j++) rules.minutes.push(j);
      return rules;
    }

    var single = /逢\s*(\d{1,2})\s*分/.exec(text);
    if (single) rules.minutes = [parseInt(single[1], 10) % 60];
    return rules;
  }

  /* 这一班车停不停那个站 */
  function runStops(rules, departure) {
    if (!rules || !rules.minutes) return true;
    return rules.minutes.indexOf(departure.getMinutes()) >= 0;
  }

  /**
   * 按"走过去要多久"排的候选车站（含海拔），最近的在前。
   *
   * 注意排的是**时间**不是直线距离：同一个站，从山上走下去和从山下走上去
   * 差好几倍，用直线距离排会挑错。
   */
  function nearbyStops(point, settings, maxMeters, limit) {
    var table = stopTable();
    var out = [];
    Object.keys(table).forEach(function (id) {
      var s = table[id];
      if (s.lat === null || s.lng === null) return;
      var straight = OP.Geo.haversine(point, { lat: s.lat, lng: s.lng });
      if (straight === null || straight > maxMeters) return;
      var minutes = walkMinutes(point, s, settings);
      if (minutes === null) return;
      out.push({ id: id, stop: s, distance: straight, minutes: minutes });
    });
    out.sort(function (a, b) {
      if (a.minutes !== b.minutes) return a.minutes - b.minutes;
      return a.distance - b.distance;
    });
    return limit ? out.slice(0, limit) : out;
  }

  /**
   * 给一段行程找校巴方案。
   *
   * 不再算"哪一班车几点到"——校巴到站时间太不稳，报了反而误导。
   * 这里只给**稳定的那部分**：哪几个站、走多久、车程多久、上车下车各走多久、
   * 这条线大概几分钟一班。
   *
   * @param from     起点 { lat, lng, elevation }
   * @param to       终点 { lat, lng, elevation }
   * @param when     哪一天（只用来看星期几，决定哪些线开）
   * @param walkMin  走路要多少分钟（用来比较坐车划不划算）
   * @param settings 设置
   * @returns { board, alight, groups, reason }
   *          groups 里每条线一个：{ route, board, alight, walkBeforeMin, rideMin,
   *          walkAfterMin, totalMin, saves, headwayMin, caveat, boardNote, alightNote }
   */
  function plan(from, to, when, walkMin, settings) {
    var empty = { board: null, alight: null, groups: [], reason: "" };
    if (!from || !to || !when) return empty;

    var boards = nearbyStops(from, settings, MAX_ACCESS_BOARD, MAX_BOARD_CANDIDATES);
    var alights = nearbyStops(to, settings, MAX_ACCESS_ALIGHT, MAX_ALIGHT_CANDIDATES);
    if (!boards.length || !alights.length) {
      empty.reason = "附近没有校巴站";
      return empty;
    }

    var combos = [];
    var connected = 0;   // 有多少对"上车站 → 下车站"在顺序上说得通

    boards.forEach(function (b, bRank) {
      alights.forEach(function (a, aRank) {
        if (a.id === b.id) return;
        var walkAfter = walkMinutes(a.stop, to, settings);
        if (walkAfter === null) return;

        routeTable().forEach(function (route) {

          var ids = stopIds(route);
          var i = ids.indexOf(b.id);
          var j = ids.indexOf(a.id);
          if (i < 0 || j < 0 || i >= j) return;

          var ride = rideMinutes(route, i, j, settings);
          if (ride === null) return;
          connected++;

          var total = b.minutes + ride + walkAfter;
          combos.push({
            route: route,
            board: b,
            alight: a,
            boardRank: bRank,
            alightRank: aRank,
            walkBeforeMin: b.minutes,
            rideMin: ride,
            walkAfterMin: walkAfter,
            totalMin: total,
            headwayMin: headwayOf(route),
            runningNow: runsNow(route, when),
            caveat: noteRules(stopNote(route, b.id)).dayType ||
              noteRules(stopNote(route, a.id)).dayType,
            boardNote: stopNote(route, b.id),
            alightNote: stopNote(route, a.id),
            saves: (walkMin === null || walkMin === undefined) ? null : walkMin - total
          });
        });
      });
    });

    /* 同一条线只留最合适的那一组：同一趟车在近站和远站都上得去，
       列两遍只是重复，真正有用的是"还有哪条线能坐" */
    combos.sort(function (a, b) {
      /* 现在在开的排前面，停运的自动沉到底下（界面会把它们折叠起来） */
      if (a.runningNow !== b.runningNow) return a.runningNow ? -1 : 1;
      if (a.totalMin !== b.totalMin) return a.totalMin - b.totalMin;
      return (a.boardRank + a.alightRank) - (b.boardRank + b.alightRank);
    });

    var seenRoute = {};
    var groups = combos.filter(function (c) {
      if (seenRoute[c.route.no]) return false;
      seenRoute[c.route.no] = true;
      return true;
    });

    var reason = "";
    if (!groups.length) {
      reason = connected
        ? "这段没有班次"
        : "没有线路从上车站坐到下车站（校巴单向）";
    }

    return {
      board: boards[0],
      alight: alights[0],
      groups: groups,
      reason: reason
    };
  }

  /* 这条线大概几分钟一班（按发布的开出分钟数推） */
  function headwayOf(route) {
    var minutes = (route && route.everyHour) || [];
    if (!minutes.length) return null;
    return Math.round(60 / minutes.length);
  }

  /* 今日还有哪些路线在开 */
  function routesOn(date) {
    return routeTable().filter(function (r) { return runsOn(r, date); });
  }

  OP.Shuttle = {
    plan: plan,
    routesOn: routesOn,
    runsOn: runsOn,
    sessionFor: sessionFor,
    dayKeyFor: dayKeyFor,
    nextDepartures: nextDepartures,
    rideMinutes: rideMinutes,
    runsNow: runsNow,
    legMinutes: legMinutes,
    walkMinutes: walkMinutes,
    nearbyStops: nearbyStops,
    stopIds: stopIds,
    stopNote: stopNote,
    noteRules: noteRules,
    runStops: runStops,
    headwayOf: headwayOf,
    MAX_ACCESS_BOARD: MAX_ACCESS_BOARD,
    MAX_ACCESS_ALIGHT: MAX_ACCESS_ALIGHT,
    DEFAULT_BUS_SPEED: DEFAULT_BUS_SPEED
  };
})(window.OP);
