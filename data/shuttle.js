/* Olympic Protocol — 校巴数据（自动生成，不要手改）
 *
 * 由 tools/make-shuttle.js 生成。改内容请改 tools/shuttle-source.json 再重新生成：
 *     node tools/make-shuttle.js
 *
 * 路线、服务时间、站序：香港中文大学交通处路线图（穿梭/晚间及假日/转堂校巴）
 *   以及交通处官网路线页 https://transport.cuhk.edu.hk/tc/route/<路线>/
 * 站点坐标：OpenStreetMap（© OpenStreetMap 贡献者，ODbL）
 *   只取位置，路线本身以交通处资料为准。
 *
 * 站序约定（官网站序图的画法）：左列自下而上，右列自上而下，
 * 起点在左下、终点在右下——"起点 → 左列倒序 → 右列正序 → 终点"。
 * 生成时间：2026-09-29
 */

"use strict";
window.OP = window.OP || {};

/* 一个站名在 OSM 上可能对应多个站点节点（同一条路两个方向等），
   这里取它们位置的中位数；osm 数组列出用到的节点 id。 */
window.OP.SHUTTLE_STOPS = {
    "39區（上行）": { zh: "39區（上行）", en: "Area 39", lat: 22.427631, lng: 114.204351, elevation: 6, osm: [2035114211] },
    "39區（下行）": { zh: "39區（下行）", en: "Area 39", lat: 22.427631, lng: 114.204351, elevation: 6, osm: [2035114211] },
    "伍宜孫書院（上行）": { zh: "伍宜孫書院（上行）", en: "Wu Yee Sun College (Upward)", lat: 22.421331, lng: 114.203471, elevation: 113, osm: [2035104644] },
    "伍宜孫書院（下行）": { zh: "伍宜孫書院（下行）", en: "Wu Yee Sun College (Downward)", lat: 22.421199, lng: 114.203521, elevation: 113, osm: [1716519421] },
    "十五苑": { zh: "十五苑", en: "Residence 15", lat: 22.423716, lng: 114.206598, elevation: 50, osm: [2035133252] },
    "善衡書院": { zh: "善衡書院", en: "S.H. Ho College", lat: 22.418042, lng: 114.20985, elevation: 64, osm: [2035104643] },
    "大學站": { zh: "大學站", en: "University Station", lat: 22.414537, lng: 114.210221, elevation: 8, osm: [1716519472] },
    "大學站廣場": { zh: "大學站廣場", en: "University MTR Station Piazza", lat: 22.413882, lng: 114.2096, elevation: 12, osm: [2036051433, 5414326180] },
    "大學行政樓": { zh: "大學行政樓", en: "University Administration Building", lat: 22.418802, lng: 114.205443, elevation: 99, osm: [1716519519, 5413637589] },
    "大學體育中心": { zh: "大學體育中心", en: "University Sports Centre", lat: 22.417812, lng: 114.210482, elevation: 59, osm: [1716519481] },
    "崇基教學樓": { zh: "崇基教學樓", en: "Chung Chi Teaching Blocks", lat: 22.416036, lng: 114.208359, elevation: 32, osm: [1716519526] },
    "康本園": { zh: "康本園", en: "Yasumoto International Academic Park", lat: 22.415973, lng: 114.210832, elevation: 18, osm: [2035049978] },
    "敬文書院（上行）": { zh: "敬文書院（上行）", en: "C. W. Chu College", lat: 22.425609, lng: 114.206188, elevation: 14, osm: [2035133243, 5277753685] },
    "敬文書院（下行）": { zh: "敬文書院（下行）", en: "C. W. Chu College", lat: 22.425609, lng: 114.206188, elevation: 14, osm: [2035133243, 5277753685] },
    "新亞坊": { zh: "新亞坊", en: "New Asia Circle", lat: 22.421072, lng: 114.207647, elevation: 138, osm: [2036051434] },
    "新亞書院": { zh: "新亞書院", en: "New Asia College", lat: 22.421271, lng: 114.207559, elevation: 138, osm: [1502822176] },
    "環迴北站": { zh: "環迴北站", en: "Campus Circuit North", lat: 22.425628, lng: 114.206373, elevation: 14, osm: [5277753655] },
    "環迴東站（上行）": { zh: "環迴東站（上行）", en: "Campus Circuit East", lat: 22.419282, lng: 114.212936, elevation: 25, osm: [5265944661, 5265944663] },
    "環迴東站（下行）": { zh: "環迴東站（下行）", en: "Campus Circuit East", lat: 22.419282, lng: 114.212936, elevation: 25, osm: [5265944661, 5265944663] },
    "研究生宿舍一座": { zh: "研究生宿舍一座", en: "Postgraduate Hall 1", lat: 22.420248, lng: 114.212171, elevation: 65, osm: [1716519492] },
    "科學館": { zh: "科學館", en: "Science Centre", lat: 22.41983, lng: 114.207342, elevation: 107, osm: [2035104642] },
    "聯合書院（上行）": { zh: "聯合書院（上行）", en: "United College (Upward)", lat: 22.42039, lng: 114.205394, elevation: 146, osm: [2035204908] },
    "聯合書院（下行）": { zh: "聯合書院（下行）", en: "United College (Downward)", lat: 22.420302, lng: 114.205403, elevation: 146, osm: [1716519514, 5413654375] },
    "聯合苑": { zh: "聯合苑", en: "United College Staff Residence", lat: 22.423259, lng: 114.20513, elevation: 85, osm: [2035204920] },
    "逸夫書院（上行）": { zh: "逸夫書院（上行）", en: "Shaw College", lat: 22.422476, lng: 114.201298, elevation: 77, osm: [1716519477, 5413654368] },
    "逸夫書院（下行）": { zh: "逸夫書院（下行）", en: "Shaw College", lat: 22.422476, lng: 114.201298, elevation: 77, osm: [1716519477, 5413654368] },
    "邵逸夫堂": { zh: "邵逸夫堂", en: "Sir Run Run Shaw Hall", lat: 22.419841, lng: 114.206942, elevation: 107, osm: [1716519535] },
    "陳震夏宿舍": { zh: "陳震夏宿舍", en: "Chan Chun Ha Hostel", lat: 22.421812, lng: 114.204612, elevation: 88, osm: [2035204924] },
    "馮景禧樓": { zh: "馮景禧樓", en: "Fung King-hey Building", lat: 22.419864, lng: 114.203032, elevation: 104, osm: [1716519434] }
};

