const test=require('node:test'),assert=require('node:assert/strict'),A=require('../market_capture/analytics.js');
const record=(id,extra={})=>({id,title:'Product '+id,productId:id,batchId:'b1',capturedAt:'2026-10-23T12:00:00Z',query:'Café',originalQuery:'cafe',country:'MX',platform:'Amazon',source:'Amazon',currency:'MXN',price:100,...extra});
test('关键词格式统一，但不自动吞掉重音、词义或原始词',()=>{
  const rows=A.normalize([record('1',{query:' CAFÉ  ' }),record('2',{query:'Cafe\u0301'}),record('3',{query:'Cafe'}),record('4',{query:'便携 风扇'}),record('5',{query:''})]);
  assert.equal(rows[0].wordKey,rows[1].wordKey);assert.notEqual(rows[1].wordKey,rows[2].wordKey);assert.equal(rows[4].keywordFallback,true);assert.equal(rows[0].query,'CAFÉ');assert.equal(rows[0].originalQuery,'cafe');
  assert.equal(A.groups(rows,['keyword']).length,3);
});
test('这一批支持北京时间两端日期、任意批次及明确空选，不依赖72小时自动窗口',()=>{
  const rows=A.normalize([record('1',{capturedAt:'2026-10-22T16:00:00Z'}),record('2',{capturedAt:'2026-10-23T15:59:59Z',batchId:'b2'}),record('3',{capturedAt:'2026-10-23T16:00:00Z'})]);
  assert.equal(A.filter(rows,{scope:{from:'2026-10-23',to:'2026-10-23'}}).length,2);assert.equal(A.filter(rows,{scope:{batchIds:[]}}).length,0);assert.deepEqual(A.filter(rows,{scope:{batchIds:['b2']}}).map(r=>r.id),['2']);
});
test('同维度多选OR，跨产品、关键词、国家、平台AND；图表分组保留所有维度',()=>{
  const rows=A.normalize([record('1'),record('2',{query:'Fan',platform:'Shopee',country:'BR',currency:'BRL'}),record('3',{query:'Candle',country:'BR'}),record('4',{query:'FAN',platform:'Mercado Libre',country:'BR',currency:'BRL'})]);
  const products=[{id:'p1',name:'风扇',keywords:['café','fan']},{id:'p2',name:'蜡烛模具',keywords:['candle']}],state={filters:{product:['p1'],keyword:['fan','café'],country:['BR'],platform:['Shopee','Mercado Libre']}};
  const filtered=A.filter(rows,state,products);assert.equal(filtered.length,2);assert.equal(A.groups(filtered,['product','keyword','country','platform'],products).length,2);
  assert.equal(A.facets(rows,state,products,'country').find(v=>v.value==='MX'),undefined);state.filters.platform.push('Amazon');assert.equal(A.facets(rows,state,products,'country').find(v=>v.value==='MX').count,1);
});
test('商品在每组内取最新观测，跨关键词保留成员关系，国家和规格不会误去重',()=>{
  const rows=A.normalize([record('1',{query:'Fan'}),record('new',{productId:'1',query:'FAN',capturedAt:'2026-10-24T01:00:00Z',price:80}),record('other-word',{productId:'1',query:'Pocket Fan'}),record('other-country',{productId:'1',country:'BR'}),record('variant',{productId:'1',variant:'blue'})]);
  assert.equal(A.dedupe(rows).length,3);assert.equal(A.dedupe(rows).find(r=>r.productId==='1'&&r.country==='MX'&&!r.variant).price,80);
  const groups=A.groups(rows,['keyword']);assert.equal(groups.length,3);assert.ok(groups.reduce((s,g)=>s+g.summary.products,0)>A.dedupe(rows).length);assert.equal(A.dedupe(rows,'observations').length,5);
});
test('币种独立统计，缺失价格和评分不变成0，非法评分和销量被排除',()=>{
  const rows=A.normalize([record('1',{price:10,ratingText:'4,8 de 5 estrelas',reviewsText:'1.200 avaliações',salesText:'24 meses con intereses'}),record('2',{price:20}),record('3',{currency:'BRL',price:200,ratingText:'5.9'}),record('4',{price:null,ratingText:'3 整星、1 部分星',salesText:'4.9'})]);
  const summary=A.summary(rows);assert.equal(summary.priced,3);assert.deepEqual(summary.prices.map(p=>[p.currency,p.median]),[['BRL',200],['MXN',15]]);assert.equal(summary.ratings,1);assert.equal(summary.invalidSales,2);assert.equal(rows[0].reviewCount,1200);assert.equal(A.histogram(rows,'MXN').reduce((n,b)=>n+b.count,0),2);
  assert.equal(A.reviews('4.9'),null);assert.equal(A.reviews('1,2 mil avaliações'),1200);assert.equal(A.reviews('28 sold'),null);
});
test('销量保留近月、累计、周期未明和下限口径，不能用评分或付款文字代替',()=>{
  assert.deepEqual(A.sales('4.9 2.000+ vendido(s)','AliExpress'),{value:2000,lowerBound:true,period:'页面销量（周期未明）'});
  assert.equal(A.sales('100+ bought in past month').period,'近月购买');assert.equal(A.sales('72','FastMoss').period,'数据平台总销量');assert.equal(A.sales('72','Amazon'),null);assert.equal(A.sales('NuPay 6x 20'),null);assert.equal(A.sales('1,5rb terjual').value,1500);
});
test('字段改名按稳定字段ID解码，原始数据不被改写，CSV防公式执行',()=>{
  const original={record_id:'rec1',fields:{新标题:[{text:'=test'}],售价:20,新链接:{text:'产品',link:'https://example.com/product'}}},before=JSON.stringify(original),schema={fields:[{field_id:'t',field_name:'新标题'},{field_id:'p',field_name:'售价'},{field_id:'u',field_name:'新链接'}],bindings:{t:'商品标题',p:'展示价格',u:'商品链接'}};
  const decoded=A.decodeRecord(original,schema);assert.equal(decoded.title,'=test');assert.equal(decoded.price,20);assert.equal(decoded.url,'https://example.com/product');assert.equal(JSON.stringify(original),before);assert.match(A.csv(A.normalize([decoded])),/"'=test"/);
});
