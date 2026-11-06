// 暂存 Walmart WFS库存及订单列表请求；会话请求头只保存在页面内存。
(() => {
  if (window.__iantoWfsCaptureVersion === 4) return;
  window.__iantoWfsCaptureInstalled = true;
  window.__iantoWfsCaptureVersion = 4;
  const captureKey = url => {
    try {
      const u = new URL(String(url), location.href);
      if (![location.origin, 'https://gw.lingxingerp.com'].includes(u.origin)) return '';
      if (u.pathname === '/mp-platform-warehouse-api/api/walmart/walmartStockSearchV2') return 'wfs';
      if (u.pathname === '/stats-web-order/order/platform/list') return 'orders';
    } catch (_) {}
    return '';
  };
  const remember = (url, body, headers, credentials) => {
    const key = captureKey(url);
    if (!key || typeof body !== 'string') return;
    try {
      JSON.parse(body);
      window.__iantoWfsRequests = window.__iantoWfsRequests || {};
      window.__iantoWfsRequests[key] = {url: new URL(String(url), location.href).href, body, headers: {...headers}, credentials, capturedAt: Date.now()};
    } catch (_) {}
  };
  const open = XMLHttpRequest.prototype.open;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__iantoWfsUrl = url; this.__iantoWfsHeaders = {};
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(key, value) {
    if (captureKey(this.__iantoWfsUrl)) this.__iantoWfsHeaders[key] = value;
    return setHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    remember(this.__iantoWfsUrl, body, this.__iantoWfsHeaders || {}, this.withCredentials ? 'include' : 'same-origin');
    return send.apply(this, arguments);
  };
  const originalFetch = window.fetch;
  window.fetch = function(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input && input.url;
    if (captureKey(url)) {
      const request = input instanceof Request ? input : null;
      const h = {};
      new Headers(init?.headers || request?.headers || {}).forEach((v, k) => { h[k] = v; });
      const credentials = init?.credentials || request?.credentials || 'same-origin';
      if (typeof init?.body === 'string') remember(url, init.body, h, credentials);
      else if (request) request.clone().text().then(body => remember(url, body, h, credentials)).catch(() => {});
    }
    return originalFetch.apply(this, arguments);
  };
})();
