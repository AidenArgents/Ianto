const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../market_capture/analytics.js'),R=require('../market_capture/research.js'),L=require('../market_capture/label_rules.js');
const rec=(id,extra={})=>({id,productId:id,title:'USB Pocket FAN',attributes:'5000mAh rechargeable',country:'MX',platform:'Amazon',source:'Amazon',query:'fan',topic:'风扇',batchId:'batch',capturedAt:'2026-10-23T01:00:00Z',...extra});
const rule=extra=>L.rule({id:'r',name:'USB风扇',any:['fan'],all:['USB'],none:['case'],type:'手持风扇',tags:['电源=USB'],...extra});
test('文字规则忽略大小写和空格，保留重音；只作字面包含，不执行正则或HTML',()=>{
  const rows=A.normalize([rec('1'),rec('2',{title:'USB Fan case'}),rec('3',{title:'café USB FAN'}),rec('4',{title:'Cafe USB FAN'})]),r=rule({all:['café']});
  assert.equal(L.preview(rows,[rule()]).length,3);assert.equal(L.preview(rows,[r]).length,1);
  assert.equal(L.preview(rows,[rule({any:['.*'],all:[]})]).length,0);
  assert.equal(L.valid(rule({any:[],all:[],none:['case']})),false);
});
test('按当前批次日期和产品限定规则；重复观测采用范围内最新文本，不用旧标题误标',()=>{
  const rows=A.normalize([rec('1'),rec('new',{productId:'1',title:'Fan replacement case',capturedAt:'2026-10-24T01:00:00Z'}),rec('2',{title:'USB FAN',query:'lamp',topic:'台灯'})]),products=A.seedProducts(rows),fan=products.find(p=>p.name==='风扇');
  assert.equal(L.preview(rows,[rule()]).length,1,'最新的外壳排除');
  const scoped={scope:{from:'2026-10-23',to:'2026-10-23'},products,roundId:'oct'};
  assert.equal(L.preview(rows,[rule({roundId:'other'})],scoped).length,0);
  assert.equal(L.preview(rows,[rule({roundId:'oct',productIds:[fan.id]})],scoped).length,1);
  assert.equal(L.preview(rows,[rule()],{scope:{batchIds:[]}}).length,0);
});
test('规则修改删除即时重算，不保存衍生标记到人工数据；新增商品自动匹配',()=>{
  const rows=A.normalize([rec('1')]),before=structuredClone(rows),annotations={},ctx={annotations};
  assert.equal(L.apply(rows,[rule()],ctx)[0].type,'手持风扇');
  assert.equal(L.apply(rows,[rule({type:'迷你风扇'})],ctx)[0].type,'迷你风扇');
  assert.equal(L.apply(rows,[],ctx)[0].type,'');assert.deepEqual(annotations,{});assert.deepEqual(rows,before);
  assert.equal(L.apply(A.normalize([rec('new')]),[rule()],ctx)[0].tags[0],'电源=USB');
});
test('人工值和明确清空优先，人工相关性按轮次；冲突规则不靠先后顺序随意覆盖',()=>{
  const rows=A.normalize([rec('1')]),key=A.entityKey(rows[0]);
  let annotations=R.editAnnotations({},[key],{type:'人工类型',tags:[],candidate:'未加入'});
  const r=rule({relevance:'相关',candidate:'重点对标'}),ctx={annotations,reviews:{[key]:'待确认'}};
  const applied=L.apply(rows,[r],ctx)[0];assert.equal(applied.type,'人工类型');assert.deepEqual(applied.tags,[]);assert.equal(applied.candidate,'未加入');assert.equal(applied.relevance,'待确认');
  annotations=R.editAnnotations(annotations,[key],{type:''});assert.equal(L.apply(rows,[r],{annotations})[0].type,'');
  const conflict=L.apply(rows,[rule(),rule({id:'r2',name:'其他',type:'桌面风扇',tags:['LED']})])[0];
  assert.equal(conflict.type,'');assert.deepEqual(conflict.ruleConflicts,['type']);assert.deepEqual(conflict.tags,['电源=USB','LED']);
});
