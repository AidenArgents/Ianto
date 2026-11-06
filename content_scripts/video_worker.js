/* Calibrated DOM adapter for video websites. Does not call private site APIs,
   read credentials, bypass challenges, guess buttons, or retry paid submits. */
(() => {
  if (globalThis.__vceVideoWorker) return;
  globalThis.__vceVideoWorker = true;
  let running = null, binding = false, panel = null, stopped = false;
  const scopeKey = () => location.origin + location.pathname;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = el => (el?.getAttribute('aria-label') || el?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const visible = el => Boolean(el?.isConnected && el.getBoundingClientRect().width && el.getBoundingClientRect().height && getComputedStyle(el).visibility !== 'hidden');
  const isPrompt = el => el instanceof HTMLTextAreaElement || el?.isContentEditable;
  const isGenerate = el => /生成|generate|create\s+(?:a\s+)?video/i.test(text(el)) && !/充值|订阅|upgrade|purchase|delete|删除/i.test(text(el));

  function ui(message) {
    if (!panel?.host.isConnected) {
      const host = document.createElement('div'); host.id = 'ianto-video-panel';
      host.style.cssText = 'position:fixed;top:12px;right:12px;z-index:2147483647;width:370px;max-width:95vw';
      const root = host.attachShadow({mode: 'open'});
      root.innerHTML = '<style>:host{font:14px/1.6 system-ui;color:#272230}section{padding:18px;background:white;border:2px solid #ef66a5;border-radius:14px;box-shadow:0 8px 32px #0004}h3{margin:0 0 8px;color:#c52975}p{white-space:pre-wrap;margin:8px 0}button,select{margin:5px 5px 5px 0;padding:7px 10px;border:1px solid #e5b1ca;border-radius:7px;background:#fff4f9;color:#98265f;cursor:pointer}input{max-width:100%}label{display:block;font-size:12px}</style><section><h3>Ianto · 视频网页桥接</h3><p role="status"></p><div class="actions"></div></section>';
      document.documentElement.appendChild(host);
      panel = {host, root, message: root.querySelector('p'), actions: root.querySelector('.actions')};
    }
    panel.message.textContent = message;
    panel.actions.replaceChildren();
    return panel;
  }
  function button(label, callback) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.addEventListener('click', callback); panel.actions.appendChild(b); return b;
  }
  function identify(el) {
    const descriptors = ['id', 'data-testid', 'data-test-id', 'aria-label', 'name'];
    let selector;
    for (const attr of descriptors) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const candidate = `${el.tagName.toLowerCase()}[${attr}="${CSS.escape(value)}"]`;
      if (document.querySelectorAll(candidate).length === 1) { selector = candidate; break; }
    }
    if (!selector) {
      const parts = []; let node = el;
      while (node && node !== document.documentElement) {
        const siblings = [...node.parentElement.children].filter(n => n.tagName === node.tagName);
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node)+1})`);
        node = node.parentElement;
      }
      selector = 'html > ' + parts.join(' > ');
    }
    return {selector, tag: el.tagName, role: el.getAttribute('role') || '', type: el.getAttribute('type') || ''};
  }
  function resolve(desc) {
    const matches = document.querySelectorAll(desc.selector);
    const el = matches[0];
    if (matches.length !== 1 || el.tagName !== desc.tag || (el.getAttribute('type') || '') !== desc.type || (el.getAttribute('role') || '') !== desc.role) throw new Error('网页控件已改变或不唯一，请重新绑定；没有点击生成');
    return el;
  }
  async function profile() {
    const profiles = (await chrome.storage.local.get('vceVideoProfiles')).vceVideoProfiles || {};
    const p = profiles[scopeKey()];
    if (!p) throw new Error('此页面未绑定：请先使用工作台的“绑定网页控件”');
    const fields = Object.fromEntries(Object.entries(p).map(([key, value]) => [key, resolve(value)]));
    if (!isPrompt(fields.prompt) || !visible(fields.prompt) || fields.file.type !== 'file' || !isGenerate(fields.submit) || !visible(fields.submit) || !visible(fields.results)) throw new Error('请进入图生视频编辑器，或重新绑定已改变的控件');
    return fields;
  }
  async function pick(message, normalize, validate) {
    ui(message + '\n点击网页上的控件；此次只绑定，不会触发网站操作。');
    return new Promise((resolvePick, reject) => {
      const cleanup = () => { document.removeEventListener('click', capture, true); clearTimeout(timer); };
      const capture = event => {
        if (event.composedPath().includes(panel.host)) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const el = normalize(event.target);
        if (!el || !validate(el)) { panel.message.textContent = message + '\n该位置不符合要求，请重新点击。'; return; }
        cleanup(); resolvePick(identify(el));
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('绑定等待超时')); }, 180000);
      button('取消绑定', () => { cleanup(); reject(new Error('已取消绑定')); });
      document.addEventListener('click', capture, true);
    });
  }
  async function bind() {
    binding = true;
    try {
      const p = {};
      p.prompt = await pick('1/4 · 点击视频提示词输入框', el => el.closest('textarea,[contenteditable="true"],[contenteditable="plaintext-only"]'), isPrompt);
      const files = [...document.querySelectorAll('input[type="file"]')].filter(el => !el.accept || /image|png|jpg|jpeg|webp/i.test(el.accept));
      if (!files.length) throw new Error('网页尚未挂载图片上传框。请先打开网站的“上传图片”面板，再重新绑定');
      ui('2/4 · 选择首帧图片上传框。若有多个，可根据网站标签选择；后续先检查填图结果，再授权生成。');
      p.file = await new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error('上传框绑定超时')), 180000);
        files.forEach((file, i) => button(`${i+1}. ${file.getAttribute('aria-label') || file.name || file.id || file.accept || '图片上传'}`, () => { clearTimeout(timer); res(identify(file)); }));
        button('取消绑定', () => { clearTimeout(timer); rej(new Error('已取消绑定')); });
      });
      p.submit = await pick('3/4 · 点击网站“生成 / Generate”按钮（不点击充值、订阅）', el => el.closest('button,[role="button"]'), isGenerate);
      p.results = await pick('4/4 · 点击仅展示本次生成结果的区域空白处（不要选整个页面或素材库）', el => el.tagName === 'VIDEO' ? el.parentElement : el, el => !['HTML','BODY'].includes(el.tagName) && !el.contains(resolve(p.prompt)));
      const profiles = (await chrome.storage.local.get('vceVideoProfiles')).vceVideoProfiles || {};
      profiles[scopeKey()] = p; await chrome.storage.local.set({vceVideoProfiles: profiles});
      ui('绑定已保存。请回视频工作台刷新列表并提交。模型、时长、画幅及数量1由你在网站选择；本工具不替你订阅套餐。');
      button('关闭', () => panel.host.remove());
    } catch (error) { ui(error.message); button('关闭', () => panel.host.remove()); }
    finally { binding = false; }
  }
  async function relay(suffix, body) {
    if (stopped) throw new Error('队列已停止；不会继续提交网站生成');
    const response = await chrome.runtime.sendMessage({action: 'vceVideoRelay', jobId: running, suffix, body});
    if (!response?.ok) throw new Error(response?.error || '桥接连接失效，请查看网站结果，勿重复提交');
    return response.result;
  }
  async function wait(check, ms, message) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (stopped) throw new Error('队列已停止');
      const value = check(); if (value) return value;
      await sleep(500);
    }
    throw new Error(message);
  }
  function setPrompt(el, value) {
    el.focus();
    if (el instanceof HTMLTextAreaElement) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true}));
    } else {
      const selection = getSelection(); const range = document.createRange(); range.selectNodeContents(el);
      selection.removeAllRanges(); selection.addRange(range);
      if (!document.execCommand('insertText', false, value)) throw new Error('此编辑器不支持自动填词，请停止任务并使用网页手动生成');
    }
  }
  function videos(root) {
    return [...new Set([...root.querySelectorAll('video')].filter(v => visible(v) && v.readyState >= 2 && v.duration > 0).map(v => v.currentSrc || v.src).filter(Boolean))];
  }
  async function authorize(message) {
    ui(message);
    const row = document.createElement('label'); const box = document.createElement('input'); box.type = 'checkbox';
    row.append(box, ' 我已验证上传会替换旧首帧，授权本队列后续镜头自动提交（可能扣网页额度）'); panel.actions.appendChild(row);
    return new Promise((res, rej) => {
      const cleanup = () => { clearTimeout(timer); clearInterval(cancelCheck); };
      const timer = setTimeout(() => { cleanup(); rej(new Error('等待授权超时，未点击生成')); }, 10*60*1000);
      const cancelCheck = setInterval(() => { if (stopped) { cleanup(); rej(new Error('队列已停止，未点击生成')); } }, 500);
      button('确认当前素材，生成这一镜', () => { cleanup(); if (stopped) rej(new Error('队列已停止')); else res(box.checked); });
      button('停止队列', () => { cleanup(); rej(new Error('用户停止队列')); });
    });
  }
  async function receiveVideo(fields, before) {
    let manual = null, last = '', count = 0;
    const upload = document.createElement('input'); upload.type = 'file'; upload.accept = 'video/mp4,video/webm,video/quicktime';
    upload.setAttribute('aria-label', '手动回传此镜已下载视频');
    upload.addEventListener('change', () => { manual = upload.files?.[0] || null; });
    const label = document.createElement('label'); label.append('如网站限制读取或结果不明确：从网站下载本镜后在此选取（不重复生成）', upload);
    panel.actions.appendChild(label);
    return wait(() => {
      if (manual) return {file: manual};
      const fresh = videos(fields.results).filter(src => !before.has(src));
      if (fresh.length !== 1) { last = ''; count = 0; return null; }
      if (fresh[0] === last) count++; else { last = fresh[0]; count = 1; }
      return count >= 4 ? {url: last} : null;
    }, 25*60*1000, '25分钟未收到唯一新视频，可能登录/验证码/额度不足或结果区绑定有误。请到网站检查，未自动重复点击');
  }
  async function fileFallback(message) {
    ui(message + '\n本镜不会再次提交。请从网站下载刚生成的视频，并选取回传。');
    let file;
    const input = document.createElement('input'); input.type='file'; input.accept='video/*'; input.setAttribute('aria-label','选取当前镜头视频');
    input.addEventListener('change', () => { file = input.files?.[0]; }); panel.actions.appendChild(input);
    button('停止队列', () => { stopped = true; });
    return wait(() => file, 10*60*1000, '等待手动回传超时，请检查网站结果');
  }
  async function transfer(shotId, blob) {
    if (!blob.size || blob.size > 500*1024*1024) throw new Error('空视频或超过500MB回传上限');
    for (let offset=0; offset<blob.size; offset+=512*1024) {
      const bytes = new Uint8Array(await blob.slice(offset, offset+512*1024).arrayBuffer());
      let binary = ''; for (let i=0; i<bytes.length; i+=32768) binary += String.fromCharCode(...bytes.subarray(i, i+32768));
      await relay(`/shots/${shotId}/clip`, {offset, data: btoa(binary), final: offset+bytes.length === blob.size});
    }
  }
  async function run(job) {
    const jobId = running; let automatic = false;
    const heartbeat = setInterval(() => relay('/status', {message: panel?.message.textContent.slice(0, 450) || '等待网页视频'}).catch(() => { stopped = true; }), 15000);
    try {
      for (const task of job.bundle.tasks) {
        if (task.received) continue;
        // A grant check immediately before each submit detects cancellation/restart.
        await relay('');
        const fields = await profile();
        const image = await relay(`/shots/${task.shot_id}/image`);
        const data = await (await fetch(image.dataUrl)).blob();
        const transferData = new DataTransfer(); transferData.items.add(new File([data], `shot-${task.order}.png`, {type: 'image/png'}));
        fields.file.files = transferData.files;
        fields.file.dispatchEvent(new Event('input', {bubbles: true})); fields.file.dispatchEvent(new Event('change', {bubbles: true}));
        const prompt = `${task.prompt}\nOutput aspect ratio ${job.bundle.aspect_ratio}. Generate one clip at least ${task.duration} seconds long. No added captions, speech or music.`;
        setPrompt(fields.prompt, prompt);
        if (!automatic || fields.file.files.length !== 1) automatic = await authorize(`第 ${task.order} 镜 · 目标 ${task.duration} 秒 · ${job.bundle.model}\n${job.bundle.strict ? '仅生成背景，产品将在本地叠加。' : '生成含产品的动作视频，必须验收变形风险。'}\n请确认首帧已上传成功、没有残留旧图，网页模型/时长/画幅/数量1正确。登录或验证码请自行处理。`);
        await relay('');
        const current = await profile();
        const actual = current.prompt instanceof HTMLTextAreaElement ? current.prompt.value : current.prompt.textContent;
        if (actual.trim() !== prompt.trim() || current.file.files.length > 1) throw new Error('填入的提示词或图片不一致，未点击生成，请检查网页');
        await wait(() => !current.submit.disabled && current.submit.getAttribute('aria-disabled') !== 'true', 60000, '生成按钮不可用，可能图片未上传完成、额度或登录限制；未点击');
        const before = new Set(videos(current.results));
        ui(`正在等待第 ${task.order} 镜生成。不要手动运行其他任务或切换当前网站项目。`);
        button('停止队列', () => { stopped = true; });
        current.submit.click(); // Exactly once. No automatic paid retry.
        const result = await receiveVideo(current, before);
        let blob = result.file;
        if (!blob) {
          try {
            const url = new URL(result.url, location.href);
            if (!['https:', 'blob:'].includes(url.protocol)) throw new Error('不支持的视频地址类型');
            const response = await fetch(url.href, {signal: AbortSignal.timeout(120000)});
            if (!response.ok) throw new Error('网站拒绝视频读取');
            blob = await response.blob();
            if (!blob.size || (!blob.type.startsWith('video/') && blob.type !== 'application/octet-stream')) throw new Error('网站返回的不是可读视频文件');
          } catch (error) { blob = await fileFallback(error.message); }
        }
        ui(`第 ${task.order} 镜生成完成，正在分块回传…`);
        await transfer(task.shot_id, blob);
      }
      clearInterval(heartbeat);
      await relay('/finish', {});
      ui('所有网页片段已回传。视频工作台正在统一合成、控制时长并生成验收画面。');
      button('关闭', () => panel.host.remove());
    } catch (error) {
      // Still report a deliberate stop; do not let stopped short-circuit the report.
      stopped = false;
      await relay('/status', {failed: true, message: error.message}).catch(() => {});
      ui(`任务已停止：${error.message}\n不会自动改走 API 或重复点击生成。已扣额度/已生成视频请在网站查看。`);
      button('关闭', () => panel.host.remove());
    } finally { clearInterval(heartbeat); if (running === jobId) running = null; }
  }
  chrome.runtime.onMessage.addListener((request, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !request.action?.startsWith('vceVideo')) return false;
    if (request.action === 'vceVideoStop') { if (running === request.jobId) stopped = true; respond({ok:true}); return false; }
    if (running || binding) { respond({ok:false,error:'此网页已有队列或正在绑定，不能重复提交'}); return false; }
    if (request.action === 'vceVideoBind') { bind(); respond({ok:true}); return false; }
    if (request.action === 'vceVideoReady') { profile().then(() => respond({ok:true}), error => respond({ok:false,error:error.message})); return true; }
    if (request.action === 'vceVideoRun') {
      running = request.jobId; stopped = false;
      respond({ok:true}); run(request); return false;
    }
    return false;
  });
})();
