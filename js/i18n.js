/* 多语言运行时
 *
 * 三种语言：zh-Hans（简体）/ zh-Hant（繁体）/ en。
 * 文案表在 data/i18n.js，键是点号路径，比如 "nav.today"。
 *
 * 语言从哪来（按优先级）：
 *   1. localStorage（用户手动切过就听用户的）
 *   2. 浏览器语言
 *   3. 简体（兜底）
 *
 * 取不到某条文案时退回简体；连简体都没有就把键名原样显示出来——
 * 宁可页面上出现 "nav.today" 这种怪东西，也不要静默留白，
 * 不然漏翻根本发现不了。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  var KEY = "olympic-protocol.lang.v1";
  var FALLBACK = "zh-Hans";
  var SUPPORTED = ["zh-Hans", "zh-Hant", "en"];

  function detect() {
    try {
      var saved = localStorage.getItem(KEY);
      if (saved && SUPPORTED.indexOf(saved) >= 0) return saved;
    } catch (e) { /* 隐私模式下取不到，往下走 */ }

    var tags = (navigator.languages && navigator.languages.length)
      ? navigator.languages
      : [navigator.language || ""];

    for (var i = 0; i < tags.length; i++) {
      var tag = String(tags[i]).toLowerCase();
      if (tag.indexOf("zh") === 0) {
        /* zh-tw / zh-hk / zh-mo / zh-hant → 繁体；其余中文（含 zh-cn / zh-sg）→ 简体 */
        return /hant|tw|hk|mo/.test(tag) ? "zh-Hant" : "zh-Hans";
      }
      if (tag.indexOf("en") === 0) return "en";
    }
    return FALLBACK;
  }

  var current = detect();
  var listeners = [];

  function table(lang) {
    return (OP.I18N_TABLE && OP.I18N_TABLE[lang]) || {};
  }

  /** 取一条文案。vars 用来填 {name} 这种占位。 */
  function t(key, vars) {
    var text = table(current)[key];
    if (text === undefined) text = table(FALLBACK)[key];
    if (text === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        text = text.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return text;
  }

  /** 把 index.html 里带 data-i18n / data-i18n-ph 的静态文案换掉 */
  function applyStatic(root) {
    var scope = root || document;
    var i;

    var nodes = scope.querySelectorAll("[data-i18n]");
    for (i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-i18n");
      var text = t(key);
      if (text !== key) nodes[i].textContent = text;
    }

    var holders = scope.querySelectorAll("[data-i18n-ph]");
    for (i = 0; i < holders.length; i++) {
      var pk = holders[i].getAttribute("data-i18n-ph");
      var pv = t(pk);
      if (pv !== pk) holders[i].setAttribute("placeholder", pv);
    }

    var titled = scope.querySelectorAll("[data-i18n-title]");
    for (i = 0; i < titled.length; i++) {
      var tk = titled[i].getAttribute("data-i18n-title");
      var tv = t(tk);
      if (tv !== tk) titled[i].setAttribute("title", tv);
    }

    paintPicker();
  }

  /** 把语言选择器里选中的那颗标出来（aria-checked），其余标 false */
  function paintPicker() {
    var btns = document.querySelectorAll("#langPicker .lang-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-checked",
        btns[i].getAttribute("data-lang") === current ? "true" : "false");
    }
  }

  /* 语言按钮用事件委托绑在 document 上。
     一开始这段写在 app.js 的初始化里，但那个初始化在到达它之前就结束了
     （线上实测：点按钮毫无反应、aria-checked 始终是 null，而直接调
     OP.I18N.set('en') 是生效的）。绑在这儿只依赖本文件，稳。 */
  document.addEventListener("click", function (ev) {
    var el = ev.target;
    var btn = el && el.closest ? el.closest("#langPicker .lang-btn") : null;
    if (btn) set(btn.getAttribute("data-lang"));
  });

  function set(lang) {
    if (SUPPORTED.indexOf(lang) < 0) return;
    current = lang;
    try { localStorage.setItem(KEY, lang); } catch (e) { /* 存不了就算了 */ }
    document.documentElement.lang = lang;
    applyStatic();
    listeners.forEach(function (fn) { fn(lang); });
  }

  function onChange(fn) {
    listeners.push(fn);
    return fn;
  }

  /* 首屏就把静态文案换好：脚本在 <body> 末尾，DOM 已经就绪 */
  document.documentElement.lang = current;
  applyStatic();

  OP.I18N = {
    t: t,
    set: set,
    lang: function () { return current; },
    supported: SUPPORTED.slice(),
    onChange: onChange,
    applyStatic: applyStatic,
    detect: detect,
    /* 供自检用：不算真实语言，只是把探测逻辑暴露出来 */
    _fallback: FALLBACK
  };
  OP.t = t;
})(window.OP);
