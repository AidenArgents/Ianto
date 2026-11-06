const test=require('node:test');
const assert=require('node:assert/strict');
require('../market_capture/data.js');
require('../market_capture/feishu.js');
const {create}=require('../market_capture/direct.js');
function memory(){const data={};return {data,async get(k){return {[k]:data[k]};},async set(v){Object.assign(data,structuredClone(v));},async remove(k){delete data[k];}};}
function fixture(){
  const storage=memory(),network={total:97,products:96,offline:false,missing:false,requests:[]};
  const fetcher=async(url,options={})=>{
    const u=new URL(url);network.requests.push({url,method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
    if(network.offline)throw Error('fixture offline');
    if(u.pathname.endsWith('/tenant_access_token/internal'))return Response.json({code:0,tenant_access_token:'fixture-token',expire:7200});
    if(u.pathname.endsWith('/fields'))return Response.json({code:0,data:{items:IantoMarketData.FIELDS.map((f,i)=>({...f,field_id:'fld'+i}))}});
    assert.equal(u.searchParams.get('page_size'),'1','只读取计数，不扫描整表');
    if(u.pathname.endsWith('/records')){assert.equal(options.method,'GET');return Response.json({code:0,data:network.missing?{}:{total:network.total,items:[]}});}
    if(u.pathname.endsWith('/records/search')){
      assert.equal(options.method,'POST');const body=JSON.parse(options.body);assert.equal(body.filter.conjunction,'or');assert.deepEqual(body.filter.conditions.map(c=>c.field_name),['平台商品ID','商品标题','商品链接']);assert.ok(body.filter.conditions.every(c=>c.operator==='isNotEmpty'));assert.equal(body.view_id,undefined);assert.equal(body.sort,undefined);
      return Response.json({code:0,data:{total:network.products,items:[]}});
    }
    throw Error('Unexpected request '+u.pathname);
  };
  return {storage,network,direct:create({storage,tokenStorage:memory(),fetcher})};
}
const config={appId:'cli_fixture',appSecret:'fixture-secret',appToken:'baseFixture',tableId:'tblFixture'};
test('96个商品和1行空白记录分别计数，表头不参与',async()=>{
  const {direct}=fixture();await direct.configure(config);const result=await direct.getRemoteStatus();assert.equal(result.ok,true);assert.equal(result.count,96);assert.equal(result.recordTotal,97);assert.equal(result.blankCount,1);
});
test('商品清空后显示0，即使保留97行空白记录和96条历史回执',async()=>{
  const {direct,network,storage}=fixture();await direct.configure(config);await storage.set({ianto_market_v1_index:[{batchId:'fixture-capture',status:'saved',count:96,at:'2026-10-23T08:00:00.000Z'}]});await direct.getRemoteStatus();network.products=0;
  const result=await direct.getRemoteStatus();assert.equal(result.ok,true);assert.equal(result.count,0);assert.equal(result.recordTotal,97);assert.equal(result.blankCount,97);assert.equal((await direct.status()).saved,96);assert.equal(storage.data.ianto_market_v1_index[0].count,96);
  network.total=0;const empty=await direct.getRemoteStatus();assert.equal(empty.count,0);assert.equal(empty.blankCount,0);
});
test('读取失败不返回历史数或假装0，恢复网络后重新读取',async()=>{
  const {direct,network}=fixture();await direct.configure(config);await direct.getRemoteStatus();network.offline=true;let result=await direct.getRemoteStatus();assert.equal(result.ok,false);assert.equal(result.count,null);assert.ok(result.error);
  network.offline=false;network.products=3;result=await direct.getRemoteStatus();assert.equal(result.ok,true);assert.equal(result.count,3);
});
test('多个界面刷新共用同一轮只读查询，没有创建、修改或删除记录',async()=>{
  const {direct,network}=fixture();await direct.configure(config);const results=await Promise.all(Array.from({length:12},()=>direct.getRemoteStatus()));assert.ok(results.every(r=>r.count===96));assert.equal(network.requests.filter(r=>r.url.includes('/records?')).length,1);assert.equal(network.requests.filter(r=>r.url.includes('/records/search?')).length,1);
  assert.ok(network.requests.every(r=>r.method==='GET'||r.url.includes('/auth/')||r.url.includes('/records/search?')));
});
test('计数缺失或不一致明确报错，不把缺失值当0',async()=>{
  const {direct,network}=fixture();await direct.configure(config);network.missing=true;assert.equal((await direct.getRemoteStatus()).ok,false);network.missing=false;network.products=98;const result=await direct.getRemoteStatus();assert.equal(result.ok,false);assert.equal(result.count,null);
});
test('未配置飞书时说明原因，不发送请求',async()=>{
  const {direct,network}=fixture();const result=await direct.getRemoteStatus();assert.equal(result.ok,false);assert.match(result.error,/填写飞书配置/);assert.equal(result.count,null);assert.equal(network.requests.length,0);
});
