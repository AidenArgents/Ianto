/* Durable job-scoped relay. Large videos travel in 512 KiB chunks, not one message.
   Website workers own serial execution; MV3 restarts never resubmit a paid click. */
(() => {
  const C = VceVideoContract;
  const runKey = id => `vceVideoRun_${C.jobId(id)}`;
  const readRun = async id => (await chrome.storage.session.get(runKey(id)))[runKey(id)];
  async function inject(tabId, provider) {
    const tab = await chrome.tabs.get(tabId);
    if (C.provider(tab.url) !== provider) throw new Error('目标标签页不是所选视频平台');
    await chrome.scripting.executeScript({target: {tabId}, files: ['content_scripts/video_worker.js']});
    return tab;
  }
  async function relay(run, suffix, body) {
    C.origin(run.origin); C.suffix(suffix);
    const response = await fetch(`${run.origin}/api/web-runs/${C.jobId(run.jobId)}${suffix}`, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error',
      headers: {'X-VCE-Web-Grant': run.grant, 'Content-Type': 'application/json'},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(typeof result.detail === 'string' ? result.detail : `本地回传失败 HTTP ${response.status}`);
    }
    if (suffix.endsWith('/image')) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 20 * 1024 * 1024) throw new Error('关键画面超过20MB');
      let binary = ''; for (let i=0; i<bytes.length; i+=32768) binary += String.fromCharCode(...bytes.subarray(i, i+32768));
      return {dataUrl: `data:image/png;base64,${btoa(binary)}`};
    }
    return response.json();
  }
  async function client(request, sender) {
    if (!sender.tab || sender.frameId !== 0) throw new Error('只接受工作台顶层页面');
    const origin = C.origin(sender.url);
    if (request.operation === 'tabs') {
      const profiles = (await chrome.storage.local.get('vceVideoProfiles')).vceVideoProfiles || {};
      const tabs = (await chrome.tabs.query({})).filter(t => C.provider(t.url) === request.provider);
      return {version: chrome.runtime.getManifest().version, tabs: tabs.map(t => ({id: t.id, title: t.title, bound: Boolean(profiles[new URL(t.url).origin + new URL(t.url).pathname])}))};
    }
    if (request.operation === 'cancel') {
      const run = await readRun(request.jobId);
      if (!run || run.origin !== origin) return {cancelled: true};
      await chrome.tabs.sendMessage(run.tabId, {action: 'vceVideoStop', jobId: run.jobId}).catch(() => {});
      await chrome.storage.session.remove(runKey(run.jobId));
      return {cancelled: true};
    }
    await inject(request.tabId, request.provider);
    if (request.operation === 'bind') {
      await chrome.tabs.update(request.tabId, {active: true});
      const result = await chrome.tabs.sendMessage(request.tabId, {action: 'vceVideoBind'});
      if (!result.ok) throw new Error(result.error);
      return result;
    }
    const ready = await chrome.tabs.sendMessage(request.tabId, {action: 'vceVideoReady'});
    if (!ready.ok) throw new Error(ready.error);
    if (request.operation === 'preflight') return ready;
    if (request.operation !== 'start') throw new Error('未知操作');
    C.jobId(request.jobId);
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(request.grant || '')) throw new Error('任务授权无效');
    const all = await chrome.storage.session.get(null);
    if (Object.entries(all).some(([k,v]) => k.startsWith('vceVideoRun_') && v.tabId === request.tabId)) throw new Error('此网页仍有未结束队列，请先在原项目停止队列');
    const run = {jobId: request.jobId, grant: request.grant, tabId: request.tabId, origin, provider: request.provider, created: Date.now()};
    const bundle = await relay(run, '');
    if (bundle.provider !== run.provider) throw new Error('网页平台与任务不匹配');
    await chrome.storage.session.set({[runKey(run.jobId)]: run});
    try {
      await chrome.tabs.update(run.tabId, {active: true});
      const result = await chrome.tabs.sendMessage(run.tabId, {action: 'vceVideoRun', jobId: run.jobId, bundle});
      if (!result.ok) throw new Error(result.error);
      return {started: true};
    } catch (error) {
      await relay(run, '/status', {failed: true, message: error.message}).catch(() => {});
      await chrome.storage.session.remove(runKey(run.jobId));
      throw error;
    }
  }
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (!['vceVideoClient', 'vceVideoRelay'].includes(request?.action)) return false;
    (async () => {
      if (request.action === 'vceVideoClient') return client(request, sender);
      const run = await readRun(request.jobId);
      if (!run || sender.tab?.id !== run.tabId || sender.frameId !== 0 || C.provider(sender.url) !== run.provider) throw new Error('无权回传此任务');
      const result = await relay(run, request.suffix, request.body);
      if (request.suffix === '/finish' || (request.suffix === '/status' && request.body?.failed)) await chrome.storage.session.remove(runKey(run.jobId));
      return result;
    })().then(result => respond({ok: true, result}), error => respond({ok: false, error: error.message}));
    return true;
  });
  chrome.tabs.onRemoved.addListener(async tabId => {
    const runs = await chrome.storage.session.get(null);
    for (const [key, run] of Object.entries(runs)) {
      if (!key.startsWith('vceVideoRun_') || run.tabId !== tabId) continue;
      await relay(run, '/status', {failed: true, message: '目标网页已关闭；未自动重新提交。已生成片段请到网站查看。'}).catch(() => {});
      await chrome.storage.session.remove(key);
    }
  });
})();
