/* Independent module. All messages and storage keys are namespaced. */
(function() {
  'use strict';
  importScripts('market_capture/core.js','market_capture/data.js','market_capture/table.js','market_capture/headers.js','market_capture/feishu.js','market_capture/analytics.js','market_capture/direct.js','market_capture/workflow.js');
  const C=globalThis.IantoMarketCore, PREFIX='ianto_market_v1_', ALARM='ianto-market-sync';
  const key=name=>PREFIX+name;
  let serial=Promise.resolve();
  function mutate(fn){const work=serial.then(fn);serial=work.catch(()=>{});return work;}
  async function get(name,fallback){const result=await chrome.storage.local.get(key(name));return result[key(name)]??fallback;}
  async function set(name,value){await chrome.storage.local.set({[key(name)]:value});}
  async function session(name,fallback){const result=await chrome.storage.session.get(key(name));return result[key(name)]??fallback;}
  async function sessionSet(name,value){await chrome.storage.session.set({[key(name)]:value});}
  async function settings(){const value=await get('settings',{});return {enabled:value.enabled!==false};}
  function pageScope(url){const identity=C.productIdentity(url);if(identity)return identity.key;const u=new URL(url);u.hash='';return u.href;}
  const pageTopic=(base,url)=>base.pageTopic?.scope===pageScope(url)?base.pageTopic.topic:'';
  const isExtension=sender=>String(sender.url||'').startsWith(chrome.runtime.getURL(''));
  const direct=globalThis.IantoMarketDirect.create({storage:chrome.storage.local,tokenStorage:chrome.storage.session,notify});
  const workflow=globalThis.IantoMarketWorkflow?.create({storage:chrome.storage.local,access:connected=>direct.workflowAccess(connected)});
  let workflowTimer=null;
  function syncWorkflow(){if(!workflow)return;clearTimeout(workflowTimer);workflowTimer=setTimeout(()=>{void workflow.sync().catch(error=>console.warn('[Ianto 调研保存]',error.message));},1800);}
  async function resolveContext(sender,url){
    await serial;
    const tabId=sender.tab?.id;if(tabId===undefined)return {};
    const site=C.siteFor(url);if(!site)return {};
    const base=await session('tab_'+tabId,{}),identity=C.productIdentity(url);
    let research=base.research?.family===site.family?base.research:null;
    if(!identity)return research?{research}:{};
    if(base.detail?.productKey===identity.key)return {research:research||base.detail.research,search:base.detail};
    let links=await session('links_'+tabId,[]);
    let selected=links.find(l=>l.productKey===identity.key&&Date.now()-l.clickedAt<120000);
    if(!selected){
      let tab;try{tab=await chrome.tabs.get(tabId);}catch{}
      if(tab?.openerTabId!==undefined){
        links=await session('links_'+tab.openerTabId,[]);
        selected=links.find(l=>l.productKey===identity.key&&Date.now()-l.clickedAt<120000);
        if(selected){const opener=await session('tab_'+tab.openerTabId,{});research=opener.research||selected.research||research;}
      }
    }
    if(selected){await sessionSet('tab_'+tabId,{...base,research:research||selected.research,detail:selected});return {research:research||selected.research,search:selected};}
    return research?{research}:{};
  }
  async function status(){return {...await direct.status(),...await settings()};}
  async function notify(tabId,value){if(tabId===undefined)return;try{await chrome.tabs.sendMessage(tabId,{namespace:'iantoMarket',type:'syncStatus',...value});}catch{}}
  function resume(force=false){void direct.resume(force).catch(error=>console.warn('[Ianto 市场采集]',error.message));}
  let opinionTimer=null;
  function syncOpinions(){clearTimeout(opinionTimer);opinionTimer=setTimeout(()=>{void direct.syncDevelopmentOpinions().catch(error=>console.warn('[Ianto 开发意见]',error.message));},1100);}
  function syncHeaders(){void direct.syncHeaders().catch(error=>console.warn('[Ianto 表头同步]',error.message));}
  async function ensureCapture(tab){
    if(!chrome.scripting?.executeScript||!Number.isInteger(tab?.id)||!C.siteFor(tab.url))return;
    try{
      const result=await chrome.scripting.executeScript({target:{tabId:tab.id},args:[chrome.runtime.getManifest().version],func:version=>{const host=document.getElementById('ianto-market-capture');if(host?.dataset.iantoMarketVersion===version)return true;host?.dispatchEvent(new Event('ianto-market-dispose'));host?.remove();return false;}});
      if(result[0]?.result)return;
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['market_capture/data.js','market_capture/core.js','market_capture/search.js','market_capture/opinion_editor.js','market_capture/content.js']});
    }catch{}
  }
  async function restoreCaptureButtons(){if(chrome.tabs.query)for(const tab of await chrome.tabs.query({}))await ensureCapture(tab);}
  async function handle(message,sender){
    const type=message.type;
    if(['workflowGet','workflowSave','workflowLaunch','workflowSync'].includes(type)){
      if(!isExtension(sender))throw Error('只能在 Ianto 管理调研');
      if(type==='workflowGet'){const value=await workflow.get(),index=await get('index',[]);if(value.sync.pending||!value.sync.at||Date.now()-Date.parse(value.sync.at)>60000)syncWorkflow();return {workflow:{...value,captures:index.map(r=>({batchId:r.batchId,status:r.status,count:r.count,note:r.note,at:r.createdAt,country:r.country,platform:r.platform}))}};}
      if(type==='workflowSync')return {workflow:await workflow.sync()};
      if(type==='workflowLaunch'){const assignment=await workflow.launch(message.input);syncWorkflow();return {assignment};}
      const saved=await workflow.save(message.changes,message.uiState);if(message.changes?.length)syncWorkflow();return {saved};
    }
    if(['workflowChoices','workflowAssign','workflowMark','workflowOpenAnalysis'].includes(type)){
      if(!isExtension(sender)){if(!sender.tab||!C.siteFor(sender.tab.url)||!message.batchId)throw Error('缺少当前采集');await direct.getDevelopmentOpinion(message.batchId,sender.tab.id);}
      if(type==='workflowChoices'){const value=await workflow.choices(message.batchId);if(value.sync.pending||!value.sync.at||Date.now()-Date.parse(value.sync.at)>60000)syncWorkflow();return {workflow:value};}
      if(type==='workflowMark'){const result=await workflow.mark(await direct.captureForWorkflow(message.batchId,isExtension(sender)?undefined:sender.tab.id),message.mark);syncWorkflow();return result;}
      if(type==='workflowAssign'){
        let assignment=message.assignment||{};const batch=await direct.captureForWorkflow(message.batchId,isExtension(sender)?undefined:sender.tab.id);
        if(assignment.newName)assignment=await workflow.launch({name:assignment.newName,productName:assignment.productName||batch.records[0].topic||batch.records[0].query||batch.records[0].title});
        const result=await workflow.assign(batch,assignment);
        if(sender.tab)await mutate(async()=>{const base=await session('tab_'+sender.tab.id,{});await sessionSet('tab_'+sender.tab.id,{...base,research:{...base.research,...result,family:C.siteFor(sender.tab.url)?.family}});});
        syncWorkflow();return {assignment:result};
      }
      const w=await workflow.get(),assignment=w.prefs.memberships[message.batchId]||{},params=new URLSearchParams();
      if(message.batchId)params.set('batch',message.batchId);if(assignment.roundId)params.set('round',assignment.roundId);if(assignment.productGroupId)params.set('product',assignment.productGroupId);
      await chrome.tabs.create({url:chrome.runtime.getURL('market_capture/analysis.html')+'#'+params});return {opened:true};
    }
    if(type==='workflowOpenProduct'){
      if(!isExtension(sender)||!C.productIdentity(message.url))throw Error('请选择有效商品链接');
      const w=await workflow.get(),round=w.prefs.rounds.find(r=>r.id===message.roundId);if(!round)throw Error('先选择一批调研');
      const tab=await chrome.tabs.create({url:'about:blank',active:true});
      const research={researchId:crypto.randomUUID(),roundId:round.id,productGroupId:message.productGroupId||'',topic:message.productName||round.name,taskId:message.taskId||'',country:String(message.country||'').toUpperCase().slice(0,2),family:C.siteFor(message.url).family};
      try{await sessionSet('tab_'+tab.id,{research});await chrome.tabs.update(tab.id,{url:message.url});}catch(e){await sessionSet('tab_'+tab.id,{});try{await chrome.tabs.remove(tab.id);}catch{}throw e;}return {opened:true};
    }
    if(type==='headersCheck'){
      if(!sender.tab||sender.frameId>0)return {watching:false};
      const c=await direct.settings();let url;
      try{url=new URL(sender.url);}catch{return {watching:false};}
      if(url.protocol!=='https:'||!(url.hostname==='feishu.cn'||url.hostname.endsWith('.feishu.cn'))||url.pathname!=='/base/'+c.appToken||url.searchParams.get('table')!==c.tableId)return {watching:false};
      const view=url.searchParams.get('view')||'';
      await direct.syncHeaders({sourceView:/^vew[a-zA-Z0-9]+$/.test(view)?view:''});return {watching:true};
    }
    if(type==='getContext'){
      if(!sender.tab||!C.siteFor(message.url))throw Error('无效的采集页面');
      const s=await settings(),context=await resolveContext(sender,message.url),base=await session('tab_'+sender.tab.id,{});return {...context,enabled:s.enabled,pageTopic:pageTopic(base,message.url)};
    }
    if(type==='setPageTopic'){
      if(!sender.tab||!C.siteFor(message.url)||pageScope(message.url)!==pageScope(sender.tab.url))throw Error('页面已变化，请重新打开本页采集选项');
      await mutate(async()=>{const base=await session('tab_'+sender.tab.id,{});await sessionSet('tab_'+sender.tab.id,{...base,pageTopic:{scope:pageScope(message.url),topic:String(message.topic||'').trim().slice(0,200)}});});
      return {saved:true};
    }
    if(type==='openSearch'){
      if(!isExtension(sender))throw Error('只能从 Ianto 发起调研');
      const site=C.siteFor(message.url);if(!site)throw Error('没有对应平台的采集规则');
      const r=message.research||{};
      const research={researchId:String(r.researchId||''),topic:String(r.topic||'').slice(0,200),originalQuery:String(r.originalQuery||'').slice(0,1000),country:String(r.country||'').slice(0,2),family:site.family,startedAt:new Date().toISOString(),roundId:String(r.roundId||''),productGroupId:String(r.productGroupId||'')};
      const tab=await chrome.tabs.create({url:'about:blank',active:false});
      if(!Number.isInteger(tab?.id))throw Error('未能打开搜索标签页');
      try{
        await sessionSet('tab_'+tab.id,{research});
        await chrome.tabs.update(tab.id,{url:message.url});
      }catch(error){await chrome.storage.session.remove(key('tab_'+tab.id));try{await chrome.tabs.remove(tab.id);}catch{}throw error;}
      return {opened:true,tabId:tab.id};
    }
    if(type==='rememberLink'){
      if(!sender.tab)throw Error('缺少来源页面');
      const current=C.siteFor(sender.tab.url),product=C.productIdentity(message.productUrl);
      if(!current||!product||current.family!==product.family||C.siteFor(message.search?.searchUrl)?.family!==current.family)throw Error('商品与搜索来源不匹配');
      await mutate(async()=>{const base=await session('tab_'+sender.tab.id,{});const context={...message.search,topic:pageTopic(base,sender.tab.url)||base.research?.topic||message.search.query||'',productKey:product.key,position:message.position,sourceBatchId:message.sourceBatchId||'',clickedAt:Date.now(),research:base.research||null};const links=await session('links_'+sender.tab.id,[]);await sessionSet('links_'+sender.tab.id,[context,...links.filter(l=>l.productKey!==context.productKey)].slice(0,30));});return {remembered:true};
    }
    if(type==='enqueue'){
      if(!sender.tab||!C.siteFor(sender.tab.url))throw Error('请在商品或搜索页面采集');
      const batch=message.batch;
      if(!batch?.batchId||!Array.isArray(batch.records)||!batch.records.length||batch.records.length>globalThis.IantoMarketData.MAX_RECORDS||JSON.stringify(batch).length>globalThis.IantoMarketData.MAX_BATCH_SIZE)throw Error('采集数量或内容过大，请减少本次整理范围');
      for(const row of batch.records){const p=C.productIdentity(row.url),s=C.siteFor(sender.tab.url);if(!p||p.family!==s.family)throw Error('采集记录不属于当前平台');}
      const result=await direct.enqueue(batch,sender.tab.id,sender.tab.url);resume();
      const context=await resolveContext(sender,sender.tab.url);if(context.research?.roundId){try{result.assignment=await workflow.assign(batch,context.research);syncWorkflow();}catch(e){result.workflowError=e.message;}}return result;
    }
    if(['opinionGet','opinionSave','opinionLatest'].includes(type)){
      const ownPage=sender.tab&&C.siteFor(sender.tab.url);if(!isExtension(sender)&&!ownPage)throw Error('只能在采集页面或 Ianto 内编辑开发意见');const tabId=isExtension(sender)?undefined:sender.tab.id;
      if(type==='opinionLatest'){if(!ownPage)throw Error('缺少当前采集页面');return {opinion:await direct.latestDevelopmentOpinion(sender.tab.id,sender.tab.url)};}
      if(type==='opinionGet')return {opinion:await direct.getDevelopmentOpinion(message.batchId,tabId)};
      const opinion=await direct.saveDevelopmentOpinion(message.batchId,message.value,tabId,{editorId:message.editorId,sequence:message.sequence});syncOpinions();return {opinion};
    }
    if(type==='openSettings'){await chrome.tabs.create({url:chrome.runtime.getURL('market_capture/settings.html')});return {opened:true};}
    if(type==='analysisGetData'){if(!isExtension(sender))throw Error('只能从 Ianto 调研面板读取分析数据');return {data:await direct.getAnalysisData({force:message.force===true})};}
    if(type==='status'){if(!isExtension(sender))throw Error('无效来源');return status();}
    if(type==='settingsGet'){if(!isExtension(sender))throw Error('无效来源');return {...await status(),settings:{...await settings(),feishu:await direct.settings()}};}
    if(type==='settingsSave'){
      if(!isExtension(sender))throw Error('无效来源');const value=message.settings||{};
      await set('settings',{enabled:value.enabled!==false});
      if(value.feishu)await direct.configure(value.feishu);
      try{await direct.checkConnection();resume(true);syncHeaders();return {saved:true,connected:true};}catch(error){return {saved:true,connected:false,connectionError:error.message};}
    }
    if(type==='retryIncomplete'){if(!isExtension(sender))throw Error('无效来源');const remaining=await direct.prepareRetry(),started=remaining.products>0||remaining.images>0||remaining.opinions>0;if(started)resume(true);syncWorkflow();return {started};}
    if(type==='getRemoteStatus'){if(!isExtension(sender))throw Error('无效来源');return {remote:await direct.getRemoteStatus()};}
    if(type==='exportBatch'){
      if(!isExtension(sender))throw Error('无效来源');
      const batch=await direct.exportBatchInfo(message.batchId);
      const layout=await direct.exportLayout();
      return {...batch,csv:await direct.exportCSV(message.batchId,layout),viewName:layout.viewName,layoutSource:layout.source,warning:layout.warning};
    }
    if(type==='deleteBatch'){if(!isExtension(sender))throw Error('无效来源');await direct.deleteBatch(message.batchId);return {deleted:true};}
    if(type==='clearHistory'){if(!isExtension(sender))throw Error('无效来源');return await direct.clearHistory();}
    throw Error('未知采集操作');
  }
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.namespace!=='iantoMarket')return;
    handle(message,sender).then(value=>sendResponse({ok:true,...value})).catch(error=>sendResponse({ok:false,error:error.message||'采集操作失败'}));return true;
  });
  chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM){resume();syncHeaders();void workflow?.get().then(v=>{if(v.sync.pending||v.sync.error)syncWorkflow();});}});
  chrome.alarms.create(ALARM,{periodInMinutes:1});
  chrome.runtime.onStartup.addListener(()=>{resume();syncHeaders();void restoreCaptureButtons();});
  chrome.runtime.onInstalled.addListener(()=>{resume();syncHeaders();void restoreCaptureButtons();});
  chrome.tabs.onUpdated?.addListener((tabId,change,tab)=>{if(change.status==='complete')void ensureCapture({...tab,id:tabId});});
  resume();syncHeaders();
  chrome.tabs.onRemoved.addListener(tabId=>{void chrome.storage.session.remove([key('tab_'+tabId),key('links_'+tabId)]);});
})();
