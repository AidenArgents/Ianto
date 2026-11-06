(function(root,factory){const api=factory();root.IantoMarketAnalytics=api;if(typeof module==='object'&&module.exports)module.exports=api;})(globalThis,function(){
  'use strict';
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const keywordKey=v=>clean(v).normalize('NFC').toLocaleLowerCase('und');
  const day=value=>{const n=typeof value==='number'?value:Date.parse(value);return Number.isFinite(n)?new Date(n+8*3600000).toISOString().slice(0,10):'';};
  const dimensions={product:'产品',keyword:'关键词',country:'国家',platform:'平台',source:'数据来源',type:'商品类型',tag:'配置标签',relevance:'相关性',candidate:'候选状态',match:'人工同款组',currency:'币种',shop:'店铺',brand:'品牌',ad:'广告',method:'采集方式',day:'采集日期'};
  const fieldKeys={title:'商品标题',platform:'销售平台',source:'数据来源',country:'国家',productId:'平台商品ID',url:'商品链接',image:'主图链接',currency:'币种',priceText:'价格原文',price:'展示价格',shop:'店铺',brand:'品牌',variant:'当前规格',attributes:'商品属性',stock:'库存展示',shipping:'配送展示',salesText:'销量原文',ratingText:'评分原文',reviewsText:'评价原文',query:'实际搜索词',querySource:'搜索词依据',originalQuery:'Ianto原始输入词',topic:'调研主题',batchId:'采集批次',id:'采集编号',capturedAt:'采集时间',captureMethod:'采集方式',ad:'广告标记',note:'备注',completeness:'字段说明',position:'本页位置',page:'页码',searchUrl:'搜索页链接',sort:'排序原文',filters:'筛选条件'};
  function text(value,link=false){
    if(value===null||value===undefined)return '';
    if(Array.isArray(value))return value.map(v=>text(v,link)).join('');
    if(typeof value==='object')return clean((link&&(value.link||value.url||value.href))||value.text||value.name||'');
    return clean(value);
  }
  fieldKeys.developmentOpinion='开发意见';fieldKeys.researchId='调研编号';
  function multiline(value){if(value===null||value===undefined)return '';if(Array.isArray(value))return value.map(multiline).join('');if(typeof value==='object')return String(value.text??value.name??'');return String(value);}
  function decodeRecord(record,schema={}){
    const f=record.fields||record,canonical={};
    const names=new Map((schema.fields||[]).map(v=>[v.field_id,v.field_name]));
    for(const [id,source] of Object.entries(schema.bindings||{})){const name=names.get(id);if(name&&Object.hasOwn(f,name))canonical[source]=f[name];else if(Object.hasOwn(f,id))canonical[source]=f[id];}
    const row={recordId:record.record_id||record.recordId||''};
    for(const [key,name] of Object.entries(fieldKeys)){
      const value=Object.hasOwn(canonical,name)?canonical[name]:f[name]??f[key];
      row[key]=key==='developmentOpinion'?multiline(value):['price','position','page'].includes(key)?value===null||value===undefined||value===''?null:Number(value):key==='capturedAt'&&typeof value==='number'?new Date(value).toISOString():text(value,['url','image','searchUrl'].includes(key));
    }
    return row;
  }
  function numberText(v){
    let s=clean(v).replace(/\s+/g,'');if(!s)return null;
    if(/,\d{1,2}$/.test(s)&&s.includes('.'))s=s.replaceAll('.','').replace(',','.');
    else if(s.includes(',')&&s.includes('.'))s=s.replaceAll(',','');
    else if(/^\d{1,3}(?:[.,]\d{3})+$/.test(s))s=s.replace(/[.,]/g,'');
    else s=s.replace(',','.');
    const n=Number(s);return Number.isFinite(n)&&n>=0?n:null;
  }
  function rating(v){const s=clean(v);if(/图示|整星|部分星/.test(s))return null;const m=s.match(/^([0-5](?:[.,]\d+)?)(?:\s|$|\/)/),n=m?numberText(m[1]):null;return n!==null&&n<=5?n:null;}
  function reviews(v){const s=clean(v);if(!s||/sold|vendid|comprad|terjual|out of|de 5/i.test(s))return null;const m=s.match(/([\d][\d.,]*)\s*(万|亿|ribu|mil|rb|jt|k|m)?/i);if(!m)return null;const n=numberText(m[1]),scale={k:1000,rb:1000,ribu:1000,mil:1000,m:1000000,jt:1000000,'万':10000,'亿':100000000}[String(m[2]||'').toLowerCase()]||1;return n!==null&&Number.isInteger(n*scale)?n*scale:null;}
  function sales(v,source=''){
    const s=clean(v);if(!s||/interes|installment|meses sin|Pix|NuPay|Precio de lista|Anterior:|^De:|sem juros/i.test(s))return null;
    const bare=/^[\d.,]+(?:\s*[kKmM万亿])?\+?$/.test(s);
    if(bare&&!['FastMoss','Echotik'].includes(source))return null;
    const m=s.match(/([\d.,]+)\s*(万|亿|ribu|mil|rb|jt|k|m)?\s*(\+)?\s*(?:vendido\(s\)|vendidos?|comprados?|bought|purchased|sold|terjual)/i)||s.match(/terjual\s*([\d.,]+)\s*(ribu|rb|jt|k|m)?\s*(\+)?/i)||(bare?s.match(/^([\d.,]+)\s*([kKmM万亿])?\s*(\+)?$/):null);
    if(!m)return null;const value=numberText(m[1]);if(value===null)return null;
    const multiplier={k:1000,rb:1000,ribu:1000,mil:1000,m:1000000,jt:1000000,'万':10000,'亿':100000000}[String(m[2]||'').toLowerCase()]||1;
    return {value:value*multiplier,lowerBound:Boolean(m[3]),period:/mes pasado|mês passado|past month/i.test(s)?'近月购买':bare?'数据平台总销量':'页面销量（周期未明）'};
  }
  function normalize(input){
    return input.map((value,index)=>{
      const row=decodeRecord(value);const at=Date.parse(row.capturedAt),word=clean(row.query||row.originalQuery),price=Number.isFinite(row.price)&&row.price>=0?row.price:null;
      return {...row,id:row.id||row.recordId||'row-'+index,at:Number.isFinite(at)?at:null,day:day(row.capturedAt),word,wordKey:keywordKey(word)||'__missing__',keywordFallback:!row.query&&Boolean(row.originalQuery),price,rating:rating(row.ratingText),reviewCount:reviews(row.reviewsText),sales:sales(row.salesText,row.source),currency:clean(row.currency).toUpperCase(),country:clean(row.country).toUpperCase(),platform:row.platform||row.source||'未知平台',source:row.source||row.platform||'未知来源',partial:/未确认|未识别|手动停止|持续加载|加载更多|登录后/.test(row.note||''),invalidSales:Boolean(row.salesText)&&!sales(row.salesText,row.source)};
    }).filter(r=>r.title||r.productId||r.url);
  }
  function seedProducts(rows){
    const groups=new Map(),known=new Map();
    function group(name){const id=keywordKey(name);if(!groups.has(id))groups.set(id,{id:'product:'+id,name,keywords:[],members:[]});return groups.get(id);}
    for(const r of rows.filter(r=>r.wordKey&&r.wordKey!=='__missing__')){const g=group(clean(r.topic)||r.word);if(!g.keywords.includes(r.wordKey))g.keywords.push(r.wordKey);const key=entityKey(r);if(!known.has(key))known.set(key,[]);if(!known.get(key).includes(g))known.get(key).push(g);}
    for(const r of rows.filter(r=>!r.wordKey||r.wordKey==='__missing__')){const key=entityKey(r),targets=r.topic?[group(clean(r.topic))]:known.get(key)||[group('未归类')];for(const g of targets)if(!g.members.includes(key))g.members.push(key);}
    return [...groups.values()];
  }
  const productIndices=new WeakMap();
  function productsFor(row,products){let index=productIndices.get(products);if(!index){index={members:new Map(),words:new Map()};for(const g of products){for(const key of g.members||[]){if(!index.members.has(key))index.members.set(key,[]);index.members.get(key).push(g.id);}for(const word of g.keywords||[]){if(word==='__missing__')continue;if(!index.words.has(word))index.words.set(word,[]);index.words.get(word).push(g.id);}}productIndices.set(products,index);}return index.members.get(entityKey(row))||index.words.get(row.wordKey)||['__ungrouped__'];}
  function valueFor(row,key,products){
    if(key==='product')return productsFor(row,products);
    if(key==='tag')return row.tagKeys?.length?row.tagKeys:['__unset__'];
    if(key==='type')return [row.typeKey||'__unset__'];
    if(key==='match')return [row.matchKey||'__unset__'];
    if(key==='relevance')return [row.relevance||'未标记'];
    if(key==='candidate')return [row.candidate||'未加入'];
    return [key==='keyword'?row.wordKey:key==='method'?row.captureMethod||'未知':key==='ad'?row.ad==='是'?'是':!row.ad||row.ad==='未知'?'未知':'未见标记':row[key]||'未知'];
  }
  function labelFor(key,value,rows,products){if(key==='product')return products.find(g=>g.id===value)?.name||'未归类';if(key==='keyword')return rows.find(r=>r.wordKey===value)?.word||'搜索词缺失';if(key==='type')return rows.find(r=>r.typeKey===value)?.type||'未标记类型';if(key==='match')return rows.find(r=>r.matchKey===value)?.sameModel||'未指定同款';if(key==='tag'){for(const r of rows){const i=r.tagKeys?.indexOf(value)??-1;if(i>=0)return r.tags[i];}return '未标记配置';}return value;}
  function inScope(row,scope={}){
    if(scope.from&&(!row.day||row.day<scope.from))return false;if(scope.to&&(!row.day||row.day>scope.to))return false;
    if(Array.isArray(scope.batchIds)&&!scope.batchIds.includes(row.batchId||row.id))return false;
    return true;
  }
  function filter(rows,state={},products=[],except=''){
    const term=keywordKey(state.text);
    return rows.filter(r=>inScope(r,state.scope)&&(!term||keywordKey([r.title,r.word,r.shop,r.productId,r.type,...r.tags||[]].join(' ')).includes(term))&&Object.entries(state.filters||{}).every(([key,values])=>key===except||!Array.isArray(values)||values.length===0||valueFor(r,key,products).some(v=>values.includes(v)))&&(!state.excludePartial||!r.partial)&&(!state.topN||r.captureMethod!=='搜索页整理'||Number.isFinite(r.position)&&r.position<=state.topN)&&numericFilter(r,{...state.numeric,priceCurrency:state.numeric?.priceCurrency||(state.filters?.currency?.length===1?state.filters.currency[0]:'')}));
  }
  function numericFilter(r,n={}){const active=k=>n[k]!==null&&n[k]!==undefined&&n[k]!=='';if((active('priceMin')||active('priceMax'))&&(!n.priceCurrency||r.currency!==n.priceCurrency))return false;for(const [field,min,max]of [['price','priceMin','priceMax'],['rating','ratingMin','ratingMax'],['reviewCount','reviewsMin','reviewsMax']]){if(active(min)&&(r[field]===null||r[field]===undefined||r[field]<Number(n[min])))return false;if(active(max)&&(r[field]===null||r[field]===undefined||r[field]>Number(n[max])))return false;}return true;}
  function entityKey(r){return [r.country,r.platform,r.productId||r.url||r.id,keywordKey(r.variant)].join('|');}
  function dedupe(rows,mode='products'){
    if(mode==='observations')return rows;
    const entities=new Map();for(const r of rows){const key=entityKey(r),old=entities.get(key);if(!old||(r.at??-1)>(old.at??-1)||r.at===old.at&&r.captureMethod==='详情页单品')entities.set(key,r);}
    return [...entities.values()];
  }
  function quantile(numbers,p){if(!numbers.length)return null;const a=[...numbers].sort((a,b)=>a-b),i=(a.length-1)*p,lower=Math.floor(i);return a[lower]+(a[Math.ceil(i)]-a[lower])*(i-lower);}
  function summary(rows,mode='products'){
    const data=dedupe(rows,mode),currencies=[...new Set(data.filter(r=>r.price!==null&&r.currency).map(r=>r.currency))].sort();
    return {observations:rows.length,products:dedupe(rows).length,used:data.length,batches:new Set(rows.map(r=>r.batchId||r.id)).size,priced:data.filter(r=>r.price!==null&&r.currency).length,ratings:data.filter(r=>r.rating!==null).length,reviews:data.filter(r=>r.reviewCount!==null).length,sales:data.filter(r=>r.sales).length,invalidSales:data.filter(r=>r.invalidSales).length,missingQuery:data.filter(r=>!r.query).length,missingCountry:data.filter(r=>!r.country).length,partialBatches:new Set(rows.filter(r=>r.partial).map(r=>r.batchId||r.id)).size,currencies,prices:currencies.map(currency=>{const a=data.filter(r=>r.currency===currency&&r.price!==null).map(r=>r.price);return {currency,n:a.length,min:Math.min(...a),max:Math.max(...a),median:quantile(a,.5),p25:quantile(a,.25),p75:quantile(a,.75)};})};
  }
  function groups(rows,keys=['platform'],products=[],mode='products'){
    const result=new Map();
    for(const row of rows){let combinations=[[]];for(const key of keys)combinations=combinations.flatMap(a=>valueFor(row,key,products).map(v=>[...a,v]));for(const values of combinations){const id=JSON.stringify(values);if(!result.has(id))result.set(id,{id,values,label:values.map((v,i)=>labelFor(keys[i],v,rows,products)).join(' · '),rows:[]});result.get(id).rows.push(row);}}
    return [...result.values()].map(g=>({...g,label:g.label||'全部样本',summary:summary(g.rows,mode)})).sort((a,b)=>b.summary.used-a.summary.used||a.label.localeCompare(b.label));
  }
  function facets(rows,state,products,key){
    const result=new Map();for(const r of filter(rows,state,products,key))for(const value of valueFor(r,key,products))result.set(value,(result.get(value)||0)+1);
    for(const v of state.filters?.[key]||[])if(!result.has(v))result.set(v,0);
    return [...result].map(([value,count])=>({value,count,label:labelFor(key,value,rows,products)})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label));
  }
  function histogram(rows,currency,mode='products'){
    const values=dedupe(rows,mode).filter(r=>r.currency===currency&&r.price!==null).map(r=>r.price);if(!values.length)return[];
    const min=Math.min(...values),max=Math.max(...values);if(min===max)return[{from:min,to:max,count:values.length}];
    const n=Math.max(4,Math.min(10,Math.ceil(Math.sqrt(values.length)))),step=(max-min)/n,bins=Array.from({length:n},(_,i)=>({from:min+i*step,to:min+(i+1)*step,count:0}));for(const v of values)bins[Math.min(n-1,Math.floor((v-min)/step))].count++;return bins;
  }
  function batches(rows){const result=new Map();for(const r of rows){const id=r.batchId||r.id;if(!result.has(id))result.set(id,{id,at:r.capturedAt,day:r.day,country:r.country,platform:r.source,word:r.word,count:0,partial:false});result.get(id).count++;result.get(id).partial ||=r.partial;}return [...result.values()].sort((a,b)=>String(b.at).localeCompare(a.at));}
  function csv(rows,mode='products'){
    const fields=[['采集时间','capturedAt'],['国家','country'],['平台','platform'],['数据来源','source'],['实际搜索词','query'],['Ianto原始输入词','originalQuery'],['商品标题','title'],['币种','currency'],['展示价格','price'],['评分原文','ratingText'],['评价原文','reviewsText'],['销量原文','salesText'],['店铺','shop'],['商品链接','url'],['采集批次','batchId'],['相关性','relevance'],['商品类型','type'],['配置标签','tags'],['人工同款组','sameModel'],['候选状态','candidate'],['调研备注','analystNote']];
    fields.push(['开发意见','developmentOpinion']);
    const cell=v=>'"'+String(Array.isArray(v)?v.join('；'):v??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+[fields.map(x=>cell(x[0])).join(','),...dedupe(rows,mode).map(r=>fields.map(([,key])=>cell(r[key])).join(','))].join('\r\n');
  }
  return {clean,keywordKey,day,fieldKeys,dimensions,text,decodeRecord,normalize,seedProducts,productsFor,valueFor,labelFor,inScope,filter,numericFilter,entityKey,dedupe,quantile,summary,groups,facets,histogram,batches,csv,numberText,rating,reviews,sales};
});
