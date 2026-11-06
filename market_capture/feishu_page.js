(function(){
  'use strict';
  let timer=null,running=false,watching=true;
  async function check(){
    if(document.hidden||running||!watching)return;
    running=true;
    try{const result=await chrome.runtime.sendMessage({namespace:'iantoMarket',type:'headersCheck'});if(result?.ok)watching=result.watching!==false;}
    catch{}finally{running=false;}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(check,1500);}
  for(const type of ['pointerup','change'])document.addEventListener(type,schedule,{passive:true});
  document.addEventListener('keyup',event=>{if(['Enter','Escape'].includes(event.key))schedule();},{passive:true});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){watching=true;schedule();}});
  window.addEventListener('popstate',()=>{watching=true;schedule();});
  let lastUrl=location.href;
  setInterval(()=>{if(location.href!==lastUrl){lastUrl=location.href;watching=true;}void check();},15000);
  schedule();
})();
