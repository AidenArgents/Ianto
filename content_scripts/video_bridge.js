(() => {
  if (window !== window.top) return;
  const actions = new Set(['tabs', 'bind', 'preflight', 'start', 'cancel']);
  document.addEventListener('VCE_IANTO_REQUEST', event => {
    const d = event.detail || {};
    if (!actions.has(d.action) || typeof d.id !== 'string') return;
    const respond = response => document.dispatchEvent(new CustomEvent('VCE_IANTO_RESPONSE', {detail: {id: d.id, ...response}}));
    try {
      chrome.runtime.sendMessage({action: 'vceVideoClient', operation: d.action, provider: d.provider,
        tabId: d.tabId, jobId: d.jobId, grant: d.grant}, response => {
        respond(chrome.runtime.lastError ? {ok: false, error: 'Ianto 已更新，请刷新本页面'} : response || {ok: false, error: '视频后台未响应'});
      });
    } catch { respond({ok: false, error: 'Ianto 已更新，请刷新本页面'}); }
  });
})();
