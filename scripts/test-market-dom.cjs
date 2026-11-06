const test=require('node:test'),assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const core=require('../market_capture/core.js'),search=require('../market_capture/search.js');
const fixtures=require('./fixtures/market-live-cards.json');
function documentFor(html){return parseHTML('<!doctype html><html><body>'+html+'</body></html>').document;}
function rows(name){const f=fixtures[name],{document}=parseHTML(f.html);return core.readCards(document,f.url,{country:'MX'});}

test('Mercado 实页评分留在评分栏，未展示销量和评价数时留空，价格不取优惠券',()=>{
  const a=rows('mercado');assert.equal(a.length,3);
  assert.equal(a[1].fields.ratingText,'4.9');assert.equal(a[1].fields.salesText,'');assert.equal(a[1].fields.reviewsText,'');
  assert.equal(a[0].fields.price,179.33);assert.equal(a[1].fields.price,128.79);
});
test('Amazon 实页评论数量可读，分期和付款提示不作为销量',()=>{
  const a=rows('amazon');assert.equal(a.length,4);
  assert.match(a[2].fields.reviewsText,/36/);assert.match(a[2].fields.ratingText,/4.6/);
  assert.equal(a[0].fields.salesText,'');assert.match(a[3].fields.salesText,/comprados/);
  assert.ok(a.every(x=>!/intereses|Anterior|lista|Pix|NuPay/i.test(x.fields.salesText)));
});
test('FastMoss 实页排除测量行，从1开始；店铺、总销量和评分不串位',()=>{
  const a=rows('fastmoss');assert.deepEqual(a.map(x=>x.position),[1,2]);
  assert.equal(a[1].fields.shop,'MemoWax');assert.equal(a[1].fields.salesText,'106');assert.equal(a[1].fields.ratingText,'5.0');assert.equal(a[1].fields.price,117);
});
test('FastMoss 筛选保留时间和在售状态，排序保留方向，不误把图标当字段名',()=>{
  const doc=documentFor('<button><span>日期</span><span>近7天</span></button><button><span><svg></svg></span><span>商品状态</span><span>在售</span></button><table><thead><tr><th class="ant-table-column-has-sorters" aria-sort="descending">近7天销量</th></tr></thead></table>');
  const s=core.readSearch(doc,'https://www.fastmoss.com/zh/e-commerce/search?words=mold','MX');assert.equal(s.filters,'日期：近7天；商品状态：在售');assert.equal(s.sort,'近7天销量 · 降序');
});
test('Temu 实页能采商品、当前价格、AUD、销量、评分和评价数量，广告保留',()=>{
  const a=rows('temu');assert.equal(a.length,4);assert.equal(a[0].fields.country,'AU');assert.equal(a[0].fields.currency,'AUD');
  assert.equal(a[0].fields.price,2.09);assert.equal(a[0].fields.priceText,'AU$2.09');assert.equal(a[0].fields.salesText,'35K+sold');
  assert.equal(a[0].fields.reviewsText,'1,165 reviews');assert.equal(a[0].fields.ratingText,'4.9 out of five stars');assert.equal(a.at(-1).fields.ad,'是');
});
test('Lazada 实页销量可读，星图保留显示含义，不把部分星擅自算成半星',()=>{
  const a=rows('lazada');assert.equal(a.length,3);assert.equal(a[0].fields.price,7500);assert.equal(a[0].fields.salesText,'28 sold');assert.equal(a[0].fields.reviewsText,'(6)');
  assert.match(a[0].fields.ratingText,/3 整星、1 部分星、1 空星/);assert.match(a[0].fields.ratingText,/未展示精确评分/);
});

test('Mudah 实页主结果按商品卡识别，价格从当前文字读取，推荐区不混入搜索位置',()=>{
  const a=rows('mudah');assert.equal(a.length,3);assert.deepEqual(a.map(r=>r.position),[1,2,3]);
  assert.equal(a[0].fields.title,'kipas');assert.equal(a[0].fields.price,200);assert.equal(a[1].fields.price,420);
  assert.equal(a[2].fields.price,2250);assert.ok(a.every(r=>r.fields.country==='MY'&&r.fields.currency==='MYR'));
  assert.ok(a.every(r=>!r.fields.title.includes('Pembantu')));
});

