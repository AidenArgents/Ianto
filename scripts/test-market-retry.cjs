const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dataModule = require('../market_capture/data.js');
const tableModule = require('../market_capture/table.js');
const headerModule = require('../market_capture/headers.js');
const source = fs.readFileSync(path.join(__dirname, '../market_capture/direct.js'), 'utf8');
const prefix = 'ianto_market_v1_';
function memory(initial = {}) {
  const data = structuredClone(initial);
  return {data,
    async get(keys) { return structuredClone(keys === null ? data : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]))); },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }
  };
}
function batch(id, state) {
  const row = {id, title: 'Fixture fan', captureMethod: '详情页单品', capturedAt: '2026-10-23T08:00:00.000Z', url: 'https://example.test/product/' + id, image: 'https://example.test/' + id + '.jpg'};
  const saved = state !== 'text-pending';
  return {batch: {batchId: id, records: [row]}, createdAt: row.capturedAt, attempted: true, nextAttempt: Date.now() + 600000,
    receipts: saved ? [{id, recordId: 'rec-' + id}] : null,
    images: saved ? [{id, recordId: 'rec-' + id, url: row.image, title: row.title, productUrl: row.url, status: state, attempts: state === 'failed' ? 3 : 1, nextAttempt: Date.now() + 600000, error: state === 'saved' ? '' : 'fixture error'}] : []};
}
async function fixture(jobs, hooks = {}) {
  const state = {};
  state[prefix + 'index'] = jobs.map(j => ({batchId: j.batch.batchId, status: j.receipts ? 'saved' : 'pending', count: 1, at: j.createdAt, images: {total: j.images.length, pending: j.images.filter(i => i.status === 'pending').length, failed: j.images.filter(i => i.status === 'failed').length, saved: j.images.filter(i => i.status === 'saved').length}}));
  for (const j of jobs) state[prefix + 'batch_' + j.batch.batchId] = j;
  const storage = memory(state), calls = {writes: [], uploads: [], reads: [], attaches: []}, remoteImages = new Map();
  for (const j of jobs) for (const i of j.images) if (i.status === 'saved') remoteImages.set(i.recordId, 'already-saved');
  class FeishuClient {
    tablePath(){return '/fixture';}
    async request(){return {items:dataModule.FIELDS.map((f,i)=>({...f,field_id:'fld'+i}))};}
    setSchema(info){this.schema=info;}
    async writeBatch(batch, options) { calls.writes.push({ids: batch.records.map(r => r.id), ...options}); return batch.records.map(r => ({id: r.id, recordId: 'rec-' + r.id})); }
    async readImage(id) { calls.reads.push(id); return remoteImages.get(id) || null; }
    async uploadImage(url) { calls.uploads.push(url); if (hooks.upload) await hooks.upload(); return 'token-' + url; }
    async attachImage(id, token) { calls.attaches.push(id); remoteImages.set(id, token); }
  }
  const context = {IantoMarketData: dataModule, IantoMarketTable:tableModule, IantoMarketHeaders:headerModule, IantoMarketFeishu: {FeishuClient}, crypto, fetch, URL};
  vm.runInNewContext(source, context);
  const direct = context.IantoMarketDirect.create({storage, tokenStorage: memory()});
  await direct.configure({appId: 'cli_fixture', appSecret: 'fixture-secret', appToken: 'baseFixture', tableId: 'tblFixture'});
  return {direct, storage, calls};
}

test('一次补传覆盖等待中的商品、等待中的首图和失败首图，成功内容不重复上传', async () => {
  const jobs = [batch('text', 'text-pending'), batch('delayed', 'pending'), batch('failed', 'failed'), batch('done', 'saved')];
  const {direct, storage, calls} = await fixture(jobs);
  const completed = structuredClone(storage.data[prefix + 'batch_done']);
  const remaining = await direct.prepareRetry();
  assert.equal(remaining.products, 1);
  assert.equal(remaining.images, 2);
  for (const id of ['delayed', 'failed']) {
    const image = storage.data[prefix + 'batch_' + id].images[0];
    assert.equal(image.status, 'pending');
    assert.equal(image.nextAttempt, 0);
    assert.equal(image.attempts, 0);
  }
  await direct.resume(true);
  assert.deepEqual(calls.writes, [{ids: ['text'], reconcile: true}]);
  assert.deepEqual(calls.attaches.sort(), ['rec-delayed', 'rec-failed', 'rec-text']);
  assert.equal(calls.uploads.length, 3);
  assert.deepEqual(storage.data[prefix + 'batch_done'], completed);
  const status = await direct.status();
  assert.equal(status.pendingCount, 0);
  assert.equal(status.images.saved, 4);
  assert.equal(status.images.failed, 0);
  const again = await direct.prepareRetry();
  assert.equal(again.products + again.images, 0);
  await direct.resume(true);
  assert.equal(calls.writes.length, 1);
  assert.equal(calls.uploads.length, 3);
});

test('补传期间再次排队不重置正在上传的图片，也不会重复上传', async () => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const uploading = new Promise(resolve => { started = resolve; });
  const j = batch('active', 'pending');j.images[0].nextAttempt = 0;
  const {direct, storage, calls} = await fixture([j], {upload: async () => { started(); await gate; }});
  const work = direct.syncImages();
  await uploading;
  try {
    const before = structuredClone(storage.data[prefix + 'batch_active'].images[0]);
    assert.equal((await direct.prepareRetry()).images, 1);
    assert.deepEqual(storage.data[prefix + 'batch_active'].images[0], before);
  } finally { release(); await work; }
  assert.equal(calls.uploads.length, 1);
  assert.equal((await direct.status()).images.saved, 1);
});

test('后台合并补传：先准备全部未完成内容再立即续传；刷新状态只读取', async () => {
  let listener, remaining = {products: 1, images: 2};
  const calls = [];
  const chrome = {runtime: {getURL: p => 'chrome-extension://fixture/' + p, onMessage: {addListener(fn) { listener = fn; }}, onStartup: {addListener() {}}, onInstalled: {addListener() {}}}, storage: {local: memory(), session: memory()}, tabs: {onRemoved: {addListener() {}}}, alarms: {onAlarm: {addListener() {}}, create() {}}};
  const direct = {syncHeaders:async()=>{},resume: async force => { calls.push(['resume', force]); }, prepareRetry: async () => { calls.push(['prepare']); return remaining; }, getRemoteStatus: async () => { calls.push(['read']); return {ok: true, count: 0}; }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../market_capture/background.js'), 'utf8'), {chrome, URL, console, importScripts() {}, IantoMarketCore: {}, IantoMarketDirect: {create: () => direct}});
  calls.length = 0;
  const send = (type, sender = {url: 'chrome-extension://fixture/market_capture/settings.html'}) => new Promise(resolve => listener({namespace: 'iantoMarket', type}, sender, resolve));
  assert.equal((await send('retryIncomplete')).started, true);
  assert.deepEqual(calls, [['prepare'], ['resume', true]]);
  calls.length = 0;
  assert.equal((await send('getRemoteStatus')).remote.count, 0);
  assert.deepEqual(calls, [['read']]);
  calls.length = 0;remaining = {products: 0, images: 0};
  assert.equal((await send('retryIncomplete')).started, false);
  assert.deepEqual(calls, [['prepare']]);
  calls.length = 0;
  assert.equal((await send('retryIncomplete', {url: 'https://example.test/product', tab: {id: 1}})).ok, false);
  assert.deepEqual(calls, []);
});
