const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{parseHTML}=require('linkedom'),A=require('../market_capture/analytics.js'),R=require('../market_capture/research.js');
async function page(opts={}){
  const {document,window}=parseHTML(fs.readFileSync(require.resolve('../market_capture/analysis.html'),'utf8')),stored={...opts.stored},messages=[],storageListeners=[],events={};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{get(){return this.querySelector('option[selected]')?.value||this.querySelector('option')?.value||'';},set(value){for(const o of this.querySelectorAll('option'))o.toggleAttribute('selected',o.value===value);},configurable:true});
  for(const d of document.querySelectorAll('dialog')){d.showModal=()=>d.setAttribute('open','');d.close=()=>d.removeAttribute('open');}
  const dialogPrototype=Object.getPrototypeOf(document.createElement('dialog'));dialogPrototype.showModal=function(){this.setAttribute('open','');};dialogPrototype.close=function(){this.removeAttribute('open');};
  for(const f of document.querySelectorAll('form'))f.reportValidity=()=>true;
  const records=[{id:'one',title:'<img src=x onerror=alert(1)>',productId:'1',query:'FAN',topic:'便携风扇',country:'MX',platform:'Amazon',source:'Amazon',batchId:'b1',price:100,currency:'MXN',capturedAt:'2026-10-23T12:00:00Z'}, {id:'two',title:'Fan',productId:'2',query:'fan',topic:'便携风扇',country:'BR',platform:'Shopee',source:'Shopee',batchId:'b2',price:20,currency:'BRL',capturedAt:'2026-10-23T13:00:00Z'}];
  const W=require('../market_capture/workflow.js');
  const chrome={runtime:{id:'fixture',async sendMessage(m){messages.push(m);if(m.type==='workflowGet')return {ok:true,workflow:{target:'fixture-table',prefs:stored['ianto_research_preferences:fixture-table']||W.defaults(),sync:{pending:0},captures:opts.captures||[]}};if(m.type==='workflowSave'){stored['ianto_research_preferences:fixture-table']={...W.apply(stored['ianto_research_preferences:fixture-table']||W.defaults(),m.changes),state:m.uiState};return {ok:true};}return {ok:true,data:{records,target:'fixture-table',loadedAt:'2026-10-24T00:00:00Z'}};}},storage:{onChanged:{addListener(fn){storageListeners.push(fn);}},local:{async get(k){return {[k]:stored[k]};},async set(v){Object.assign(stored,structuredClone(v));}}}};
  const context=vm.createContext({document,location:{hostname:'fixture',hash:opts.hash||''},chrome,IantoMarketAnalytics:A,IantoMarketResearch:R,IantoMarketWorkflow:W,IantoMarketLabelRules:require('../market_capture/label_rules.js'),URL,URLSearchParams,Intl,Date,crypto,Blob,structuredClone,setTimeout,clearTimeout,console,addEventListener(name,fn){events[name]=fn;}});vm.runInContext(fs.readFileSync(require.resolve('../market_capture/research_ui.js'),'utf8'),context);vm.runInContext(fs.readFileSync(require.resolve('../market_capture/label_rules_ui.js'),'utf8'),context);vm.runInContext(fs.readFileSync(require.resolve('../market_capture/workflow_ui.js'),'utf8'),context);vm.runInContext(fs.readFileSync(require.resolve('../market_capture/analysis.js'),'utf8'),context);await new Promise(resolve=>setImmediate(resolve));
  return {document,window,stored,messages,records,storageListeners,events,click:id=>document.getElementById(id).click(),change(id,value){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new window.Event('change'));}};
}
test('真实页面控制器用同一筛选驱动图表和明细，不执行采集内容中的HTML',async()=>{
  const f=await page(),d=f.document;assert.equal(d.querySelector('#filter-keyword').querySelectorAll('input').length,1,'大小写统一为一个关键词选项');assert.equal(d.querySelector('#records-table img'),null);assert.match(d.querySelector('#records-table').textContent,/<img src=x onerror=alert\(1\)>/);
  const country=d.querySelector('#filter-country input');country.checked=true;country.dispatchEvent(new f.window.Event('change'));assert.equal(d.querySelectorAll('#records-table tbody tr').length,1);assert.equal(d.querySelectorAll('#comparison-chart .interactive').length,1);assert.equal(d.querySelectorAll('#price-comparison .price-section').length,1);
  f.click('batch-none');assert.match(d.querySelector('#scope-description').textContent,/0 次采集 · 0 条观测/);assert.match(d.querySelector('#records-table').textContent,/暂无符合条件/);f.click('batch-all');assert.match(d.querySelector('#scope-description').textContent,/2 次采集/);
});
test('保存和恢复分析视角包含批次、国家和统计口径，刷新只调用只读分析消息',async()=>{
  const f=await page(),d=f.document;f.change('count-mode','observations');const country=d.querySelector('#filter-country input');country.checked=true;country.dispatchEvent(new f.window.Event('change'));f.click('save-view');d.getElementById('view-name').value='风扇测试视角';f.click('confirm-view');const option=d.querySelector('#saved-views option[value]:not([value=""])');assert.ok(option);
  f.click('reset-filters');f.change('count-mode','products');f.change('saved-views',option.value);assert.equal(d.getElementById('count-mode').value,'observations');assert.match(d.getElementById('active-filters').textContent,/国家/);f.click('refresh');await new Promise(resolve=>setImmediate(resolve));assert.ok(f.messages.every(m=>m.namespace==='iantoMarket'&&['analysisGetData','workflowGet','workflowSave'].includes(m.type)));assert.equal(f.messages.filter(m=>m.type==='analysisGetData').at(-1).force,true);
});
test('图表视角可切换，全部组件能在缺失数据下正常显示且保存到当前视角',async()=>{
  const f=await page(),d=f.document;f.change('chart-profile','all');
  assert.equal(d.querySelectorAll('[data-chart]:not([hidden])').length,R.charts.length);
  assert.equal([...d.querySelectorAll('#chart-choices input')].filter(n=>n.checked).length,R.charts.length);
  assert.match(d.getElementById('research-overlap').textContent,/至少需要两个/);
  f.change('chart-profile','selection');assert.equal(d.querySelectorAll('[data-chart]:not([hidden])').length,R.profiles.selection.charts.length);
  f.click('save-view');d.getElementById('view-name').value='候选视角';f.click('confirm-view');await new Promise(resolve=>setImmediate(resolve));const saved=Object.values(f.stored).find(v=>v.views);
  assert.equal(saved.views[0].state.chartProfile,'selection');assert.deepEqual([...saved.views[0].state.charts],R.profiles.selection.charts);
});
test('单件与批量整理真实更新筛选和明细，不写飞书，也不把同一商品多次观测当成多个整理对象',async()=>{const f=await page(),d=f.document;const selected=d.querySelector('#records-table input[type=checkbox]');selected.checked=true;selected.dispatchEvent(new f.window.Event('change'));const bulk=[...d.querySelectorAll('#bulk-tools button')].find(b=>b.textContent==='批量整理');bulk.click();f.change('annotation-relevance','相关');d.getElementById('annotation-type').value='手持风扇';d.getElementById('annotation-tags').value='LED,USB';f.change('annotation-candidate','待询价');[...d.querySelectorAll('#annotation-dialog button')].find(b=>b.textContent==='保存整理').click();assert.match(d.getElementById('records-table').textContent,/手持风扇/);assert.match(d.getElementById('records-table').textContent,/LED · USB/);const saved=Object.values(f.stored).find(v=>v.annotations);assert.equal(Object.keys(saved.annotations).length,1);assert.equal(Object.values(saved.annotations)[0].candidate,'待询价');assert.ok(f.messages.every(m=>['analysisGetData','workflowGet','workflowSave'].includes(m.type)));const filter=[...d.querySelectorAll('#filter-type label')].find(n=>n.textContent.includes('手持风扇')).querySelector('input');filter.checked=true;filter.dispatchEvent(new f.window.Event('change'));assert.equal(d.querySelectorAll('#records-table tbody tr').length,1);});
test('文字规则先预览再保存，真实控制器即时更新图表筛选，删除后不残留衍生标签',async()=>{
  const f=await page(),d=f.document;
  [...d.querySelectorAll('#bulk-tools button')].find(b=>b.textContent==='文字规则标签').click();
  assert.ok(d.getElementById('label-rule-save').disabled);
  for(const [id,value]of Object.entries({'label-rule-name':'风扇','label-rule-any':'FAN','label-rule-type':'规则类型'}))d.getElementById(id).value=value;
  [...d.querySelectorAll('#label-rules-dialog button')].find(b=>b.textContent==='预览匹配').click();
  assert.match(d.getElementById('label-rule-preview').textContent,/匹配 1 个/);
  assert.equal(d.getElementById('label-rule-preview').querySelector('img'),null);
  d.getElementById('label-rule-save').click();
  assert.match(d.getElementById('records-table').textContent,/规则类型/);
  assert.match(d.getElementById('filter-type').textContent,/规则类型/);
  assert.ok(f.messages.every(m=>['analysisGetData','workflowGet','workflowSave'].includes(m.type)));
  d.querySelector('#label-rules-list button:last-child').click();
  assert.doesNotMatch(d.getElementById('records-table').textContent,/规则类型/);
});
function workflowSeed(){const W=require('../market_capture/workflow.js');return {...W.defaults(),rounds:[{id:'round',name:'风扇调研',scope:{from:'2026-10-23',to:'2026-10-25',batchIds:['b1','b2']},phase:'分析中'}],groupings:{round:[{id:'product:fan',name:'风扇',keywords:['fan'],members:[]}]}};}
test('从采集进入指定调研和产品，结论锁定当前依据；有待验证项时不能误报整批完成',async()=>{
  const seed=workflowSeed(),f=await page({stored:{'ianto_research_preferences:fixture-table':seed},hash:'#round=round&product=product%3Afan'}),d=f.document;
  assert.equal(d.getElementById('scope-title').textContent,'风扇调研');assert.equal(d.getElementById('workflow-panel').hidden,false);
  const country=[...d.querySelectorAll('#filter-country label')].find(e=>e.textContent.includes('MX')).querySelector('input');country.checked=true;country.dispatchEvent(new f.window.Event('change'));
  const text=d.getElementById('workflow-findings');text.value='先核实规格\n再比较价格';text.dispatchEvent(new f.window.Event('input'));f.events.pagehide();await new Promise(r=>setImmediate(r));
  let prefs=f.stored['ianto_research_preferences:fixture-table'];assert.equal(prefs.conclusions.round.findings,text.value);assert.equal(prefs.conclusions.round.evidence.productsCount,1);assert.equal(prefs.conclusions.round.evidence.state.filters.country[0],'MX');
  d.getElementById('workflow-task-title').value='运费是否包含？';[...d.querySelectorAll('#workflow-panel button')].find(b=>b.textContent==='添加').click();f.change('workflow-phase','已完成');assert.match(d.getElementById('notice').textContent,/未验证/);assert.notEqual(d.getElementById('workflow-phase').value,'已完成');
  const taskSelect=d.querySelector('#workflow-tasks select');taskSelect.value='已验证';taskSelect.dispatchEvent(new f.window.Event('change'));f.change('workflow-phase','已完成');await new Promise(r=>setImmediate(r));prefs=f.stored['ianto_research_preferences:fixture-table'];assert.equal(prefs.rounds[0].phase,'已完成');assert.equal(prefs.tasks.round[0].status,'已验证');
});
test('资料入表事件自动读取新数据并保留筛选；图片进度不反复拉取整表',async()=>{
  const seed=workflowSeed(),f=await page({stored:{'ianto_research_preferences:fixture-table':seed},hash:'#round=round'}),d=f.document;
  const country=[...d.querySelectorAll('#filter-country label')].find(e=>e.textContent.includes('MX')).querySelector('input');country.checked=true;country.dispatchEvent(new f.window.Event('change'));await new Promise(r=>setImmediate(r));
  f.records.push({...f.records[0],id:'three',productId:'3',title:'New Fan',batchId:'b3'});f.stored['ianto_research_preferences:fixture-table'].rounds[0].scope.batchIds.push('b3');
  const oldValue=[{batchId:'b1',status:'saved',count:1}],newValue=[...oldValue,{batchId:'b3',status:'saved',count:1}];for(const listener of f.storageListeners)listener({ianto_market_v1_index:{oldValue,newValue}},'local');await new Promise(r=>setTimeout(r,1000));
  assert.equal(d.querySelectorAll('#records-table tbody tr').length,2);assert.match(d.getElementById('active-filters').textContent,/MX/);const reads=f.messages.filter(m=>m.type==='analysisGetData').length;assert.equal(reads,2);
  for(const listener of f.storageListeners)listener({ianto_market_v1_index:{oldValue:newValue,newValue:newValue.map(v=>({...v,images:{saved:1}}))}},'local');await new Promise(r=>setTimeout(r,220));assert.equal(f.messages.filter(m=>m.type==='analysisGetData').length,reads);
});

