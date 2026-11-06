(function(root,factory){
  const A=root.IantoMarketAnalytics||(typeof require==='function'?require('./analytics.js'):null);
  const R=root.IantoMarketResearch||(typeof require==='function'?require('./research.js'):null);
  const api=factory(A,R);root.IantoMarketLabelRules=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis,function(A,R){
  'use strict';
  const terms=value=>R.unique(Array.isArray(value)?value:[]).slice(0,50).map(v=>v.slice(0,100));
  function rule(value={}){
    return {id:A.clean(value.id).slice(0,100),name:A.clean(value.name).slice(0,100),enabled:value.enabled!==false,
      field:['title','attributes','both'].includes(value.field)?value.field:'both',
      any:terms(value.any),all:terms(value.all),none:terms(value.none),
      productIds:terms(value.productIds),roundId:typeof value.roundId==='string'?value.roundId:null,
      type:A.clean(value.type).slice(0,80),tags:terms(value.tags).slice(0,30),
      relevance:R.relevances.includes(value.relevance)&&value.relevance!=='未标记'?value.relevance:'',
      candidate:R.candidates.includes(value.candidate)&&value.candidate!=='未加入'?value.candidate:''};
  }
  function valid(r){return Boolean(r.id&&r.name&&(r.any.length||r.all.length)&&(r.type||r.tags.length||r.relevance||r.candidate));}
  function compile(r){return {...r,any:r.any.map(A.keywordKey),all:r.all.map(A.keywordKey),none:r.none.map(A.keywordKey)};}
  function matches(row,r,products,prepared=null){
    if(!r.enabled||!valid(r))return false;
    if(r.productIds.length&&!(prepared?.members||A.productsFor(row,products)).some(id=>r.productIds.includes(id)))return false;
    const fields=r.field==='title'?[row.title]:r.field==='attributes'?[row.attributes,row.variant]:[row.title,row.attributes,row.variant];
    const text=prepared?.text[r.field]??fields.map(A.keywordKey).join('\n'),includes=v=>text.includes(prepared?v:A.keywordKey(v));
    return (!r.any.length||r.any.some(includes))&&r.all.every(includes)&&!r.none.some(includes);
  }
  function proposals(rows,rules,{roundId='',scope={},products=[]}={}){
    const active=(rules||[]).slice(0,100).map(rule).filter(r=>r.enabled&&valid(r)&&(r.roundId===null||r.roundId===roundId)).map(compile);
    const result=new Map(),proposalCache=new Map();
    if(!active.length)return result;
    active.forEach((r,i)=>r.slot=i);
    const productScoped=active.some(r=>r.productIds.length);
    for(const row of A.dedupe(rows.filter(r=>A.inScope(r,scope)))){
      const title=A.keywordKey(row.title),attributes=[row.attributes,row.variant].map(A.keywordKey).join('\n'),prepared={text:{title,attributes,both:title+'\n'+attributes},members:productScoped?A.productsFor(row,products):[]};
      const matched=active.filter(r=>matches(row,r,products,prepared));if(!matched.length)continue;
      const signature=matched.map(r=>r.slot).join(',');
      if(proposalCache.has(signature)){result.set(A.entityKey(row),proposalCache.get(signature));continue;}
      const suggestion={names:matched.map(r=>r.name),ids:matched.map(r=>r.id),tags:R.unique(matched.flatMap(r=>r.tags)),conflicts:[]};
      for(const field of ['type','relevance','candidate']){
        const values=R.unique(matched.map(r=>r[field]));
        if(values.length===1)suggestion[field]=values[0];
        else if(values.length>1)suggestion.conflicts.push(field);
      }
      proposalCache.set(signature,suggestion);result.set(A.entityKey(row),suggestion);
    }
    return result;
  }
  function apply(rows,rules,context={}){
    const {annotations={},reviews={}}=context,derived=proposals(rows,rules,context);
    return R.annotate(rows,annotations,reviews).map(row=>{
      const key=A.entityKey(row),suggestion=derived.get(key);if(!suggestion)return row;
      const meta=R.annotation(annotations[key]),locks=new Set(meta.locks),next={...row,ruleNames:suggestion.names,ruleConflicts:suggestion.conflicts};
      if(!meta.type&&!locks.has('type')&&suggestion.type)next.type=suggestion.type;
      if(!meta.tags.length&&!locks.has('tags'))next.tags=suggestion.tags;
      if(meta.candidate==='未加入'&&!locks.has('candidate')&&suggestion.candidate)next.candidate=suggestion.candidate;
      if(!Object.hasOwn(reviews,key)&&suggestion.relevance)next.relevance=suggestion.relevance;
      next.typeKey=A.keywordKey(next.type);next.tagKeys=next.tags.map(A.keywordKey);return next;
    });
  }
  function preview(rows,rules,context={}){
    const p=proposals(rows,rules,context),before=R.annotate(rows,context.annotations,context.reviews),after=apply(rows,rules,context),old=new Map(before.map(r=>[A.entityKey(r),r]));
    const data=A.dedupe(after.filter(r=>A.inScope(r,context.scope||{}))).filter(r=>p.has(A.entityKey(r)));
    return data.map(row=>({row,proposal:p.get(A.entityKey(row)),changed:['type','tags','relevance','candidate'].some(k=>JSON.stringify(row[k])!==JSON.stringify(old.get(A.entityKey(row))[k]))}));
  }
  return {rule,valid,matches,proposals,apply,preview};
});
