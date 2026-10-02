/* Olympic Protocol — 默认宿舍数据
 *
 * 数据来自 OpenStreetMap（Overpass API），按关键词搜出来的：
 *   宿舍 / 舍堂 / 書院 / Hostel / Residence / Dormitory / Hall
 *   以及 building=dormitory、amenity=student_accommodation、tourism=hostel
 * 共 61 处（其中 61 处有中文名），
 * 另有 2 处是手工补录的（书院本身就是宿舍，标签不是 dormitory，关键词也捞不到）：
 *   晨興書院 Morningside College  way/230185998
 *   伍宜孫書院 Wu Yee Sun College  way/194547401
 * 可能有缺漏或误判——发现不对就自己在页面上补一条。
 *
 * 每条两个名字：name 是英文（课表和地图上的写法），nameZh 是中文名。
 * 两个都要留着：列表和路线卡片「英文 中文」并排显示，中文名也是搜索和播报用的。
 *
 * 不要手改这个文件，它由下面的命令生成：
 *     node tools/make-dorms.js --fetch && node tools/make-dorms.js
 */

window.OP = window.OP || {};

window.OP.DEFAULT_DORMS = {
  version: 2,
  source: "OpenStreetMap (Overpass API)",
  dorms: [
    { id: "relation-2325105", name: "Adam Schall Residence", nameZh: "湯若望宿舍", nameEn: "Adam Schall Residence", alias: ["湯若望宿舍 Adam Schall Residence"], lat: 22.421787, lng: 114.205648, kind: "dormitory" },
    { id: "way-135191897", name: "Bethlehem Hall", nameZh: "伯利衡宿舍", nameEn: "Bethlehem Hall", alias: ["伯利衡宿舍 Bethlehem Hall"], lat: 22.421476, lng: 114.206181, kind: "dormitory" },
    { id: "way-135311814", name: "C.C. Staff Quarters A", nameZh: "崇基教職員宿舍A座", nameEn: "C.C. Staff Quarters A", alias: ["崇基教職員宿舍A座 C.C. Staff Quarters A"], lat: 22.416844, lng: 114.207388, kind: "dormitory" },
    { id: "way-135311803", name: "C.C. Staff Quarters B", nameZh: "崇基教職員宿舍B座", nameEn: "C.C. Staff Quarters B", alias: ["崇基教職員宿舍B座 C.C. Staff Quarters B"], lat: 22.416843, lng: 114.207751, kind: "dormitory" },
    { id: "way-135311798", name: "C.C. Staff Quarters C", nameZh: "崇基教職員宿舍C座", nameEn: "C.C. Staff Quarters C", alias: ["崇基教職員宿舍C座 C.C. Staff Quarters C"], lat: 22.417029, lng: 114.208067, kind: "dormitory" },
    { id: "way-135021153", name: "C.C. Staff Quarters S", nameZh: "崇基學院教職員宿舍S座", nameEn: "C.C. Staff Quarters S", alias: ["崇基學院教職員宿舍S座 C.C. Staff Quarters S"], lat: 22.41694, lng: 114.211413, kind: "dormitory" },
    { id: "way-135193165", name: "Chan Chun Ha Hostel", nameZh: "陳震夏宿舍", nameEn: "Chan Chun Ha Hostel", alias: ["陳震夏宿舍 Chan Chun Ha Hostel"], lat: 22.422032, lng: 114.204955, kind: "dormitory" },
    { id: "way-135190721", name: "Chan Kwan Tung Inter-university Hall", nameZh: "昆棟樓", nameEn: "Chan Kwan Tung Inter-university Hall", alias: ["昆棟樓 Chan Kwan Tung Inter-university Hall"], lat: 22.419895, lng: 114.210747, kind: "dormitory" },
    { id: "way-134408687", name: "Chih Hsing Hall", nameZh: "知行樓", nameEn: "Chih Hsing Hall", alias: ["知行樓 Chih Hsing Hall"], lat: 22.421308, lng: 114.210127, kind: "dormitory" },
    { id: "way-1344748884", name: "Choi Kai Yau Residence", nameZh: "蔡繼有宿舍", nameEn: "Choi Kai Yau Residence", alias: ["蔡繼有宿舍 Choi Kai Yau Residence"], lat: 22.420507, lng: 114.203998, kind: "dormitory" },
    { id: "way-667717925", name: "CUHK Jockey Club Postgraduate Hall 2", nameZh: "香港中文大學賽馬會研究生宿舍二座", nameEn: "CUHK Jockey Club Postgraduate Hall 2", alias: ["賽馬會研究生宿舍二座 Jockey Club Postgraduate Hall 2"], lat: 22.426018, lng: 114.206271, kind: "dormitory" },
    { id: "way-667717927", name: "CUHK Jockey Club Postgraduate Hall 3", nameZh: "香港中文大學賽馬會研究生宿舍三座", nameEn: "CUHK Jockey Club Postgraduate Hall 3", alias: ["賽馬會研究生宿舍三座 Jockey Club Postgraduate Hall 3"], lat: 22.42624, lng: 114.205914, kind: "dormitory" },
    { id: "way-134409111", name: "Daisy Li Hall", nameZh: "紫霞樓", nameEn: "Daisy Li Hall", alias: ["紫霞樓 Daisy Li Hall"], lat: 22.421202, lng: 114.210676, kind: "dormitory" },
    { id: "way-194547402", name: "Dorothy and Ti-Hua Koo Building", nameZh: "顧鐵華費肇芬伉儷樓", nameEn: "Dorothy and Ti-Hua Koo Building", alias: ["顧鐵華費肇芬伉儷樓 Dorothy and Ti-Hua Koo Building","和聲書院南座 South Block, Lee Woo Sing College","和聲書院南座","South Block, Lee Woo Sing College"], lat: 22.42221, lng: 114.204126, kind: "dormitory" },
    { id: "way-134408693", name: "Friendship Lodge", nameZh: "會友樓", nameEn: "Friendship Lodge", alias: ["會友樓 Friendship Lodge"], lat: 22.421956, lng: 114.208773, kind: "dormitory" },
    { id: "way-134409115", name: "Grace Tien Hall", nameZh: "志文樓", nameEn: "Grace Tien Hall", alias: ["志文樓 Grace Tien Hall"], lat: 22.421653, lng: 114.210628, kind: "dormitory" },
    { id: "way-135193917", name: "Hang Seng Hall", nameZh: "恒生樓", nameEn: "Hang Seng Hall", alias: ["恒生樓 Hang Seng Hall"], lat: 22.422811, lng: 114.20499, kind: "dormitory" },
    { id: "way-174133698", name: "Ho Tim Hall", nameZh: "何添堂", nameEn: "Ho Tim Hall", alias: ["何添堂 Ho Tim Hall"], lat: 22.418545, lng: 114.210188, kind: "dormitory" },
    { id: "way-135021152", name: "Hua Lien Tang", nameZh: "華連堂", nameEn: "Hua Lien Tang", alias: ["華連堂 Hua Lien Tang"], lat: 22.41721, lng: 114.209616, kind: "dormitory" },
    { id: "way-135264056", name: "International House 1", nameZh: "國際生舍堂一座", nameEn: "International House 1", alias: ["國際生舍堂一座 International House 1"], lat: 22.423208, lng: 114.204319, kind: "dormitory" },
    { id: "way-135264069", name: "International House 2", nameZh: "國際生舍堂二座", nameEn: "International House 2", alias: ["國際生舍堂二座 International House 2"], lat: 22.423649, lng: 114.204415, kind: "dormitory" },
    { id: "way-135190718", name: "International House 3", nameZh: "國際生舍堂三座", nameEn: "International House 3", alias: ["國際生舍堂三座 International House 3"], lat: 22.420048, lng: 114.210126, kind: "dormitory" },
    { id: "way-696387742", name: "Jockey Club Postgraduate Hall No. 1", nameZh: "賽馬會研究生宿舍一座", nameEn: "Jockey Club Postgraduate Hall No. 1", alias: ["賽馬會研究生宿舍一座 Jockey Club Postgraduate Hall No. 1"], lat: 22.420419, lng: 114.212052, kind: "dormitory" },
    { id: "way-135904508", name: "Kuo Mou Hall", nameZh: "國楙樓", nameEn: "Kuo Mou Hall", alias: ["國楙樓 Kuo Mou Hall"], lat: 22.422544, lng: 114.201057, kind: "dormitory" },
    { id: "way-174133703", name: "Lee Quo Wei Hall", nameZh: "利國偉堂", nameEn: "Lee Quo Wei Hall", alias: ["利國偉堂 Lee Quo Wei Hall"], lat: 22.418266, lng: 114.209834, kind: "dormitory" },
    { id: "way-135021155", name: "Lee Shu Pui Hall", nameZh: "利樹培堂", nameEn: "Lee Shu Pui Hall", alias: ["利樹培堂 Lee Shu Pui Hall"], lat: 22.41702, lng: 114.211056, kind: "dormitory" },
    { id: "way-135018853", name: "Madam S.H.Ho Hall", nameZh: "何善衡夫人宿舍", nameEn: "Madam S.H.Ho Hall", alias: ["何善衡夫人宿舍 Madam S.H.Ho Hall"], lat: 22.417507, lng: 114.211259, kind: "dormitory" },
    { id: "way-193128663", name: "Maurice R. Greenberg Building", nameZh: "格林伯格樓", nameEn: "Maurice R. Greenberg Building", alias: ["格林伯格樓 Maurice R. Greenberg Building"], lat: 22.419161, lng: 114.210447, kind: "dormitory" },
    { id: "way-1243363293", name: "Mei Yun Tang", nameZh: "梅雲堂", nameEn: "Mei Yun Tang", alias: ["梅雲堂 Mei Yun Tang"], lat: 22.4203, lng: 114.208402, kind: "dormitory" },
    { id: "way-135018848", name: "Ming Hua Tang", nameZh: "明華堂", nameEn: "Ming Hua Tang", alias: ["明華堂 Ming Hua Tang"], lat: 22.417416, lng: 114.210406, kind: "dormitory" },
    { id: "way-135190724", name: "Minor Staff Quarters 2", nameZh: "職工宿舍第二座", nameEn: "Minor Staff Quarters 2", alias: ["職工宿舍第二座 Minor Staff Quarters 2"], lat: 22.419708, lng: 114.209565, kind: "dormitory" },
    { id: "way-135190723", name: "Minor Staff Quarters 3", nameZh: "職工宿舍第三座", nameEn: "Minor Staff Quarters 3", alias: ["職工宿舍第三座 Minor Staff Quarters 3"], lat: 22.419788, lng: 114.209743, kind: "dormitory" },
    { id: "way-230185998", name: "Morningside College", nameZh: "晨興書院", nameEn: "Morningside College", alias: ["晨興書院 Morningside College"], lat: 22.419081, lng: 114.210516, kind: "college" },
    { id: "way-194547400", name: "North Block, Lee Woo Sing College", nameZh: "和聲書院北座", nameEn: "North Block, Lee Woo Sing College", alias: ["和聲書院北座 North Block, Lee Woo Sing College"], lat: 22.422623, lng: 114.204425, kind: "dormitory" },
    { id: "way-135190722", name: "Panacea Lodge", nameZh: "芝苑", nameEn: "Panacea Lodge", alias: ["芝苑 Panacea Lodge"], lat: 22.420319, lng: 114.210265, kind: "dormitory" },
    { id: "way-107139028", name: "Pentecostal Mission Hall Complex (High Block)", nameZh: "五旬節會樓高座", nameEn: "Pentecostal Mission Hall Complex (High Block)", alias: ["五旬節會樓高座 Pentecostal Mission Hall Complex (High Block)","五高"], lat: 22.418543, lng: 114.209289, kind: "dormitory" },
    { id: "way-107139029", name: "Pentecostal Mission Hall Complex (Low Block)", nameZh: "五旬節會樓低座", nameEn: "Pentecostal Mission Hall Complex (Low Block)", alias: ["五旬節會樓低座 Pentecostal Mission Hall Complex (Low Block)","五低"], lat: 22.418837, lng: 114.20984, kind: "dormitory" },
    { id: "way-135264066", name: "Postgraduate Hall No. 4", nameZh: "研究生宿舍四座", nameEn: "Postgraduate Hall No. 4", alias: ["研究生宿舍四座 Postgraduate Hall No. 4"], lat: 22.423825, lng: 114.204875, kind: "dormitory" },
    { id: "way-135264060", name: "Postgraduate Hall No. 5", nameZh: "研究生宿舍五座", nameEn: "Postgraduate Hall No. 5", alias: ["研究生宿舍五座 Postgraduate Hall No. 5"], lat: 22.424301, lng: 114.205019, kind: "dormitory" },
    { id: "way-135264063", name: "Postgraduate Hall No. 6", nameZh: "研究生宿舍六座", nameEn: "Postgraduate Hall No. 6", alias: ["研究生宿舍六座 Postgraduate Hall No. 6"], lat: 22.424456, lng: 114.204689, kind: "dormitory" },
    { id: "way-134819423", name: "Postgraduate Hall No.3", nameZh: "研究生宿舍第三座", nameEn: "Postgraduate Hall No.3", alias: ["研究生宿舍第三座(博文苑) Postgraduate Hall No.3 (Inter-university Hall)"], lat: 22.413106, lng: 114.20956, kind: "dormitory" },
    { id: "way-135904006", name: "Student Hostel 2 (Low Block)", nameZh: "第二學生宿舍（低座）", nameEn: "Student Hostel 2 (Low Block)", alias: ["第二學生宿舍（低座）Student Hostel 2 (Low Block)","二宿低座 Student Hostel 2 (Low Block)","二宿低座"], lat: 22.423724, lng: 114.201084, kind: "dormitory" },
    { id: "way-135311810", name: "Theology Building", nameZh: "神學樓", nameEn: "Theology Building", alias: ["神學樓 Theology Building"], lat: 22.41734, lng: 114.206403, kind: "dormitory" },
    { id: "way-135264058", name: "U.C. Staff Residence", nameZh: "聯合苑", nameEn: "U.C. Staff Residence", alias: ["聯合苑 U.C. Staff Residence"], lat: 22.423301, lng: 114.205435, kind: "dormitory" },
    { id: "way-135264901", name: "University Residence No. 10", nameZh: "第十苑", nameEn: "University Residence No. 10", alias: ["第十苑 University Residence No. 10"], lat: 22.424883, lng: 114.208084, kind: "dormitory" },
    { id: "way-135264904", name: "University Residence No. 11", nameZh: "第十一苑", nameEn: "University Residence No. 11", alias: ["第十一苑 University Residence No. 11"], lat: 22.424329, lng: 114.208314, kind: "dormitory" },
    { id: "way-135264405", name: "University Residence No. 12", nameZh: "第十二苑", nameEn: "University Residence No. 12", alias: ["第十二苑 University Residence No. 12"], lat: 22.424524, lng: 114.206988, kind: "dormitory" },
    { id: "way-135264402", name: "University Residence No. 13", nameZh: "第十三苑", nameEn: "University Residence No. 13", alias: ["第十三苑 University Residence No. 13"], lat: 22.424495, lng: 114.207367, kind: "dormitory" },
    { id: "way-135265382", name: "University Residence No. 14", nameZh: "第十四苑", nameEn: "University Residence No. 14", alias: ["第十四苑 University Residence No. 14"], lat: 22.424036, lng: 114.207177, kind: "dormitory" },
    { id: "way-135264404", name: "University Residence No. 15", nameZh: "第十五苑", nameEn: "University Residence No. 15", alias: ["第十五苑 University Residence No. 15"], lat: 22.423543, lng: 114.206781, kind: "dormitory" },
    { id: "way-135265376", name: "University Residence No. 16", nameZh: "第十六苑", nameEn: "University Residence No. 16", alias: ["第十六苑 University Residence No. 16"], lat: 22.423756, lng: 114.207966, kind: "dormitory" },
    { id: "way-135265375", name: "University Residence No. 17", nameZh: "第十七苑", nameEn: "University Residence No. 17", alias: ["第十七苑 University Residence No. 17"], lat: 22.423499, lng: 114.208335, kind: "dormitory" },
    { id: "way-135315191", name: "University Residence Nos. 3", nameZh: "三苑", nameEn: "University Residence Nos. 3", alias: ["三苑 University Residence Nos. 3"], lat: 22.421465, lng: 114.203032, kind: "dormitory" },
    { id: "way-136637847", name: "Vice-Chancellor Residence", nameZh: "漢園", nameEn: "Vice-Chancellor Residence", alias: ["漢園 Vice-Chancellor Residence"], lat: 22.416756, lng: 114.202814, kind: "dormitory" },
    { id: "way-135018845", name: "Wen Chih Tang", nameZh: "文質堂", nameEn: "Wen Chih Tang", alias: ["文質堂 Wen Chih Tang"], lat: 22.417443, lng: 114.211665, kind: "dormitory" },
    { id: "way-135313705", name: "Wen Lin Tang", nameZh: "文林堂", nameEn: "Wen Lin Tang", alias: ["文林堂 Wen Lin Tang"], lat: 22.413284, lng: 114.207765, kind: "dormitory" },
    { id: "way-194547401", name: "Wu Yee Sun College", nameZh: "伍宜孫書院", nameEn: "Wu Yee Sun College", alias: ["伍宜孫書院 Wu Yee Sun College"], lat: 22.422205, lng: 114.202394, kind: "college" },
    { id: "way-174133712", name: "Xuesi Hall", nameZh: "學思樓", nameEn: "Xuesi Hall", alias: ["學思樓 Xuesi Hall"], lat: 22.421549, lng: 114.209597, kind: "dormitory" },
    { id: "way-545778814", name: "Ya Qun Lodge", nameZh: "雅群樓", nameEn: "Ya Qun Lodge", alias: ["雅群樓 Ya Qun Lodge"], lat: 22.422898, lng: 114.20193, kind: "dormitory" },
    { id: "way-135904004", name: "Yat Sen Hall", nameZh: "逸仙樓", nameEn: "Yat Sen Hall", alias: ["逸仙樓 Yat Sen Hall"], lat: 22.423252, lng: 114.201152, kind: "dormitory" },
    { id: "way-135018852", name: "Ying Lin Tang", nameZh: "應林堂", nameEn: "Ying Lin Tang", alias: ["應林堂 Ying Lin Tang"], lat: 22.416614, lng: 114.21073, kind: "dormitory" }
  ]
};
