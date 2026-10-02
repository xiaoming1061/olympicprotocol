/* 海拔查询：用 Open-Meteo 的免费接口，不需要 key，也允许浏览器直接跨域调用。
 *
 * 为什么需要它：港中文这类建在山上的校园，楼与楼之间高差可以上百米，
 * 从山脚走到山顶比平地多花好几倍时间。只算水平距离会严重低估。
 */

window.OP = window.OP || {};

(function (OP) {
  "use strict";

  var ENDPOINT = "https://api.open-meteo.com/v1/elevation";
  var BATCH = 100;                 // 接口一次最多收 100 个坐标
  var TIMEOUT = 15000;
  var CACHE_TTL = 24 * 3600 * 1000;  // 海拔不会变，缓存一天足够

  var cache = {};
  var cacheAt = {};

  /* 坐标取到约 11 米精度：同一个小范围共用一个海拔，省掉重复请求 */
  function keyOf(lat, lng) {
    return Number(lat).toFixed(4) + "," + Number(lng).toFixed(4);
  }

  function cachedValue(lat, lng) {
    var key = keyOf(lat, lng);
    if (cache[key] === undefined) return undefined;
    if (Date.now() - cacheAt[key] > CACHE_TTL) return undefined;
    return cache[key];
  }

  function fetchWithTimeout(url) {
    if (typeof AbortController !== "function") return fetch(url);

    var controller = new AbortController();
    var timer = window.setTimeout(function () { controller.abort(); }, TIMEOUT);

    return fetch(url, { signal: controller.signal }).then(function (res) {
      window.clearTimeout(timer);
      if (!res.ok) throw new Error("海拔服务返回 HTTP " + res.status);
      return res;
    }, function (err) {
      window.clearTimeout(timer);
      if (err && err.name === "AbortError") throw new Error("海拔服务响应超时");
      throw err;
    });
  }

  function fetchBatch(points) {
    var lats = points.map(function (p) { return Number(p.lat).toFixed(6); }).join(",");
    var lngs = points.map(function (p) { return Number(p.lng).toFixed(6); }).join(",");

    return fetchWithTimeout(ENDPOINT + "?latitude=" + lats + "&longitude=" + lngs)
      .then(function (res) { return res.json(); })
      .then(function (json) {
        return (json && Array.isArray(json.elevation)) ? json.elevation : [];
      });
  }

  function clearCache() {
    cache = {};
    cacheAt = {};
  }

  /**
   * 批量查海拔。已经有缓存的不会重复请求。
   * @param {Array} points  [{ lat, lng }]
   * @param {Function} onProgress  (已完成批次数, 总批次数)
   * @returns {Promise<Array>} 与输入一一对应的海拔，查不到的为 null
   */
  function lookup(points, onProgress) {
    var list = points || [];
    var result = new Array(list.length);
    var pending = [];

    list.forEach(function (p, i) {
      var hit = (p && typeof p.lat === "number" && typeof p.lng === "number")
        ? cachedValue(p.lat, p.lng) : undefined;
      if (hit !== undefined) result[i] = hit;
      else pending.push({ point: p, index: i });
    });

    if (!pending.length) return Promise.resolve(result);
    if (typeof fetch !== "function") {
      return Promise.reject(new Error("这个浏览器不支持网络请求"));
    }

    var batches = [];
    for (var i = 0; i < pending.length; i += BATCH) {
      batches.push(pending.slice(i, i + BATCH));
    }

    var done = 0;

    function next() {
      if (done >= batches.length) return Promise.resolve(result);
      var batch = batches[done++];

      return fetchBatch(batch.map(function (x) { return x.point; })).then(function (values) {
        batch.forEach(function (x, i) {
          var value = typeof values[i] === "number" ? values[i] : null;
          result[x.index] = value;
          if (value !== null) {
            var key = keyOf(x.point.lat, x.point.lng);
            cache[key] = value;
            cacheAt[key] = Date.now();
          }
        });
        if (typeof onProgress === "function") onProgress(done, batches.length);
        return next();
      });
    }

    return next();
  }

  /* 查单个点，方便查当前位置的海拔 */
  function at(lat, lng) {
    var hit = cachedValue(lat, lng);
    if (hit !== undefined) return Promise.resolve(hit);
    return lookup([{ lat: lat, lng: lng }]).then(function (list) { return list[0]; });
  }

  OP.Elevation = {
    ENDPOINT: ENDPOINT,
    keyOf: keyOf,
    lookup: lookup,
    at: at,
    clearCache: clearCache
  };
})(window.OP);
