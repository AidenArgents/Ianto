const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
require('../market_capture/data.js');
require('../market_capture/feishu.js');
const {create}=require('../market_capture/direct.js');

function memory(){
  const data={};
  return {data,async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,data[k]]));},async set(values){Object.assign(data,structuredClone(values));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};
}
function fixture(){
  const storage=memory(),network={offline:false,fields:[{field_id:'id',field_name:'平台商品ID',type:1},{field_id:'title',field_name:'商品标题',type:1},{field_id:'image',field_name:'首图',type:17},{field_id:'shop',field_name:'店铺',type:1},{field_id:'internal',field_name:'采集编号',type:1}],visible:{vewAll:['id','title','image','shop'],vewSearch:['id','title']},requests:[]};
  const fetcher=async(url,options)=>{
    network.requests.push({url,method:options?.method||'GET'});if(network.offline)throw Error('fixture offline');const u=new URL(url);let data;
    if(u.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'fixture-token',expire:7200});
    if(u.pathname.endsWith('/views'))data={total:2,views:[{id:'vewAll',name:'全部采集',type:'grid'},{id:'vewSearch',name:'搜索页对比',type:'grid'}]};
    else if(u.pathname.endsWith('/fields'))data={items:network.fields};
    else if(u.pathname.endsWith('/visible_fields')){
      const id=u.pathname.split('/').at(-2);
      if(options.method==='PUT')network.visible[id]=JSON.parse(options.body).visible_fields.map(name=>network.fields.find(f=>f.field_name===name).field_id);
      data=network.visible[id].map(id=>network.fields.find(f=>f.field_id===id).field_name);
    }
    else throw Error('Unexpected request '+u.pathname);
    return Response.json({code:0,data});
  };
  return {storage,network,direct:create({storage,tokenStorage:memory(),fetcher})};
}
const config={appId:'cli_fixture',appSecret:'fixture-secret',appToken:'baseFixture',tableId:'tblFixture'};
const batchId='11111111-1111-4111-a111-111111111111';
function batch(){return {batchId,records:[1,2].map(n=>({id:`22222222-2222-4222-a222-${String(n).padStart(12,'0')}`,title:n===1?'Fan, "Café"\nNew line':'Second fan',platform:'Amazon',productId:'B000000001',url:'https://www.amazon.com.mx/dp/B000000001',image:'https://example.test/fan.jpg',captureMethod:'搜索页整理',capturedAt:'2026-10-23T08:30:00.000Z',position:n}))};}
function parseCSV(text){
  const rows=[];let row=[],cell='',quoted=false;const s=text.replace(/^\uFEFF/,'');
  for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(!quoted&&c===','){row.push(cell);cell='';}else if(!quoted&&c==='\r'&&s[i+1]==='\n'){row.push(cell);rows.push(row);row=[];cell='';i++;}else cell+=c;}
  row.push(cell);rows.push(row);return rows;
}

test('离线默认列顺序固定，保留空列、首图链接、重复商品和文字转义',async()=>{
  const {direct}=fixture();await direct.enqueue(batch());const csv=await direct.exportCSV(batchId),rows=parseCSV(csv),header=rows[0];
  assert.deepEqual(header.slice(0,5),['平台商品ID','商品标题','首图','销售平台','数据来源']);assert.ok(header.includes('店铺'));assert.equal(rows[1][header.indexOf('店铺')],'');assert.equal(rows[1][1],batch().records[0].title);assert.equal(rows[1][2],'https://example.test/fan.jpg');assert.equal(rows[1][header.indexOf('采集时间')],'2026-10-23 16:30:00');assert.equal(rows.length,3);assert.equal(rows[1][0],rows[2][0]);assert.equal(rows[2][header.indexOf('本页位置')],'2');
});
test('联网导出统一可见列，任一视图调整列序或显隐后，全表和CSV跟随',async()=>{
  const {direct,network}=fixture();await direct.configure(config);await direct.enqueue(batch());let layout=await direct.exportLayout();assert.equal(layout.source,'online');assert.deepEqual(layout.fields,['平台商品ID','商品标题','首图','店铺']);
  let rows=parseCSV(await direct.exportCSV(batchId,layout));assert.deepEqual(rows[0],layout.fields);assert.equal(rows[1][3],'');assert.ok(!JSON.stringify(rows).includes(config.appSecret));
  network.visible.vewSearch=['id','image','title'];layout=await direct.exportLayout();rows=parseCSV(await direct.exportCSV(batchId,layout));assert.deepEqual(rows[0],['平台商品ID','首图','商品标题']);assert.equal(rows[1][1],batch().records[0].image);assert.deepEqual(network.visible.vewAll,network.visible.vewSearch);
  assert.ok(network.requests.filter(r=>r.method==='PUT').every(r=>r.url.endsWith('/visible_fields')));
});
test('断网或同步失败停止导出，避免悄悄使用不同的默认或缓存表头',async()=>{
  const {direct,network}=fixture();await direct.configure(config);await direct.enqueue(batch());await direct.exportLayout();network.offline=true;await assert.rejects(()=>direct.exportLayout());await assert.rejects(()=>direct.exportCSV(batchId));assert.ok((await direct.status()).headerError);
  network.offline=false;await direct.exportLayout();assert.equal((await direct.status()).headerError,'');
});
test('改列名后CSV表头更新，商品值仍按字段ID写入正确列',async()=>{
  const {direct,network}=fixture();await direct.configure(config);await direct.enqueue(batch());await direct.exportLayout();
  network.fields.find(f=>f.field_id==='title').field_name='产品名称';network.fields.find(f=>f.field_id==='image').field_name='产品图片';
  const rows=parseCSV(await direct.exportCSV(batchId));assert.deepEqual(rows[0],['平台商品ID','产品名称','产品图片','店铺']);assert.equal(rows[1][1],batch().records[0].title);assert.equal(rows[1][2],batch().records[0].image);
});
test('每次只导出选中的采集：多次整理、单商品收录互不混入，文件名可区分',async()=>{
  const {direct}=fixture(),otherId='33333333-3333-4333-a333-333333333333';
  await direct.enqueue(batch());await direct.enqueue({batchId:otherId,records:[{...batch().records[0],id:'44444444-4444-4444-a444-444444444444',title:'Other capture',captureMethod:'详情页单品'}]});
  const first=await direct.exportCSV(batchId),second=await direct.exportCSV(otherId);
  assert.equal(parseCSV(first).length,3);assert.equal(parseCSV(second).length,2);assert.ok(!first.includes('Other capture'));assert.ok(second.includes('Other capture'));assert.ok(!second.includes('Second fan'));
  const a=await direct.exportBatchInfo(batchId),b=await direct.exportBatchInfo(otherId);assert.equal(a.count,2);assert.equal(b.count,1);assert.notEqual(a.filename,b.filename);assert.match(a.filename,/搜索页-\d{14}-11111111\.csv$/);assert.match(b.filename,/单商品-\d{14}-33333333\.csv$/);
});

