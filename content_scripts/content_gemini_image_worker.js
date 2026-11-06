(function () {
  'use strict';
  const WORKER_BUILD = '2026-11-06.1';
  const PROTOCOL_VERSION = 2;

  if (globalThis.__iantoGeminiImageWorkerLoaded) return;
  globalThis.__iantoGeminiImageWorkerLoaded = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let jobQueue = Promise.resolve();
  let beforeSources = new Set();
  let submittedBefore = 0;
  let activeJobId = null;
  let activeOriginTabId = null;

  function visible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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

  function findTextbox() {
    const selectors = [
      'div.ql-editor[contenteditable="true"][role="textbox"]',
      'rich-textarea [contenteditable]',
      '[contenteditable="true"][role="textbox"][aria-label*="Gemini"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      '[contenteditable="plaintext-only"]',
      'textarea'
    ];
    for (const selector of selectors) {
      const element = queryAllDeep(selector).find((candidate) =>
        visible(candidate) && !candidate.closest('header, nav, .sidebar, .navigation-drawer'));
      if (element) return element;
    }
    return null;
  }

  function findButton(selectors, textMatches) {
    for (const selector of selectors) {
      const element = queryAllDeep(selector).find(visible);
      if (element) return element;
    }
    if (textMatches?.length) {
      const buttons = queryAllDeep('button, [role="menuitem"], [role="menuitemcheckbox"]');
      for (const btn of buttons) {
        if (!visible(btn)) continue;
        const text = btn.textContent.trim();
        if (textMatches.some((match) => text.includes(match))) return btn;
      }
    }
    return null;
  }

  function findSendButton() {
    return queryAllDeep('button[data-test-id="send-button"], button[data-testid="send-button"], button[aria-label*="Send message"], button[aria-label*="发送提示词"], button[aria-label*="Send"], button[aria-label*="发送"], button.send-button, button.send-button-container, button:has(mat-icon[data-mat-icon-name="send"]), button:has(.send-icon)')
      .find((candidate) => visible(candidate) && !candidate.closest('.navigation-drawer'));
  }

  function findStopButton() {
    return findButton([
      'button[aria-label*="停止生成"]',
      'button[aria-label*="Stop generating"]',
      'button[aria-label*="停止"]',
      'button[aria-label*="Stop"]'
    ]);
  }

  function generationInProgress() {
    const stopBtn = findStopButton();
    if (stopBtn && visible(stopBtn)) return true;
    const responseRoots = queryAllDeep('model-response, [data-message-author-role="assistant"], [data-author="model"]');
    return responseRoots.some((root) => {
      if (!visible(root)) return false;
      const text = root.textContent || '';
      if (/Creating your image|正在生成(?:图片|图像)|正在创作(?:图片|图像)/i.test(text)) return true;
      return queryAllDeep('mat-progress-spinner, [role="progressbar"], .loading-spinner, .sparkle-loading', root)
        .some(visible);
    });
  }

  function pageErrorText() {
    const text = queryAllDeep('.error-message, .error-text, [role="alert"]')
      .filter(visible)
      .map((node) => (node.textContent || '').trim())
      .filter(Boolean)
      .join('\n');
    if (/登录|sign in|log in/i.test(text)) return 'Gemini 网页要求重新登录 Google 账号';
    if (/无法生成|不能生成|couldn.?t generate|unable to generate/i.test(text)) return text.slice(0, 300);
    return '';
  }

  function updateStatus(text, type) {
    chrome.runtime.sendMessage({
      action: 'geminiImageWorkerStatus',
      jobId: activeJobId,
      originTabId: activeOriginTabId,
      status: text,
      type
    }).catch(() => {});
    console.log('[Ianto Gemini Image Worker]', text);
  }

  function renewJobLease(job) {
    chrome.runtime.sendMessage({
      action: 'webImageJobHeartbeat',
      provider: 'gemini',
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
    throw new Error(errorMessage || '等待 Gemini 网页响应超时');
  }

  function findComposerRoot() {
    const textbox = findTextbox();
    return textbox?.closest('[xapfileselectordropzone], .text-input-field, .simplified-input-area, [data-type="unified-composer"], form, input-area-v2, input-area, .input-area-v2, .input-area-container')
      || queryAllDeep('[xapfileselectordropzone], .text-input-field, .simplified-input-area, input-area-v2, input-area, [data-type="unified-composer"], .input-area-v2, .input-area-container').find(visible)
      || document;
  }

  function attachmentCount() {
    const selectors = [
      'uploader-file-card', 'uploader-file-preview', '.uploader-file-preview', '.file-preview',
      '.attachment-preview', 'file-attachment-chip', 'image-attachment', '.image-attachment',
      '[data-test-id*="attachment"]', '[data-test-id*="uploaded"]', '[data-test-id*="file"]',
      '[data-testid*="attachment"]', '[data-testid*="file"]', '[class*="file-thumbnail"]',
      'button[aria-label*="移除"]', 'button[aria-label*="Remove"]', 'button[aria-label*="删除"]',
      'button[aria-label*="Delete"]', 'img[src^="blob:"]', 'img[src^="data:"]'
    ];
    const root = findComposerRoot();
    return Math.max(0, ...selectors.map((selector) => {
      try { return Array.from(root.querySelectorAll(selector)).filter(visible).length; } catch (_) { return 0; }
    }));
  }

  async function dataUrlToFile(image, index) {
    const response = await fetch(image.dataUrl);
    const blob = await response.blob();
    const extension = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/webp' ? 'webp' : 'png';
    const baseName = String(image.name || `${String(index + 1).padStart(2, '0')}-${image.role || 'image'}`)
      .replace(/[^a-zA-Z0-9._-]+/g, '-');
    const stem = baseName.replace(/\.[a-z0-9]+$/i, '') || `${String(index + 1).padStart(2, '0')}-${image.role || 'image'}`;
    return new File([blob], `${stem}.${extension}`, {
      type: blob.type || 'image/png',
      lastModified: Date.now()
    });
  }

  function setFilesOnInput(input, files) {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')?.set;
    if (setter) setter.call(input, transfer.files);
    else input.files = transfer.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }

  function findPlusButton() {
    return findButton([
      'button[aria-label*="上传和工具"]',
      'button[aria-label*="添加文件"]',
      'button.menu-placeholder-button',
      'button:has(mat-icon[data-mat-icon-name="plus"])'
    ], ['上传', '添加', 'Upload', 'Add', 'tools']);
  }

  function closeUploadMenu() {
    const plusButton = findPlusButton();
    if (plusButton?.getAttribute('aria-expanded') === 'true') plusButton.click();
  }

  function findUploadFileButton() {
    const exact = queryAllDeep('button[data-test-id="local-images-files-uploader-button"]')
      .find(visible);
    if (exact) return exact;
    return queryAllDeep('button, [role="menuitem"]')
      .find((candidate) => {
        if (!visible(candidate)) return false;
        const label = `${candidate.getAttribute('aria-label') || ''} ${candidate.textContent || ''}`
          .replace(/\s+/g, ' ')
          .trim();
        return /^(?:上传文件|Upload files?)(?:\.|\s|$)/i.test(label);
      }) || null;
  }

  function fileInputCandidates(uploadButton) {
    const candidates = [];
    const add = (input) => {
      if (input instanceof HTMLInputElement && input.type === 'file' && !input.disabled && !candidates.includes(input)) {
        candidates.push(input);
      }
    };
    uploadButton?.querySelectorAll('input[type="file"]').forEach(add);
    uploadButton?.parentElement?.querySelectorAll('input[type="file"]').forEach(add);
    uploadButton?.parentElement?.parentElement?.querySelectorAll('input[type="file"]').forEach(add);
    queryAllDeep('input[type="file"]').forEach(add);
    return candidates;
  }

  async function uploadImages(images) {
    if (!Array.isArray(images) || !images.length) return;
    if (images.some((image) => typeof image?.dataUrl !== 'string' || !image.dataUrl.startsWith('data:image/'))) {
      throw new Error('待上传图片数据无效，提示词没有发送');
    }
    updateStatus(`📸 [1/3] 正在上传参考图片（共 ${images.length} 张）...`, 'info');
    const before = attachmentCount();
    const expected = before + images.length;

    const files = await Promise.all(images.map(dataUrlToFile));

    // 展开菜单只是为了让 Gemini 创建“上传文件”关联的隐藏 input。
    // 像 Playwright.setInputFiles 一样直接赋值，不点击上传行，因此原生
    // 选择器没有任何打开机会；也不下载临时文件、不使用剪贴板。
    const plusButton = await waitFor(findPlusButton, 15000, 300,
      '找不到 Gemini 的“上传和工具”按钮');
    if (plusButton.getAttribute('aria-expanded') !== 'true') plusButton.click();
    const uploadButton = await waitFor(findUploadFileButton, 10000, 200,
      'Gemini 上传菜单已展开，但没有找到“上传文件”按钮');

    try {
      const input = await waitFor(() => fileInputCandidates(uploadButton)[0], 5000, 100,
        '“上传文件”入口没有关联可用的文件输入框');
      setFilesOnInput(input, files);
    } finally {
      closeUploadMenu();
    }

    // 不允许“没有附件也继续发提示词”。只有缩略图真实出现才进入发送阶段。
    await waitFor(() => attachmentCount() >= expected, 30000, 250,
      `Gemini 没有接收上传图片（期望 ${images.length} 张），提示词未发送`);
    await sleep(500);
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
      if (textbox.innerHTML) textbox.innerHTML = '';
      textbox.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    }
  }

  function fillTextbox(element, text) {
    element.focus();
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (_) {}
    let handled = false;
    try {
      handled = document.execCommand('insertText', false, text);
    } catch (_) {}
    if (!handled || !element.textContent.trim()) {
      element.innerHTML = '';
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const p = document.createElement('p');
        p.textContent = lines[i] || '';
        element.appendChild(p);
      }
    }
    element.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: ' ', code: 'Space' }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: ' ', code: 'Space' }));
  }

  function textboxValue(element) {
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value || '';
    return element?.textContent || '';
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

  function imageCandidates() {
    const images = new Set();
    const responseRoots = queryAllDeep('model-response, [data-message-author-role="assistant"], [data-author="model"]');
    const allImgs = responseRoots.flatMap((root) => queryAllDeep('img', root));
    for (const img of allImgs) {
      const src = img.currentSrc || img.src || '';
      if (!src || src.startsWith('data:image/svg')) continue;
      if (img.closest('input-area-v2, input-area, form, rich-textarea, user-avatar, .user-avatar, .nav, .sidebar, [data-message-author-role="user"]')) continue;
      if (img.naturalWidth > 0 && img.naturalWidth < 120) continue;
      images.add(img);
    }
    return Array.from(images);
  }

  function normalizeMessageText(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
  }

  function submittedPromptCount(promptText) {
    const msgs = queryAllDeep('user-query, .user-message, [data-author="user"], message-content, [data-message-author-role="user"]');
    const normalizedTarget = normalizeMessageText(promptText);
    const snippet = normalizedTarget.slice(0, 30);
    let count = 0;
    for (const msg of msgs) {
      if (snippet && normalizeMessageText(msg.textContent).includes(snippet)) {
        count++;
      }
    }
    return count;
  }

  async function runJob(job) {
    activeJobId = job.jobId || null;
    activeOriginTabId = Number.isInteger(job.originTabId) ? job.originTabId : null;
    const prompt = String(job.prompt || '').trim();
    if (!prompt && !job.materialOnly) throw new Error('Gemini 作图提示词为空');
    updateStatus('⏳ 正在等待 Gemini 网页空闲...', 'info');
    await waitFor(() => !generationInProgress(), 12 * 60 * 1000, 300,
      '上一张图片仍未完成，等待 Gemini 网页空闲超时');
    const beforeError = pageErrorText();

    let textbox = await waitFor(findTextbox, 30000, 250).catch(() => null);
    if (!textbox) throw new Error('找不到 Gemini 的输入框');

    if (job.uploadMode === 'continuous') {
      await globalThis.IantoMaterialSession.prepare(job, {
        status: text => updateStatus(text, 'info'), upload: uploadImages,
        reset: async () => { clearComposer(findTextbox()); await sleep(400); },
        replies: () => queryAllDeep('model-response, [data-message-author-role="assistant"], [data-author="model"]'), busy: generationInProgress,
        send: async text => {
          const box = await waitFor(findTextbox, 30000, 250); fillTextbox(box, text);
          const before = submittedPromptCount(text);
          await waitFor(() => { const button = findSendButton(); return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'; }, 60000, 200, '[MATERIAL_SETUP] 素材上传未就绪');
          if (!await submitPrompt(box, text, before)) throw new Error('[MATERIAL_SETUP] Gemini 未确认素材登记消息，请检查原会话');
        }
      });
      if (job.materialOnly) return { success: true, materialRegistered: true, conversationUrl: location.href };
      textbox = await waitFor(findTextbox, 30000, 250);
    }

    clearComposer(textbox);
    await sleep(400);

    submittedBefore = submittedPromptCount(prompt);
    beforeSources = new Set(imageCandidates().map((image) => image.currentSrc || image.src));

    if (job.uploadMode !== 'continuous') await uploadImages(job.images || []);

    updateStatus('✅ [2/3] 正在填入提示词并发送...', 'success');
    fillTextbox(textbox, prompt);
    await sleep(1000);

    await waitFor(() => {
      const button = findSendButton();
      if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true' || button.classList.contains('disabled')) return null;
      return button;
    }, 60000, 200, '图片仍在上传或 Gemini 的发送按钮不可用');

    updateStatus('⏳ [3/3] 正在等待 Gemini 图像生成出图...', 'info');
    const submitted = await submitPrompt(textbox, prompt, submittedBefore);
    if (!submitted) throw new Error('Gemini 没有接收这条提示词，任务已停止；不会继续提交下一张');

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
    }, 12 * 60 * 1000, 200, '等待 Gemini 网页生成最终图片超时');

    let dataUrl;
    const src = image.currentSrc || image.src || '';
    if (src.startsWith('data:image/')) {
      dataUrl = src;
    } else {
      // 1. 尝试页面端 fetch
      try {
        const response = await fetch(src, { cache: 'force-cache' });
        if (response.ok) {
          const blob = await response.blob();
          if (blob && blob.size > 1000) {
            dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(new Error('无法读取 Gemini 生成的图片'));
              reader.readAsDataURL(blob);
            });
          }
        }
      } catch (_) {}

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
          canvas.getContext('2d').drawImage(image, 0, 0);
          dataUrl = canvas.toDataURL('image/webp', 0.90);
        } catch (_) {}
      }
    }

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('无法读取 Gemini 生成的图片数据（受跨域保护限制）');
    }
    updateStatus(`🎉 图片已生成并返回 (${image.naturalWidth}x${image.naturalHeight})`, 'success');
    return {
      success: true,
      imageDataUrl: dataUrl,
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
    if (request?.action === "geminiWebWorkerPing") {
      sendResponse({ ready: true, provider: 'gemini', protocolVersion: PROTOCOL_VERSION, workerBuild: WORKER_BUILD, continuousMaterials: !!globalThis.IantoMaterialSession, url: location.href, hasTextbox: !!findTextbox() });
      return false;
    }
    if (request?.action !== "runGeminiWebImageJob") return false;

    if (request.provider !== 'gemini' || request.protocolVersion !== PROTOCOL_VERSION || request.backgroundBuild !== WORKER_BUILD) {
      sendResponse({ accepted: false, error: '[WORKER_VERSION] gemini 执行脚本与后台不兼容：' + WORKER_BUILD });
      return false;
    }
    sendResponse({ accepted: true, jobId: request.jobId, provider: 'gemini', workerBuild: WORKER_BUILD });
    jobQueue = jobQueue
      .catch(() => undefined)
      .then(() => runWithHeartbeat(request))
      .then((result) => report(request.jobId, result))
      .catch((error) => report(request.jobId, {
          success: false,
          error: error?.message || 'Gemini 网页自动化失败',
          conversationUrl: location.href
        }))
      .finally(() => {
        activeJobId = null;
        activeOriginTabId = null;
      });
    return false;
  });

})();
