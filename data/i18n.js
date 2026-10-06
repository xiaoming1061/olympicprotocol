/* Olympic Protocol — 多语言文案表
 *
 * 键用点号路径，跟界面位置对应（nav.* 底部导航、set.* 设置页 …）。
 * 三种语言都必须有同一批键——漏了会退回简体，再漏就把键名显示出来。
 *
 * 现在只覆盖骨架（导航 + 语言卡片）。剩下的按批次补，
 * 每次补完跑一遍 selftest，它会检查三份表键是否对得上。
 */

window.OP = window.OP || {};

window.OP.I18N_TABLE = {
  "zh-Hans": {
    "nav.today": "今日",
    "nav.route": "路线",
    "nav.course": "课表",
    "nav.settings": "设置",

    "lang.title": "界面语言",
    "lang.label": "语言",
    "lang.hans": "简体中文",
    "lang.hant": "繁體中文",
    "lang.en": "English",
    "lang.note": "切换后立刻生效，并记在这台设备上",
    "lang.auto": "跟随浏览器"
  },

  "zh-Hant": {
    "nav.today": "今日",
    "nav.route": "路線",
    "nav.course": "課表",
    "nav.settings": "設定",

    "lang.title": "介面語言",
    "lang.label": "語言",
    "lang.hans": "简体中文",
    "lang.hant": "繁體中文",
    "lang.en": "English",
    "lang.note": "切換後立刻生效，並記在這台裝置上",
    "lang.auto": "跟隨瀏覽器"
  },

  "en": {
    "nav.today": "Today",
    "nav.route": "Route",
    "nav.course": "Timetable",
    "nav.settings": "Settings",

    "lang.title": "Language",
    "lang.label": "Language",
    "lang.hans": "简体中文",
    "lang.hant": "繁體中文",
    "lang.en": "English",
    "lang.note": "Takes effect immediately, remembered on this device",
    "lang.auto": "Follow browser"
  }
};
