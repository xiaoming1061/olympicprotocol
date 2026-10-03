/* 界面控制：把课表、定位、语音、路线串起来 */

(function () {
  "use strict";

  var OP = window.OP;
  var P = OP.Planner;
  var Geo = OP.Geo;
  var Store = OP.Store;

  var data = Store.load();
  /* load() 会把默认楼栋里新补的楼并进本地那份，启动后提示一句 */
  var pendingBuildingSync = Store.lastSync();
  var state = {
    view: "today",
    now: new Date(),
    position: null,
    locating: false,
    geoError: "",
    fired: Store.loadFired(),
    lastCheck: 0,
    hintShown: false,
    places: [],
    placesStatus: "未搜索",
    placesRaw: null,
    /* 校区楼栋列表默认收起，只看前几栋 */
    buildingListExpanded: false,
    ocr: { courses: [], warnings: [], busy: false }
  };

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  /**
   * 设置页里「从地图读取附近楼栋」和「校区楼栋」两张卡片默认藏起来。
   *
   * 日常用不到（楼栋数据已经内置好了），但调试时很有用：补坐标、从 OSM 搜楼、
   * 改别名、拉海拔都在这两张卡上。**代码和 DOM 全都留着**，只是想看时：
   *   1. 把这里改成 true，或者
   *   2. 直接去掉 index.html 里那两处 hidden 属性。
   */
  var SHOW_BUILDING_TOOLS = false;

  function esc(text) {
    return String(text === undefined || text === null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /**
   * 当前跑的是哪一次构建。
   *
   * 部署脚本会给 js/css 的地址加一个 ?v=xxx 的时间戳，直接从 script 标签上
   * 读回来就行——不用再单独维护一个"构建号"，省得两边对不上。
   * 本地直接打开源码时没有这个参数，就显示「本地」。
   */
  function buildStamp() {
    var tags = document.querySelectorAll("script[src]");
    for (var i = 0; i < tags.length; i++) {
      var hit = /[?&]v=([^&"']+)/.exec(tags[i].getAttribute("src") || "");
      if (hit) return hit[1];
    }

    /* 新架构：页面由本仓库直接托管在 olympicprotocol.com，没有构建步骤，
       也就没有 ?v=。退回用**页面自身的 Last-Modified**——GitHub Pages 会返回
       真实的发布时间（实测 2026-10-03 08:16:32 GMT），零维护，
       而且不会像写死一个版本号那样悄悄过期。 */
    if (location.protocol !== "file:") {
      var t = Date.parse(document.lastModified);
      if (!isNaN(t)) {
        var d = new Date(t);
        var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
        return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
          " " + p2(d.getHours()) + ":" + p2(d.getMinutes());
      }
    }

    return "本地";
  }

  /* ---------- 页尾留白 ----------
   * 底部导航是固定定位的，会盖住页尾内容。
   * 先按它实际占掉的高度预留，渲染完再核对一次"滑到底时最后一个卡片
   * 会不会被盖住"，会就继续加大。只按高度估算是不够的——
   * 不同浏览器算出来的视口高度不一样，总会差一截。
   */

  var MAX_BOTTOM_SPACE = 480;

  /* 校区楼栋列表收起时显示几栋 */
  var BUILDING_PREVIEW = 5;

  /* 读当前生效的留白值。不能只看内联样式——初始时它是空的，
     会被当成 0，反而把 CSS 里那个偏大的兜底值覆盖成更小的。 */
  function currentBottomSpace() {
    var root = document.documentElement;
    var inline = parseFloat(root.style.getPropertyValue("--bottom-space"));
    if (!isNaN(inline)) return inline;
    return parseFloat(window.getComputedStyle(root).getPropertyValue("--bottom-space")) || 0;
  }

  function setBottomSpace(px) {
    var current = currentBottomSpace();
    var next = Math.min(MAX_BOTTOM_SPACE, px);
    if (next > current) {
      document.documentElement.style.setProperty("--bottom-space", Math.round(next) + "px");
    }
  }

  function measureBottomSpace() {
    var bar = document.querySelector(".tabbar");
    if (!bar) return;

    var barTop = bar.getBoundingClientRect().top;
    var occupied = Math.max(0, window.innerHeight - barTop);
    if (occupied > 0) setBottomSpace(occupied + 28);
  }

  /* 把"滑到最底部时最后一个卡片的位置"算出来，和导航栏顶端比一比。
     不用真的滚动页面就能算，所以不会闪。 */
  function ensureBottomClearance() {
    var bar = document.querySelector(".tabbar");
    var active = document.querySelector(".view.is-active");
    if (!bar || !active) return;

    var cards = active.querySelectorAll(".card");
    var last = null;
    for (var i = cards.length - 1; i >= 0; i--) {
      if (cards[i].offsetParent !== null) { last = cards[i]; break; }
    }
    if (!last) return;

    var root = document.documentElement;
    var docBottom = last.getBoundingClientRect().bottom + window.scrollY;
    var maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
    var bottomAtEnd = docBottom - maxScroll;
    var barTop = bar.getBoundingClientRect().top;

    var shortfall = Math.ceil(bottomAtEnd + 16 - barTop);
    if (shortfall > 0) {
      setBottomSpace(currentBottomSpace() + shortfall);
    }
  }

  var clearanceTimer = null;

  function scheduleClearanceCheck() {
    window.clearTimeout(clearanceTimer);
    clearanceTimer = window.setTimeout(ensureBottomClearance, 120);
  }

  /* ================= 位置 ================= */

  function effectivePosition() {
    var sim = data.settings.simulate;
    if (sim && typeof sim.lat === "number") {
      return { lat: sim.lat, lng: sim.lng, elevation: sim.elevation, simulated: true };
    }
    return state.position;
  }

  /* 给一个坐标补上海拔。查不到就留着不管，按平地算，
     不影响其它功能——海拔只是让时间更准，不是必需项。 */
  function fillElevation(target, onDone) {
    if (!target || typeof target.lat !== "number") return;
    if (typeof target.elevation === "number") return;

    OP.Elevation.at(target.lat, target.lng).then(function (value) {
      if (typeof value !== "number") return;
      target.elevation = value;
      if (onDone) onDone();
    }).catch(function () { /* 查不到就算了 */ });
  }

  function positionHint() {
    if (data.settings.simulate) return "模拟位置";
    if (state.position) return "定位正常";
    if (state.geoError) return "定位不可用";
    return "定位未启用";
  }

  /* ================= 提示条 ================= */

  /**
   * 提示条。
   *
   * 用法上有一条纪律（Hallmark 的微交互规范）：**结果用户看得见的事，别弹成功提示**
   * ——保存完列表就变了、清空完列表就空了，再弹一条"已完成"只是噪音。
   * 提示条留给三类：失败、异步且结果不可见（比如"已复制"）、以及**可撤销**的操作。
   *
   * @param action { label, onAction } 可选：给提示条挂一个按钮（撤销用）
   */
  /* 同时最多留几条提示条。语音播报、删课撤销、导入结果这些挤在一起时，
     不加限制能把整页占满——超过就把最老的挤掉。 */
  var MAX_TOASTS = 3;

  function toast(title, body, kind, action) {
    var wrap = $("#toasts");
    var el = document.createElement("div");
    el.className = "toast" + (kind ? " is-" + kind : "");
    /* 文字包一层：外层是 flex，撤销按钮才好摆到右边去 */
    el.innerHTML = '<div class="toast-text"><strong>' + esc(title) + "</strong>" +
      (body ? esc(body) : "") + "</div>";

    var life = 6500;
    if (action && action.label && typeof action.onAction === "function") {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = action.label;
      btn.addEventListener("click", function () {
        action.onAction();
        remove();
      });
      el.appendChild(btn);
      /* 撤销的窗口给足一点：技能建议 5–10 秒 */
      life = 9000;
    }

    wrap.appendChild(el);
    while (wrap.children.length > MAX_TOASTS) {
      wrap.removeChild(wrap.firstElementChild);
    }

    var timer = window.setTimeout(remove, life);
    function remove() {
      window.clearTimeout(timer);
      el.style.transition = "opacity var(--dur-hover) var(--ease-out)";
      el.style.opacity = "0";
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 200);
    }
  }

  /* ================= 页面内确认弹窗 =================
   * 不用 window.confirm()：内置浏览器和 App 里的 WebView 常把它静默屏蔽，
   * 结果就是点按钮"完全没反应"——不报错，只是永远返回 false。 */

  var pendingConfirm = null;

  /* 确认框打开前谁在焦点上：关掉之后要还回去，键盘用户不会"掉到页面顶部" */
  var confirmReturnFocus = null;

  function askConfirm(message, onOk) {
    pendingConfirm = onOk || null;
    $("#confirmText").textContent = message;
    $("#confirmBox").hidden = false;
    confirmReturnFocus = document.activeElement;
    /* 焦点进到确认框里（第一个可交互元素），Esc 能关 */
    var ok = $("#confirmOk");
    if (ok) ok.focus();
  }

  function closeConfirm() {
    $("#confirmBox").hidden = true;
    pendingConfirm = null;
    if (confirmReturnFocus && confirmReturnFocus.focus) confirmReturnFocus.focus();
    confirmReturnFocus = null;
  }

  /* ================= 播报 ================= */

  function say(text, label) {
    if (!OP.Speech.supported()) {
      toast("这个浏览器不支持语音合成", "换 Chrome、Edge 或 Safari 试试", "warn");
      return false;
    }
    var ok = OP.Speech.speak(text, data.settings);
    if (ok && label) toast(label, text, "ok");
    return ok;
  }

  /* ================= 当天信息 ================= */

  function nextInfo() {
    var pos = effectivePosition();
    var legs = P.buildLegs(data, pos, state.now);
    var route = legs.filter(function (l) { return l.status === "upcoming"; });
    return {
      found: P.nextCourse(data, state.now),
      legs: legs,
      route: route,
      leg: route.length ? route[0] : null,
      position: pos
    };
  }

  function countdownText(target, now) {
    var total = Math.floor((target.getTime() - now.getTime()) / 1000);
    if (total <= 0) return "00:00";
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    return (h > 0 ? h + ":" : "") + pad2(m) + ":" + pad2(s);
  }

  /* ================= 渲染：顶栏 ================= */

  function renderTop() {
    var now = state.now;
    $("#clock").textContent = pad2(now.getHours()) + ":" + pad2(now.getMinutes()) + ":" + pad2(now.getSeconds());

    var label = P.dateLabel(now);
    var wk = P.weekNumber(now, data.settings.termStart);
    if (wk !== null && wk >= 1 && wk <= 30) label += " · 第 " + wk + " 周";
    $("#todayLabel").textContent = label;

    var pill = $("#geoStatus");
    pill.textContent = positionHint();
    pill.className = "pill " + (
      data.settings.simulate ? "pill-warn" :
      state.position ? "pill-ok" :
      state.geoError ? "pill-err" : "pill-idle"
    );
  }

  /* ================= 渲染：今日 ================= */

  function renderToday() {
    var info = nextInfo();
    var hero = $("#nextCard");
    var list = P.todayCourses(data, state.now);

    hero.classList.remove("is-imminent");

    if (!info.found) {
      /* 校历上今天放假 / 停课：直说原因，别让人以为课程丢了。
         "partial"（开学礼停到 13:30 那种）不算整天放假，只在没课可上时提一句。
         放假那天校巴只剩假日线（H），也一并说清楚。 */
      var rest = P.holidayOn(state.now);
      var closed = rest && rest.kind !== "partial" ? rest : null;
      var restLabel = closed ? (closed.kind === "holiday" ? "今天放假" : "今天停课") : "";
      var lost = rest ? P.cancelledCourses(data, state.now).length : 0;

      $("#nextTag").textContent = closed ? (closed.kind === "holiday" ? "放假" : "停课") : "今日结束";
      $("#nextCountdown").textContent = "--:--";
      $("#nextName").textContent = restLabel || (list.length ? "今天的课都上完了" : "今天没有课");
      $("#nextMeta").textContent = closed
        ? closed.name + (closed.kind === "holiday" ? " · 校巴只有假日线（H）" : "") +
          (closed.note ? " · " + closed.note : "")
        : (list.length
          ? "共 " + list.length + " 节课，已经全部结束"
          : (lost ? "今天有 " + lost + " 节课因" + rest.name + "停课" : "好好安排自己的时间"));
      $("#nextDistance").textContent = "--";
      $("#nextWalk").textContent = "--";
      $("#nextLeave").textContent = "--";
      /* 放假那天"距离/步行/建议出发"全是空话，倒计时也没有意义——
         整行收起来，别让一排放假的破折号陪着"今天放假"。 */
      $("#nextStats").hidden = !!closed;
      $("#nextCountdown").hidden = !!closed;
    } else {
      $("#nextStats").hidden = false;
      $("#nextCountdown").hidden = false;
      var c = info.found.course;
      var b = P.buildingById(data, c.buildingId);
      var ongoing = info.found.status === "ongoing";
      var target = ongoing ? P.at(state.now, c.end) : P.at(state.now, c.start);

      $("#nextTag").textContent = ongoing ? "正在进行" : "下一节课";
      $("#nextCountdown").textContent = countdownText(target, state.now);
      $("#nextName").textContent = c.name;
      $("#nextMeta").textContent =
        P.cnTime(c.start) + " – " + P.cnTime(c.end) + " · " +
        P.placeText(c, b) + (c.teacher ? " · " + c.teacher : "");

      /* 正在上的课只显示状态，不再算"还要走多远" */
      var leg = null;
      info.legs.forEach(function (l) { if (l.course.id === c.id) leg = l; });

      if (ongoing) {
        $("#nextDistance").textContent = "--";
        $("#nextWalk").textContent = "--";
        $("#nextLeave").textContent = "已在上课";
        $("#nextClimbWrap").hidden = true;
      } else if (leg && leg.metrics) {
        var buffer = Number(data.settings.bufferMinutes) || 0;
        $("#nextDistance").textContent = Geo.formatDistance(leg.metrics.distance);
        $("#nextWalk").textContent = Geo.formatDuration(leg.metrics.minutes);
        $("#nextLeave").textContent = P.fmtHM(P.hm(c.start) - leg.metrics.minutes - buffer);

        /* 有明显爬升时多显示一格，没有就藏起来 */
        var rise = leg.metrics.hasElevation ? Math.round(leg.metrics.rise) : 0;
        $("#nextClimbWrap").hidden = rise < 3;
        /* 不要加箭头：小字号下 ↑ 会被看成数字 1，118 米变成 1118 米 */
        if (rise >= 3) $("#nextClimb").textContent = rise + " 米";

        if (leg.slackMin !== null && leg.slackMin <= 10) hero.classList.add("is-imminent");
      } else {
        $("#nextDistance").textContent = "打开定位";
        $("#nextWalk").textContent = "--";
        $("#nextLeave").textContent = "打开定位";
        $("#nextClimbWrap").hidden = true;
      }
    }

    /* 读数行是 3 格还是 4 格，写进 data-cells：
       列数按格数定（3 格 3 列、4 格 4 列），不再让浏览器 auto-fit 自动换列——
       自动换列时"每格一条左竖线、只豁免第一格"的规则会在换行处错位，
       手机上会看到一条条游离的竖线。 */
    var stats = $("#nextStats");
    if (stats) stats.dataset.cells = $("#nextClimbWrap").hidden ? "3" : "4";

    /* ---- 今日时间轴 ---- */
    var ol = $("#todayList");
    if (!list.length) {
      /* 放假 / 停课的日子说清楚是哪一天，别只留一句"没有课程安排" */
      var off = P.holidayOn(state.now);
      ol.innerHTML = '<li class="empty">' + (
        off && off.kind !== "partial"
          ? (off.kind === "holiday" ? "放假：" : "停课：") + esc(off.name)
          : "今天没有课程安排"
      ) + "</li>";
    } else {
      var nextId = info.found ? info.found.course.id : null;
      ol.innerHTML = list.map(function (c) {
        var bld = P.buildingById(data, c.buildingId);
        var st = P.statusOf(c, state.now);
        var cls = st === "past" ? " is-past" : (st === "ongoing" ? " is-now" : (c.id === nextId ? " is-next" : ""));
        var badge = st === "ongoing"
          ? '<span class="tl-badge is-now">进行中</span>'
          : (st === "past" ? "" : (c.id === nextId ? '<span class="tl-badge">下一节</span>' : ""));
        return '<li class="tl-item' + cls + '">' +
          '<div class="tl-time">' + esc(c.start) + "<small>" + esc(c.end) + "</small></div>" +
          '<div><div class="tl-name">' + esc(c.name) + "</div>" +
          '<div class="tl-meta">' + esc(P.placeText(c, bld)) +
          (c.teacher ? " · " + esc(c.teacher) : "") + "</div></div>" +
          badge + "</li>";
      }).join("");
    }

    $("#todaySummary").textContent = list.length ? list.length + " 节课" : "无课";
  }

  /* ================= 渲染：路线 ================= */

  /* ================= 校巴方案 ================= */

  /**
   * 这一段能不能坐校巴。
   *
   * 上车站取离你最近的、下车站取离教室最近的；最近那个站坐不了才退到第二近。
   * 只要能到目的地附近的车站，这条线就列出来——慢的、赶不上的都列，
   * 由你自己判断。
   *
   * **只写时长，不写"几点到"**：校巴到站时间太不稳，报了反而误导。
   * 每行是「走到车站 + 车程 + 走到教室 = 合计」，再加这条线大概几分钟一班。
   */
  function busHtml(plan, destLabel) {
    /* 模块没加载上说明页面是旧缓存（HTML 里没有 js/shuttle.js 那一行），
       这种情况要明说，不能跟"这段没车"长得一样 */
    if (!OP.Shuttle || !(OP.SHUTTLE_ROUTES || []).length) {
      return '<div class="leg-bus is-missing"><div class="leg-bus-head">校巴</div>' +
        '<div class="bus-none">校巴模块没加载——页面是旧缓存。强制刷新一次就会好' +
        '（iOS 加到桌面的话：删掉图标重新添加）。</div></div>';
    }

    if (!plan) return "";

    /* 教室和宿舍共用这块 HTML，只有"走到哪里"这个说法不一样 */
    var dest = destLabel || "教室";

    /* 全部列出来：比走路慢也好、赶不上这一节也好，都摆出来让人自己挑。
       排在前面的仍然是"上车站离你最近"的那些。 */
    var groups = plan.groups || [];
    if (!groups.length) {
      return '<div class="leg-bus is-none"><div class="leg-bus-head">校巴</div>' +
        '<div class="bus-none">' + esc(plan.reason || "这段没有合适的班次") + "</div></div>";
    }

    function renderGroup(g) {
      var flags = [];
      if (g.caveat === "teaching" || g.route.group === "meetclass") flags.push("只在教学日");
      if (g.caveat === "nonTeaching") flags.push("只在非教学日");
      if (g.route.group === "night") flags.push("晚间/假日线");
      if (g.boardNote) flags.push("上车：" + g.boardNote);
      if (g.alightNote) flags.push("下车：" + g.alightNote);

      /* 只写预估时长，不写"几点到"——校巴到站时间不稳，报了反而误导 */
      var verdict = "";
      var tone = "";
      if (g.saves !== null && g.saves >= 1) { verdict = "比走路快 " + Math.round(g.saves) + " 分"; tone = " is-faster"; }
      else if (g.saves !== null && g.saves <= -1) verdict = "比走路慢 " + Math.round(-g.saves) + " 分";
      else if (g.saves !== null) verdict = "和走路差不多";

      return '<div class="bus-group">' +
        '<div class="bus-where">' +
          '<span class="bus-tag">' + esc(g.route.no) + "</span>" + esc(g.route.nameZh) +
        "</div>" +
        '<div class="bus-stops">' + esc(g.board.stop.zh) + " 上车 → " +
          esc(g.alight.stop.zh) + " 下车" +
        "</div>" +
        '<div class="bus-ride' + tone + '">' +
          "走到车站 <b>" + Math.round(g.walkBeforeMin) + "</b> 分 + 车程 <b>" +
            Math.round(g.rideMin) + "</b> 分 + 走到" + esc(dest) + " <b>" + Math.round(g.walkAfterMin) +
            "</b> 分 = 合计 <b>" + Math.round(g.totalMin) + "</b> 分" +
          (g.headwayMin ? ' · 约每 <b>' + g.headwayMin + "</b> 分钟一班" : "") +
          (verdict ? ' <span class="bus-verdict">' + verdict + "</span>" : "") +
        "</div>" +
        (flags.length ? '<div class="bus-breakdown">' + esc(flags.join(" · ")) + "</div>" : "") +
      "</div>";
    }

    /* 现在在开的排前面；停运的（比如白天的 H 线、晚间的 N 线）自动折叠起来 */
    var running = groups.filter(function (g) { return g.runningNow; });
    var stopped = groups.filter(function (g) { return !g.runningNow; });

    var html = running.map(renderGroup).join("");
    if (stopped.length) {
      html += '<details class="bus-off"><summary>现在停运的线路（' + stopped.length + " 条）</summary>" +
        stopped.map(renderGroup).join("") + "</details>";
    }

    return '<div class="leg-bus"><div class="leg-bus-head">校巴</div>' + html + "</div>";
  }

  /* 去教室那一段的校巴方案 */
  function busOptions(leg, course) {
    void course;
    if (!leg.fromPoint || !leg.toPoint) return "";
    return busHtml(leg.busPlan, "教室");
  }

  function renderRoute() {
    var info = nextInfo();
    var buildings = (data.campus && data.campus.buildings) || [];
    var buffer = Number(data.settings.bufferMinutes) || 0;
    var route = info.route;

    /* 今天要去的楼栋：同一栋去了两次就合并成一条，时间都列出来 */
    var byId = {};
    var stops = [];
    P.todayCourses(data, state.now).forEach(function (course) {
      var b = P.buildingById(data, course.buildingId);
      if (!b || typeof b.lat !== "number" || typeof b.lng !== "number") return;

      if (!byId[b.id]) {
        byId[b.id] = { building: b, order: stops.length + 1, times: [], isNext: false };
        stops.push(byId[b.id]);
      }
      byId[b.id].times.push(course.start);
    });

    var nextBuildingId = route.length && route[0].building ? route[0].building.id : null;
    stops.forEach(function (s) {
      s.time = s.times.join(" · ");
      s.isNext = s.building.id === nextBuildingId;
    });

    /*
     * 先把每段行程的校巴方案算出来。
     * 行程列表下面要写这几条线，地图上也要标出用到的车站。
     */
    var hasShuttle = !!(OP.Shuttle && (OP.SHUTTLE_ROUTES || []).length);
    var bus = { busStops: [], busLinks: [] };

    route.forEach(function (leg) {
      leg.busPlan = hasShuttle
        ? OP.Shuttle.plan(leg.fromPoint, leg.toPoint, leg.start,
          leg.metrics ? leg.metrics.minutes : null, data.settings)
        : null;
      collectBus(leg.busPlan, leg.fromPoint, leg.toPoint, bus);
    });

    /* 「路线规划」这张卡片对应的地图数据（今天要去的教室） */
    todayMap = {
      stops: stops,
      position: info.position,
      busStops: bus.busStops,
      busLinks: bus.busLinks,
      empty: "今天没有要去的地方"
    };
    renderRouteMap();

    var box = $("#routeList");

    if (!route.length) {
      box.innerHTML = '<p class="empty">今天没有需要前往的教室了</p>';
      $("#routeSummary").textContent = "无待办路线";
      return;
    }

    $("#routeSummary").textContent = route.length + " 段行程";

    var html = route.map(function (leg, i) {
      var c = leg.course;
      var b = leg.building;
      var links = b ? Geo.navLinks(b.name, b.lat, b.lng) : [];

      var metrics = leg.metrics
        ? '<div class="leg-meta">' +
            "<span>距离 <b>" + esc(Geo.formatDistance(leg.metrics.distance)) + "</b></span>" +
            (leg.metrics.hasElevation && leg.metrics.rise >= 3
              ? "<span>爬升 <b>" + Math.round(leg.metrics.rise) + " 米</b></span>"
              : "") +
            "<span>步行 <b>" + esc(Geo.formatDuration(leg.metrics.minutes)) + "</b></span>" +
            "<span>建议出发 <b>" + esc(P.fmtHM(P.hm(c.start) - leg.metrics.minutes - buffer)) + "</b></span>" +
          "</div>"
        : "";

      var warn = "";
      if (leg.missed) {
        warn = '<div class="leg-warn">按现在的余量已经很紧了，直接出发吧</div>';
      } else if (leg.slackMin !== null && leg.slackMin <= 10) {
        warn = '<div class="leg-warn">余量只有 ' + Math.max(0, Math.round(leg.slackMin)) + " 分钟，别拖了</div>";
      }

      return '<div class="leg">' +
        '<div class="leg-head">' +
          '<div class="leg-title"><span class="idx">' + (i + 1) + "</span>" +
            esc((leg.fromName || "起点") + " → " + (b ? b.name : "未知地点")) + "</div>" +
          '<div class="leg-time">' + esc(c.start) + " – " + esc(c.end) + "</div>" +
        "</div>" +
        '<div class="leg-meta"><span>' + esc(c.name) +
          (c.room ? " · " + esc(c.room) : "") +
          (c.teacher ? " · " + esc(c.teacher) : "") + "</span></div>" +
        metrics + busOptions(leg, c) + warn +
        '<div class="leg-actions">' +
          links.map(function (l) {
            if (l.copy) {
              return '<button type="button" class="nav-link" data-copy="' + esc(l.copy) + '">' +
                esc(l.label) + "</button>";
            }
            return '<a class="nav-link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
              esc(l.label) + "</a>";
          }).join("") +
        "</div>" +
      "</div>";
    }).join("");

    box.innerHTML = html;
  }

  /* ================= 路线页：三张卡片 + 地图跟着卡片走 ================= */

  /* 三张卡片（左右滑动切换，一次只显示一张） */
  var SLIDES = ["plan", "dorm", "custom"];
  /* 当前在看哪张。地图画什么，就看它 */
  var routeSlide = "plan";
  /* renderRoute 每次算好的「今天的教室」那份地图数据，plan 卡片用它 */
  var todayMap = { stops: [], position: null, busStops: [], busLinks: [], empty: "" };

  /**
   * 把一段行程用到的车站和连线收进来。
   *
   * 地图上只画三截：走到上车站、上车站坐到下车站、下车走到终点。
   * 「路线规划」和「返回宿舍 / 自定义路线」用的是同一套算法，所以抽出来共用：
   * 去上课是每段行程各算一次累加，回宿舍/自定义路线整段的算一次。
   */
  function collectBus(plan, fromPoint, toPoint, into) {
    var out = into || { busStops: [], busLinks: [] };
    var seen = {};
    out.busStops.forEach(function (s) { seen[s.id] = true; });

    (plan && plan.groups || []).forEach(function (g) {
      [g.board, g.alight].forEach(function (entry) {
        if (!entry || !entry.stop) return;
        if (seen[entry.id]) return;
        seen[entry.id] = true;
        out.busStops.push({ id: entry.id, stop: entry.stop });
      });
    });

    /* 取第一条线（现在在开的排最前）的上下车站画连线 */
    var best = (plan && plan.groups || [])[0];
    if (best) {
      if (fromPoint && best.board.stop) {
        out.busLinks.push({ from: fromPoint, to: best.board.stop });
      }
      /* 上车站到下车站这一段：这是坐车，不是走路，画成另一种线 */
      if (best.board.stop && best.alight.stop) {
        out.busLinks.push({
          from: best.board.stop,
          to: best.alight.stop,
          ride: true,
          route: best.route.no
        });
      }
      if (best.alight.stop && toPoint) {
        out.busLinks.push({ from: best.alight.stop, to: toPoint });
      }
    }
    return out;
  }

  /* 地图上的一个记号：圈里写 tag（今天的课写序号，起终点写「起」「终」） */
  function markOf(point, name, tag, isNext) {
    return {
      building: {
        id: "mark-" + tag + "-" + name,
        name: name,
        lat: point.lat,
        lng: point.lng,
        elevation: point.elevation
      },
      order: tag,
      time: "",
      isNext: !!isNext
    };
  }

  /**
   * 「返回宿舍」这张卡片的地图数据：起点 → 宿舍。
   * 起点是「我的位置」时就画那个点（不重复画一个圈），是楼就画「起」。
   */
  function dormMapData() {
    var dorm = dormTarget();
    var start = dormStart();
    var none = {
      stops: [], position: effectivePosition(), busStops: [], busLinks: [],
      empty: "先选一个宿舍，才有起终点可画"
    };
    if (!dorm || !start) return none;

    var s = data.settings;
    var target = { lat: dorm.lat, lng: dorm.lng, elevation: dorm.elevation };
    var metrics = P.walkMetrics(start.point, target, s);
    var plan = OP.Shuttle
      ? OP.Shuttle.plan(start.point, target, start.at, metrics ? metrics.minutes : null, s)
      : null;
    var bus = collectBus(plan, start.point, target);

    return {
      stops: (start.fromClass ? [markOf(start.point, start.name, "起")] : [])
        .concat([markOf(target, dorm.label, "终")]),
      position: start.fromClass ? null : start.point,
      busStops: bus.busStops,
      busLinks: bus.busLinks,
      empty: "先选一个宿舍，才有起终点可画"
    };
  }

  /** 「自定义路线」这张卡片的地图数据：起点 → 终点 */
  function customMapData() {
    var none = {
      stops: [], position: effectivePosition(), busStops: [], busLinks: [],
      empty: "选好起点和终点，这里就会画出来"
    };
    var to = data.settings.customTo ? P.buildingById(data, data.settings.customTo) : null;
    if (!to || typeof to.lat !== "number") return none;

    var fromPoint = null;
    var fromName = "我的位置";
    var fromIsBuilding = false;
    if (data.settings.customFrom) {
      var fb = P.buildingById(data, data.settings.customFrom);
      if (fb && typeof fb.lat === "number") {
        fromPoint = { lat: fb.lat, lng: fb.lng, elevation: fb.elevation };
        fromName = fb.name;
        fromIsBuilding = true;
      }
    } else {
      fromPoint = effectivePosition();
    }
    if (!fromPoint) {
      return {
        stops: [markOf({ lat: to.lat, lng: to.lng, elevation: to.elevation }, to.name, "终")],
        position: null, busStops: [], busLinks: [],
        empty: "还没定位，起点先选一栋楼"
      };
    }

    var s = data.settings;
    var target = { lat: to.lat, lng: to.lng, elevation: to.elevation };
    var metrics = P.walkMetrics(fromPoint, target, s);
    var plan = OP.Shuttle
      ? OP.Shuttle.plan(fromPoint, target, state.now, metrics ? metrics.minutes : null, s)
      : null;
    var bus = collectBus(plan, fromPoint, target);

    return {
      stops: (fromIsBuilding ? [markOf(fromPoint, fromName, "起")] : [])
        .concat([markOf(target, to.name, "终")]),
      position: fromIsBuilding ? null : fromPoint,
      busStops: bus.busStops,
      busLinks: bus.busLinks,
      empty: "选好起点和终点，这里就会画出来"
    };
  }

  function slideMapData(kind) {
    if (kind === "dorm") return dormMapData();
    if (kind === "custom") return customMapData();
    return todayMap;
  }

  /**
   * 画地图。
   *
   * **画哪一段取决于当前在看哪张卡片**：路线规划 → 今天要去的教室；
   * 返回宿舍 → 起点到宿舍；自定义路线 → 起点到终点。
   * 车站和那三截连线也跟着这张卡片走，不会永远显示今日课表那一套。
   */
  function renderRouteMap() {
    var d = slideMapData(routeSlide);
    var mode = data.settings.mapMode || "schematic";
    var svg = $("#mapSvg");
    var realBox = $("#mapReal");
    if (!svg || !realBox) return;

    $$(".map-mode").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.mapmode === mode);
    });

    if (mode === "schematic") {
      /* 注意：SVG 元素没有 hidden 这个 DOM 属性，
         写 svg.hidden = true 只是挂了个没用的变量，属性根本不会设上。
         所以这里直接控制 display。 */
      svg.style.display = "";
      realBox.style.display = "none";
      OP.RealMap.dispose();

      OP.MapView.render(svg, {
        buildings: (data.campus && data.campus.buildings) || [],
        position: d.position,
        stops: d.stops,
        busStops: d.busStops,
        busLinks: d.busLinks,
        empty: d.empty,
        detourFactor: data.settings.detourFactor
      });
    } else {
      svg.style.display = "none";
      realBox.style.display = "";

      OP.RealMap.render(realBox, {
        source: mode,
        position: d.position,
        stops: d.stops,
        busStops: d.busStops,
        busLinks: d.busLinks
      }).catch(function (err) {
        toast("地图加载失败", err.message + "。可以先切回「简图」。", "err");
      });
    }

    /* 简图才需要图例；真实地图上的标记自带标签 */
    $("#mapLegend").hidden = mode !== "schematic";
  }

  /**
   * 一组"左右滑动、一次只看一张"的卡片。
   *
   * 路线页那三张（路线规划 / 返回宿舍 / 自定义）和课表页那两张
   * （拉取课表 / 截图导入）共用这一套：靠 scroll-snap 翻页，
   * 点上面的切换条也能切，手指划完读停在哪一张。
   *
   * 注意切换条只在**自己这一组**里找（`#navId .route-tab`）。
   * 以前是全局 `$$(".route-tab")`，两组同时存在时会互相把对方的选中态抹掉。
   */
  function makeSlides(config) {
    var nav = $(config.nav);
    var scroller = $(config.scroller);
    var kinds = config.slides.slice();
    var current = config.initial || kinds[0];
    var onChange = config.onChange || function () {};

    function tabs() {
      return nav ? [].slice.call(nav.querySelectorAll(".route-tab")) : [];
    }

    function paint() {
      tabs().forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-slide") === current);
      });
    }

    function go(kind, immediate) {
      var idx = kinds.indexOf(kind);
      if (idx < 0) return;
      current = kind;
      paint();
      if (scroller) {
        var left = idx * scroller.clientWidth;
        if (immediate || !scroller.scrollTo) scroller.scrollLeft = left;
        else scroller.scrollTo({ left: left, behavior: "smooth" });
      }
      onChange(current);
    }

    /* 手指划完，按停在哪一张决定"当前是哪张" */
    if (scroller) {
      var timer = null;
      scroller.addEventListener("scroll", function () {
        window.clearTimeout(timer);
        timer = window.setTimeout(function () {
          var width = scroller.clientWidth || 1;
          var idx = Math.max(0, Math.min(kinds.length - 1, Math.round(scroller.scrollLeft / width)));
          if (kinds[idx] === current) return;
          current = kinds[idx];
          paint();
          onChange(current);
        }, 90);
      });
    }

    tabs().forEach(function (btn) {
      btn.addEventListener("click", function () { go(btn.getAttribute("data-slide")); });
    });

    paint();
    return {
      go: go,
      paint: paint,
      current: function () { return current; },
      /* 宽度变了（转屏 / 缩放）要重新对齐到当前那张 */
      realign: function () { go(current, true); }
    };
  }

  var routeSlides = null;
  var importSlides = null;

  /* ================= 渲染：返回宿舍 ================= */

  function dormTarget() {
    if (!OP.Dorm) return null;
    return OP.Dorm.byId(data.settings, data.settings.dormId);
  }

  /* 默认宿舍数据里没有海拔（OSM 不给），查到就记在内存里，
     免得每次渲染都去问一次高程接口 */
  var dormElevation = {};

  function ensureDormElevation(dorm, done) {
    if (!dorm) return;
    if (typeof dormElevation[dorm.id] === "number") {
      dorm.elevation = dormElevation[dorm.id];
      return;
    }
    if (typeof dorm.elevation === "number") return;
    if (!OP.Elevation || typeof OP.Elevation.at !== "function") return;

    OP.Elevation.at(dorm.lat, dorm.lng).then(function (value) {
      if (typeof value !== "number") return;
      dormElevation[dorm.id] = value;
      done();
    }).catch(function () { /* 查不到就按平地算，不影响能不能用 */ });
  }

  /**
   * 回宿舍从哪儿出发。
   *
   * **以我的位置为起点**（用户指定）：人在哪儿就从哪儿算，
   * 不再假设"你正坐在今天最后一节课的教室里"。
   *
   * 只有取不到定位时（没开权限、电脑上没有位置）才退回"今天最后一节课的教室"——
   * 卡片上全空着比给个大概更糟。退回去时标题会写明起点是哪栋楼、
   * 下面还有一句"没取到定位"，不会让人误以为是从当前位置算的。
   */
  function dormStart() {
    var now = state.now;

    var pos = effectivePosition();
    if (pos) return { point: pos, name: "我的位置", note: "", at: now, fromClass: false };

    var last = null;
    P.todayCourses(data, now).forEach(function (c) {
      /* todayCourses 已按开始时间排好，最后还有课的自然是最后一节 */
      if (P.at(now, c.end).getTime() > now.getTime()) last = c;
    });

    if (last) {
      var b = P.buildingById(data, last.buildingId);
      if (b && typeof b.lat === "number" && typeof b.lng === "number") {
        return {
          point: { lat: b.lat, lng: b.lng, elevation: b.elevation },
          name: b.name,
          note: "没取到定位，先按今天最后一节课的教室算（" +
            last.start + "–" + last.end + " " + last.name + "）",
          at: P.at(now, last.end),
          fromClass: true
        };
      }
    }

    return null;
  }

  /**
   * 输入框里那串字到底是哪个宿舍。
   *
   * 比较前统一成"小写 + 简体"，所以简繁两种写法互相都认得（知行楼 / 知行樓）。
   * 顺序：完全一致 → 包含 / 中文首字母（zxl → 知行樓）→ 名字最像的 → 模糊打分兜底。
   * 宿舍名里有不少缩写（C.C. / U.C.）和"第几苑"这类写法，最后一层专门兜这些。
   */
  function resolveDorm(text) {
    if (!OP.Dorm) return null;
    var q = String(text === undefined || text === null ? "" : text).trim();
    if (!q) return null;

    var list = OP.Dorm.all(data.settings);
    var low = OP.Dorm.normalize(q);
    /* 英文名、中文名、并排写法、别名，全都算 */
    var namesOf = function (d) {
      return OP.Dorm.names(d).map(function (n) { return OP.Dorm.normalize(n); });
    };

    var exact = list.filter(function (d) { return namesOf(d).indexOf(low) >= 0; })[0];
    if (exact) return exact;

    /* 包含、繁体简体、中文首字母，search 里都处理好了 */
    var hits = OP.Dorm.search(data.settings, q);
    if (hits.length === 1) return hits[0];

    /* 命中好几条（比如 zxl 同时是知行樓和紫霞樓）：挑名字最像的那条 */
    if (hits.length > 1 && OP.Places && OP.Places.bestNameMatch) {
      var best = OP.Places.bestNameMatch(q, hits, 0);
      if (best) return best;
    }
    if (hits.length) return hits[0];

    /* 一条都没命中，才退回和课表地名同一套模糊打分 */
    if (OP.Places && OP.Places.bestNameMatch) {
      return OP.Places.bestNameMatch(q, list, 0.45);
    }
    return null;
  }

  function pickDormByName(text) {
    var dorm = resolveDorm(text);
    data.settings.dormId = dorm ? dorm.id : "";
    if (!dorm && String(text || "").trim()) {
      toast("没找到这个宿舍",
        "中英文、简体繁体、中文首字母（zxl → 知行樓）都认，试试只打前两个字", "warn");
    }
    saveAndRender();
  }

  /* ================= 可搜索的下拉 ================= */

  /* 候选列表最多显示几条：再多也没人翻，剩下的靠自己多打一个字缩小 */
  var PICK_MAX = 8;

  /* 已经挂上的下拉，点空白处要一起收起来 */
  var pickers = [];

  /**
   * 给一个输入框挂上"候选列表"。
   *
   * 三处在用：宿舍、自定义路线的起点、自定义路线的终点。
   *
   * 为什么不用浏览器原生的 `<datalist>`：它只拿你打的字去跟候选的**字面值**
   * 做包含匹配，既不懂繁简也不懂拼音首字母——打「汤」的时候候选写着
   * 「Adam Schall Residence 湯若望宿舍」，原生下拉就是空的，看着像"搜不到"，
   * 而搜索本身完全能命中。所以候选列表自己渲染，跟搜索走同一套规则
   * （js/zh.js 的 OP.Zh.matches：中英文、简繁体、拼音首字母）。
   *
   * @param cfg.input    输入框选择器
   * @param cfg.list     候选容器选择器
   * @param cfg.items    返回候选 [{ id, label, meta, names }]
   * @param cfg.current  当前选中项的显示文字（用于"点一下列全部"）
   * @param cfg.empty    一条都没匹配上时的提示
   * @param cfg.onPick   选中回调
   */
  function attachPicker(cfg) {
    var input = $(cfg.input);
    var box = $(cfg.list);
    if (!input || !box) return null;

    function hide() { box.hidden = true; }

    function paint(query, browse) {
      var q = String(query === undefined || query === null ? "" : query).trim();
      var items = cfg.items() || [];
      /* 点进来（聚焦/点击）时，即使框里写着已选中的那条，也把全部列出来方便改选 */
      var showAll = !q || (browse && q === cfg.current());
      var hits = showAll ? items : items.filter(function (it) {
        return OP.Zh.matches(q, it.names);
      });

      if (!hits.length) {
        box.hidden = false;
        box.innerHTML = '<p class="picker-note">' + esc(cfg.empty || "没有匹配的") + "</p>";
        return;
      }

      var shown = hits.slice(0, PICK_MAX);
      box.innerHTML = shown.map(function (it) {
        return '<button type="button" class="picker-item" data-pick="' + esc(it.id) + '">' +
          '<span class="picker-name">' + esc(it.label) + "</span>" +
          (it.meta ? '<span class="picker-meta">' + esc(it.meta) + "</span>" : "") +
          "</button>";
      }).join("") + (hits.length > shown.length
        ? '<p class="picker-note">还有 ' + (hits.length - shown.length) + " 条，打个字缩小范围</p>"
        : "");
      box.hidden = false;
    }

    function pickFrom(btn) {
      var id = btn.getAttribute("data-pick");
      var item = (cfg.items() || []).filter(function (it) { return String(it.id) === id; })[0];
      hide();
      if (item) cfg.onPick(item);
    }

    input.addEventListener("input", function () { paint(input.value, false); });
    input.addEventListener("focus", function () { paint(input.value, true); });
    /* 选完一条之后输入框还是 focus 着的，再点一下就当"想改选" */
    input.addEventListener("click", function () { paint(input.value, true); });
    input.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") hide();
    });

    /* 点候选用 pointerdown 而不是 click：等 click 的话输入框会先失焦、
       触发 change 把列表收掉，就点不着了 */
    box.addEventListener("pointerdown", function (ev) {
      var btn = ev.target.closest("[data-pick]");
      if (!btn) return;
      ev.preventDefault();
      pickFrom(btn);
    });
    /* 键盘选中（Tab 到候选上按回车）走的是 click，补一个 */
    box.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-pick]");
      if (btn) pickFrom(btn);
    });

    var handle = {
      hide: hide,
      hideIfOutside: function (target) {
        if (box.hidden) return;
        if (target === input) return;
        if (target && target.closest && target.closest("[data-pick]")) return;
        if (target && target.closest && target.closest(cfg.list)) return;
        hide();
      }
    };
    pickers.push(handle);
    return handle;
  }

  /* 楼栋（校区楼栋）列表：自检和"可搜索下拉"共用同一个候选来源 */
  function buildingPickerItems(includeMe) {
    var items = [];
    if (includeMe) {
      items.push({
        id: "",
        label: "我的位置",
        meta: "起点",
        names: ["我的位置", "我的位置 wdwz", "当前位置"]
      });
    }
    ((data.campus && data.campus.buildings) || []).forEach(function (b) {
      if (typeof b.lat !== "number" || typeof b.lng !== "number") return;
      items.push({
        id: b.id,
        label: b.name,
        meta: (b.alias || [])[0] || "",
        names: [b.name].concat(b.alias || [])
      });
    });
    return items;
  }

  function chooseDorm(id) {
    var dorm = OP.Dorm.byId(data.settings, id);
    if (!dorm) return;
    data.settings.dormId = dorm.id;
    /* 直接把名字写回去：输入框通常还focus着，renderDorm 那边不会覆盖 */
    $("#dormSearch").value = dorm.label;
    saveAndRender();
  }

  /**
   * 自定义路线的起点/终点：输入框里那串字是哪栋楼。
   *
   * 名字比完全一致 → 按包含（中英文、简繁体、拼音首字母）→ 最后模糊打分兜底，
   * 和宿舍那套是同一个思路。includeMe 时"我的位置"也算一个候选（id 为空）。
   */
  function pickBuildingByName(inputSel, settingKey, includeMe) {
    var input = $(inputSel);
    var q = String(input.value || "").trim();
    var items = buildingPickerItems(includeMe);

    if (!q) {
      /* 起点空着 = 我的位置；终点空着 = 没选 */
      data.settings[settingKey] = "";
      saveAndRender();
      return;
    }

    var low = OP.Zh.normalize(q);
    var exact = items.filter(function (it) {
      return (it.names || []).some(function (n) { return OP.Zh.normalize(n) === low; });
    })[0];

    var hit = exact || items.filter(function (it) {
      return OP.Zh.matches(q, it.names);
    })[0];

    if (!hit && OP.Places && OP.Places.bestNameMatch) {
      var fuzzy = OP.Places.bestNameMatch(q, items.map(function (it) {
        return { id: it.id, name: it.label, alias: (it.names || []).slice(1) };
      }), 0.5);
      if (fuzzy) hit = { id: fuzzy.id, label: fuzzy.name };
    }

    data.settings[settingKey] = hit ? hit.id : "";
    if (!hit) {
      toast("没找到这栋楼",
        "中英文、简繁体、拼音首字母都认（蒙民伟楼 / 蒙民偉樓 / mmwl）", "warn");
    }
    saveAndRender();
  }

  function renderDorm() {
    if (!OP.Dorm) return;

    var box = $("#dormPlan");
    var list = OP.Dorm.all(data.settings);
    var dorm = dormTarget();

    var search = $("#dormSearch");
    if (document.activeElement !== search) search.value = dorm ? dorm.label : "";

    $("#dormState").textContent = list.length + " 处可选";
    /* 只有自己加的宿舍能删；没有可删的就把整行收起来 */
    $("#dormActions").hidden = !(dorm && dorm.custom);

    if (!dorm) {
      box.innerHTML = '<p class="empty">上面搜一个宿舍（中英文、简体繁体、拼音首字母都认）。</p>';
      return;
    }

    var s = data.settings;
    var start = dormStart();
    /* 海拔缺了就先查回来再渲染一次：爬山校园里不算高差，时间会差很多 */
    ensureDormElevation(dorm, renderDorm);
    var metrics = start ? P.walkMetrics(start.point, dorm, s) : null;
    var busPlan = (start && OP.Shuttle)
      ? OP.Shuttle.plan(start.point, { lat: dorm.lat, lng: dorm.lng, elevation: dorm.elevation },
        start.at, metrics ? metrics.minutes : null, s)
      : null;

    var head = '<div class="leg-head">' +
      '<div class="leg-title"><span class="idx">返</span>' +
        esc((start ? start.name : "起点未知") + " → " + dorm.label) + "</div>" +
      '<div class="leg-time">' + esc(dorm.custom ? "自建" : "OSM") + "</div>" +
      "</div>";

    var note = start && start.note
      ? '<p class="plan-note">' + esc(start.note) + "</p>"
      : "";

    var stats = "";
    if (!start) {
      stats = '<p class="plan-note">还没有位置信息：先到「设置 → 定位」开一下实时定位。</p>';
    } else if (metrics) {
      /* 回宿舍大多是下坡。爬升要折算成时间，下降不折算（下坡不省时间，
         这是 Naismith 那套经验规则的口径），所以分开写、并注明。 */
      var drop = 0;
      if (typeof start.point.elevation === "number" && typeof dorm.elevation === "number") {
        drop = Math.max(0, start.point.elevation - dorm.elevation);
      }

      stats = '<div class="leg-meta">' +
        "<span>距离 <b>" + esc(Geo.formatDistance(metrics.distance)) + "</b></span>" +
        (metrics.hasElevation && metrics.rise >= 3
          ? "<span>爬升 <b>" + Math.round(metrics.rise) + " 米</b></span>" : "") +
        (drop >= 3 ? "<span>下降 <b>" + Math.round(drop) + " 米</b></span>" : "") +
        "<span>步行 <b>" + esc(Geo.formatDuration(metrics.minutes)) + "</b></span>" +
        (start.fromClass
          ? "<span>下课后 <b>" + pad2(start.at.getHours()) + ":" +
            pad2(start.at.getMinutes()) + "</b></span>"
          : "") +
        "</div>";
    }

    /* 名字给「英文 中文」：高德 / 百度会把这个名字显示在目的地上，
       两个写法都带上，用中文地图的人也能一眼确认是不是这栋 */
    var links = Geo.navLinks(dorm.label, dorm.lat, dorm.lng);
    var actions = '<div class="leg-actions">' + links.map(function (l) {
      if (l.copy) {
        return '<button type="button" class="nav-link" data-copy="' + esc(l.copy) + '">' +
          esc(l.label) + "</button>";
      }
      return '<a class="nav-link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        esc(l.label) + "</a>";
    }).join("") + "</div>";

    box.innerHTML = '<div class="leg dorm-leg">' + head + note + stats +
      (start ? busHtml(busPlan, "宿舍") : "") + actions + "</div>";
  }

  /* ================= 渲染：自定义路线 ================= */

  /**
   * 自己选起点和终点，算一遍怎么走。
   *
   * 用的是和「去上课」「回宿舍」完全同一套：步行时间（含高差）+ 校巴方案。
   * 起点可以是「我的位置」，也可以是任意一栋有坐标的楼；终点是楼栋。
   * 选完就自动算，不用再点一次按钮。
   */
  function renderCustom() {
    var fromInput = $("#customFromSearch");
    var toInput = $("#customToSearch");
    if (!fromInput || !toInput) return;

    var list = ((data.campus && data.campus.buildings) || []).filter(function (b) {
      return typeof b.lat === "number" && typeof b.lng === "number";
    });

    /* 两个输入框显示"当前选的是哪栋"（正在打字的时候别覆盖用户的输入）。
       候选列表本身由 attachPicker 管，见 bindEvents 里的注册。 */
    var fromBuilding = data.settings.customFrom
      ? P.buildingById(data, data.settings.customFrom) : null;
    var toBuilding = data.settings.customTo
      ? P.buildingById(data, data.settings.customTo) : null;
    if (document.activeElement !== fromInput) {
      fromInput.value = fromBuilding ? fromBuilding.name : "我的位置";
    }
    if (document.activeElement !== toInput) {
      toInput.value = toBuilding ? toBuilding.name : "";
    }

    var box = $("#customPlan");
    var stateEl = $("#customState");
    var to = toBuilding;

    if (!to) {
      box.innerHTML = '<p class="empty">选一个终点楼栋就会自动规划；' +
        "起点默认是「我的位置」，也可以从全部楼栋里挑。</p>";
      stateEl.textContent = list.length + " 栋可选";
      return;
    }

    var fromPoint = null;
    var fromName = "我的位置";
    if (data.settings.customFrom) {
      var fb = P.buildingById(data, data.settings.customFrom);
      if (fb && typeof fb.lat === "number") {
        fromPoint = { lat: fb.lat, lng: fb.lng, elevation: fb.elevation };
        fromName = fb.name;
      }
    } else {
      fromPoint = effectivePosition();
    }

    if (fromPoint && to.id === data.settings.customFrom) {
      box.innerHTML = '<p class="empty">起点和终点是同一栋楼，换个终点试试。</p>';
      stateEl.textContent = list.length + " 栋可选";
      return;
    }

    if (!fromPoint) {
      box.innerHTML = '<p class="empty">起点是「我的位置」，但还没定位。' +
        "到「设置 → 定位」开一下定位，或者把起点换成一栋楼。</p>";
      stateEl.textContent = list.length + " 栋可选";
      return;
    }

    var s = data.settings;
    var toPoint = { lat: to.lat, lng: to.lng, elevation: to.elevation };
    var metrics = P.walkMetrics(fromPoint, toPoint, s);
    var busPlan = OP.Shuttle
      ? OP.Shuttle.plan(fromPoint, toPoint, state.now, metrics ? metrics.minutes : null, s)
      : null;

    stateEl.textContent = fromName + " → " + to.name;

    var drop = 0;
    if (typeof fromPoint.elevation === "number" && typeof to.elevation === "number") {
      drop = Math.max(0, fromPoint.elevation - to.elevation);
    }

    var stats = metrics
      ? '<div class="leg-meta">' +
          "<span>距离 <b>" + esc(Geo.formatDistance(metrics.distance)) + "</b></span>" +
          (metrics.hasElevation && metrics.rise >= 3
            ? "<span>爬升 <b>" + Math.round(metrics.rise) + " 米</b></span>" : "") +
          (drop >= 3 ? "<span>下降 <b>" + Math.round(drop) + " 米</b></span>" : "") +
          "<span>步行 <b>" + esc(Geo.formatDuration(metrics.minutes)) + "</b></span>" +
        "</div>"
      : "";

    var links = Geo.navLinks(to.name, to.lat, to.lng);
    var actions = '<div class="leg-actions">' + links.map(function (l) {
      if (l.copy) {
        return '<button type="button" class="nav-link" data-copy="' + esc(l.copy) + '">' +
          esc(l.label) + "</button>";
      }
      return '<a class="nav-link" href="' + esc(l.url) + '" target="_blank" rel="noopener">' +
        esc(l.label) + "</a>";
    }).join("") + "</div>";

    box.innerHTML = '<div class="leg custom-leg">' +
      '<div class="leg-head">' +
        '<div class="leg-title"><span class="idx">自</span>' +
          esc(fromName + " → " + to.name) + "</div>" +
        '<div class="leg-time">' + esc(metrics ? Geo.formatDuration(metrics.minutes) : "--") + "</div>" +
      "</div>" + stats + busHtml(busPlan, "终点") + actions + "</div>";
  }

  /* ================= 渲染：课表 ================= */

  /* ================= 从学校接口拉课表 ================= */

  /* 拉回来的结果只放在内存里，关掉页面就没了（课表本身会存进课程列表） */
  var pull = { busy: false, courses: [], report: null, raw: null };

  var PULL_ERRORS = {
    missing_credentials: "学号或密码是空的",
    bad_json: "代理收到的请求不完整——检查一下代理地址是不是填错了",
    not_found: "这个地址上没有代理：口令那一段可能写错了",
    method_not_allowed: "代理只收 POST 请求",
    body_too_large: "请求体太大（不该发生，报给开发者）",
    too_many_requests: "调得太频繁了，等一分钟再试",
    unknown_mode: "接口写法（mode）填错了",
    upstream_status: "学校那边返回了错误",
    upstream_unparseable: "学校返回的不是课表——接口可能变了，看下面「原始字段」",
    upstream_timeout: "学校那边 20 秒没回话",
    upstream_unreachable: "代理连不上学校（机房 IP 可能被拦了）",
    bad_response: "代理返回的不是 JSON（地址填对了吗？）"
  };

  /* 代理地址和上游写法都写死在这里（用户要求不要在界面上出现）：
     走我们自己那台 Cloudflare Worker，凭据用 AES 加密——2026-10 实测
     明文那两种读回来是空的，只有加密的能拿到课。 */
  var PULL_PROXY = "https://cuhk-timetable-proxy.y1819400195-721.workers.dev/t/k7fq2m9x";
  var PULL_MODE = "soap-aes";

  function renderPull() {
    var sid = $("#pullSid");
    /* 正在打字的那一格别覆盖（跟宿舍搜索框一个道理） */
    if (document.activeElement !== sid) sid.value = (data.settings && data.settings.pullSid) || "";

    $("#pullState").textContent = pull.busy
      ? "拉取中…"
      : "就绪";

    var hasResult = pull.courses.length > 0;
    $("#btnPullImport").hidden = !hasResult;
    $("#btnPullClear").hidden = !hasResult && !pull.raw;
  }

  function pullError(data) {
    var key = (data && data.error) || "bad_response";
    var text = PULL_ERRORS[key] || ("代理报错：" + key);
    if (data && data.status) text += "（上游状态 " + data.status + "）";
    return text;
  }

  function renderPullResult() {
    var box = $("#pullResult");
    var list = pull.courses;
    var report = pull.report || { rows: 0, kept: 0, skipped: 0, keys: [] };

    var tba = list.filter(function (c) { return c.tba; }).length;
    var fresh = list.filter(function (c) { return !c.buildingId && c.buildingName; }).length;
    var dunno = list.filter(function (c) { return !c.tba && !c.buildingName; }).length;

    var notes = ["上游 " + report.rows + " 行，解析出 " + report.kept + " 条"];
    if (report.skipped) notes.push("跳过 " + report.skipped + " 行");
    if (tba) notes.push(tba + " 条地点待定");
    if (fresh) notes.push(fresh + " 条要新建楼栋");
    if (dunno) notes.push(dunno + " 条没写地点");

    /* 上游给的是一段日期，不是周次——直接照原样显示，不做任何换算 */
    var terms = report.terms || [];
    if (terms.length > 1) {
      notes.push("跨 " + terms.length + " 个学期（" +
        terms.map(function (t) { return (t.descr || t.strm) + " " + t.count + " 条"; }).join("、") + "）");
    }

    /* 预览按"周一 → 周五、早 → 晚"排好，跟导入后课表里的顺序一致
       （上游是按班号/开班顺序返回的，直接列出来看着是乱的） */
    var ordered = list.slice().sort(function (a, b) {
      var dayA = Math.min.apply(null, a.weekdays);
      var dayB = Math.min.apply(null, b.weekdays);
      if (dayA !== dayB) return dayA - dayB;
      return P.hm(a.start) - P.hm(b.start);
    });

    box.innerHTML = '<p class="plan-note">' + esc(notes.join(" · ")) + "</p>" +
      '<div class="pull-list">' + ordered.map(function (c) {
        var place = c.tba
          ? "地点待定"
          : (c.buildingId ? "" : "新楼栋：") + (c.buildingName || "（没写地点）") + (c.room ? " · " + c.room : "");
        var range = P.dateRangeText(c);
        return '<div class="pull-item">' +
          '<div class="pull-head">' +
            '<span class="pull-day">' + esc(P.WEEKDAYS_SHORT[c.weekdays[0]] || "") + "</span>" +
            '<span class="pull-time">' + esc(c.start + "–" + c.end) + "</span>" +
            "</div>" +
          '<div class="pull-name">' + esc(c.name) + "</div>" +
          '<div class="pull-place">' + esc(place) + "</div>" +
          (range ? '<div class="pull-weeks">' + esc(range) + "</div>" : "") +
        "</div>";
      }).join("") + "</div>";

    /* 「原始字段」面板：字段名清单 + 前两行原文。联调时靠它对齐映射。 */
    $("#pullDebugSummary").textContent =
      "字段名（" + report.keys.length + " 个）：" + report.keys.join("、");
    $("#pullDebugText").textContent = JSON.stringify((pull.raw || []).slice(0, 2), null, 1);
    $("#pullDebug").hidden = false;
  }

  function clearPull() {
    pull.courses = [];
    pull.report = null;
    pull.raw = null;
    $("#pullResult").innerHTML = "";
    $("#pullDebug").hidden = true;
    $("#pullDebugSummary").textContent = "";
    $("#pullDebugText").textContent = "";
    $("#pullStatus").hidden = true;
  }

  function pullTimetable() {
    if (pull.busy) return;

    var url = PULL_PROXY;
    var sid = $("#pullSid").value.trim();
    var pwd = $("#pullPwd").value;

    if (!sid || !pwd) {
      toast("SID/密码缺失", "本网站不会储存您的任何个人信息", "warn");
      return;
    }

    /* 只记住学号；密码不进 localStorage、也不进任何日志 */
    data.settings.pullSid = sid;
    save();

    pull.busy = true;
    clearPull();
    $("#pullStatus").hidden = false;
    $("#pullStatus").textContent = "正在向学校要课表…（一般一两秒）";
    renderPull();

    /* 每次都明确告诉代理用哪种写法——不依赖代理那台的默认值 */
    var body = { sid: sid, pwd: pwd, mode: PULL_MODE };

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () {
        return { ok: false, error: "bad_response" };
      });
    }).then(function (json) {
      if (!json || !json.ok) {
        $("#pullStatus").textContent = "没拉到：" + pullError(json);
        toast("没拉到课表", pullError(json), "warn");
        return;
      }

      var rows = json.courses || [];
      var built = OP.Timetable.toCourses(rows, {
        buildings: (data.campus && data.campus.buildings) || []
      });

      pull.raw = rows;
      pull.courses = OP.Timetable.mergeCourses(built.courses);
      pull.report = built.report;

      if (!pull.courses.length) {
        $("#pullStatus").textContent = rows.length
          ? "读到 " + rows.length + " 行，但一行都没解析出来"
          : "上游返回 0 条——密码错和这学期没选课，学校给的结果是一样的";
        $("#pullDebugSummary").textContent =
          "字段名（" + built.report.keys.length + " 个）：" + built.report.keys.join("、");
        $("#pullDebugText").textContent = JSON.stringify(rows.slice(0, 2), null, 1);
        $("#pullDebug").hidden = false;
        return;
      }

      /* 成功时不再写那句说明：下面就是结果列表和「导入这些课」，看得见 */
      $("#pullStatus").hidden = true;
      renderPullResult();
      renderPull();
    }).catch(function (err) {
      /* iOS Safari 对 fetch 失败只会说一句 "Load failed"，什么线索都没有。
         再发一个 **no-cors 探针**：这种请求不受 CORS 约束，只回答一个问题——
         "网络能不能碰到那台代理"。于是失败可以分成两类，提示才有用：
           能碰到 → 是来源（origin）不在 Worker 白名单里；
           碰不到 → 是网络层面到不了（常见：当前网络屏蔽了 workers.dev）。
         no-cors 下响应是 opaque 的，拿不到内容，这里也不需要内容。 */
      var origin = String((window.location && window.location.origin) || "（未知）");
      $("#pullStatus").textContent = "连不上代理，正在确认是网络问题还是来源问题…";

      return fetch(url, { method: "POST", mode: "no-cors", body: "{}" })
        .then(function () {
          $("#pullStatus").textContent =
            "连不上代理：网络能通，但当前页面来源不在代理白名单里。" +
            "把 " + origin + " 加进 Worker 的 ALLOWED_ORIGINS 就行。";
          toast("代理拒绝了这次请求", "页面来源：" + origin, "err");
        })
        .catch(function () {
          $("#pullStatus").textContent =
            "连不上代理：网络层面就到不了那台机器（当前网络可能屏蔽了 workers.dev）。" +
            "换个网络试试。页面来源：" + origin;
          toast("网络到不了代理", "试试关掉 VPN，或换一个网络", "err");
        });
    }).then(function () {
      pull.busy = false;
      /* 用完就把密码清掉，不留在一个已经打开的页面上 */
      $("#pullPwd").value = "";
      renderPull();
    });
  }

  function importPulled() {
    var list = pull.courses || [];
    if (!list.length) return;

    var courses = data.courses || (data.courses = []);
    var existing = {};
    courses.forEach(function (c) {
      existing[[c.name, (c.weekdays || []).join("+"), c.start, c.end, c.room].join("|")] = true;
    });

    var added = 0;
    var dup = 0;
    var created = 0;
    var filled = 0;

    list.forEach(function (c) {
      var key = [c.name, c.weekdays.join("+"), c.start, c.end, c.room].join("|");
      if (existing[key]) { dup++; return; }

      var buildingId = c.buildingId;
      if (!buildingId && c.buildingName) {
        /* 上游自带经纬度，建出来的楼栋直接就是能算路线的 */
        var made = {
          id: Store.uid("b"), name: c.buildingName, alias: [],
          lat: c.lat, lng: c.lng
        };
        (data.campus && data.campus.buildings || []).push(made);
        buildingId = made.id;
        created++;
      } else if (buildingId && typeof c.lat === "number") {
        /* 已有楼栋但没坐标：顺手补上，以后路线就能算了 */
        var b = P.buildingById(data, buildingId);
        if (b && (typeof b.lat !== "number" || typeof b.lng !== "number")) {
          b.lat = c.lat;
          b.lng = c.lng;
          filled++;
        }
      }

      courses.push({
        id: Store.uid("c"),
        name: c.name,
        teacher: c.teacher || "",
        buildingId: buildingId || "",
        room: c.room || "",
        weekdays: c.weekdays.slice(),
        start: c.start,
        end: c.end,
        /* 上游给的是起止日期，照原样存下来（课表里就显示这一段） */
        startDate: c.startDate || "",
        endDate: c.endDate || ""
      });
      existing[key] = true;
      added++;
    });

    saveAndRender();
    clearPull();
    $("#pullState").textContent = "已导入 " + added + " 条";

    var detail = [];
    if (dup) detail.push("跳过 " + dup + " 条已经有了的");
    if (created) detail.push("新建 " + created + " 栋楼（带坐标）");
    if (filled) detail.push("给 " + filled + " 栋楼补上了坐标");
    toast("已导入 " + added + " 条课程", detail.join("；"), "ok");
  }

  /* ================= 课表导出成图片 ================= */

  /* 生成好的那张图（canvas 和 blob）留在这里，给「保存」和「分享」两处用 */
  var shot = { canvas: null, blob: null, url: "" };

  /* 导出比例：三档壁纸尺寸，"自适应"按用户要求撤掉了（都要按比例铺满画布）。
     不管哪一档都用同一套网格，只是纵向拉长的幅度不同（见 exportimage.js 的 plan）。 */
  var SHOT_RATIOS = {
    phone: 9 / 19.5,
    tabletPortrait: 3 / 4,
    tabletLandscape: 4 / 3
  };

  var SHOT_RATIO_LABELS = {
    phone: "手机壁纸 9 : 19.5",
    tabletPortrait: "平板竖屏 3 : 4",
    tabletLandscape: "平板横屏 4 : 3"
  };

  var SHOT_RATIO_DEFAULT = "phone";

  function shotRatioKey() {
    var key = $("#imageRatio").value;
    return SHOT_RATIOS[key] ? key : SHOT_RATIO_DEFAULT;
  }

  /* 主色跟着页面主题走，别的地方用导出图自己的干净配色 */
  function accentToken() {
    var root = getComputedStyle(document.documentElement);
    var value = String(root.getPropertyValue("--accent") || "").trim();
    return value || OP.ExportImage.PALETTE.accent;
  }

  /* 图片里那行地点：楼栋名 + 教室（没有楼栋就说"地点待定"） */
  function shotPlace(course) {
    var b = P.buildingById(data, course.buildingId);
    var name = b ? b.name : "";
    if (!name) return course.room ? "教室 " + course.room : "地点待定";
    return name + (course.room ? " · " + course.room : "");
  }

  /**
   * 窄格子（跟别人并排时）用的简写地点：把 Building / Centre 这类通用词去掉，
   * 例如 "Academic Building No.1 · L3" → "Academic No.1 · L3"。
   * 但至少得留下两个词——"Science Centre" 变成 "Science" 就没意义了。
   */
  function shotShortPlace(course) {
    var full = shotPlace(course);
    var cut = full.replace(/\b(Building|Bldg|Centre|Center|Hall|Block|Complex|Institute)\b/gi, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*·\s*/g, " · ")
      .trim();
    return cut.split(/\s+/).filter(Boolean).length >= 2 ? cut : full;
  }

  function shotSubtitle(count) {
    var now = state.now;
    /* 周次写在右上角那个小标签上，这里不重复 */
    return P.dateLabel(now) + " · 共 " + count + " 门课";
  }

  function openTimetableImage() {
    var courses = data.courses || [];
    var ratioKey = shotRatioKey();
    var built = OP.ExportImage.render(courses, {
      title: "Olympic Protocol · 课表",
      subtitle: shotSubtitle(courses.length),
      badge: (function () {
        var wk = P.weekNumber(state.now, data.settings.termStart);
        return (wk !== null && wk >= 1) ? "第 " + wk + " 周" : "";
      })(),
      placeOf: shotPlace,
      shortPlaceOf: shotShortPlace,
      palette: { accent: accentToken() },
      ratio: SHOT_RATIOS[ratioKey]
    });

    if (!built) {
      toast("还没有能画的课", "先导入或新增课程，再来导出图片", "warn");
      return;
    }

    shot.canvas = built.canvas;
    shot.url = built.canvas.toDataURL("image/png");
    shot.blob = null;

    $("#imagePreview").src = shot.url;
    /* 只说尺寸和比例，不再带"长按保存到相册"那句说明（用户要求去掉） */
    $("#imageHint").textContent =
      "课表图片 " + built.canvas.width + "×" + built.canvas.height + " 像素 · " +
      (SHOT_RATIO_LABELS[ratioKey] || "");

    $("#imageBox").hidden = false;
  }

  function closeTimetableImage() {
    $("#imageBox").hidden = true;
    $("#imagePreview").removeAttribute("src");
    shot.canvas = null;
    shot.blob = null;
    shot.url = "";
  }

  function shotBlob(done) {
    if (shot.blob) { done(shot.blob); return; }
    if (!shot.canvas) { done(null); return; }
    if (shot.canvas.toBlob) {
      shot.canvas.toBlob(function (blob) {
        shot.blob = blob;
        done(blob);
      }, "image/png");
      return;
    }
    done(null);
  }

  function saveTimetableImage() {
    if (!shot.url) return;
    var name = shotFileName();

    /* 用 <a download> 下载。iOS Safari 对 download 支持不全，
       所以弹窗里那张图也能长按保存，两条路都留着。 */
    var link = document.createElement("a");
    link.href = shot.url;
    link.download = name;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  /* 文件名带上比例，导两张不同比例的不会互相覆盖 */
  function shotFileName() {
    var ratioKey = shotRatioKey();
    var names = {
      phone: "-手机壁纸",
      tabletPortrait: "-平板竖屏",
      tabletLandscape: "-平板横屏"
    };
    var suffix = names[ratioKey] || "";
    return "课表-" + P.dateKey(state.now) + suffix + ".png";
  }

  function renderCourse() {
    var box = $("#courseList");
    var courses = (data.courses || []).slice();

    /* 已经有课的时候才显示「导入前清空」那个选项 */
    $("#ocrReplaceWrap").hidden = !courses.length;

    renderPull(courses.length);

    if (!courses.length) {
      box.innerHTML = '<p class="empty">还没有课程，点右上角「新增课程」开始</p>';
      return;
    }

    box.innerHTML = [1, 2, 3, 4, 5, 6, 7].map(function (day) {
      var dayCourses = courses
        .filter(function (c) { return (c.weekdays || []).indexOf(day) >= 0; })
        .sort(function (a, b) { return P.hm(a.start) - P.hm(b.start); });
      if (!dayCourses.length) return "";

      return '<div class="day-group"><p class="day-title">' + esc(P.WEEKDAYS[day]) + "</p>" +
        dayCourses.map(function (c) {
          var b = P.buildingById(data, c.buildingId);
          return '<div class="course-item">' +
            '<div class="ci-main">' +
              '<div class="ci-title">' + esc(c.name) + "</div>" +
              '<div class="ci-meta">' + esc(c.start) + " – " + esc(c.end) +
                " · " + esc(P.placeText(c, b)) +
                (c.teacher ? " · " + esc(c.teacher) : "") + "<br>" +
                esc(P.weekText(c)) + "</div>" +
            "</div>" +
            '<div class="ci-actions">' +
              '<button class="btn btn-small" data-edit-course="' + esc(c.id) + '">编辑</button>' +
              '<button class="btn btn-small btn-danger" data-del-course="' + esc(c.id) + '">删除</button>' +
            "</div>" +
          "</div>";
        }).join("") + "</div>";
    }).join("");
  }

  function buildWeekdayPicker() {
    $("#cfWeekdays").innerHTML = [1, 2, 3, 4, 5, 6, 7].map(function (d) {
      return '<label class="wd"><input type="checkbox" name="wd" value="' + d + '"><span>' +
        esc(P.WEEKDAYS_SHORT[d]) + "</span></label>";
    }).join("");
  }

  function buildBuildingOptions(selected) {
    var list = (data.campus && data.campus.buildings) || [];
    $("#cfBuilding").innerHTML = list.map(function (b) {
      return '<option value="' + esc(b.id) + '"' + (b.id === selected ? " selected" : "") + ">" +
        esc(b.name) + "</option>";
    }).join("");
  }

  /* ================= 渲染：设置 ================= */

  function renderSettings() {
    var s = data.settings;

    $("#verApp").textContent = "v" + (OP.APP_VERSION || "0.0.0");
    $("#verBuild").textContent = buildStamp();
    $("#verData").textContent = "v" + (OP.Store.defaultBuildingsVersion() || 0);

    $("#vEnabled").checked = s.voiceEnabled !== false;
    $("#vRate").value = s.voiceRate;
    $("#vRateVal").textContent = Number(s.voiceRate).toFixed(2);
    $("#vVolume").value = s.voiceVolume;
    $("#vVolumeVal").textContent = Number(s.voiceVolume).toFixed(2);

    $("#sLead").value = s.leadMinutes;
    $("#sBuffer").value = s.bufferMinutes;
    $("#sSpeed").value = s.walkingSpeed;
    $("#sBusSpeed").value = Number(s.busSpeed) || OP.Shuttle.DEFAULT_BUS_SPEED;
    $("#sDetour").value = s.detourFactor;
    $("#sTermStart").value = s.termStart || "";
    $("#sClimb").value = s.climbFactor;
    $("#campusName").value = (data.campus && data.campus.name) || "";

    $("#plRadius").value = data.settings.placesRadius || 800;
    $("#plMerge").checked = data.settings.placesMerge !== false;
    $("#plEnglish").checked = data.settings.placesEnglish !== false;
    renderPlaces();

    var pos = effectivePosition();
    var nearest = P.nearestBuilding(pos, (data.campus && data.campus.buildings) || []);

    $("#locState").textContent = data.settings.simulate
      ? "模拟位置"
      : (state.locating
        ? "定位中"
        : (state.position ? "已定位" : (state.geoError ? "定位不可用" : "未开始")));
    $("#locCoords").textContent = pos ? pos.lat.toFixed(5) + ", " + pos.lng.toFixed(5) : "--";
    $("#locAccuracy").textContent = (state.position && !data.settings.simulate)
      ? "±" + Math.round(state.position.accuracy) + " 米" : "--";
    $("#locNearest").textContent = nearest ? nearest.building.name : "--";

    var list = (data.campus && data.campus.buildings) || [];
    /* 一栋都没有的时候没必要显示清空按钮 */
    $("#btnClearBuildings").hidden = !list.length;
    renderBuildingList(list);
  }

  /* 楼栋列表：支持关键词搜索和「只看缺坐标的」 */
  function renderBuildingList(all) {
    var query = ($("#buildingSearch").value || "").trim();
    var missingOnly = $("#buildingMissingOnly").checked;
    var shown = P.filterBuildings(all, query, missingOnly);

    var missingCount = all.filter(function (b) {
      return typeof b.lat !== "number" || typeof b.lng !== "number";
    }).length;
    var noElevation = all.filter(function (b) {
      return typeof b.lat === "number" && typeof b.lng === "number" &&
        typeof b.elevation !== "number";
    }).length;

    var count = "共 " + all.length + " 栋";
    if (missingCount) count += "，其中 " + missingCount + " 栋还没坐标";
    if (noElevation) count += "，" + noElevation + " 栋还没海拔（点「获取海拔」补）";
    if (missingOnly) count += " · 「只看还没坐标的」已开启";
    if (query || missingOnly) count += " · 当前显示 " + shown.length + " 栋";
    $("#buildingCount").textContent = count;

    if (!shown.length) {
      $("#buildingList").innerHTML = '<p class="empty">' + esc(emptyMessage(all, query, missingOnly)) + "</p>";
      return;
    }

    /* 收起时只显示前几栋。搜索/筛选时不收起——那说明你正在找某一栋 */
    var searching = !!(query || missingOnly);
    var visible = (searching || state.buildingListExpanded)
      ? shown
      : shown.slice(0, BUILDING_PREVIEW);

    var items = visible.map(function (b) {
      var hasCoords = typeof b.lat === "number" && typeof b.lng === "number";
      var coordText = hasCoords
        ? Number(b.lat).toFixed(5) + ", " + Number(b.lng).toFixed(5)
        : '<span class="bi-missing">还没坐标</span>';
      var alias = (b.alias && b.alias.length) ? b.alias.join("、") : "";
      var elevText = typeof b.elevation === "number"
        ? "海拔 " + Math.round(b.elevation) + " 米"
        : (hasCoords ? '<span class="bi-missing">海拔未知</span>' : "");

      return '<div class="building-item">' +
        '<div><div class="bi-name">' + esc(b.name) + "</div>" +
        '<div class="bi-meta">' + coordText +
        (elevText ? " · " + elevText : "") +
        (alias ? " · " + esc(alias) : "") + "</div></div>" +
        '<div class="ci-actions">' +
          '<button class="btn btn-small" data-edit-building="' + esc(b.id) + '">编辑</button>' +
          '<button class="btn btn-small btn-danger" data-del-building="' + esc(b.id) + '">删除</button>' +
        "</div></div>";
    }).join("");

    /* 只在没搜索的时候给"展开/收起"，这时才有"全部"这个概念 */
    var more = "";
    if (!searching && shown.length > BUILDING_PREVIEW) {
      more = '<button type="button" class="btn btn-small btn-ghost building-more" data-toggle-buildings>' +
        (state.buildingListExpanded
          ? "收起（只看前 " + BUILDING_PREVIEW + " 栋）"
          : "显示全部 " + shown.length + " 栋") +
        "</button>";
    }

    $("#buildingList").innerHTML = items + more;

    scheduleClearanceCheck();
  }

  /**
   * 筛不出东西时说清楚是哪一步把结果滤掉的。
   *
   * 踩过的坑：搜 "lady shaw" 明明有这栋楼却什么都不显示，
   * 因为上面那个「只看还没坐标的」还勾着——而原来的提示只说"没有匹配的楼栋"，
   * 完全没提这个可能性，非常难自查。
   */
  function emptyMessage(all, query, missingOnly) {
    if (!query && !missingOnly) return "还没有楼栋，先添加一个";

    if (missingOnly) {
      var matched = query ? P.filterBuildings(all, query, false).length : 0;
      if (matched) {
        return "有 " + matched + " 栋符合" + (query ? "「" + query + "」" : "") +
          "，但被「只看还没坐标的」筛掉了 —— 取消勾选就能看到";
      }
      if (!query) return "所有楼栋都已经有坐标了";
    }

    return "没有匹配「" + query + "」的楼栋";
  }

  /* ================= 总渲染 ================= */

  /* 复制文本：优先用剪贴板 API，老浏览器退回临时输入框 */
  function copyText(text, label) {
    function finish(ok) {
      toast(ok ? "坐标已复制" : "复制失败",
        ok ? text + "（粘到任何地图 App 的搜索框都行）" : "手动选中这串数字吧：" + text,
        ok ? "ok" : "err");
    }

    function fallback() {
      var input = document.createElement("textarea");
      input.value = text;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();

      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      document.body.removeChild(input);
      finish(ok);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { finish(true); }, fallback);
      return;
    }
    fallback();
    void label;
  }

  function render() {
    renderTop();
    if (state.view === "today") renderToday();
    else if (state.view === "route") {
      renderRoute(); renderDorm(); renderCustom();
      if (routeSlides) routeSlides.paint();
    }
    else if (state.view === "course") renderCourse();
    else if (state.view === "settings") renderSettings();
    /* 内容变了，页尾留白要重新核对 */
    scheduleClearanceCheck();
  }

  function save() {
    /* 楼栋统一按名字排序，这样列表、下拉框、导出的顺序都一致 */
    if (data.campus) data.campus.buildings = Store.sortBuildings(data.campus.buildings);
    Store.save(data);
  }

  function saveAndRender() {
    save();
    render();
  }

  /* ================= 定位 ================= */

  function startLocate() {
    if (!Geo.supported()) {
      toast("这个浏览器不支持定位", "换 Chrome、Edge 或 Safari 试试", "err");
      return;
    }
    state.locating = true;
    state.geoError = "";
    render();

    Geo.watch(function (pos) {
      /* 每次定位都换一个新对象，把已经查到的海拔带过去，省得重复请求 */
      if (state.position && typeof state.position.elevation === "number") {
        pos.elevation = state.position.elevation;
      }
      state.position = pos;
      state.locating = true;
      state.geoError = "";
      render();
      fillElevation(state.position, render);
    }, function (err) {
      state.locating = false;
      state.geoError = Geo.readableError(err);
      render();
    });

    toast("开始定位", "首次使用请在弹窗里允许位置权限", "ok");
  }

  function stopLocate() {
    Geo.stop();
    state.locating = false;
    render();
    toast("已停止定位", "");
  }

  /* ================= 提醒 ================= */

  function firedKey(kind, courseId) {
    return P.dateKey(state.now) + "|" + courseId + "|" + kind;
  }

  function pruneFired() {
    var today = P.dateKey(state.now);
    Object.keys(state.fired).forEach(function (k) {
      if (k.indexOf(today) !== 0) delete state.fired[k];
    });
  }

  function checkAlerts() {
    pruneFired();
    var info = nextInfo();
    if (!info.found || !info.leg) return;
    if (info.found.status === "ongoing") return;

    var leg = info.leg;
    var now = state.now;
    var lead = Number(data.settings.leadMinutes) || 0;
    var leadAt = new Date(leg.start.getTime() - lead * 60000);

    var leadKey = firedKey("lead", leg.course.id);
    if (!state.fired[leadKey] && lead > 0 && now >= leadAt && now < leg.start) {
      state.fired[leadKey] = Date.now();
      Store.saveFired(state.fired);
      say(P.nextText(data, now, effectivePosition()), "课前提醒");
    }

    var leaveKey = firedKey("leave", leg.course.id);
    if (!state.fired[leaveKey] && now >= leg.departAt && now < leg.start) {
      state.fired[leaveKey] = Date.now();
      Store.saveFired(state.fired);
      say(P.leaveText(leg, now), "出发提醒");
    }
  }

  /* ================= 课程表单 ================= */

  function openCourseForm(course) {
    buildWeekdayPicker();
    buildBuildingOptions(course ? course.buildingId : null);
    $("#courseFormTitle").textContent = course ? "编辑课程" : "新增课程";
    $("#cfId").value = course ? course.id : "";
    $("#cfName").value = course ? course.name : "";
    $("#cfRoom").value = course ? (course.room || "") : "";
    $("#cfTeacher").value = course ? (course.teacher || "") : "";
    $("#cfStart").value = course ? course.start : "08:00";
    $("#cfEnd").value = course ? course.end : "09:40";
    /* 起止日期：从学校接口拉回来的课带着，这里要能看见、也能改 */
    $("#cfStartDate").value = course ? (course.startDate || "") : "";
    $("#cfEndDate").value = course ? (course.endDate || "") : "";

    $$('#cfWeekdays input[name="wd"]').forEach(function (input) {
      input.checked = !!(course && (course.weekdays || []).indexOf(Number(input.value)) >= 0);
    });
    if (!course) $("#cfWeekdays input[value='1']").checked = true;

    $("#courseFormCard").hidden = false;
    $("#courseFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeCourseForm() { $("#courseFormCard").hidden = true; }

  function submitCourse(ev) {
    ev.preventDefault();

    var days = $$('#cfWeekdays input[name="wd"]')
      .filter(function (i) { return i.checked; })
      .map(function (i) { return Number(i.value); });

    if (!days.length) {
      toast("还没有选上课星期", "至少勾选一天", "warn");
      return;
    }
    if (P.hm($("#cfEnd").value) <= P.hm($("#cfStart").value)) {
      toast("时间不对", "下课时间要晚于上课时间", "warn");
      return;
    }

    var id = $("#cfId").value;
    var payload = {
      name: $("#cfName").value.trim(),
      buildingId: $("#cfBuilding").value,
      room: $("#cfRoom").value.trim(),
      teacher: $("#cfTeacher").value.trim(),
      start: $("#cfStart").value,
      end: $("#cfEnd").value,
      weekdays: days.sort(function (a, b) { return a - b; }),
      /* 留空就是"整学期都上"（手输/截图导入的课都是这种） */
      startDate: $("#cfStartDate").value || "",
      endDate: $("#cfEndDate").value || ""
    };

    if (id) {
      var target = P.courseById(data, id);
      if (target) Object.keys(payload).forEach(function (k) { target[k] = payload[k]; });
    } else {
      payload.id = Store.uid("c");
      data.courses.push(payload);
    }

    closeCourseForm();
    saveAndRender();
  }

  /* ================= 楼栋表单 ================= */

  /* ================= 从地图读取附近楼栋 ================= */

  function renderPlaces() {
    var box = $("#placesList");
    var list = state.places || [];
    $("#plStatus").textContent = state.placesStatus;

    if (!list.length) {
      box.innerHTML = "";
      return;
    }

    var split = OP.Places.splitDuplicates(list, (data.campus && data.campus.buildings) || [], 25);
    var freshSet = split.fresh;

    box.innerHTML = list.map(function (item, i) {
      var dup = freshSet.indexOf(item) === -1;
      var badges = "";
      if (item.teaching) badges += '<span class="pi-badge">教学楼</span>';
      if (item.merged > 1) badges += '<span class="pi-badge">合并 ' + item.merged + " 个点</span>";
      if (dup) badges += '<span class="pi-badge is-muted">已在列表</span>';

      var meta = [
        item.distance !== null ? Geo.formatDistance(item.distance) : "",
        "OpenStreetMap",
        item.kind || "",
        item.address || ""
      ].filter(function (t) { return t; }).join(" · ");

      return '<label class="place-item">' +
        '<input type="checkbox" data-place-idx="' + i + '"' + (dup ? "" : " checked") + ">" +
        '<div class="pi-main">' +
          '<div class="pi-name">' + esc(item.name) + badges + "</div>" +
          (item.alias && item.alias.length
            ? '<div class="pi-alias">又名：' + esc(item.alias.slice(0, 4).join("、")) + "</div>"
            : "") +
          '<div class="pi-meta">' + esc(meta) + "</div>" +
          (item.merged > 1 && item.mergedNames && item.mergedNames.length
            ? '<div class="pi-meta">同栋楼内还有：' + esc(item.mergedNames.join("、")) + "</div>"
            : "") +
          (dup
            ? '<button type="button" class="btn btn-small place-merge" data-place-idx="' + i +
              '">把这些名字补进已有楼栋</button>'
            : "") +
        "</div></label>";
    }).join("");
  }

  /* 之前只导入了中文名的楼栋，可以用这个把英文名补进别名 */
  function mergePlaceAliases(index) {
    var item = (state.places || [])[index];
    if (!item) return;

    var buildings = (data.campus && data.campus.buildings) || [];
    var target = OP.Places.findExisting(item, buildings, 25);
    if (!target) {
      toast("没找到对应的楼栋", "列表可能已经变了，重新搜一次", "warn");
      return;
    }

    var added = OP.Places.mergeAliases(item, target);
    if (!added) {
      toast("没有需要补的名字", "「" + target.name + "」已经有这些名字了");
      return;
    }

    saveAndRender();
    renderPlaces();
  }

  function searchPlaces() {
    var pos = effectivePosition();

    if (!pos) {
      toast("还没有位置", "先在「定位」里开启定位，或用模拟位置", "warn");
      return;
    }

    var radius = Number($("#plRadius").value) || 800;
    data.settings.placesRadius = radius;
    save();

    state.placesRaw = null;
    state.places = [];
    renderPlaces();
    $("#btnSearchPlaces").disabled = true;
    startPlacesTicker(radius);

    var options = placeOptions(pos, radius);
    options.onRaw = function (raw) { state.placesRaw = raw; };

    OP.Places.search(options).then(function (list) {
      stopPlacesTicker();
      state.places = list;
      state.placesStatus = list.length ? "找到 " + list.length + " 个" : "没找到";
      renderPlaces();
      if (!list.length) {
        toast("没有找到建筑", "换个来源、把半径调大，或清空名称过滤再试", "warn");
      } else if (state.placesRaw && state.placesRaw.length >= OP.Places.resultLimitFor(radius)) {
        /* 结果顶到上限，说明很可能被截断了 */
        toast("结果已达上限，可能有楼栋没列出来",
          "这个半径下带名字的建筑超过 " + OP.Places.resultLimitFor(radius) +
          " 栋。找指定的楼用上面的「按名字搜」。", "warn");
      }
    }).catch(function (err) {
      stopPlacesTicker();
      state.placesRaw = null;
      state.places = [];
      state.placesStatus = "搜索失败";
      renderPlaces();
      toast("搜索失败", err.message, "err");
    }).then(function () {
      $("#btnSearchPlaces").disabled = false;
    });
  }

  /* 搜索参数集中在这里，重新排序和重新联网都走同一份 */
  function placeOptions(pos, radius) {
    return {
      lat: pos.lat,
      lng: pos.lng,
      radius: radius,
      keyword: $("#plKeyword").value,
      merge: data.settings.placesMerge !== false,
      preferEnglish: data.settings.placesEnglish !== false
    };
  }

  /**
   * 只改本地展示，不重新联网。
   * 「合并同一栋楼」「优先用英文名」「名称过滤」都走这里——瞬间生效。
   */
  function reshapePlaces() {
    var pos = effectivePosition();
    if (!state.placesRaw || !pos) return;

    var radius = Number($("#plRadius").value) || 800;
    state.places = OP.Places.shape(state.placesRaw, placeOptions(pos, radius));
    state.placesStatus = state.places.length ? "找到 " + state.places.length + " 个" : "没找到";
    renderPlaces();
  }

  /* 搜索时显示已用秒数，免得看起来像卡死了 */
  /**
   * 按名字找指定的楼。
   *
   * 半径搜索有结果条数上限，校园里楼多的时候想找的那一栋可能被截断在外，
   * 所以"找某个具体的楼"必须走名字检索，和"看看附近有什么"是两件事。
   */
  function searchPlacesByName() {
    var query = $("#plNameQuery").value.trim();
    if (!query) {
      toast("请输入楼栋名字", "中文英文都行，例如 Lady Shaw 或 邵逸夫", "warn");
      return;
    }

    var pos = effectivePosition();
    state.placesRaw = null;
    state.places = [];
    renderPlaces();
    $("#btnSearchByName").disabled = true;
    $("#plStatus").textContent = "搜索中…";

    OP.Places.searchByName(query, pos ? { lat: pos.lat, lng: pos.lng } : {}).then(function (list) {
      state.places = OP.Places.shape(list, placeOptions(pos || { lat: 0, lng: 0 },
        Number($("#plRadius").value) || 800));
      state.placesStatus = list.length ? "按名字找到 " + state.places.length + " 个" : "没找到";
      renderPlaces();
      if (!list.length) {
        toast("没找到这个楼栋", "换个写法试试，比如只输一部分名字", "warn");
      }
    }).catch(function (err) {
      state.places = [];
      state.placesStatus = "搜索失败";
      renderPlaces();
      toast("按名字搜索失败", err.message, "err");
    }).then(function () {
      $("#btnSearchByName").disabled = false;
    });
  }

  var placesTicker = null;

  function startPlacesTicker(radius) {
    stopPlacesTicker();
    var started = Date.now();
    var limit = Math.round(OP.Places.timeoutFor(radius) / 1000);
    $("#plStatus").textContent = "搜索中… 0 秒";
    placesTicker = window.setInterval(function () {
      var sec = Math.floor((Date.now() - started) / 1000);
      var text = "搜索中… " + sec + " 秒（最多等 " + limit + " 秒）";
      /* 等久了给句话，免得看起来像卡死 */
      if (sec >= 30) text += " · 地图服务繁忙，请再等等";
      $("#plStatus").textContent = text;
    }, 1000);
  }

  function stopPlacesTicker() {
    if (placesTicker) {
      window.clearInterval(placesTicker);
      placesTicker = null;
    }
  }

  function addSelectedPlaces() {
    var list = state.places || [];
    var picked = $$("#placesList input[data-place-idx]:checked")
      .map(function (input) { return Number(input.getAttribute("data-place-idx")); });

    if (!picked.length) {
      toast("没有勾选任何建筑", "先勾上要去的那几栋", "warn");
      return;
    }

    var added = 0;
    picked.forEach(function (idx) {
      var item = list[idx];
      if (!item) return;
      data.campus.buildings.push({
        id: Store.uid("b"),
        name: item.name,
        alias: (item.alias || []).slice(0, 8),
        lat: Number(Number(item.lat).toFixed(6)),
        lng: Number(Number(item.lng).toFixed(6))
      });
      added++;
    });

    saveAndRender();
    renderPlaces();
  }

  /* ================= 从截图导入课表 ================= */

  /* ================= 自动补齐楼栋 =================
   *
   * 导入课表时，匹配不上已有楼栋的地点会先建一个"没有坐标"的占位。
   * 这里逐个拿它们的名字去 OSM 找，挑名字最像的那一栋，把坐标和别名填进去。
   */

  /* Nominatim 的使用条款要求每秒最多一次请求 */
  var NOMINATIM_GAP = 1100;

  function pendingBuildings() {
    return ((data.campus && data.campus.buildings) || []).filter(function (b) {
      return b.name && (typeof b.lat !== "number" || typeof b.lng !== "number");
    });
  }

  /**
   * @param {Function} onProgress (已完成, 总数, 当前楼栋名)
   * @returns {Promise<{total, filled, skipped}>}
   */
  function autoFillBuildings(onProgress) {
    var todo = pendingBuildings();
    if (!todo.length) return Promise.resolve({ total: 0, filled: 0, skipped: [] });

    var pos = effectivePosition();
    var near = pos ? { lat: pos.lat, lng: pos.lng } : {};
    var filled = 0;
    var skipped = [];
    var index = 0;

    function step() {
      if (index >= todo.length) return Promise.resolve();

      var building = todo[index++];
      if (onProgress) onProgress(index, todo.length, building.name);

      return OP.Places.searchByName(building.name, near).then(function (candidates) {
        var match = OP.Places.bestNameMatch(building.name, candidates, 0.6);
        if (!match) {
          skipped.push(building.name);
          return;
        }
        building.lat = Number(Number(match.lat).toFixed(6));
        building.lng = Number(Number(match.lng).toFixed(6));
        /* 显示名保留课表里的写法，OSM 的中英文名补进别名 */
        OP.Places.mergeAliases(match, building);
        filled++;
      }).catch(function () {
        skipped.push(building.name);
      }).then(function () {
        return new Promise(function (done) { window.setTimeout(done, NOMINATIM_GAP); });
      }).then(step);
    }

    return step().then(function () {
      saveAndRender();
      return { total: todo.length, filled: filled, skipped: skipped };
    });
  }

  function runAutoFill(silentWhenEmpty) {
    var button = $("#btnAutoFillBuildings");
    var original = button ? button.textContent : "";
    if (button) button.disabled = true;

    return autoFillBuildings(function (done, total) {
      if (button) button.textContent = "补齐中 " + done + "/" + total;
    }).then(function (result) {
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }

      if (!result.total) {
        if (!silentWhenEmpty) toast("没有需要补的楼栋", "所有楼栋都有坐标了", "ok");
        return result;
      }

      var detail = result.filled + " / " + result.total + " 栋已补上坐标";
      if (result.skipped.length) {
        detail += "；没找到：" + result.skipped.join("、");
      }
      toast("自动补齐完成", detail, result.filled ? "ok" : "warn");
      return result;
    });
  }

  function ocrProgress(text, ratio) {
    var box = $("#ocrProgress");
    var bar = $("#ocrProgressBar");
    var label = $("#ocrProgressText");

    if (text === null) {
      box.hidden = true;
      label.hidden = true;
      return;
    }
    box.hidden = false;
    label.hidden = false;
    /* 用 transform 而不是 width：动布局属性的动画会一直触发重排 */
    bar.style.transform = "scaleX(" + Math.max(0.02, ratio || 0).toFixed(3) + ")";
    label.textContent = text + (ratio ? "  " + Math.round(ratio * 100) + "%" : "");
  }

  function clearOcr(keepStatus) {
    state.ocr.courses = [];
    state.ocr.warnings = [];
    state.ocr.lastResult = null;
    $("#ocrResult").innerHTML = "";
    $("#ocrActions").hidden = true;
    $("#ocrDebug").hidden = true;
    ocrProgress(null);
    if (!keepStatus) $("#ocrStatus").textContent = "未开始";
  }

  /* 识别明细，用来判断问题出在哪一步（引擎没吐字 / 找不到表头 / 拼不出格子） */
  function renderOcrDebug(result) {
    var box = $("#ocrDebug");
    if (!result || !result.wordCount) {
      box.hidden = true;
      return;
    }

    var cols = (result.columns || []).map(function (c) {
      return P.WEEKDAYS_SHORT[c.day];
    }).join(" ");
    var axis = result.timeAxis
      ? (result.timeAxis.points || []).length + " 个时间刻度"
      : "没找到时间刻度";

    box.hidden = false;
    var rejected = result.rejected || [];

    $("#ocrDebugSummary").textContent =
      "文字块 " + result.wordCount + " 个 · 分割模式 " + result.mode +
      (result.variant ? " · 像素处理 " + result.variant : "") +
      " · 试了 " + result.tries + " 遍 · 列：" + (cols || "没找到") +
      " · " + axis + " · 拼出课程 " + (result.courses || []).length + " 条" +
      " · 丢弃 " + rejected.length + " 个格子";

    var parts = [];
    if (rejected.length) {
      parts.push("【被丢弃的格子】判定标准是必须同时有「4 字母 + 4 数字」的课程代号和课程类型：");
      rejected.forEach(function (r) {
        parts.push("· " + r.reason + "：" + r.text);
      });
      parts.push("");
    }
    parts.push("【引擎识别到的原文】");
    parts.push((result.text || "").slice(0, 4000) || "（引擎没有返回文字内容）");

    $("#ocrDebugText").textContent = parts.join("\n");
  }

  function handleOcrFile(file) {
    if (state.ocr.busy) return;
    if (!file || !/^image\//.test(file.type || "")) {
      toast("这不是图片", "截图之后再拖进来，或者直接按 Ctrl+V 粘贴", "warn");
      return;
    }

    state.ocr.busy = true;
    state.ocr.courses = [];
    $("#ocrResult").innerHTML = "";
    $("#ocrActions").hidden = true;
    $("#ocrStatus").textContent = "识别中…";
    ocrProgress("正在准备", 0.02);

    OP.Ocr.run(file, {
      /* 只认英文。以前这里有个「课表里有中文」的开关，按用户要求去掉了：
         开中文要另外下一个语言包、识别也慢一截，而课表上的课程代号、
         时间、教室号本来就是英文数字。真要认中文，把这里改成 "eng+chi_sim"。 */
      lang: "eng",
      onProgress: ocrProgress
    }).then(function (result) {
      ocrProgress(null);
      state.ocr.lastResult = result;
      state.ocr.courses = result.courses || [];
      state.ocr.warnings = result.warnings || [];
      renderOcrDebug(result);

      if (!state.ocr.courses.length) {
        $("#ocrStatus").textContent = "没认出来";

        var words = result.wordCount || 0;
        var reason;
        if (!words) {
          reason = "识别引擎没有从这张图里读出一个字。多半是图片太小或太糊——" +
            "试试把课表区域放大后重新截图，别截图整个手机屏幕。";
        } else if (!result.columns || !result.columns.length) {
          reason = "读到了 " + words + " 个文字，但没找到星期那一行表头。" +
            "确认截图里完整包含 Monday…Friday（或周一…周五）这一行。";
        } else {
          reason = "读到了 " + words + " 个文字，也找到了表头，但没能拼出课程。" +
            "展开下面的识别详情，把里面的内容发给我，我按实际情况调。";
        }
        $("#ocrResult").innerHTML = '<p class="empty">' + esc(reason) + "</p>";
        return;
      }

      $("#ocrStatus").textContent = "识别出 " + state.ocr.courses.length + " 条";
      renderOcrResult();
    }).catch(function (err) {
      ocrProgress(null);
      $("#ocrStatus").textContent = "失败";
      toast("识别失败", err.message, "err");
    }).then(function () {
      state.ocr.busy = false;
    });
  }

  function renderOcrResult() {
    var list = state.ocr.courses;
    var buildings = (data.campus && data.campus.buildings) || [];

    var html = '<div class="ocr-list">';

    list.forEach(function (c, i) {
      /* 下拉框的选项由 ocr.js 排好：够像的楼栋全在最上面那一组（最像的选中），
         课表写 "Science Centre" 时东座、大学科学馆都能一眼看到，
         不用自己去 150 栋里翻。 */
      var picker = OP.Ocr.matchOptions(c.buildingName, buildings, { noRoom: c.noRoom, escape: esc });
      var options = picker.html;
      var match = picker.ranked.length ? picker.ranked[0] : null;

      if (c.buildingName && !match) {
        options += '<option value="__new__" selected>＋ 新建楼栋：' + esc(c.buildingName) + "</option>";
      }

      var notes = [];
      if (c.waiting) notes.push("原课表标记为候补（Waiting）");
      if (c.needsTime) notes.push("时间没读准，请核对");
      if (c.buildingName && !match) {
        notes.push("「" + c.buildingName + "」不在楼栋列表里，导入时会新建，之后要补坐标");
      } else if (match && !match.exact) {
        /* 只报把握度：匹配到哪一栋，上面那个下拉框里已经选中了，不用再念一遍 */
        notes.push("自动匹配 " + Math.round(match.score * 100) + "%");
      }

      /* 黄框只给"页面上确实写了原因"的行留着。
         地点待定（TBA）不再单独提醒，所以也不标黄——
         否则会出现"黄框但一个字都没说"的怪状态，下拉框里显示"（未指定）"已经说明问题。 */
      var bad = c.needsTime || (c.buildingName && !match) || (match && !match.exact);

      html += '<div class="ocr-row' + (bad ? " is-bad" : "") + '" data-idx="' + i + '"' +
        ' data-building-name="' + esc(c.buildingName || "") + '">' +
        '<div class="ocr-row-head">' +
          '<select class="ocr-day">' + [1, 2, 3, 4, 5, 6, 7].map(function (d) {
            return '<option value="' + d + '"' + (d === c.weekday ? " selected" : "") + ">" +
              esc(P.WEEKDAYS_SHORT[d]) + "</option>";
          }).join("") + "</select>" +
          '<input class="ocr-start" type="time" value="' + esc(c.start || "") + '">' +
          '<span class="ocr-dash">–</span>' +
          '<input class="ocr-end" type="time" value="' + esc(c.end || "") + '">' +
          '<button type="button" class="btn btn-small btn-danger ocr-remove">移除</button>' +
        "</div>" +
        '<input class="ocr-name" type="text" value="' + esc(c.name || "") + '" placeholder="课程名称">' +
        '<div class="field-row">' +
          '<select class="ocr-building">' + options + "</select>" +
          '<input class="ocr-room" type="text" value="' + esc(c.room || "") + '" placeholder="房间">' +
        "</div>" +
        (notes.length ? '<div class="ocr-note">' + esc(notes.join("；")) + "</div>" : "") +
      "</div>";
    });

    html += "</div>";
    $("#ocrResult").innerHTML = html;
    $("#ocrActions").hidden = false;
    $("#ocrReplaceWrap").hidden = !(data.courses && data.courses.length);
    /* 结果一出来卡片会变高很多，重新核对页尾留白 */
    scheduleClearanceCheck();
  }

  function importOcrCourses(skipConfirm) {
    var rows = $$(".ocr-row");
    if (!rows.length) return;

    var clearFirst = $("#ocrReplace").checked;

    if (clearFirst && !skipConfirm) {
      askConfirm("会用识别结果覆盖现在的全部课程，确定吗？", function () {
        importOcrCourses(true);
      });
      return;
    }

    var added = 0;
    var skipped = 0;
    var createdBuildings = [];

    if (clearFirst) data.courses = [];

    rows.forEach(function (row) {
      var name = row.querySelector(".ocr-name").value.trim();
      var start = row.querySelector(".ocr-start").value;
      var end = row.querySelector(".ocr-end").value;

      if (!name || !start || !end) { skipped++; return; }

      var buildingId = row.querySelector(".ocr-building").value;

      if (buildingId === "__new__") {
        var newName = row.getAttribute("data-building-name") || "新楼栋";
        var created = { id: Store.uid("b"), name: newName, alias: [], lat: null, lng: null };
        data.campus.buildings.push(created);
        buildingId = created.id;
        createdBuildings.push(newName);
      }

      data.courses.push({
        id: Store.uid("c"),
        name: name,
        teacher: "",
        buildingId: buildingId || "",
        room: row.querySelector(".ocr-room").value.trim(),
        weekdays: [Number(row.querySelector(".ocr-day").value)],
        start: start,
        end: end
      });
      added++;
    });

    saveAndRender();
    clearOcr(true);
    $("#ocrStatus").textContent = "已导入 " + added + " 条";

    var detail = [];
    if (skipped) detail.push("跳过 " + skipped + " 条（信息不全）");
    if (createdBuildings.length) detail.push("新建了 " + createdBuildings.length + " 栋楼");
    toast("已导入 " + added + " 条课程", detail.join("；"), "ok");

    if (createdBuildings.length) {
      toast("这些楼栋还没有坐标",
        createdBuildings.join("、") + "。去「设置 → 校区楼栋」补一下，路线才能算。", "warn");
    }

    /* 导入完直接去 OSM 找这些楼，省得手工一栋栋补 */
    if (createdBuildings.length) {
      window.setTimeout(function () { runAutoFill(true); }, 900);
    }
  }

  function openBuildingForm(building) {
    $("#buildingForm").hidden = false;
    $("#bfId").value = building ? building.id : "";
    $("#bfName").value = building ? building.name : "";
    $("#bfAlias").value = (building && building.alias) ? building.alias.join(",") : "";
    $("#bfLat").value = building ? building.lat : "";
    $("#bfLng").value = building ? building.lng : "";
    $("#buildingForm").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function submitBuilding(ev) {
    ev.preventDefault();

    var id = $("#bfId").value;
    var alias = $("#bfAlias").value.split(/[,，、]/)
      .map(function (t) { return t.trim(); })
      .filter(function (t) { return t; });

    var payload = {
      name: $("#bfName").value.trim(),
      alias: alias,
      lat: Number($("#bfLat").value),
      lng: Number($("#bfLng").value)
    };

    if (!payload.name || isNaN(payload.lat) || isNaN(payload.lng)) {
      toast("信息不完整", "楼栋名称和经纬度都要填", "warn");
      return;
    }

    var replaced = false;
    if (id) {
      data.campus.buildings.forEach(function (b) {
        if (b.id === id) {
          Object.keys(payload).forEach(function (k) { b[k] = payload[k]; });
          replaced = true;
        }
      });
    }
    if (!replaced) {
      payload.id = id || Store.uid("b");
      data.campus.buildings.push(payload);
    }

    $("#buildingForm").hidden = true;
    saveAndRender();
  }

  /* ================= 事件绑定 ================= */

  function bindEvents() {
    $$(".tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.view = btn.dataset.tab;
        $$(".tab").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
        $$(".view").forEach(function (v) { v.classList.toggle("is-active", v.dataset.view === state.view); });
        render();
      });
    });

    /* --- 地图底图切换 --- */
    $$(".map-mode").forEach(function (btn) {
      btn.addEventListener("click", function () {
        data.settings.mapMode = btn.dataset.mapmode;
        saveAndRender();
      });
    });

    /* --- 路线页三张卡片：滑动切换，切到哪张地图就画哪张 --- */
    routeSlides = makeSlides({
      nav: "#routeNav",
      scroller: "#routeSlides",
      slides: SLIDES,
      initial: routeSlide,
      onChange: function (kind) {
        routeSlide = kind;
        /* 只重画地图：三张卡片的内容本身不受影响 */
        renderRouteMap();
      }
    });

    /* --- 课表页两张卡片：拉取课表 / 截图导入（默认停在拉取） --- */
    importSlides = makeSlides({
      nav: "#importNav",
      scroller: "#importSlides",
      slides: ["pull", "ocr"],
      initial: "pull"
    });

    /* --- 自定义路线（选完就自动算） --- */
    /* 起点：候选里第一项是「我的位置」（id 为空字符串） */
    attachPicker({
      input: "#customFromSearch",
      list: "#customFromList",
      items: function () { return buildingPickerItems(true); },
      current: function () {
        var b = data.settings.customFrom ? P.buildingById(data, data.settings.customFrom) : null;
        return b ? b.name : "我的位置";
      },
      empty: "没找到这栋楼。中英文、简繁体、拼音首字母都认（蒙民伟楼 / 蒙民偉樓 / mmwl）。",
      onPick: function (item) {
        data.settings.customFrom = item.id;
        $("#customFromSearch").value = item.label;
        saveAndRender();
      }
    });

    /* 终点：只有楼栋 */
    attachPicker({
      input: "#customToSearch",
      list: "#customToList",
      items: function () { return buildingPickerItems(false); },
      current: function () {
        var b = data.settings.customTo ? P.buildingById(data, data.settings.customTo) : null;
        return b ? b.name : "";
      },
      empty: "没找到这栋楼。中英文、简繁体、拼音首字母都认（蒙民伟楼 / 蒙民偉樓 / mmwl）。",
      onPick: function (item) {
        data.settings.customTo = item.id;
        $("#customToSearch").value = item.label;
        saveAndRender();
      }
    });

    /* 输入框里可能是全名、别名或者半截名字，回车 / 失焦时交给这个名字解析器兜底 */
    $("#customFromSearch").addEventListener("change", function () {
      pickBuildingByName("#customFromSearch", "customFrom", true);
    });
    $("#customToSearch").addEventListener("change", function () {
      pickBuildingByName("#customToSearch", "customTo", false);
    });

    $("#btnCustomSwap").addEventListener("click", function () {
      /* 起点是「我的位置」时没有"对调"可言：位置不在下拉里 */
      if (!data.settings.customFrom) {
        toast("起点是「我的位置」", "先把起点选成一栋楼，才能跟终点对调", "warn");
        return;
      }
      var tmp = data.settings.customFrom;
      data.settings.customFrom = data.settings.customTo;
      data.settings.customTo = tmp;
      saveAndRender();
    });

    /* --- 返回宿舍 --- */

    /* 宿舍：候选列表自己渲染，跟搜索走同一套规则（简繁 + 拼音首字母） */
    attachPicker({
      input: "#dormSearch",
      list: "#dormSuggest",
      items: function () {
        return OP.Dorm.all(data.settings).map(function (d) {
          return {
            id: d.id,
            label: d.label,
            meta: d.custom ? "自建" : "OSM",
            names: OP.Dorm.names(d)
          };
        });
      },
      current: function () {
        var d = dormTarget();
        return d ? d.label : "";
      },
      empty: "没有匹配的宿舍。中英文、简体繁体、拼音首字母都认，试试只打前两个字。",
      onPick: function (item) { chooseDorm(item.id); }
    });

    /* 输入框里可能是全名、中文别名或者半截名字，交给 resolveDorm 去挑 */
    $("#dormSearch").addEventListener("change", function () {
      pickDormByName($("#dormSearch").value);
      $("#dormSuggest").hidden = true;
    });

    /* 点到别的地方就把所有候选收起来 */
    document.addEventListener("click", function (ev) {
      pickers.forEach(function (p) { p.hideIfOutside(ev.target); });
    });

    $("#btnDormRemove").addEventListener("click", function () {
      var dorm = dormTarget();
      if (!dorm || !dorm.custom) return;
      /* 删一个宿舍是可撤销的：直接删 + 给一条带「撤销」的提示条，
         不再弹确认框（技能：可撤销的操作，撤销优先于确认）。 */
      var list = data.settings.addedDorms || [];
      var entry = list.filter(function (d) { return d.id === dorm.id; })[0];
      var at = list.indexOf(entry);
      OP.Dorm.remove(data.settings, dorm.id);
      data.settings.dormId = "";
      saveAndRender();
      toast("已删除宿舍", dorm.label, "", {
        label: "撤销",
        onAction: function () {
          if (!entry) return;
          data.settings.addedDorms = data.settings.addedDorms || [];
          data.settings.addedDorms.splice(at < 0 ? 0 : at, 0, entry);
          data.settings.dormId = entry.id;
          saveAndRender();
        }
      });
    });

    /* --- 卡片里的「复制坐标」（行程 / 返回宿舍 / 自定义路线都走这里） --- */
    document.addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-copy]");
      if (!btn) return;
      ev.preventDefault();
      copyText(btn.getAttribute("data-copy"), btn.textContent);
    });

    /* --- 今日 --- */
    $("#btnSpeakNext").addEventListener("click", function () {
      say(P.nextText(data, state.now, effectivePosition()), "播报下一节");
    });

    $("#btnBrief").addEventListener("click", function () {
      say(P.briefingText(data, state.now, effectivePosition()), "今日课表");
    });

    /* --- 定位 --- */
    $("#btnLocate").addEventListener("click", startLocate);
    $("#btnStopLocate").addEventListener("click", stopLocate);

    /* --- 语音 --- */
    $("#vEnabled").addEventListener("change", function () {
      data.settings.voiceEnabled = this.checked;
      save();
    });

    $("#vVoiceSelect").addEventListener("change", function () {
      data.settings.voiceURI = this.value;
      save();
    });

    $("#vRate").addEventListener("input", function () {
      data.settings.voiceRate = Number(this.value);
      $("#vRateVal").textContent = Number(this.value).toFixed(2);
      save();
    });

    $("#vVolume").addEventListener("input", function () {
      data.settings.voiceVolume = Number(this.value);
      $("#vVolumeVal").textContent = Number(this.value).toFixed(2);
      save();
    });

    $("#btnTestVoice").addEventListener("click", function () {
      say("这是 Olympic Protocol 的语音测试。今天有课，记得按时出发。", "试听");
    });

    $("#btnStopVoice").addEventListener("click", function () {
      OP.Speech.stop();
    });

    /* --- 提醒参数 --- */
    [["#sLead", "leadMinutes"], ["#sBuffer", "bufferMinutes"],
     ["#sSpeed", "walkingSpeed"], ["#sDetour", "detourFactor"],
     ["#sBusSpeed", "busSpeed"]].forEach(function (pair) {
      $(pair[0]).addEventListener("change", function () {
        data.settings[pair[1]] = Number(this.value);
        saveAndRender();
      });
    });

    $("#sTermStart").addEventListener("change", function () {
      data.settings.termStart = this.value;
      saveAndRender();
    });

    $("#sClimb").addEventListener("change", function () {
      data.settings.climbFactor = Number(this.value);
      saveAndRender();
    });

    $("#btnTestAlert").addEventListener("click", function () {
      var info = nextInfo();
      if (!info.leg) {
        say("现在没有要前往的教室。", "测试");
        return;
      }
      say(P.leaveText(info.leg, state.now), "出发提醒");
    });

    /* 提醒与步行参数一键回到默认值。
       只重置这一张卡片里的项，不动语音、地图、楼栋和课表 */
    $("#btnResetWalk").addEventListener("click", function () {
      /* 这一张卡片的值都能改回来，所以是可撤销的：直接改 + 撤销提示条 */
      var keys = ["leadMinutes", "bufferMinutes", "walkingSpeed", "busSpeed",
        "detourFactor", "climbFactor", "termStart"];
      var before = {};
      keys.forEach(function (key) { before[key] = data.settings[key]; });

      var base = OP.Store.defaults().settings;
      keys.forEach(function (key) { data.settings[key] = base[key]; });
      saveAndRender();

      toast("已恢复默认配置", "提醒、缓冲、速度这些回到默认值", "", {
        label: "撤销",
        onAction: function () {
          Object.keys(before).forEach(function (key) { data.settings[key] = before[key]; });
          saveAndRender();
        }
      });
    });

    /* --- 校区 --- */
    $("#campusName").addEventListener("change", function () {
      data.campus.name = this.value.trim() || data.campus.name;
      save();
    });

    /* 楼栋搜索：纯本地筛选，边打边出，不联网 */
    $("#buildingSearch").addEventListener("input", function () {
      renderBuildingList((data.campus && data.campus.buildings) || []);
    });

    $("#buildingMissingOnly").addEventListener("change", function () {
      renderBuildingList((data.campus && data.campus.buildings) || []);
    });

    $("#btnAddBuilding").addEventListener("click", function () { openBuildingForm(null); });

    /* --- 获取楼栋海拔 --- */
    $("#btnAutoFillBuildings").addEventListener("click", function () { runAutoFill(false); });

    $("#btnFetchElevation").addEventListener("click", function () {
      var button = this;
      var list = (data.campus && data.campus.buildings) || [];
      var todo = list.filter(function (b) {
        return typeof b.lat === "number" && typeof b.lng === "number" &&
          typeof b.elevation !== "number";
      });

      if (!todo.length) {
        toast("海拔都齐了", list.length + " 栋楼都已有海拔", "ok");
        return;
      }

      button.disabled = true;
      button.textContent = "查询中…";

      OP.Elevation.lookup(todo.map(function (b) { return { lat: b.lat, lng: b.lng }; }),
        function (done, total) {
          button.textContent = "查询中 " + done + "/" + total;
        }
      ).then(function (values) {
        var filled = 0;
        todo.forEach(function (b, i) {
          if (typeof values[i] === "number") {
            b.elevation = values[i];
            filled++;
          }
        });
        saveAndRender();
        toast("海拔已更新", filled + " 栋（待查 " + todo.length + " 栋）", "ok");
      }).catch(function (err) {
        toast("查询海拔失败", err.message, "err");
      }).then(function () {
        button.disabled = false;
        button.textContent = "获取海拔";
      });
    });

    /* --- 确认弹窗 --- */
    $("#confirmOk").addEventListener("click", function () {
      var action = pendingConfirm;
      closeConfirm();
      if (action) action();
    });

    $("#confirmCancel").addEventListener("click", closeConfirm);

    $("#confirmBox").addEventListener("click", function (ev) {
      /* 点弹窗外的遮罩也算取消 */
      if (ev.target === this) closeConfirm();
    });

    /* Esc 关掉确认框（技能：模态必须能用 Esc 关，不能只有鼠标一条路） */
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !$("#confirmBox").hidden) {
        ev.preventDefault();
        closeConfirm();
      }
    });

    $("#btnClearBuildings").addEventListener("click", function () {
      var list = (data.campus && data.campus.buildings) || [];
      if (!list.length) {
        toast("楼栋列表本来就是空的", "");
        return;
      }

      /* 清空会连坐标一起删掉，先算清楚有多少课程会受影响 */
      var affected = (data.courses || []).filter(function (c) {
        return list.some(function (b) { return b.id === c.buildingId; });
      }).length;

      var message = "会删掉全部 " + list.length + " 栋楼，包括已经录好的坐标。\n\n" +
        "课表不会被动，但之后就重新对应地点了。";
      if (affected) {
        message += "\n\n注意：有 " + affected + " 条课程安排在这些楼里，删掉后会显示成「未知地点」。";
      }
      message += "\n\n确定清空吗？";

      askConfirm(message, function () {
        data.campus.buildings = [];
        $("#buildingForm").hidden = true;
        saveAndRender();
        });
    });

    /* --- 从地图读取楼栋 --- */
    $("#plRadius").addEventListener("change", function () {
      data.settings.placesRadius = Number(this.value) || 800;
      save();
    });

    /* 名称过滤也是纯本地筛选，边打边筛 */
    var keywordTimer = null;
    $("#plKeyword").addEventListener("input", function () {
      window.clearTimeout(keywordTimer);
      keywordTimer = window.setTimeout(reshapePlaces, 250);
    });

    $("#plMerge").addEventListener("change", function () {
      data.settings.placesMerge = this.checked;
      save();
      reshapePlaces();
    });

    $("#plEnglish").addEventListener("change", function () {
      data.settings.placesEnglish = this.checked;
      save();
      reshapePlaces();
    });

    $("#btnSearchPlaces").addEventListener("click", searchPlaces);
    $("#btnSearchByName").addEventListener("click", searchPlacesByName);

    /* 名字框里直接回车也能搜 */
    $("#plNameQuery").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        searchPlacesByName();
      }
    });

    $("#placesList").addEventListener("click", function (ev) {
      var btn = ev.target.closest(".place-merge");
      if (!btn) return;
      /* 这个按钮在 label 里面，不拦一下会顺带把勾选框切掉 */
      ev.preventDefault();
      ev.stopPropagation();
      mergePlaceAliases(Number(btn.getAttribute("data-place-idx")));
    });

    $("#btnAddSelectedPlaces").addEventListener("click", addSelectedPlaces);
    $("#btnClearPlaces").addEventListener("click", function () {
      state.places = [];
      state.placesStatus = "未搜索";
      renderPlaces();
    });

    $("#bfCancel").addEventListener("click", function () { $("#buildingForm").hidden = true; });
    $("#buildingForm").addEventListener("submit", submitBuilding);

    $("#bfUseHere").addEventListener("click", function () {
      var pos = effectivePosition();
      if (!pos) {
        toast("现在还没有位置", "先点「开始实时定位」", "warn");
        return;
      }
      $("#bfLat").value = pos.lat.toFixed(6);
      $("#bfLng").value = pos.lng.toFixed(6);
    });

    $("#buildingList").addEventListener("click", function (ev) {
      var toggle = ev.target.closest("[data-toggle-buildings]");
      if (toggle) {
        state.buildingListExpanded = !state.buildingListExpanded;
        renderBuildingList((data.campus && data.campus.buildings) || []);
        return;
      }
      var edit = ev.target.closest("[data-edit-building]");
      if (edit) {
        var bid = edit.getAttribute("data-edit-building");
        var found = null;
        data.campus.buildings.forEach(function (x) { if (x.id === bid) found = x; });
        if (found) openBuildingForm(found);
        return;
      }
      var del = ev.target.closest("[data-del-building]");
      if (del) {
        var did = del.getAttribute("data-del-building");
        var used = data.courses.some(function (c) { return c.buildingId === did; });
        var msg = used
          ? "还有课程安排在这栋楼，删除后这些课程会失去地点。确定删除吗？"
          : "确定删除这栋楼吗？";
        askConfirm(msg, function () {
          data.campus.buildings = data.campus.buildings.filter(function (x) { return x.id !== did; });
          saveAndRender();
        });
      }
    });

    /* --- 课表 --- */
    $("#btnAddCourse").addEventListener("click", function () { openCourseForm(null); });
    $("#cfCancel").addEventListener("click", closeCourseForm);
    $("#courseForm").addEventListener("submit", submitCourse);

    /* --- 从截图导入 --- */
    $("#ocrDrop").addEventListener("click", function () { $("#ocrFile").click(); });

    $("#ocrFile").addEventListener("change", function () {
      if (this.files && this.files[0]) handleOcrFile(this.files[0]);
      this.value = "";
    });

    ["dragenter", "dragover"].forEach(function (type) {
      $("#ocrDrop").addEventListener(type, function (ev) {
        ev.preventDefault();
        this.classList.add("is-over");
      });
    });

    ["dragleave", "drop"].forEach(function (type) {
      $("#ocrDrop").addEventListener(type, function (ev) {
        ev.preventDefault();
        this.classList.remove("is-over");
      });
    });

    $("#ocrDrop").addEventListener("drop", function (ev) {
      var file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) handleOcrFile(file);
    });

    /* 在课表页直接按 Ctrl+V 粘贴截图 */
    document.addEventListener("paste", function (ev) {
      if (state.view !== "course") return;
      var items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf("image") === 0) {
          var file = items[i].getAsFile();
          if (file) {
            ev.preventDefault();
            handleOcrFile(file);
          }
          return;
        }
      }
    });

    $("#ocrResult").addEventListener("click", function (ev) {
      var btn = ev.target.closest(".ocr-remove");
      if (btn) {
        var row = btn.closest(".ocr-row");
        if (row) row.remove();
      }
    });

    $("#btnOcrImport").addEventListener("click", importOcrCourses);
    $("#btnOcrCancel").addEventListener("click", function () { clearOcr(false); });

    /* --- 从学校接口拉课表 --- */
    $("#btnPull").addEventListener("click", pullTimetable);
    $("#btnPullImport").addEventListener("click", importPulled);
    $("#btnPullClear").addEventListener("click", function () {
      clearPull();
      renderPull();
    });

    /* --- 课表导出成图片 --- */
    $("#btnExportImage").addEventListener("click", openTimetableImage);
    $("#imageClose").addEventListener("click", closeTimetableImage);
    $("#imageSave").addEventListener("click", saveTimetableImage);
    /* 换比例就重新画一张（同一份课表） */
    $("#imageRatio").addEventListener("change", openTimetableImage);
    /* 点遮罩空白处也能关（跟确认框一个习惯） */
    $("#imageBox").addEventListener("click", function (ev) {
      if (ev.target === this) closeTimetableImage();
    });

    $("#pullSid").addEventListener("change", function () {
      data.settings.pullSid = $("#pullSid").value.trim();
      save();
    });

    /* 输入框里按回车直接拉（填完密码顺手敲回车最自然） */
    ["#pullSid", "#pullPwd"].forEach(function (sel) {
      $(sel).addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          pullTimetable();
        }
      });
    });

    $("#courseList").addEventListener("click", function (ev) {
      var edit = ev.target.closest("[data-edit-course]");
      if (edit) {
        var c = P.courseById(data, edit.getAttribute("data-edit-course"));
        if (c) openCourseForm(c);
        return;
      }
      var del = ev.target.closest("[data-del-course]");
      if (del) {
        var id = del.getAttribute("data-del-course");
        var course = P.courseById(data, id);
        if (!course) return;
        /* 删一门课也是可撤销的：直接删，给一条「撤销」提示条 */
        var at = data.courses.map(function (x) { return x.id; }).indexOf(id);
        var removed = data.courses[at];
        data.courses = data.courses.filter(function (x) { return x.id !== id; });
        saveAndRender();
        toast("已删除课程", course.name, "", {
          label: "撤销",
          onAction: function () {
            if (!removed) return;
            data.courses.splice(at < 0 ? 0 : at, 0, removed);
            saveAndRender();
          }
        });
      }
    });

    /* JSON 的「导出 / 导入」两颗按钮按用户要求从「全部课程」卡片上撤掉了。
       Store.exportFile / readFile / applyImport 都还在，想恢复入口把按钮加回来即可。 */

    $("#btnResetData").addEventListener("click", function () {
      askConfirm("课表和楼栋都会变回默认的（楼栋 = 内置校区数据，课表 = 空），确定吗？", function () {
        data = Store.reset();
        saveAndRender();
        toast("已恢复默认数据", "楼栋回到内置校区数据，课表清空", "ok");
      });
    });

    /* --- 切回前台立刻刷新 --- */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) {
        state.now = new Date();
        state.lastCheck = 0;
        render();
      }
    });
  }

  /* ================= 语音音色 ================= */

  function fillVoiceOptions() {
    var sel = $("#vVoiceSelect");
    var list = OP.Speech.voices();
    if (!list.length) {
      sel.innerHTML = '<option value="">默认音色</option>';
      return;
    }
    sel.innerHTML = list.map(function (v) {
      return '<option value="' + esc(v.voiceURI) + '"' +
        (v.voiceURI === data.settings.voiceURI ? " selected" : "") + ">" +
        esc(v.name + " (" + v.lang + ")") + "</option>";
    }).join("");
  }

  /* ================= 主循环 ================= */

  function tick() {
    state.now = new Date();
    renderTop();

    /* 倒计时只刷新文字，整页重绘会打断输入框 */
    var info = nextInfo();
    if (state.view === "today" && info.found) {
      var c = info.found.course;
      var ongoing = info.found.status === "ongoing";
      $("#nextCountdown").textContent = countdownText(
        ongoing ? P.at(state.now, c.end) : P.at(state.now, c.start), state.now);
    }

    if (state.now.getTime() - state.lastCheck > 30000) {
      state.lastCheck = state.now.getTime();
      checkAlerts();
      if (state.view === "today" || state.view === "route") render();
    }
  }

  /* 背景视频：一段 16 秒的循环。
     有些浏览器（iOS Safari、以及「加到主屏」后的独立窗口）不认 autoplay，
     会把画面停在第一帧，所以这里主动补播一次；再不行就等用户第一次点屏幕。 */
  function initBackgroundVideo() {
    var video = document.getElementById("bgVideo");
    if (!video || typeof video.play !== "function") return;

    /* 系统开了「减少动态效果」：CSS 已经把视频藏起来退回静态图，
       这里就别再让它偷偷播了，白费电。 */
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function nudge() {
      if (!video.paused && !video.ended) return;
      var p = video.play();
      if (p && typeof p.catch === "function") p.catch(function () { /* 补播失败就等下一次机会 */ });
    }

    nudge();
    video.addEventListener("loadeddata", nudge);
    video.addEventListener("canplay", nudge);

    /* iOS 常常要等一次真实手势才肯播 */
    function onGesture() { nudge(); }
    document.addEventListener("touchstart", onGesture, { passive: true });
    document.addEventListener("click", onGesture);
    video.addEventListener("playing", function () {
      document.removeEventListener("touchstart", onGesture);
      document.removeEventListener("click", onGesture);
    });

    /* 切回前台时可能被系统暂停，回来了再补一次 */
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") nudge();
    });
  }

  function boot() {
    OP.Speech.init();
    OP.Speech.onChange(fillVoiceOptions);

    initBackgroundVideo();
    bindEvents();
    fillVoiceOptions();
    measureBottomSpace();

    /* 调试开关：把「地图取楼栋 / 校区楼栋」两张卡片放出来，见 SHOW_BUILDING_TOOLS */
    if (SHOW_BUILDING_TOOLS) {
      ["#placesCard", "#buildingsCard"].forEach(function (sel) {
        var el = $(sel);
        if (el) el.hidden = false;
      });
    }

    render();

    window.setInterval(tick, 1000);

    /* 默认楼栋换了新版本：本地那份被整份替换掉了，得说清楚，不然
       用户会发现"我自己加的楼怎么没了"却不知道为什么 */
    if (pendingBuildingSync.replaced) {
      var bits = [];
      if (pendingBuildingSync.added.length) {
        bits.push("新增 " + pendingBuildingSync.added.length + " 栋");
      }
      if (pendingBuildingSync.removed.length) {
        bits.push("移除 " + pendingBuildingSync.removed.length + " 栋");
      }
      toast("楼栋数据已换成新版",
        "共 " + ((data.campus && data.campus.buildings) || []).length + " 栋" +
        (bits.length ? "（" + bits.join("、") + "）" : "") + "；以默认数据为准", "ok");
    }

    window.addEventListener("resize", function () {
      measureBottomSpace();
      scheduleClearanceCheck();
      /* 宽度一变，三张卡片的"页宽"也变了，得重新对齐到当前那张 */
      if (routeSlides && state.view === "route") routeSlides.realign();
      if (importSlides && state.view === "course") importSlides.realign();
    });
    window.addEventListener("orientationchange", function () {
      window.setTimeout(function () {
        measureBottomSpace();
        scheduleClearanceCheck();
      }, 160);
    });

    /* 支持用地址栏直达某个页签，例如 index.html#route，
       截图和排查时不用手动点。 */
    var wanted = (window.location.hash || "").replace(/^#/, "");
    if (wanted) {
      var tab = document.querySelector('.tab[data-tab="' + wanted + '"]');
      if (tab) tab.click();
    }

    /* 拿到权限就直接开始定位，不用用户再点一次 */
    if (Geo.supported()) {
      Geo.once().then(function (pos) {
        state.position = pos;
        render();
        fillElevation(state.position, render);
      }).catch(function (err) {
        state.geoError = Geo.readableError(err);
        render();
      });
    }

    window.setTimeout(function () {
      if (state.hintShown) return;
      state.hintShown = true;
      if (!OP.Speech.supported()) {
        toast("这个浏览器不支持语音播报", "换 Chrome、Edge 或 Safari 试试", "warn");
      }
    }, 1600);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
