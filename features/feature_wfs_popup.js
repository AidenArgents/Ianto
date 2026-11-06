const BUILD = '0.6.1';
const SYSTEMS = [
  {key: 'walmart_wfs', label: '领星 · Walmart WFS 库存 / 库龄 / WFS销量', host: 'erp.lingxing.com', file: '领星_WFS库存销量.json'},
];

function fmt(ts) {
  if (!ts) return '未拉取';
  const date = new Date(ts), pad = n => String(n).padStart(2, '0');
  return `上次：${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function workerVersion() {
  let timer;
  try {
    return await Promise.race([
      chrome.runtime.sendMessage({action: 'wfsVersion'}).catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 1500); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function startPull(system, button, status) {
  button.disabled = true;
  button.textContent = '启动中…';
  try {
    const worker = await workerVersion();
    if (worker?.version !== BUILD) {
      await chrome.storage.local.set({queued_ianto_wfs_pull: {time: Date.now()}});
      chrome.runtime.reload();
      return;
    }
    const response = await chrome.runtime.sendMessage({action: 'wfsPull', key: system.key});
    if (!response?.ok) throw new Error('后台没有确认启动，请关闭插件后重开重试。');
    await refresh();
  } catch (error) {
    status.className = 'wfs-time error';
    status.textContent = '启动失败：' + error.message;
    button.disabled = false;
    button.textContent = '重试';
  }
}

function render(store, currentUrl, exists) {
  const box = document.getElementById('wfs_rows');
  box.innerHTML = '';
  for (const system of SYSTEMS) {
    let isCurrent = false;
    try { isCurrent = new URL(currentUrl).hostname === system.host; } catch (_) {}
    const last = store['last_' + system.key];
    const run = store['run_' + system.key];
    const busyState = run && ['running', 'downloading'].includes(run.state);
    const busy = busyState && Date.now() - run.updatedAt < 90000;
    const row = document.createElement('div');
    row.className = 'wfs-row' + (isCurrent ? ' wfs-cur' : '');
    const info = document.createElement('div'); info.className = 'wfs-info';
    const label = document.createElement('div'); label.className = 'wfs-label';
    label.textContent = system.label;
    if (isCurrent) {
      const tag = document.createElement('span'); tag.className = 'wfs-cur-tag';
      tag.textContent = '当前页'; label.appendChild(tag);
    }
    const status = document.createElement('div'); status.className = 'wfs-time';
    if (busy) { status.className += ' running'; status.textContent = run.message; }
    else if (busyState) { status.className += ' error'; status.textContent = '上次任务未完成，请重新点拉取。'; }
    else if (run?.state === 'error') { status.className += ' error'; status.textContent = run.message; }
    else if (last && !exists[system.key]) { status.className += ' ok'; status.textContent = `${fmt(last.time)} · 已保存，文件可能已移入面板目录`; }
    else if (last) { status.className += ' ok'; status.textContent = `${fmt(last.time)} · 库存 ${last.n || 0} 条` + (last.matched != null ? ` · 销量匹配 ${last.matched} 条` : ''); }
    else { status.textContent = '未拉取'; }
    const button = document.createElement('button');
    button.textContent = busy ? '拉取中…' : '拉取'; button.disabled = !!busy;
    button.onclick = () => startPull(system, button, status);
    info.append(label, status); row.append(info, button); box.appendChild(row);
  }
}

let refreshSequence = 0;
async function refresh() {
  const sequence = ++refreshSequence;
  const [tabs, store] = await Promise.all([
    chrome.tabs.query({active: true, currentWindow: true}), chrome.storage.local.get(null),
  ]);
  const exists = {};
  await Promise.all(SYSTEMS.map(async system => {
    const last = store['last_' + system.key];
    const downloads = await chrome.downloads.search(last?.downloadId != null ? {id: last.downloadId} : {filenameRegex: system.file.replace('.', '\\.'), limit: 20});
    exists[system.key] = downloads.some(item => item.state === 'complete' && item.exists && item.filename?.replace(/\\/g, '/').split('/').pop() === system.file);
  }));
  if (sequence === refreshSequence) render(store, tabs[0]?.url || '', exists);
}
refresh().catch(console.error);
chrome.storage.onChanged.addListener((_, area) => { if (area === 'local') refresh().catch(console.error); });
