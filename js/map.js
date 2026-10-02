/* 校园简图：用 SVG 画今天的行程
 *
 * 只画三类信息，其余楼栋一律不画：
 *   我的位置       —— 会脉冲的圆点
 *   下一节课        —— 高亮 + 「下一节」旗标
 *   今天要去的楼栋   —— 按先后编号，标出上课时间
 * 没在今天的行程里的楼栋完全不画——导入一次可能带回上百栋，
 * 全画上去反而是干扰。
 *
 * 这是按真实经纬度等比投影出来的示意图，不是街道地图，
 * 需要转弯导航时用「路线」页里的地图跳转按钮。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  var W = 1000;
  var H = 700;
  var PAD = 1.32;   // 视野留白系数
  var LAT_M = 110540;
  var LNG_M = 111320;

  /* 简图上各种字的大小（单位跟 viewBox 一致，CSS 里也写了同样的值）。
     地名故意小一号、半透明——它是底衬，不该比圆点和路线还抢眼。 */
  var LABEL_FS = 17;   // 楼栋简写
  var TIME_FS = 13;    // 上课时间
  var FLAG_FS = 15;    // 「下一节」旗标
  var STOP_FS = 12;    // 校巴站名
  var ME_FS = 19;      // 我的位置

  function esc(text) {
    return String(text === undefined || text === null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hasCoords(b) {
    return !!(b && typeof b.lat === "number" && typeof b.lng === "number");
  }

  function makeProjector(points) {
    var lats = [], lngs = [];
    points.forEach(function (p) { lats.push(p.lat); lngs.push(p.lng); });

    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLng = Math.min.apply(null, lngs), maxLng = Math.max.apply(null, lngs);
    var cLat = (minLat + maxLat) / 2;
    var cLng = (minLng + maxLng) / 2;

    var mPerLng = LNG_M * Math.cos((cLat * Math.PI) / 180);
    var spanX = Math.max((maxLng - minLng) * mPerLng, 120);
    var spanY = Math.max((maxLat - minLat) * LAT_M, 120);

    /* 横纵用同一个比例尺，画面才不会被拉扁 */
    var scale = Math.min(W / (spanX * PAD), H / (spanY * PAD));

    return function (point) {
      return {
        x: W / 2 + (point.lng - cLng) * mPerLng * scale,
        y: H / 2 - (point.lat - cLat) * LAT_M * scale
      };
    };
  }

  function grid() {
    var out = '<g class="svg-grid">';
    for (var i = 1; i < 8; i++) {
      var x = (W / 8) * i;
      var y = (H / 8) * i;
      out += '<line x1="' + x.toFixed(0) + '" y1="0" x2="' + x.toFixed(0) + '" y2="' + H + '"/>';
      out += '<line x1="0" y1="' + y.toFixed(0) + '" x2="' + W + '" y2="' + y.toFixed(0) + '"/>';
    }
    return out + "</g>";
  }

  /* ---------- 地名简写 ---------- */

  /* 简图上可以省掉的词：都是"楼/馆"这类通用名词，
     省掉之后名字还是认得出（Esther Lee Building → Esther Lee） */
  var DROP_WORDS = [
    "building", "buildings", "bldg", "bldgs", "block", "blocks",
    "centre", "center", "complex", "tower", "annex", "wing",
    "room", "rooms", "theatre", "theater", "auditorium"
  ];

  /**
   * 简图上的地名去个尾。
   *
   * 只去掉 "Building / Centre / Complex" 这类通用词，别的都留着：
   *   Academic Building No.2   → Academic No.2
   *   Esther Lee Building      → Esther Lee
   *   Lady Shaw Building C3    → Lady Shaw C3
   * 一开始做成了取首字母拼代号（AB2 / ELB），太激进了——简图上认不出是哪栋。
   * 全称没丢：每块字都带了 <title>，鼠标停上去 / 手机上长按能看全。
   */
  function shortLabel(name) {
    var raw = String(name === undefined || name === null ? "" : name).trim();
    if (!raw) return "";

    /* 纯中文的按字数截；中英并排的（宿舍那种 "Chih Hsing Hall 知行樓"）
       走英文那套——不然会被切成 "Chih Hsi…" */
    if (/[\u4e00-\u9fa5]/.test(raw) && !/[A-Za-z]/.test(raw)) {
      var zh = raw.replace(/[（(][^)）]*[)）]/g, "").trim() || raw;
      /* 中文一个字带的信息多，给到 8 个字；
         再长才截（比如"香港中文大學賽馬會研究生宿舍二座"） */
      return zh.length > 8 ? zh.slice(0, 8) + "…" : zh;
    }

    /* 已经够短的（12W / C3 / LT2）不用动 */
    if (raw.replace(/[^A-Za-z0-9]/g, "").length <= 4) return raw;

    var words = raw.split(/\s+/).filter(Boolean);
    var kept = words.filter(function (w) {
      return DROP_WORDS.indexOf(w.toLowerCase().replace(/[.,]/g, "")) < 0;
    });
    /* 去完只剩一个词就先别去了：「Science Centre」变「Science」反而看不懂 */
    if (kept.length < 2) kept = words;

    /* 去掉通用词之后还是很长的（"Pentecostal Mission Hall Complex (High Block)"），
       再截一下——按整词截，别把词切成半截 */
    var out = "";
    for (var i = 0; i < kept.length; i++) {
      var next = out ? out + " " + kept[i] : kept[i];
      if (next.length > 26) break;
      out = next;
    }
    if (!out) out = kept[0].slice(0, 26);
    return out === kept.join(" ") ? out : out + "…";
  }

  /* ---------- 摆地名：默认放下面，压住了就翻到上面 ---------- */

  /* 量一段文字大概有多宽（单位跟 viewBox 一致）。
     不需要精确，够判断"会不会压住"就行。 */
  function textWidth(text, fs) {
    var w = 0;
    String(text === undefined || text === null ? "" : text).split("").forEach(function (ch) {
      if (/[\u4e00-\u9fa5\u3000-\u303f\uff01-\uff60]/.test(ch)) w += fs;
      else if (ch === " ") w += fs * 0.28;
      else if (/[iljt.,:;'|!]/.test(ch)) w += fs * 0.34;
      else w += fs * 0.58;
    });
    return w;
  }

  function overlapArea(a, b) {
    var w = Math.min(a.r, b.r) - Math.max(a.l, b.l);
    var h = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    return (w > 0 && h > 0) ? w * h : 0;
  }

  /**
   * 排地名：每块字先试着放在地点下面，跟已经排好的字（或别的圆点）压住了就翻到上面。
   *
   * 谁先排谁优先：先课程楼栋，再「下一节」旗标和我的位置，最后校巴站——
   * 课程楼栋是这张图的主角，校巴站最密也最容易挤，让它先让步。
   */
  function placeLabels(labels, marks) {
    var obstacles = marks.map(function (m) {
      return { l: m.x - m.r, r: m.x + m.r, t: m.y - m.r, b: m.y + m.r };
    });
    var placed = [];

    function cost(box) {
      var c = 0;
      placed.forEach(function (p) { c += overlapArea(box, p) * 2; });
      obstacles.forEach(function (o) { c += overlapArea(box, o); });
      /* 挤出画面要重罚：宁可压着别的字，也不能让地名跑出图外 */
      if (box.l < 8 || box.r > W - 8) c += 5000;
      if (box.t < 6 || box.b > H - 6) c += 5000;
      return c;
    }

    labels.slice().sort(function (a, b) { return a.rank - b.rank; }).forEach(function (L) {
      var w = 0, h = 0;
      L.lines.forEach(function (line) {
        w = Math.max(w, textWidth(line.text, line.fs));
        h += line.fs * 1.3;
      });

      var belowTop = L.y + L.r + 12;
      var aboveTop = L.y - L.r - 10 - h;
      var below = { l: L.x - w / 2, r: L.x + w / 2, t: belowTop, b: belowTop + h };
      var above = { l: L.x - w / 2, r: L.x + w / 2, t: aboveTop, b: aboveTop + h };

      var costBelow = cost(below);
      var costAbove = cost(above);
      /* 一样贵的时候按各自习惯的一侧放（「下一节」旗标和「我的位置」习惯在上） */
      var side = costAbove < costBelow ? "above"
        : (costAbove > costBelow ? "below" : (L.prefer || "below"));

      L.top = (side === "above" ? above : below).t;
      L.width = w;
      L.side = side;
      placed.push(side === "above" ? above : below);
    });
  }

  function labelSvg(L) {
    var out = "<g>" + (L.title ? "<title>" + esc(L.title) + "</title>" : "");
    var y = L.top;
    L.lines.forEach(function (line) {
      y += line.fs * 0.86;
      out += '<text class="' + line.cls + '" x="' + L.x.toFixed(1) +
        '" y="' + y.toFixed(1) + '">' + line.text + "</text>";
      y += line.fs * 0.44;
    });
    return out + "</g>";
  }

  /**
   * @param {SVGElement} svg
   * @param {object} opts
 *   buildings  [{ id, name, lat, lng }]  全部楼栋，只用来判断"有没有楼栋"
   *   position   { lat, lng } | null       我的位置
   *   stops      [{ building, order, time, isNext }]  今天要去的楼栋，按顺序
   *   detourFactor                          直线距离折算成步行距离的系数
   */
  function render(svg, opts) {
    if (!svg) return;
    opts = opts || {};

    var all = (opts.buildings || []).filter(hasCoords);
    var stops = (opts.stops || []).filter(function (s) {
      return s && hasCoords(s.building);
    });

    if (!all.length) {
      svg.innerHTML = '<text x="500" y="350" class="bld-label">还没有楼栋坐标，去「设置」里添加</text>';
      return;
    }

    /* 取景范围只按"今天要去的楼 + 我的位置"来算，
       这样画面会自然放大到有用的那块，而不是被上百栋楼撑开 */
    var frame = stops.map(function (s) { return s.building; });
    if (opts.position) frame.push(opts.position);
    /* 校巴站也要进取景范围，否则要去的站可能落在画面外 */
    (opts.busStops || []).forEach(function (b) {
      if (b && b.stop && typeof b.stop.lat === "number") frame.push(b.stop);
    });

    if (!frame.length) {
      /* 这张地图现在是"跟着当前那张卡片走"的：路线规划/返回宿舍/自定义路线
         各有各的起终点，所以没东西可画时的说法由调用方给。 */
      svg.innerHTML = '<text x="500" y="350" class="bld-label">' +
        esc(opts.empty || "今天没有要去的地方") + "</text>";
      return;
    }

    var project = makeProjector(frame);
    var parts = [grid()];

    /*
     * 连线只画三段：走到上车站、上车站坐到下车站、下车走到教室。
     *
     * 原来画的是"我的位置 → 第一节 → 第二节"的行程链，但校巴不一定是直达的，
     * 那条线只是把地点连起来，看着像路线却没有任何指导意义。
     * 中间那一截（上车站到下车站）是坐车，用另一种线画，免得跟走路的两截混淆。
     */
    (opts.busLinks || []).forEach(function (link) {
      if (!link || !link.from || !link.to) return;
      var a = project(link.from);
      var b = project(link.to);
      parts.push('<line class="bus-link' + (link.ride ? " is-ride" : "") +
        '" x1="' + a.x.toFixed(1) + '" y1="' + a.y.toFixed(1) +
        '" x2="' + b.x.toFixed(1) + '" y2="' + b.y.toFixed(1) + '"/>');
    });

    /* 记号先全画出来，文字统一到最后摆——要摆才知道谁压着谁 */
    var marks = [];
    var labels = [];

    /* ---- 校巴站：画在行程点下面，别盖住编号圈 ---- */
    (opts.busStops || []).forEach(function (s) {
      var st = s && s.stop;
      if (!st || typeof st.lat !== "number" || typeof st.lng !== "number") return;
      var p = project(st);
      parts.push('<rect class="bus-stop" x="' + (p.x - 6).toFixed(1) + '" y="' + (p.y - 6).toFixed(1) +
        '" width="12" height="12" rx="3" transform="rotate(45 ' +
        p.x.toFixed(1) + " " + p.y.toFixed(1) + ')"/>');
      marks.push({ x: p.x, y: p.y, r: 9 });
      /* 只写站名：它在哪条线是上车、哪条线是下车，路线列表里已经写了 */
      labels.push({
        x: p.x, y: p.y, r: 9, rank: 3, title: st.zh,
        lines: [{ text: esc(st.zh), fs: STOP_FS, cls: "bus-stop-label" }]
      });
    });

    /* ---- 今天要去的楼栋 ---- */
    stops.forEach(function (s) {
      var b = s.building;
      var p = project(b);
      /* 圈保持够大（简图是"一眼看清今天去哪几栋"），
         字改成简写 + 小一号 + 半透明，免得一堆全称糊在一起。
         真实街道图上那是另一回事——那边会压住地图细节，所以那边反过来缩小。 */
      var r = s.isNext ? 18 : 15;

      parts.push('<circle class="bld' + (s.isNext ? " is-next" : " is-today") +
        '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r + '"/>' +
        '<text class="bld-order' + (s.isNext ? " is-next" : "") +
        '" x="' + p.x.toFixed(1) + '" y="' + (p.y + 5).toFixed(1) + '">' +
        esc(s.order || "") + "</text>");

      marks.push({ x: p.x, y: p.y, r: r });

      /* 全称留在 <title> 里，简写只放在图上 */
      var lines = [{
        text: esc(shortLabel(b.name)),
        fs: LABEL_FS,
        cls: "bld-label" + (s.isNext ? " is-next" : "")
      }];
      if (s.time) lines.push({ text: esc(s.time), fs: TIME_FS, cls: "bld-time" });

      labels.push({ x: p.x, y: p.y, r: r, rank: 1, title: b.name, lines: lines });

      /* 「下一节」旗标先摆（rank 0），习惯放上面 */
      if (s.isNext) {
        labels.push({
          x: p.x, y: p.y, r: r, rank: 0, prefer: "above", title: b.name,
          lines: [{ text: "下一节", fs: FLAG_FS, cls: "bld-flag" }]
        });
      }
    });

    /* ---- 我的位置 ---- */
    if (opts.position) {
      var me = project(opts.position);
      parts.push("<g>" +
        '<circle class="me-ring" cx="' + me.x.toFixed(1) + '" cy="' + me.y.toFixed(1) + '" r="13"/>' +
        '<circle class="me-dot" cx="' + me.x.toFixed(1) + '" cy="' + me.y.toFixed(1) + '" r="10"/>' +
        "</g>");
      marks.push({ x: me.x, y: me.y, r: 16 });
      labels.push({
        x: me.x, y: me.y, r: 16, rank: 2, prefer: "above", title: "我的位置",
        lines: [{ text: "我的位置", fs: ME_FS, cls: "me-label" }]
      });
    } else if (stops.length) {
      /* 没定位时在图上说一句，免得以为坏了 */
      parts.push('<text class="map-note" x="500" y="666">打开定位后会显示你的位置</text>');
    }

    placeLabels(labels, marks);
    labels.forEach(function (L) { parts.push(labelSvg(L)); });

    svg.innerHTML = parts.join("");
  }

  OP.MapView = {
    render: render,
    /* 这两个暴露出来是给自检用的：简写规则和"摆在哪一侧"都是纯计算，
       能在不开浏览器的情况下验 */
    shortLabel: shortLabel,
    textWidth: textWidth
  };
})(window.OP);
