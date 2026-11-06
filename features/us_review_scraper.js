// US marketplace VOC adapter. The worker is injected as an isolated function in an existing browser tab.
// It only reads visible page content and follows product-review links on the same marketplace.
(function(root){
  'use strict';
  async function scrapeUsProductReviews(maxReviews) {
    const limit=Math.max(1,Math.min(1000,Number(maxReviews)||200));
    const hostname=location.hostname.toLowerCase();
    const walmart=hostname==='walmart.com'||hostname.endsWith('.walmart.com');
    const ebay=hostname==='ebay.com'||hostname.endsWith('.ebay.com');
    if(!walmart&&!ebay)return {productName:'',reviews:[],error:'仅支持 Walmart / eBay 美国站'};
    const platform=walmart?'walmart':'ebay';
    const reviewPath=walmart?/^\/reviews\/product\//i:/^\/urw\/product-reviews\//i;
    const reviewPage=reviewPath.test(location.pathname);
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const tidy=value=>String(value||'').replace(/\s+/g,' ').trim();
    const first=(root,selectors)=>{
      for(const selector of selectors) {
        const node=root.querySelector(selector);
        if(!node)continue;
        const value=tidy(node.getAttribute('content')||node.getAttribute('aria-label')||node.innerText||node.textContent);
        if(value)return value;
      }
      return '';
    };
    const productName=first(document,walmart?
      ['h1[data-testid="product-title"]','[data-automation-id="product-title"]','h1','meta[property="og:title"]']:
      ['h1.x-item-title__mainTitle','h1[itemprop="name"]','h1','meta[property="og:title"]'])
      ||tidy(document.title).replace(/\s*[-|]\s*(Walmart|eBay).*$/i,'');
    function sameMarketplace(href){
      try {
        const u=new URL(href,location.href),h=u.hostname.toLowerCase();
        if(!['http:','https:'].includes(u.protocol))return null;
        if(walmart&&!(h==='walmart.com'||h.endsWith('.walmart.com')))return null;
        if(ebay&&!(h==='ebay.com'||h.endsWith('.ebay.com')))return null;
        return reviewPath.test(u.pathname)?u:null;
      }catch{return null;}
    }
    if(!reviewPage){
      const listingId=walmart?location.pathname.match(/^\/ip\/(?:[^/?#]+\/)?(\d{6,})\/?$/i)?.[1]:'';
      for(const link of document.querySelectorAll('a[href]')){
        const target=sameMarketplace(link.getAttribute('href'));
        if(target&&target.href!==location.href) {
          // Walmart recommendations may have their own review links: never switch to another product.
          if(walmart&&listingId&&target.pathname.match(/\/reviews\/product\/(\d+)/i)?.[1]!==listingId)continue;
          return {productName,reviews:[],navigateTo:target.href,debug:{platform,kind:'product-review-link'}};
        }
      }
    }
    const scopeSelectors=walmart?
      ['[data-testid="review-list"]','[data-testid="reviews-section"]','[data-testid="reviews-and-ratings"]','#item-review-section','#customer-reviews','[itemprop="review"]']:
      ['#productReviews','.x-review-section','[data-testid="product-reviews"]','[itemprop="review"]','section[aria-label*="Product reviews"]'];
    const scope=scopeSelectors.map(selector=>document.querySelector(selector)).find(Boolean)||(reviewPage?document.body:null);
    if(!scope)return {productName,reviews:[],debug:{platform,reason:ebay?'没有发现商品评价区域（卖家 Feedback 不采集）':'没有发现评论区域'}};
    const cardSelectors=walmart?
      ['[data-testid="review-card"]','[data-testid="review-item"]','article[data-testid="customer-review"]','[itemprop="review"]']:
      ['[itemprop="review"]','.review-item','.reviews__review','[data-testid="product-review"]','.product-review'];
    const textSelectors=walmart?
      ['[data-testid="review-text"]','[data-testid="review-body"]','[itemprop="reviewBody"]','p']:
      ['[itemprop="reviewBody"]','.review-item-content','.review-content','[data-testid="review-text"]','p'];
    function rating(card){
      const selectors=['[itemprop="ratingValue"]','[data-testid="review-star-rating"]','[aria-label*="out of 5"]','[aria-label*="out of five"]','.rating'];
      for(const selector of selectors){
        const el=card.querySelector(selector);if(!el)continue;
        const value=tidy(el.getAttribute('content')||el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent);
        const m=value.match(/([0-5](?:[.,]\d+)?)\s*(?:out of|\/)\s*(?:five|5)/i)||value.match(/^([0-5](?:[.,]\d+)?)$/);
        if(m)return Number(m[1].replace(',','.'));
      }
      return null;
    }
    function date(card){
      const value=first(card,['[data-testid="review-date"]','[itemprop="datePublished"]','time[datetime]','.review-item-date','time']);
      const raw=value||tidy(card.textContent).slice(0,400);
      const m=raw.match(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},?\s+\d{4}\b|\b\d{4}[-\/]\d{1,2}[-\/]\d{1,2}\b|\b\d{1,2}[-\/]\d{1,2}[-\/]\d{4}\b/i);
      return m?m[0]:'';
    }
    const reviews=[],seen=new Set();
    function collect(){
      const nodes=new Set();
      for(const selector of cardSelectors)for(const card of scope.querySelectorAll(selector))nodes.add(card);
      if(scope.matches?.(cardSelectors.join(',')))nodes.add(scope);
      let added=0;
      for(const card of nodes){
        if(card.closest('.seller-feedback, #seller-feedback, [data-testid="seller-feedback"], .feedback-card, .feedback-comment'))continue;
        const text=first(card,textSelectors);
        const stars=rating(card);
        if(!text&&stars===null)continue;
        const author=first(card,['[data-testid="review-author"]','[itemprop="author"]','.review-item-author','.reviewer-name','.user-name']);
        const when=date(card),key=[text,stars??'',when,author].join('|').toLowerCase();
        if(seen.has(key))continue;
        seen.add(key);reviews.push({text,rating:stars,date:when,author});added++;
        if(reviews.length>=limit)break;
      }
      return added;
    }
    function nextLink(){
      for(const selector of ['a[rel="next"]','a[aria-label*="Next page"]','a[aria-label*="next page"]','[data-testid="pagination-next"] a[href]','.pagination__next a[href]']){
        for(const a of document.querySelectorAll(selector)){
          if(a.getAttribute('aria-disabled')==='true'||a.hasAttribute('disabled'))continue;
          const target=sameMarketplace(a.getAttribute('href')||'');
          if(target&&target.href!==location.href)return target.href;
        }
      }
      return '';
    }
    function nextButton(){
      for(const selector of ['button[aria-label="Next page"]','button[aria-label="Next Page"]','[data-testid="pagination-next"] button','button[data-testid="pagination-next"]']){
        const btn=document.querySelector(selector);
        if(btn&&!btn.disabled&&btn.getAttribute('aria-disabled')!=='true')return btn;
      }
      return null;
    }
    scope.scrollIntoView?.({block:'center'});
    await sleep(350);
    let stagnant=0;
    for(let page=0;page<Math.max(1,Math.min(5,Math.ceil(limit/5)+1));page++){
      collect();
      if(reviews.length>=limit)break;
      const next=nextLink();
      if(next)return {productName,reviews,navigateTo:next,debug:{platform,kind:'review-pagination'}};
      const button=nextButton();
      if(!button)break;
      const before=reviews.length;
      button.click();await sleep(650);collect();
      if(reviews.length===before){stagnant++;if(stagnant>=2)break;}else stagnant=0;
    }
    return {productName,reviews,debug:{platform,actualReturned:reviews.length,limit,reviewPage,reason:reviews.length?'':'没有识别到可见商品评论'}};
  }
  root.IantoUsReviewScraper=scrapeUsProductReviews;
  if(typeof module==='object'&&module.exports)module.exports=scrapeUsProductReviews;
})(globalThis);
