(function () {
  'use strict';
  const WORKER_BUILD = '2026-11-06.1';
  const PROTOCOL_VERSION = 2;

  if (globalThis.__iantoChatGPTImageWorkerLoaded) return;
  globalThis.__iantoChatGPTImageWorkerLoaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let jobQueue = Promise.resolve();
  let activeJobId = null;
  let activeOriginTabId = null;

  function renewJobLease(job) {
    chrome.runtime.sendMessage({
      action: 'webImageJobHeartbeat',
      provider: 'chatgpt',
      jobId: job.jobId
    }, () => { void chrome.runtime.lastError; });
  }

  async function runWithHeartbeat(job) {
    renewJobLease(job);
    const timer = setInterval(() => renewJobLease(job), 15000);
    try { return await runJob(job); }
    finally { clearInterval(timer); }
  }

  async function waitFor(check, timeoutMs, intervalMs, errorMessage) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      try {
        const value = check();
        if (value) return value;
      } catch (_) {}
      await sleep(intervalMs || 300);
    }
    throw new Error(errorMessage || '等待 ChatGPT 网页响应超时');
  }

  function visible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }

  function queryAllDeep(selector, startRoot) {
    const results = [];
    const pending = [startRoot || document];
    const visited = new Set();
    while (pending.length) {
      const root = pending.shift();
      if (!root || visited.has(root)) continue;
      visited.add(root);
      try {
        results.push(...root.querySelectorAll(selector));
        for (const element of root.querySelectorAll('*')) {
          if (element.shadowRoot) pending.push(element.shadowRoot);
        }
      } catch (_) {}
    }
    return results;
  }

  function findImageFileInput() {
    return queryAllDeep('input[type="file"]')
      .find((candidate) => !candidate.disabled && (!candidate.accept || /image|\*/i.test(candidate.accept))) || null;
  }

  function findTextbox() {
    const selectors = [
      '#prompt-textarea',
      'div[contenteditable="true"][data-virtualkeyboard="true"]',
      'textarea[placeholder*="Message"]',
      'textarea[placeholder*="询问"]',
      'div.ql-editor[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"][role="textbox"][aria-label*="Gemini"]',
      '[contenteditable="true"][role="textbox"]'
    ];
    for (const selector of selectors) {
      const element = Array.from(document.querySelectorAll(selector)).find(visible);
      if (element) return element;
    }
    return null;
  }

  function findButton(selectors, textMatches) {
    for (const selector of selectors) {
      const element = Array.from(document.querySelectorAll(selector)).find(visible);
      if (element) return element;
    }
    if (textMatches?.length) {
      return Array.from(document.querySelectorAll('button,[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]'))
        .find((element) => visible(element) && textMatches.some((text) => (element.textContent || '').trim().includes(text)));
    }
    return null;
  }

  async function ensureImageMode() {
    // 尝试寻找 Chat/Work 切换按钮并点击 Chat
    const buttons = Array.from(document.querySelectorAll('button'));
    const chatBtn = buttons.find(b => b.textContent.trim() === 'Chat');
    if (chatBtn && chatBtn.getAttribute('aria-selected') !== 'true') {
        chatBtn.click();
        await new Promise(r => setTimeout(r, 500));
    }
  }

  async function setAspectRatio(aspectRatio) {
    return { applied: false, source: 'prompt', ratio: String(aspectRatio || 'auto') };
  }

  async function resolveWebsiteAspectRatio(requestedRatio, images) {
    // ChatGPT 网页没有稳定的比例控件，统一由最终可见提示词控制。
    return requestedRatio || 'auto';
  }

  async function dataUrlToFile(image, index) {
    const response = await fetch(image.dataUrl);
    const blob = await response.blob();
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    const baseName = String(image.name || `${String(index + 1).padStart(2, '0')}-${image.role || 'image'}`)
      .replace(/[^a-zA-Z0-9._-]+/g, '-');
    const stem = baseName.replace(/\.[a-z0-9]+$/i, '') || `${String(index + 1).padStart(2, '0')}-${image.role || 'image'}`;
    const name = `${stem}.${extension}`;
    return new File([blob], name, { type: blob.type || 'image/png', lastModified: Date.now() });
  }

  function findComposerRoot() {
    const textbox = findTextbox();
    return textbox?.closest('[data-type="unified-composer"]')
      || textbox?.closest('form')
      || textbox?.closest('input-area-v2')
      || textbox?.closest('input-area')
      || textbox?.closest('form')
      || textbox?.closest('.input-area-container')
      || document.querySelector('input-area-v2')
      || document;
  }

  function attachmentCount() {
    const selectors = [
      'uploader-file-card',
      'uploader-file-preview',
      '.uploader-file-preview',
      '.file-preview',
      '.attachment-preview',
      'image-attachment',
      '.image-attachment',
      '[data-test-id*="attachment"]',
      '[data-test-id*="uploaded"]',
      '[data-test-id*="file"]',
      '[data-testid*="attachment"]',
      '[data-testid*="file"]',
      '[class*="file-thumbnail"]',
      'button[aria-label*="移除"]',
      'button[aria-label*="Remove"]',
      'button[aria-label*="Remove file"]',
      'button[aria-label*="删除"]',
      'button[aria-label*="Delete"]',
      'input-area-v2 img[src^="blob:"]',
      'input-area-v2 img[src^="data:"]',
      'rich-textarea img[src^="blob:"]',
      'rich-textarea img[src^="data:"]',
      '.input-area-container img[src^="blob:"]',
      '.input-area-container img[src^="data:"]',
      'img[src^="blob:"]',
      'img[src^="data:"]'
    ];
    const root = findComposerRoot();
    const counts = selectors.map((selector) => {
      try {
        return Array.from(root.querySelectorAll(selector)).filter(visible).length;
      } catch (_) {
        return 0;
      }
    });
    return Math.max(0, ...counts);
  }

  function createDataTransfer(files) {
    const dt = new DataTransfer();
    files.forEach((file) => dt.items.add(file));
    return dt;
  }

  function setFilesOnInput(input, files) {
    const transfer = createDataTransfer(files);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, transfer.files);
    else input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function closeUploadMenu() {
    const target = document.activeElement || document.body;
    for (const type of ['keydown', 'keyup']) {
      target?.dispatchEvent(new KeyboardEvent(type, {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        bubbles: true,
        cancelable: true,
        composed: true
      }));
    }
  }

  function dispatchPasteWithFiles(target, files) {
    if (!target) return;
    try {
      const transfer = createDataTransfer(files);
      const event = new Event('paste', {
        bubbles: true,
        cancelable: true,
        composed: true
      });
      Object.defineProperty(event, 'clipboardData', {
        value: transfer,
        enumerable: true
      });
      target.focus();
      target.dispatchEvent(event);
    } catch (e) {
      console.warn('dispatchPasteWithFiles failed:', e);
    }
  }

  function dispatchDragDropWithFiles(target, files) {
    if (!target) return;
    try {
      const transfer = createDataTransfer(files);
      for (const type of ['dragenter', 'dragover', 'drop']) {
        const event = new Event(type, {
          bubbles: true,
          cancelable: true,
          composed: true
        });
        Object.defineProperty(event, 'dataTransfer', {
          value: transfer,
          enumerable: true
        });
        target.dispatchEvent(event);
      }
    } catch (e) {
      console.warn('dispatchDragDropWithFiles failed on target:', target, e);
    }
  }

  async function uploadImages(images) {
    const files = await Promise.all(images.map(dataUrlToFile));
    if (!files.length) return;
    const before = attachmentCount();
    const expected = before + files.length;
    const textbox = findTextbox();

    // 1. 先找 ChatGPT 的真实文件输入框；没有时再打开“+”菜单后重查。
    let input = findImageFileInput();
    if (!input) {
      const plusButton = findButton([
        'button[aria-label*="上传"]',
        'button[aria-label*="添加"]',
        'button[aria-label*="Upload"]',
        'button[aria-label*="Add"]',
        'button[aria-label*="Attach"]',
        'button[data-testid="composer-plus-btn"]',
        'button[aria-label*="tools"]',
        'button[aria-label*="工具"]',
        'button.add-button'
      ]);
      if (plusButton) {
        plusButton.click();
        try {
          input = await waitFor(findImageFileInput, 3000, 150,
            'ChatGPT 上传菜单内没有出现文件输入框');
        } catch (_) {}
      }
    }

    if (input) setFilesOnInput(input, files);

    await sleep(1200);
    let current = attachmentCount();
    if (current > before && current < expected) {
      await waitFor(() => attachmentCount() >= expected, 30000, 300,
        `ChatGPT 只接收到 ${attachmentCount() - before}/${files.length} 张图片，任务已停止，未发送提示词`);
      current = attachmentCount();
    }

    // 2. 文件输入框路径没有产生附件时，关闭菜单，再分别尝试粘贴和拖放；每种方法只执行一次。
    if (current === before) {
      closeUploadMenu();
      await sleep(250);
      if (textbox) dispatchPasteWithFiles(textbox, files);
      await sleep(1200);
      current = attachmentCount();
    }
    if (current === before) {
      const dropTarget = textbox?.closest('[data-type="unified-composer"]') || textbox?.closest('form') || textbox;
      dispatchDragDropWithFiles(dropTarget, files);
    }

    // 必须确认请求的每一张图片都进入当前输入区；一张都不能少。
    await waitFor(() => attachmentCount() >= expected, 30000, 300,
      `ChatGPT 网页未完整接收图片（需要 ${files.length} 张）。任务已停止，提示词没有发送。`);
    current = attachmentCount();
    if (current > expected) {
      throw new Error(`ChatGPT 输入区出现重复附件（预期 ${files.length} 张，实际新增 ${current - before} 张），任务已停止`);
    }
    await sleep(1500);
    if (attachmentCount() !== expected) {
      throw new Error('ChatGPT 图片附件数量在上传过程中发生变化，任务已停止，提示词没有发送');
    }
  }

  function clearComposer(textbox) {
    try {
      const root = findComposerRoot();
      const removeButtons = root.querySelectorAll('button[aria-label*="移除"], button[aria-label*="Remove"], button[aria-label*="删除"], button[aria-label*="Delete"], .remove-button, [data-test-id*="delete"], [data-test-id*="remove"], [data-testid*="delete"], [data-testid*="remove"]');
      removeButtons.forEach((btn) => {
        if (visible(btn)) btn.click();
      });
    } catch (_) {}
    if (textbox) {
      textbox.focus();
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(textbox);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
      } catch (_) {}
      if (textbox instanceof HTMLTextAreaElement || textbox instanceof HTMLInputElement) {
        textbox.value = '';
      } else if (textbox.innerHTML) {
        textbox.innerHTML = '';
      }
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    }
  }
  function fillPrompt(textbox, prompt) {
    textbox.focus();
    if (textbox instanceof HTMLTextAreaElement || textbox instanceof HTMLInputElement) {
      const prototype = textbox instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(textbox, prompt);
      else textbox.value = prompt;
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
      textbox.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents(textbox);
    selection.removeAllRanges();
    selection.addRange(range);
    let inserted = false;
    try { inserted = document.execCommand('insertText', false, prompt); } catch (_) {}
    if (!inserted || (textbox.textContent || '').trim() !== prompt.trim()) {
      textbox.textContent = prompt;
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
    }
    textbox.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function textboxValue(textbox) {
    if (textbox instanceof HTMLTextAreaElement || textbox instanceof HTMLInputElement) return textbox.value || '';
    return textbox?.textContent || '';
  }

  function imageCandidates() {
    const images = new Set();
    const allImgs = queryAllDeep('img');
    for (const img of allImgs) {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:image/svg')) continue;
      // 排除输入区与头像、侧边栏，以及用户自己发送的消息气泡里的图
      if (img.closest('form, [data-testid="composer-speech-button"], .user-avatar, [data-testid="user-avatar"], nav, header, [data-message-author-role="user"]')) continue;
      if (img.naturalWidth > 0 && img.naturalWidth < 120 && img.naturalHeight < 120) continue;
      images.add(img);
    }
    return Array.from(images);
  }

  function findSendButton() {
    return findButton([
      'button[data-testid="send-button"]',
      'button[data-test-id="send-button"]',
      'button.send-button',
      'button[aria-label="发送消息"]',
      'button[aria-label*="发送"]',
      'button[aria-label="Send message"]',
      'button[aria-label*="Send"]'
    ]);
  }

  function findStopButton() {
    return findButton([
      'button[data-testid="stop-button"]',
      'button[data-test-id="stop-button"]',
      'button[aria-label="停止生成"]',
      'button[aria-label*="停止响应"]',
      'button[aria-label="Stop response"]',
      'button[aria-label*="Stop generating"]'
    ]);
  }

  function generationInProgress() {
    const stopBtn = findStopButton();
    if (stopBtn && visible(stopBtn)) return true;
    const activeSpinners = queryAllDeep('.result-thinking, [role="progressbar"], .loading-spinner')
      .filter(visible);
    if (activeSpinners.length > 0) return true;
    return false;
  }

  function normalizeMessageText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function submittedPromptCount(prompt) {
    const marker = normalizeMessageText(prompt).slice(0, 100);
    if (!marker) return 0;
    const selectors = [
      'user-query',
      '.user-query',
      '[data-test-id*="user-query"]',
      '[class*="user-query"]',
      '[data-message-author-role="user"]',
      '[data-turn="user"]'
    ];
    const nodes = new Set();
    selectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((node) => nodes.add(node));
      } catch (_) {}
    });
    return Array.from(nodes).filter((node) => normalizeMessageText(node.textContent).includes(marker)).length;
  }

  async function imageToDataUrl(image) {
    const src = image.currentSrc || image.src || '';
    if (src.startsWith('data:image/')) {
      return src;
    }
    let dataUrl = null;
    // 1. 优先直接 fetch 下载完整图片 blob（后台标签页网络请求正常不受阻，彻底绕过 Chrome 后台不解码不渲染的限制！）
    try {
      const response = await fetch(src, { cache: 'force-cache' });
      if (response.ok) {
        const blob = await response.blob();
        if (blob && blob.size > 1000) {
          dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('无法读取 ChatGPT 生成的图片'));
            reader.readAsDataURL(blob);
          });
        }
      }
    } catch (e) {
      console.warn('fetch image failed, fallback:', e);
    }

    // 2. 委托后台 Background 抓取（具备 <all_urls> 权限，彻底绕过网页端 CORS 和画布污染限制！）
    if (!dataUrl) {
      try {
        const bgResult = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'webImageFetchDataUrl', url: src }, (res) => {
            if (chrome.runtime.lastError || !res?.success) resolve(null);
            else resolve(res.dataUrl);
          });
        });
        if (bgResult && bgResult.startsWith('data:image/')) {
          dataUrl = bgResult;
        }
      } catch (_) {}
    }

    // 3. Canvas 兜底（安全 try-catch 防止 Tainted canvas 崩溃）
    if (!dataUrl && image.complete && image.naturalWidth > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
        dataUrl = canvas.toDataURL('image/webp', 0.95);
      } catch (_) {}
    }

    if (dataUrl && dataUrl.startsWith('data:image/')) {
      return dataUrl;
    }
    throw new Error('ChatGPT 生成了图片但未能读取有效图片数据');
  }

  function pageErrorText() {
    const candidates = Array.from(document.querySelectorAll('[role="alert"],.error-message,[data-testid="conversation-turn"]'));
    const text = candidates.filter(visible).map((node) => (node.textContent || '').trim()).filter(Boolean).join('\n');
    if (/登录|sign in|log in/i.test(text)) return 'ChatGPT 网页要求重新登录 OpenAI 账号';
    if (/无法生成|不能生成|couldn.?t generate|unable to generate/i.test(text)) return text.slice(0, 300);
    return '';
  }

  async function submitPrompt(textbox, promptText, beforeCount) {
    const sendButton = findSendButton();
    if (!sendButton || sendButton.disabled || sendButton.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    // 单次精准触发发送：避免在 1.5 秒循环内疯狂连点导致提示词重复发送 3 遍！
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    sendButton.dispatchEvent(new PointerEvent('pointerdown', opts));
    sendButton.dispatchEvent(new MouseEvent('mousedown', opts));
    sendButton.dispatchEvent(new PointerEvent('pointerup', opts));
    sendButton.dispatchEvent(new MouseEvent('mouseup', opts));
    sendButton.click();

    const started = Date.now();
    let retried = false;
    while (Date.now() - started < 35000) {
      if (generationInProgress()) return true;
      const inputCleared = normalizeMessageText(textboxValue(textbox)) === '';
      if (inputCleared && !findSendButton()) return true;
      if (submittedPromptCount(promptText) > beforeCount) return true;

      // 仅在 8 秒后且完全无响应时做一次回车兜底重试，绝不在每次循环反复触发
      if (!retried && Date.now() - started > 8000) {
        retried = true;
        const currentBtn = findSendButton();
        if (currentBtn && !currentBtn.disabled && currentBtn.getAttribute('aria-disabled') !== 'true') {
          textbox.focus();
          textbox.dispatchEvent(new KeyboardEvent('keydown', {
            bubbles: true, cancelable: true, composed: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13
          }));
          textbox.dispatchEvent(new KeyboardEvent('keyup', {
            bubbles: true, cancelable: true, composed: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13
          }));
        }
      }

      await sleep(600);
      if (generationInProgress()) return true;
      if (normalizeMessageText(textboxValue(textbox)) === '' && submittedPromptCount(promptText) > beforeCount) return true;
    }
    return false;
  }

  async function runJob(job) {
    activeJobId = job.jobId || null;
    activeOriginTabId = Number.isInteger(job.originTabId) ? job.originTabId : null;
    await waitFor(() => !generationInProgress(), 12 * 60 * 1000, 300,
      '上一张图片仍未完成，等待 ChatGPT 网页空闲超时');
    let textbox = await waitFor(findTextbox, 30000, 250,
      '找不到 ChatGPT 输入框。请在 Chrome 中打开 ChatGPT 官网并登录自己的 OpenAI 账号');
    if (job.uploadMode === 'continuous') {
      await globalThis.IantoMaterialSession.prepare(job, {
        status: () => {}, upload: uploadImages,
        reset: async () => { clearComposer(findTextbox()); await sleep(400); },
        replies: () => queryAllDeep('[data-message-author-role="assistant"]'), busy: generationInProgress,
        send: async text => {
          const box = await waitFor(findTextbox, 30000, 250); fillPrompt(box, text);
          const before = submittedPromptCount(text);
          await waitFor(() => { const button = findSendButton(); return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'; }, 60000, 200, '[MATERIAL_SETUP] 素材上传未就绪');
          if (!await submitPrompt(box, text, before)) throw new Error('[MATERIAL_SETUP] ChatGPT 未确认素材登记消息，请检查原会话');
        }
      });
      if (job.materialOnly) return { success: true, materialRegistered: true, conversationUrl: location.href };
      textbox = await waitFor(findTextbox, 30000, 250);
    }
    clearComposer(textbox);
    await sleep(400);
    await ensureImageMode();
    const websiteAspectRatio = await resolveWebsiteAspectRatio(job.aspectRatio, job.images || []);
    await setAspectRatio(websiteAspectRatio);

    const beforeSources = new Set(imageCandidates().map((image) => image.currentSrc || image.src));
    const beforeError = pageErrorText();
    const rawPrompt = String(job.prompt || '').trim();
    const prompt = /\$imagegen\b/i.test(rawPrompt) ? rawPrompt : `${rawPrompt}\n\n$imagegen`;
    const submittedBefore = submittedPromptCount(prompt);
    if (job.uploadMode !== 'continuous') await uploadImages(job.images || []);
    fillPrompt(textbox, prompt);
    await waitFor(() => normalizeMessageText(textboxValue(textbox)) === normalizeMessageText(prompt), 10000, 150,
      '提示词没有完整写入 ChatGPT 输入框，任务已停止');

    await waitFor(() => {
      const button = findSendButton();
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return null;
      return button;
    }, 60000, 200, '图片仍在上传或 ChatGPT 的发送按钮不可用，提示词没有发送');

    const submitted = await submitPrompt(textbox, prompt, submittedBefore);
    if (!submitted) {
      throw new Error('ChatGPT 没有接收这条提示词，任务已停止；不会继续提交下一张');
    }

    let newestImage = null;
    const image = await waitFor(() => {
      const candidates = imageCandidates().filter((candidate) => {
        const src = candidate.currentSrc || candidate.src;
        if (!src || beforeSources.has(src)) return false;
        if (candidate.complete && candidate.naturalWidth > 64) return true;
        // 关键修复：如果在后台标签页，Chrome 不对 img 进行解码渲染，naturalWidth 为 0；
        // 只要生成了真实图片 URL，且不是占位/头像/小图标，即视为候选成图，彻底解决后台不回传问题！
        if (/^https?:\/\//.test(src) || src.startsWith('blob:') || (src.startsWith('data:image/') && src.length > 500)) {
          return true;
        }
        return false;
      });
      if (candidates.length) {
        candidates.sort((a, b) => (b.naturalWidth * b.naturalHeight) - (a.naturalWidth * a.naturalHeight));
        newestImage = candidates[0];
      }
      // 只要拿到了成图且已停止生成，必须优先采纳成图返回！不要因为偶发的报错提示把已经做好的图片抛弃！
      if (newestImage && !generationInProgress()) {
        return newestImage;
      }
      const error = pageErrorText();
      if (error && error !== beforeError && !generationInProgress() && !newestImage) {
        throw new Error(error);
      }
      return null;
    }, 12 * 60 * 1000, 200, '等待 ChatGPT 网页生成最终图片超时');

    const imageDataUrl = await imageToDataUrl(image);
    return {
      success: true,
      imageDataUrl,
      conversationUrl: location.href,
      width: image.naturalWidth || 1024,
      height: image.naturalHeight || 1024
    };
  }

  function report(jobId, result) {
    chrome.runtime.sendMessage({
      action: 'geminiWebJobResult',
      jobId,
      result
    }, function () {
      void chrome.runtime.lastError;
    });
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === 'chatgptWebWorkerPing') {
      sendResponse({ ready: true, provider: 'chatgpt', protocolVersion: PROTOCOL_VERSION, workerBuild: WORKER_BUILD, continuousMaterials: !!globalThis.IantoMaterialSession, url: location.href, hasTextbox: !!findTextbox() });
      return false;
    }
    if (request?.action !== 'runChatGPTWebImageJob') return false;

    if (request.provider !== 'chatgpt' || request.protocolVersion !== PROTOCOL_VERSION || request.backgroundBuild !== WORKER_BUILD) {
      sendResponse({ accepted: false, error: '[WORKER_VERSION] chatgpt 执行脚本与后台不兼容：' + WORKER_BUILD });
      return false;
    }
    sendResponse({ accepted: true, jobId: request.jobId, provider: 'chatgpt', workerBuild: WORKER_BUILD });
    jobQueue = jobQueue
      .catch(() => undefined)
      .then(() => runWithHeartbeat(request))
      .then((result) => report(request.jobId, result))
      .catch((error) => report(request.jobId, {
        success: false,
        error: error?.message || 'ChatGPT 网页自动化失败',
        conversationUrl: location.href
      }))
      .finally(() => {
        activeJobId = null;
        activeOriginTabId = null;
      });
    return false;
  });
})();
