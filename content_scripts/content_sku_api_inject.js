// MAIN world 注入：观察模式 — 只打印目标接口的请求 body 到控制台
// 在确认 SKU 字段名之前不修改 payload，避免误伤页面
//
// 目标接口：
//   - /erpHwc/erpHwc/productPerformance/getProductPerformanceByWhere
//   - /erpHwc/erpHwc/replenishment/plan/page
//   - /erpHwc/erpHwc/replenishment/plan/count
//
// 用户：在控制台找 [SKU-Ext/API] 原始 payload 的那行，把 JSON 截给我，
// 我会改成精确注入并撤掉表单填写的依赖。
(function () {
  const TAG = "[SKU-Ext/API]";
  const sku = new URLSearchParams(location.search).get("_sku");
  if (!sku) return;

  const TARGETS = [
    "getProductPerformanceByWhere",
    "/replenishment/plan/page",
    "/replenishment/plan/count"
  ];

  function isTarget(url) {
    if (typeof url !== "string") return false;
    return TARGETS.some(t => url.includes(t));
  }

  function tryParse(body) {
    try { return [JSON.parse(body), "json"]; } catch (e) {}
    if (body instanceof URLSearchParams) return [body, "urlsearchparams"];
    if (typeof body === "string" && body.includes("=")) {
      try { return [new URLSearchParams(body), "urlsearchparams"]; } catch (e) {}
    }
    return [body, "raw"];
  }

  // ---- patch fetch (log only) ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (isTarget(url) && init && init.body) {
        const [parsed, type] = tryParse(init.body);
        console.log(TAG, "原始 payload (fetch)", url, "type=" + type, parsed);
      }
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };

  // ---- patch XHR (log only) ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__skuExtUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this.__skuExtUrl && isTarget(this.__skuExtUrl) && body) {
        const [parsed, type] = tryParse(body);
        console.log(TAG, "原始 payload (xhr)", this.__skuExtUrl, "type=" + type, parsed);
      }
    } catch (e) {}
    return origSend.call(this, body);
  };

  console.log(TAG, "拦截器已就位（观察模式），sku =", sku);
})();
