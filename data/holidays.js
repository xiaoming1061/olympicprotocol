/* 校历假期 / 停课日
 *
 * 数据来源：香港中文大学教务处注册及考试组《2026-27 年度校历 ——
 * 选课日期、开学礼、大会及假期》
 *   https://www.res.cuhk.edu.hk/sc/general-information/almanac/university-almanac-2026-27/
 *   页面原文两条注：
 *     1. 所有公众假期均为大学假期。
 *     2. 大学假期及农历新年假期期间将不会安排课堂。
 *
 * 三种类型，程序里的处理不一样：
 *   holiday —— 公众假期／大学假期：不上课，校巴只开假日线（H）
 *   noClass —— 停课日（不是假期，比如入学资讯日、大会）：不上课，校巴照常
 *   partial —— 当天只停一部分时段（比如开学礼停到 13:30）：
 *              那之前的课不上，之后的课照上；校巴照常
 *
 * publicHoliday 只用来标注"这一天是不是法定公众假期"（农历新年那一周里
 * 只有 2/6、2/8、2/9 是），对程序判断没有影响——用户要的是"假期只开 H 线"。
 */

window.OP = window.OP || {};

window.OP.HOLIDAYS = {
  version: 1,
  term: "2026-27",
  source: "香港中文大學教務處註冊及考試組《2026-27 年度校曆：選課日期、開學禮、大會及假期》",
  sourceUrl: "https://www.res.cuhk.edu.hk/sc/general-information/almanac/university-almanac-2026-27/course-registration-dates-inauguration-ceremony-congregation-and-holidays-2/",
  fetched: "2026-10-01",

  days: [
    /* ---- 2026 年 9–12 月 ---- */
    {
      date: "2026-09-07", kind: "partial", until: "13:30",
      name: "本科生開學禮", nameEn: "Inauguration Ceremony",
      note: "全日制本科課程由早上至下午一時三十分停課（醫科二至六年級除外）"
    },
    {
      date: "2026-09-26", kind: "holiday", publicHoliday: true,
      name: "中秋節翌日", nameEn: "The day following the Chinese Mid-Autumn Festival"
    },
    {
      date: "2026-10-01", kind: "holiday", publicHoliday: true,
      name: "國慶日", nameEn: "National Day"
    },
    {
      date: "2026-10-17", kind: "noClass",
      name: "本科入學資訊日", nameEn: "CUHK Information Day",
      note: "全日制本科課程停課（醫科四至六年級除外）"
    },
    {
      date: "2026-10-19", kind: "holiday", publicHoliday: true,
      name: "重陽節翌日", nameEn: "The day following Chung Yeung Festival"
    },
    {
      date: "2026-11-12", kind: "noClass",
      name: "第九十七屆大會", nameEn: "97th Congregation",
      note: "全日制本科課程之課堂（醫科四至六年級除外）及研究院課程之日間課堂停課"
    },
    {
      date: "2026-12-25", kind: "holiday", publicHoliday: true,
      name: "聖誕節", nameEn: "Christmas Day"
    },
    {
      date: "2026-12-26", kind: "holiday", publicHoliday: true,
      name: "聖誕節後第一個周日", nameEn: "The first weekday after Christmas Day"
    },

    /* ---- 2027 年 ---- */
    {
      date: "2027-01-01", kind: "holiday", publicHoliday: true,
      name: "一月一日", nameEn: "The first day of January"
    },
    {
      date: "2027-02-05", kind: "holiday", publicHoliday: false,
      name: "農曆新年假期", nameEn: "Lunar New Year Vacation"
    },
    {
      date: "2027-02-06", kind: "holiday", publicHoliday: true,
      name: "農曆新年", nameEn: "Lunar New Year's Day"
    },
    {
      date: "2027-02-07", kind: "holiday", publicHoliday: false,
      name: "農曆新年假期", nameEn: "Lunar New Year Vacation"
    },
    {
      date: "2027-02-08", kind: "holiday", publicHoliday: true,
      name: "農曆新年假期", nameEn: "Lunar New Year Vacation"
    },
    {
      date: "2027-02-09", kind: "holiday", publicHoliday: true,
      name: "農曆新年假期", nameEn: "Lunar New Year Vacation"
    },
    {
      date: "2027-02-10", kind: "holiday", publicHoliday: false,
      name: "農曆新年假期", nameEn: "Lunar New Year Vacation"
    },
    {
      date: "2027-02-11", kind: "holiday", publicHoliday: false,
      name: "農曆新年假期", nameEn: "Lunar New Year Vacation"
    },
    {
      date: "2027-03-26", kind: "holiday", publicHoliday: true,
      name: "耶穌受難節", nameEn: "Good Friday"
    },
    {
      date: "2027-03-27", kind: "holiday", publicHoliday: true,
      name: "耶穌受難節翌日", nameEn: "The day following Good Friday"
    },
    {
      date: "2027-03-29", kind: "holiday", publicHoliday: true,
      name: "復活節星期一", nameEn: "Easter Monday"
    },
    {
      date: "2027-04-05", kind: "holiday", publicHoliday: true,
      name: "清明節", nameEn: "Ching Ming Festival"
    },
    {
      date: "2027-05-01", kind: "holiday", publicHoliday: true,
      name: "勞動節", nameEn: "Labour Day"
    },
    {
      date: "2027-05-13", kind: "holiday", publicHoliday: true,
      name: "佛誕", nameEn: "The Birthday of the Buddha"
    },
    {
      date: "2027-06-09", kind: "holiday", publicHoliday: true,
      name: "端午節", nameEn: "Tuen Ng Festival"
    },
    {
      date: "2027-07-01", kind: "holiday", publicHoliday: true,
      name: "香港特別行政區成立紀念日", nameEn: "Hong Kong SAR Establishment Day"
    }
  ]
};
