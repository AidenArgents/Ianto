const BUILD = '0.6.1';
const SYSTEM = 'walmart_wfs';
const FILE = '领星_WFS库存销量.json';
const ORIGIN = 'https://erp.lingxing.com';
const WFS_URL = ORIGIN + '/erp/mmulti/WFSStock';
const ORDERS_URL = ORIGIN + '/erp/mmulti/mpOrderList';
let activeRun = null;
const finishingDownloads = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !msg) return;
  if (msg.action === 'wfsVersion' && !sender.tab) {
    respond({version: BUILD});
  } else if (msg.action === 'wfsPull' && msg.key === SYSTEM && !sender.tab) {
    // 先确认收到；后续开页会关闭弹窗，任务仍由后台继续执行。
    respond({ok: true});
    handlePull().catch(console.error);
  } else if (msg.type === 'iantoWfsProgress' && activeRun && activeRun.state === 'running' &&
             msg.runId === activeRun.runId && sender.tab?.id === activeRun.tabId &&
             sender.origin === ORIGIN && typeof msg.message === 'string') {
    saveRun(activeRun, 'running', msg.message.slice(0, 300)).catch(console.error);
  }
});

chrome.downloads.onChanged.addListener(delta => {
  if (delta.state || delta.error || delta.exists) reconcileDownload(delta.id).catch(console.error);
});

async function saveRun(run, state, message) {
  Object.assign(run, {state, message, updatedAt: Date.now()});
  await chrome.storage.local.set({['run_' + SYSTEM]: {...run}});
}

function showWfsStatus(message) {
  let node = document.getElementById('ianto-wfs-pull-status');
  if (!node) {
    node = document.createElement('div');
    node.id = 'ianto-wfs-pull-status';
    node.style.cssText = 'position:fixed;top:20px;right:20px;max-width:520px;background:#202631;color:#fff;padding:14px 20px;border-radius:8px;z-index:999999;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
    (document.body || document.documentElement).appendChild(node);
  }
  node.textContent = message;
}

async function showOnTab(tabId, message) {
  if (tabId == null) return;
  try {
    await chrome.tabs.get(tabId); // 先检查标签页是否存在
    await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', func: showWfsStatus, args: [message]});
  } catch (_) { /* 标签页可能已关闭；弹窗仍会保留结果。 */ }
}

