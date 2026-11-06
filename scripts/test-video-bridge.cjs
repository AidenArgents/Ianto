// Offline security/dispatch tests. Run node scripts/test-video-bridge.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const context = {URL}; vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'features/video_contract.js'), 'utf8'), context);
const C = context.VceVideoContract;
assert.equal(C.origin('http://127.0.0.1:4173/'), 'http://127.0.0.1:4173');
for (const url of ['http://evil.test:4173', 'http://127.0.0.1:22', 'http://user:pass@localhost:4173', 'https://localhost:4173']) assert.throws(() => C.origin(url));
assert.equal(C.provider('https://app.runwayml.com/abc'), 'runway');
assert.equal(C.provider('https://jimeng.jianying.com/ai'), 'seedance');
assert.equal(C.provider('https://app.klingai.com/global/'), 'kling');
assert.equal(C.provider('https://labs.google/fx/tools/flow'), 'veo');
for (const url of ['https://app.runwayml.com.evil.test', 'http://app.klingai.com', 'https://evil.test/']) assert.equal(C.provider(url), null);
const id = 'a'.repeat(32);
assert.equal(C.suffix(`/shots/${id}/clip`), `/shots/${id}/clip`);
for (const suffix of ['/../../secret', '/status?token=secret', '/shots/../clip', 'https://evil.test']) assert.throws(() => C.suffix(suffix));
assert.throws(() => C.jobId('../escape'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const bridge = manifest.content_scripts.find(script => script.js.includes('content_scripts/video_bridge.js'));
assert.deepEqual(bridge.matches, ['http://localhost:4173/*', 'http://127.0.0.1:4173/*']);
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
assert(background.includes("request.action?.startsWith('vceVideo')"), 'Legacy listener must not swallow video response');
for (const f of ['features/video_background.js', 'content_scripts/video_worker.js', 'content_scripts/video_bridge.js']) new vm.Script(fs.readFileSync(path.join(root, f), 'utf8'));
console.log('PASS: localhost scope, provider allowlist, chunk paths, manifest, legacy dispatch and syntax');

(async () => {
  const sessions = {}, listeners = [], sent = [], fetched = [];
  const workerTab = {id: 9, title: 'Runway fixture', url: 'https://app.runwayml.com/generate'};
  const fakeChrome = {
    storage: {
      session: {async get(key){return key === null ? {...sessions} : {[key]:sessions[key]}}, async set(value){Object.assign(sessions,value)}, async remove(key){delete sessions[key]}},
      local: {async get(){return {vceVideoProfiles:{}}}}
    },
    runtime: {onMessage:{addListener(fn){listeners.push(fn)}},getManifest(){return {version:'2.6.4'}}},
    scripting:{async executeScript(){}},
    tabs:{async get(){return workerTab}, async query(){return [workerTab]}, async update(){}, onRemoved:{addListener(){}},
      async sendMessage(tabId,message){sent.push({tabId,message});return {ok:true}}}
  };
  const scope = {VceVideoContract:C, chrome:fakeChrome, URL, AbortSignal, Uint8Array, btoa: value=>Buffer.from(value,'binary').toString('base64'),
    async fetch(url,options){fetched.push({url,options});return {ok:true,json:async()=>({provider:'runway',tasks:[]})}}};
  vm.createContext(scope); vm.runInContext(fs.readFileSync(path.join(root,'features/video_background.js'),'utf8'),scope);
  const send = (request,sender) => new Promise(resolve=>listeners[0](request,sender,resolve));
  const sender = {tab:{id:3},frameId:0,url:'http://127.0.0.1:4173/'};
  const base = {action:'vceVideoClient',operation:'start',provider:'runway',tabId:9,jobId:id,grant:'g'.repeat(43)};
  assert.equal((await send(base,{...sender,url:'https://evil.test'})).ok,false);
  assert.equal((await send(base,{...sender,frameId:1})).ok,false);
  assert.equal((await send(base,sender)).result.started,true);
  assert.equal(Object.keys(sessions).length,1);
  const dispatched = sent.find(x=>x.message.action==='vceVideoRun').message;
  assert.equal(dispatched.grant,undefined,'Website document must never receive the grant');
  assert.equal(fetched[0].options.headers['X-VCE-Web-Grant'],'g'.repeat(43));
  const relay = {action:'vceVideoRelay',jobId:id,suffix:'/status',body:{message:'test'}};
  assert.equal((await send(relay,{tab:{id:8},frameId:0,url:workerTab.url})).ok,false);
  assert.equal((await send({...relay,suffix:'/../../secrets'},{tab:{id:9},frameId:0,url:workerTab.url})).ok,false);
  assert.equal((await send(relay,{tab:{id:9},frameId:0,url:workerTab.url})).ok,true);
  assert.equal((await send(base,sender)).ok,false,'Duplicate starts must not be queued');
  assert.equal((await send({...base,operation:'cancel'},sender)).ok,true);
  assert.equal(Object.keys(sessions).length,0);
  console.log('PASS: background acceptance, sender isolation, scoped grant relay, duplicate protection and cancellation');
})().catch(error=>{console.error(error);process.exitCode=1});
