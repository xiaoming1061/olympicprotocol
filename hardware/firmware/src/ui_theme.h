/* 屏幕排版参数：200×200 墨水屏上每样东西画在哪
 *
 * 只放数字，不放代码——因为 `hardware/preview/render.mjs` 会正则读这个文件，
 * 用同一组数字在电脑上把屏幕画出来。**改这里，电脑上的预览就跟着变**，
 * 不用两边各改一遍。新增参数时保持 `#define UI_XXX 123` 这个写法。
 *
 * 纵向坐标都是 200 高的绝对像素；横向统一从 UI_MARGIN 开始，
 * 右对齐的东西算到 UI_W - UI_MARGIN 为止。
 */

#ifndef OP_UI_THEME_H
#define OP_UI_THEME_H

/* 屏幕 */
#define UI_W 200
#define UI_H 200
#define UI_MARGIN 6

/* 字：8×8 点阵，一格 8 像素宽，放大倍数是整数 */
#define UI_GLYPH_W 8
#define UI_GLYPH_H 8
#define UI_ADVANCE 8
#define UI_BIG 2
#define UI_CHARS_MAX 23
#define UI_TITLE_LINES 2

/* 横线 */
#define UI_Y_RULE1 17
#define UI_RULE1_H 1
#define UI_Y_RULE2 94
#define UI_RULE2_H 2

/* 顶部：日期 + 电量 */
#define UI_Y_HEADER 6

/* 中间那一大块：下一节课 */
#define UI_Y_BIG_TIME 24
#define UI_Y_BIG_TAG 30
#define UI_Y_META 48
#define UI_Y_TITLE1 60
#define UI_Y_TITLE2 70
#define UI_Y_VENUE 82

/* 下面那段列表（今天还剩几节 / 明天几节） */
#define UI_Y_LIST_HEAD 100
#define UI_Y_LIST_TOP 114
/* 课少的时候一行占两行宽度（节次 + 地点），把"在哪栋楼"直接摆出来；
   课多（超过 UI_LIST_TALL_MAX 节）就退回一行一节，能多列几节 */
#define UI_LIST_TALL_MAX 3
#define UI_LIST_STEP_TALL 22
#define UI_LIST_ROWS_TALL 3
#define UI_LIST_VENUE_DY 10
#define UI_LIST_STEP_SHORT 14
#define UI_LIST_ROWS_SHORT 5

/* 页脚：什么时候更新的 */
#define UI_Y_FOOTER 188

#endif /* OP_UI_THEME_H */
