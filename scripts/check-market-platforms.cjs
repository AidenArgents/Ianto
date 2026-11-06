// Isolated DOM fixtures: no user profile, real platform requests, or Feishu writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]||'playwright');
const base=path.resolve(__dirname,'..'),registry=require('../features/multisearch_platforms.js'),core=require('../market_capture/core.js');
const word='Mini Café & Fan + TEST';
const cases=Object.entries(registry.countries).flatMap(([country,value])=>value.platforms.map(platform=>({country,platform,url:registry.buildUrl(platform,word)})));
const prices={BR:'R$ 129,90',MX:'MX$129.90',ID:'Rp129.900',PH:'₱129.90',MY:'RM 129.90',VN:'129.900 ₫',TH:'฿129.90',SG:'S$129.90'};
function product(url,n){const u=new URL(url),family=core.siteFor(url).family,host=family==='mercado'?'https://www.'+(u.hostname.includes('.br')?'mercadolivre.com.br':'mercadolibre.com.mx'):u.origin;
  return host+({amazon:'/dp/B'+String(n).padStart(9,'0'),mercado:(host.includes('.br')?'/MLB-':'/MLM-')+(1234567800+n)+'-fan-_JM',shopee:'/Fan-i.12345.'+(67890+n),lazada:'/fan-i'+(123450+n)+'-s98765.html',fastmoss:'/zh/e-commerce/detail/'+(1736800972002067800n+BigInt(n)),echotik:'/products/'+(1736800972002067800n+BigInt(n)),aliexpress:'/item/'+(1005000000000+n)+'.html',tokopedia:'/fixture-shop/fan-'+n,temu:'/fan-g-'+(6010000000000+n)+'.html',olx:'/fixture-fan-'+(1234567800+n),blibli:'/p/fan-'+n+'/ps--FAN-12345-0000'+n,mudah:'/fan-'+(116078890+n)+'.htm',carousell:'/p/fan-'+(1460662700+n)+'/'}[family]);
}
function card(family,url,country,n){
  const href=product(url,n),title='Fixture Café Fan '+n,price=prices[country],image=`<img alt="${title}" data-src="https://images.example.test/fan-${n}.jpg" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">`;
  const link=`<a href="${href}">${image}<h2>${title}</h2></a>`;
  switch(family){
    case'amazon':return `<div class="card" data-component-type="s-search-result" data-asin="B${String(n).padStart(9,'0')}"><h2><a href="${href}"><span>${title}</span></a></h2>${image}<div class="a-price"><span class="a-offscreen">${price}</span></div></div>`;
    case'mercado':return `<li class="card ui-search-layout__item"><a class="poly-component__title" href="${href}">${title}</a>${image}<span class="poly-price__current"><span class="andes-money-amount">${price}</span></span></li>`;
    case'shopee':return `<li class="card shopee-search-item-result__item"><a data-sqe="link" href="${href}">${image}<div data-sqe="name">${title}</div><span data-sqe="price">${price}</span></a></li>`;
    case'lazada':return `<div class="card" data-qa-locator="product-item"><div class="RfADt"><a href="${href}" title="${title}">${image}${title}</a></div><span class="ooOxS">${price}</span></div>`;
    case'fastmoss':return `<tr class="card ant-table-row" data-row-key="${n}"><td><a href="${href}">${image}<h3 class="content truncate">${title}</h3><span><span>售价：</span><span>${price}</span></span><img alt="${country}" src="https://cdn.example.test/regions/${country.toLowerCase()}.svg"></a></td><td><a href="/zh/shop-marketing/detail/123456"><span text="Fixture shop">Fixture shop</span></a></td><td>23</td></tr>`;
    case'echotik':return `<tr class="card"><td><a href="${href}">${image}<span class="index_productName__fixture">${title}</span></a></td><td class="price">${price}</td><td>23</td></tr>`;
    case'aliexpress':return `<div class="card search-item-card-wrapper"><a href="${href}">${image}<h3>${title}</h3></a><span class="price--current">${price}</span></div>`;
    case'tokopedia':return `<div class="card" data-testid="master-product-card"><a data-testid="lnkProductContainer" href="${href}">${image}<span data-testid="spnSRPProdName">${title}</span><span data-testid="spnSRPProdPrice">${price}</span></a></div>`;
    case'temu':return `<div class="card" data-testid="goods-card" data-goods-id="${n}">${link}<span data-testid="price">${price}</span></div>`;
    case'olx':return `<article class="card" data-ds-component="DS-NewAdCard">${link}<span data-testid="ad-price">${price}</span></article>`;
    case'blibli':return `<div class="card product__item"><a href="${href}">${image}<span class="product__item__name">${title}</span></a><span class="product__item__price">${price}</span></div>`;
    case'mudah':return `<article class="card" data-testid="listing-ad-item">${link}<span data-testid="ad-price">${price}</span></article>`;
    case'carousell':return `<div class="card" data-testid="listing-card"><a href="${href}">${image}<p data-testid="listing-card-title">${title}</p></a><p data-testid="listing-card-price">${price}</p></div>`;
    default:throw Error(family);
  }
}
function searchHtml(family,url,country,lazy=false){
  const wrappers={amazon:['<main class="s-main-slot" data-component-type="s-search-results">','</main>'],mercado:['<main><ul class="ui-search-layout">','</ul></main>'],shopee:['<main><ul class="shopee-search-item-result__items">','</ul></main>'],tokopedia:['<main data-testid="divSRPContentProducts">','</main>'],fastmoss:['<main><table><thead><tr><th>商品</th><th>所属店铺</th><th>总销量</th></tr></thead><tbody class="ant-table-tbody">','</tbody></table></main>'],echotik:['<main><table><thead><tr><th>商品</th><th>价格</th><th>总销量</th></tr></thead><tbody class="ant-table-tbody">','</tbody></table></main>']};
  const [start,end]=wrappers[family]||['<main>','</main>'];
  return `<!doctype html><style>body{margin:0}.card{display:block;height:260px;border:1px solid #ccc;box-sizing:border-box}.card img{width:20px;height:20px}header{height:40px}</style><header><div data-testid="country-selector">${country}</div></header>${start}${card(family,url,country,1)}${card(family,url,country,2)}${lazy?'':card(family,url,country,3)}${end}${lazy?`<script>let done=false;window.addEventListener('scroll',()=>{if(!done&&scrollY+innerHeight>=document.scrollingElement.scrollHeight-40){done=true;setTimeout(()=>{const target=document.querySelector('tbody')||document.querySelector('main ul')||document.querySelector('main');target.insertAdjacentHTML('beforeend',${JSON.stringify(card(family,url,country,3))});},20);}});</script>`:''}`;
}
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.argv[3]?{executablePath:process.argv[3]}:{})});const errors=[];
  try{
    const page=await browser.newPage({viewport:{width:1000,height:400}});
    page.on('pageerror',error=>errors.push(error.message));
    let html='';await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html; charset=utf-8',body:html}):route.abort());
    async function open(url,body){html=body;await page.goto(url);for(const file of ['data.js','core.js','search.js'])await page.addScriptTag({content:fs.readFileSync(path.join(base,'market_capture',file),'utf8')});}
    for(const {country,url,platform} of cases){
      const family=core.siteFor(url).family,label=country+' '+platform.name;
      await open(url,searchHtml(family,url,country));
      const result=await page.evaluate(({country})=>({search:IantoMarketCore.readSearch(document,location.href,country),cards:IantoMarketCore.readCards(document,location.href,{country}).map(c=>({fields:c.fields,position:c.position})),kind:IantoMarketCore.pageKind(document,location.href)}),{country});
      assert.equal(result.kind,'search',label);assert.equal(result.cards.length,3,label+' card count');
      for(let i=0;i<3;i++){const record=result.cards[i];assert.equal(record.fields.title,'Fixture Café Fan '+(i+1),label+' title');assert.equal(record.fields.country,country,label+' country');assert.ok(record.fields.currency,label+' currency');assert.ok(record.fields.price!==null,label+' price');assert.match(record.fields.image,/images\.example\.test\/fan-\d\.jpg/,label+' lazy image');assert.equal(record.position,i+1,label+' position');}
      const actual=platform.forceLowercase?word.toLowerCase():word;assert.equal(result.search.query,actual,label+' actual query');
      const detailUrl=product(url,1),detail=`<!doctype html><h1 id="productTitle">Fixture Detail Fan</h1><script type="application/ld+json">${JSON.stringify({'@type':'Product',name:'Fixture Detail Fan',image:'https://images.example.test/detail.jpg',url:detailUrl,offers:{price:129.9,priceCurrency:result.cards[0].fields.currency},brand:{name:'Fixture'},aggregateRating:{ratingValue:'4.8',reviewCount:'12'}})}</script>`;
      await open(detailUrl,detail);
      const detailRow=await page.evaluate(country=>IantoMarketCore.detailFields(document,location.href,country),country);
      assert.equal(detailRow.title,'Fixture Detail Fan',label+' detail title');assert.equal(detailRow.country,country,label+' detail country');assert.equal(detailRow.price,129.9,label+' detail price');assert.equal(detailRow.image,'https://images.example.test/detail.jpg',label+' detail image');
    }
    console.log('PASS: 42 country/platform search and detail DOM fixtures');
    const families=new Set();
    for(const {country,url} of cases){const family=core.siteFor(url).family;if(families.has(family))continue;families.add(family);
      await open(url,searchHtml(family,url,country,true));
      const loaded=await page.evaluate(async country=>{const result=await IantoMarketSearch.collect({country,stepDelay:5,quietTime:80,maxDuration:3000,loadingTimeout:1000});return {complete:result.complete,count:result.cards.length,countries:result.cards.map(c=>c.fields.country)};},country);
      assert.equal(loaded.complete,true,family+' lazy completion');assert.equal(loaded.count,3,family+' lazy load');assert.ok(loaded.countries.every(code=>code===country));
    }
    console.log('PASS: all 13 platform families load appended products');
    // Test the four adapters against unlabelled cards as well as their direct selectors.
    for(const family of ['olx','blibli','mudah','carousell']){
      const sample=cases.find(c=>core.siteFor(c.url).family===family),url=sample.url;
      const fallback=`<!doctype html><main>${[1,1,2].map((id,index)=>`<article><a href="${product(url,id)}"><img alt="Fallback ${index+1}" src="https://images.example.test/fallback.jpg"></a><a href="${product(url,id)}"><h2>Fallback ${index+1}</h2></a><p>${prices[sample.country]}</p></article>`).join('')}</main><footer><a href="${product(url,3)}">Footer product</a></footer>`;
      await open(url,fallback);const rows=await page.evaluate(()=>IantoMarketCore.readCards(document,location.href).map(c=>({position:c.position,title:c.fields.title,key:c.key,price:c.fields.price})));
      assert.equal(rows.length,3,family+' fallback count and duplicate exposures');assert.equal(rows[0].key,rows[1].key);assert.notEqual(rows[1].key,rows[2].key);assert.ok(rows.every(r=>r.price!==null));
    }
    console.log('PASS: four added adapters retain repeated products and exclude footer links');
    await open('https://www.fastmoss.com/zh/e-commerce/search?words=Fan&region=MX','<header><img src="https://cdn.example.test/regions/br.svg" alt="brazil"></header><h1>TikTok 巴西 商品搜索</h1><table><tbody class="ant-table-tbody">'+card('fastmoss','https://www.fastmoss.com','BR',1)+'</tbody></table>');
    const corrected=await page.evaluate(()=>({search:IantoMarketCore.readSearch(document,location.href,'MX'),row:IantoMarketCore.readCards(document,location.href,{country:'MX'})[0].fields}));assert.equal(corrected.search.country,'BR');assert.equal(corrected.row.country,'BR');assert.equal(corrected.row.currency,'BRL');
    console.log('PASS: actual displayed country overrides URL and original Ianto country');
    await open('https://fixture.example.test/ianto',fs.readFileSync(path.join(base,'unified_popup.html'),'utf8'));
    await page.evaluate(()=>{
      const stored={multisearch_lastKeyword:'Saved word',multisearch_lastCountryCode:'MX',multisearch_platformSelection_MX:{ml_mx:false}};
      window.fixtureMessages=[];window.fixtureAlerts=[];window.fixtureStore=stored;window.fixtureDelayed=false;window.fixtureCallbacks=[];
      window.alert=message=>fixtureAlerts.push(message);
      window.chrome={storage:{local:{get(keys,callback){const result=Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,stored[key]]));if(window.fixtureDelayed&&typeof keys==='string')fixtureCallbacks.push(()=>callback(result));else queueMicrotask(()=>callback(result));},set(values){Object.assign(stored,values);}}},runtime:{sendMessage:async message=>{fixtureMessages.push(message);return {ok:true,opened:true};}}};
    });
    for(const file of ['features/multisearch_platforms.js','features/feature_multisearch.js','market_capture/popup.js'])await page.addScriptTag({content:fs.readFileSync(path.join(base,file),'utf8')});
    await page.evaluate(()=>document.dispatchEvent(new Event('DOMContentLoaded')));
    assert.equal(await page.locator('#multisearch_country_select option').count(),8);assert.equal(await page.locator('#multisearch_keyword').inputValue(),'Saved word');assert.equal(await page.locator('#ml_mx').isChecked(),false);
    for(const [country,group] of Object.entries(registry.countries)){
      await page.locator('#multisearch_country_select').selectOption(country);
      assert.equal(await page.locator('#multisearch_platform_list input').count(),group.platforms.length);
      for(const checkbox of await page.locator('#multisearch_platform_list input').all())await checkbox.check();
      await page.locator('#multisearch_keyword').fill(word);await page.locator('#multisearch_research_topic').fill('Shared research');
      const before=await page.evaluate(()=>fixtureMessages.length);await page.locator('#multisearch-button').click();
      await page.waitForFunction(()=>!document.getElementById('multisearch-button').disabled);
      const requests=await page.evaluate(before=>fixtureMessages.slice(before),before);
      assert.equal(requests.length,group.platforms.length);assert.ok(requests.every(r=>r.type==='openSearch'&&r.research.country===country&&r.research.originalQuery===word&&r.research.topic==='Shared research'));
      assert.equal(new Set(requests.map(r=>r.research.researchId)).size,1);
      for(let i=0;i<requests.length;i++)assert.equal(requests[i].url,registry.buildUrl(group.platforms[i],word));
      assert.equal(await page.locator('#multisearch_research_topic').inputValue(),'');
    }
    await page.locator('#multisearch_country_select').selectOption('SG');await page.locator('#multisearch_keyword').fill('Second word');await page.locator('#multisearch-button').click();await page.waitForFunction(()=>!document.getElementById('multisearch-button').disabled);
    assert.equal((await page.evaluate(()=>fixtureMessages.at(-1))).research.topic,'Second word');
    await page.evaluate(()=>{fixtureDelayed=true;});
    for(const country of ['BR','MX','BR'])await page.locator('#multisearch_country_select').selectOption(country);
    await page.evaluate(()=>{fixtureCallbacks.forEach(fn=>fn());fixtureDelayed=false;});
    assert.equal(await page.locator('#multisearch_platform_list input').count(),7);
    assert.deepEqual(await page.evaluate(()=>fixtureAlerts),[]);
    console.log('PASS: popup renders 8 countries/42 choices, remembers selections, resets topic, and ignores stale country callbacks');
    require('../market_capture/data.js');require('../market_capture/feishu.js');
    const {create}=require('../market_capture/direct.js'),batchId='11111111-1111-4111-a111-111111111111';
    const first={id:'22222222-2222-4222-a222-222222222222',batchId,title:'Original product title stays in CSV',country:'MX',platform:'Amazon',topic:'Ventilador de bolsillo',url:'https://www.amazon.com.mx/dp/B012345678',captureMethod:'搜索页整理',capturedAt:'2026-10-23T12:53:48.000Z'};
    const stored={ianto_market_v1_index:[{batchId,status:'saved',count:60,at:first.capturedAt,method:first.captureMethod,topic:first.topic,title:first.title,images:{total:0,saved:0,pending:0,failed:0}}],[`ianto_market_v1_batch_${batchId}`]:{batch:{batchId,records:[first]},createdAt:first.capturedAt,receipts:[{id:first.id,recordId:'fixture-record'}],images:[]}};
    const storage={async get(keys){if(keys===null)return structuredClone(stored);return structuredClone(Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,stored[k]])));},async set(values){Object.assign(stored,structuredClone(values));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete stored[k];}};
    const direct=create({storage,tokenStorage:storage,fetcher:async()=>{throw Error('History must not access Feishu');}}),before=structuredClone(stored);
    const history=await direct.status();assert.equal(history.history[0].country,'MX');assert.equal(history.history[0].platform,'Amazon');assert.deepEqual(stored,before,'Reading summary must not rewrite snapshots or revive data');
    assert.ok((await direct.exportCSV(batchId)).includes(first.title),'CSV retains full product data');
    await page.exposeFunction('fixtureHistoryCall',async message=>{
      if(message.type==='settingsGet'||message.type==='status')return {ok:true,...await direct.status(),enabled:true,settings:{enabled:true,feishu:await direct.settings()}};
      if(message.type==='deleteBatch'){await direct.deleteBatch(message.batchId);return {ok:true,deleted:true};}
      throw Error('Unexpected history message '+message.type);
    });
    await open('https://fixture.example.test/settings',fs.readFileSync(path.join(base,'market_capture/settings.html'),'utf8'));
    await page.evaluate(()=>{window.confirm=()=>true;window.chrome={runtime:{sendMessage:message=>window.fixtureHistoryCall(message)},storage:{onChanged:{addListener(){}}}};});
    await page.addScriptTag({content:fs.readFileSync(path.join(base,'market_capture/settings.js'),'utf8')});
    await page.waitForFunction(()=>document.querySelector('#history .item'));
    const summary=await page.locator('#history .item > div').first().textContent();
    assert.equal(summary,'2026/10/23 20:53:48 · MX · Amazon · 搜索页整理 · 60 个 · Ventilador de bolsillo');
    assert.ok(!(await page.locator('#history').textContent()).includes(first.title));
    await page.locator('#history button.danger').click();await page.waitForFunction(()=>document.querySelector('#history').textContent==='暂无记录');
    assert.equal((await direct.status()).history.length,0);assert.equal(stored[`ianto_market_v1_batch_${batchId}`],undefined);
    console.log('PASS: history shows time/country/platform/method/count/topic, CSV keeps product titles, last-item deletion remains complete');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
