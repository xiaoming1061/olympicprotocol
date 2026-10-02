/* 定位与地理计算
 *
 * 坐标系统说明：
 *   浏览器 / GPS 拿到的是 WGS-84（国际标准）
 *   高德、腾讯用 GCJ-02（火星坐标）
 *   百度用 BD-09
 * 国内两者之间差几百米，所以跳转导航前必须做一次转换，否则会导到隔壁楼。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  var PI = Math.PI;
  var X_PI = (PI * 3000.0) / 180.0;
  var A = 6378245.0;
  var EE = 0.00669342162296594323;
  var EARTH_R = 6371000;

  /* ---------- 距离 ---------- */

  function haversine(a, b) {
    if (!a || !b) return null;
    var dLat = ((b.lat - a.lat) * PI) / 180;
    var dLng = ((b.lng - a.lng) * PI) / 180;
    var lat1 = (a.lat * PI) / 180;
    var lat2 = (b.lat * PI) / 180;
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function formatDistance(meters) {
    if (meters === null || meters === undefined || isNaN(meters)) return "--";
    if (meters < 1000) return Math.round(meters / 10) * 10 + " 米";
    return (meters / 1000).toFixed(meters < 10000 ? 1 : 0) + " 公里";
  }

  function formatDuration(minutes) {
    if (minutes === null || minutes === undefined || isNaN(minutes)) return "--";
    var m = Math.max(1, Math.round(minutes));
    if (m < 60) return m + " 分钟";
    return Math.floor(m / 60) + " 小时 " + (m % 60) + " 分钟";
  }

  /* ---------- 坐标转换 ---------- */

  function outOfChina(lat, lng) {
    return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
  }

  function transformLat(x, y) {
    var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
    return ret;
  }

  function transformLng(x, y) {
    var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
    return ret;
  }

  function wgs84ToGcj02(lat, lng) {
    if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
    var dLat = transformLat(lng - 105.0, lat - 35.0);
    var dLng = transformLng(lng - 105.0, lat - 35.0);
    var radLat = (lat / 180.0) * PI;
    var magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
    dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
    return { lat: lat + dLat, lng: lng + dLng };
  }

  function gcj02ToBd09(lat, lng) {
    var z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
    var theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
    return { lat: z * Math.sin(theta) + 0.006, lng: z * Math.cos(theta) + 0.0065 };
  }

  /* 反算：把高德 / 腾讯的 GCJ-02 坐标还原成标准的 WGS-84
   * 正向公式没有解析解，用迭代逼近，几次之后误差就降到厘米级 */
  function gcj02ToWgs84(lat, lng) {
    if (outOfChina(lat, lng)) return { lat: lat, lng: lng };
    var result = { lat: lat, lng: lng };
    for (var i = 0; i < 8; i++) {
      var forward = wgs84ToGcj02(result.lat, result.lng);
      result.lat += lat - forward.lat;
      result.lng += lng - forward.lng;
    }
    return result;
  }

  /* ---------- 导航链接 ---------- */

  function navLinks(name, lat, lng) {
    var gcj = wgs84ToGcj02(lat, lng);
    var bd = gcj02ToBd09(gcj.lat, gcj.lng);
    var label = encodeURIComponent(name);

    return [
      {
        label: "高德地图",
        url:
          "https://uri.amap.com/navigation?to=" +
          gcj.lng.toFixed(6) + "," + gcj.lat.toFixed(6) + "," + label +
          "&mode=walk&coordinate=gaode&callnative=1"
      },
      {
        label: "百度地图",
        url:
          "https://api.map.baidu.com/direction?destination=latlng:" +
          bd.lat.toFixed(6) + "," + bd.lng.toFixed(6) + "|name:" + label +
          "&mode=walking&region=%E5%85%A8%E5%9B%BD&output=html&src=webapp.olympic-protocol"
      },
      {
        label: "Google 地图",
        /* 这是 Google 的通用链接（universal link）：
           装了 App 就直接打开 App，没装才退回网页。
           香港用标准 WGS-84 坐标，不需要转换。 */
        /* primary：不问就跳这家。"现在出发"按钮用的就是它 */
        primary: true,
        url: "https://www.google.com/maps/dir/?api=1&destination=" +
          lat.toFixed(6) + "," + lng.toFixed(6) + "&travelmode=walking"
      },
      {
        label: "苹果地图",
        /* maps.apple.com 也是通用链接，会直接唤起「地图」App */
        url: "https://maps.apple.com/?daddr=" + lat.toFixed(6) + "," + lng.toFixed(6) + "&dirflg=w"
      },
      {
        label: "复制坐标",
        /* 原来这里是 geo: 协议（想"让系统自己挑地图 App"），
           但那是安卓的标准，iOS 根本不认，iPhone 上点了没反应。
           改成复制坐标：任何地图 App 的搜索框都能粘，两端都能用。 */
        copy: lat.toFixed(6) + ", " + lng.toFixed(6)
      }
    ];
  }

  /* ---------- 浏览器定位 ---------- */

  var watchId = null;

  function supported() {
    return typeof navigator !== "undefined" && !!navigator.geolocation;
  }

  function readableError(err) {
    if (!err) return "定位失败";
    switch (err.code) {
      case 1: return "定位权限被拒绝，请在浏览器或系统设置里允许位置访问";
      case 2: return "暂时拿不到位置信号，换个开阔一点的地方再试";
      case 3: return "定位超时，重试一次";
      default: return err.message || "定位失败";
    }
  }

  function normalize(pos) {
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      ts: pos.timestamp || Date.now()
    };
  }

  function watch(onUpdate, onError) {
    if (!supported()) {
      onError(new Error("此浏览器不支持定位"));
      return null;
    }
    stop();
    watchId = navigator.geolocation.watchPosition(
      function (pos) { onUpdate(normalize(pos)); },
      function (err) { onError(err); },
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 }
    );
    return watchId;
  }

  function stop() {
    if (watchId !== null && supported()) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
  }

  function once() {
    return new Promise(function (resolve, reject) {
      if (!supported()) {
        reject(new Error("此浏览器不支持定位"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve(normalize(pos)); },
        function (err) { reject(err); },
        { enableHighAccuracy: true, timeout: 20000 }
      );
    });
  }

  OP.Geo = {
    haversine: haversine,
    formatDistance: formatDistance,
    formatDuration: formatDuration,
    wgs84ToGcj02: wgs84ToGcj02,
    gcj02ToWgs84: gcj02ToWgs84,
    gcj02ToBd09: gcj02ToBd09,
    navLinks: navLinks,
    supported: supported,
    readableError: readableError,
    watch: watch,
    stop: stop,
    once: once
  };
})(window.OP);