test('Echotik 当前地区单选优先于失效URL参数和Ianto国家，空结果不作为商品',()=>{
  const f=fixtures['echotik-empty'],doc=documentFor(f.html);assert.equal(core.pageCountry(doc,f.url,'MX'),'US');
  assert.equal(core.scanCards(doc,f.url).items.length,0);assert.equal(core.scanCards(doc,f.url).unresolvedCount,0);
  const mexico=documentFor('<div role="radiogroup" aria-label="Region"><button role="radio" aria-checked="true">Mexico</button></div>');
  assert.equal(core.pageCountry(mexico,'https://echotik.live/products?keyword=fan&country=BR','BR'),'MX');
  assert.match(core.pageProblem(documentFor('<div>Check below to verify if you\'re human.</div>'),'https://www.blibli.com/cari/kipas'),/验证页/);
});
test('速卖通结果路径恢复实际搜索词，明确配送国家覆盖 Ianto 目标国家',()=>{
  const doc=documentFor('<input id="search-words" value="Molde para Velas"><div class="search-item-card-wrapper"><a href="https://pt.aliexpress.com/item/1005013335132451.html?pdp_npi=6%40dis!BRL!15.26!15.26!sea!BR!0!"><h3>Molde de silicone</h3></a><div class="multi--price-sale--test"><span>R$15,26</span></div><span class="trade">4.9 2.000+ vendido(s)</span></div>');
  const url='https://pt.aliexpress.com/w/wholesale-Molde-para-Velas.html',s=core.readSearch(doc,url,'MX'),a=core.readCards(doc,url,{country:'MX'});
  assert.equal(s.query,'Molde para Velas');assert.equal(s.country,'BR');assert.equal(a[0].fields.currency,'BRL');assert.equal(a[0].fields.price,15.26);assert.equal(a[0].fields.salesText,'2.000+ vendido(s)');
});
test('明确商品ID和标题的速卖通卡片在链接未加载时仍可收录60个；无依据不编造商品',()=>{
  const doc=documentFor(Array.from({length:60},(_,i)=>`<div class="search-item-card-wrapper" data-item-id="${1005013335000000+i}"><h3>Molde ${i+1}</h3><span class="price-current">R$15,26</span></div>`).join('')+'<div class="search-item-card-wrapper"><h3>未加载链接</h3></div>');
  const s=core.scanCards(doc,'https://pt.aliexpress.com/w/wholesale-Molde.html',{country:'BR'});assert.equal(s.items.length,60);assert.equal(s.candidateCount,61);assert.equal(s.unresolvedCount,1);assert.equal(s.items.at(-1).position,60);
});
test('Tokopedia 不依赖过时 data-testid，普通商品卡与广告跳转链接均可识别',()=>{
  const target='https://www.tokopedia.com/toko/contoh-cetakan-lilin',ad='https://ta.tokopedia.com/promo/v1/clicks?r='+encodeURIComponent(target);
  const doc=documentFor(`<main><article><a href="${ad}"><img alt="Cetakan Lilin" src="https://images.tokopedia.net/img/product.jpg"></a><span>Rp24.500</span><span>13 terjual</span><span aria-label="4.8 / 5"></span></article></main>`);
  const a=core.readCards(doc,'https://www.tokopedia.com/search?q=cetakan+lilin');assert.equal(a.length,1);assert.equal(a[0].fields.title,'Cetakan Lilin');assert.equal(a[0].fields.price,24500);assert.equal(a[0].fields.salesText,'13 terjual');
  assert.equal(core.productIdentity(ad).productId,'toko/contoh-cetakan-lilin');
});
test('独立采集只保存实际结果词，不用搜索模式参数 st 冒充搜索词',()=>{
  const doc=documentFor('');assert.equal(core.readSearch(doc,'https://www.tokopedia.com/search?st=product').query,'');
  assert.equal(core.readSearch(doc,'https://www.amazon.com.mx/s?k=Caf%C3%A9').query,'Café');
});
test('登录页、反爬验证页、Cloudflare 拦截均给出具体原因',()=>{
  assert.match(core.pageProblem(documentFor('¡Hola! Para continuar, ingresa a tu cuenta'),'https://www.mercadolibre.com.mx/gz/account-verification?go=https%3A%2F%2Flistado.mercadolibre.com.mx%2Fventilador-de-bolsillo'),/登录验证页/);
  assert.match(core.pageProblem(documentFor(''),'https://shopee.co.id/verify/traffic'),/验证/);
  assert.match(core.pageProblem(documentFor(''),'https://www.temu.com/login.html'),/登录/);
  const d=parseHTML('<html><head><title>Attention Required!</title></head><body>Sorry, you have been blocked. Cloudflare</body></html>').document;
  assert.match(core.pageProblem(d,'https://www.olx.com.br/brasil?q=molde'),/拦截/);
});

