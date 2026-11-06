document.addEventListener('DOMContentLoaded',()=>{
  const input=document.getElementById('multisearch_research_topic');
  if(input){input.value='';input.autocomplete='off';}
  const round=document.getElementById('multisearch-round'),product=document.getElementById('multisearch-product');if(!round)return;
  let rounds=[],serial=0,target='',routeApplied=false,userSelected=false;const route=new URLSearchParams(location.hash.slice(1));
  function products(chosen=''){const current=rounds.find(r=>r.id===round.value);document.getElementById('multisearch-product-wrap').hidden=!current;product.replaceChildren(new Option('新产品（使用本次主题）',''));for(const p of current?.products||[])product.append(new Option(p.name,p.id));product.value=chosen||(current?.products.length===1?current.products[0].id:'');}
  round.addEventListener('change',()=>{userSelected=true;products();});
  async function refresh(){const version=++serial;try{const reply=await chrome.runtime.sendMessage({namespace:'iantoMarket',type:'workflowChoices'});if(version!==serial)return;if(!reply?.ok)throw Error(reply?.error||'调研归属未能读取');target=reply.workflow.target;rounds=reply.workflow.rounds;let selected=round.value,selectedProduct=product.value;if(!routeApplied&&!userSelected&&rounds.some(r=>r.id===route.get('round'))){selected=route.get('round');selectedProduct=route.get('product')||'';routeApplied=true;}round.replaceChildren(new Option('新建调研（使用本次主题）',''),...rounds.map(r=>new Option(r.name,r.id)));round.value=rounds.some(r=>r.id===selected)?selected:'';products(selectedProduct);}catch(e){document.getElementById('workflow-popup-status').textContent=e.message;}}
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local'&&target&&(changes['ianto_research_preferences:'+target]||changes['ianto_workflow_v1:'+target]))void refresh();});
  void refresh();
});
