const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('../market_capture/data.js');
require('../market_capture/feishu.js');
const {create} = require('../market_capture/direct.js');

const prefix = 'ianto_market_v1_';
const key = name => prefix + name;
function memory(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys === null) return structuredClone(data);
      return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])));
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]; }
  };
}
function fixture(initial) {
  const storage = memory(initial);
  let requests = 0;
  const reopen = () => create({storage, tokenStorage: memory(), fetcher: async () => {
    requests++;
    throw Error('History operations must not access Feishu');
  }});
  return {storage, direct: reopen(), reopen, requests: () => requests};
}
function entry(batchId, status = 'saved') {
  return {batchId, status, count: 1, at: '2026-10-23T08:00:00.000Z', title: 'Fan', method: '搜索页整理', images: {total: 0, saved: 0, pending: 0, failed: 0}};
}
function job(batchId, saved = true) {
  return {batch: {batchId, records: [{title: 'Fan'}]}, receipts: saved ? [{id: batchId, recordId: 'recFixture'}] : null, images: []};
}

test('最后一条采集历史可以删除，重开后保持为空', async () => {
  const id = 'final-item';
  const {direct, storage, reopen, requests} = fixture({[key('index')]: [entry(id)], [key('batch_' + id)]: job(id)});
  assert.equal((await direct.status()).history.length, 1);
  await direct.deleteBatch(id);
  assert.deepEqual(storage.data[key('index')], []);
  assert.equal(storage.data[key('batch_' + id)], undefined);
  assert.deepEqual((await reopen().status()).history, []);
  await direct.deleteBatch(id);
  assert.equal((await direct.status()).saved, 0);
  assert.equal(requests(), 0);
});

test('删除一次同时移除索引和完整快照，其他采集保持不变', async () => {
  const id = '11111111-1111-4111-a111-111111111111';
  const other = 'another-capture';
  const {direct, storage, reopen} = fixture({
    [key('index')]: [entry(id), entry(other)],
    [key('batch_' + id)]: job(id),
    [key('batch_' + other)]: job(other)
  });
  await direct.deleteBatch(id);
  assert.equal(storage.data[key('batch_' + id)], undefined);
  assert.deepEqual(storage.data[key('index')], [entry(other)]);
  assert.deepEqual(storage.data[key('batch_' + other)], job(other));
  assert.deepEqual((await reopen().status()).history.map(e => e.batchId), [other]);
});

test('清空覆盖未显示的历史及完成缓存，保留待同步任务、配置和 Ianto 其他数据', async () => {
  const saved = Array.from({length: 55}, (_, n) => entry('saved-' + n));
  const pending = entry('pending-task', 'pending');
  const initial = {
    [key('index')]: [...saved, pending],
    [key('credentials')]: {appId: 'cli_fixture', appSecret: 'fixture-secret'},
    [key('connection')]: {connected: true},
    [key('settings')]: {enabled: true},
    [key('exportLayout')]: {fields: ['商品标题']},
    [key('batch_pending-task')]: job('pending-task', false),
    [key('batch_orphan-completed')]: job('orphan-completed'),
    [key('batch_orphan-unsynced')]: job('orphan-unsynced', false),
    originalIantoPreference: {country: 'MX'}
  };
  for (const e of saved) initial[key('batch_' + e.batchId)] = job(e.batchId);
  const {direct, storage, reopen, requests} = fixture(initial);
  assert.equal((await direct.status()).history.length, 50);
  const result = await direct.clearHistory();
  assert.equal(result.cleared, 56);
  assert.equal(result.remainingPending, 1);
  assert.deepEqual(storage.data[key('index')], [pending]);
  for (const e of saved) assert.equal(storage.data[key('batch_' + e.batchId)], undefined);
  assert.equal(storage.data[key('batch_orphan-completed')], undefined);
  for (const name of ['credentials', 'connection', 'settings', 'exportLayout', 'batch_pending-task', 'batch_orphan-unsynced']) {
    assert.deepEqual(storage.data[key(name)], initial[key(name)]);
  }
  assert.deepEqual(storage.data.originalIantoPreference, initial.originalIantoPreference);
  const state = await reopen().status();
  assert.deepEqual(state.history, []);
  assert.equal(state.saved, 0);
  assert.equal(state.pendingCount, 1);
  assert.equal(requests(), 0);
  assert.equal((await direct.clearHistory()).cleared, 0);
});

test('空白存储不会在启动时被写入，反复清空及重开保持为空', async () => {
  const {direct, storage, reopen} = fixture();
  assert.deepEqual((await direct.status()).history, []);
  assert.deepEqual(storage.data, {});
  assert.equal((await direct.clearHistory()).cleared, 0);
  assert.deepEqual((await reopen().status()).history, []);
  assert.deepEqual(storage.data[key('index')], []);
  assert.equal((await direct.clearHistory()).cleared, 0);
});

test('清空操作只接受 Ianto 扩展页面请求，商品网页无法清空历史', async () => {
  let listener, clears = 0;
  const chrome = {
    runtime: {getURL: p => 'chrome-extension://fixture/' + p, onMessage: {addListener(fn) { listener = fn; }}, onStartup: {addListener() {}}, onInstalled: {addListener() {}}},
    storage: {local: memory(), session: memory()},
    tabs: {onRemoved: {addListener() {}}},
    alarms: {onAlarm: {addListener() {}}, create() {}}
  };
  const direct = {syncHeaders:async()=>{},resume: async () => {}, clearHistory: async () => { clears++; return {cleared: 2, remainingPending: 0}; }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../market_capture/background.js'), 'utf8'), {chrome, URL, console, importScripts() {}, IantoMarketCore: {}, IantoMarketDirect: {create: () => direct}});
  const send = sender => new Promise(resolve => listener({namespace: 'iantoMarket', type: 'clearHistory'}, sender, resolve));
  assert.equal((await send({url: 'https://www.amazon.com.mx/s?k=fan', tab: {id: 1}})).ok, false);
  assert.equal(clears, 0);
  const response = await send({url: 'chrome-extension://fixture/market_capture/settings.html'});
  assert.equal(response.ok, true);
  assert.equal(response.cleared, 2);
  assert.equal(clears, 1);
});
