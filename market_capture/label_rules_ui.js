(function(root){
  'use strict';
  function create({A,L,$,el,getContext,changed,notify}){
    let editing='',draft=null,previewed=false;
    const button=(label,action,cls='')=>el('button',{type:'button',class:cls,onclick:action},label);
    const dialog=el('dialog',{id:'label-rules-dialog'}),form=el('form',{class:'annot-form'}),head=el('div',{class:'dialog-heading'});
    head.append(el('h2',{},'文字规则标签'),button('×',()=>dialog.close(),'close-dialog'));
    const list=el('div',{id:'label-rules-list',class:'label-rules-list'}),grid=el('div',{class:'annot-grid'});
    function field(id,label,tag='input',options=null){
      const wrap=el('label',{},label),input=el(tag,{id,...(tag==='input'?{type:'text'}:{})});
      if(options)input.append(...options.map(([value,label])=>el('option',{value},label)));
      wrap.append(input);grid.append(wrap);return input;
    }
    field('label-rule-name','规则名称');
    field('label-rule-field','匹配范围','select',[['both','标题、属性和规格'],['title','仅标题'],['attributes','仅属性和规格']]);
    field('label-rule-any','包含任一词（每行一项）','textarea');
    field('label-rule-all','同时包含这些词（每行一项）','textarea');
    field('label-rule-none','排除词（每行一项）','textarea');
    field('label-rule-product','适用产品','select');field('label-rule-scope','适用调研批次','select');
    field('label-rule-type','标记商品类型（可留空）');field('label-rule-tags','配置标签（逗号分隔，可留空）');
    field('label-rule-relevance','标记相关性','select',[['','保持原样'],['相关','相关'],['待确认','待确认'],['不相关','不相关']]);
    field('label-rule-candidate','标记候选状态','select',[['','保持原样'],['重点对标','重点对标'],['待询价','待询价'],['待核实','待核实']]);
    const enabledWrap=el('label',{class:'inline-check'}),enabled=el('input',{type:'checkbox',id:'label-rule-enabled'});enabledWrap.append(enabled,'启用：后续读取的新商品也按规则标记');
    const previewBox=el('div',{id:'label-rule-preview',class:'label-rule-preview'}),save=button('保存规则',saveRule,'primary');save.id='label-rule-save';
    const actions=el('div',{class:'dialog-actions'});actions.append(button('预览匹配',previewRule),save,button('取消',()=>dialog.close()));
    form.append(head,el('p',{class:'muted'},'按文字包含关系匹配，忽略大小写，保留重音差异。先预览再保存；人工整理优先，规则冲突的项目留待人工确认。规则只用于 Ianto 分析。'),list,button('新建规则',()=>edit('')),grid,enabledWrap,previewBox,actions);
    form.addEventListener('submit',e=>e.preventDefault());
    for(const event of ['input','change'])grid.addEventListener(event,invalidate);
    enabled.addEventListener('change',invalidate);dialog.append(form);document.body.append(dialog);
    $('bulk-tools').append(button('文字规则标签',open));
    function invalidate(){previewed=false;save.disabled=true;previewBox.replaceChildren(el('p',{class:'muted'},'预览后可保存。'));}
    function options(id,values,value){const input=$(id);input.replaceChildren(...values.map(([v,n])=>el('option',{value:v},n)));input.value=value;}
    function renderList(){
      const rules=getContext().prefs.labelRules||[];
      list.replaceChildren(...rules.map(r=>{const line=el('div',{class:'label-rule-item'});line.append(el('span',{},(r.enabled===false?'未启用 · ':'')+r.name),button('编辑',()=>edit(r.id)),button('删除',()=>{const ctx=getContext();ctx.prefs.labelRules=(ctx.prefs.labelRules||[]).filter(v=>v.id!==r.id);changed();renderList();if(editing===r.id)edit('');}));return line;}));
    }
    function edit(id){
      const ctx=getContext();editing=id;draft=L.rule((ctx.prefs.labelRules||[]).find(r=>r.id===id)||{id:crypto.randomUUID()});
      for(const [key,id]of Object.entries({name:'name',field:'field',type:'type',relevance:'relevance',candidate:'candidate'}))$('label-rule-'+id).value=draft[key];
      for(const k of ['any','all','none'])$('label-rule-'+k).value=draft[k].join('\n');$('label-rule-tags').value=draft.tags.join(', ');enabled.checked=draft.enabled;
      const productOptions=[['','全部产品'],...ctx.products.map(p=>[p.id,p.name])];
      if(draft.productIds[0]&&!productOptions.some(([id])=>id===draft.productIds[0]))productOptions.push([draft.productIds[0],'已移除的产品（不匹配）']);
      options('label-rule-product',productOptions,draft.productIds[0]||'');
      const scopes=[['global','所有调研批次'],...(ctx.prefs.rounds||[]).map(r=>['round:'+r.id,r.name])];
      if(draft.roundId!==null&&!scopes.some(([id])=>id==='round:'+draft.roundId))scopes.push(['round:'+draft.roundId,'已移除的调研批次（不匹配）']);
      options('label-rule-scope',scopes,draft.roundId===null?'global':'round:'+draft.roundId);invalidate();
    }
    function read(){const scope=$('label-rule-scope').value;return L.rule({...draft,name:$('label-rule-name').value,field:$('label-rule-field').value,any:$('label-rule-any').value.split(/\r?\n/),all:$('label-rule-all').value.split(/\r?\n/),none:$('label-rule-none').value.split(/\r?\n/),productIds:[$('label-rule-product').value].filter(Boolean),roundId:scope==='global'?null:scope.slice(6),type:$('label-rule-type').value,tags:$('label-rule-tags').value.split(/[,，;；\n]/),relevance:$('label-rule-relevance').value,candidate:$('label-rule-candidate').value,enabled:enabled.checked});}
    function previewRule(){
      const r=read(),ctx=getContext();if(!L.valid(r)){previewBox.replaceChildren(el('p',{class:'error'},'请填写名称、至少一个包含词和至少一项标记内容。'));return;}
      const context={roundId:ctx.state.roundId,scope:ctx.state.scope,products:ctx.products,annotations:ctx.prefs.annotations||{},reviews:ctx.prefs.reviewScopes?.[ctx.state.roundId||'all']||{}},rules=[...(ctx.prefs.labelRules||[]).filter(v=>v.id!==r.id),{...r,enabled:true}],result=L.preview(ctx.sourceRows,rules,context).filter(v=>v.proposal.ids.includes(r.id));
      previewBox.replaceChildren(el('p',{},'当前调研范围匹配 '+result.length+' 个去重商品；其中 '+result.filter(v=>v.changed).length+' 个会调整分析标记。'));
      if(r.roundId!==null&&r.roundId!==ctx.state.roundId)previewBox.append(el('p',{class:'muted'},'规则属于其他调研批次，切换到对应批次后生效。'));
      const table=el('table'),body=el('tbody');for(const item of result.slice(0,8)){const tr=el('tr');tr.append(el('td',{},item.row.title),el('td',{},[item.row.type,...item.row.tags,item.row.relevance,item.row.candidate!=='未加入'?item.row.candidate:''].filter(Boolean).join(' · ')),el('td',{},item.proposal.conflicts.length?'有规则冲突，保留人工或未标记状态':item.changed?'会调整':'保持人工标记'));body.append(tr);}table.append(body);previewBox.append(table);if(result.length>8)previewBox.append(el('p',{class:'muted'},'展示前8个匹配，保存后应用于全部匹配商品。'));previewed=true;save.disabled=false;
    }
    function saveRule(){if(!previewed)return;const ctx=getContext(),r=read(),rules=(ctx.prefs.labelRules||[]).filter(v=>v.id!==r.id);if(rules.length>=100){notify('最多保存100条规则。',true);return;}ctx.prefs.labelRules=[...rules,r];changed();renderList();edit(r.id);notify('文字规则已保存；人工标记优先，新数据会自动匹配。');}
    function open(){renderList();edit('');dialog.showModal();}
    return {open};
  }
  root.IantoMarketLabelRulesUI={create};
})(globalThis);