test('编辑验证说明时后台更新任务状态，待处理数字即时更新且不打断输入',async()=>{
  const seed=workflowSeed();seed.tasks.round=[{id:'verify',title:'核实规格',status:'待验证'}];
  const f=await page({stored:{'ianto_research_preferences:fixture-table':seed},hash:'#round=round'}),d=f.document;
  const input=d.querySelector('#workflow-tasks textarea');Object.defineProperty(d,'activeElement',{get:()=>input,configurable:true});input.value='尚在编辑的验证说明';
  const select=d.querySelector('#workflow-tasks select');select.value='已验证';select.dispatchEvent(new f.window.Event('change'));
  assert.match(d.getElementById('workflow-results-summary').textContent,/0 项待处理/);
  assert.equal(d.querySelector('#workflow-tasks textarea'),input);assert.equal(input.value,'尚在编辑的验证说明');
});

test('已完成调研重新打开一个问题，阶段退回待验证而非继续显示完成',async()=>{
  const seed=workflowSeed();seed.rounds[0].phase='已完成';seed.tasks.round=[{id:'verify',title:'再核实规格',status:'已验证'}];
  const f=await page({stored:{'ianto_research_preferences:fixture-table':seed},hash:'#round=round'}),d=f.document;
  const select=d.querySelector('#workflow-tasks select');select.value='待复核';select.dispatchEvent(new f.window.Event('change'));await new Promise(r=>setImmediate(r));
  assert.equal(d.getElementById('workflow-phase').value,'待验证');assert.match(d.getElementById('workflow-results-summary').textContent,/1 项待处理/);
  assert.equal(f.stored['ianto_research_preferences:fixture-table'].rounds[0].phase,'待验证');
});
test('独立采集进入分析只看本批，不继承上次调研和国家条件',async()=>{
  const seed=workflowSeed();seed.state={roundId:'round',filters:{country:['BR']},scope:seed.rounds[0].scope};const f=await page({stored:{'ianto_research_preferences:fixture-table':seed},hash:'#batch=b1'});assert.equal(f.document.querySelectorAll('#records-table tbody tr').length,1);assert.match(f.document.getElementById('records-table').textContent,/MX/);assert.equal(f.document.getElementById('workflow-panel').hidden,true);
});
