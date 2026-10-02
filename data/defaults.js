/* Olympic Protocol — 课表与设置的默认值
 *
 * 楼栋不在这里：它单独放在 data/buildings.js，是真实校区数据，
 * 由「设置 → 校区楼栋 → 导出」出来的结果生成（见 tools/make-buildings.js）。
 *
 * 页面把三样东西分开存：
 *   楼栋  → localStorage 的 buildings 键
 *   课表  → courses 键
 *   设置  → settings 键
 * 所以换课表不会动到楼栋，改楼栋也不会动到课表。
 */

window.OP = window.OP || {};

/**
 * 应用版本号。
 *
 * 设置页「数据」里显示的就是它。改版本只改这一处；
 * 以后打成 APK 时，安卓那边的 versionName 请跟这里保持一致，
 * 这样"页面上显示 1.0.0、装的是哪个包"就对得上了。
 */
window.OP.APP_VERSION = "1.0.0";

window.OP.DEFAULT_DATA = {
  version: 1,

  /* 默认楼栋来自 data/buildings.js，要改请改那个文件 */
  campus: {
    name: window.OP.DEFAULT_BUILDINGS.name,
    buildings: window.OP.DEFAULT_BUILDINGS.buildings
  },

  /*
   * 课表默认是空的：它是每个人自己的东西，第一次打开时用课表截图导入，
   * 或者到「课表 → 新增课程」手动加。楼栋已经有默认值了，不用再导入。
   */
  courses: [],

  settings: {
    leadMinutes: 10,        // 上课前多少分钟播报一次
    bufferMinutes: 5,       // 到楼之后再留出的缓冲
    walkingSpeed: 75,       // 米/分钟
    busSpeed: 330,          // 校巴平均速度（米/分钟，约 20 km/h，含停站）
    detourFactor: 1.3,      // 直线距离 → 实际步行距离的折算系数
    climbFactor: 8,         // 1 米爬升折算成几米平路（Naismith 经验值）
    voiceEnabled: true,
    voiceRate: 1.0,
    voiceVolume: 1.0,
    voiceURI: "",
    termStart: "2026-09-07",
    simulate: null,         // { lat, lng } 手动指定的位置，便于在电脑上测试
    placesRadius: 800,
    placesMerge: true,      // 合并坐标几乎重合的点位
    placesEnglish: true,    // 地图取楼栋时优先用英文名，中文名存成别名
    mapMode: "schematic",   // schematic 简图 / osm 街道图 / cuhk 港中文地图

    /* 返回宿舍：
       dormId 指向 data/dorms.js 里的某一条（默认宿舍），或者 addedDorms 里的
       一条（老版本用「当前位置添加」补的）。addedDorms 是数组，跟默认数据
       分开存；页面上现在只剩「删除这个宿舍」，添加入口已经拆掉了。
       起点固定用"我的位置"，所以没有 dormFromClass 这个开关了。 */
    dormId: "",
    addedDorms: [],

    /* 自定义路线：上次选的起点/终点楼栋 id。空字符串表示起点用「我的位置」 */
    customFrom: "",
    customTo: "",

    /* 从学校接口拉课表（可选功能，默认关着）：
       代理地址和上游写法都写死在 app.js 里（界面上不显示），这里只记学号——
       **密码从来不存**，每次拉取时手动输入、用完就清。老存档里的
       pullProxy / pullMode 会被自动丢掉（pickSettings 只留这里有的键）。 */
    pullSid: ""
  }
};
