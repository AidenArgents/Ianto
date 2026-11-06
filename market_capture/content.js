(function(){
  'use strict';
  if(window.top!==window||document.getElementById('ianto-market-capture'))return;
  const C=globalThis.IantoMarketCore;if(!C||!C.siteFor(location.href))return;
  let context={},lastBatchId='',lastBatchNote='',busy=false,loadController=null,feedbackTimer,lastUrl=location.href,drag=null,ignoreClickUntil=0;
  const POSITION='ianto_market_v1_position';
  const host=document.createElement('div');host.id='ianto-market-capture';
  host.dataset.iantoMarketVersion=chrome.runtime.getManifest().version;
  host.style.cssText='position:fixed;z-index:2147483646;left:0;top:0;width:0;height:0;pointer-events:none';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>
    :host{all:initial;font-family:system-ui,"Microsoft YaHei",sans-serif;color:#14243a}
    .dock{position:fixed;pointer-events:auto;user-select:none;touch-action:none;width:56px;height:56px}
    button{font:inherit;cursor:pointer;box-sizing:border-box}.collect{width:56px;height:56px;border:1px solid #fff7;border-radius:50%;color:#fff;background:#1769e0;box-shadow:0 3px 15px #102b4d40;font-size:14px;font-weight:650;touch-action:none;padding:0}
    .collect:hover{background:#0d56bf}.collect[data-state="saved"]{background:#18805b}.collect[data-state="pending"]{background:#a46b0b}.collect:focus-visible{outline:3px solid #74b7ff;outline-offset:3px}
    .more{position:absolute;right:-4px;bottom:-5px;width:22px;height:22px;border-radius:50%;border:1px solid #d5ddeb;background:#fff;color:#334765;font-size:13px;padding:0;box-shadow:0 1px 5px #0002}
    .panel{position:fixed;pointer-events:auto;box-sizing:border-box;width:min(320px,calc(100vw - 24px));padding:16px;background:#fff;border:1px solid #d5ddeb;border-radius:12px;box-shadow:0 5px 24px #102b4d35;font-size:13px;line-height:1.6}.panel[hidden]{display:none}.panel label{display:block;font-weight:650;margin:4px 20px 8px 0}.panel input{box-sizing:border-box;width:100%;font:inherit;color:#14243a;border:1px solid #becbde;border-radius:6px;padding:8px;user-select:text}.panel p{color:#63738a;margin:8px 0;font-size:12px}.panel .actions{display:flex;gap:8px;flex-wrap:wrap}.panel .actions button{padding:7px 10px;border:1px solid #c9d2df;background:#fff;border-radius:6px;font-size:12px;color:#234069}.panel .actions .save-topic{background:#1769e0;border-color:#1769e0;color:#fff}.panel .close{position:absolute;right:8px;top:8px;border:0;background:none;color:#63738a;font-size:18px}
    .toast{position:fixed;right:20px;bottom:24px;max-width:min(380px,calc(100vw - 40px));background:#14243a;color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;line-height:1.6;box-shadow:0 4px 20px #0003;pointer-events:none;white-space:pre-wrap;display:none}
  </style><div class="dock"><button class="collect" type="button" aria-label="收录当前商品">收录</button><button class="more" type="button" title="本页主题与采集选项" aria-label="本页采集选项" aria-expanded="false">⋯</button></div><div class="panel" role="dialog" aria-label="本页采集选项" hidden><button class="close" type="button" aria-label="关闭采集选项">×</button><label for="page-topic">本页调研主题（可不填）</label><input id="page-topic" type="text" maxlength="200" autocomplete="off" placeholder="留空自动填写"><p class="topic-hint"></p><p>只影响接下来的采集；不会修改已保存记录。</p><div class="actions"><button class="save-topic" type="button">保存本页主题</button><button class="settings" type="button">设置 / 同步记录</button></div></div><div class="toast" role="status" aria-live="polite"></div>`;
  const dock=shadow.querySelector('.dock'),button=shadow.querySelector('.collect'),toast=shadow.querySelector('.toast'),panel=shadow.querySelector('.panel'),topicInput=shadow.querySelector('#page-topic'),more=shadow.querySelector('.more');
  const opinionEditor=globalThis.IantoMarketOpinionEditor?.create({shadow,dock,send,host});
  function show(text,state='',duration=4000){toast.textContent=text;toast.style.display='block';if(state)button.dataset.state=state;clearTimeout(feedbackTimer);if(duration>0)feedbackTimer=setTimeout(()=>{toast.style.display='none';},duration);}
  function placePanel(){if(panel.hidden)return;const r=dock.getBoundingClientRect(),w=panel.offsetWidth,h=panel.offsetHeight;panel.style.left=Math.max(12,Math.min(innerWidth-w-12,r.left-w-12))+'px';panel.style.top=Math.max(12,Math.min(innerHeight-h-12,r.top))+'px';}
  function closePanel(){panel.hidden=true;more.setAttribute('aria-expanded','false');}
  function place(position){const w=Math.max(0,innerWidth-64),h=Math.max(0,innerHeight-64);dock.style.left=Math.round(position.x*w)+'px';dock.style.top=Math.round(position.y*h)+'px';placePanel();opinionEditor?.place();}
  let position={x:0.97,y:0.72};
  chrome.storage.local.get(POSITION).then(data=>{const p=data[POSITION];if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))position={x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};place(position);});
  async function send(type,extra={}){const response=await chrome.runtime.sendMessage({namespace:'iantoMarket',type,...extra});if(!response?.ok)throw Error(response?.error||'请重新加载 Ianto 和当前页面');return response;}
  let initialRegionKey='',initialRegionDone='',initialRegionDeadline=0;
  function applyInitialRegion(){
    const r=context.research;if(!r||context.enabled===false||busy||C.siteFor(location.href)?.family!=='echotik'||C.productIdentity(location.href))return;
    const key=String(r.researchId||r.startedAt||'')+'|'+r.country;
    if(initialRegionKey!==key){initialRegionKey=key;initialRegionDeadline=Date.now()+30000;}
    if(initialRegionDone===key||Date.now()>initialRegionDeadline)return;
    const names={MX:['mexico','méxico','墨西哥'],BR:['brazil','brasil','巴西'],ID:['indonesia','印尼','印度尼西亚'],MY:['malaysia','马来西亚'],PH:['philippines','菲律宾'],TH:['thailand','泰国'],VN:['vietnam','越南'],SG:['singapore','新加坡']};
    const target=[...document.querySelectorAll('[role="radiogroup"][aria-label="Region"] [role="radio"], [role="radiogroup"][aria-label="地区"] [role="radio"]')].find(el=>(names[r.country]||[]).includes(C.clean(el.textContent).toLowerCase()));
    if(!target)return;initialRegionDone=key;
    if(target.getAttribute('aria-checked')!=='true')target.click();
  }
  async function updateContext(){try{context=await send('getContext',{url:location.href,referrer:document.referrer});host.style.display=context.enabled===false?'none':'';}catch{}applyInitialRegion();updateLabel();}
  function updateLabel(){
    if(busy){button.textContent=loadController?'停止':'保存中';button.setAttribute('aria-label',loadController?'停止滚动并保存已识别的商品':'正在保存采集');button.title=loadController?'点击停止滚动并保存已识别的商品；按 Esc 取消且不保存':'正在保存采集，请稍候';return;}
    const detail=Boolean(C.productIdentity(location.href));button.textContent=detail?'收录':'整理';button.setAttribute('aria-label',detail?'收录当前商品':'自动滚动并整理当前搜索页');button.title=(detail?'点击收录当前商品':'点击自动滚动加载并整理本页搜索结果')+'；拖动可移动位置';
  }
  function common(batchId,method,search={}){
    const r=context.research||{};
    return {id:crypto.randomUUID(),batchId,capturedAt:new Date().toISOString(),captureMethod:method,topic:context.pageTopic||search.topic||r.topic||search.query||'',researchId:r.researchId||'',originalQuery:r.originalQuery||'',query:search.query||'',querySource:search.querySource||'',searchUrl:search.searchUrl||'',page:search.page??null,position:search.position??null,sort:search.sort||'',filters:search.filters||'',observedAt:search.observedAt||'',sourceBatchId:search.sourceBatchId||'',note:''};
  }
  async function collect(){
    if(Date.now()<ignoreClickUntil)return;if(busy){loadController?.abort('stop');return;}busy=true;lastBatchId='';lastBatchNote='';button.dataset.state='';
    opinionEditor?.close();closePanel();
    const started=performance.now();
    try{
      const problem=C.pageProblem(document,location.href);if(problem)throw Error(problem);
      await updateContext();
      const batchId=crypto.randomUUID(),identity=C.productIdentity(location.href);let records,searchSnapshot=null,partial='';
      if(identity){
        const fields=C.detailFields(document,location.href,context.search?.country||context.research?.country||'');
        if(!fields?.title)throw Error('商品内容尚未加载或未识别标题，等待页面显示后再点');
        const source=context.search?.productKey===identity.key?context.search:{};
        records=[{...fields,...common(batchId,'详情页单品',source)}];
      }else{
        if(C.pageKind(document,location.href)!=='search')throw Error('请在商品搜索结果页使用整理');
        loadController=new AbortController();updateLabel();
        const result=await globalThis.IantoMarketSearch.collect({signal:loadController.signal,country:context.research?.country||'',onProgress:({count})=>show(`正在自动滚动加载，已识别 ${count} 个商品\n点击「停止」保存已识别内容；按 Esc 取消`,'',0)});
        loadController=null;updateLabel();
        const {search,cards}=result;
        if(!cards.length)throw Error('没有识别到主结果商品卡；请确认搜索结果已显示');
        partial=({stopped:'已手动停止加载',timeout:'页面仍在持续加载',limit:'已达到本次整理容量', 'loading-timeout':'页面加载长时间没有进展','load-more-stalled':'加载更多后没有新增商品','login-required':'平台要求登录后继续加载，请登录后重新整理',unrecognized:`仍有 ${result.unresolvedCount} 张商品卡未能识别`})[result.reason]||'';
        const note=partial?partial+'；仅保存已识别内容，未确认本页全部加载':'';
        records=cards.map(card=>({...card.fields,country:card.fields.country||context.research?.country||'',...common(batchId,'搜索页整理',{...search,position:card.position,observedAt:card.observedAt}),note,completeness:card.fields.completeness.replace('仅列表已展示字段；位置按已加载主结果商品卡顺序，包含广告','本页自动滚动采集，包含广告和重复曝光')+(card.inferred?'；位置按滚动重叠顺序推定':'；位置按本页主结果商品卡顺序')}));
        searchSnapshot={batchId,signature:searchSignature(search),positionFor:result.positionFor};
      }
      const elapsed=Math.round(performance.now()-started);
      const queued=await send('enqueue',{batch:{batchId,records}});lastBatchId=batchId;lastBatchNote=partial?'本次未确认全部加载，可在采集历史查看原因':'';if(searchSnapshot)lastSearchBatch=searchSnapshot;
      void opinionEditor?.open({batchId,count:records.length,method:identity?'详情页单品':'搜索页整理'});
      const status=(partial?`${partial}，已记录 ${records.length} 个商品（未确认全部）`:`已记录 ${records.length} 个商品`)+(queued.workflowError?'\n资料已记录，调研归属待重试：'+queued.workflowError:'');
      show(queued.configured===false?`${status}\n请点旁边的 ⋯ → 设置 / 同步记录，填写飞书配置`:`${status}，后台同步飞书\n${identity?'页面读取':'自动加载与采集'} ${(elapsed/1000).toFixed(1)} 秒`,'pending',partial?8000:4000);
    }catch(error){show(error.message,'pending',6000);}finally{loadController=null;busy=false;updateLabel();ignoreClickUntil=Date.now()+700;}
  }
  let lastSearchBatch=null;
  const searchSignature=s=>JSON.stringify([s?.searchUrl,s?.query,s?.country,s?.page,s?.sort,s?.filters]);
  function remember(event){
    if(!event.isTrusted||event.composedPath().includes(host)||C.productIdentity(location.href))return;
    const target=event.target instanceof Element?event.target.closest('a[href]'):null;if(!target)return;
    const product=C.productIdentity(target.href);if(!product)return;
    const card=C.readCards(document,location.href,{country:context.research?.country||''}).find(item=>item.card.contains(target));if(!card)return;
    const search=C.readSearch(document,location.href,context.research?.country||'');if(!search?.query)return;
    const same=lastSearchBatch?.signature===searchSignature(search);
    const position=same&&lastSearchBatch.positionFor?lastSearchBatch.positionFor(card):card.position;
    const sourceBatchId=same&&position!==null?lastSearchBatch.batchId:'';
    void send('rememberLink',{productUrl:target.href,position,search,sourceBatchId}).catch(()=>{});
  }
  document.addEventListener('pointerdown',remember,true);
  document.addEventListener('contextmenu',remember,true);
  button.addEventListener('pointerdown',event=>{if(event.button!==0)return;drag={x:event.clientX,y:event.clientY,left:parseFloat(dock.style.left)||0,top:parseFloat(dock.style.top)||0,moved:false};button.setPointerCapture(event.pointerId);});
  button.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!drag.moved&&Math.hypot(dx,dy)<6)return;drag.moved=true;event.preventDefault();const w=Math.max(1,innerWidth-64),h=Math.max(1,innerHeight-64);position={x:Math.max(0,Math.min(1,(drag.left+dx)/w)),y:Math.max(0,Math.min(1,(drag.top+dy)/h))};place(position);});
  function endDrag(){if(!drag)return;if(drag.moved){ignoreClickUntil=Date.now()+400;void chrome.storage.local.set({[POSITION]:position});}drag=null;}
  button.addEventListener('pointerup',endDrag);button.addEventListener('pointercancel',endDrag);
  button.addEventListener('click',()=>{void collect();});
  more.addEventListener('click',async()=>{if(!panel.hidden){closePanel();return;}await updateContext();const source=C.productIdentity(location.href)?context.search||{}:C.readSearch(document,location.href)||{};topicInput.value=context.pageTopic||'';shadow.querySelector('.topic-hint').textContent='留空时：'+(source.topic||context.research?.topic||source.query||'没有可靠的来源搜索词，主题留空也可采集');panel.hidden=false;more.setAttribute('aria-expanded','true');placePanel();topicInput.focus();});
  async function saveTopic(){try{await send('setPageTopic',{url:location.href,topic:topicInput.value});await updateContext();closePanel();show(context.pageTopic?'本页主题已保存，可直接采集':'已恢复本次搜索的自动主题');}catch(e){show(e.message);}}
  shadow.querySelector('.save-topic').addEventListener('click',()=>{void saveTopic();});
  topicInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void saveTopic();}});
  shadow.querySelector('.close').addEventListener('click',closePanel);
  shadow.querySelector('.settings').addEventListener('click',()=>{closePanel();void send('openSettings').catch(e=>show(e.message));});
  document.addEventListener('pointerdown',event=>{if(!event.composedPath().includes(host))closePanel();},true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){closePanel();loadController?.abort('cancel');}},true);
  addEventListener('resize',()=>place(position));
  chrome.runtime.onMessage.addListener(message=>{
    if(message?.namespace!=='iantoMarket')return;
    opinionEditor?.message(message);
    if(message.type==='contextChanged')void updateContext();
    if(message.type==='syncStatus'&&message.batchId===lastBatchId){if(message.status==='saved')show(`商品资料已入飞书：${message.count} 个商品`+(lastBatchNote?'\n'+lastBatchNote:'')+(message.images?.pending?'\n首图后台上传，可在采集设置查看状态':message.images?.failed?'\n部分首图失败，可在采集设置重试':''),'saved',6500);else show('记录已保留，等待同步\n'+message.error+(lastBatchNote?'\n'+lastBatchNote:''),'pending',6500);}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.ianto_market_v1_settings)void updateContext();});
  let disposed=false;
  const observer=new MutationObserver(()=>{if(disposed)return;if(!host.isConnected)document.documentElement.appendChild(host);applyInitialRegion();if(location.href!==lastUrl){lastUrl=location.href;lastBatchId='';lastSearchBatch=null;button.dataset.state='';closePanel();opinionEditor?.reset();void opinionEditor?.restore();void updateContext();}});
  host.addEventListener('ianto-market-dispose',()=>{disposed=true;observer.disconnect();clearTimeout(feedbackTimer);loadController?.abort('cancel');opinionEditor?.dispose();document.removeEventListener('pointerdown',remember,true);document.removeEventListener('contextmenu',remember,true);},{once:true});
  document.documentElement.appendChild(host);place(position);void updateContext();void opinionEditor?.restore();observer.observe(document.documentElement,{subtree:true,childList:true});
})();
