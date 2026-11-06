(function(root){
  'use strict';
  const data=root.IantoMarketData||(typeof require==='function'?require('./data.js'):null);
  const seed=root.IantoMarketTable||(typeof require==='function'?require('./table.js'):null);
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const target=c=>[c.appToken,c.tableId].join(':');
  function create({get,set,clock=()=>Date.now()}){
    let schemaWork=null,schemaCache=null,layoutWork=null;
    async function schema(remote,c,force=false){
      const scope=target(c);
      if(schemaWork?.scope===scope)return schemaWork.promise;
      if(!force&&schemaCache?.target===scope&&clock()-schemaCache.checkedAt<30000)return schemaCache;
      const work={scope,promise:null};
      work.promise=(async()=>{
        const fields=[],seen=new Set();let token='';
        for(;;){
          const params=new URLSearchParams({page_size:'100',...(token?{page_token:token}:{})});
          const page=await remote.request(remote.tablePath()+'/fields?'+params);
          fields.push(...page.items||[]);
          if(!page.has_more)break;
          if(!page.page_token||seen.has(page.page_token))throw Error('飞书字段分页不完整');
          token=page.page_token;seen.add(token);
        }
        if(!fields.length||fields.some(f=>!f.field_id||!f.field_name))throw Error('未能读取飞书字段');
        const previous=await get('schema',null),known=new Set(data.FIELDS.map(f=>f.field_name));
        const original=c.appToken===seed.appToken&&c.tableId===seed.tableId?seed.bindings:{};
        const bindings={},used=new Set();
        for(const f of fields){
          const source=(previous?.target===scope&&previous.bindings[f.field_id])||original[f.field_id];
          if(source&&known.has(source)){bindings[f.field_id]=source;used.add(source);}
        }
        for(const f of fields)if(!bindings[f.field_id]&&known.has(f.field_name)&&!used.has(f.field_name)){
          bindings[f.field_id]=f.field_name;used.add(f.field_name);
        }
        const value={target:scope,fields:fields.map(({field_id,field_name,type})=>({field_id,field_name,type})),bindings,checkedAt:clock()};
        await set('schema',value);schemaCache=value;return value;
      })();
      schemaWork=work;try{return await work.promise;}finally{if(schemaWork===work)schemaWork=null;}
    }
    async function sync(remote,c,{sourceView=''}={}){
      if(layoutWork)return layoutWork;
      const work=(async()=>{
        const info=await schema(remote,c,true),scope=target(c),old=await get('headers',null);
        const state=old?.target===scope?old:null,byId=new Map(info.fields.map(f=>[f.field_id,f])),byName=new Map(info.fields.map(f=>[f.field_name,f.field_id]));
        const base=`/base/v3/bases/${encodeURIComponent(c.appToken)}/tables/${encodeURIComponent(c.tableId)}/views`;
        const views=[];let offset=0;
        for(;;){
          const page=await remote.request(base+'?'+new URLSearchParams({limit:'100',offset:String(offset)}));
          if(!Array.isArray(page.views)||!Number.isInteger(page.total))throw Error('未能读取飞书视图');
          views.push(...page.views);offset+=page.views.length;
          if(offset>=page.total)break;
          if(!page.views.length)throw Error('飞书视图分页不完整');
        }
        const grids=views.filter(v=>v.type==='grid');
        if(!grids.length)throw Error('没有可统一的表格视图');
        async function read(view){
          const visible=await remote.request(base+'/'+encodeURIComponent(view.id)+'/visible_fields');
          if(!Array.isArray(visible)||!visible.length)throw Error('未能读取视图列顺序');
          const ids=visible.map(value=>byId.has(value)?value:byName.get(value));
          if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw Error('表头正在变化，请稍后重试');
          return {id:view.id,name:view.name,ids};
        }
        const layouts=[];
        for(let start=0;start<grids.length;start+=3)layouts.push(...await Promise.all(grids.slice(start,start+3).map(read)));
        const primary=layouts.find(v=>v.name==='全部采集')||layouts[0];
        const valid=ids=>ids.filter(id=>byId.has(id));
        let desired=state?valid(state.columns):primary.ids;
        if(!state?.pending){
          const changes=state?layouts.filter(v=>state.views[v.id]&&!same(v.ids,valid(state.views[v.id]))):[];
          const alternatives=[...new Map(changes.map(v=>[JSON.stringify(v.ids),v.ids])).values()];
          if(alternatives.length===1)desired=alternatives[0];
          else if(alternatives.length>1){
            const source=changes.find(v=>v.id===sourceView);
            if(source)desired=source.ids;
            else throw Error('多个视图同时修改了列顺序，请打开要采用的视图后再试');
          }
        }
        if(!desired.length)throw Error('统一表头没有可用字段');
        const names=desired.map(id=>byId.get(id).field_name);
        // Persist the intended layout before applying it so interrupted writes resume safely.
        const next={target:scope,columns:desired,views:Object.fromEntries(layouts.map(v=>[v.id,desired])),pending:true};
        const changed=layouts.filter(v=>!same(v.ids,desired));
        if(changed.length){
          await set('headers',next);
          for(const view of changed)await remote.request(base+'/'+encodeURIComponent(view.id)+'/visible_fields',{method:'PUT',body:{visible_fields:names}});
          // Read every view after the batch; CSV is only released once all layouts agree.
          for(let start=0;start<grids.length;start+=3){
            const verified=await Promise.all(grids.slice(start,start+3).map(read));
            if(verified.some(v=>!same(v.ids,desired)))throw Error('飞书表头正在保存，请稍后再试');
          }
        }
        next.pending=false;
        await set('headers',next);
        const columns=desired.map(id=>({id,name:byId.get(id).field_name,source:info.bindings[id]||''}));
        const layout={target:scope,fields:names,columns,source:'online',viewName:'统一表头',warning:'',at:new Date(clock()).toISOString()};
        return layout;
      })();
      layoutWork=work;try{return await work;}finally{if(layoutWork===work)layoutWork=null;}
    }
    return {schema,sync,idle:async()=>{if(layoutWork)await layoutWork.catch(()=>{});if(schemaWork)await schemaWork.promise.catch(()=>{});}};
  }
  root.IantoMarketHeaders={create};
  if(typeof module==='object'&&module.exports)module.exports=root.IantoMarketHeaders;
})(globalThis);