async function waitReady(tabId, maxMs = 30000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      throw new Error('标签页不存在或已关闭，请重新点击拉取。');
    }
    // 新建标签页可能先返回 about:blank/chrome://newtab，随后才提交 pendingUrl。
    // 等待导航完成后再判断域名，避免把正常加载误报成“已离开 ERP”。
    const url = tab.pendingUrl || tab.url;
    if (!url || url === 'about:blank' || url === 'chrome://newtab/' || url === 'chrome://newtab') {
      if (tab.status === 'complete' && url) throw new Error('领星页面未成功打开，请重新点击拉取。');
      await delay(400);
      continue;
    }
    let parsed;
    try { parsed = new URL(url); }
    catch (_) {
      if (tab.status !== 'complete') { await delay(400); continue; }
      throw new Error('领星页面地址无效，请重新点击拉取。');
    }
    if (parsed.origin !== ORIGIN) {
      if (tab.status !== 'complete') { await delay(400); continue; }
      throw new Error('领星页面已离开 ERP，请重新登录领星后点拉取。');
    }
    if (/\/login(?:\/|$|[?#])/i.test(parsed.pathname)) throw new Error('领星登录已失效，请登录领星后再点拉取。');
    if (tab.status === 'complete') return;
    await delay(400);
  }
  throw new Error('领星页面加载超时，请检查网络后重试。');
}

// 每次拉取主动刷新复用页，解决扩展更新后旧页面没有采集脚本的问题。
async function prepareCapture(tab, kind, reused) {
  if (reused) await chrome.tabs.reload(tab.id);
  await waitReady(tab.id);
  await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', files: ['content_scripts/wms_lingxing-recon.js'], injectImmediately: true});
  const deadline = Date.now() + 45000;
  let preparedAt = null;
  let captureVersion = 0;
  while (Date.now() < deadline) {
    const results = await chrome.scripting.executeScript({
      target: {tabId: tab.id}, world: 'MAIN', func: prepareLingxingPage,
      args: [kind, preparedAt === null],
    });
    const page = results[0]?.result;
    captureVersion = page?.captureVersion || captureVersion;
    if (page?.login) throw new Error('领星登录已失效，请登录领星后再点拉取。');
    if (page?.preparedAt != null) preparedAt = page.preparedAt;
    if (page?.capture && preparedAt !== null && page.capture.capturedAt >= preparedAt) {
      return page.capture;
    }
    await delay(500);
  }
  const label = kind === 'wfs' ? 'WFS库存' : 'Walmart WFS订单';
  throw new Error(label + '请求采集超时（采集脚本 v' + captureVersion + '）。请重新打开插件后重试。');
}

function isMissingTabError(error) {
  return /No tab with id|tab(?:\s+with\s+id)?[^\n]*(?:not found|does not exist|closed)|标签页不存在或已关闭/i.test(String(error?.message || error));
}

function isTargetTab(tab, url) {
  try {
    const actual = new URL(tab.url), expected = new URL(url);
    return actual.origin === expected.origin && actual.pathname === expected.pathname;
  } catch (_) { return false; }
}

async function ensureTargetTab(tab, url, active, label) {
  if (tab?.id != null) {
    try {
      const current = await chrome.tabs.get(tab.id);
      if (isTargetTab(current, url)) return {tab: current, reused: true};
    } catch (_) { /* 标签页已关闭，重新创建 */ }
  }
  try {
    return {tab: await chrome.tabs.create({url, active}), reused: false};
  } catch (error) {
    throw new Error(`无法打开${label}页面：${error?.message || error}`);
  }
}

async function prepareCaptureWithRecovery(tab, url, kind, reused, active, label, onTab) {
  try {
    return await prepareCapture(tab, kind, reused);
  } catch (error) {
    if (!isMissingTabError(error)) throw error;
    let tabStillExists = true;
    try { await chrome.tabs.get(tab.id); }
    catch (_) { tabStillExists = false; }
    if (tabStillExists) throw error;

    const replacement = await ensureTargetTab(null, url, active, label);
    onTab(replacement.tab);
    await delay(300);
    return prepareCapture(replacement.tab, kind, false);
  }
}

async function executeWfsPull(tab, templates, runId) {
  await chrome.scripting.executeScript({target: {tabId: tab.id}, files: ['content_scripts/wms_relay.js']});
  return chrome.scripting.executeScript({
    target: {tabId: tab.id}, world: 'MAIN', func: pullWalmartWfs,
    args: [templates, runId],
  });
}

// 重置页面查询以捕获当前会话模板；具体 Walmart / 平台发货条件由拉取函数强制设置。
function prepareLingxingPage(kind, prepare) {
  if (/\/login(?:\/|$)/i.test(location.pathname) ||
      Array.from(document.querySelectorAll('input[type="password"]')).some(el => el.getClientRects().length)) return {login: true};
  let preparedAt = null;
  if (prepare) {
    const reset = Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === '重置' && el.getClientRects().length);
    if (!reset) return {captureVersion: window.__iantoWfsCaptureVersion || 0};
    preparedAt = Date.now();
    reset.click();
  }
  const capture = window.__iantoWfsRequests?.[kind];
  return {preparedAt, captureVersion: window.__iantoWfsCaptureVersion || 0, capture: capture ? JSON.parse(JSON.stringify(capture)) : null};
}

