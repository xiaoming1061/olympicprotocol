/* 宿舍：默认数据 + 用户自己补的几处
 *
 * 默认宿舍来自 data/dorms.js（OpenStreetMap 里按
 * 宿舍 / 舍堂 / 書院 / Hostel / Residence / Dormitory / Hall 搜出来的），
 * 只读；用户在页面上用「用当前位置添加」补的是另一份，存在 settings.addedDorms 里。
 *
 * 故意不做「默认数据自动并进本地」那一套（楼栋那套的复杂度不值得再来一遍）：
 * 宿舍是个人属性——一个人只住一个地方，多出来的列表对他没用。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  function shipped() {
    var data = OP.DEFAULT_DORMS;
    return data && Array.isArray(data.dorms) ? data.dorms : [];
  }

  function extras(settings) {
    var list = settings && settings.addedDorms;
    return Array.isArray(list) ? list : [];
  }

  function hasCoords(d) {
    return !!(d && typeof d.lat === "number" && typeof d.lng === "number");
  }

  /* ---------- 繁简 + 拼音首字母 ----------
   * 这套东西（表 + 转换 + 匹配）在 js/zh.js 里，宿舍、校区楼栋、
   * 自定义路线的起点终点都共用同一份表。这里只是转出去，保持老的调用方式不变。
   */
  function toSimplified(text) { return OP.Zh.toSimplified(text); }
  function initialsOf(text) { return OP.Zh.initialsOf(text); }
  function normalize(text) { return OP.Zh.normalize(text); }

  /* 显示用的名字：英文 + 中文并排，两个都看得见才有用
     （只写 "Bethlehem Hall" 或只写 "伯利衡宿舍" 都有人认不出来） */
  function labelOf(d) {
    var zh = d.nameZh || "";
    if (!zh || zh === d.name) return d.name;
    return d.name + " " + zh;
  }

  /* 补齐字段：搜索和播报都要能拿到 alias 数组，别到处判断 undefined */
  function shape(d, custom) {
    var allNames = [d.name, d.nameZh, d.nameEn, d.label].concat(d.alias || []).filter(Boolean);
    return {
      id: d.id,
      name: d.name,
      nameZh: d.nameZh || "",
      nameEn: d.nameEn || "",
      label: labelOf(d),
      alias: (d.alias || []).slice(),
      /* 搜"知行楼"（简体）和"zxl"（首字母）时用的中间结果，
         在 shape 里算一次，搜索时不用反复算 */
      zhSimple: OP.Zh.toSimplified(d.nameZh || ""),
      zhInitials: OP.Zh.initialsOf(allNames.join(" ")),
      lat: d.lat,
      lng: d.lng,
      kind: d.kind || "",
      custom: !!custom
    };
  }

  /** 全部宿舍，按名字排序（中英文混排就让 localeCompare 去管） */
  function all(settings) {
    var out = shipped().filter(hasCoords).map(function (d) { return shape(d, false); });
    extras(settings).forEach(function (d) {
      if (!hasCoords(d)) return;
      if (out.some(function (x) { return x.id === d.id; })) return;
      out.push(shape(d, true));
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  function byId(settings, id) {
    if (!id) return null;
    var found = all(settings).filter(function (d) { return d.id === id; })[0];
    return found || null;
  }

  /** 中英文、别名都能搜；空关键词返回全部 */
  function search(settings, query) {
    var list = all(settings);
    var raw = String(query === undefined || query === null ? "" : query).trim();
    if (!raw) return list;
    /* 匹配规则（简繁互通 + 拼音首字母）在 js/zh.js 里，楼栋搜索用的是同一条 */
    return list.filter(function (d) { return OP.Zh.matches(raw, names(d)); });
  }

  /* 收录的所有名字（英文 / 中文 / 并排的那个写法 / 别名），搜索和播报都用它 */
  function names(dorm) {
    if (!dorm) return [];
    var out = [];
    [dorm.name, dorm.nameZh, dorm.nameEn, dorm.label]
      .concat(dorm.alias || [])
      .filter(Boolean)
      .forEach(function (n) {
        if (out.indexOf(n) < 0) out.push(n);
      });
    return out;
  }

  function nearest(point, settings) {
    if (!point) return null;
    var best = null;
    all(settings).forEach(function (d) {
      var distance = OP.Geo.haversine(point, { lat: d.lat, lng: d.lng });
      if (distance === null) return;
      if (!best || distance < best.distance) best = { dorm: d, distance: distance };
    });
    return best;
  }

  /* 用户自己加的宿舍：id 带 d- 前缀，跟 OSM 的 way-/relation- 分开 */
  function makeId() {
    return "dorm-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e4).toString(36);
  }

  function add(settings, name, point) {
    var clean = String(name || "").trim();
    if (!clean || !point || typeof point.lat !== "number") return null;

    var entry = {
      id: makeId(),
      name: clean,
      nameZh: "",
      nameEn: "",
      alias: [],
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      kind: "custom"
    };
    if (typeof point.elevation === "number") entry.elevation = point.elevation;

    if (!Array.isArray(settings.addedDorms)) settings.addedDorms = [];
    settings.addedDorms.push(entry);
    return entry;
  }

  /** 默认宿舍删不掉（那是数据文件里的），只能删自己加的 */
  function remove(settings, id) {
    if (!Array.isArray(settings.addedDorms)) return false;
    var before = settings.addedDorms.length;
    settings.addedDorms = settings.addedDorms.filter(function (d) { return d.id !== id; });
    return settings.addedDorms.length !== before;
  }

  OP.Dorm = {
    all: all,
    byId: byId,
    search: search,
    names: names,
    label: labelOf,
    toSimplified: toSimplified,
    initialsOf: initialsOf,
    normalize: normalize,
    ZH_CHARS: (OP.Zh && OP.Zh.CHARS) || [],
    nearest: nearest,
    add: add,
    remove: remove,
    hasCoords: hasCoords
  };
})(window.OP);
