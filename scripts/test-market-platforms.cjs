const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const registry=require('../features/multisearch_platforms.js'),core=require('../market_capture/core.js');
const manifest=require('../manifest.json');
const emptyDoc={querySelector:()=>null,querySelectorAll:()=>[]};
const word='Mini Café & Fan + TEST';
const cases=Object.entries(registry.countries).flatMap(([country,value])=>value.platforms.map(platform=>({country,platform,url:registry.buildUrl(platform,word)})));
function matches(pattern,value){const url=new URL(value),match=pattern.match(/^(\*|https?):\/\/(\*\.)?([^/]+)\/(.*)$/);return !!match&&(match[1]==='*'||url.protocol===match[1]+':')&&(url.hostname===match[3]||!!match[2]&&url.hostname.endsWith('.'+match[3]));}
test('批量搜索全部9个国家45个平台组合均有专用采集配置、脚本覆盖和正确搜索词',()=>{
  assert.equal(Object.keys(registry.countries).length,9);assert.equal(cases.length,45);
  const scripts=manifest.content_scripts.filter(s=>s.js.includes('market_capture/content.js'));
  for(const {country,platform,url} of cases){
    const label=country+' '+platform.name,site=core.siteFor(url);assert.ok(site,label);assert.ok(core.CONFIG[site.family],label+' uses explicit rules');
    assert.ok(scripts.some(s=>s.matches.some(pattern=>matches(pattern,url))),label+' script coverage');
    const search=core.readSearch(emptyDoc,url,country);
    assert.equal(search.query,platform.forceLowercase?word.toLowerCase():word,label+' query');assert.equal(search.country,country,label+' country');assert.equal(search.page,1,label+' page');
    assert.ok(!url.includes('[KEYWORD]'));assert.equal(new Set(registry.countries[country].platforms.map(p=>p.id)).size,registry.countries[country].platforms.length);
  }
});
function memory(){const values={};return {values,async get(key){return {[key]:values[key]};},async set(v){Object.assign(values,structuredClone(v));},async remove(keys){for(const key of Array.isArray(keys)?keys:[keys])delete values[key];}};}
function background(){
  let listener,nextTab=1;const tabs=new Map(),local=memory(),session=memory(),events=[];
  const chrome={runtime:{getURL:p=>'chrome-extension://fixture/'+p,onMessage:{addListener(fn){listener=fn;}},onStartup:{addListener(){}},onInstalled:{addListener(){}}},storage:{local,session},alarms:{onAlarm:{addListener(){}},create(){}},tabs:{
    async create(value){const tab={id:nextTab++,...value};tabs.set(tab.id,tab);events.push(['create',tab.id,value.url]);return tab;},
    async update(id,value){const stored=session.values['ianto_market_v1_tab_'+id];assert.ok(stored?.research,'调研背景须先于网页加载');Object.assign(tabs.get(id),value);events.push(['navigate',id,value.url]);if(value.url.includes('fixture-fail'))throw Error('fixture navigation failed');return tabs.get(id);},
    async get(id){return tabs.get(id);},async remove(id){tabs.delete(id);},async sendMessage(){},onRemoved:{addListener(){}}
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../market_capture/background.js'),'utf8'),{chrome,URL,console,importScripts(){},IantoMarketCore:core,IantoMarketDirect:{create:()=>({resume:async()=>{},syncHeaders:async()=>{},getAnalysisData:async options=>{events.push(['analysis-read',options.force]);return {records:[],loadedAt:'fixture'};}})}});
  return {session,tabs,events,send:(value,sender={url:'chrome-extension://fixture/unified_popup.html'})=>new Promise(resolve=>listener({namespace:'iantoMarket',...value},sender,resolve))};
}
test('45组搜索先保存国家原词主题，再打开网页，独立的页面采集能取得本次上下文',async()=>{
  const f=background();
  for(const {country,url} of cases){
    const research={country,originalQuery:word,topic:'Fan research',researchId:'research-'+country};
    const result=await f.send({type:'openSearch',url,research});assert.equal(result.ok,true);
    const tab=f.tabs.get(result.tabId),context=await f.send({type:'getContext',url},{url,tab});
    assert.equal(context.research.country,country);assert.equal(context.research.originalQuery,word);assert.equal(context.research.topic,'Fan research');
    assert.equal(tab.active,false);assert.equal(f.events.at(-2)[0],'create');assert.equal(f.events.at(-1)[0],'navigate');
  }
});
test('搜索打开失败清理新建空页和上下文，商品网站不能代替用户发起批量搜索',async()=>{
  const f=background();const bad=await f.send({type:'openSearch',url:'https://www.amazon.com.mx/s?k=fixture-fail',research:{country:'MX'}});assert.equal(bad.ok,false);assert.equal(f.tabs.size,0);assert.equal(Object.keys(f.session.values).length,0);
  const blocked=await f.send({type:'openSearch',url:'https://www.amazon.com.mx/s?k=fan',research:{}},{url:'https://example.test',tab:{id:99}});assert.equal(blocked.ok,false);assert.equal(f.tabs.size,0);
});
test('搜索页点击商品后，详情页继承页面实际国家、搜索词和位置，未知来源留空',async()=>{
  const f=background(),url='https://www.fastmoss.com/zh/e-commerce/search?words=fan&region=MX';
  const opened=await f.send({type:'openSearch',url,research:{country:'MX',originalQuery:'Fan',topic:'研究风扇'}});
  const product='https://www.fastmoss.com/zh/e-commerce/detail/1736800972002067838';
  const sourceTab=f.tabs.get(opened.tabId);
  await f.send({type:'rememberLink',productUrl:product,position:7,sourceBatchId:'batch-source',search:{query:'fan',country:'BR',searchUrl:url,page:1}},{url,tab:sourceTab});
  const detail={id:99,url:product,openerTabId:opened.tabId};f.tabs.set(99,detail);
  const result=await f.send({type:'getContext',url:product},{url:product,tab:detail});
  assert.equal(result.search.country,'BR');assert.equal(result.search.query,'fan');assert.equal(result.search.position,7);assert.equal(result.research.originalQuery,'Fan');
  const direct={id:100,url:product};f.tabs.set(100,direct);
  const independent=await f.send({type:'getContext',url:product},{url:product,tab:direct});assert.equal(independent.search,undefined);assert.equal(independent.research,undefined);
});
test('分析数据仅给Ianto面板，商品网站不能读取整个飞书表',async()=>{const f=background();const good=await f.send({type:'analysisGetData',force:true},{url:'chrome-extension://fixture/market_capture/analysis.html'});assert.equal(good.ok,true);assert.deepEqual(f.events,[['analysis-read',true]]);const bad=await f.send({type:'analysisGetData',force:true},{url:'https://www.amazon.com.mx/s?k=fan',tab:{id:99}});assert.equal(bad.ok,false);assert.equal(f.events.length,1);});