async function handlePull() {
  if (activeRun) return;
  const run = {runId: crypto.randomUUID(), startedAt: Date.now(), tabId: null};
  activeRun = run;
  try {
    const pending = (await chrome.storage.local.get('pending_' + SYSTEM))['pending_' + SYSTEM];
    if (pending) {
      await reconcileDownload(pending.downloadId);
      const [item] = await chrome.downloads.search({id: pending.downloadId});
      if (item?.state === 'in_progress') {
        await saveRun(run, 'downloading', '上次数据仍在下载，请等待浏览器完成下载。');
        return;
      }
    }
    await saveRun(run, 'running', '正在自动打开领星 WFS库存与 Walmart订单列表…');
    const tabs = await chrome.tabs.query({});
    const stockCandidate = tabs.find(tab => isTargetTab(tab, WFS_URL));
    const ordersCandidate = tabs.find(tab => isTargetTab(tab, ORDERS_URL));
    let {tab: stockTab, reused: reuseStock} = await ensureTargetTab(stockCandidate, WFS_URL, true, 'WFS库存');
    if (!reuseStock) await delay(500); // 等待新标签页初始化
    run.tabId = stockTab.id;
    let {tab: ordersTab, reused: reuseOrders} = await ensureTargetTab(ordersCandidate, ORDERS_URL, false, '订单列表');
    if (!reuseOrders) await delay(500); // 等待新标签页初始化
    run.ordersTabId = ordersTab.id;
    try {
      await chrome.tabs.update(stockTab.id, {active: true});
    } catch (e) {
      if (!isMissingTabError(e)) throw new Error('无法激活 WFS库存页面：' + e.message);
      const replacement = await ensureTargetTab(null, WFS_URL, true, 'WFS库存');
      stockTab = replacement.tab;
      reuseStock = false;
      run.tabId = stockTab.id;
    }
    await saveRun(run, 'running', '正在准备 WFS库存及平台发货订单请求…');
    const prepared = await Promise.allSettled([
      prepareCaptureWithRecovery(stockTab, WFS_URL, 'wfs', reuseStock, true, 'WFS库存', tab => { stockTab = tab; run.tabId = tab.id; }),
      prepareCaptureWithRecovery(ordersTab, ORDERS_URL, 'orders', reuseOrders, false, '订单列表', tab => { ordersTab = tab; run.ordersTabId = tab.id; }),
    ]);
    const failures = prepared.filter(result => result.status === 'rejected');
    if (failures.length) throw new Error(failures.map(result => result.reason.message).join('；'));
    const templates = {wfs: prepared[0].value, orders: prepared[1].value};
    // 确保进度中转属于本次扩展实例；最终数据直接从脚本返回后台，不依赖网页消息下载。
    await saveRun(run, 'running', '开始拉取 WFS库存、库龄和 WFS订单销量…');
    let results;
    try {
      results = await executeWfsPull(stockTab, templates, run.runId);
    } catch (error) {
      if (!isMissingTabError(error)) throw error;
      let tabStillExists = true;
      try { await chrome.tabs.get(stockTab.id); }
      catch (_) { tabStillExists = false; }
      if (tabStillExists) throw error;

      const replacement = await ensureTargetTab(null, WFS_URL, true, 'WFS库存');
      stockTab = replacement.tab;
      run.tabId = stockTab.id;
      await delay(300);
      templates.wfs = await prepareCaptureWithRecovery(
        stockTab, WFS_URL, 'wfs', false, true, 'WFS库存',
        tab => { stockTab = tab; run.tabId = tab.id; },
      );
      await saveRun(run, 'running', 'WFS库存标签页已关闭，已重新打开并继续拉取…');
      results = await executeWfsPull(stockTab, templates, run.runId);
    }
    const result = results[0]?.result;
    if (!result?.ok) throw new Error(result?.error || '领星页面未返回完整数据。');
    await saveRun(run, 'downloading', '数据已拉取，正在保存到下载文件夹…');
    const bytes = new TextEncoder().encode(result.payload);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const downloadId = await chrome.downloads.download({
      url: 'data:application/json;base64,' + btoa(binary), filename: FILE,
      saveAs: false, conflictAction: 'overwrite',
    });
    await chrome.storage.local.set({['pending_' + SYSTEM]: {downloadId, run: {...run}, n: result.n, matched: result.matched}});
    await reconcileDownload(downloadId); // 小文件可能早于 onChanged 监听到待下载记录就已完成。
  } catch (error) {
    const message = '拉取失败：' + String(error?.message || error);
    await saveRun(run, 'error', message);
    await showOnTab(run.tabId, message);
    console.error('[Walmart WFS]', message);
  } finally {
    // 下载由顶层 onChanged 继续跟踪，即使 worker 重启也能恢复。
    if (activeRun === run) activeRun = null;
  }
}

