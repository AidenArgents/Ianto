const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {create}=require('../market_capture/headers.js');
require('../market_capture/data.js');
const {FeishuClient}=require('../market_capture/feishu.js');
function fixture(){
  const store={},fields=[['id','平台商品ID',1],['title','商品标题',1],['image','首图',17],['capture','采集编号',1]].map(([field_id,field_name,type])=>({field_id,field_name,type}));
  const views=Array.from({length:8},(_,i)=>({id:'vew'+i,name:i?'平台'+i:'全部采集',type:'grid',_meta:{filter:i?{field:'platform',is:i}:null,group:['id'],sort:[['title','asc']]}}));
  const columns=Object.fromEntries(views.map((v,i)=>[v.id,i%2?['id','title']:['id','title','image']]));
  const writes=[],network={failView:'',staleView:''};
  const remote={tablePath:()=>'/bitable/v1/apps/base/tables/tbl',async request(route,options={}){
    const u=new URL(route,'https://example.test');
    if(u.pathname.endsWith('/fields'))return {items:structuredClone(fields)};
    if(u.pathname.endsWith('/views'))return {total:views.length,views:structuredClone(views)};
    assert.ok(u.pathname.endsWith('/visible_fields'));
    const view=u.pathname.split('/').at(-2);assert.ok(columns[view]);
    if(options.method==='PUT'){
      writes.push({view,body:structuredClone(options.body)});assert.deepEqual(Object.keys(options.body),['visible_fields']);
      if(network.failView===view)throw Error('fixture denied');
      if(network.staleView!==view)columns[view]=options.body.visible_fields.map(name=>fields.find(f=>f.field_name===name).field_id);
    }
    return columns[view].map(id=>fields.find(f=>f.field_id===id).field_name);
  }};
  const config={appToken:'base',tableId:'tbl'};
  const reopen=()=>create({get:async(name,fallback)=>structuredClone(store[name]??fallback),set:async(name,value)=>{store[name]=structuredClone(value);}});
  return {headers:reopen(),reopen,store,remote,config,views,columns,fields,writes,network};
}
test('八个视图统一列序和显隐，筛选分组及记录排序完整保留',async()=>{
  const f=fixture(),before=structuredClone(f.views);
  const layout=await f.headers.sync(f.remote,f.config);
  assert.deepEqual(layout.fields,['平台商品ID','商品标题','首图']);
  assert.ok(Object.values(f.columns).every(ids=>JSON.stringify(ids)==='["id","title","image"]'));
  assert.deepEqual(f.views,before);assert.equal(f.writes.length,4);assert.equal(f.store.headers.pending,false);
  f.writes.length=0;await f.headers.sync(f.remote,f.config);assert.equal(f.writes.length,0);
});
test('任意视图改列序、隐藏列，新视图也自动采用统一配置',async()=>{
  const f=fixture();await f.headers.sync(f.remote,f.config);
  f.columns.vew6=['id','image','title'];await f.headers.sync(f.remote,f.config);
  assert.ok(Object.values(f.columns).every(ids=>JSON.stringify(ids)==='["id","image","title"]'));
  f.columns.vew2=['id','title'];await f.headers.sync(f.remote,f.config);
  f.views.push({id:'vewNew',name:'新视图',type:'grid'});f.columns.vewNew=['id','title','image','capture'];
  await f.headers.sync(f.remote,f.config);assert.deepEqual(f.columns.vewNew,['id','title']);
});
test('列改名、加列和删列不打乱源字段绑定，不重新创建字段',async()=>{
  const f=fixture();await f.headers.sync(f.remote,f.config);
  f.fields.find(v=>v.field_id==='title').field_name='产品名称';
  f.fields.push({field_id:'manual',field_name:'人工备注',type:1});f.columns.vew1=['id','manual','title','image'];
  let result=await f.headers.sync(f.remote,f.config);assert.deepEqual(result.fields,['平台商品ID','人工备注','产品名称','首图']);
  assert.equal(result.columns[2].source,'商品标题');assert.equal(result.columns[1].source,'');
  f.fields.splice(f.fields.findIndex(v=>v.field_id==='image'),1);for(const id in f.columns)f.columns[id]=f.columns[id].filter(id=>id!=='image');
  result=await f.headers.sync(f.remote,f.config);assert.deepEqual(result.fields,['平台商品ID','人工备注','产品名称']);
  assert.equal(f.store.schema.bindings.image,undefined);
});
test('写到一半失败后可重启续传，不把自身写入误当成用户调整',async()=>{
  const f=fixture();await f.headers.sync(f.remote,f.config);f.columns.vew1=['id','image','title'];f.network.failView='vew3';
  await assert.rejects(()=>f.headers.sync(f.remote,f.config),/fixture denied/);assert.equal(f.store.headers.pending,true);
  f.network.failView='';await f.reopen().sync(f.remote,f.config);
  assert.ok(Object.values(f.columns).every(ids=>JSON.stringify(ids)==='["id","image","title"]'));assert.equal(f.store.headers.pending,false);
});
test('飞书未保存完成时阻止导出布局，保留待续传状态',async()=>{
  const f=fixture();f.network.staleView='vew1';await assert.rejects(()=>f.headers.sync(f.remote,f.config),/正在保存/);assert.equal(f.store.headers.pending,true);
  f.network.staleView='';await f.headers.sync(f.remote,f.config);assert.equal(f.store.headers.pending,false);
});
test('多个视图有冲突时不盲目覆盖，以用户当前正在修改的视图继续统一',async()=>{
  const f=fixture();await f.headers.sync(f.remote,f.config);f.writes.length=0;
  f.columns.vew1=['id','image','title'];f.columns.vew2=['id','title'];
  await assert.rejects(()=>f.headers.sync(f.remote,f.config),/多个视图/);assert.equal(f.writes.length,0);
  const layout=await f.headers.sync(f.remote,f.config,{sourceView:'vew1'});assert.deepEqual(layout.fields,['平台商品ID','首图','商品标题']);
});
test('已有一致列序的表首次接入不会被硬编码默认顺序覆盖',async()=>{
  const f=fixture();for(const id in f.columns)f.columns[id]=['id','image','title'];
  const result=await f.headers.sync(f.remote,f.config);assert.deepEqual(result.fields,['平台商品ID','首图','商品标题']);assert.equal(f.writes.length,0);
});
test('稳定ID保证改名后的资料、去重和图片仍操作正确字段',async()=>{
  const remote=new FeishuClient({appToken:'base',tableId:'tbl'}),requests=[];
  remote.setSchema({fields:[{field_id:'title',field_name:'新标题'},{field_id:'capture',field_name:'唯一采集号'},{field_id:'image',field_name:'产品图'}],bindings:{title:'商品标题',capture:'采集编号',image:'首图'}});
  remote.request=async(route,options={})=>{
    requests.push({route,...options});
    if(route.includes('/search'))return {items:[{record_id:'rec',fields:{唯一采集号:'capture-id'}}]};
    if(route.includes('batch_create'))return {records:[{record_id:'newrec'}]};
    return {record:{fields:{产品图:[{file_token:'image-token'}]}}};
  };
  const result=await remote.findRecords(['capture-id']);assert.equal(result.get('capture-id'),'rec');assert.equal(requests[0].body.field_names[0],'唯一采集号');
  const row={id:'new',title:'Fan',platform:'Amazon',capturedAt:'2026-10-23T00:00:00Z'};
  await remote.writeBatch({records:[row]});const written=requests.find(r=>r.route.includes('batch_create')).body.records[0].fields;
  assert.deepEqual(written,{新标题:'Fan',唯一采集号:'new'});
  await remote.attachImage('rec','image-token');assert.deepEqual(requests.find(r=>r.method==='PUT').body,{fields:{产品图:[{file_token:'image-token'}]}});
  remote.setSchema({fields:[],bindings:{}});assert.throws(()=>remote.recordFields(row),/采集编号/);
});
test('飞书页面在操作后核对，后台标签页暂停，切换表格后恢复识别',async()=>{
  const events={},timeouts=[],intervals=[],sent=[];
  const document={hidden:false,addEventListener(type,fn){events[type]=fn;}};
  let watching=true;
  const context={document,location:{href:'https://my.feishu.cn/base/base?table=tbl&view=vew1'},window:{addEventListener(type,fn){events[type]=fn;}},chrome:{runtime:{sendMessage:async m=>{sent.push(m);return {ok:true,watching};}}},setTimeout(fn,ms){timeouts.push({fn,ms});return timeouts.length;},clearTimeout(){},setInterval(fn,ms){intervals.push({fn,ms});}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../market_capture/feishu_page.js'),'utf8'),context);
  assert.equal(timeouts[0].ms,1500);assert.equal(intervals[0].ms,15000);
  await timeouts.at(-1).fn();assert.equal(sent.length,1);assert.equal(sent[0].type,'headersCheck');
  events.pointerup();await timeouts.at(-1).fn();assert.equal(sent.length,2);
  document.hidden=true;await timeouts.at(-1).fn();assert.equal(sent.length,2);
  document.hidden=false;watching=false;await timeouts.at(-1).fn();assert.equal(sent.length,3);
  events.pointerup();await timeouts.at(-1).fn();assert.equal(sent.length,3);
  context.location.href='https://my.feishu.cn/base/base?table=tbl&view=vew2';watching=true;
  intervals[0].fn();await new Promise(setImmediate);assert.equal(sent.length,4);
});
test('后台只允许配置表格的顶层飞书页面触发表头写入',async()=>{
  let listener;const checks=[];
  const config={appToken:'base',tableId:'tbl'};
  const direct={settings:async()=>config,syncHeaders:async value=>{checks.push(value);},resume:async()=>{}};
  const chrome={runtime:{getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}},onInstalled:{addListener(){}}},storage:{local:{},session:{}},tabs:{onRemoved:{addListener(){}}},alarms:{onAlarm:{addListener(){}},create(){}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../market_capture/background.js'),'utf8'),{chrome,URL,console,importScripts(){},IantoMarketCore:{},IantoMarketDirect:{create:()=>direct}});
  await new Promise(setImmediate);checks.length=0;
  const send=(url,frameId=0)=>new Promise(resolve=>listener({namespace:'iantoMarket',type:'headersCheck'},{url,frameId,tab:{id:1}},resolve));
  for(const url of ['https://feishu.cn.evil.test/base/base?table=tbl','https://my.feishu.cn/base/other?table=tbl','https://my.feishu.cn/base/base?table=other','https://www.amazon.com.mx/s?k=fan'])assert.equal((await send(url)).watching,false);
  assert.equal((await send('https://my.feishu.cn/base/base?table=tbl',1)).watching,false);assert.equal(checks.length,0);
  assert.equal((await send('https://my.feishu.cn/base/base?table=tbl&view=vewSearch')).watching,true);assert.equal(checks.length,1);assert.equal(checks[0].sourceView,'vewSearch');
});
