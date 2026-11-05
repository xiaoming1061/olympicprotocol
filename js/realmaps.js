/* 真实地图底图（可选）
 *
 * 默认还是"校园简图"——纯 SVG，不联网、不依赖任何外部资源。
 * 这里提供两种真实底图，选中时才按需加载 Leaflet：
 *
 *   osm  OpenStreetMap 街道图：开放数据，任何人都能自由使用
 *   cuhk 香港中文大学自己的校园地图瓦片：是学校的地图资源，
 *        自己用没问题，公开给很多人用之前建议先问一下学校
 *
 * 两种瓦片都是标准 XYZ 格式。港中文那套的 y 轴是反的，
 * 用 Leaflet 的 {-y} 占位符处理。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  var LEAFLET_VERSION = "1.9.4";
  var CDNS = [
    "https://unpkg.com/leaflet@" + LEAFLET_VERSION + "/dist/",
    "https://cdn.jsdelivr.net/npm/leaflet@" + LEAFLET_VERSION + "/dist/"
  ];

  var SOURCES = {
    osm: {
      label: "OpenStreetMap",
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: (OP.t ? OP.t("map.attribution.osmPrefix") : "数据与地图") +
        ' &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
        (OP.t ? OP.t("map.attribution.osmSuffix") : "贡献者"),
      maxZoom: 19,
      minZoom: 3
    },
    cuhk: {
      label: OP.t ? OP.t("map.layerCuhk") : "港中文校园地图",
      url: "https://www.cuhk.edu.hk/english/images/campus/tile-map/{z}/{x}/{-y}.png",
      attribution: OP.t ? OP.t("map.attribution.cuhk") : "地圖 © 香港中文大學",
      maxZoom: 18,
      minZoom: 15
    }
  };

  var map = null;
  var tileLayer = null;
  var currentSource = null;
  var overlay = null;
  var leafletPromise = null;

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

  /* 只在真正要用的时候才下载 Leaflet */
  function loadLeaflet(cdnBase) {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;

    var sources = cdnBase ? [cdnBase].concat(CDNS) : CDNS;

    function attempt(i) {
      if (i >= sources.length) {
        return Promise.reject(new Error(OP.t
          ? OP.t("map.libFailed") : "加载地图库失败，检查网络后重试"));
      }
      return new Promise(function (resolve, reject) {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = sources[i] + "leaflet.css";
        document.head.appendChild(link);

        var script = document.createElement("script");
        script.src = sources[i] + "leaflet.js";
        script.onload = function () {
          if (window.L) resolve(window.L);
        else reject(new Error(OP.t ? OP.t("map.libUnavailable") : "地图库加载后仍不可用"));
        };
      script.onerror = function () {
        reject(new Error(OP.t ? OP.t("map.cdnBlocked") : "这个 CDN 不通"));
      };
        document.head.appendChild(script);
      }).catch(function () { return attempt(i + 1); });
    }

    leafletPromise = attempt(0);
    return leafletPromise;
  }

  function markerFor(L, stop) {
    var cls = "rm-pin" + (stop.isNext ? " is-next" : "");
    var isDest = String(stop.order || "") === "终";

    /* 终点画成一枚图钉（尖端落在坐标上），跟简图那一枚同一套造型；
       其余点还是小圆点——底图信息密，圆点不挡路。 */
    if (isDest) {
      var pin = L.marker([stop.building.lat, stop.building.lng], {
        icon: L.divIcon({
          className: "rm-icon is-dest",
          html: '<svg class="rm-dest-pin" width="30" height="40" viewBox="0 0 30 40" aria-hidden="true">' +
            '<path class="rm-dest-body" d="M15 38C10.5 30 2 24.5 2 16C2 7.5 8 1 15 1' +
            'C22 1 28 7.5 28 16C28 24.5 19.5 30 15 38Z"/>' +
            '<circle class="rm-dest-dot" cx="15" cy="15" r="5.6"/>' +
            "</svg>",
          iconSize: [30, 40],
          iconAnchor: [15, 38]
        }),
        zIndexOffset: 1000
      });

      pin.bindTooltip("<b>" + esc(stop.building.name) + "</b>" +
        (stop.time ? "<br>" + esc(stop.time) : ""), {
        permanent: true,
        direction: "top",
        offset: [0, -34],
        className: "rm-tip is-next"
      });
      return pin;
    }

    /* 街道图/港中文地图上的点要小：底图本身信息密，点大了就盖住路和楼 */
    var marker = L.marker([stop.building.lat, stop.building.lng], {
      icon: L.divIcon({
        className: "rm-icon",
        html: '<span class="' + cls + '">' + esc(stop.order || "") + "</span>",
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      }),
      zIndexOffset: stop.isNext ? 1000 : 0
    });

    var label = "<b>" + esc(stop.building.name) + "</b>" +
      (stop.time ? "<br>" + esc(stop.time) : "");

    /* 只有"下一节"常驻显示标签——几栋楼挨在一起时，
       全都常驻会叠成一团，反而什么都看不清。其余的鼠标悬停或点一下看 */
    marker.bindTooltip(label, {
      permanent: !!stop.isNext,
      direction: stop.isNext ? "bottom" : "top",
      offset: [0, stop.isNext ? 12 : -12],
      className: "rm-tip" + (stop.isNext ? " is-next" : "")
    });

    return marker;
  }

  /**
   * 连线的点顺序：我的位置 → 第一节 → 第二节 …
   *
   * 单独抽出来是为了能测。踩过的坑：原来是先 push 站点、最后才 push 我的位置，
   * 连线就成了"第 2 栋 → 第 1 栋 → 我的位置"，起点跑到末尾去了。
   */
  function routePoints(position, stops) {
    var points = [];
    if (position && hasCoords(position)) points.push([position.lat, position.lng]);
    (stops || []).forEach(function (s) {
      if (s && hasCoords(s.building)) points.push([s.building.lat, s.building.lng]);
    });
    return points;
  }

  /** 校巴站也画出来：在哪上车、在哪下车 */
  function drawBusStops(L, overlay, list) {
    (list || []).forEach(function (s) {
      var stop = s && s.stop;
      if (!stop || !hasCoords(stop)) return;
      /* 站名与「上车/下车」都跟着界面语言走 */
      var stopText = OP.Shuttle && OP.Shuttle.stopName ? OP.Shuttle.stopName(stop) : stop.zh;
      var lang = (OP.I18N && OP.I18N.lang) ? OP.I18N.lang() : "zh-Hans";
      var role = s.roles && s.roles.board
        ? (OP.t ? OP.t("bus.board") : "上车")
        : (s.roles && s.roles.alight ? (OP.t ? OP.t("bus.alight") : "下车") : "");
      var suffix = role ? (lang === "en" ? " (" + role + ")" : "（" + role + "）") : "";
      /* 选中那条线的站：圈更大、描边更粗，而且**常驻**站名浮标
         （没选中的只做悬停提示，免得一堆站名糊在一起） */
      var big = !!s.picked;
      L.circleMarker([stop.lat, stop.lng], {
        radius: big ? 7 : 4,
        color: "#04121c",
        weight: big ? 3 : 2,
        fillColor: "#ffc55a",
        fillOpacity: 1
      }).addTo(overlay).bindTooltip(stopText + suffix, {
        direction: "top",
        offset: [0, big ? -10 : -6],
        permanent: big,
        className: "rm-tip is-stop" + (big ? " is-picked" : "")
      });
    });
  }

  function draw(L, container, opts) {
    if (!map) {
      map = L.map(container, {
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true
      });
      map.on("click", function () { map.closePopup(); });
    }

    var source = SOURCES[opts.source] ? opts.source : "osm";
    if (currentSource !== source) {
      if (tileLayer) map.removeLayer(tileLayer);
      tileLayer = L.tileLayer(SOURCES[source].url, {
        attribution: SOURCES[source].attribution,
        maxZoom: SOURCES[source].maxZoom,
        minZoom: SOURCES[source].minZoom
      }).addTo(map);
      currentSource = source;
    }

    if (overlay) map.removeLayer(overlay);
    overlay = L.layerGroup().addTo(map);

    var stops = (opts.stops || []).filter(function (s) { return s && hasCoords(s.building); });

    var points = routePoints(opts.position, stops);

    stops.forEach(function (s) { markerFor(L, s).addTo(overlay); });
    drawBusStops(L, overlay, opts.busStops);

    if (opts.position && hasCoords(opts.position)) {
      L.circleMarker([opts.position.lat, opts.position.lng], {
        radius: 5,
        color: "#04121c",
        weight: 3,
        fillColor: "#38e1ff",
        fillOpacity: 1
      }).addTo(overlay).bindTooltip("我的位置", {
        permanent: true,
        direction: "top",
        offset: [0, -8],
        className: "rm-tip is-me"
      });
    }

    /* 连线只画三段：走到上车站、车站坐到车站、下车走到教室。
       中间那截是坐车，换颜色和粗细区分开。
       原来那条把各地点串起来的线看着像路线，其实没有指导意义 */
    (opts.busLinks || []).forEach(function (link) {
      if (!link || !link.from || !link.to) return;
      var pts = [[link.from.lat, link.from.lng], [link.to.lat, link.to.lng]];
      if (link.ride) {
        /* 坐车那一段：线型跟走路那两截一样，颜色用**该线路的官方色** */
        L.polyline(pts, {
          color: link.color || "#e08a00",
          weight: 5, dashArray: "10 8",
          opacity: 0.95, lineCap: "round"
        }).addTo(overlay);
      } else {
        L.polyline(pts, {
          color: "#ff6fa5", weight: 3, dashArray: "8 7",
          opacity: 0.95, lineCap: "round"
        }).addTo(overlay);
      }
    });

    /* 取景把校巴站也算进去，不然要去的站可能落在画面外 */
    var bounds = points.slice();
    (opts.busStops || []).forEach(function (s) {
      if (s && s.stop && hasCoords(s.stop)) bounds.push([s.stop.lat, s.stop.lng]);
    });

    if (bounds.length) {
      map.fitBounds(L.latLngBounds(bounds).pad(0.35), { maxZoom: 18 });
    }

    /* 容器尺寸变了（切页签、转屏）需要让 Leaflet 重新量一次 */
    window.setTimeout(function () { if (map) map.invalidateSize(); }, 60);
  }

  /**
   * @param {HTMLElement} container
   * @param {object} opts { source, position, stops }
   */
  function render(container, opts) {
    if (!container) return Promise.resolve(false);
    opts = opts || {};

    return loadLeaflet(opts.cdnBase).then(function (L) {
      draw(L, container, opts);
      return true;
    });
  }

  /* 切回简图时把地图实例放掉，避免占着内存和瓦片请求 */
  function dispose() {
    if (map) {
      map.remove();
      map = null;
      tileLayer = null;
      overlay = null;
      currentSource = null;
    }
  }

  OP.RealMap = {
    SOURCES: SOURCES,
    loadLeaflet: loadLeaflet,
    render: render,
    routePoints: routePoints,
    dispose: dispose
  };
})(window.OP);