async function reconcileDownload(id) {
  if (finishingDownloads.has(id)) return;
  finishingDownloads.add(id);
  try {
    const key = 'pending_' + SYSTEM;
    const pending = (await chrome.storage.local.get(key))[key];
    if (!pending || pending.downloadId !== id) return;
    const [item] = await chrome.downloads.search({id});
    if (item?.state === 'in_progress') return;
    const run = pending.run;
    if (item?.state === 'complete' && item.exists !== false) {
      const message = `拉取成功：WFS库存 ${pending.n.toLocaleString()} 条，匹配 MSKU销量 ${pending.matched.toLocaleString()} 条，已保存 ${FILE}。`;
      await chrome.storage.local.set({['last_' + SYSTEM]: {time: Date.now(), n: pending.n, matched: pending.matched, downloadId: id}});
      await saveRun(run, 'success', message);
      await showOnTab(run.tabId, message);
    } else {
      const message = '保存失败：' + (item?.error || (item?.exists === false ? '下载文件已不存在' : '未找到下载记录')) + '。请重新点拉取。';
      await saveRun(run, 'error', message);
      await showOnTab(run.tabId, message);
    }
    await chrome.storage.local.remove(key);
  } finally { finishingDownloads.delete(id); }
}

// 新弹窗检测到仍是旧后台时，点击“拉取”会先重新加载本扩展，再恢复这次点击。
async function recoverQueuedPull() {
  const store = await chrome.storage.local.get(['queued_ianto_wfs_pull', 'pending_' + SYSTEM]);
  const pending = store['pending_' + SYSTEM];
  if (pending) await reconcileDownload(pending.downloadId);
  if (store.queued_ianto_wfs_pull) {
    await chrome.storage.local.remove('queued_ianto_wfs_pull');
    if (Date.now() - store.queued_ianto_wfs_pull.time < 120000) await handlePull();
  }
}
recoverQueuedPull().catch(console.error);

