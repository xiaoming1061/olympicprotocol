/* 语音播报：基于浏览器内置的语音合成（Web Speech API）
 *
 * 注意：iOS 上第一次播报必须由用户点按触发，这是系统的自动播放策略，
 * 所以页面上保留了「今日课表播报」这类按钮，自动提醒生效前请先手动点一次。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  var synth = typeof window !== "undefined" ? window.speechSynthesis : null;
  var cached = [];
  var listeners = [];

  function supported() {
    return !!(synth && typeof window.SpeechSynthesisUtterance === "function");
  }

  /* 优先挑中文音色；没有中文音色时退回全部 */
  function collect() {
    if (!supported()) return [];
    var all = synth.getVoices() || [];
    var zh = all.filter(function (v) {
      var lang = (v.lang || "").toLowerCase().replace("_", "-");
      return lang.indexOf("zh") === 0;
    });
    var list = zh.length ? zh : all;

    /* 把质量更好的系统音色排前面 */
    var preferred = ["tingting", "ting-ting", "meijia", "sinji", "xiaoxiao", "yunxi", "huihui", "kangkang", "yaoyao"];
    list.sort(function (a, b) {
      var ai = preferred.findIndex(function (p) { return (a.name || "").toLowerCase().indexOf(p) >= 0; });
      var bi = preferred.findIndex(function (p) { return (b.name || "").toLowerCase().indexOf(p) >= 0; });
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    return list;
  }

  function voices() {
    if (!cached.length) cached = collect();
    return cached;
  }

  function refresh(cb) {
    cached = collect();
    listeners.forEach(function (fn) { fn(cached); });
    if (typeof cb === "function") cb(cached);
  }

  function onChange(fn) {
    listeners.push(fn);
    if (cached.length) fn(cached);
  }

  function pickVoice(uri) {
    var list = voices();
    if (!list.length) return null;
    if (!uri) return list[0];
    for (var i = 0; i < list.length; i++) {
      if (list[i].voiceURI === uri || list[i].name === uri) return list[i];
    }
    return list[0];
  }

  function stop() {
    if (supported()) synth.cancel();
  }

  /**
   * 播报一段文字
   * @param {string} text
   * @param {object} settings  { voiceEnabled, voiceRate, voiceVolume, voiceURI }
   * @returns {boolean} 是否真的开始播报
   */
  function speak(text, settings) {
    if (!supported() || !text) return false;
    settings = settings || {};
    if (settings.voiceEnabled === false) return false;

    stop();
    var u = new window.SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = Number(settings.voiceRate) || 1;
    u.volume = settings.voiceVolume === undefined ? 1 : Number(settings.voiceVolume);
    u.pitch = 1;
    var v = pickVoice(settings.voiceURI);
    if (v) {
      u.voice = v;
      if (v.lang) u.lang = v.lang;
    }
    synth.speak(u);
    return true;
  }

  /* 合成引擎有时要等几百毫秒才把音色列表准备好 */
  function init() {
    if (!supported()) return;
    refresh();
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", function () { refresh(); });
    } else {
      synth.onvoiceschanged = function () { refresh(); };
    }
    /* 部分浏览器要先"预热"一次才拿得到完整列表 */
    window.setTimeout(refresh, 600);
    window.setTimeout(refresh, 1800);
  }

  OP.Speech = {
    supported: supported,
    voices: voices,
    onChange: onChange,
    pickVoice: pickVoice,
    speak: speak,
    stop: stop,
    init: init
  };
})(window.OP);
