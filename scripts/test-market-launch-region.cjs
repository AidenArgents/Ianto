const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{parseHTML}=require('linkedom');
const core=require('../market_capture/core.js'),fixtures=require('./fixtures/market-live-cards.json');
const flush=()=>new Promise(r=>setImmediate(r));
async function launch(country,{independent=false,enabled=true}={}){
  const {document,window}=parseHTML(fixtures['echotik-empty'].html);window.top=window;window.HTMLElement.prototype.getBoundingClientRect=()=>({left:500,top:500,width:50,height:50});
  const regions=[...document.querySelectorAll('[role="radio"]')];let clicked=[];
  for(const node of regions)node.addEventListener('click',()=>{clicked.push(node.textContent);for(const other of regions)other.setAttribute('aria-checked',String(other===node));});
  const chrome={runtime:{getManifest:()=>({version:'fixture'}),onMessage:{addListener(){}},async sendMessage(){return {ok:true,enabled,...(independent?{}:{research:{country,researchId:'launch-1',family:'echotik'}})};}},storage:{local:{async get(){return {};},async set(){}},onChanged:{addListener(){}}}};
  const context=vm.createContext({document,window,location:{href:fixtures['echotik-empty'].url},chrome,crypto,performance,innerWidth:1280,innerHeight:900,setTimeout,clearTimeout,AbortController,Element:window.Element,MutationObserver:window.MutationObserver,addEventListener(){},IantoMarketCore:core});
  vm.runInContext(fs.readFileSync(require.resolve('../market_capture/content.js'),'utf8'),context);await flush();
  return {document,window,clicked,dispose(){document.getElementById('ianto-market-capture').dispatchEvent(new window.Event('ianto-market-dispose'));}};
}
test('Echotik 页面丢弃国家URL参数时，Ianto本次搜索只设置一次对应地区，八国均匹配真实控件',async()=>{
  for(const [country,name]of Object.entries({MX:'Mexico',BR:'Brazil',ID:'Indonesia',PH:'Philippines',MY:'Malaysia',VN:'Vietnam',TH:'Thailand',SG:'Singapore'})){
    const f=await launch(country);assert.deepEqual(f.clicked,[name]);assert.equal(core.pageCountry(f.document,fixtures['echotik-empty'].url),country);
    for(const node of f.document.querySelectorAll('[role="radio"]'))node.setAttribute('aria-checked',String(node.textContent==='US'));
    f.document.body.append(f.document.createElement('span'));await flush();assert.deepEqual(f.clicked,[name],'用户后续更改不被重新覆盖');f.dispose();
  }
});
test('独立浏览Echotik或停用采集时不替用户改地区',async()=>{
  for(const options of [{independent:true},{enabled:false}]){const f=await launch('MX',options);assert.deepEqual(f.clicked,[]);assert.equal(core.pageCountry(f.document,fixtures['echotik-empty'].url),'US');f.dispose();}
});
