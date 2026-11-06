const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const workerSource=fs.readFileSync(path.join(__dirname,'../features/us_review_scraper.js'),'utf8');
async function run(url,html,limit=10){
  const {document}=parseHTML('<!doctype html><html><head></head><body>'+html+'</body></html>');
  const sandbox={document,location:new URL(url),URL,Promise,setTimeout,console,module:{exports:{}}};
  vm.runInNewContext(workerSource,sandbox);
  const worker=sandbox.module.exports;
  assert.equal(typeof worker,'function');
  return await worker(limit);
}
test('Walmart 商品链接只进入本品评论页，不跳转到推荐商品评论',async()=>{
  const html='<h1 data-testid="product-title">Dog Blanket</h1>'+
    '<a href="/reviews/product/999999999">Recommended item reviews</a>'+
    '<a href="/reviews/product/123456789">See all customer reviews</a>';
  const result=await run('https://www.walmart.com/ip/cozy-dog-blanket/123456789',html);
  assert.equal(result.productName,'Dog Blanket');
  assert.equal(result.reviews.length,0);
  assert.equal(result.navigateTo,'https://www.walmart.com/reviews/product/123456789');
});
test('Walmart 独立评论页读取星级、正文、作者与日期',async()=>{
  const html='<h1>Dog Blanket</h1><section data-testid="review-list">'+
    '<article data-testid="review-card"><span data-testid="review-star-rating" aria-label="5 out of 5 stars"></span>'+
    '<p data-testid="review-text">Very soft and warm for my dog.</p>'+
    '<span data-testid="review-author">Maria</span><time itemprop="datePublished" content="2026-10-12">Oct 12, 2026</time></article></section>';
  const result=await run('https://www.walmart.com/reviews/product/123456789',html);
  assert.equal(result.reviews.length,1);
  assert.equal(result.reviews[0].text,'Very soft and warm for my dog.');
  assert.equal(result.reviews[0].rating,5);
  assert.equal(result.reviews[0].date,'2026-10-12');
  assert.equal(result.reviews[0].author,'Maria');
});
test('eBay 商品评价与卖家 Feedback 严格区分',async()=>{
  const seller='<section id="seller-feedback"><div class="review-item"><p>Fast shipping and good seller</p></div></section>';
  const result=await run('https://www.ebay.com/itm/123456789012',seller);
  assert.equal(result.reviews.length,0);
  assert.equal(Boolean(result.navigateTo),false);
  assert.match(result.debug.reason,/卖家 Feedback/);
});
test('eBay 产品评论页可收录评论并继续分页',async()=>{
  const html='<h1>Dog Blanket</h1><section id="productReviews">'+
    '<div itemprop="review"><p itemprop="reviewBody">Great quality and soft texture.</p>'+
    '<meta itemprop="ratingValue" content="4.5"><span itemprop="author">Alice</span></div></section>'+
    '<a rel="next" href="/urw/product-reviews/321654987?_pgn=2">Next page</a>';
  const result=await run('https://www.ebay.com/urw/product-reviews/321654987?_pgn=1',html);
  assert.equal(result.reviews.length,1);
  assert.equal(result.reviews[0].rating,4.5);
  assert.equal(result.reviews[0].author,'Alice');
  assert.equal(result.navigateTo,'https://www.ebay.com/urw/product-reviews/321654987?_pgn=2');
});
test('未知域名不会被误识别为美国商品评论平台',async()=>{
  const result=await run('https://example.test/itm/123456789012','<h1>Example</h1>');
  assert.equal(result.reviews.length,0);
  assert.match(result.error,/仅支持/);
});