window.OP.SHUTTLE_ROUTES = [
    {
      id: "1",
      no: "1",
      nameZh: "本部線",
      nameEn: "Main Campus",
      group: "shuttle",
      days: "星期一至六（公眾假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri","sat"], from: "07:40", to: "18:55" }
      ],
      everyHour: [10, 25, 40, 55],
      loop: true,
      stops: [
        "大學站",
        "大學體育中心",
        "邵逸夫堂",
        "大學行政樓",
        "善衡書院",
        "大學站"
      ]
    },
    {
      id: "2",
      no: "2",
      nameZh: "新聯線",
      nameEn: "NA/UC",
      group: "shuttle",
      days: "星期一至六（公眾假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri","sat"], from: "07:45", to: "18:45" }
      ],
      serviceNote: "逢 31 至 00 分開出的班次將停邵逸夫堂",
      everyHour: [15, 45],
      loop: false,
      stops: [
        "大學站廣場",
        "大學體育中心",
        { id: "邵逸夫堂", note: "逢 31 至 00 分開出的班次才停" },
        "馮景禧樓",
        "聯合書院（上行）",
        "新亞書院",
        "聯合書院（下行）",
        "大學行政樓",
        "善衡書院",
        "大學站"
      ]
    },
    {
      id: "2s",
      no: "2S",
      nameZh: "新聯線(S)",
      nameEn: "NA/UC (S)",
      group: "shuttle",
      days: "星期一至六（公眾假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri","sat"], from: "08:00", to: "18:30" }
      ],
      everyHour: [0, 30],
      loop: false,
      stops: [
        "大學站廣場",
        "研究生宿舍一座",
        "大學體育中心",
        "邵逸夫堂",
        "馮景禧樓",
        "聯合書院（上行）",
        "新亞書院",
        "聯合書院（下行）",
        "大學行政樓",
        "善衡書院",
        "研究生宿舍一座",
        "大學站"
      ]
    },
    {
      id: "3",
      no: "3",
      nameZh: "逸夫線",
      nameEn: "Shaw",
      group: "shuttle",
      days: "星期一至六（公眾假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri","sat"], from: "09:00", to: "18:40" }
      ],
      everyHour: [0, 20, 40],
      loop: false,
      stops: [
        "康本園",
        "大學體育中心",
        "科學館",
        "馮景禧樓",
        "伍宜孫書院（上行）",
        "逸夫書院（上行）",
        "敬文書院（下行）",
        "十五苑",
        "聯合苑",
        "陳震夏宿舍",
        "逸夫書院（下行）",
        "伍宜孫書院（下行）",
        "大學行政樓",
        "善衡書院",
        "大學站廣場"
      ]
    },
    {
      id: "4",
      no: "4",
      nameZh: "環迴線",
      nameEn: "Campus Circuit",
      group: "shuttle",
      days: "星期一至六（公眾假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri","sat"], from: "07:30", to: "18:50" }
      ],
      everyHour: [10, 30, 50],
      loop: false,
      stops: [
        "康本園",
        "環迴東站（上行）",
        "敬文書院（上行）",
        "39區（上行）",
        "敬文書院（下行）",
        "十五苑",
        "聯合苑",
        "陳震夏宿舍",
        "逸夫書院（下行）",
        "伍宜孫書院（下行）",
        "新亞書院",
        "聯合書院（下行）",
        "大學行政樓",
        "善衡書院",
        "大學站"
      ]
    },
    {
      id: "8",
      no: "8",
      nameZh: "西部線",
      nameEn: "Western Campus",
      group: "shuttle",
      days: "星期一至六（公眾假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri","sat"], from: "07:35", to: "18:35" }
      ],
      serviceNote: "非教學日期間將停大學站廣場及崇基教學樓（不停大學站）",
      everyHour: [15, 35, 55],
      loop: false,
      stops: [
        "康本園",
        "環迴東站（上行）",
        "敬文書院（上行）",
        "39區（上行）",
        "敬文書院（下行）",
        "聯合苑",
        "陳震夏宿舍",
        "逸夫書院（下行）",
        "伍宜孫書院（下行）",
        "大學行政樓",
        "科學館",
        "新亞坊",
        "聯合書院（下行）",
        "伍宜孫書院（上行）",
        "逸夫書院（上行）",
        "39區（下行）",
        "環迴北站",
        "環迴東站（下行）",
        { id: "大學站", note: "只在教學日" },
        { id: "大學站廣場", note: "只在非教學日" },
        { id: "崇基教學樓", note: "只在非教學日" }
      ]
    },
    {
      id: "n",
      no: "N",
      nameZh: "晚間線",
      nameEn: "Night Service",
      group: "night",
      days: "星期一至六（星期日及公眾假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri","sat"], from: "19:00", to: "23:30" }
      ],
      serviceNote: "逢 00 分開出的班次將停研究生宿舍一座",
      everyHour: [0, 15, 30, 45],
      loop: true,
      stops: [
        "大學站",
        { id: "研究生宿舍一座", note: "逢 00 分開出的班次才停" },
        "大學體育中心",
        "邵逸夫堂",
        "新亞坊",
        "聯合書院（下行）",
        "伍宜孫書院（上行）",
        "逸夫書院（上行）",
        "39區（上行）",
        "敬文書院（下行）",
        "十五苑",
        "聯合苑",
        "陳震夏宿舍",
        "逸夫書院（下行）",
        "伍宜孫書院（下行）",
        "新亞書院",
        "聯合書院（下行）",
        "大學行政樓",
        "善衡書院",
        { id: "研究生宿舍一座", note: "逢 00 分開出的班次才停" },
        "大學站"
      ]
    },
    {
      id: "h",
      no: "H",
      nameZh: "假日線",
      nameEn: "Holidays Service",
      group: "night",
      days: "星期日及公眾假期",
      sessions: [
        { days: ["sun","holiday"], from: "08:20", to: "23:20" }
      ],
      serviceNote: "逢 00 分開出的班次將停研究生宿舍一座及 39 區",
      everyHour: [0, 20, 40],
      loop: true,
      stops: [
        "大學站",
        { id: "研究生宿舍一座", note: "逢 00 分開出的班次才停" },
        "大學體育中心",
        "邵逸夫堂",
        "新亞坊",
        "聯合書院（下行）",
        "伍宜孫書院（上行）",
        "逸夫書院（上行）",
        { id: "39區（上行）", note: "逢 00 分開出的班次才停" },
        "敬文書院（下行）",
        "十五苑",
        "聯合苑",
        "陳震夏宿舍",
        "逸夫書院（下行）",
        "伍宜孫書院（下行）",
        "新亞書院",
        "聯合書院（下行）",
        "大學行政樓",
        "善衡書院",
        { id: "研究生宿舍一座", note: "逢 00 分開出的班次才停" },
        "大學站"
      ]
    },
    {
      id: "5",
      no: "5",
      nameZh: "上行線",
      nameEn: "Upward",
      group: "meetclass",
      days: "只限教學日（非教學日、閱讀週及大學假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri"], from: "09:18", to: "17:26" },
        { days: ["sat"], from: "09:18", to: "13:26" }
      ],
      everyHour: [18, 22, 26],
      loop: false,
      stops: [
        "崇基教學樓",
        "大學體育中心",
        "邵逸夫堂",
        "馮景禧樓",
        "聯合書院（上行）",
        "新亞書院",
        "伍宜孫書院（上行）",
        "逸夫書院（上行）",
        "敬文書院（下行）"
      ]
    },
    {
      id: "6a",
      no: "6A",
      nameZh: "下行線（敬文）",
      nameEn: "Downward (CWC)",
      group: "meetclass",
      days: "只限教學日（非教學日、閱讀週及大學假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri"], from: "09:10", to: "17:10" },
        { days: ["sat"], from: "09:10", to: "13:10" }
      ],
      everyHour: [10],
      loop: false,
      stops: [
        "敬文書院（下行）",
        "聯合苑",
        "陳震夏宿舍",
        "伍宜孫書院（下行）",
        "新亞書院",
        "聯合書院（下行）",
        "大學行政樓",
        "善衡書院",
        "大學站廣場",
        "崇基教學樓"
      ]
    },
    {
      id: "6b",
      no: "6B",
      nameZh: "下行線（新聯）",
      nameEn: "Downward (NA/UC)",
      group: "meetclass",
      days: "只限教學日（非教學日、閱讀週及大學假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri"], from: "12:20", to: "17:20" }
      ],
      everyHour: [20],
      loop: false,
      stops: [
        "新亞書院",
        "聯合書院（下行）",
        "大學行政樓",
        "善衡書院",
        "大學站廣場",
        "崇基教學樓"
      ]
    },
    {
      id: "7",
      no: "7",
      nameZh: "下行線（逸夫）",
      nameEn: "Downward (Shaw)",
      group: "meetclass",
      days: "只限教學日（非教學日、閱讀週及大學假期停開）",
      sessions: [
        { days: ["mon","tue","wed","thu","fri"], from: "08:18", to: "17:18" },
        { days: ["sat"], from: "08:18", to: "13:18" }
      ],
      everyHour: [0, 18],
      loop: false,
      stops: [
        "逸夫書院（下行）",
        "伍宜孫書院（下行）",
        "新亞書院",
        "聯合書院（下行）",
        "大學行政樓",
        "善衡書院",
        "大學站廣場",
        "崇基教學樓"
      ]
    }
];

/* 附件里没有、暂时不做的：收费穿梭小巴（up / down）没有收录 */
window.OP.SHUTTLE_META = {
  stopCount: 29,
  routeCount: 12,
  source: "香港中文大學交通處路線圖（穿梭/晚間及假日/轉堂校巴）＋交通處官網路線頁",
  missingStops: []
};
