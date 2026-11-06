(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.IantoMarketCore = api;
})(globalThis, function() {
  'use strict';
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const list = (root, selector) => { try { return Array.from(root.querySelectorAll(selector)); } catch { return []; } };
  const first = (root, selectors) => {
    for (const selector of selectors || []) {
      const el = root.matches?.(selector)?root:root.querySelector(selector);
      if (el) { const value = clean(el.getAttribute('content') || el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('aria-label')); if (value) return value; }
    }
    return '';
  };
  const ends = (host, domain) => host === domain || host.endsWith('.' + domain);
  const COUNTRY_NAMES={BR:['brazil','brasil','巴西'],MX:['mexico','méxico','墨西哥'],ID:['indonesia','印度尼西亚','印尼'],PH:['philippines','菲律宾'],MY:['malaysia','马来西亚'],VN:['vietnam','viet nam','越南'],TH:['thailand','泰国'],SG:['singapore','新加坡'],US:['united states','美国'],CN:['china','中国'],AU:['australia','澳大利亚'],NZ:['new zealand','新西兰'],CA:['canada','加拿大'],GB:['united kingdom','英国'],DE:['germany','deutschland','德国'],FR:['france','法国'],ES:['spain','españa','西班牙']};
  function countryCode(value){
    const text=clean(value).toLowerCase();
    if(Object.hasOwn(COUNTRY_NAMES,text.toUpperCase()))return text.toUpperCase();
    return Object.entries(COUNTRY_NAMES).find(([,names])=>names.includes(text))?.[0]||'';
  }
  function shownCountry(root){
    for(const el of list(root,'[data-country-code], [data-region-code], img[src*="/regions/"], img[src*="/flags/"]')){
      if(el.getClientRects&&!el.getClientRects().length)continue;
      const code=countryCode(el.getAttribute('data-country-code')||el.getAttribute('data-region-code')||el.getAttribute('src')?.match(/\/(?:regions|flags)\/([a-z]{2})(?:[_.\/]|$)/i)?.[1]||el.getAttribute('alt'));
      if(code)return code;
    }
    return '';
  }
  function countryInLabel(value){
    const exact=countryCode(value);if(exact)return exact;
    const text=clean(value).toLowerCase();
    return Object.entries(COUNTRY_NAMES).find(([,names])=>names.some(name=>text===name||text.startsWith(name+' ')||text.endsWith(' '+name)))?.[0]||'';
  }
  function aliLinkCountry(doc){
    const codes=new Set();
    for(const a of list(doc,'a[href*="pdp_npi="]')){
      try{const value=new URL(a.getAttribute('href'), 'https://www.aliexpress.com').searchParams.get('pdp_npi')||'',code=value.match(/!sea!([A-Z]{2})!/i)?.[1];if(code)codes.add(code.toUpperCase());}catch{}
    }
    return codes.size===1?[...codes][0]:'';
  }
  function pageCountry(doc,value,fallback=''){
    const site=siteFor(value);if(!site)return '';
    if(['fastmoss','echotik'].includes(site.family)){
      const region=first(doc,['[role="radiogroup"][aria-label="Region"] [role="radio"][aria-checked="true"]','[role="radiogroup"][aria-label="地区"] [role="radio"][aria-checked="true"]']);
      if(countryCode(region))return countryCode(region);
      const header=doc.querySelector('header, [role="banner"]');
      const selected=first(doc,['[data-testid="country-selector"]','[data-testid="region-selector"]','select[name="country"] option:checked','select[name="region"] option:checked']);
      const flag=header?shownCountry(header):'';
      if(flag)return flag;
      const code=countryCode(selected);if(code)return code;
      const heading=first(doc,['main h1','h1']);
      for(const [code,names] of Object.entries(COUNTRY_NAMES))if(names.some(name=>heading.toLowerCase().includes(name)))return code;
    }
    if(['aliexpress','temu','tiktok','fastmoss','echotik'].includes(site.family)){
      const u=new URL(value),selected=first(doc,['[data-testid="ship-to-country"]','[data-testid="country-name"]','[data-country-selected="true"]','select[name="shipToCountry"] option:checked']);
      const header=doc.querySelector('#mainHeader, header, [role="banner"], #header');
      const flag=header?shownCountry(header):'';if(flag)return flag;
      const label=list(header||doc,'[aria-label], [data-country-code], [data-region-code]').map(el=>countryInLabel(el.getAttribute('aria-label')||el.getAttribute('data-country-code')||el.getAttribute('data-region-code'))).find(Boolean);
      const code=countryCode(selected)||label||(site.family==='aliexpress'?aliLinkCountry(doc):'')||countryCode(u.searchParams.get('shipToCountry')||u.searchParams.get('country')||u.searchParams.get('region'));
      if(code)return code;
      if(site.family==='temu'){const pathCountry=countryCode(u.pathname.match(/^\/([a-z]{2})\//i)?.[1]);if(pathCountry)return pathCountry;}
    }
    return site.country||countryCode(fallback);
  }
  function siteFor(value) {
    let u; try { u = new URL(value); } catch { return null; }
    const h = u.hostname.toLowerCase();
    if (!['https:','http:'].includes(u.protocol)) return null;
    const countries = { 'com.br':'BR','com.mx':'MX','co.id':'ID','com.my':'MY','com.ph':'PH','co.th':'TH','com.vn':'VN','vn':'VN','ph':'PH','sg':'SG','com':'US' };
    const country = Object.entries(countries).find(([suffix])=>h.endsWith('.'+suffix))?.[1] || '';
    if (ends(h,'walmart.com')) return { family:'walmart',platform:'Walmart',source:'Walmart',country:'US' };
    if (ends(h,'ebay.com')) return { family:'ebay',platform:'eBay',source:'eBay',country:'US' };
    if (['amazon.com.br','amazon.com.mx','amazon.sg','amazon.com'].some(d=>ends(h,d))) return { family:'amazon',platform:'Amazon',source:'Amazon',country };
    if (ends(h,'mercadolibre.com.mx')||ends(h,'listado.mercadolibre.com.mx')) return { family:'mercado',platform:'Mercado Libre',source:'Mercado Libre',country:'MX' };
    if (ends(h,'mercadolivre.com.br')) return { family:'mercado',platform:'Mercado Libre',source:'Mercado Livre',country:'BR' };
    if (['shopee.com.br','shopee.co.id','shopee.ph','shopee.com.my','shopee.vn','shopee.co.th','shopee.sg'].some(d=>ends(h,d))) return { family:'shopee',platform:'Shopee',source:'Shopee',country };
    if (['lazada.co.id','lazada.com.my','lazada.com.ph','lazada.co.th','lazada.vn','lazada.sg'].some(d=>ends(h,d))) return { family:'lazada',platform:'Lazada',source:'Lazada',country };
    if (ends(h,'fastmoss.com')) return { family:'fastmoss',platform:'TikTok Shop',source:'FastMoss',country:(u.searchParams.get('region')||'').toUpperCase() };
    if (ends(h,'echotik.live')) return { family:'echotik',platform:'TikTok Shop',source:'Echotik',country:(u.searchParams.get('country')||'').toUpperCase() };
    if (['shop.tiktok.com','www.tiktok.com','shop.tiktokglobalshop.com'].includes(h)) return { family:'tiktok',platform:'TikTok Shop',source:'TikTok Shop',country:(u.searchParams.get('region')||u.pathname.match(/\/shop\/([a-z]{2})\/pdp/i)?.[1]||'').toUpperCase() };
    if (ends(h,'aliexpress.com')) return { family:'aliexpress',platform:'AliExpress',source:'AliExpress',country:'' };
    if (ends(h,'tokopedia.com')) return { family:'tokopedia',platform:'Tokopedia',source:'Tokopedia',country:'ID' };
    if (ends(h,'temu.com')) return { family:'temu',platform:'Temu',source:'Temu',country:'' };
    if (ends(h,'1688.com')) return { family:'1688',platform:'1688',source:'1688',country:'CN' };
    if (ends(h,'olx.com.br')) return {family:'olx',platform:'OLX',source:'OLX',country:'BR'};
    if (ends(h,'blibli.com')) return {family:'blibli',platform:'Blibli',source:'Blibli',country:'ID'};
    if (ends(h,'mudah.my')) return {family:'mudah',platform:'Mudah',source:'Mudah',country:'MY'};
    if (ends(h,'carousell.sg')) return {family:'carousell',platform:'Carousell',source:'Carousell',country:'SG'};
    return null;
  }
  function productIdentity(value, base, depth = 0) {
    let u; try { u = new URL(value,base); } catch { return null; }
    const site = siteFor(u.href); if (!site) return null;
    if(depth<2&&['aliexpress','tokopedia','temu'].includes(site.family))for(const key of ['url','redirectUrl','redirect','target','r']){
      const nested=u.searchParams.get(key);if(nested){const result=productIdentity(nested,u.origin,depth+1);if(result?.family===site.family)return result;}
    }
    let m, id = '', canonical = u.origin + u.pathname;
    if (site.family === 'amazon') {
      m = u.pathname.match(/\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:\/|$)/i);
      if (!m && depth < 2) for (const key of ['url','redirectUrl','redirect']) {
        const nested = u.searchParams.get(key); if (nested) { const result=productIdentity(nested,u.origin,depth+1); if(result?.family==='amazon')return result; }
      }
      if(m) { id=m[1].toUpperCase();canonical=u.origin+'/dp/'+id; }
    } else if (site.family==='walmart') {
      m=u.pathname.match(/^\/ip\/(?:[^/?#]+\/)?(\d{6,})\/?$/i);
      if(m){id=m[1];canonical='https://www.walmart.com/ip/'+id;}
    } else if (site.family==='ebay') {
      m=u.pathname.match(/^\/itm\/(?:[^/?#]+\/)?(\d{9,15})\/?$/i);
      if(m){id=m[1];canonical='https://www.ebay.com/itm/'+id;}
    } else if (site.family==='mercado') {
      if (/^(lista|listado|busca|categorias?)\./.test(u.hostname)) return null;
      m=u.pathname.match(/(MLM|MLB)(U?)-?(\d{6,})/i);if(m)id=m[1].toUpperCase()+m[2].toUpperCase()+m[3];
    } else if (site.family==='shopee') {
      m=u.pathname.match(/-i\.(\d+)\.(\d+)/)||u.pathname.match(/\/product\/(\d+)\/(\d+)/);if(m){id=m[1]+'.'+m[2];canonical=u.origin+'/product/'+m[1]+'/'+m[2];}
    } else if(site.family==='lazada') { m=u.pathname.match(/-i(\d+)(?:-s\d+)?\.html/i);if(m)id=m[1]; }
    else if(site.family==='fastmoss') { m=u.pathname.match(/\/e-commerce\/detail\/([\w-]+)/);if(m)id=m[1]; }
    else if(site.family==='echotik') { m=u.pathname.match(/\/products?\/([\d]{5,})/);if(m)id=m[1]; }
    else if(site.family==='tiktok') { m=u.pathname.match(/\/(?:view\/product|shop\/(?:[a-z]{2}\/)?pdp)\/(\d{5,})/i);if(m)id=m[1]; }
    else if(site.family==='aliexpress') {m=u.pathname.match(/\/item\/(\d+)\.html/);if(m)id=m[1];}
    else if(site.family==='temu') {m=u.pathname.match(/-g-(\d+)\.html/);id=m?.[1]||u.searchParams.get('goods_id')||'';if(id)canonical=u.origin+'/goods.html?goods_id='+encodeURIComponent(id);}
    else if(site.family==='1688') {m=u.pathname.match(/\/offer\/(\d+)\.html/);id=m?.[1]||u.searchParams.get('offerId')||'';if(id)canonical='https://detail.1688.com/offer/'+id+'.html';}
    else if(site.family==='tokopedia') {if(/^\/[^/]+\/[^/]+\/?$/.test(u.pathname)&&!/^\/(search|p|find|discovery|help|promo)\//.test(u.pathname))id=u.pathname.replace(/^\/|\/$/g,'');}
    else if(site.family==='olx') {m=u.pathname.match(/-(\d{7,})\/?$/);if(m)id=m[1];}
    else if(site.family==='blibli') {if(u.pathname.includes('/p/'))id=u.pathname.match(/\/ps--([^/]+)/)?.[1]||u.pathname;}
    else if(site.family==='mudah') {m=u.pathname.match(/-(\d+)\.htm/);if(m)id=m[1];}
    else if(site.family==='carousell') {m=u.pathname.match(/\/p\/.*-(\d+)\/?$/);if(m)id=m[1];}
    if(!id)return null;
    return {...site,productId:id,key:site.family+':'+u.hostname.replace(/^www\./,'')+':'+id,url:canonical};
  }
  const CONFIG = {
    walmart: {
      cards:'[data-testid="item-card"], [data-testid="product-card"], [data-testid="product-tile"], [data-automation-id="product-tile"], [data-item-id]',
      links:['a[href*="/ip/"]'],
      title:['h1#main-title', 'h1[data-testid="product-title"]', '[data-automation-id="product-title"]', '[data-testid="product-title"]', 'h2', 'h3'],
      price:['[data-automation-id="product-price"] [itemprop="price"]', '[data-automation-id="product-price"]', '[data-testid="price-wrap"] [itemprop="price"]', '[data-testid="price-wrap"]', '[itemprop="price"]'],
      rating:['[data-testid="rating-stars"] [aria-label]', '[data-testid="rating-stars"]', '[data-automation-id="product-rating"]', '[itemprop="ratingValue"]'],
      reviews:['[data-testid="reviews-and-ratings"]', '[data-testid="reviews-count"]', '[data-automation-id="reviews-count"]', '[itemprop="reviewCount"]'],
      sales:['[data-testid="sold-count"]', '[data-automation-id="sales-volume"]'],
      shop:['[data-testid="seller-name"]', '[data-testid="seller-info"]', '[data-automation-id="seller-name"]'],
      query:[],param:['q'],sort:['[data-testid="sort-by"] option:checked', '[data-testid="sort-by"]'],filters:'input[type="checkbox"]:checked',page:['[aria-current="page"]'],
      fallbackCards:true
    },
    ebay: {
      cards:'li.s-item, .s-card, .su-card-container, [data-testid="item-card"]',
      links:['a.s-item__link', 'a.s-card__link', 'a[href*="/itm/"]'],
      title:['h1.x-item-title__mainTitle', 'h1[itemprop="name"]', 'h1', '.s-item__title', '.s-card__title', '.su-card-container__title'],
      price:['.x-price-primary [itemprop="price"]', '.x-price-primary', '.s-item__price', '.s-card__price', '[itemprop="price"]'],
      rating:['.x-star-rating [aria-label]', '.s-item__reviews [aria-label]', '[itemprop="ratingValue"]'],
      reviews:['.s-item__reviews-count', '.x-review-section__reviews-count', '[itemprop="reviewCount"]'],
      sales:['.s-item__hotness', '.x-quantity__availability'],
      shop:['.x-sellercard-atf__info__about-seller', '.s-item__seller-info-text', '[itemprop="seller"]'],
      query:[],param:['_nkw'],sort:['select[name="_sop"] option:checked'],filters:'input[type="checkbox"]:checked',page:['[aria-current="page"]'],
      fallbackCards:true
    },
    amazon: {cards:'[data-component-type="s-search-results"] [data-component-type="s-search-result"][data-asin], .s-main-slot > [data-component-type="s-search-result"][data-asin]',links:['h2 a','a.a-link-normal.s-no-outline','a[href*="/dp/"]'],title:['#productTitle','h2 span','h2'],price:['#corePrice_feature_div .a-price .a-offscreen','#corePriceDisplay_desktop_feature_div .a-price .a-offscreen','.a-price .a-offscreen'],rating:['#acrPopover .a-icon-alt','.a-icon-alt'],reviews:['#acrCustomerReviewText','a[href*="customerReviews"][aria-label]','a[href*="customerReviews"] span'],sales:['#social-proofing-faceout-title-tk_bought .a-text-bold','[data-cy="reviews-block"] .a-color-secondary','.a-row.a-size-base .a-color-secondary'],shop:['#sellerProfileTriggerId','#merchant-info','#bylineInfo'],query:['[data-component-type="s-result-info-bar"] .a-color-state'],param:['k'],sort:['#s-result-sort-select option:checked','.a-dropdown-prompt'],filters:'.s-refinements .a-checkbox input:checked',page:['.s-pagination-selected']},
    mercado: {cards:'.ui-search-results > .ui-search-layout__item, .ui-search-layout > .ui-search-layout__item',links:['a.poly-component__title','a.ui-search-link','a.ui-search-item__group__element'],title:['h1.ui-pdp-title','.poly-component__title','.ui-search-item__title'],price:['.ui-pdp-price__second-line .andes-money-amount','.poly-price__current .andes-money-amount','.ui-search-price__second-line .andes-money-amount'],rating:['.ui-pdp-review__rating','.poly-component__review-compacted','.poly-reviews__rating','.poly-reviews__rating-number'],reviews:['.ui-pdp-review__amount','.poly-reviews__total'],sales:['.ui-pdp-subtitle','.poly-component__sales','.poly-reviews__total-sold'],shop:['.ui-pdp-seller__link-trigger','.poly-component__seller'],query:['h1.ui-search-breadcrumb__title'],param:['q'],sort:['.ui-search-sort-filter .andes-dropdown__display-values'],filters:'.ui-search-filters-breadcrumb__item, button[aria-label^="Quitar el filtro"], button[aria-label^="Remover filtro"]',page:['.andes-pagination__button--current']},
    shopee: {cards:'.shopee-search-item-result__items > .shopee-search-item-result__item, .shopee-search-item-result > .shopee-search-item-result__item, li.shopee-search-item-result__item',links:['a[data-sqe="link"]','a[href*="-i."]','a[href*="/product/"]'],title:['[data-sqe="name"]','h1','.line-clamp-2','[class*="line-clamp-2"]'],price:['[data-sqe="price"]','[class*="product-price"]','[class*="flex"] [class*="text-base/5"]'],rating:['[data-sqe="rating"]','[aria-label*="rating"]'],reviews:['[data-sqe="reviews"]'],sales:['[data-sqe="sold"]','[class*="truncate text-shopee-black87"]'],shop:['[data-sqe="shop"]'],query:['.shopee-search-result-header__text-highlight'],param:['keyword'],sort:['.shopee-sort-bar__option--selected','.select-with-status__holder'],filters:'.shopee-filter [aria-checked="true"]',page:['.shopee-mini-page-controller__current']},
    lazada: {cards:'[data-qa-locator="product-item"], .p-product-card',links:['.RfADt a','[data-qa-locator="product-item"] a','a[href*="-i"]'],title:['h1.pdp-mod-product-badge-title','.RfADt a[title]','.p-title a'],price:['.pdp-price_type_normal','.ooOxS','.p-price'],rating:['.score-average','.rating'],reviews:['.pdp-review-summary__link','.qzqFw'],sales:['.sold','[class*="sold"]'],shop:['.seller-name__detail','.seller-name'],query:['.lzd-search-results-title strong'],param:['q'],sort:['.ant-select-selection-item','.ant-select-selection-selected-value'],filters:'.filter-panel [aria-checked="true"]',page:['.ant-pagination-item-active']},
    fastmoss: {cards:'.ant-table-tbody > tr:not(.ant-table-measure-row):not(.ant-table-expanded-row):not(.ant-table-placeholder), [class*="product-card"]',links:['a[href*="/e-commerce/detail/"]'],title:['h1','h3.content.truncate','[class*="productName"]'],price:['[class*="price"]'],rating:[],reviews:[],sales:['[data-field="total_sales"]','[data-field="sales"]'],shop:['[class*="shopName"]'],query:[],param:['words'],sort:['th.ant-table-column-has-sorters[aria-sort]'],filters:'.ant-select-selection-item',page:['.ant-pagination-item-active']},
    echotik: {cards:'.ant-table-tbody > tr:not(.ant-table-measure-row):not(.ant-table-expanded-row):not(.ant-table-placeholder), [class*="productCard"], tbody > tr:has(a[href*="/products/"]), tbody > tr:has(a[href*="/product/"])',links:['a[href*="/products/"]','a[href*="/product/"]'],title:['h1','span[class*="productName"]','h3'],price:['[class*="price"]'],rating:[],reviews:[],sales:['[data-field="total_sale_nd_cnt"]'],shop:['[class*="shopName"]'],query:[],param:['keyword'],sort:['th[aria-sort]'],filters:'.ant-select-selection-item',page:['.ant-pagination-item-active']},
    aliexpress: {cards:'[class*="search-item-card-wrapper"], a[class*="search-card-item"], [data-item-id]',links:['a[href*="/item/"]'],title:['h1','h3','[class*="multi--title"]','[class*="title--text"]'],price:['[class*="price--current"]','[class*="price-current"]','[class*="multi--price-sale"]','[class*="price-sale"]','[itemprop="price"]'],rating:['[class*="rating"]'],reviews:['[class*="reviewer"]'],sales:['[class*="trade"]'],shop:['[class*="store-name"]'],query:[],param:['SearchText'],pathQuery:/^\/w\/wholesale-(.+)\.html/,input:['#search-words','#search-key'],fallbackCards:true,sort:['[class*="sort"] [class*="active"]'],filters:'[class*="filter"] [aria-checked="true"]',page:['.comet-pagination-item-active']},
    tokopedia: {cards:'[data-testid="master-product-card"], [data-testid="divProductWrapper"], div[class*="y-oybT3IAd310DVdH3OwVg=="]',links:['a[data-testid="lnkProductContainer"]','a[href]'],title:['[data-testid="lblPDPDetailProductName"]','[data-testid="spnSRPProdName"]','h1'],price:['[data-testid="lblPDPDetailProductPrice"]','[data-testid="spnSRPProdPrice"]'],rating:['[data-testid="lblPDPDetailProductRatingNumber"]','[data-testid="spnSRPProdRating"]'],reviews:['[data-testid="lblPDPDetailProductRatingCounter"]'],sales:['[data-testid="lblPDPDetailProductSoldCounter"]','[data-testid="spnSRPProdSold"]'],shop:['[data-testid="llbPDPFooterShopName"]','[data-testid="spnSRPProdShopName"]'],query:[],param:['q'],fallbackCards:true,sort:['[data-testid="srpSort"]'],filters:'[data-testid="divSRPFilter"] input:checked',page:['[aria-current="page"]']},
    temu: {cards:'[data-testid="goods-card"], [data-tooltip^="goodContainer-"], [data-goods-id]',links:['a[href*="-g-"]','a[href*="goods_id="]'],title:['h1','h2','[data-tooltip-title]'],price:['[data-testid="price"]','[data-type="price"]','[class*="goods-price"]'],rating:['[role="img"][aria-label*="stars"]','[aria-label*="rating"]'],reviews:[],sales:['[data-testid="sold"]','[data-type="saleTips"]'],shop:[],query:[],param:['search_key'],fallbackCards:true,sort:['[aria-controls="sort-select-down-list"]'],filters:'[aria-checked="true"]',page:['[aria-current="page"]']},
    '1688': {cards:'a.search-offer-wrapper, a[data-tracker="offer"], .organic-offer-card',links:['a[href*="/offer/"]','a[href*="offerId="]'],title:['h1','[class*="title"]'],price:['[class*="price"]'],rating:[],reviews:[],sales:['[class*="sale"]','[class*="sold"]'],shop:['[class*="company-name"]'],query:[],param:['keywords','q'],sort:[],filters:'[aria-checked="true"]',page:['[aria-current="page"]']},
    tiktok: {cards:'[data-e2e="product-card"], [data-testid="product-card"]',links:['a[href*="/pdp/"]','a[href*="/view/product/"]'],title:['h1','[data-e2e="product-title"]'],price:['[data-e2e="product-price"]','[data-testid="product-price"]'],rating:['[data-e2e="product-rating"]'],reviews:[],sales:['[data-e2e="product-sold"]'],shop:['[data-e2e="shop-name"]'],query:[],param:['q','keyword'],sort:[],filters:'[aria-checked="true"]',page:['[aria-current="page"]']}
  };
  Object.assign(CONFIG,{
    olx:{cards:'[data-ds-component="DS-NewAdCard"], [data-testid="ad-card"], [data-testid="adcard-container"]',links:['a[href]'],title:['h1','h2','[data-testid="ad-title"]','[data-ds-component="DS-AdCardTitle"]'],price:['[data-testid="ad-price"]','[data-ds-component="DS-AdCardPrice"]','[itemprop="price"]'],rating:[],reviews:[],sales:[],shop:['[data-testid="seller-name"]','[data-testid="user-name"]'],query:[],param:['q'],sort:['select[name="sort"] option:checked'],filters:'[aria-checked="true"], input[type="checkbox"]:checked',page:['[aria-current="page"]'],fallbackCards:true},
    blibli:{cards:'.product__list .product__item, .product__item, [data-testid="product-card"], .blu-product',links:['a[href*="/p/"]'],title:['h1','.product__item__name','.blu-product__name','[data-testid="product-name"]','a[title]'],price:['.product__item__price','.blu-product__price','[data-testid="product-price"]','[itemprop="price"]'],rating:['[data-testid="product-rating"]','.product__item__rating'],reviews:['[data-testid="review-count"]'],sales:['[data-testid="product-sold"]','.product__item__sold'],shop:['[data-testid="merchant-name"]','.product__item__store'],query:[],param:['searchTerm','q'],pathQuery:/^\/cari\/([^/]+)/,sort:['select[name="sort"] option:checked'],filters:'[aria-checked="true"], input[type="checkbox"]:checked',page:['[aria-current="page"]'],fallbackCards:true},
    mudah:{cards:'[data-testid="listing-ad-item"], [data-testid="listing-card"], [data-testid^="listing-ad-item-"]',links:['a[href*=".htm"]'],title:['h1','h2','[data-testid="listing-title"]','a[title]'],price:['[data-testid="ad-price"]','[data-testid="listing-price"]','[itemprop="price"]','.text-sm.font-bold'],rating:[],reviews:[],sales:[],shop:['[data-testid="seller-name"]','[itemprop="seller"]'],query:[],param:['q'],sort:['select[name="sort"] option:checked'],filters:'[aria-checked="true"], input[type="checkbox"]:checked',page:['[aria-current="page"]'],fallbackCards:true},
    carousell:{cards:'[data-testid="listing-card"], [data-testid="listing-card-root"], [data-testid="listingCard"]',links:['a[href*="/p/"]'],title:['h1','[data-testid="listing-title"]','[data-testid="listing-card-title"]','p[title]'],price:['[data-testid="listing-price"]','[data-testid="listing-card-price"]','[itemprop="price"]'],rating:['[data-testid="seller-rating"]'],reviews:[],sales:[],shop:['[data-testid="seller-name"]'],query:[],param:['search','query','q'],pathQuery:/^\/search\/([^/]+)|^\/([^/]+)\/q\/?$/,sort:['select[name="sort"] option:checked'],filters:'[aria-checked="true"], input[type="checkbox"]:checked',page:['[aria-current="page"]'],fallbackCards:true}
  });
  const GENERIC = {cards:'[data-testid="product-card"], .product-card, .listing-card',links:['a[href]'],title:['h1','h2','h3'],price:['[itemprop="price"]','[class*="price"]'],rating:['[itemprop="ratingValue"]'],reviews:['[itemprop="reviewCount"]'],sales:['[class*="sold"]'],shop:['[itemprop="seller"]'],query:[],param:['q','query','keyword'],sort:[],filters:'[aria-checked="true"]',page:['[aria-current="page"]']};
  function unquote(value) { return clean(value).replace(/^["“”‘’']+|["“”‘’']+$/g,'').trim(); }
  function readSearch(doc, value, country='') {
    const u=new URL(value),site=siteFor(value);if(!site)return null;
    const c=CONFIG[site.family]||GENERIC;
    let query=unquote(first(doc,c.query)),querySource=query?'结果页标题':'';
    // A suggestion alone is never a corrected query. Only an explicit adopted-results banner qualifies.
    for(const banner of list(doc,'.s-suggestion-container, #s-suggestion, [data-component-type="s-search-suggestion"]')){
      const text=clean(banner.textContent);
      if(/^(Showing results for|Mostrando resultados para|Exibindo resultados para|Menampilkan hasil untuk|正在显示.*结果)/i.test(text)){
        const link=banner.querySelector('a');const word=unquote(link?.textContent||'');
        if(word){query=word;querySource='页面明确采用的纠正词';break;}
      }
    }
    if(!query)for(const key of c.param||[]){const word=u.searchParams.get(key);if(word){query=word;querySource='搜索页URL参数';break;}}
    if(!query&&c.pathQuery){const match=u.pathname.match(c.pathQuery);if(match){try{query=decodeURIComponent(match[1]||match[2]);if(site.family==='aliexpress')query=query.replace(/-/g,' ');querySource='搜索页路径';}catch{}}}
    if(site.family==='aliexpress'&&query)for(const selector of c.input||[]){
      const input=clean(doc.querySelector(selector)?.value);if(input&&input.toLocaleLowerCase().replace(/[-\s]+/g,' ')===query.toLocaleLowerCase().replace(/[-\s]+/g,' ')){query=input;querySource='当前结果词与搜索框核对';break;}
    }
    if(!query && site.family==='mercado' && /^(lista|listado)\./.test(u.hostname)){
      let path=u.pathname.split('/').filter(Boolean)[0]||'';path=path.replace(/_Desde_\d+.*/i,'').replace(/_OrderId_.*/i,'');
      try{query=decodeURIComponent(path).replace(/-/g,' ');querySource=query?'搜索页路径':'';}catch{}
    }
    let page=Number(first(doc,c.page).match(/\d+/)?.[0])||null;
    if(!page){
      const p=u.searchParams.get('page')||(site.family==='ebay'?u.searchParams.get('_pgn'):null);
      if(p!==null&&/^\d+$/.test(p))page=Number(p)+(site.family==='shopee'?1:0)||null;
      // An offset alone does not reveal the page size. Keep the page unknown.
      else if(query&&!/_Desde_\d+/i.test(u.pathname)&&!['offset','start','from'].some(k=>u.searchParams.has(k)))page=1;
    }
    const selectedFilters=list(doc,c.filters||'__ianto_none').map(el=>clean(el.closest('label')?.textContent||el.getAttribute('aria-label')||el.textContent)).filter(Boolean);
    if(site.family==='fastmoss')for(const button of list(doc,'button')){const spans=list(button,':scope > span'),labels=spans.map(el=>clean(el.textContent)).filter(Boolean),label=labels[0]||'',choice=labels.at(-1)||'';if(spans.length>1&&/^(日期|商品分类|商品状态|商品类型|最低售价|佣金比例|卖家类型|带货方式|总销量|总GMV|销量|GMV|Date|Category|Status)$/i.test(label)&&choice&&!/^(不限|全部|All|Any)$/i.test(choice))selectedFilters.push(label+'：'+choice);}
    const filters=[...new Set(selectedFilters)].slice(0,30).join('；');
    let sort=first(doc,c.sort)||['sort','order','sortBy','orderBy','s','order_id'].map(k=>u.searchParams.has(k)?k+'='+u.searchParams.get(k):'').filter(Boolean).join('；');
    const direction=doc.querySelector('th[aria-sort="descending"], th[aria-sort="ascending"]')?.getAttribute('aria-sort');if(sort&&direction)sort+=' · '+(direction==='descending'?'降序':'升序');
    return {query,querySource,searchUrl:u.href,country:pageCountry(doc,value,country),page,sort,filters,observedAt:new Date().toISOString()};
  }
  function money(value) {
    const text=clean(value),match=text.match(/\d[\d\s.,]*/);if(!match)return null;
    let n=match[0].trim().replace(/\s/g,'');
    const lastDot=n.lastIndexOf('.'),lastComma=n.lastIndexOf(',');
    if(lastDot>=0&&lastComma>=0){const decimal=lastDot>lastComma?'.':',';n=n.split(decimal==='.'?',':'.').join('').replace(decimal,'.');}
    else if(lastComma>=0){n=/,\d{1,2}$/.test(n)?n.replaceAll('.','').replace(',','.'):n.replaceAll(',','');}
    else if(lastDot>=0&&/\.\d{3}$/.test(n))n=n.replaceAll('.','');
    const number=Number(n);return Number.isFinite(number)&&number>=0?number:null;
  }
  function structuredProduct(doc,identity) {
    const products=[];
    function visit(value){if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}const types=[].concat(value['@type']||[]);if(types.some(t=>String(t).toLowerCase()==='product'))products.push(value);if(value['@graph'])visit(value['@graph']);}
    for(const script of list(doc,'script[type="application/ld+json"]')){try{visit(JSON.parse(script.textContent));}catch{}}
    const match=products.find(p=>productIdentity(p.url||p['@id'],identity.url)?.key===identity.key);
    return match||(products.length===1?products[0]:null);
  }
  function currency(priceText,country,explicit='') {
    if(explicit)return explicit;
    if(/AU\$|AUD/i.test(priceText))return 'AUD';if(/NZ\$|NZD/i.test(priceText))return 'NZD';if(/CA\$|C\$|CAD/i.test(priceText))return 'CAD';if(/€|EUR/.test(priceText))return 'EUR';if(/£|GBP/.test(priceText))return 'GBP';
    if(/R\$/.test(priceText))return 'BRL';if(/US\$|USD/.test(priceText))return 'USD';if(/MX\$|MXN/.test(priceText))return 'MXN';if(/Rp|IDR/.test(priceText))return 'IDR';
    if(/S\$|SGD/.test(priceText))return 'SGD';if(/\bRM\b|MYR/.test(priceText))return 'MYR';if(/₱|PHP/.test(priceText))return 'PHP';if(/฿|THB/.test(priceText))return 'THB';if(/₫|VND|\bđ\b/.test(priceText))return 'VND';
    return ({BR:'BRL',MX:'MXN',ID:'IDR',PH:'PHP',MY:'MYR',TH:'THB',VN:'VND',SG:'SGD',CN:'CNY',US:'USD',AU:'AUD',NZ:'NZD',CA:'CAD',GB:'GBP',DE:'EUR',FR:'EUR',ES:'EUR'})[country]||'';
  }
  function imageOf(root,detail,ld){
    let value=detail?(Array.isArray(ld?.image)?ld.image[0]:typeof ld?.image==='object'?ld.image.url:ld?.image):'';
    if(value)return value;
    const selectors=detail?['[data-testid="hero-image"]', '[data-testid="product-image"] img', '#mainImgHldr img', '#landingImage','.ui-pdp-gallery__figure img','#icImg','img[itemprop="image"]','[data-testid="product-image"] img','[data-testid="listing-image"] img','meta[property="og:image"]']:['img[data-js-main-img]','img[data-testid="imgSRPProdMain"]','img.poly-component__picture','img'];
    for(const selector of selectors)for(const image of list(root,selector)){
      if(/\/(?:regions|flags)\//i.test(image.getAttribute('src')||''))continue;
      for(const name of ['data-old-hires','data-original','data-src','src','content']){const url=image.getAttribute(name);if(url&&!/^(?:data:|blob:)|(?:placeholder|no[-_]image|transparent)\.(?:png|gif|svg|webp)/i.test(url))return url;}
      const srcset=image.getAttribute('data-srcset')||image.getAttribute('srcset');if(srcset)return srcset.split(',').at(-1).trim().split(/\s+/)[0];
    }
    return '';
  }
  function matchedText(root,selectors,pattern){
    for(const el of list(root,selectors)){const text=clean(el.getAttribute('aria-label')||el.textContent),match=text.match(pattern);if(match)return clean(match[0]);}
    return '';
  }
  const SOLD=/(?:[\d.,]+\s*(?:[kKmM]|mil|万|rb|ribu|jt)?\+?\s*(?:comprados?(?:\s+(?:el mes pasado|no mês passado))?|bought(?:\s+in past month)?|purchased(?:\s+in past month)?|vendido\(s\)|vendidos?|sold|terjual)|(?:terjual)\s*[\d.,]+\s*(?:[kKmM]|rb|ribu|jt)?\+?)/i;
  function productMetrics(root,data,detail){
    const family=data.source;
    if(family==='Amazon'){
      data.salesText=matchedText(root,'#social-proofing-faceout-title-tk_bought, .a-row.a-size-base .a-color-secondary, [data-cy="reviews-block"]',SOLD);
      if(!data.reviewsText)data.reviewsText=matchedText(root,'a[href*="customerReviews"][aria-label]',/\d[\d.,\s]*\s*(?:clasificaciones|avaliações|ratings|reviews)/i);
    }
    if(family==='Walmart'||family==='eBay'){
      const sold=matchedText(root,'[data-testid="sold-count"], .s-item__hotness, [data-automation-id="sales-volume"]',SOLD);
      if(sold)data.salesText=sold;
      if(!data.ratingText)data.ratingText=matchedText(root,'[data-testid="rating-stars"] [aria-label], [data-automation-id="product-rating"], .x-star-rating [aria-label]',/[0-5](?:[.,]\d+)?\s*(?:out of (?:five|5) stars|\/\s*5)/i);
      if(!data.reviewsText)data.reviewsText=matchedText(root,'[data-testid="reviews-and-ratings"], .s-item__reviews-count',/\d[\d,.]*\s*(?:ratings|reviews)/i);
    }
    if(['Mercado Libre','Mercado Livre'].includes(family)){
      if(!detail)data.salesText=matchedText(root,'.poly-component__sales, .poly-reviews__total-sold, [class*="sold"]',SOLD);
    }
    if(['Temu','Tokopedia','AliExpress','Shopee','Lazada'].includes(family)){
      if(!data.priceText)data.priceText=matchedText(root,'[data-type="price"], [class*="price"], [class*="Price"], span',/(?:AU\$|NZ\$|MX\$|US\$|R\$|S\$|Rp|RM|₱|฿|₫|\$|€|£)\s*\d[\d.,]*(?:\s*[-–]\s*(?:(?:Rp|R\$|AU\$)\s*)?\d[\d.,]*)?/i);
      if(family==='Temu'&&data.priceText)data.priceText=data.priceText.match(/(?:AU\$|NZ\$|MX\$|US\$|R\$|S\$|Rp|RM|₱|฿|₫|\$|€|£)\s*\d[\d.,]*/)?.[0]||data.priceText;
      const sold=matchedText(root,'[data-type="saleTips"], [class*="trade"], [class*="sold"], [class*="Sold"], [data-testid*="Sold"], span',SOLD);
      data.salesText=sold;
      if(!data.reviewsText)data.reviewsText=matchedText(root,'[aria-label], span',/\d[\d.,]*\s*(?:reviews|avaliações|reseñas|ulasan|penilaian)/i);
      if(!data.ratingText)data.ratingText=matchedText(root,'[aria-label], [class*="rating"], [class*="Rating"]',/[0-5](?:[.,]\d+)?\s*(?:out of (?:five|5) stars|de 5 estrelas|de 5 estrellas|\/\s*5)/i);
      if(!data.ratingText&&family==='Shopee'){
        const stars=list(root,'.shopee-rating-stars__lit');
        if(stars.length===5){const values=stars.map(el=>{const value=el.style.width?.match(/^([\d.]+)%$/)?.[1];return value===undefined?NaN:Number(value);});if(values.every(Number.isFinite))data.ratingText=(values.reduce((a,b)=>a+b,0)/100).toFixed(1)+' / 5（星级图示）';}
      }
      if(!data.ratingText&&family==='Lazada'){
        const stars=list(root,'.mdmmT > i');
        if(stars.length===5){const full=stars.filter(el=>el.classList.contains('Dy1nx')).length,empty=stars.filter(el=>el.classList.contains('W1iJ5')).length;data.ratingText=`星级图示：${full} 整星、${5-full-empty} 部分星、${empty} 空星（未展示精确评分）`;}
      }
    }
  }
  function fieldsFor(root,identity,{detail=false,doc=root,country=''}={}) {
    const c=CONFIG[identity.family]||GENERIC,ld=detail?structuredProduct(doc,identity):null;
    const offer=Array.isArray(ld?.offers)?ld.offers[0]:ld?.offers;
    const data={...identity,country:(['fastmoss','echotik'].includes(identity.family)?shownCountry(detail?root.querySelector('main')||root:root):'')||country||identity.country};
    data.title=first(root,c.title)||(detail?clean(ld?.name)||first(root,['meta[property="og:title"]']):'');
    if(identity.family==='tokopedia'&&!data.title)data.title=first(root,['div[class*="y-oybT3IAd310DVdH3OwVg=="] > div:first-child span','[data-testid*="ProdName"]']);
    data.priceText=first(root,c.price);
    if(identity.family==='mercado'){
      for(const selector of c.price){const node=root.querySelector(selector),fraction=node?.querySelector('.andes-money-amount__fraction');if(fraction){const cents=clean(node.querySelector('.andes-money-amount__cents')?.textContent),symbol=clean(node.querySelector('.andes-money-amount__currency-symbol')?.textContent);data.priceText=symbol+' '+clean(fraction.textContent)+(cents?(data.country==='BR'?',':'.')+cents:'');break;}}
    }
    if(!data.priceText&&['fastmoss','echotik'].includes(identity.family)){
      const product=root.querySelector('a[href*="/e-commerce/detail/"], a[href*="/products/"], a[href*="/product/"]')||root;
      const label=list(product,'span, p, div').filter(el=>el.childElementCount<3).map(el=>clean(el.textContent)).find(text=>/^(?:售价|价格|Price|Precio|Preço)\s*[:：]/i.test(text));
      if(label)data.priceText=label.replace(/^[^:：]+[:：]\s*/,'');
    }
    if(!data.priceText&&c.fallbackCards){
      const candidates=list(root,'[class*="price"], [class*="Price"], p, span').map(el=>clean(el.textContent));
      data.priceText=candidates.find(text=>/^(?:R\$|S\$|RM|Rp|MX\$|US\$|₱|฿|[$€])\s*[\d.,]+(?:\s*[-–]\s*[\d.,]+)?$/i.test(text))||'';
    }
    if(!data.priceText && detail && offer?.price!==undefined)data.priceText=String(offer.price);
    data.price=money(data.priceText);data.currency=currency(data.priceText,data.country,offer?.priceCurrency||'');
    data.image=imageOf(root,detail,ld)||'';
    if(data.image){try{data.image=new URL(data.image,identity.url).href;if(!/^https?:/.test(data.image))data.image='';}catch{data.image='';}}
    data.shop=first(root,c.shop)||(detail?clean(offer?.seller?.name||''):'');
    data.brand=detail?(typeof ld?.brand==='object'?clean(ld.brand.name):clean(ld?.brand))||first(root,['[itemprop="brand"]', '[data-testid="brand-link"]', '[data-automation-id="brand-name"]']):'';
    data.ratingText=first(root,c.rating)||(detail?clean(ld?.aggregateRating?.ratingValue):'');
    data.reviewsText=first(root,c.reviews)||(detail?clean(ld?.aggregateRating?.reviewCount||ld?.aggregateRating?.ratingCount):'');
    data.salesText=first(root,c.sales);
    if(!detail&&['fastmoss','echotik'].includes(identity.family)){
      const table=root.closest('table'),headers=table?list(table,'thead th').map(el=>clean(el.textContent)):[],cells=list(root,':scope > td');
      const column=pattern=>{const i=headers.findIndex(label=>pattern.test(label));return i>=0?clean(cells[i]?.textContent):'';};
      if(!data.priceText){data.priceText=column(/价格|售价|\bprice\b|preço|precio/i);data.price=money(data.priceText);data.currency=currency(data.priceText,data.country);}
      data.salesText ||= column(/总销量|累计销量|商品销量|total sales|sales volume|units sold|vendas/i);
      data.shop ||= first(root,['a[href*="/shop-marketing/detail/"] [text]','a[href*="/shop/"] [class*="name"]'])||column(/店铺|\bshop\b|\bstore\b|loja|tienda/i);
      const product=root.querySelector('a[href*="/e-commerce/detail/"], a[href*="/products/"], a[href*="/product/"]');
      data.ratingText ||= product?list(product,'.ant-tag').map(el=>clean(el.textContent)).find(text=>/^[0-5](?:\.\d+)?$/.test(text))||'':'';
    }
    productMetrics(root,data,detail);
    data.price=money(data.priceText);data.currency=currency(data.priceText,data.country,offer?.priceCurrency||'');
    data.variant=detail?list(root,'#twister .selection, .ui-pdp-variations__selected-label, .sku-property-item-selected, [data-sku-selected="true"]').map(e=>clean(e.textContent||e.getAttribute('aria-label'))).filter(Boolean).join('；'):'';
    data.availability=detail?first(root,['#availability','.ui-pdp-stock-information','[itemprop="availability"]'])||clean(offer?.availability):'';
    data.shipping=detail?first(root,['#deliveryBlockMessage','.ui-pdp-shipping','.delivery-options','[data-testid="fulfillment-container"]','[data-testid="shipping-section"]','.ux-labels-values--shipping']):'';
    data.attributes=detail?first(root,['#productOverview_feature_div','#productDetails_techSpec_section_1','.ui-pdp-specs__table','.pdp-product-desc']):'';
    const marker=first(root,['.puis-sponsored-label-text','.s-sponsored-label-text','.poly-component__ads-promotions','.shopee-item-card__ad-badge','[data-testid="ad-label"]']);
    const adLink=list(root,'a[href]').some(a=>/[?&](?:search_p4p_id|aem_p4p_detail)=/.test(a.getAttribute('href')||''));
    const adText=list(root,'span, div, [aria-label]').some(el=>/^(?:AD|Sponsored|Patrocinado|Patrocinada|Publicidade|Iklan)$/i.test(clean(el.getAttribute('aria-label')||el.textContent)));
    data.ad=detail?'未知':marker||adLink||adText||root.querySelector('.s-sponsored-label-info-icon, [data-sponsored="true"]')?'是':'未见广告标记';
    data.completeness=(detail?'详情页展示字段':'仅列表已展示字段；位置按已加载主结果商品卡顺序，包含广告')+(!data.priceText?'；未识别价格':'');
    if(identity.family==='ebay' && /(?:\bto\b|\s[-–]\s|\s+至\s+)/i.test(data.priceText)){
      data.price=null;data.completeness+='；价格区间仅保存原文，不纳入单价统计';
    }
    if(identity.family==='ebay' && first(root,['[data-testid="bid-count"]','.x-bid-price__label'])){
      data.price=null;data.completeness+='；拍卖出价不是成交价';
    }
    delete data.key;delete data.family;return data;
  }
  function cardElements(doc,value){
    const site=siteFor(value);if(!site)return[];const c=CONFIG[site.family]||GENERIC;
    const cards=list(doc,c.cards).filter(el=>!el.parentElement?.closest(c.cards)&&!el.closest('header, nav, footer, aside')&&!el.matches('.ant-table-measure-row, .ant-table-expanded-row, .ant-table-placeholder, [hidden]'));
    if(cards.length||!c.fallbackCards)return cards;
    const scope=doc.querySelector('main, [role="main"]')||doc.body,result=new Set(),summaries=new WeakMap();
    function summary(parent){
      if(summaries.has(parent))return summaries.get(parent);
      const identities=new Set();
      for(const a of list(parent,c.links.join(','))){const product=productIdentity(a.getAttribute('href'),value);if(product?.family===site.family)identities.add(product.key);if(identities.size>1)break;}
      const multiple=identities.size>1;
      summaries.set(parent,multiple);return multiple;
    }
    for(const link of list(scope,c.links.join(','))){
      const identity=productIdentity(link.getAttribute('href'),value);if(!identity||identity.family!==site.family||link.closest('header, nav, footer, aside'))continue;
      let card=link;
      for(let parent=link.parentElement,depth=0;parent&&parent!==scope&&depth<6;parent=parent.parentElement,depth++){
        if(summary(parent))break;
        card=parent;
        if(parent.matches('article, li, [role="listitem"], [role="group"], [data-tooltip^="goodContainer-"]'))break;
      }
      result.add(card);
    }
    return [...result].filter(el=>{for(let parent=el.parentElement;parent&&parent!==scope;parent=parent.parentElement)if(result.has(parent))return false;return true;});
  }
  function scanCards(doc,value,{viewportOnly=false,scrollRoot=null,country=''}={}){
    const site=siteFor(value);if(!site)return {items:[],candidateCount:0,unresolvedCount:0};const c=CONFIG[site.family]||GENERIC;
    const cards=cardElements(doc,value),view=doc.defaultView,currentCountry=pageCountry(doc,value,country);
    const bounds=viewportOnly&&scrollRoot&&scrollRoot!==doc.scrollingElement?scrollRoot.getBoundingClientRect():null;
    const result=[];let unresolvedCount=0;
    cards.forEach((card,index)=>{
      if(viewportOnly){const r=card.getBoundingClientRect();if(r.height<=0||r.bottom<Math.max(0,bounds?.top||0)||r.top>Math.min(view.innerHeight,bounds?.bottom??view.innerHeight))return;}
      let identity=null,link=null;
      const anchors=card.matches('a[href]')?[card]:[];
      for(const selector of c.links)anchors.push(...list(card,selector));
      for(const a of anchors){const p=productIdentity(a.getAttribute('href'),value);if(p&&p.family===site.family){identity=p;link=a;break;}}
      if(!identity&&['aliexpress','temu'].includes(site.family)){
        for(const node of [card,...list(card,'[data-item-id], [data-product-id], [data-goods-id]')]){
          const id=node.getAttribute('data-item-id')||node.getAttribute('data-product-id')||node.getAttribute('data-goods-id')||'';
          if(!/^\d{5,}$/.test(id))continue;
          const url=new URL(site.family==='aliexpress'?'/item/'+id+'.html':'/goods.html?goods_id='+id,value).href;
          identity=productIdentity(url);link={href:url,getAttribute:()=>'',textContent:''};break;
        }
      }
      if(!identity){unresolvedCount++;return;}
      const fields=fieldsFor(card,identity,{country:currentCountry});
      fields.url=link.href||identity.url;
      if(!fields.title)fields.title=clean(link.getAttribute('title')||link.getAttribute('aria-label')||card.getAttribute('data-tooltip-title')||card.querySelector('img[alt]:not([alt="img"])')?.alt||link.textContent);
      if(!fields.title){unresolvedCount++;return;}
      result.push({card,link,key:identity.key,position:index+1,fields});
    });
    return {items:result,candidateCount:cards.length,unresolvedCount};
  }
  function readCards(doc,value,options){return scanCards(doc,value,options).items;}
  function pageKind(doc,value){
    if(!siteFor(value))return 'unsupported';
    if(productIdentity(value))return 'detail';
    if(readCards(doc,value).length||readSearch(doc,value)?.query)return 'search';
    return 'unsupported';
  }
  function pageProblem(doc,value){
    const u=new URL(value),title=clean(doc.title||first(doc,['title']));
    if(siteFor(value)?.family==='mercado'&&/^\/gz\/account-verification(?:\/|$)/i.test(u.pathname))return '当前是平台登录验证页，请登录后回到搜索结果采集';
    if(/\/verify\/(?:traffic|captcha)|\/captcha(?:\/|$)/i.test(u.pathname))return '当前是平台验证页，请先在浏览器完成验证，再打开搜索结果采集';
    if(/blibli\.com$/.test(u.hostname)&&/verifikasi sedang berjalan|verify if you.re human/i.test(clean(doc.body?.textContent).slice(0,1500)))return '当前是平台验证页，尚未展示商品结果，请完成验证后重新采集';
    if(/Attention Required|Just a moment/i.test(title)&&/blocked|Cloudflare/i.test(clean(doc.body?.textContent).slice(0,4000)))return '平台暂时拦截了当前访问，尚未展示商品结果';
    if(/\/(?:login|signin|sign-in)(?:[/.]|$)/i.test(u.pathname))return '当前是平台登录页，请登录后回到搜索结果采集';
    return '';
  }
  function detailFields(doc,value,country=''){
    const identity=productIdentity(value);if(!identity)return null;const fields=fieldsFor(doc,identity,{detail:true,doc,country:pageCountry(doc,value,country)});fields.url=value;return fields;
  }
  return {clean,siteFor,productIdentity,readSearch,pageCountry,cardElements,scanCards,readCards,pageKind,pageProblem,detailFields,money,CONFIG};
});
