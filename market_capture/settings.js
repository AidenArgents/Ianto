(function(){
  'use strict';
  const reloadMessage='Ianto 采集后台未响应此操作，请重新加载扩展，再刷新本页。';
  const $=id=>document.getElementById(id),message=text=>{$('message').textContent=text;$('message').hidden=!text;};
  async function send(type,extra={}){const value=await chrome.runtime.sendMessage({namespace:'iantoMarket',type,...extra});if(!value?.ok){const error=Error(value?.error==='未知采集操作'?reloadMessage:value?.error||'Ianto 采集模块未能响应，请重新加载扩展');error.requiresReload=value?.error==='未知采集操作';throw error;}return value;}
  const date=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
  const exporting=new Set(),deleting=new Set();
  let latestData=null,clearingHistory=false,remoteStatus=null,remoteRequest=null,remoteEpoch=0,remoteCheckedAt=0,refreshVersion=0,renderedVersion=0;
  function resetRemote(){remoteEpoch++;remoteStatus=null;remoteRequest=null;remoteCheckedAt=0;}
  function renderRemote(data){
    const link=$('feishu-link'),loading=Boolean(remoteRequest),configured=data.feishuConfigured;
    link.textContent=!configured?'—':loading?'读取中…':remoteStatus?.ok?String(remoteStatus.count):remoteStatus?'读取失败':'—';
    link.hidden=false;link.title='打开飞书调研表；数量为当前有商品信息的行，空白行不计入';
    if(/^https:\/\/[^/]*feishu\.cn\//.test(data.feishuUrl))link.href=data.feishuUrl;else link.removeAttribute('href');
    const info=$('remote-status');
    if(remoteStatus?.requiresReload){link.textContent='请重载 Ianto';info.textContent=reloadMessage;$('connection-status').textContent=reloadMessage;return;}
    if(!configured)info.textContent='配置飞书后显示当前商品数量。';
    else if(loading)info.textContent='正在从飞书重新读取商品数量…';
    else if(remoteStatus?.ok)info.textContent=`更新于 ${date(remoteStatus.checkedAt)} · 飞书现有商品 ${remoteStatus.count} 个`+(remoteStatus.blankCount?` · 另有空白记录 ${remoteStatus.blankCount} 行`:'');
    else if(remoteStatus)info.textContent='读取失败：'+remoteStatus.error+'。可点“刷新状态”重试。';
    else info.textContent='尚未读取飞书当前数据。';
    const connection=$('connection-status');
    if(!configured)connection.textContent='尚未配置飞书，请填写上方信息。';
    else if(remoteStatus&&!remoteStatus.ok)connection.textContent='飞书读取失败：'+remoteStatus.error;
    else if(remoteStatus?.ok)connection.textContent=data.connection?.connected===false?'飞书可以读取；配置检查未通过：'+data.connection.error:'飞书连接正常，Ianto 后台直接同步。';
    else connection.textContent=data.connection?.error?'上次配置检查未通过：'+data.connection.error:'飞书配置已保存，正在核对当前连接…';
  }
  async function refreshRemote(data){
    if(remoteRequest?.epoch===remoteEpoch)return remoteRequest.promise;
    const request={epoch:remoteEpoch,promise:null};remoteRequest=request;renderRemote(data);
    request.promise=(async()=>{
      try{const result=await send('getRemoteStatus');if(request.epoch===remoteEpoch)remoteStatus=result.remote;}
      catch(error){if(request.epoch===remoteEpoch)remoteStatus={ok:false,error:error.message,requiresReload:error.requiresReload};}
      finally{if(request.epoch===remoteEpoch){remoteRequest=null;remoteCheckedAt=Date.now();renderRemote(latestData||data);}}
    })();
    return request.promise;
  }
  function renderItems(id,items,text,withExport=false,withDelete=false,emptyText='暂无记录'){
    const root=$(id);root.replaceChildren();if(!items.length){root.textContent=emptyText;return;}
    for(const item of items){
      const div=document.createElement('div');div.className='item';const detail=document.createElement('div');detail.style.whiteSpace='pre-wrap';detail.textContent=text(item);div.appendChild(detail);
      if(withExport||withDelete){
        const actions=document.createElement('div');actions.className='item-actions';
        if(withExport&&item.batchId&&item.canExport!==false){const button=document.createElement('button');button.textContent='导出这次 CSV';button.title='只导出这一次采集的商品，内容为采集时的快照';button.disabled=clearingHistory||exporting.has(item.batchId)||deleting.has(item.batchId);button.addEventListener('click',()=>{void exportBatch(item.batchId);});actions.appendChild(button);}
        if(withDelete&&item.batchId){const button=document.createElement('button');button.textContent='删除';button.className='danger';button.title='删除此批次采集历史';button.disabled=clearingHistory||deleting.has(item.batchId)||exporting.has(item.batchId);button.addEventListener('click',()=>{void deleteHistoryItem(item.batchId);});actions.appendChild(button);}
        div.appendChild(actions);
      }
      root.appendChild(div);
    }
  }
  async function deleteHistoryItem(batchId){
    if(clearingHistory||deleting.has(batchId)||exporting.has(batchId)||!confirm('确定删除这次采集历史？'))return;
    deleting.add(batchId);void refresh();try{await send('deleteBatch',{batchId});await refresh();message('已删除这次采集历史。');}catch(error){message(error.message);}finally{deleting.delete(batchId);void refresh();}
  }
  async function refresh(loadSettings=false,forceRemote=false){
    const version=++refreshVersion;
    try{
      const data=await send(loadSettings?'settingsGet':'status');
      if(version<renderedVersion)return null;renderedVersion=version;
      if(latestData&&(data.feishuUrl!==latestData.feishuUrl||data.feishuConfigured!==latestData.feishuConfigured))resetRemote();
      latestData=data;
      $('header-error').hidden=!data.headerError;$('header-error').textContent=data.headerError?'表头同步未完成：'+data.headerError:'';
      $('pending-count').textContent=data.pendingCount;
      renderItems('pending-list',data.pending,j=>`${date(j.createdAt)} · ${j.count} 个商品${j.error?' · '+j.error:' · 等待资料入表'}`+(j.note?'\n'+j.note:''),true,false,'暂无待入表商品');
      renderItems('history',data.history,j=>`${date(j.at)} · ${j.country||'未知国家'} · ${j.platform||'未知平台'} · ${j.method} · ${j.count} 个 · ${j.topic||'独立采集'}`+(j.note?'\n'+j.note:''),true,true);
      const images=data.images||{},failures=images.failures||[];
      $('opinion-progress').hidden=!(data.opinions?.pending>0);$('opinion-progress').textContent=data.opinions?.pending?'开发意见：'+data.opinions.pending+' 批待同步'+(data.opinions.failures?.length?' · '+data.opinions.failures[0]:''):'';
      $('image-progress').textContent=`采集记录首图：已上传 ${images.saved||0} 张 · 待上传 ${images.pending||0} 张 · `;
      const failureToggle=$('image-failure-toggle');failureToggle.hidden=false;failureToggle.disabled=!(images.failed>0);failureToggle.textContent=`失败 ${images.failed||0} 张`;
      failureToggle.title=images.failed>0?'点击查看失败原因'+(failures.length&&failures.length<images.failed?`（最近 ${failures.length} 条）`:''):'暂无上传失败的首图';
      if(!(images.failed>0)){$('image-failures').hidden=true;failureToggle.setAttribute('aria-expanded','false');}
      if(failures.length)renderItems('image-failures',failures,j=>(j.title||'商品首图')+'：'+j.error+(j.productUrl?'\n'+j.productUrl:''));
      else $('image-failures').textContent=images.failed>0?'失败明细暂不可用，请刷新状态。':'';
      if(loadSettings){const s=data.settings,f=s.feishu;$('enabled').checked=s.enabled;$('app-id').value=f.appId||'';$('feishu-url').value=f.feishuUrl||'';$('app-secret').value='';$('app-secret').placeholder=f.hasSecret?'已保存，留空保留原密钥':'首次填写 App Secret';}
      renderRemote(data);
      if(data.feishuConfigured&&(forceRemote||!remoteStatus||Date.now()-remoteCheckedAt>=30000))await refreshRemote(data);
      return {...data,remote:remoteStatus};
    }catch(error){message(error.message);if(latestData){remoteStatus={ok:false,error:error.message};renderRemote(latestData);}return null;}
  }
  async function save(){
    const result=await send('settingsSave',{settings:{enabled:$('enabled').checked,feishu:{appId:$('app-id').value.trim(),appSecret:$('app-secret').value.trim(),feishuUrl:$('feishu-url').value.trim()}}});
    $('app-secret').value='';await refresh(true,true);return result;
  }
  $('save').addEventListener('click',async()=>{$('save').disabled=true;try{const result=await save();message(result.connected?'配置已保存，飞书连接通过。':('配置已保存，连接未通过：'+result.connectionError));}catch(e){message(e.message);}finally{$('save').disabled=false;}});
  $('retry').addEventListener('click',async()=>{$('retry').disabled=true;try{const result=await send('retryIncomplete');await refresh();message(result.started?'正在后台补传未完成的商品资料、首图和开发意见，失败的也已重新排队。可以继续浏览。':'当前没有需要补传的内容。');}catch(e){message(e.message);}finally{$('retry').disabled=false;}});
  $('image-failure-toggle').addEventListener('click',()=>{const failures=$('image-failures');failures.hidden=!failures.hidden;$('image-failure-toggle').setAttribute('aria-expanded',String(!failures.hidden));});
  $('refresh').addEventListener('click',async()=>{$('refresh').disabled=true;message('');try{await refresh(false,true);}finally{$('refresh').disabled=false;}});
  $('clear-history').addEventListener('click',async()=>{
    if(clearingHistory||exporting.size||deleting.size||!confirm('确定清空全部采集历史？'))return;
    clearingHistory=true;$('clear-history').disabled=true;void refresh();
    try{await send('clearHistory');await refresh();message('采集历史已全部清空。');}catch(error){message(error.message);}finally{clearingHistory=false;$('clear-history').disabled=false;void refresh();}
  });
  async function exportBatch(batchId){
    if(exporting.has(batchId))return;exporting.add(batchId);void refresh();message('正在导出这一次采集…');
    try{const value=await send('exportBatch',{batchId}),url=URL.createObjectURL(new Blob([value.csv],{type:'text/csv;charset=utf-8'}));try{await chrome.downloads.download({url,filename:value.filename,saveAs:true});}finally{setTimeout(()=>URL.revokeObjectURL(url),60000);}message(`已导出这次采集的 ${value.count} 个商品，内容为采集时的快照。`+(value.warning?'\n'+value.warning:''));}
    catch(e){message(e.message);}finally{exporting.delete(batchId);void refresh();}
  }
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes.ianto_market_v1_credentials){resetRemote();void refresh(true,true);return;}
    if(changes.ianto_market_v1_index||changes.ianto_market_v1_connection){const index=changes.ianto_market_v1_index,saved=list=>(list||[]).filter(j=>j.status==='saved').reduce((n,j)=>n+j.count,0);void refresh(false,Boolean(changes.ianto_market_v1_connection)||Boolean(index&&saved(index.oldValue)!==saved(index.newValue)));}
  });
  void refresh(true);setInterval(()=>{if(!document.hidden)void refresh();},5000);
})();
