const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('../market_capture/core.js'),W=require('../market_capture/workflow.js');
function memory(){const data={};return {data,async get(k){return {[k]:structuredClone(data[k])};},async set(v){Object.assign(data,structuredClone(v));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
function fixture(){let listener,next=1;const local=memory(),session=memory(),tabs=new Map(),jobs=new Map(),cfg={appId:'cli_fixture',appToken:'base',tableId:'tblProducts'};const direct={resume:async()=>{},syncHeaders:async()=>{},workflowAccess:async()=>cfg,async enqueue(batch,tab){jobs.set(batch.batchId,{batch,tab});return {configured:true};},async getDevelopmentOpinion(id,tab){const job=jobs.get(id);if(!job||tab!==undefined&&tab!==job.tab)throw Error('无权访问其他页面的采集');return {batchId:id};},async captureForWorkflow(id,tab){await this.getDevelopmentOpinion(id,tab);return jobs.get(id).batch;}};
  const chrome={runtime:{getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}},onInstalled:{addListener(){}}},storage:{local,session},alarms:{onAlarm:{addListener(){}},create(){}},tabs:{async create(v){const t={id:next++,...v};tabs.set(t.id,t);return t;},async update(id,v){Object.assign(tabs.get(id),v);return tabs.get(id);},async get(id){return tabs.get(id);},async remove(id){tabs.delete(id);},async sendMessage(){},onRemoved:{addListener(){}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../market_capture/background.js'),'utf8'),{chrome,crypto,URL,URLSearchParams,console,Date,structuredClone,setTimeout:()=>1,clearTimeout(){},importScripts(){},IantoMarketCore:core,IantoMarketWorkflow:W,IantoMarketDirect:{create:()=>direct},IantoMarketData:{MAX_RECORDS:10000,MAX_BATCH_SIZE:12000000}});
  return {local,session,tabs,jobs,send:(m,sender={url:'chrome-extension://fixture/unified_popup.html'})=>new Promise(resolve=>listener({namespace:'iantoMarket',...m},sender,resolve))};
}
test('真实后台串起搜索归属、搜索到详情继承、采集归组和对应分析；独立链接不沿用',async()=>{
  const f=fixture(),launched=await f.send({type:'workflowLaunch',input:{name:'风扇',word:'fan'}});assert.equal(launched.ok,true);const assignment=launched.assignment,url='https://www.amazon.com.mx/s?k=fan';
  const opened=await f.send({type:'openSearch',url,research:{...assignment,country:'MX',originalQuery:'fan',researchId:'search-session'}}),tab=f.tabs.get(opened.tabId),sender={url,tab};
  const context=await f.send({type:'getContext',url},sender);assert.equal(context.research.roundId,assignment.roundId);
  const product='https://www.amazon.com.mx/dp/B012345678';await f.send({type:'rememberLink',productUrl:product,position:1,search:{query:'fan',country:'MX',searchUrl:url,page:1}},sender);
  const detail={id:99,url:product,openerTabId:tab.id};f.tabs.set(99,detail);const dcontext=await f.send({type:'getContext',url:product},{url:product,tab:detail});assert.equal(dcontext.research.productGroupId,assignment.productGroupId);
  const batch={batchId:crypto.randomUUID(),records:[{id:crypto.randomUUID(),title:'Fan',productId:'B012345678',url:product,country:'MX',platform:'Amazon',query:'fan',capturedAt:new Date().toISOString(),captureMethod:'详情页单品'}]};
  const queued=await f.send({type:'enqueue',batch},{url:product,tab:detail});assert.equal(queued.assignment.roundId,assignment.roundId);
  const routed=await f.send({type:'workflowOpenAnalysis',batchId:batch.batchId},{url:product,tab:detail});assert.equal(routed.ok,true);const analysis=[...f.tabs.values()].at(-1);assert.ok(analysis.url.includes('round='+assignment.roundId));assert.ok(analysis.url.includes('batch='+batch.batchId));
  const independent={id:100,url:product};f.tabs.set(100,independent);const c=await f.send({type:'getContext',url:product},{url:product,tab:independent});assert.equal(c.research,undefined);
  const denied=await f.send({type:'workflowChoices',batchId:batch.batchId},{url:product,tab:independent});assert.equal(denied.ok,false);
  const blocked=await f.send({type:'workflowSave',changes:[]},{url,tab});assert.equal(blocked.ok,false);
});
test('分析页打开商品补采携带当前调研和待办；普通商品页无权代替用户打开',async()=>{
  const f=fixture(),a=(await f.send({type:'workflowLaunch',input:{name:'风扇'}})).assignment,url='https://www.amazon.com.mx/dp/B012345678';
  const opened=await f.send({type:'workflowOpenProduct',url,roundId:a.roundId,productGroupId:a.productGroupId,taskId:'task'});assert.equal(opened.ok,true);const t=[...f.tabs.values()].at(-1),c=await f.send({type:'getContext',url},{url,tab:t});assert.equal(c.research.taskId,'task');assert.equal(c.research.roundId,a.roundId);
  const denied=await f.send({type:'workflowOpenProduct',url,roundId:a.roundId},{url,tab:t});assert.equal(denied.ok,false);
});