// 在领星页面复用其 ERP / 官方网关请求。返回快照给后台，只在内存中使用请求头。
async function pullWalmartWfs(templates, runId) {
  const show = message => {
    let node = document.getElementById('ianto-wfs-pull-status');
    if (!node) {
      node = document.createElement('div'); node.id = 'ianto-wfs-pull-status';
      node.style.cssText = 'position:fixed;top:20px;right:20px;max-width:520px;background:#202631;color:#fff;padding:14px 20px;border-radius:8px;z-index:999999;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
      (document.body || document.documentElement).appendChild(node);
    }
    node.textContent = message;
    window.postMessage({source: 'iantoWfs', type: 'iantoWfsProgress', runId, message}, location.origin);
  };
  try {
    const headersFor = captured => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(captured.headers || {})) {
        if (/^(cookie|host|content-length|origin|referer|connection|user-agent|accept-encoding|sec-)/i.test(name)) continue;
        headers.set(name, value);
      }
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      return headers;
    };
    const getJson = async (url, captured, body) => {
      const endpoint = new URL(captured.url || 'https://gw.lingxingerp.com' + url);
      if (!['https://erp.lingxing.com', 'https://gw.lingxingerp.com'].includes(endpoint.origin) || endpoint.pathname !== url) {
        throw new Error('领星请求地址与预期接口不一致，已停止拉取。');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(endpoint.href, {method: 'POST', credentials: captured.credentials === 'include' ? 'include' : 'same-origin', headers: headersFor(captured), body: JSON.stringify(body), signal: controller.signal});
        if (!response.ok) throw new Error('领星接口 HTTP ' + response.status);
        const json = await response.json();
        if (json.code != null && ![0, 1, 200, '0', '1', '200'].includes(json.code)) throw new Error('领星返回错误：' + (json.msg || json.code));
        if (json.data == null) throw new Error('领星接口没有返回 data。');
        return json.data;
      } finally { clearTimeout(timer); }
    };
    const allPages = async ({captured, endpoint, makeBody, readPage, label}) => {
      const rows = [], seenPages = new Set();
      let total = null, pageIndex = 1, syncTime = null;
      while (total === null || rows.length < total) {
        const data = await getJson(endpoint, captured, makeBody(pageIndex));
        const page = readPage(data), items = page.items;
        if (!Array.isArray(items) || page.total == null || !Number.isInteger(Number(page.total)) || Number(page.total) < 0) throw new Error(label + '分页响应格式异常。');
        if (!syncTime) syncTime = data.syncTime || data.page?.syncTime || null;
        if (total === null) total = Number(page.total);
        else if (Number(page.total) !== total) throw new Error(label + '拉取过程中总条数变化，快照未保存。');
        if (!items.length && rows.length < total) throw new Error(label + '分页提前结束，快照未保存。');
        const signature = JSON.stringify(items);
        if (items.length && seenPages.has(signature)) throw new Error(label + '返回了重复页，快照未保存。');
        seenPages.add(signature);
        rows.push(...items);
        if (rows.length > total) throw new Error(label + '分页条数异常，快照未保存。');
        show(`${label}拉取中：${rows.length.toLocaleString()} / ${total.toLocaleString()}`);
        if (rows.length >= total) break;
        if (++pageIndex > 500) throw new Error(label + '页数超过上限。');
      }
      return {rows, total, syncTime};
    };
    const stockTemplate = JSON.parse(templates.wfs.body);
    const orderTemplate = JSON.parse(templates.orders.body);
    const stockResult = await allPages({
      captured: templates.wfs, endpoint: '/mp-platform-warehouse-api/api/walmart/walmartStockSearchV2',
      makeBody: page => ({...stockTemplate, current: page, size: 100}),
      readPage: data => ({items: data.page?.records, total: data.page?.total}), label: 'WFS库存',
    });
    const stockFields = ['storeId','warehouseUniqueId','warehouseName','msku','gtin','productUniqueId','itemId','productName','sku','platformProductStatus','quantity','availableQuantityV2','availableQuantity','inboundQuantity','unabledWarehousingQuantity','ats03Months','ats36Months','ats69Months','ats912Months','ats1Years'];
    const slim = (row, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
    // Walmart 的 MSKU区分大小写；真实库存存在仅大小写不同、商品ID也不同的链接。
    const listingKey = (store, msku) => `${String(store ?? '').trim()}\u0000${String(msku ?? '').trim()}`;
    const stockRows = stockResult.rows.map(row => slim(row, stockFields));
    const storeIds = [...new Set(stockRows.map(row => String(row.storeId ?? '').trim()))];
    if (storeIds.some(id => !id)) throw new Error('WFS库存缺少店铺标识，快照未保存。');
    // 店铺目录只用于确认站点；不保留账号、买家、地址或订单明细。
    const shopPath = '/pb-mp-shop/api/getAllPlatformShopList';
    const shopCapture = {...templates.orders, url: new URL(shopPath, templates.orders.url || 'https://gw.lingxingerp.com').href};
    const shops = storeIds.length ? await getJson(shopPath, shopCapture, {uid: orderTemplate.uid, codeTo1: 1}) : [];
    if (!Array.isArray(shops)) throw new Error('领星店铺目录格式异常。');
    const shopsById = new Map(shops.map(shop => [String(shop.store_id), shop]));
    // 当前 WFS库存涉及的美国站，已用订单站点时间（-08:00）核对；其他站点未经核实不套用美国时区。
    const siteTimeZones = {'10008-US': 'America/Los_Angeles'};
    const siteStores = new Map();
    for (const storeId of storeIds) {
      const shop = shopsById.get(storeId);
      if (!shop || String(shop.platform_code) !== '10008') throw new Error('WFS店铺未在 Walmart店铺目录中找到，快照未保存。');
      if (!siteTimeZones[shop.site_code]) throw new Error('尚未核实站点 ' + shop.site_code + ' 的销量日界线，快照未保存。');
      if (!siteStores.has(shop.site_code)) siteStores.set(shop.site_code, []);
      siteStores.get(shop.site_code).push(storeId);
    }
    const shiftDate = (day, offset) => {
      const date = new Date(day + 'T12:00:00Z');
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const capturedNow = new Date();
    const windows = [];
    const quantities = new Map();
    const seenOrders = new Set();
    let queriedOrders = 0, eligibleOrders = 0, excludedOrders = 0, excludedItems = 0;
    const isExcluded = (...states) => states.some(state => /CANCEL|REFUND/.test(String(state || '').toUpperCase()));
    const orderPath = '/stats-web-order/order/platform/list';
    // 订单是实时列表，缓冲日期内的新增订单会改变总数和分页边界。
    // 按订单标识去重，并要求统计期内的订单/商品数量/状态连续两轮一致。
    // 不比较买家、物流等无关字段，也不让不计销量的站点今天阻断历史销量。
    const stableOrders = async (makeBody, permittedStores, start30, endDate) => {
      let previous = null;
      for (let pass = 1; pass <= 4; pass++) {
        const rows = new Map(), signatures = new Map(), pages = new Set();
        let maximumTotal = 0, firstTotal = null, totalChanged = false, changedWithinScan = false;
        for (let pageNum = 1; ; pageNum++) {
          if (pageNum > 500) throw new Error('Walmart WFS订单页数超过上限。');
          const body = makeBody(pageNum);
          const data = await getJson(orderPath, templates.orders, body);
          if (!Array.isArray(data.list) || data.total == null || !Number.isInteger(Number(data.total)) || Number(data.total) < 0 || data.list.length > body.pageSize) {
            throw new Error('Walmart WFS订单分页响应格式异常。');
          }
          if (firstTotal === null) firstTotal = Number(data.total);
          else if (Number(data.total) !== firstTotal) totalChanged = true;
          maximumTotal = Math.max(maximumTotal, Number(data.total));
          const inPage = new Set(), pageKeys = [];
          for (const order of data.list) {
            const storeId = String(order.storeId ?? '').trim();
            if (String(order.platformCode) !== '10008' || order.fulfilmentType !== 'FulfillByPlatform' || !permittedStores.has(storeId)) {
              throw new Error('订单接口返回了非指定店铺的 Walmart平台发货订单，快照未保存。');
            }
            const orderId = order.orderUniqueKey || order.platformOrderNo;
            if (!orderId) throw new Error('WFS订单缺少唯一标识，无法校验重复订单。');
            const key = storeId + '\u0000' + orderId;
            if (inPage.has(key)) throw new Error('WFS订单同页重复，快照未保存。');
            inPage.add(key); pageKeys.push(key);
            const day = String(order.purchaseDateLocale || order.purchaseTimeLocale || '').slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('WFS订单缺少站点下单日期，快照未保存。');
            if (day >= start30 && day <= endDate) {
              const items = Array.isArray(order.itemList) ? order.itemList.map(item => JSON.stringify([
                item.platformOrderItemNo, item.platformMsku || item.platformMskuId,
                item.purchaseQuantity, item.srcPlatformItemStatus, item.stdItemStatusCode,
              ])).sort() : null;
              const signature = JSON.stringify([day, order.srcPlatformOrderStatus, order.stdOrderStatusCode, items]);
              if (signatures.has(key) && signatures.get(key) !== signature) changedWithinScan = true;
              signatures.set(key, signature);
            }
            // 跨页边界移动导致的同一订单只统计一次。
            rows.set(key, order);
          }
          const pageSignature = JSON.stringify(pageKeys);
          if (data.list.length && pages.has(pageSignature)) throw new Error('Walmart WFS订单返回了重复页，快照未保存。');
          pages.add(pageSignature);
          const reached = (pageNum - 1) * body.pageSize + data.list.length;
          // 短页早于已观察到的总数，可能删除/重排了订单，不能作为稳定的一轮。
          if (data.list.length < body.pageSize && reached < Number(data.total)) changedWithinScan = true;
          show(`Walmart WFS订单核验 ${pass}/4：${rows.size.toLocaleString()} / ${Number(data.total).toLocaleString()}`);
          if (pageNum * body.pageSize >= maximumTotal) break;
        }
        // 总数没变却缺少唯一订单，不能把重复/漏页误认为完整的一轮。
        if (!totalChanged && rows.size !== maximumTotal) changedWithinScan = true;
        if (!changedWithinScan && previous && signatures.size === previous.size &&
            [...signatures].every(([key, value]) => previous.get(key) === value)) {
          return {rows: [...rows.values()], total: rows.size, passes: pass};
        }
        previous = changedWithinScan ? null : signatures;
        show('正在复核统计期内的 WFS订单，确认没有因分页变化漏计或重复…');
      }
      throw new Error('WFS历史订单仍在更新，4轮核验未能连续一致，未覆盖上次快照。请稍后重试。');
    };
    const orderChecks = [];
    for (const [siteCode, siteStoreIds] of siteStores) {
      const timeZone = siteTimeZones[siteCode];
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(capturedNow).map(part => [part.type, part.value]));
      const today = `${parts.year}-${parts.month}-${parts.day}`;
      const endDate = shiftDate(today, -1), start30 = shiftDate(today, -30), start7 = shiftDate(today, -7);
      windows.push({site_code: siteCode, time_zone: timeZone, start_7d: start7, start_30d: start30, end_date: endDate});
      const permittedStores = new Set(siteStoreIds);
      const orders = await stableOrders(
        page => ({...orderTemplate, platformCodeList: ['10008'], deliveryTypeList: [1],
          storeIdList: siteStoreIds, siteCodeList: [siteCode], statusList: [], orderPromotionType: '',
          dateType: 1, startDate: shiftDate(start30, -1), endDate: today,
          searchType: 1, searchSingleValue: '', searchMultiValue: [], pageNum: page, pageSize: 200}),
        permittedStores, start30, endDate,
      );
      orderChecks.push({site_code: siteCode, passes: orders.passes});
      queriedOrders += orders.total;
      for (const order of orders.rows) {
        const storeId = String(order.storeId ?? '').trim();
        if (String(order.platformCode) !== '10008' || order.fulfilmentType !== 'FulfillByPlatform' || !permittedStores.has(storeId)) {
          throw new Error('订单接口返回了非指定店铺的 Walmart平台发货订单，快照未保存。');
        }
        const orderId = order.orderUniqueKey || order.platformOrderNo;
        if (!orderId) throw new Error('WFS订单缺少唯一标识，无法校验重复订单。');
        const orderKey = storeId + '\u0000' + orderId;
        if (seenOrders.has(orderKey)) throw new Error('WFS订单跨页重复，快照未保存。');
        seenOrders.add(orderKey);
        const day = String(order.purchaseDateLocale || order.purchaseTimeLocale || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('WFS订单缺少站点下单日期，快照未保存。');
        // 请求前后各覆盖一天，再以站点日期精确截取，避免接口日界线差异漏掉边界订单。
        if (day < start30 || day > endDate) continue;
        if (isExcluded(order.srcPlatformOrderStatus, order.stdOrderStatusCode)) { excludedOrders++; continue; }
        if (!Array.isArray(order.itemList) || !order.itemList.length) throw new Error('WFS订单缺少商品行，快照未保存。');
        eligibleOrders++;
        const seenItems = new Set();
        for (const item of order.itemList) {
          if (isExcluded(item.srcPlatformItemStatus, item.stdItemStatusCode)) { excludedItems++; continue; }
          const msku = String(item.platformMsku || item.platformMskuId || '').trim();
          if (!msku) throw new Error('WFS订单商品行缺少 MSKU，快照未保存。');
          const itemNo = item.platformOrderItemNo;
          if (itemNo == null || seenItems.has(String(itemNo))) throw new Error('WFS订单商品行缺少唯一编号或重复，快照未保存。');
          seenItems.add(String(itemNo));
          if (item.purchaseQuantity == null || item.purchaseQuantity === '') throw new Error('WFS订单商品行缺少数量，快照未保存。');
          const quantity = Number(item.purchaseQuantity);
          if (!Number.isInteger(quantity) || quantity < 0) throw new Error('WFS订单商品数量异常，快照未保存。');
          const key = listingKey(storeId, msku);
          const value = quantities.get(key) || {sales7d: 0, sales30d: 0};
          value.sales30d += quantity;
          if (day >= start7) value.sales7d += quantity;
          quantities.set(key, value);
        }
      }
    }
    const listings = new Map();
    const stockNumber = value => {
      const number = Number(value ?? 0);
      if (!Number.isFinite(number)) throw new Error('WFS库存数量异常。');
      return number;
    };
    for (const row of stockRows) {
      if (!String(row.msku || '').trim()) throw new Error('WFS库存缺少 MSKU，快照未保存。');
      const key = listingKey(row.storeId, row.msku);
      const itemId = String(row.itemId ?? '').trim();
      const listing = listings.get(key);
      if (listing && listing.platform_product_id !== itemId) throw new Error('相同店铺＋MSKU对应多个商品ID，无法安全分配 WFS销量。');
      const value = listing || {sid: String(row.storeId).trim(), seller_sku_id: row.msku, platform_product_id: itemId,
        site_code: shopsById.get(String(row.storeId).trim()).site_code, local_sku: row.sku || '', wfs_available: 0, wfs_total: 0};
      const available = row.availableQuantityV2 == null || row.availableQuantityV2 === '' ? row.availableQuantity : row.availableQuantityV2;
      value.wfs_available += stockNumber(available);
      value.wfs_total += stockNumber(row.quantity);
      listings.set(key, value);
    }
    const salesRows = Array.from(listings, ([key, listing]) => {
      const {sales7d, sales30d} = quantities.get(key) || {sales7d: 0, sales30d: 0};
      const avg_sales7d = sales7d / 7, avg_sales30d = sales30d / 30;
      const daily = avg_sales7d > 0 ? avg_sales7d : avg_sales30d;
      return {...listing, sales7d, sales30d, avg_sales7d, avg_sales30d, sales_qty: sales30d,
        wfs_available_days: daily > 0 ? listing.wfs_available / daily : null};
    });
    const payload = JSON.stringify({
      source: 'lingxing_walmart_wfs', version: 1, captured_at: new Date().toISOString(),
      stock_sync_time: stockResult.syncTime,
      sales_period: {start_date: windows[0]?.start_30d || null, end_date: windows[0]?.end_date || null},
      sales_scope: {type: 'WFS_ONLY', source: orderPath, platform_code: '10008', delivery_type: 1,
        fulfilment_type: 'FulfillByPlatform', msku_case_sensitive: true, date_type: 'purchaseDateLocale', exclude_site_today: true,
        excluded_statuses: ['Cancelled', 'Refund'], windows, days_basis: 'WFS_7d_else_30d',
        pagination_validation: 'two_matching_complete_period_scans', order_checks: orderChecks},
      totals: {stock_rows: stockResult.total, sales_rows: salesRows.length, matched_sales_rows: salesRows.length,
        queried_wfs_orders: queriedOrders, eligible_wfs_orders: eligibleOrders, excluded_orders: excludedOrders, excluded_items: excludedItems},
      stock_rows: stockRows, sales_rows: salesRows,
    });
    show('数据校验通过，正在保存快照…');
    return {ok: true, payload, n: stockRows.length, matched: salesRows.length};
  } catch (error) {
    return {ok: false, error: error?.name === 'AbortError' ? '领星接口请求超时，请重试。' : String(error?.message || error)};
  }
}