function loadingPage({login=false,stalled=false,unresolved=0}={}){
  const doc=documentFor((login?'<header><button>Sign in / Register</button></header>':'')+'<div role="button" aria-label="See more items">See more</div>');
  const more=doc.querySelector('[aria-label="See more items"]');more.getBoundingClientRect=()=>({height:40,width:160});more.scrollIntoView=()=>{};
  const root={scrollTop:0,scrollLeft:0,scrollHeight:100,clientHeight:100},items=Array.from({length:2},(_,i)=>({card:{isConnected:true,getAttribute:()=>null,parentElement:null},key:'product'+i,position:i+1,fields:{title:'Product '+i,ad:'未见广告标记'}}));
  let clicks=0;more.click=()=>{clicks++;if(!stalled){items.push({card:{isConnected:true,getAttribute:()=>null,parentElement:null},key:'new',position:3,fields:{title:'New',ad:'未见广告标记'}});more.remove();}};
  Object.defineProperty(doc,'scrollingElement',{value:root});const win={location:{href:'https://www.temu.com/search_result.html?search_key=mold'},innerHeight:100,scrollX:0,scrollY:17,scrollTo({top}){root.scrollTop=top;this.scrollY=top;}};
  const c={cardElements:()=>[],readSearch:()=>({query:'mold',country:'AU',page:1}),readCards:()=>items,scanCards:()=>({unresolvedCount:unresolved})};
  return {doc,win,core:c,get clicks(){return clicks;},options:{doc,win,core:c,limit:100,stepDelay:1,quietTime:3,loadMoreTimeout:5,maxDuration:3000}};
}
test('加载更多只追加当前搜索商品；完成后恢复原滚动位置',async()=>{
  const f=loadingPage(),r=await search.collect(f.options);assert.equal(f.clicks,1);assert.equal(r.cards.length,3);assert.equal(r.complete,true);assert.equal(f.win.scrollY,17);
});
test('Temu 未登录时保留已经识别的商品并提示登录，不跳走丢失结果',async()=>{
  const f=loadingPage({login:true}),r=await search.collect(f.options);assert.equal(f.clicks,0);assert.equal(r.cards.length,2);assert.equal(r.reason,'login-required');assert.equal(r.complete,false);
});
test('加载更多无进展时停止重试并标为部分结果',async()=>{
  const f=loadingPage({stalled:true}),r=await search.collect(f.options);assert.equal(f.clicks,2);assert.equal(r.reason,'load-more-stalled');assert.equal(r.cards.length,2);assert.equal(r.complete,false);
});
test('仍有商品卡未识别时不把到底当作采集完整',async()=>{
  const f=loadingPage({unresolved:2});f.doc.querySelector('[role="button"]').remove();const r=await search.collect(f.options);assert.equal(r.reason,'unrecognized');assert.equal(r.unresolvedCount,2);assert.equal(r.complete,false);
});
test('其他平台的加载、翻页或购买按钮不会被自动点击',()=>{
  const f=loadingPage();assert.equal(search.loadMoreControl(f.doc,'https://www.amazon.com.mx/s?k=mold'),null);
  f.doc.querySelector('[role="button"]').setAttribute('aria-label','Add to cart');f.doc.querySelector('[role="button"]').textContent='Add to cart';assert.equal(search.loadMoreControl(f.doc,f.win.location.href),null);
});

