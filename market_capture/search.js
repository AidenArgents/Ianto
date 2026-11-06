(function(root,factory){
  const api=factory();root.IantoMarketSearch=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis,function(){
  'use strict';
  const signature=item=>item.key+'|'+(item.fields.ad||'');
  function explicitPosition(node){
    for(let el=node,depth=0;el&&depth<3;el=el.parentElement,depth++){
      for(const [name,offset] of [['aria-posinset',0],['data-item-index',1],['data-virtual-index',1]]){
        const value=el.getAttribute(name);if(value!==null&&/^\d+$/.test(value)&&Number(value)+offset>0)return Number(value)+offset;
      }
    }
    return null;
  }
  function createTracker(){
    const entries=new Map(),nodes=new WeakMap();let previous=[],offset=0,virtual=false,revision=0;
    function observe(items){
      if(!items.length)return;
      const changedNodes=previous.some(p=>!p.node.isConnected)||items.some(i=>{const p=nodes.get(i.card);return p&&p.signature!==signature(i);});
      virtual ||= changedNodes;
      const votes=new Map();
      for(const item of items){
        const sig=signature(item),known=nodes.get(item.card);
        if(known?.signature===sig){const shift=known.position-item.position;if(shift>=0)votes.set(shift,(votes.get(shift)||0)+3);}
        for(const p of previous)if(p.signature===sig){const shift=p.position-item.position;if(shift>=offset)votes.set(shift,(votes.get(shift)||0)+1);}
      }
      if(virtual){
        const best=[...votes].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0];
        offset=best?best[0]:previous.length?Math.max(...previous.map(p=>p.position))-Math.min(...items.map(i=>i.position))+1:0;
      }else offset=0;
      const window=[];
      for(const item of items){
        const sig=signature(item),explicit=explicitPosition(item.card),position=explicit||item.position+offset;
        const old=entries.get(position),fields={...(old?.signature===sig?old.fields:{} )};
        for(const [name,value] of Object.entries(item.fields))if(value!==''&&value!==null&&value!==undefined)fields[name]=value;
        const entry={key:item.key,signature:sig,position,fields,observedAt:new Date().toISOString(),inferred:virtual&&!explicit};
        if(!old||old.signature!==sig||JSON.stringify(old.fields)!==JSON.stringify(fields))revision++;
        entries.set(position,entry);nodes.set(item.card,{signature:sig,position});window.push({node:item.card,signature:sig,position});
      }
      previous=window;
    }
    function positionFor(item){
      const sig=signature(item),explicit=explicitPosition(item.card),known=nodes.get(item.card);
      if(explicit&&entries.get(explicit)?.signature===sig)return explicit;
      if(known?.signature===sig)return known.position;
      if(!virtual)return entries.get(item.position)?.signature===sig?item.position:null;
      const matches=[...entries.values()].filter(e=>e.signature===sig);return matches.length===1?matches[0].position:null;
    }
    return {observe,positionFor,get revision(){return revision;},get count(){return entries.size;},snapshot:()=>[...entries.values()].sort((a,b)=>a.position-b.position)};
  }
  function scrollTarget(doc,core,url){
    for(const card of core.cardElements(doc,url).slice(0,10))for(let el=card.parentElement;el&&el!==doc.body;el=el.parentElement){
      const style=doc.defaultView.getComputedStyle(el);
      if(/auto|scroll|overlay/.test(style.overflowY)&&el.clientHeight>0&&el.scrollHeight>el.clientHeight+8)return el;
    }
    return doc.scrollingElement||doc.documentElement;
  }
  const searchSignature=s=>JSON.stringify([s?.searchUrl,s?.query,s?.country,s?.page,s?.sort,s?.filters]);
  function loadMoreControl(doc,url){
    if(!/(^|\.)temu\.com$/.test(new URL(url).hostname))return null;
    for(const el of doc.querySelectorAll('button, [role="button"]')){
      const label=(el.getAttribute('aria-label')||el.textContent||'').replace(/\s+/g,' ').trim();
      if(!/^(?:See more(?: items)?|Load more(?: items)?|Ver m[aá]s(?: art[ií]culos)?|Mostrar mais(?: itens)?|Carregar mais|Lihat lainnya)$/i.test(label))continue;
      if(el.disabled||el.getAttribute('aria-disabled')==='true'||el.closest('header, nav, footer, aside, [role="dialog"], #ianto-market-capture'))continue;
      const rect=el.getBoundingClientRect();if(rect.height>0&&rect.width>0)return el;
    }
    return null;
  }
  function moreNeedsLogin(doc,url){
    if(!/(^|\.)temu\.com$/.test(new URL(url).hostname))return false;
    return [...doc.querySelectorAll('#mainHeader button, #mainHeader [role="button"], header button, header [role="button"]')].some(el=>/^(?:Sign in\s*\/\s*Register|Iniciar sesi[oó]n\s*\/\s*Registrarse|Entrar\s*\/\s*Registrar)/i.test((el.getAttribute('aria-label')||el.textContent||'').replace(/\s+/g,' ').trim()));
  }
  async function collect({doc=document,win=window,core=globalThis.IantoMarketCore,signal,country='',onProgress=()=>{},limit=globalThis.IantoMarketData.MAX_RECORDS,stepDelay=200,quietTime=2500,maxDuration=600000,loadingTimeout=30000,loadMoreTimeout=5000}={}){
    const url=win.location.href,search=core.readSearch(doc,url,country),scope=searchSignature(search),tracker=createTracker();
    const initial={x:win.scrollX,y:win.scrollY},roots=new Map();let target=scrollTarget(doc,core,url),reason='complete',settledAt=Date.now(),started=Date.now(),lastHeight=-1,lastRevision=-1,moreAttempt=null;
    const aborted=()=>{if(signal?.aborted&&signal.reason!=='stop')throw new DOMException('已取消整理，未保存本次采集','AbortError');if(win.location.href!==url||searchSignature(core.readSearch(doc,url,country))!==scope)throw Error('页面或搜索条件已变化，本次整理已取消');return signal?.aborted;};
    const pause=()=>new Promise(resolve=>{let timer;const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();};timer=setTimeout(done,stepDelay);signal?.addEventListener('abort',done,{once:true});});
    const move=top=>{if(target===doc.scrollingElement)win.scrollTo({left:win.scrollX,top,behavior:'instant'});else target.scrollTo({left:target.scrollLeft,top,behavior:'instant'});};
    function select(next){target=next;if(!roots.has(target))roots.set(target,{x:target.scrollLeft,y:target.scrollTop});move(0);if(target!==doc.scrollingElement)target.scrollIntoView({block:'center',behavior:'instant'});}
    const sample=all=>{tracker.observe(core.readCards(doc,url,{country,...(all?{}:{viewportOnly:true,scrollRoot:target})}));onProgress({count:tracker.count});};
    const loading=()=>{
      const first=core.cardElements(doc,url)[0],root=target!==doc.scrollingElement?target:first?.closest('.s-main-slot, .ui-search-results, .ui-search-layout, .shopee-search-item-result, .ant-table-wrapper, [data-testid="divSRPContentProducts"], [role="grid"], [role="list"]')||first?.parentElement||doc;
      const selector='[aria-busy="true"], [data-loading="true"], .ant-spin-spinning, [role="progressbar"], [class*="skeleton"]';
      return [...(root.matches?.(selector)?[root]:[]),...root.querySelectorAll(selector)].some(el=>{if(el.closest('#ianto-market-capture'))return false;const r=el.getBoundingClientRect();return r.height>0&&r.bottom>0&&r.top<win.innerHeight;});
    };
    try{
      select(target);await pause();aborted();sample(true);
      while(true){
        if(aborted()){reason='stopped';break;}
        const next=scrollTarget(doc,core,url);if(next!==target){select(next);settledAt=Date.now();lastHeight=-1;await pause();continue;}
        sample(false);
        const now=Date.now(),height=target.scrollHeight,viewport=target===doc.scrollingElement?win.innerHeight:target.clientHeight;
        if(height!==lastHeight||tracker.revision!==lastRevision){settledAt=now;lastHeight=height;lastRevision=tracker.revision;}
        if(tracker.count>=limit){reason='limit';break;}
        if(now-started>=maxDuration){reason='timeout';break;}
        const bottom=target.scrollTop+viewport>=height-4,busy=loading();
        if(bottom&&!busy&&now-settledAt>=quietTime){
          const more=loadMoreControl(doc,url);
          if(more){
            if(moreNeedsLogin(doc,url)){reason='login-required';break;}
            const unchanged=moreAttempt?.count===tracker.count&&moreAttempt?.height===height;
            if(unchanged&&now-moreAttempt.at<loadMoreTimeout){await pause();continue;}
            if(unchanged&&moreAttempt.tries>=2){reason='load-more-stalled';break;}
            moreAttempt={count:tracker.count,height,tries:unchanged?moreAttempt.tries+1:1,at:now};
            more.scrollIntoView({block:'center',behavior:'instant'});aborted();more.click();settledAt=now;await pause();continue;
          }
          break;
        }
        if(busy&&now-settledAt>=loadingTimeout){reason='loading-timeout';break;}
        if(!busy||bottom)move(Math.min(height,target.scrollTop+Math.max(40,Math.floor(viewport*0.75))));
        await pause();
      }
      if(!signal?.aborted)sample(false);
      aborted();
      const diagnostics=core.scanCards?.(doc,url,{country})||{unresolvedCount:0};
      if(reason==='complete'&&diagnostics.unresolvedCount>0)reason='unrecognized';
      return {search,cards:tracker.snapshot().slice(0,limit),complete:reason==='complete',reason,unresolvedCount:diagnostics.unresolvedCount,positionFor:tracker.positionFor};
    }finally{
      if(win.location.href===url&&searchSignature(core.readSearch(doc,url,country))===scope){
        for(const [el,position] of roots)if(el!==doc.scrollingElement&&el.isConnected)el.scrollTo({left:position.x,top:position.y,behavior:'instant'});
        win.scrollTo({left:initial.x,top:initial.y,behavior:'instant'});
      }
    }
  }
  return {collect,createTracker,explicitPosition,loadMoreControl,moreNeedsLogin};
});
