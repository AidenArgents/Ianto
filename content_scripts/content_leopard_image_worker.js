(function () {
  'use strict';
  if (location.origin !== 'https://leopard-x.memofun.net' || globalThis.__iantoLeopardWorker) return;
  globalThis.__iantoLeopardWorker = true;
  const BUILD = '2026-11-06.1', PROTOCOL = 2;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const normalized = value => String(value || '').replace(/\s+/g, ' ').trim();
  const visible = element => !!element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0 && getComputedStyle(element).visibility !== 'hidden';
  const list = selector => Array.from(document.querySelectorAll(selector));
  const modelSpecs = {
    'GPT-6 Instant': { efforts: [] },
    'GPT-6': { effortTrigger: 'gpt-6-thinking', efforts: ['medium','high','xhigh'] },
    'GPT-6.1 Sol': { group: 'ChatGPT Work (Codex) [6.1 sol]', effortTrigger: 'gpt-6.1-sol-wm', efforts: ['low','medium','high','xhigh','max'] },
    'GPT-6 Luna': { group: 'ChatGPT Work (Codex) [6.1 sol]', effortTrigger: 'gpt-6-luna-wm', efforts: ['low','medium','high','xhigh','max'] }
  };
  const effortLabels = { low:'轻度',medium:'中',high:'高',xhigh:'极高',max:'最高' };
  let active = false;
  function send(message) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, result => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); else resolve(result);
    }));
  }
  function progress(job,status,type='info') {
    if (job.originTabId) send({action:'geminiImageWorkerStatus',provider:'leopard',originTabId:job.originTabId,jobId:job.jobId,status,type}).catch(()=>{});
  }
  async function waitFor(check, timeout = 30000, message = '等待 Leopard X 页面超时') {
    const start = Date.now();
    while (Date.now() - start < timeout) { const result = await check(); if (result) return result; await sleep(300); }
    throw new Error(message);
  }
  const textbox = () => document.querySelector('#prompt-textarea');
  const composer = () => textbox()?.closest('form') || textbox()?.closest('[data-type="unified-composer"]') || document.querySelector('[id="thread-bottom"]') || textbox()?.parentElement?.parentElement;
  const stopButton = () => list('button[data-testid="stop-button"],button[aria-label*="停止生成"],button[aria-label*="停止响应"],button[aria-label*="停止回答"],button[aria-label*="Stop response"]').find(visible);
  const sendButton = () => document.querySelector('#composer-submit-button,[data-testid="send-button"]');
  async function setMenuExpanded(element,expanded) {
    // React commits closing a menu after its selection handler returns. Wait
    // before reading aria-expanded so a pending close cannot swallow a reopen.
    await sleep(50);
    if (element.getAttribute('aria-expanded') === String(expanded)) return;
    // Radix dropdown buttons open on pointerdown, rather than the click event
    // emitted by HTMLElement.click(). Submenu items still use click normally.
    if (element.tagName === 'BUTTON' && typeof PointerEvent !== 'undefined') {
      element.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,buttons:1,pointerType:'mouse',isPrimary:true}));
      element.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,buttons:0,pointerType:'mouse',isPrimary:true}));
      await sleep(100);
    }
    if (element.getAttribute('aria-expanded') !== String(expanded)) element.click();
    await waitFor(()=>element.getAttribute('aria-expanded')===String(expanded),4000,'[MODEL] 模型菜单状态未切换');
  }
  async function closeMenus() {
    const trigger=modelTrigger();
    if (trigger) await setMenuExpanded(trigger,false);
    await waitFor(()=>!list('[role="menu"]').some(visible),4000,'[MODEL] 模型菜单未关闭');
  }
  async function openMenuTrigger(element) {
    return setMenuExpanded(element,true);
  }
  function modelTrigger() {
    const candidates = Array.from((composer() || document).querySelectorAll('button[aria-haspopup="menu"]')).filter(button => visible(button) && button.id !== 'composer-plus-btn' && normalized(button.textContent));
    return candidates.length === 1 ? candidates[0] : null;
  }
  function radioLabel(element) {
    return normalized(element.querySelector('.min-w-0 > span')?.textContent || element.querySelector('.min-w-0 .truncate')?.textContent || element.querySelector('span')?.textContent || element.textContent);
  }
  async function openModelMenu(groupName) {
    await closeMenus();
    const trigger = await waitFor(modelTrigger, 15000, '[MODEL] 找不到 Leopard X 模型选择器');
    await openMenuTrigger(trigger);
    await waitFor(() => list('[role="menuitemradio"]').some(item => visible(item) && radioLabel(item) === 'GPT-6'),10000,'[MODEL] 模型菜单未展开');
    if (groupName) {
      const group = await waitFor(() => list('[role="menuitem"][data-nextc-group]').find(item => visible(item) && item.getAttribute('data-nextc-group') === groupName),10000,'[MODEL] 找不到 Leopard X 的 Codex 模型分组');
      if (group.getAttribute('aria-expanded') !== 'true') group.click();
      await waitFor(() => list('[role="menuitemradio"]').some(item => visible(item) && radioLabel(item) === 'GPT-6.1 Sol'),10000,'[MODEL] Codex 模型菜单未展开');
    }
    return list('[role="menuitemradio"]').filter(item => visible(item) && modelSpecs[radioLabel(item)]);
  }
  async function modelEntry(name) {
    const entries = await openModelMenu(modelSpecs[name].group);
    const entry = entries.find(item => radioLabel(item) === name);
    if (!entry || entry.getAttribute('aria-disabled') === 'true') throw new Error('[MODEL] Leopard X 当前没有可用的 ' + name + '，请刷新模型清单');
    return entry;
  }
  async function listModels() {
    if (!textbox()) throw new Error('[LEOPARD_LOGIN] 请先登录 Leopard X 并进入聊天页面');
    try {
      const entries = await openModelMenu(modelSpecs['GPT-6.1 Sol'].group);
      return entries.map(item => {
        const name = radioLabel(item);
        return { id:name,name,group:modelSpecs[name].group || 'ChatGPT',efforts:modelSpecs[name].efforts,description:normalized(item.textContent).slice(0,500),disabled:item.getAttribute('aria-disabled') === 'true' };
      }).filter(item => !item.disabled).sort((a,b) => Object.keys(modelSpecs).indexOf(a.id)-Object.keys(modelSpecs).indexOf(b.id));
    } finally { await closeMenus(); }
  }
  async function selectModel(name, options) {
    const spec = modelSpecs[name], effort = options?.reasoningEffort;
    if (!spec) throw new Error('[MODEL] 未配置的 Leopard X 站内模型：' + name);
    if (Object.keys(options || {}).some(key => key !== 'reasoningEffort') || (effort && !spec.efforts.includes(effort)) || (spec.efforts.length && !effort)) throw new Error('[MODEL] 该模型的思考档位无效，请重新选择');
    try {
      const entry = await modelEntry(name);
      if (entry.getAttribute('aria-checked') !== 'true') entry.click();
      const selected = await modelEntry(name);
      if (selected.getAttribute('aria-checked') !== 'true') throw new Error('[MODEL] 站内模型切换未生效，未发送任务');
      if (effort) {
        const control = list('[data-nextc-effort-trigger]').find(item => visible(item) && item.getAttribute('data-nextc-effort-trigger') === spec.effortTrigger);
        if (!control) throw new Error('[MODEL] 找不到该模型的思考档位');
        control.click();
        const menu = await waitFor(() => list('[role="menu"]').find(item => visible(item) && item.getAttribute('aria-labelledby') === control.id),8000,'[MODEL] 思考档位菜单未展开');
        const choice = Array.from(menu.querySelectorAll('[role="menuitemradio"]')).find(item => radioLabel(item) === effortLabels[effort]);
        if (!choice || choice.getAttribute('aria-disabled') === 'true') throw new Error('[MODEL] 该思考档位当前不可用');
        if (choice.getAttribute('aria-checked') !== 'true') choice.click();
        await modelEntry(name);
        const verified = list('[data-nextc-effort-trigger]').find(item => visible(item) && item.getAttribute('data-nextc-effort-trigger') === spec.effortTrigger);
        if (!normalized(verified?.getAttribute('aria-label')).endsWith('· ' + effortLabels[effort])) throw new Error('[MODEL] 思考档位切换未生效，未发送任务');
      }
    } finally { await closeMenus(); }
    return normalized(modelTrigger()?.textContent);
  }
  function textValue(element) { return element?.value ?? element?.innerText ?? element?.textContent ?? ''; }
  function fill(element, text) {
    element.focus();
    if (element instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(element, text);
    } else {
      const range = document.createRange(), selection = getSelection(); range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, text)) element.textContent = text;
    }
    element.dispatchEvent(new InputEvent('input', {bubbles:true,inputType:'insertText',data:text}));
  }
  function attachments() {
    const root = composer();
    if (!root) return [];
    const selectors = ['[data-testid="attachment"]','[data-testid*="file-thumbnail"]','button[aria-label*="Remove"]','button[aria-label*="移除"]','button[aria-label*="删除"]'];
    const collections = selectors.map(selector => Array.from(root.querySelectorAll(selector)).filter(visible));
    collections.push(Array.from(root.querySelectorAll('img')).filter(img => visible(img) && !/avatar|头像/i.test(img.alt || '') && !img.src.startsWith('data:image/svg')));
    return collections.sort((a,b) => b.length-a.length)[0];
  }
  async function upload(images) {
    if (!images?.length) throw new Error('[LEOPARD_UPLOAD] 缺少产品原图');
    if (attachments().length) throw new Error('[LEOPARD_DRAFT] 输入区已有附件，请检查管理标签页中的草稿');
    const input = document.querySelector('#upload-photos') || document.querySelector('#upload-files');
    if (!input) throw new Error('[LEOPARD_UPLOAD] 找不到图片上传框');
    const files = await Promise.all(images.map(async (image, index) => {
      const response = await fetch(image.dataUrl), blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('[LEOPARD_UPLOAD] 第' + (index+1) + '张图片无效');
      return new File([blob], image.name || 'product-' + index + '.png', { type: blob.type });
    }));
    const transfer = new DataTransfer(); files.forEach(file => transfer.items.add(file));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'files').set.call(input,transfer.files);
    input.dispatchEvent(new Event('change',{bubbles:true}));
    await waitFor(() => attachments().length >= images.length, 60000, '[LEOPARD_UPLOAD] 图片未完整上传，提示词未发送');
    if (attachments().length !== images.length) throw new Error('[LEOPARD_UPLOAD] 附件数量不符，提示词未发送');
  }
  const userMessages = () => list('[data-message-author-role="user"]');
  const assistantMessages = () => {
    const turns = list('section[data-turn="assistant"]');
    return turns.length ? turns : list('[data-message-author-role="assistant"]');
  };
  function resultImages(messages) {
    return messages.flatMap(message => {
      const generated = Array.from(message.querySelectorAll('[id^="image-"] img'));
      return generated.length ? generated : Array.from(message.querySelectorAll('img'));
    }).filter(image => {
      const source = image.currentSrc || image.src;
      return source && !source.startsWith('data:image/svg') && !/avatar|头像/i.test(image.alt || '') && !(image.complete && image.naturalWidth > 0 && image.naturalWidth < 128);
    });
  }
  function alertText() {
    return list('[role="alert"],.error-message').filter(visible).map(item => normalized(item.textContent)).filter(Boolean).join('\n').slice(-500);
  }
  async function imageData(image) {
    const source = image.currentSrc || image.src;
    if (source.startsWith('data:image/')) return source;
    try {
      const response = await fetch(source); const blob = await response.blob();
      if (response.ok && blob.type.startsWith('image/') && blob.size > 100) return await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    } catch (_) {}
    const response = await send({action:'webImageFetchDataUrl',url:source});
    if (response?.success && /^data:image\//.test(response.dataUrl)) return response.dataUrl;
    throw new Error('[LEOPARD_RESULT] 已找到结果图但读取失败，重试会先恢复原会话');
  }
  async function journalRead(taskKey) { return (await chrome.storage.local.get('leopardImageTask_' + taskKey))['leopardImageTask_' + taskKey]; }
  async function journalSave(taskKey, journal) { journal.updatedAt = Date.now(); await chrome.storage.local.set({ ['leopardImageTask_' + taskKey]: journal }); }
  const temporaryConversation = url => /^https:\/\/leopard-x\.memofun\.net\/c\/WEB(?::|%3A)/i.test(String(url || ''));
  const canonicalConversation = url => String(url || '').startsWith('https://leopard-x.memofun.net/c/') && !temporaryConversation(url);
  function signature(job) {
    const imageManifest = (job.images || []).map(image => [image.name || '', image.role || '', Number(image.byteSize) || 0]);
    const value = JSON.stringify([job.prompt,job.siteModel,job.modelOptions,job.materialKey || imageManifest,job.aspectRatio]); let hash = 2166136261;
    for (let index=0;index<value.length;index++) hash = Math.imul(hash ^ value.charCodeAt(index),16777619);
    return String(hash >>> 0);
  }
  async function collect(job, journal) {
    const image = await waitFor(async () => {
      const users = userMessages();
      const ownedUser = users.find(item => normalized(textValue(item)) === journal.promptMarker || normalized(textValue(item)).startsWith(journal.promptMarker));
      if (!journal.conversationUrl && location.pathname.startsWith('/c/')) { journal.conversationUrl = location.href; await journalSave(job.taskKey,journal); }
      if (journal.conversationUrl && location.href !== journal.conversationUrl) {
        if (temporaryConversation(journal.conversationUrl) && canonicalConversation(location.href)) {
          // The site replaces /c/WEB:<uuid> with a server conversation ID after
          // submission. Adopt it only after our original user message is found.
          if (!ownedUser) return null;
          journal.conversationUrl=location.href;await journalSave(job.taskKey,journal);
        } else throw new Error('[LEOPARD_CONVERSATION] 页面离开原任务会话；重试会恢复原会话');
      }
      if (!ownedUser) return null;
      const nextUser = users.find(item => !!(ownedUser.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING));
      const following = assistantMessages().filter(item => !!(ownedUser.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) && (!nextUser || !!(item.compareDocumentPosition(nextUser) & Node.DOCUMENT_POSITION_FOLLOWING)));
      const candidates = resultImages(following);
      if (candidates.length && !stopButton()) {
        const candidate = candidates[candidates.length-1];
        const src = candidate.currentSrc || candidate.src;
        if (journal.resultSource === src || (candidate.complete && candidate.naturalWidth >= 128)) return candidate;
      }
      const error = alertText();
      if (error && !stopButton()) throw new Error('[LEOPARD_RESULT] ' + error);
      return null;
    }, 12 * 60 * 1000, '[SUBMISSION_UNKNOWN] Leopard X 已接收任务，但暂未取到结果；重试会恢复原会话，不会重复发送');
    const imageDataUrl = await imageData(image);
    journal.phase = 'done'; journal.resultSource = image.currentSrc || image.src; await journalSave(job.taskKey,journal);
    return {success:true,imageDataUrl,siteModel:journal.siteModel,conversationUrl:location.href,width:image.naturalWidth,height:image.naturalHeight};
  }
  async function run(job) {
    const materialOnly = !!job.materialOnly;
    const continuous = job.uploadMode === 'continuous';
    if (!job.siteModel || (materialOnly && !continuous) || (!materialOnly && (!job.prompt?.trim() || (!continuous && !job.images?.length) || (continuous && !job.materialKey) || !job.taskKey))) throw new Error('[LEOPARD_TASK] 任务缺少模型、提示词、图片或恢复编号');
    await waitFor(() => textbox() && visible(textbox()),30000,'[LEOPARD_LOGIN] 请先登录 Leopard X');
    if (materialOnly) {
      await globalThis.IantoMaterialSession.prepare(job, {
        status: text => progress(job, text), upload,
        reset: async () => {
          for (const button of Array.from(composer()?.querySelectorAll('button[aria-label*="Remove"],button[aria-label*="移除"],button[aria-label*="删除"]') || [])) if (visible(button)) button.click();
          fill(textbox(), ''); await waitFor(() => !attachments().length,10000,'[MATERIAL_SETUP] 上一批素材附件尚未清空');
        },
        replies: assistantMessages, busy: () => !!stopButton(),
        send: async text => {
          const box = textbox(); fill(box, text);
          await waitFor(() => {const button=sendButton();return button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true';},60000,'[MATERIAL_SETUP] 素材上传未就绪');
          sendButton().click();
          await waitFor(() => userMessages().some(item => normalized(textValue(item)).includes(normalized(text))),35000,'[MATERIAL_SETUP] Leopard X 未确认素材登记消息，请检查原会话');
        }
      });
      return {success:true,materialRegistered:true,conversationUrl:location.href};
    }
    const fingerprint = signature(job);
    let journal = await journalRead(job.taskKey);
    if (journal && journal.signature !== fingerprint) throw new Error('[LEOPARD_TASK] 恢复任务与原提示词或模型不一致，请重新发起该图片');
    if (journal && ['submitting','submitted','done'].includes(journal.phase)) {
      if (!journal.conversationUrl || (location.href !== journal.conversationUrl && !(temporaryConversation(journal.conversationUrl) && canonicalConversation(location.href)))) throw new Error('[SUBMISSION_UNKNOWN] 未进入原会话，请重试恢复；未重复发送');
      progress(job,'正在恢复 Leopard X 原会话并取图（不会重复提交）');
      return collect(job,journal);
    }
    if (stopButton()) throw new Error('[LEOPARD_BUSY] 网页仍在处理上一条任务');
    if (journal?.phase === 'prepared') {
      const draft = normalized(textValue(textbox()));
      if (draft && draft !== normalized(job.prompt)) throw new Error('[LEOPARD_DRAFT] 草稿被修改，请先确认，系统未清理人工内容');
      for (const button of Array.from(composer()?.querySelectorAll('button[aria-label*="Remove"],button[aria-label*="移除"],button[aria-label*="删除"]') || [])) if (visible(button)) button.click();
      fill(textbox(),'');
      await waitFor(() => !attachments().length,10000,'[LEOPARD_DRAFT] 上次未提交的附件未能清理');
    }
    if (normalized(textValue(textbox()))) throw new Error('[LEOPARD_DRAFT] 输入框已有未发送内容，请先确认草稿');
    progress(job,'正在选择 Leopard X 站内模型：'+job.siteModel);
    const selectedModelText = await selectModel(job.siteModel,job.modelOptions);
    if (job.uploadMode === 'continuous') {
      await globalThis.IantoMaterialSession.prepare(job, {
        status: text => progress(job, text), upload,
        reset: async () => {
          for (const button of Array.from(composer()?.querySelectorAll('button[aria-label*="Remove"],button[aria-label*="移除"],button[aria-label*="删除"]') || [])) if (visible(button)) button.click();
          fill(textbox(), ''); await waitFor(() => !attachments().length,10000,'[MATERIAL_SETUP] 上一批素材附件尚未清空');
        },
        replies: assistantMessages, busy: () => !!stopButton(),
        send: async text => {
          const box = textbox(); fill(box, text);
          await waitFor(() => {const button=sendButton();return button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true';},60000,'[MATERIAL_SETUP] 素材上传未就绪');
          sendButton().click();
          await waitFor(() => userMessages().some(item => normalized(textValue(item)).includes(normalized(text))),35000,'[MATERIAL_SETUP] Leopard X 未确认素材登记消息，请检查原会话');
        }
      });
    }
    journal = { phase:'prepared',signature:fingerprint,siteModel:job.siteModel,promptMarker:normalized(job.prompt),conversationUrl:location.pathname.startsWith('/c/')?location.href:null };
    await journalSave(job.taskKey,journal);
    progress(job,'正在上传 '+job.images.length+' 张图片至 Leopard X');
    if (job.uploadMode !== 'continuous') await upload(job.images);
    const input = textbox(); fill(input,job.prompt);
    await waitFor(() => normalized(textValue(input)) === normalized(job.prompt),10000,'[LEOPARD_PROMPT] 提示词未完整写入');
    await waitFor(() => {const button=sendButton();return button&&!button.disabled&&button.getAttribute('aria-disabled')!=='true'&&attachments().length===(job.uploadMode==='continuous'?0:job.images.length);},60000,'[LEOPARD_UPLOAD] 上传未就绪，未发送提示词');
    if (normalized(modelTrigger()?.textContent) !== selectedModelText) throw new Error('[MODEL] 发送前模型或思考档位被更改，任务暂停');
    journal.phase='submitting'; await journalSave(job.taskKey,journal);
    sendButton().click(); // Persist before this one authoritative click. Never auto-submit twice.
    await waitFor(async () => {
      if (location.pathname.startsWith('/c/')) journal.conversationUrl=location.href;
      if (userMessages().some(item=>normalized(textValue(item)).startsWith(journal.promptMarker))) {
        journal.phase='submitted'; await journalSave(job.taskKey,journal); return true;
      }
      if (journal.conversationUrl) await journalSave(job.taskKey,journal);
      return false;
    },35000,'[SUBMISSION_UNKNOWN] 点击发送后状态不明确，请检查 Leopard X 原会话；系统不会再次点击');
    progress(job,'Leopard X 已接收任务，正在等待生成图片');
    return collect(job,journal);
  }
  chrome.runtime.onMessage.addListener((request,_sender,reply) => {
    if (request?.action==='leopardWebWorkerPing') {reply({ready:true,provider:'leopard',protocolVersion:PROTOCOL,workerBuild:BUILD,continuousMaterials:!!globalThis.IantoMaterialSession,hasTextbox:!!textbox()});return false;}
    if (request?.action==='leopardWebListModels') {
      if (active) {reply({success:false,error:'[PROVIDER_BUSY] Leopard X 正在作图'});return false;}
      active=true; listModels().then(models=>reply({success:true,models})).catch(cause=>reply({success:false,error:cause.message})).finally(()=>{active=false;}); return true;
    }
    if (request?.action!=='runLeopardWebImageJob') return false;
    if (request.provider!=='leopard'||request.backgroundBuild!==BUILD||request.protocolVersion!==PROTOCOL) {reply({accepted:false,error:'[WORKER_VERSION] Leopard X 执行脚本版本不匹配'});return false;}
    if (active) {reply({accepted:false,error:'[PROVIDER_BUSY] Leopard X 页面正在处理任务'});return false;}
    active=true; reply({accepted:true,provider:'leopard',jobId:request.jobId});
    const heartbeat=()=>send({action:'webImageJobHeartbeat',provider:'leopard',jobId:request.jobId}).catch(()=>{});
    heartbeat(); const timer=setInterval(heartbeat,15000);
    run(request).catch(cause=>({success:false,error:cause.message,conversationUrl:location.href})).then(result=>send({action:'geminiWebJobResult',jobId:request.jobId,result})).catch(console.error).finally(()=>{clearInterval(timer);active=false;});
    return false;
  });
})();