test('扩展更新会替换失效圆钮，已正常注入不重复执行，其他网站不受影响',async()=>{
  const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
  const d=documentFor('<div id="ianto-market-capture" data-ianto-market-version="2.6.23"></div>');let disposed=0,installed,updated;
  d.querySelector('#ianto-market-capture').addEventListener('ianto-market-dispose',()=>disposed++);
  const files=[],chrome={runtime:{getManifest:()=>({version:'2.6.24'}),onMessage:{addListener(){}},onStartup:{addListener(){}},onInstalled:{addListener(fn){installed=fn;}}},storage:{local:{},session:{remove:async()=>{}}},alarms:{create(){},onAlarm:{addListener(){}}},tabs:{query:async()=>[{id:1,url:'https://www.olx.com.br/brasil?q=molde'},{id:2,url:'https://example.test'}],onUpdated:{addListener(fn){updated=fn;}},onRemoved:{addListener(){}}},scripting:{async executeScript(value){if(value.func)return [{result:vm.runInNewContext('('+value.func.toString()+')(...args)',{document:d,Event:d.defaultView.Event,args:value.args})}];files.push(value);return [];}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../market_capture/background.js'),'utf8'),{chrome,URL,console,importScripts(){},IantoMarketCore:core,IantoMarketDirect:{create:()=>({resume:async()=>{},syncHeaders:async()=>{}})}});
  installed();await new Promise(resolve=>setTimeout(resolve,15));assert.equal(disposed,1);assert.equal(files.length,1);assert.equal(files[0].target.tabId,1);assert.ok(files[0].files.includes('market_capture/content.js'));
  const host=d.createElement('div');host.id='ianto-market-capture';host.dataset.iantoMarketVersion='2.6.24';d.body.appendChild(host);
  updated(1,{status:'complete'},{url:'https://www.olx.com.br/brasil?q=molde'});await new Promise(resolve=>setTimeout(resolve,15));assert.equal(files.length,1);assert.equal(host.isConnected,true);
});

test('美国 Walmart / eBay 搜索页、详情页、分页及商品 ID 识别',()=>{
  const walmart='https://www.walmart.com/search?q=dog+blanket';
  const wdoc=documentFor('<div data-testid="product-tile"><a href="/ip/cozy-dog-blanket/123456789"><img src="https://img.example.test/blanket.jpg"><span data-automation-id="product-title">Cozy Dog Blanket</span></a><div data-automation-id="product-price">$19.97</div></div>');
  const w=core.readCards(wdoc,walmart,{country:'US'});
  assert.equal(w.length,1);assert.equal(w[0].fields.productId,'123456789');
  assert.equal(w[0].fields.title,'Cozy Dog Blanket');assert.equal(w[0].fields.price,19.97);assert.equal(w[0].fields.currency,'USD');
  assert.equal(core.readSearch(wdoc,walmart).query,'dog blanket');
  const ebay='https://www.ebay.com/sch/i.html?_nkw=dog+blanket&_pgn=2';
  const edoc=documentFor('<ul><li class="s-item"><a class="s-item__link" href="/itm/cozy-dog-blanket/123456789012"><h3 class="s-item__title">Dog Blanket on eBay</h3><img src="https://img.example.test/ebay.jpg"></a><span class="s-item__price">US $18.50</span></li></ul>');
  const e=core.readCards(edoc,ebay,{country:'US'});
  assert.equal(e.length,1);assert.equal(e[0].fields.productId,'123456789012');
  assert.equal(e[0].fields.price,18.5);assert.equal(e[0].fields.currency,'USD');
  assert.equal(core.readSearch(edoc,ebay).page,2);
  const range=documentFor('<h1>Dog Blanket</h1><div class="x-price-primary">US $18.50 to US $28.50</div>');
  assert.equal(core.detailFields(range,'https://www.ebay.com/itm/123456789012').price,null);
  assert.equal(core.productIdentity('https://www.ebay.com/sch/i.html?_nkw=dog'),null);
  assert.equal(core.productIdentity('https://www.walmart.com/search?q=dog'),null);
  assert.equal(core.siteFor('https://www.walmart.com/search?q=dog').country,'US');
  assert.equal(core.siteFor('https://www.ebay.com/sch/i.html?_nkw=dog').country,'US');
});
