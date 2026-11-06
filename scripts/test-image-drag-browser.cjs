// Open the printed local URL in a browser. Tests run against native DOM/DataTransfer.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'content_scripts/content_walmart_image_drag.js'), 'utf8');
const parser = fs.readFileSync(path.join(root, 'content_scripts/content_amz_search.js'), 'utf8')
  .replace('    // 初始化', '    window.__iantoTestExtract = getDroppedImageUrls;\n    // 初始化');

const page = String.raw`<!doctype html><html><meta charset="utf-8"><title>Ianto 图片拖放回归</title>
<style>body{font:16px system-ui;margin:24px;background:#f6f8fa;color:#17212f}.cards{display:flex;gap:24px}.card{position:relative;width:220px;height:200px;background:white}.card>a{position:absolute;inset:0;z-index:1}.card img{width:220px;height:180px}h3{font-size:14px;margin-top:180px}.ok{color:#157b39}.bad{color:#b52222}pre{white-space:pre-wrap;background:white;padding:20px;border-radius:8px}</style>
<h1>Ianto 图片拖放回归</h1><p>实际 Walmart 结构：透明商品链接与商品图片是兄弟元素。</p>
<div class="cards">
<div class="card" data-dca-ctx="itemTile" data-item-id="first"><a href="https://www.walmart.com/ip/first/1"><span><h3>商品一覆盖链接</h3></span></a><div data-test-id="gpt-product-tile-grid-container"><div data-test-id="gpt-product-visual-meta-data"><div><img data-testid="productTileImage" src="/image.svg?item=first"></div></div></div></div>
<div class="card" data-dca-ctx="itemTile" data-item-id="second"><a href="https://www.walmart.com/ip/second/2"><span><h3>商品二覆盖链接</h3></span></a><div><img data-testid="productTileImage" src="/image.svg?item=second"></div></div>
<div><img id="detail-image" src="/image.svg?item=detail" width="160" height="180"><br><a id="ordinary-link" href="https://www.walmart.com/help">普通文字链接</a></div>
</div><pre id="results">正在验证…</pre>
<script src="/source.js"></script><script src="/parser.js"></script>
<script>
addEventListener('load', async () => {
 const results=[];
 function check(name, fn){try{fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.message});}}
 function assert(value,message){if(!value)throw Error(message);}
 function drag(target, point){const d=new DataTransfer();const link=target.closest('a');d.setData('text/uri-list',link?link.href:'https://www.walmart.com/ip/old');d.setData('text/html',target.outerHTML);target.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:d,clientX:point.x,clientY:point.y}));return d;}
 const cards=Array.from(document.querySelectorAll('.card'));
 for(let index=0;index<cards.length;index++){
  const card=cards[index],img=card.querySelector('img'),r=img.getBoundingClientRect(),point={x:r.x+r.width/2,y:r.y+r.height/2};
  check('搜索卡片 '+(index+1)+'：命中覆盖链接并传出对应图片',()=>{const target=document.elementFromPoint(point.x,point.y);assert(target.closest('a')===card.querySelector('a'),'测试必须命中真实覆盖链接');const d=drag(target,point);const urls=window.__iantoTestExtract(d);assert(urls[0]===img.src,'应选择本卡片图片，而非商品链接或其他卡片');assert(!urls.some(u=>u.includes('/ip/')),'不应残留商品页链接');});
 }
 check('卡片边界回退：坐标无图片时仍找到兄弟图片',()=>{const card=cards[1],d=drag(card.querySelector('h3'),{x:1,y:1});assert(window.__iantoTestExtract(d)[0]===card.querySelector('img').src,'应在所属卡片内找图');});
 check('单品页直接图片拖动',()=>{const img=document.getElementById('detail-image'),r=img.getBoundingClientRect();assert(window.__iantoTestExtract(drag(img,{x:r.x+20,y:r.y+20}))[0]===img.src,'直接图片应保持可用');});
 check('普通文字链接保持原数据',()=>{const a=document.getElementById('ordinary-link'),d=drag(a,{x:1,y:1});assert(d.getData('text/uri-list')===a.href,'普通链接不应被当成商品图片');assert(!d.getData('application/x-ianto-image+json'),'普通链接不应有图片载荷');});
 check('损坏的自定义数据可回退到标准图片 URI',()=>{const d=new DataTransfer();d.setData('application/x-ianto-image+json','{bad');d.setData('text/uri-list',cards[0].querySelector('img').src);assert(window.__iantoTestExtract(d)[0]===cards[0].querySelector('img').src,'应解析 URI 回退');});
 check('旧浏览器 DownloadURL 格式',()=>{const d=new DataTransfer();d.setData('DownloadURL','image/jpeg:photo.jpg:'+cards[1].querySelector('img').src);assert(window.__iantoTestExtract(d)[0]===cards[1].querySelector('img').src,'应解析 DownloadURL');});
 const failed=results.filter(r=>!r.ok);const output=document.getElementById('results');output.className=failed.length?'bad':'ok';output.textContent=results.map(r=>(r.ok?'PASS ':'FAIL ')+r.name+(r.error?'：'+r.error:'')).join('\n');
 await fetch('/results',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(results)});
});
</script></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/results' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const results = JSON.parse(body);
      for (const result of results) console.log((result.ok ? 'PASS ' : 'FAIL ') + result.name + (result.error ? ': ' + result.error : ''));
      process.exitCode = results.some(result => !result.ok) ? 1 : 0;
      res.end('ok');
      server.close();
    });
    return;
  }
  if (req.url === '/source.js' || req.url === '/parser.js') {
    res.setHeader('content-type', 'text/javascript; charset=utf-8');
    res.end(req.url === '/source.js' ? source : parser);
  } else if (req.url.startsWith('/image.svg')) {
    res.setHeader('content-type', 'image/svg+xml');
    res.end('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="180"><rect width="220" height="180" fill="#d7e8ff"/><text x="30" y="90">Product image</text></svg>');
  } else {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page);
  }
});
server.listen(0, '127.0.0.1', () => console.log('Open http://127.0.0.1:' + server.address().port));
