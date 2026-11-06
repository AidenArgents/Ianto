(function(root){
  'use strict';
  const PREFIX='ianto_market_v1_',key=name=>PREFIX+name;
  const {normalizeBatch,encodeRecord,FIELDS}=root.IantoMarketData;
  const {FeishuClient}=root.IantoMarketFeishu;
  const headerModule=root.IantoMarketHeaders||(typeof require==='function'?require('./headers.js'):null);
  const table=root.IantoMarketTable||(typeof require==='function'?require('./table.js'):null);
  const analytics=root.IantoMarketAnalytics||(typeof require==='function'?require('./analytics.js'):null);
  const DEFAULTS={appId:'cli_aa505b2b3eb81d19',appToken:'RCyGbyMxIa1I20skQPkck4CXnIb',tableId:'tblGq3Yd4PM3jEK0'};
  const target=c=>[c.appId,c.appToken,c.tableId].join(':');
  const imageCounts=items=>({total:items.length,saved:items.filter(i=>i.status==='saved').length,pending:items.filter(i=>i.status==='pending').length,failed:items.filter(i=>i.status==='failed').length});
  const tableUrl=c=>'https://my.feishu.cn/base/'+c.appToken+'?table='+c.tableId;
  const defaultExportFields=table.columns.map(id=>table.bindings[id]);
  const exportDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  function parseConfig(value,previous={}){
    const config={appId:String(value.appId||'').trim(),appSecret:String(value.appSecret||'').trim()||(value.appId===previous.appId?previous.appSecret:''),appToken:String(value.appToken||'').trim(),tableId:String(value.tableId||'').trim()};
    if(value.feishuUrl){
      let u;try{u=new URL(value.feishuUrl);}catch{throw Error('飞书表格链接无效');}
      if(u.protocol!=='https:'||!(u.hostname==='feishu.cn'||u.hostname.endsWith('.feishu.cn')))throw Error('请填写飞书多维表格链接');
      config.appToken=u.pathname.match(/^\/base\/([a-zA-Z0-9]+)/)?.[1]||'';config.tableId=u.searchParams.get('table')||'';
    }
    if(!/^cli_[a-zA-Z0-9]+$/.test(config.appId)||!config.appSecret)throw Error('请填写 App ID 和 App Secret');
    if(!/^[a-zA-Z0-9]+$/.test(config.appToken)||!/^tbl[a-zA-Z0-9]+$/.test(config.tableId))throw Error('请复制包含 table 参数的数据表链接');
    config.revision=crypto.randomUUID();return config;
  }
  function create({storage,tokenStorage,notify=async()=>{},fetcher=fetch,retryDelay=30000,maxImageAttempts=3,clock=()=>Date.now()}){
    let serial=Promise.resolve(),textWork=null,imageWork=null,opinionWork=null,remoteWork=null,analysisWork=null,clientRevision='',client=null;
    const runningImages=new Set(),historyMetadata=new Map(),opinionMetadata=new Map();
    const get=async(name,fallback)=>{const result=await storage.get(key(name));return result[key(name)]??fallback;};
    const headers=headerModule.create({get,set:(name,value)=>storage.set({[key(name)]:value}),clock});
    const change=fn=>{const work=serial.then(fn);serial=work.catch(()=>{});return work;};
    async function put(job){
      const index=await get('index',[]),first=job.batch.records[0],entry={batchId:job.batch.batchId,status:job.receipts?'saved':'pending',count:job.batch.records.length,at:job.savedAt||job.createdAt,createdAt:job.createdAt,country:first.country||'',platform:first.platform||'',method:first.captureMethod,url:first.url,topic:first.topic,note:first.note||'',error:job.error||'',nextAttempt:job.nextAttempt||0,images:imageCounts(job.images||[])};
      if(job.sourceUrl)entry.sourceUrl=job.sourceUrl;if(Number.isInteger(job.tabId))entry.tabId=job.tabId;
      const position=index.findIndex(m=>m.batchId===entry.batchId);if(position<0)index.push(entry);else index[position]=entry;
      await storage.set({[key('batch_'+entry.batchId)]:job,[key('index')]:index});
    }
    const load=id=>get('batch_'+id,null);
    async function update(id,fn){return change(async()=>{const job=await load(id);if(!job)throw Error('未找到本地采集记录');await fn(job);await put(job);return job;});}
    function imagesFor(job,checkExisting=false){
      const receipts=new Map(job.receipts.map(r=>[r.id,r.recordId]));
      return job.batch.records.filter(r=>r.image).map(row=>({id:row.id,recordId:receipts.get(row.id),url:row.image,title:row.title,productUrl:row.url,status:'pending',attempts:0,nextAttempt:0,checkExisting}));
    }
    async function config(){const c=await get('credentials',null);if(!c?.appSecret)throw Error('请先在采集设置中填写飞书配置');return c;}
    async function api(c){
      if(!client||clientRevision!==c.revision){
        clientRevision=c.revision;
        const tokenKey=key('tenantToken');
        const cache={get:async()=>{const v=(await tokenStorage.get(tokenKey))[tokenKey];return v?.revision===c.revision?v.token:null;},set:token=>tokenStorage.set({[tokenKey]:{revision:c.revision,token}})};
        client=new FeishuClient(c,fetcher,cache);
      }
      return client;
    }
    async function preparedApi(c,force=false){
      const remote=await api(c);remote.setSchema(await headers.schema(remote,c,force));return remote;
    }
    async function settings(){const c=await get('credentials',null);return {...(c||DEFAULTS),appSecret:undefined,hasSecret:Boolean(c?.appSecret),feishuUrl:tableUrl(c||DEFAULTS)};}
    async function configure(value){const c=parseConfig(value,await get('credentials',{}));await headers.idle();await storage.set({[key('credentials')]:c,[key('connection')]:null});client=null;return settings();}
    async function checkConnection(){
      const c=await config();try{
        const remote=await preparedApi(c,true),info=remote.schema,expected=new Map(FIELDS.map(f=>[f.field_name,f.type]));
        const wrong=info.fields.filter(f=>info.bindings[f.field_id]&&expected.get(info.bindings[f.field_id])!==f.type);
        for(const name of ['采集编号','商品标题','商品链接','首图'])remote.fieldName(name);
        if(wrong.length)throw Error('目标表字段类型不匹配：'+wrong.map(f=>f.field_name).join('、'));
        const checked={connected:true,at:new Date(clock()).toISOString(),target:target(c)};await storage.set({[key('connection')]:checked});return checked;
      }catch(error){await storage.set({[key('connection')]:{connected:false,at:new Date(clock()).toISOString(),target:target(c),error:error.message}});throw error;}
    }
    async function getRemoteStatus(){
      const failed=error=>({ok:false,count:null,recordTotal:null,blankCount:null,checkedAt:new Date(clock()).toISOString(),error:String(error.message||'飞书读取失败')});
      let c;try{c=await config();}catch(error){return failed(error);}
      const workKey=target(c)+':'+c.revision;if(remoteWork?.key===workKey)return remoteWork.promise;
      const work={key:workKey,promise:null};
      work.promise=(async()=>{
        try{
          const remote=await preparedApi(c),fields=['平台商品ID','商品标题','商品链接'].map(name=>remote.fieldName(name,false)).filter(Boolean);
          if(!fields.length)throw Error('飞书缺少用于识别商品的字段');
          // Count on Feishu, returning one row per query instead of downloading the table.
          const [all,products]=await Promise.all([
            remote.request(remote.tablePath()+'/records?'+new URLSearchParams({page_size:'1',field_names:JSON.stringify(fields)})),
            remote.request(remote.tablePath()+'/records/search?page_size=1',{method:'POST',body:{field_names:fields,filter:{conjunction:'or',conditions:fields.map(field_name=>({field_name,operator:'isNotEmpty',value:[]}))},automatic_fields:false}})
          ]);
          if(!Number.isInteger(all.total)||all.total<0||!Number.isInteger(products.total)||products.total<0||products.total>all.total)throw Error('飞书数量返回不完整或读取期间发生变化，请再刷新一次');
          return {ok:true,count:products.total,recordTotal:all.total,blankCount:all.total-products.total,checkedAt:new Date(clock()).toISOString(),error:''};
        }catch(error){return failed(error);}
      })();
      remoteWork=work;try{return await work.promise;}finally{if(remoteWork===work)remoteWork=null;}
    }
    async function getAnalysisData({force=false}={}){
      const c=await config(),scope=target(c),cached=await get('analysis_data',null);
      if(!force&&cached?.target===scope)return {...cached,cached:true};
      const workKey=scope+':'+c.revision;
      if(analysisWork?.key===workKey)return analysisWork.promise;
      const work={key:workKey,promise:null};
      work.promise=(async()=>{
        const remote=await preparedApi(c,true),records=[],seen=new Set(),tokens=new Set();let token='',total=null;
        for(;;){
          const params=new URLSearchParams({page_size:'500',...(token?{page_token:token}:{})});
          const page=await remote.request(remote.tablePath()+'/records?'+params);
          if(!Array.isArray(page.items)||!Number.isInteger(page.total)||page.total<0||typeof page.has_more!=='boolean')throw Error('飞书未返回完整商品列表');
          if(total!==null&&total!==page.total)throw Error('读取时飞书数据发生变化，请刷新重试');total=page.total;
          for(const record of page.items){if(!record.record_id||seen.has(record.record_id))throw Error('飞书商品分页重复或缺少记录编号，请刷新重试');seen.add(record.record_id);records.push(analytics.decodeRecord(record,remote.schema));}
          if(records.length>100000)throw Error('当前超过十万条记录，请缩小源表范围后读取');
          if(!page.has_more)break;
          if(!page.page_token||tokens.has(page.page_token))throw Error('飞书商品分页未完成，请刷新重试');token=page.page_token;tokens.add(token);
        }
        if(total!==null&&total!==records.length)throw Error('飞书商品数量与分页结果不一致，请刷新重试');
        const products=records.filter(r=>r.title||r.productId||r.url),data={target:scope,records:products,recordTotal:records.length,blankCount:records.length-products.length,loadedAt:new Date(clock()).toISOString(),feishuUrl:tableUrl(c),cached:false};
        if((await config()).revision!==c.revision)throw Error('飞书配置已改变，请重新刷新数据');
        await storage.set({[key('analysis_data')]:data});return data;
      })();
      analysisWork=work;try{return await work.promise;}finally{if(analysisWork===work)analysisWork=null;}
    }
    async function enqueue(input,tabId,sourceUrl=''){
      const batch=normalizeBatch(input);
      await change(async()=>{const old=await load(batch.batchId);if(old){if(JSON.stringify(old.batch)!==JSON.stringify(batch))throw Error('同一采集批次内容已改变');return;}await put({batch,tabId,sourceUrl,createdAt:new Date(clock()).toISOString(),attempted:false,attempts:0,error:'',nextAttempt:0,receipts:null,images:[]});});
      return {status:'queued',batchId:batch.batchId,count:batch.records.length,configured:Boolean((await get('credentials',null))?.appSecret)};
    }
    async function sync(force=false){
      if(textWork){await textWork;return sync(force);}
      textWork=(async()=>{
        let c;try{c=await config();}catch{return;}
        for(const entry of (await get('index',[])).filter(m=>m.status==='pending').slice(0,20)){
          let job=await load(entry.batchId);if(!job||job.receipts||(!force&&job.nextAttempt>clock()))continue;
          try{
            if(job.target&&job.target!==target(c))throw Error('该批次属于另一张飞书表，请恢复原配置后重试');
            const reconcile=job.attempted;
            job=await update(entry.batchId,j=>{j.target=target(c);j.attempted=true;});
            const receipts=await (await preparedApi(c)).writeBatch(job.batch,{reconcile});
            if(receipts.length!==job.batch.records.length||receipts.some((r,i)=>!r.recordId||r.id!==job.batch.records[i].id))throw Error('飞书回执不完整，记录已保留等待核对');
            job=await update(entry.batchId,j=>{j.receipts=receipts;j.savedAt=new Date(clock()).toISOString();j.error='';j.nextAttempt=0;j.images=imagesFor({...j,receipts},reconcile);});
            await notify(job.tabId,{batchId:entry.batchId,status:'saved',count:receipts.length,images:imageCounts(job.images)});
          }catch(error){
            job=await update(entry.batchId,j=>{j.attempts++;j.error=String(error.message||'飞书写入失败').slice(0,300);j.nextAttempt=clock()+Math.min(300000,15000*2**Math.min(j.attempts,5));});
            await notify(job.tabId,{batchId:entry.batchId,status:'pending',error:job.error});break;
          }
        }
      })();
      try{await textWork;}finally{textWork=null;}
    }
    async function pickImage(c){
      return change(async()=>{
        const index=await get('index',[]);if(index.some(m=>m.status==='pending'))return null;
        for(const entry of index.filter(m=>m.images?.pending)){
          const job=await load(entry.batchId);if(!job||job.target&&job.target!==target(c))continue;
          const item=job.images.find(i=>i.status==='pending'&&i.nextAttempt<=clock()&&!runningImages.has(i.id));if(!item)continue;
          runningImages.add(item.id);item.attempts++;await put(job);return {batchId:entry.batchId,item:{...item}};
        }
        return null;
      });
    }
    async function syncImages(){
      if(imageWork){await imageWork;return syncImages();}
      imageWork=(async()=>{
      let c;try{c=await config();}catch{return;}
      await Promise.all(Array.from({length:3},async()=>{
        for(;;){const selected=await pickImage(c);if(!selected)break;const {batchId,item}=selected;
          try{
            const remote=await preparedApi(c);
            const existing=item.checkExisting||item.attempts>1||item.token?await remote.readImage(item.recordId):null;
            if(!existing){
              if(!item.token){item.token=await remote.uploadImage(item.url);await update(batchId,j=>{j.images.find(i=>i.id===item.id).token=item.token;});}
              await remote.attachImage(item.recordId,item.token);
            }
            await update(batchId,j=>Object.assign(j.images.find(i=>i.id===item.id),{status:'saved',token:existing||item.token,error:'',nextAttempt:0}));
          }catch(error){await update(batchId,j=>Object.assign(j.images.find(i=>i.id===item.id),{status:item.attempts<maxImageAttempts?'pending':'failed',error:String(error.message||'首图处理失败').slice(0,300),nextAttempt:item.attempts<maxImageAttempts?clock()+retryDelay*item.attempts:0}));}
          finally{runningImages.delete(item.id);}
        }
      }));
      })();
      try{await imageWork;}finally{imageWork=null;}
    }
    const opinionState=(meta,note)=>({batchId:meta.batchId,value:note?.value||'',revision:note?.revision||'',status:!note?'empty':note.revision===note.syncedRevision?'saved':'pending',error:note?.error||'',count:meta.count,method:meta.method});
    async function opinionJob(batchId,tabId){if(!/^[a-f0-9-]{36}$/i.test(batchId||''))throw Error('无效的采集批次');let meta=opinionMetadata.get(batchId);if(!meta){const job=await load(batchId);if(!job)throw Error('这次采集历史已清除，无法继续编辑');meta={batchId,tabId:job.tabId,sourceUrl:job.sourceUrl,count:job.batch.records.length,method:job.batch.records[0].captureMethod};opinionMetadata.set(batchId,meta);}if(tabId!==undefined&&meta.tabId!==tabId)throw Error('不能编辑其他页面的开发意见');return meta;}
    async function getDevelopmentOpinion(batchId,tabId){return opinionState(await opinionJob(batchId,tabId),await get('opinionDraft_'+batchId,null));}
    async function latestDevelopmentOpinion(tabId,url){const entries=(await get('index',[])).filter(entry=>entry.tabId===tabId&&entry.sourceUrl===url).reverse();for(const entry of entries){const meta=await opinionJob(entry.batchId).catch(()=>null);if(meta)return opinionState(meta,await get('opinionDraft_'+entry.batchId,null));}return null;}
    async function saveDevelopmentOpinion(batchId,value,tabId,client={}){
      if(typeof value!=='string'||value.length>20000)throw Error('开发意见最多20000字，请保留在这个长度以内');
      const meta=await opinionJob(batchId,tabId);
      return change(async()=>{const old=await get('opinionDraft_'+batchId,null);if(client.editorId&&old?.editorId===client.editorId&&Number.isInteger(client.sequence)&&client.sequence<old.sequence)return opinionState(meta,old);if(old?.value===value||!old&&value==='')return opinionState(meta,old);const note={...old,value,revision:crypto.randomUUID(),editorId:typeof client.editorId==='string'?client.editorId.slice(0,100):'',sequence:Number.isInteger(client.sequence)?client.sequence:0,error:'',nextAttempt:clock()+900,updatedAt:new Date(clock()).toISOString()},pending=await get('opinionPending',[]);await storage.set({[key('opinionDraft_'+batchId)]:note,[key('opinionPending')]:[...new Set([...pending,batchId])]});return opinionState(meta,note);});
    }
    async function syncDevelopmentOpinions(force=false){
      if(opinionWork){await opinionWork;return syncDevelopmentOpinions(force);}
      opinionWork=(async()=>{
        for(const batchId of await get('opinionPending',[])){
          const job=await load(batchId),note=await get('opinionDraft_'+batchId,null);if(!job?.receipts||!note||!force&&note.nextAttempt>clock())continue;
          try{
            const c=await config();if(job.target&&job.target!==target(c))throw Error('该次采集属于另一张表，请恢复原配置');
            let remote=await preparedApi(c,true),field=remote.schema.fields.find(f=>remote.schema.bindings[f.field_id]==='开发意见');
            if(!field){await remote.request(remote.tablePath()+'/fields',{method:'POST',body:{field_name:'开发意见',type:1}});remote=await preparedApi(c,true);field=remote.schema.fields.find(f=>remote.schema.bindings[f.field_id]==='开发意见');}
            if(!field||field.type!==1)throw Error('开发意见字段需要为文本类型');
            await remote.writeDevelopmentOpinion(job.receipts,note.value);
            await change(async()=>{const latest=await get('opinionDraft_'+batchId,null);if(latest?.revision===note.revision)await storage.set({[key('opinionDraft_'+batchId)]:{...latest,syncedRevision:note.revision,error:'',nextAttempt:0},[key('opinionPending')]:(await get('opinionPending',[])).filter(id=>id!==batchId)});});
            const result=await getDevelopmentOpinion(batchId).catch(()=>null);if(result)await notify(job.tabId,{type:'opinionStatus',...result});
          }catch(error){
            await change(async()=>{const latest=await get('opinionDraft_'+batchId,null);if(latest?.revision===note.revision)await storage.set({[key('opinionDraft_'+batchId)]:{...latest,error:String(error.message||'开发意见同步失败'),nextAttempt:clock()+30000}});});
            const result=await getDevelopmentOpinion(batchId).catch(()=>null);if(result)await notify(job.tabId,{type:'opinionStatus',...result});
          }
        }
      })();
      try{await opinionWork;}finally{opinionWork=null;}
    }
    async function resume(force=false){await sync(force);await Promise.all([syncImages(),syncDevelopmentOpinions(force)]);}
    async function prepareRetry(){
      await config();return change(async()=>{
        let products=0,images=0,opinions=0;
        for(const id of await get('opinionPending',[])){const note=await get('opinionDraft_'+id,null);if(note){opinions++;await storage.set({[key('opinionDraft_'+id)]:{...note,nextAttempt:0}});}}
        for(const entry of (await get('index',[])).filter(m=>m.status==='pending'||m.images?.pending||m.images?.failed)){
          const job=await load(entry.batchId);if(!job)continue;
          if(!job.receipts){products+=job.batch.records.length;continue;}
          let changed=false;
          for(const item of job.images||[])if(item.status==='pending'||item.status==='failed'){
            images++;if(runningImages.has(item.id))continue;
            Object.assign(item,{status:'pending',attempts:0,nextAttempt:0,error:'',checkExisting:true});changed=true;
          }
          if(changed)await put(job);
        }
        return {products,images,opinions};
      });
    }
    async function status(){
      const index=await get('index',[]);
      const images={total:0,saved:0,pending:0,failed:0,failures:[]};for(const m of index)for(const k of ['total','saved','pending','failed'])images[k]+=m.images?.[k]||0;
      for(const m of index.filter(m=>m.images?.failed).slice(-20)){const j=await load(m.batchId);images.failures.push(...(j?.images||[]).filter(i=>i.status==='failed').map(i=>({title:i.title,productUrl:i.productUrl,error:i.error})));}images.failures=images.failures.slice(-20);
      const c=await get('credentials',null),connection=await get('connection',null);
      const headerError=await get('headerError',null),opinionPending=await get('opinionPending',[]),opinionFailures=[];for(const id of opinionPending){const note=await get('opinionDraft_'+id,null);if(note?.error)opinionFailures.push(note.error);}
      async function summary(entry){
        let metadata=historyMetadata.get(entry.batchId);
        if(!metadata&&(typeof entry.country!=='string'||typeof entry.platform!=='string')){
          const first=(await load(entry.batchId))?.batch?.records?.[0];
          if(first){metadata={country:first.country||'',platform:first.platform||''};historyMetadata.set(entry.batchId,metadata);}
        }
        return {...entry,country:entry.country??metadata?.country??'',platform:entry.platform??metadata?.platform??'',canExport:true};
      }
      const [pending,history]=await Promise.all([
        Promise.all(index.filter(m=>m.status==='pending').map(summary)),
        Promise.all(index.filter(m=>m.status==='saved').sort((a,b)=>b.at.localeCompare(a.at)).slice(0,50).map(summary))
      ]);
      return {mode:'direct',feishuConfigured:Boolean(c?.appSecret),feishuUrl:tableUrl(c||DEFAULTS),connection:connection&&c&&connection.target===target(c)?connection:null,headerError:c&&headerError?.target===target(c)?headerError.error:'',pendingCount:index.filter(m=>m.status==='pending').reduce((n,m)=>n+m.count,0),pending,saved:index.filter(m=>m.status==='saved').reduce((n,m)=>n+m.count,0),history,images,opinions:{pending:opinionPending.length,failures:opinionFailures}};
    }
    async function syncHeaders(options={}){
      const c=await get('credentials',null);if(!c?.appSecret)return null;
      try{
        const layout=await headers.sync(await api(c),c,options);
        await storage.set({[key('headerError')]:null});return layout;
      }catch(error){await storage.set({[key('headerError')]:{target:target(c),error:error.message}});throw error;}
    }
    async function exportLayout(){
      const layout=await syncHeaders();
      if(layout)return layout;
      return {fields:defaultExportFields,columns:defaultExportFields.map(name=>({name,source:name})),viewName:'统一表头',source:'default',warning:'尚未配置飞书，使用默认表头。'};
    }
    async function exportBatchInfo(batchId){
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(batchId||''))throw Error('请选择一次采集，再导出该次 CSV');
      const job=await load(batchId);if(!job?.batch?.records?.length)throw Error('这次采集没有完整的本地商品数据，无法导出');
      const first=job.batch.records[0],at=exportDate.format(new Date(job.createdAt||first.capturedAt)).replace(/\D/g,'');
      return {batchId,count:job.batch.records.length,capturedAt:first.capturedAt,captureMethod:first.captureMethod,filename:`Ianto-${first.captureMethod==='搜索页整理'?'搜索页':'单商品'}-${at}-${batchId.slice(0,8)}.csv`};
    }
    async function exportCSV(batchId,layout=null){
      await exportBatchInfo(batchId);const job=await load(batchId),opinion=await get('opinionDraft_'+batchId,null),rows=[];for(const row of job.batch.records){const fields=encodeRecord(row);if(opinion)fields['开发意见']=opinion.value;fields['首图']=row.image||'';for(const name of ['采集时间','搜索观察时间'])if(Number.isFinite(fields[name]))fields[name]=exportDate.format(new Date(fields[name]));rows.push(fields);}
      layout=layout||await exportLayout();
      const columns=layout.columns||layout.fields.map(name=>({name,source:name})),cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
      return '\uFEFF'+[columns.map(c=>cell(c.name)).join(','),...rows.map(r=>columns.map(c=>cell(r[c.source])).join(','))].join('\r\n');
    }
    async function deleteBatch(batchId){
      if(typeof batchId!=='string'||!batchId||batchId.length>200||/[\x00-\x1f]/.test(batchId))throw Error('无效的批次 ID');
      await change(async()=>{
        const index=await get('index',[]);
        await storage.set({[key('index')]:index.filter(m=>m.batchId!==batchId)});
        await storage.remove([key('batch_'+batchId),key('opinionDraft_'+batchId)]);
        const pending=await get('opinionPending',[]);if(pending.includes(batchId))await storage.set({[key('opinionPending')]:pending.filter(id=>id!==batchId)});
        historyMetadata.delete(batchId);opinionMetadata.delete(batchId);
      });
    }
    async function clearHistory(){
      return change(async()=>{
        const all=await storage.get(null),index=all[key('index')]||[],pending=index.filter(m=>m.status==='pending');
        const pendingIds=new Set(pending.map(m=>m.batchId)),removedIds=new Set(index.filter(m=>m.status!=='pending').map(m=>m.batchId));
        const prefix=key('batch_'),remove=[];
        for(const [name,job] of Object.entries(all))if(name.startsWith(prefix)){
          const id=name.slice(prefix.length);if(!pendingIds.has(id)&&(job?.receipts||removedIds.has(id))){remove.push(name);removedIds.add(id);}
        }
        await storage.set({[key('index')]:pending});
        if(remove.length)await storage.remove(remove);
        const noteKeys=Object.keys(all).filter(name=>name.startsWith(key('opinionDraft_'))&&!pendingIds.has(name.slice(key('opinionDraft_').length)));if(noteKeys.length)await storage.remove(noteKeys);
        const opinionQueue=(all[key('opinionPending')]||[]).filter(id=>pendingIds.has(id));if(all[key('opinionPending')])await storage.set({[key('opinionPending')]:opinionQueue});
        for(const id of removedIds){historyMetadata.delete(id);opinionMetadata.delete(id);}
        return {cleared:removedIds.size,remainingPending:pending.length};
      });
    }
    async function workflowAccess(connected=false){const c=connected?await config():await settings();return {appId:c.appId,appToken:c.appToken,tableId:c.tableId,...(connected?{client:await api(c)}:{})};}
    async function captureForWorkflow(id,tabId){await getDevelopmentOpinion(id,tabId);const job=await load(id);if(!job)throw Error('采集记录已不存在');return job.batch;}
    return {settings,configure,checkConnection,getRemoteStatus,getAnalysisData,enqueue,sync,syncImages,syncDevelopmentOpinions,getDevelopmentOpinion,latestDevelopmentOpinion,saveDevelopmentOpinion,resume,prepareRetry,status,syncHeaders,exportLayout,exportBatchInfo,exportCSV,deleteBatch,clearHistory,workflowAccess,captureForWorkflow};
  }
  root.IantoMarketDirect={create,parseConfig,DEFAULTS};
  if(typeof module==='object'&&module.exports)module.exports=root.IantoMarketDirect;
})(globalThis);
