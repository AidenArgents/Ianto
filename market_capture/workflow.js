(function(root,factory){const api=factory();root.IantoMarketWorkflow=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
  'use strict';
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim(),word=v=>clean(v).normalize('NFC').toLocaleLowerCase('und');
  const day=v=>new Date(typeof v==='number'?v:Date.parse(v)).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
  const target=c=>[c.appId,c.appToken,c.tableId].join(':'),prefsKey=t=>'ianto_research_preferences:'+t;
  const defaults=()=>({rounds:[],groupings:{},views:[],annotations:{},reviewScopes:{},labelRules:[],conclusions:{},tasks:{},memberships:{},batchMarks:{}});
  const sections=new Set(['rounds','groupings','views','annotations','reviewScopes','labelRules','conclusions','tasks','memberships','batchMarks']);
  function matchesFollowup(task,record){const identity=String(task.entityKey||'').split('|');if(identity.length>=3){if(identity[0]!==record.country||identity[1]!==record.platform)return false;return identity[2]===(record.productId||record.url||record.id);}return Boolean(task.url&&record.url===task.url);}
  function chunksOf(text){const chunks=[];for(let start=0;start<text.length;){let end=Math.min(text.length,start+8000);if(end<text.length&&/[\uD800-\uDBFF]/.test(text[end-1])&&/[\uDC00-\uDFFF]/.test(text[end]))end--;chunks.push(text.slice(start,end));start=end;}return chunks.length?chunks:[''];}
  function documents(prefs={}){
    const out={};const put=(path,value)=>out[JSON.stringify(path)]=value;
    for(const k of ['rounds','views','labelRules'])for(const v of prefs[k]||[])put([k,v.id],v);
    for(const [round,groups]of Object.entries(prefs.groupings||{}))for(const v of groups)put(['groupings',round,v.id],v);
    for(const [round,values]of Object.entries(prefs.reviewScopes||{}))for(const [id,v]of Object.entries(values))put(['reviewScopes',round,id],v);
    for(const [round,values]of Object.entries(prefs.tasks||{}))for(const v of values)put(['tasks',round,v.id],v);
    for(const k of ['annotations','conclusions','memberships','batchMarks'])for(const [id,v]of Object.entries(prefs[k]||{}))put([k,id],v);
    return out;
  }
  function diff(before,after){const a=documents(before),b=documents(after);return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(k=>JSON.stringify(a[k])!==JSON.stringify(b[k])).map(k=>({path:JSON.parse(k),value:b[k]??null,deleted:!Object.hasOwn(b,k)}));}
  function validPath(p){return Array.isArray(p)&&sections.has(p[0])&&p.length===(['groupings','reviewScopes','tasks'].includes(p[0])?3:2)&&p.slice(1).every(s=>typeof s==='string'&&s.length>0&&s.length<2500&&!['__proto__','constructor','prototype'].includes(s));}
  function apply(prefs,changes){const out=structuredClone({...defaults(),...prefs});for(const {path:p,value,deleted}of changes){if(!validPath(p))throw Error('调研保存路径无效');if(JSON.stringify(value).length>1000000)throw Error('单条调研内容过大');const [section,key,id]=p;if(['rounds','views','labelRules'].includes(section)){out[section]=out[section].filter(v=>v.id!==key);if(!deleted)out[section].push({...value,id:key});}else if(['groupings','tasks'].includes(section)){out[section][key]=(out[section][key]||[]).filter(v=>v.id!==id);if(!deleted)out[section][key].push({...value,id});}else if(section==='reviewScopes'){out[section][key] ||= {};if(deleted)delete out[section][key][id];else out[section][key][id]=value;}else if(deleted)delete out[section][key];else out[section][key]=value;}return out;}
  function create({storage,access,clock=()=>Date.now()}){
    let serial=Promise.resolve(),work=null;const key=t=>'ianto_workflow_v1:'+t;
    const change=fn=>{const p=serial.then(fn);serial=p.catch(()=>{});return p;};
    async function context(){const c=await access(false);return {c,t:target(c),k:prefsKey(target(c))};}
    async function read(ctx){const v=await storage.get(ctx.k);return {...defaults(),...v[ctx.k]};}
    async function meta(ctx){const v=await storage.get(key(ctx.t));return v[key(ctx.t)]||{pending:{},seen:{},cloudAt:'',error:''};}
    async function save(changes,uiState){if(!Array.isArray(changes)||changes.length>30000)throw Error('调研保存内容无效');return change(async()=>{const ctx=await context(),prefs=apply(await read(ctx),changes),m=await meta(ctx);for(const entry of changes)m.pending[JSON.stringify(entry.path)]={...entry,revision:crypto.randomUUID(),at:clock()};if(uiState)prefs.state=uiState;await storage.set({[ctx.k]:prefs,[key(ctx.t)]:m});return {target:ctx.t,pending:Object.keys(m.pending).length};});}
    async function get(){await serial;const ctx=await context(),prefs=await read(ctx),m=await meta(ctx);return {target:ctx.t,prefs,sync:{pending:Object.keys(m.pending).length,at:m.cloudAt,error:m.error}};}
    async function launch(input={}){return change(async()=>{
      const ctx=await context(),before=await read(ctx),prefs=structuredClone(before);let round=prefs.rounds.find(r=>r.id===input.roundId);
      if(input.roundId&&!round)throw Error('这批调研已不存在，请重新选择');
      if(!round){round={id:crypto.randomUUID(),name:clean(input.name||input.word).slice(0,100)||'未命名调研',scope:{from:'',to:'',batchIds:[]},linked:true,phase:'采集中',createdAt:new Date(clock()).toISOString()};prefs.rounds.push(round);}
      if(round.phase==='已完成')round.phase='采集中';
      prefs.groupings[round.id] ||= [];let product=prefs.groupings[round.id].find(p=>p.id===input.productId);
      if(input.productId&&!product)throw Error('产品组已不存在，请重新选择');
      if(!product){const name=clean(input.productName||input.name||input.word)||'独立商品';product={id:'product:'+word(name),name,keywords:[],members:[]};const old=prefs.groupings[round.id].find(p=>p.id===product.id);if(old)product=old;else prefs.groupings[round.id].push(product);}
      if(word(input.word)&&!product.keywords.includes(word(input.word)))product.keywords.push(word(input.word));
      await commit(ctx,before,prefs);return {roundId:round.id,roundName:round.name,productGroupId:product.id,productName:product.name};
    });}
    async function commit(ctx,before,prefs){const m=await meta(ctx);for(const entry of diff(before,prefs))m.pending[JSON.stringify(entry.path)]={...entry,revision:crypto.randomUUID(),at:clock()};await storage.set({[ctx.k]:prefs,[key(ctx.t)]:m});}
    function addCaptureTask(prefs,batch){const roundId=prefs.memberships[batch.batchId]?.roundId;if(!roundId||prefs.batchMarks[batch.batchId]!=='待补资料')return;const tasks=prefs.tasks[roundId] ||= [],id='capture:'+batch.batchId;if(tasks.some(t=>t.id===id))return;const r=batch.records[0];tasks.push({id,title:'补采本次商品资料 · '+batch.records.length+' 个',sourceBatchId:batch.batchId,status:'待补采',url:batch.records.length===1?r.url:'',entityKey:batch.records.length===1?[r.country,r.platform,r.productId||r.url||r.id,word(r.variant)].join('|'):'',productGroupId:prefs.memberships[batch.batchId].productGroupId,createdAt:new Date(clock()).toISOString()});const round=prefs.rounds.find(r=>r.id===roundId);if(round)round.phase='待验证';}
    async function mark(batch,value){if(!['','重点对标','待询价','待核实','待补资料'].includes(value))throw Error('后续标记无效');return change(async()=>{const ctx=await context(),before=await read(ctx),prefs=structuredClone(before);prefs.batchMarks[batch.batchId]=value;for(const r of batch.records){const id=[r.country,r.platform,r.productId||r.url||r.id,word(r.variant)].join('|'),old=prefs.annotations[id]||{};prefs.annotations[id]={...old,candidate:value==='待补资料'?'待核实':value||'未加入',locks:[...new Set([...old.locks||[],'candidate'])]};}addCaptureTask(prefs,batch);await commit(ctx,before,prefs);return {mark:value};});}
    async function assign(batch,assignment={}){return change(async()=>{
      const ctx=await context(),before=await read(ctx),prefs=structuredClone(before),round=prefs.rounds.find(r=>r.id===assignment.roundId);if(!round)throw Error('请选择已有调研');
      const previous=prefs.memberships[batch.batchId];if(previous?.roundId&&previous.roundId!==round.id){const old=prefs.rounds.find(r=>r.id===previous.roundId);if(Array.isArray(old?.scope.batchIds))old.scope.batchIds=old.scope.batchIds.filter(id=>id!==batch.batchId);if(prefs.tasks[previous.roundId])prefs.tasks[previous.roundId]=prefs.tasks[previous.roundId].filter(t=>t.id!=='capture:'+batch.batchId);}
      round.scope ||= {from:'',to:'',batchIds:[]};if(Array.isArray(round.scope.batchIds)&&!round.scope.batchIds.includes(batch.batchId))round.scope.batchIds.push(batch.batchId);
      const dates=batch.records.map(r=>day(r.capturedAt)).filter(Boolean).sort();if(round.scope.from&&dates[0]<round.scope.from)round.scope.from=dates[0];if(round.scope.to&&dates.at(-1)>round.scope.to)round.scope.to=dates.at(-1);
      const groups=prefs.groupings[round.id] ||= [];let product=groups.find(g=>g.id===assignment.productGroupId);
      if(!product){const name=clean(assignment.productName||batch.records[0].topic||batch.records[0].query)||'独立商品',id='product:'+word(name);product=groups.find(g=>g.id===id);if(!product){product={id,name,keywords:[],members:[]};groups.push(product);}}
      const members=new Set(product.members||[]),words=new Set(product.keywords||[]);
      for(const r of batch.records){members.add([r.country,r.platform,r.productId||r.url||r.id,word(r.variant)].join('|'));if(word(r.query))words.add(word(r.query));}
      product.members=[...members];product.keywords=[...words];for(const other of groups)if(other!==product)other.members=(other.members||[]).filter(k=>!members.has(k));
      prefs.memberships[batch.batchId]={roundId:round.id,productGroupId:product.id};round.updatedAt=new Date(clock()).toISOString();if(round.phase==='已完成')round.phase='采集中';
      addCaptureTask(prefs,batch);
      if(assignment.taskId){const task=prefs.tasks[round.id]?.find(t=>t.id===assignment.taskId);if(task&&batch.records.some(r=>matchesFollowup(task,r))){task.status='待复核';task.followupBatchIds=[...new Set([...task.followupBatchIds||[],batch.batchId])];task.collectedAt=round.updatedAt;round.phase='待验证';}}
      await commit(ctx,before,prefs);return {...prefs.memberships[batch.batchId],roundName:round.name,productName:product.name};
    });}
    async function choices(batchId=''){const {prefs,...rest}=await get();return {...rest,rounds:prefs.rounds.map(r=>({id:r.id,name:r.name,phase:r.phase,products:(prefs.groupings[r.id]||[]).map(p=>({id:p.id,name:p.name}))})),assignment:prefs.memberships[batchId]||null,mark:prefs.batchMarks[batchId]||''};}
    async function sync(){if(work)return work;work=syncNow();try{return await work;}finally{work=null;}}
    async function syncNow(){
      let ctx;try{
        await serial;ctx=await context();const remote=await access(true),client=remote.client,root='/bitable/v1/apps/'+encodeURIComponent(remote.appToken)+'/tables';let m=await meta(ctx),tableId=m.tableId||(remote.appToken==='RCyGbyMxIa1I20skQPkck4CXnIb'?'tblOGevLtAdQCHlo':'');
        if(!tableId){const tables=[];let page='';do{const p=await client.request(root+'?page_size=100'+(page?'&page_token='+encodeURIComponent(page):''));tables.push(...p.items||[]);page=p.has_more?p.page_token:'';}while(page);tableId=tables.find(t=>t.name==='调研流程')?.table_id;if(!tableId){const p=await client.request(root,{method:'POST',body:{table:{name:'调研流程',fields:[{field_name:'条目编号',type:1},{field_name:'调研数据',type:1}]}}});tableId=p.table_id||p.table?.table_id;if(!tableId)throw Error('飞书未返回调研流程表');}m.tableId=tableId;await change(async()=>{const latest=await meta(ctx);await storage.set({[key(ctx.t)]:{...latest,tableId}});});}
        const base=root+'/'+encodeURIComponent(tableId),fields=(await client.request(base+'/fields?page_size=100')).items||[];
        const keyDef=fields.find(f=>f.field_id===(m.keyFieldId||(tableId==='tblOGevLtAdQCHlo'?'fldXOfhkV1':'')))||fields.find(f=>f.field_name==='条目编号'),dataDef=fields.find(f=>f.field_id===(m.dataFieldId||(tableId==='tblOGevLtAdQCHlo'?'fldlF2gLcN':'')))||fields.find(f=>f.field_name==='调研数据'),keyField=keyDef?.field_name,dataField=dataDef?.field_name;if(!keyField||!dataField||keyDef.type!==1||dataDef.type!==1)throw Error('调研流程表缺少保存字段，请保留条目编号和调研数据');
        await change(async()=>{const latest=await meta(ctx);await storage.set({[key(ctx.t)]:{...latest,keyFieldId:keyDef.field_id,dataFieldId:dataDef.field_id}});});
        const records=[],tokens=new Set();let cursor='',total=null;do{const p=await client.request(base+'/records?page_size=500'+(cursor?'&page_token='+encodeURIComponent(cursor):''));if(!Array.isArray(p.items)&&!(p.total===0&&p.has_more===false))throw Error('调研流程读取不完整');if(typeof p.has_more!=='boolean')throw Error('调研流程分页状态缺失');if(Number.isInteger(p.total)){if(total!==null&&total!==p.total)throw Error('调研流程读取期间发生变化，请重试');total=p.total;}records.push(...p.items||[]);cursor=p.has_more?p.page_token:'';if(p.has_more&&(!cursor||tokens.has(cursor)))throw Error('调研流程分页不完整');tokens.add(cursor);if(records.length>50000)throw Error('调研条目超过本次读取范围');}while(cursor);if(total!==null&&records.length!==total)throw Error('调研流程记录数不一致，请重试');
        const text=v=>Array.isArray(v)?v.map(v=>v.text||'').join(''):String(v??''),prefix=ctx.t+'|',byKey=new Map(),parts=new Map();
        for(const record of records){const id=text(record.fields[keyField]);if(!id.startsWith(prefix))continue;if(byKey.has(id))throw Error('调研流程条目编号重复，请核对后再同步');byKey.set(id,record.record_id);try{const v=JSON.parse(text(record.fields[dataField]));if(!validPath(v.path)||!Number.isInteger(v.part)||!Number.isInteger(v.count)||v.count<1||v.count>200)throw Error();const k=JSON.stringify(v.path);if(!parts.has(k))parts.set(k,[]);parts.get(k).push(v);}catch{throw Error('调研流程保存内容不完整，保留本地数据');}}
        const remoteDocs=[];for(const [id,items]of parts){const first=items.find(p=>p.part===0);if(!first)continue;const selected=items.filter(p=>p.revision===first.revision&&p.count===first.count).sort((a,b)=>a.part-b.part);if(selected.length!==first.count||selected.some((p,i)=>p.part!==i))throw Error('调研流程尚未同步完整，稍后重试');let value;try{value=JSON.parse(selected.map(p=>p.text).join(''));}catch{throw Error('调研流程内容无法读取');}remoteDocs.push({path:first.path,value,deleted:first.deleted,revision:first.revision,at:first.at});}
        await change(async()=>{const prefs=await read(ctx),latest=await meta(ctx),updates=remoteDocs.filter(d=>!latest.pending[JSON.stringify(d.path)]&&latest.seen[JSON.stringify(d.path)]!==d.revision);let merged=apply(prefs,updates);for(const d of updates)latest.seen[JSON.stringify(d.path)]=d.revision;
          // Existing local analysis settings become pending once; do not replace them with an empty cloud.
          for(const [id,value]of Object.entries(documents(merged)))if(!latest.seen[id]&&!latest.pending[id])latest.pending[id]={path:JSON.parse(id),value,deleted:false,revision:crypto.randomUUID(),at:clock()};
          await storage.set({[ctx.k]:merged,[key(ctx.t)]:latest});
        });
        m=await meta(ctx);const pending=Object.values(m.pending),sent=[];
        for(const entry of pending){const body=JSON.stringify(entry.deleted?null:entry.value),chunks=chunksOf(body);for(let part=0;part<chunks.length;part++){const id=prefix+JSON.stringify(entry.path)+'|'+part;sent.push({id,entry,fields:{[keyField]:id,[dataField]:JSON.stringify({path:entry.path,revision:entry.revision,at:entry.at,deleted:entry.deleted,part,count:chunks.length,text:chunks[part]})}});}}
        for(const exists of [true,false]){const rows=sent.filter(r=>byKey.has(r.id)===exists);for(let i=0;i<rows.length;i+=50){const batch=rows.slice(i,i+50),route=base+'/records/'+(exists?'batch_update':'batch_create');const response=await client.request(route,{method:'POST',body:{records:batch.map(r=>({...exists?{record_id:byKey.get(r.id)}:{},fields:r.fields}))}});if(!Array.isArray(response.records)||response.records.length!==batch.length)throw Error('飞书未确认全部调研内容');for(const r of batch){const saved=response.records.find(v=>text(v.fields?.[keyField])===r.id);if(!saved||text(saved.fields[dataField])!==r.fields[dataField])throw Error('飞书调研内容核对未通过');}}}
        await change(async()=>{const latest=await meta(ctx);for(const entry of pending){const id=JSON.stringify(entry.path);if(latest.pending[id]?.revision===entry.revision){delete latest.pending[id];latest.seen[id]=entry.revision;}}latest.cloudAt=new Date(clock()).toISOString();latest.error='';await storage.set({[key(ctx.t)]:latest});});return get();
      }catch(error){if(ctx)await change(async()=>{const m=await meta(ctx);m.error=String(error.message);await storage.set({[key(ctx.t)]:m});});throw error;}
    }
    return {get,save,launch,assign,mark,choices,sync};
  }
  return {defaults,documents,diff,apply,validPath,prefsKey,target,clean,word,create};
});