test('未采完整的原因随批次保留，重开后可见，单次 CSV 备注也包含原因',async()=>{
  const {direct,storage}=fixture(),input=batch(),note='已手动停止加载；仅保存已识别内容，未确认本页全部加载';
  input.records.forEach(row=>{row.note=note;});await direct.enqueue(input);
  const reopened=create({storage,tokenStorage:memory()});assert.equal((await reopened.status()).pending[0].note,note);
  const rows=parseCSV(await reopened.exportCSV(batchId));assert.equal(rows[1][rows[0].indexOf('备注')],note);
});
test('缺少或不存在的采集批次会报错，不会混入其他采集的数据',async()=>{
  const {direct}=fixture();await direct.enqueue(batch());await assert.rejects(()=>direct.exportCSV(),/请选择一次采集/);await assert.rejects(()=>direct.exportCSV('55555555-5555-4555-a555-555555555555'),/没有完整/);
  const state=await direct.status();assert.equal(state.history.length,0);assert.equal(state.pending[0].canExport,true);
});
test('后台CSV只使用统一表头，不再从最近访问视图决定列序',async()=>{
  let listener,selected;
  const tabs=[{url:'https://my.feishu.cn/base/baseFixture?table=tblFixture&view=vewAll',lastAccessed:10},{url:'https://my.feishu.cn/base/baseFixture?table=tblFixture&view=vewSearch',lastAccessed:20},{url:'https://my.feishu.cn/base/baseFixture?table=tblOther&view=vewWrong',lastAccessed:100},{url:'https://feishu.cn.evil.test/base/baseFixture?table=tblFixture&view=vewEvil',lastAccessed:200}];
  const chrome={runtime:{getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}},onInstalled:{addListener(){}}},storage:{local:memory(),session:memory()},tabs:{query:async()=>tabs,onRemoved:{addListener(){}}},alarms:{onAlarm:{addListener(){}},create(){}}};
  const direct={resume:async()=>{},syncHeaders:async()=>{},settings:async()=>config,exportBatchInfo:async id=>{assert.equal(id,batchId);return {batchId:id,count:2,filename:'one-batch.csv'};},exportLayout:async(...args)=>{selected=args;return {viewName:'统一表头',source:'online',fields:['商品标题']};},exportCSV:async id=>{assert.equal(id,batchId);return 'fixture-csv';}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../market_capture/background.js'),'utf8'),{chrome,URL,console,importScripts(){},IantoMarketCore:{},IantoMarketDirect:{create:()=>direct}});
  const response=await new Promise(resolve=>listener({namespace:'iantoMarket',type:'exportBatch',batchId},{url:'chrome-extension://fixture/market_capture/settings.html'},resolve));assert.equal(response.ok,true);assert.deepEqual(selected,[]);assert.equal(response.csv,'fixture-csv');assert.equal(response.count,2);assert.equal(response.filename,'one-batch.csv');
  const unknown=await new Promise(resolve=>listener({namespace:'iantoMarket',type:'invalidAction'},{url:'chrome-extension://fixture/market_capture/settings.html'},resolve));assert.equal(unknown.ok,false);assert.match(unknown.error,/未知采集操作/);
});
