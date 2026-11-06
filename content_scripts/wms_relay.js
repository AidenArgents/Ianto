// 仅转交本页进度。最终快照由 executeScript 返回后台，不通过网页消息触发下载。
(() => {
  if (window.__iantoWfsProgressRelayInstalled) return;
  window.__iantoWfsProgressRelayInstalled = true;
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.source !== 'iantoWfs' || data.type !== 'iantoWfsProgress' ||
        typeof data.runId !== 'string' || typeof data.message !== 'string') return;
    chrome.runtime.sendMessage({type: 'iantoWfsProgress', runId: data.runId, message: data.message.slice(0, 300)}).catch(() => {});
  });
})();
