/* 生成 js/zh.js —— 繁简 + 拼音首字母对照表
 *
 * 为什么要它：搜索要认"简体 / 繁体 / 拼音首字母"三种写法
 * （宿舍、校区楼栋、自定义路线的起点终点都要用），
 * 而这是个纯静态站点、没有构建步骤，也不该为了这个塞一个几百 KB 的转换库进来。
 * 所以**只收页面上真正出现过的汉字**，把「简体写法 + 拼音首字母」编成一张小表。
 *
 * 表不是手写的——手写 300 多个字迟早错。数据从两份权威表来：
 *   拼音：mozillazg/pinyin-data（整理自 Unicode Unihan 的 kMandarin）
 *   繁简：OpenCC 的 TSCharacters.txt
 * 两份都缓存到 tools/ 下，之后不联网也能重新生成。
 *
 * 用法：
 *   node tools/make-zh.js            # 用本地缓存生成
 *   node tools/make-zh.js --fetch    # 先联网刷新两份源表
 */

"use strict";

const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const CACHE_PINYIN = path.join(__dirname, "zh-source-pinyin.txt");
const CACHE_SIMPLE = path.join(__dirname, "zh-source-tschar.txt");
const OUT = path.join(root, "js", "zh.js");

const SOURCES = [
  {
    file: CACHE_PINYIN,
    url: "https://cdn.jsdelivr.net/gh/mozillazg/pinyin-data/pinyin.txt",
    what: "拼音（pinyin-data，整理自 Unihan kMandarin）"
  },
  {
    file: CACHE_SIMPLE,
    url: "https://cdn.jsdelivr.net/npm/opencc/data/dictionary/TSCharacters.txt",
    what: "繁简（OpenCC TSCharacters）"
  }
];

/* 页面数据里会出现汉字的地方（自检里也有同样一份扫描，保证不漏） */
const DATA_FILES = [
  "data/buildings.js",
  "data/dorms.js",
  "data/shuttle.js"
];

async function fetchSources() {
  for (const src of SOURCES) {
    console.log("下载 " + src.what + " …");
    const res = await fetch(src.url, {
      headers: { "User-Agent": "Olympic-Protocol/1.0 (CUHK campus timetable demo)" }
    });
    if (!res.ok) throw new Error(src.url + " 返回 HTTP " + res.status);
    fs.writeFileSync(src.file, await res.text(), "utf8");
    console.log("  → " + path.relative(root, src.file));
  }
}

/* ---------- 源表解析 ---------- */

