(function(root){'use strict';
const TEXT_FIELDS = {
  title: '商品标题', platform: '销售平台', source: '数据来源', country: '国家',
  productId: '平台商品ID', url: '商品链接', image: '主图链接',
  currency: '币种', priceText: '价格原文', shop: '店铺', brand: '品牌',
  variant: '当前规格', availability: '库存展示', shipping: '配送展示',
  salesText: '销量原文', ratingText: '评分原文', reviewsText: '评价原文',
  attributes: '商品属性', query: '实际搜索词', querySource: '搜索词依据',
  originalQuery: 'Ianto原始输入词', searchUrl: '搜索页链接',
  sort: '排序原文', filters: '筛选条件', ad: '广告标记',
  captureMethod: '采集方式', topic: '调研主题', researchId: '调研编号',
  batchId: '采集批次', sourceBatchId: '来源搜索批次',
  id: '采集编号', note: '备注', completeness: '字段说明',developmentOpinion:'开发意见'
};
const FIELDS = [
  ...Object.values(TEXT_FIELDS).map(field_name => ({ field_name, type: 1 })),
  { field_name: '首图', type: 17 },
  { field_name: '采集时间', type: 5 }, { field_name: '搜索观察时间', type: 5 },
  { field_name: '展示价格', type: 2, property: { formatter: '0.00' } },
  { field_name: '页码', type: 2 }, { field_name: '本页位置', type: 2 }
];
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_RECORDS = 10000, MAX_BATCH_SIZE = 12 * 1024 * 1024;
function normalizeBatch(input) {
  if (!input || !UUID.test(input.batchId || '')) throw fail('无效的采集批次');
  if (!Array.isArray(input.records) || !input.records.length || input.records.length > MAX_RECORDS) throw fail(`一次整理需要 1 至 ${MAX_RECORDS} 条商品记录`);
  const seen = new Set();
  const records = input.records.map(raw => {
    if (!raw || !UUID.test(raw.id || '') || seen.has(raw.id)) throw fail('采集编号无效或重复');
    seen.add(raw.id);
    const row = {};
    for (const key of Object.keys(TEXT_FIELDS)) {
      const value = raw[key];
      if (value !== undefined && value !== null && typeof value !== 'string') throw fail(`字段 ${key} 应为文字`);
      row[key] = (value || '').slice(0, key === 'developmentOpinion' ? 20000 : key === 'attributes' ? 12000 : 6000);
    }
    row.batchId = input.batchId;
    let url; try { url = new URL(row.url); } catch { throw fail('商品链接无效'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw fail('仅支持网页商品链接');
    if (!row.title.trim() || !row.platform) throw fail('商品标题和平台不能为空');
    if (!['详情页单品', '搜索页整理'].includes(row.captureMethod)) throw fail('采集方式无效');
    row.capturedAt = raw.capturedAt;
    if (!Number.isFinite(Date.parse(row.capturedAt))) throw fail('采集时间无效');
    row.observedAt = raw.observedAt || '';
    if (row.observedAt && !Number.isFinite(Date.parse(row.observedAt))) throw fail('搜索观察时间无效');
    for (const key of ['price', 'page', 'position']) {
      const value = raw[key];
      if (value !== undefined && value !== null && (!Number.isFinite(value) || value < 0 || (key !== 'price' && (!Number.isInteger(value) || value < 1)))) throw fail(`字段 ${key} 无效`);
      row[key] = value ?? null;
    }
    return row;
  });
  return { batchId: input.batchId, records };
}
function encodeRecord(row) {
  const fields = {};
  for (const [key, name] of Object.entries(TEXT_FIELDS)) if (row[key]) fields[name] = row[key];
  if (row.imageToken) fields['首图'] = [{ file_token: row.imageToken }];
  fields['采集时间'] = Date.parse(row.capturedAt);
  if (row.observedAt) fields['搜索观察时间'] = Date.parse(row.observedAt);
  for (const [key,name] of [['price','展示价格'],['page','页码'],['position','本页位置']]) if (row[key] !== null && row[key] !== undefined) fields[name] = row[key];
  return fields;
}

root.IantoMarketData={TEXT_FIELDS,FIELDS,fail,normalizeBatch,encodeRecord,MAX_RECORDS,MAX_BATCH_SIZE};
if(typeof module==='object'&&module.exports)module.exports=root.IantoMarketData;
})(globalThis);
