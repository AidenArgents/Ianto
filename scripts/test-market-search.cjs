const test=require('node:test');
const assert=require('node:assert/strict');
const {createTracker}=require('../market_capture/search.js');
const {normalizeBatch,MAX_RECORDS}=require('../market_capture/data.js');

function node(attributes={}){return {isConnected:true,parentElement:null,getAttribute:name=>attributes[name]??null};}
function card(id,position,element=node(),extra={}){return {key:id,card:element,position,fields:{title:id,ad:'未见广告标记',image:'',...extra}};}

test('滚动采集保留同商品的不同曝光，重复读取同张卡不重复入表',()=>{
  const tracker=createTracker(),first=card('fan',1),advert=card('fan',2,node(),{ad:'是'}),repeat=card('fan',3);
  tracker.observe([first,advert,repeat]);
  tracker.observe([{...first,fields:{...first.fields,image:'https://example.test/fan.jpg'}},advert]);
  const rows=tracker.snapshot();
  assert.deepEqual(rows.map(r=>r.position),[1,2,3]);
  assert.equal(rows[0].fields.image,'https://example.test/fan.jpg');
  assert.equal(rows[1].fields.ad,'是');
  assert.equal(tracker.positionFor(repeat),3);
});

test('未进入视口的商品保持原位置，后续加载完成的空位按实际顺序补入',()=>{
  const tracker=createTracker(),first=card('one',1),last=card('three',3),middle=card('two',2);
  tracker.observe([first,last]);tracker.observe([middle,last]);
  assert.deepEqual(tracker.snapshot().map(r=>r.fields.title),['one','two','three']);
  const revision=tracker.revision;tracker.observe([middle,last]);assert.equal(tracker.revision,revision);
});

test('虚拟列表移除前面的 DOM 后，按窗口重叠顺序继续收集并保留前面的商品',()=>{
  const tracker=createTracker(),first=[card('one',1),card('two',2),card('three',3)];tracker.observe(first);
  first.forEach(i=>{i.card.isConnected=false;});
  const second=[card('two',1),card('three',2),card('four',3)];tracker.observe(second);
  second.forEach(i=>{i.card.isConnected=false;});
  tracker.observe([card('four',1),card('five',2),card('six',3)]);
  assert.deepEqual(tracker.snapshot().map(r=>[r.fields.title,r.position]),[['one',1],['two',2],['three',3],['four',4],['five',5],['six',6]]);
  assert.equal(tracker.positionFor(card('two',1)),2);
  assert.equal(tracker.snapshot().at(-1).inferred,true);
});

test('虚拟列表复用节点时，以平台给出的序号区分重复商品',()=>{
  const tracker=createTracker(),attributes=[{'aria-posinset':'1'},{'aria-posinset':'2'}],elements=attributes.map(node);
  tracker.observe([card('same',1,elements[0]),card('second',2,elements[1])]);
  attributes[0]['aria-posinset']='3';attributes[1]['aria-posinset']='4';
  tracker.observe([card('same',1,elements[0]),card('fourth',2,elements[1])]);
  assert.deepEqual(tracker.snapshot().map(r=>[r.fields.title,r.position]),[['same',1],['second',2],['same',3],['fourth',4]]);
  assert.equal(tracker.positionFor(card('same',1,elements[0])),3);
});

test('未收录的卡片不冒充本次采集中的位置',()=>{
  const tracker=createTracker();tracker.observe([card('one',1)]);
  assert.equal(tracker.positionFor(card('new',2)),null);
});

test('长页面单次采集可保存600条商品，超出容量时明确报错',()=>{
  const row={title:'Fixture fan',platform:'Amazon',captureMethod:'搜索页整理',capturedAt:'2026-10-23T08:00:00.000Z',url:'https://www.amazon.com.mx/dp/B000000001'};
  const batch={batchId:crypto.randomUUID(),records:Array.from({length:600},()=>({...row,id:crypto.randomUUID()}))};
  assert.equal(normalizeBatch(batch).records.length,600);
  assert.throws(()=>normalizeBatch({...batch,records:Array(MAX_RECORDS+1).fill(row)}),/10000/);
});