/** pinyin.txt：  U+4E00: yī,yí,yì  # 一  */
function readPinyin(file) {
  const map = {};
  fs.readFileSync(file, "utf8").split("\n").forEach((line) => {
    const m = /^U\+([0-9A-F]+):\s*([^#]+)/.exec(line);
    if (!m) return;
    const ch = String.fromCodePoint(parseInt(m[1], 16));
    /* 取第一个读音（表里第一个是最常用的） */
    const first = m[2].split(",")[0].trim();
    if (!first) return;
    /* "lǜ" 这种带声调的：去掉声调符号取首字母 */
    const plain = first.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const letter = plain[0];
    if (letter && /[a-z]/i.test(letter)) map[ch] = letter.toLowerCase();
  });
  return map;
}

/** TSCharacters.txt：  一\t一   /   丁\t丁  （繁体 → 简体） */
function readSimplified(file) {
  const map = {};
  fs.readFileSync(file, "utf8").split("\n").forEach((line) => {
    if (!line || line[0] === "#") return;
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return;
    const [trad, ...simps] = parts;
    /* 一个繁体可能对应多个简体，取第一个 */
    if (trad.length === 1 && simps[0] && simps[0].length === 1) map[trad] = simps[0];
  });
  return map;
}

/* ---------- 扫数据里用到的汉字 ---------- */

function collectChars() {
  const chars = new Set();
  DATA_FILES.forEach((rel) => {
    const text = fs.readFileSync(path.join(root, rel), "utf8");
    text.replace(/[\u3400-\u4dbf\u4e00-\u9fff]/g, (ch) => { chars.add(ch); return ""; });
  });
  return Array.from(chars).sort();
}

/* ---------- 生成 ---------- */

const needFetch = process.argv.indexOf("--fetch") >= 0;

(async function main() {
  if (needFetch || !fs.existsSync(CACHE_PINYIN) || !fs.existsSync(CACHE_SIMPLE)) {
    await fetchSources();
  }

  const pinyin = readPinyin(CACHE_PINYIN);
  const simplified = readSimplified(CACHE_SIMPLE);

  /* 数据里的字，加上它们的简体写法。
     两边都要收：不收简体的话，"湯→汤"转过去之后那个"汤"查不到拼音，
     首字母就没了（自检里有一条专门盯着这个一致性）。 */
  const chars = new Set(collectChars());
  Array.from(chars).forEach((ch) => {
    const simp = simplified[ch];
    if (simp && simp !== ch) chars.add(simp);
  });

  const rows = [];
  const noPinyin = [];

  Array.from(chars).forEach((ch) => {
    const simp = simplified[ch] || ch;
    const letter = pinyin[ch] || "";
    if (!letter) noPinyin.push(ch);
    rows.push([ch, simp, letter]);
  });

  /* 排序：先按拼音首字母，再按字，改动时的 diff 好看一点 */
  rows.sort((a, b) => (a[2] || "zz").localeCompare(b[2] || "zz") || a[0].localeCompare(b[0]));

  const tableLines = [];
  let line = "    ";
  rows.forEach(([ch, simp, letter], i) => {
    const item = JSON.stringify(ch) + ": [" + JSON.stringify(simp) + ", " +
      JSON.stringify(letter) + "]";
    const sep = i === rows.length - 1 ? "" : ", ";
    if ((line + item + sep).length > 96) {
      tableLines.push(line.replace(/,\s*$/, "") + ",");
      line = "    ";
    }
    line += item + sep;
  });
  if (line.trim()) tableLines.push(line);

  const body = `/* Olympic Protocol — 繁简 + 拼音首字母对照表
 *
 * 搜索要认三种写法：简体（知行楼）、繁体（知行樓）、拼音首字母（zxl）。
 * 这是个纯静态站点，没有构建步骤，也不该为了这个塞一个几百 KB 的转换库，
 * 所以这里只收**页面数据里真正出现过的汉字**（${rows.length} 个）。
 *
 * 表不是手写的，由下面的命令生成（数据从 Unihan 系的 pinyin-data 和 OpenCC 的
 * TSCharacters 来，见 tools/make-zh.js）：
 *     node tools/make-zh.js --fetch && node tools/make-zh.js
 *
 * 格式： "字": ["简体写法", "拼音首字母"]
 * 自检里有一条盯着"数据里的每个字都在表里"——以后数据里冒出新字会直接报错，
 * 不会悄悄漏掉某个字的拼音。用户自己加的楼栋带新字也没关系，
 * 那些字查不到就按原样比，不影响其它字。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  var ZH = {
${tableLines.join("\n")}
  };

  /**
   * 繁体转简体。表里没有的字原样保留——
   * 表不全时宁可"这个字没转"，也不能把字吃掉。
   */
  function toSimplified(text) {
    return String(text === undefined || text === null ? "" : text)
      .replace(/[\\u3400-\\u4dbf\\u4e00-\\u9fff]/g, function (ch) {
        var row = ZH[ch];
        return row ? row[0] : ch;
      });
  }

  /** 拼音首字母：只取汉字，英文数字不参与（"zxl" → 知行樓） */
  function initialsOf(text) {
    var out = "";
    String(text === undefined || text === null ? "" : text)
      .replace(/[\\u3400-\\u4dbf\\u4e00-\\u9fff]/g, function (ch) {
        var row = ZH[ch];
        if (row && row[1]) out += row[1];
        return "";
      });
    return out;
  }

  /** 比较用的统一写法：小写 + 转简体 */
  function normalize(text) {
    return toSimplified(text).toLowerCase();
  }

  /**
   * 一段搜索词能不能命中一组名字。
   *
   * 三种命中方式：
   *   1. 任意一个名字"包含"搜索词（比之前都统一转成小写 + 简体）
   *   2. 搜索词是纯字母数字时，再拿它跟**每一个名字**的拼音首字母比一次，
   *      而且是**从头比**（输 zxl 找知行樓）
   *
   * 第 2 条为什么是"从头比"而不是"包含"：包含会产生一堆误命中——
   * 输 syt（邵逸夫堂）会连带命中「牟路思怡圖書館」（拼音首字母 mlsytsg 里含 syt）。
   * 从头比就是"打这个名词组的开头几个首字母"，符合直觉，也不会误伤。
   * 每个名字单独比（不是把所有名字拼起来比）是为了让别名也能这样搜：
   * 五旬節會樓高座的别名「五高」→ 输 wg 能中。
   * 这就是宿舍、楼栋、自定义路线三处搜索共用的那一条。
   *
   * @param query 用户输入
   * @param names 这栋楼/这个宿舍登记过的所有写法（英文名、中文名、别名）
   */
  function matches(query, names) {
    var q = normalize(query).trim();
    if (!q) return true;

    var list = (names || []).filter(Boolean).map(String);
    var hay = normalize(list.join(" "));
    if (hay.indexOf(q) >= 0) return true;

    /* 纯字母数字的查询再当一次拼音首字母试（每个名字各自从头匹配） */
    if (!/^[a-z0-9\\s]+$/.test(q)) return false;
    var letters = q.replace(/[^a-z0-9]/g, "");
    if (!letters) return false;
    return list.some(function (name) {
      return initialsOf(name).indexOf(letters) === 0;
    });
  }

  OP.Zh = {
    toSimplified: toSimplified,
    initialsOf: initialsOf,
    normalize: normalize,
    matches: matches,
    CHARS: Object.keys(ZH)
  };
})(window.OP);
`;

  fs.writeFileSync(OUT, body, "utf8");

  console.log("已写入 " + path.relative(root, OUT));
  console.log("  汉字 " + rows.length + " 个");
  if (noPinyin.length) console.log("  !! 查不到拼音：" + noPinyin.join(""));
  console.log("  文件大小：" + Math.round(body.length / 1024) + " KB");
})();
