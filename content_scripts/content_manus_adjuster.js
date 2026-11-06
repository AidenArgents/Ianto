// content_manus_adjuster.js

(function() {
    const styleId = 'manus-layout-expand-style';
    const storageKey = 'manus_width_enabled';

    function applyManusStyles(enabled) {
        let styleElement = document.getElementById(styleId);
        const targetOverallWidth = '1600px';

        if (enabled) {
            if (!styleElement) {
                styleElement = document.createElement('style');
                styleElement.id = styleId;
                document.head.appendChild(styleElement);
                styleElement.textContent = `
                    /* 主内容容器宽度限制 (sm:max-w-[768px]) */
                    [class*="max-w-[768px]"][class*="mx-auto"] {
                        max-width: ${targetOverallWidth} !important;
                        width: 100% !important;
                    }
                    /* 兜底：任何含 max-w-[768px] 的容器 */
                    [class*="max-w-[768px]"] {
                        max-width: ${targetOverallWidth} !important;
                    }
                    .group\\/image,
                    .group\\/image img {
                        max-width: 580px !important;
                        width: auto !important;
                    }
                `;
            }
        } else {
            if (styleElement) styleElement.remove();
        }
    }

    function applyManusStylesV2(enabled) {
        let styleElement = document.getElementById(styleId);
        const targetOverallWidth = '1600px';

        if (enabled) {
            if (!styleElement) {
                styleElement = document.createElement('style');
                styleElement.id = styleId;
                document.head.appendChild(styleElement);
            }
            styleElement.textContent = `
                :root {
                    --ianto-manus-content-max-width: ${targetOverallWidth};
                }

                [class*="max-w-[768px]"][class*="mx-auto"],
                [class*="max-w-[800px]"][class*="mx-auto"],
                [class*="max-w-[960px]"][class*="mx-auto"],
                [class*="max-w-screen-md"][class*="mx-auto"],
                [class*="max-w-screen-lg"][class*="mx-auto"],
                [class*="max-w-screen-xl"][class*="mx-auto"] {
                    max-width: var(--ianto-manus-content-max-width) !important;
                    width: 100% !important;
                }

                main [class*="max-w-"][class*="mx-auto"],
                main [class*="mx-auto"][class*="max-w-"],
                main [class*="max-w-"][class*="w-full"],
                section [class*="max-w-"][class*="mx-auto"],
                article [class*="max-w-"][class*="mx-auto"] {
                    max-width: var(--ianto-manus-content-max-width) !important;
                    width: min(100%, var(--ianto-manus-content-max-width)) !important;
                }

                [class*="prose"][class*="mx-auto"],
                [class*="markdown"][class*="mx-auto"] {
                    max-width: var(--ianto-manus-content-max-width) !important;
                }

                .group\\/image,
                .group\\/image img {
                    max-width: 580px !important;
                    width: auto !important;
                }
            `;
        } else if (styleElement) {
            styleElement.remove();
        }
    }

    let widthObserver = null;

    function markWidthAdjusted(el) {
        if (!el || el.dataset.iantoWidthAdjusted === '1') return;
        el.dataset.iantoWidthAdjusted = '1';
        el.style.maxWidth = '1600px';
        el.style.width = '100%';
        if (!el.style.marginLeft) el.style.marginLeft = 'auto';
        if (!el.style.marginRight) el.style.marginRight = 'auto';
    }

    function normalizeManusWidth() {
        const candidates = new Set();
        const selectors = [
            'main',
            '[role="main"]',
            'main > div',
            'main section',
            'main article',
            '[class*="max-w-"][class*="mx-auto"]',
            '[class*="mx-auto"][class*="max-w-"]',
            '[class*="prose"]',
            '[class*="markdown"]'
        ];

        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                const maxWidth = parseFloat(style.maxWidth);
                const width = rect.width;
                const className = typeof el.className === 'string' ? el.className : '';
                const looksCentered = style.marginLeft === 'auto' || style.marginRight === 'auto' || className.includes('mx-auto');
                const constrained = (Number.isFinite(maxWidth) && maxWidth >= 600 && maxWidth <= 1200) || (width >= 600 && width <= 1200);
                if (looksCentered && constrained) candidates.add(el);
            });
        });

        candidates.forEach(markWidthAdjusted);
    }

    function syncManusWidthRuntime(enabled) {
        if (!enabled) {
            if (widthObserver) {
                widthObserver.disconnect();
                widthObserver = null;
            }
            return;
        }

        normalizeManusWidth();

        if (!widthObserver) {
            widthObserver = new MutationObserver(() => {
                normalizeManusWidth();
            });
            widthObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style']
            });
        }
    }

    chrome.storage.local.get(['manus_width_enabled'], (result) => {
        if (result['manus_width_enabled']) {
            applyManusStylesV2(true);
            syncManusWidthRuntime(true);
        }
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggleManusWidth') {
            chrome.storage.local.get(['manus_width_enabled'], (result) => {
                const newState = !result['manus_width_enabled'];
                chrome.storage.local.set({ 'manus_width_enabled': newState }, () => {
                    applyManusStylesV2(newState);
                    syncManusWidthRuntime(newState);
                    // 同步通知 folder 模块（通过 storage 变化触发）
                    sendResponse({ status: "done", enabled: newState });
                });
            });
            return true;
        }
    });

})();


// ── Manus 对话分组功能 ──────────────────────────────────────────────────────
(function () {
    const CSS_ID     = 'ianto-manus-css';
    const FOLDER_KEY = 'manus_custom_folders_data';
    let folderData = [];  // 数组结构：[{ name, tasks: [{title}], open }, ...]
    let dragSrc = null, dragData = null;

    // ── CSS 注入 ────────────────────────────────────────────────────────────
    function injectCSS() {
        if (document.getElementById(CSS_ID)) return;
        const s = document.createElement('style');
        s.id = CSS_ID;
        s.textContent = `
          #ianto-folder-manager { margin: 0 0 8px 0; padding: 0; font-family: inherit; display: flex; flex-direction: column; gap: 2px; color: inherit; }
          .ianto-header { display: flex; justify-content: space-between; align-items: center; padding: 0 10px; margin-bottom: 4px; }
          .ianto-title { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; opacity: 0.7; margin-left: 2px; transition: opacity 0.2s; }
          .ianto-title:hover { opacity: 1; }
          .ianto-new-btn { cursor: pointer; background: transparent; color: inherit; border: none; border-radius: 50px; padding: 3px 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 3px; transition: all 0.2s; opacity: 0.7; }
          .ianto-new-btn:hover { background: rgba(128,128,128,0.15); opacity: 1; }
          .ianto-folder { transition: opacity 0.2s; position: relative; }
          .ianto-folder-title { margin: 0 4px; padding: 8px 8px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; border-radius: 8px; transition: background 0.2s; }
          .ianto-folder-title:hover { background: rgba(128,128,128,0.08); }
          .ianto-folder-content { display: none; flex-direction: column; padding-bottom: 4px; }
          .ianto-folder-content.open { display: flex; }
          .ianto-chat-item { margin: 2px 4px 0 16px; padding: 8px 8px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 6px; border-radius: 8px; color: inherit; opacity: 0.85; cursor: pointer; position: relative; transition: all 0.2s ease; }
          .ianto-chat-item:hover { background: rgba(128,128,128,0.08); opacity: 1; }
          .ianto-chat-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
          .ianto-chat-remove, .ianto-folder-del { cursor: pointer; padding: 3px; border-radius: 50%; opacity: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; }
          .ianto-chat-item:hover .ianto-chat-remove, .ianto-folder-title:hover .ianto-folder-del { opacity: 0.5; }
          .ianto-chat-remove:hover, .ianto-folder-del:hover { background: rgba(128,128,128,0.2); opacity: 1 !important; color: #d93025; }
          .ianto-manus-classify-btn { position: absolute; right: 48px; top: 50%; transform: translateY(-50%); background: rgba(99,179,154,0.9); color: #fff; border: none; border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: bold; cursor: pointer; opacity: 0; transition: opacity 0.2s ease; z-index: 20; white-space: nowrap; pointer-events: auto; }
          .ianto-manus-classify-btn:hover { background: rgba(49,130,206,0.9); opacity: 1 !important; }
          .ianto-folder.drag-over .ianto-folder-title { background: rgba(99,179,154,0.15) !important; border-radius: 8px; }
          .ianto-chat-item.dragging { opacity: 0.4; }
          .ianto-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); display: none; justify-content: center; align-items: center; z-index: 999999; }
          .ianto-modal-overlay.open { display: flex; }
          .ianto-modal-card { background: #1e1e2e; color: #e2e8f0; width: 320px; border-radius: 14px; padding: 22px; box-shadow: 0 12px 40px rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.08); font-family: inherit; }
          .ianto-modal-title { font-size: 16px; font-weight: 600; margin-bottom: 6px; }
          .ianto-modal-desc { font-size: 12px; color: #94a3b8; margin-bottom: 14px; line-height: 1.5; word-break: break-all; max-height: 50px; overflow: hidden; }
          .ianto-modal-input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 13px; margin-bottom: 18px; outline: none; }
          .ianto-modal-input:focus { border-color: #63b39a; }
          .ianto-modal-select { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #e2e8f0; font-size: 13px; margin-bottom: 18px; outline: none; }
          .ianto-modal-select option { background: #1e1e2e; }
          .ianto-modal-footer { display: flex; justify-content: flex-end; gap: 8px; }
          .ianto-btn-cancel { padding: 7px 14px; border: none; background: transparent; color: #94a3b8; cursor: pointer; border-radius: 20px; font-weight: 500; font-size: 13px; }
          .ianto-btn-cancel:hover { background: rgba(255,255,255,0.06); color: #e2e8f0; }
          .ianto-btn-confirm { padding: 7px 18px; border: none; background: #63b39a; color: #fff; cursor: pointer; border-radius: 20px; font-weight: 600; font-size: 13px; }
          .ianto-btn-confirm:hover { background: #4a9a81; }
        `;
        document.head.appendChild(s);
    }

    // ── 工具 ────────────────────────────────────────────────────────────────
    function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
    function saveData(cb) { chrome.storage.local.set({ [FOLDER_KEY]: folderData }, cb || (() => {})); }

    // 从 DOM 读取文件夹结构并保存（确保 DOM 顺序和数据一致）
    function saveFoldersFromDOM() {
        const newFolderData = [];
        const folderEls = document.querySelectorAll('#ianto-folder-manager > .ianto-folder');
        folderEls.forEach(folderEl => {
            const folderName = folderEl.querySelector('.ianto-folder-del').getAttribute('data-folder');
            const isOpen = folderEl.querySelector('.ianto-folder-content').classList.contains('open');
            const tasks = [];

            const contentNode = folderEl.querySelector('.ianto-folder-content');
            Array.from(contentNode.children).forEach(child => {
                let title = null, sessionId = null;
                if (child.classList.contains('ianto-chat-item')) {
                    title = child.getAttribute('data-title');
                    sessionId = child.getAttribute('data-session-id');
                } else if (child.classList.contains('ianto-folder-item-wrap')) {
                    const nat = child.querySelector('.select-none');
                    if (nat) { title = getTaskTitle(nat); sessionId = getTaskSessionId(nat); }
                }
                if (title) tasks.push(sessionId ? { title, sessionId } : { title });
            });

            newFolderData.push({ name: folderName, tasks, open: isOpen });
        });
        folderData = newFolderData;
        saveData();
    }

    // ── DOM 结构：
    // nav > ... > div.flex.flex-col.gap-px.py-[11px]   (outerContainer)
    //   child[0]: div.clickable "所有任务" 标题
    //   child[1]: div.flex.flex-col.gap-px            (innerList，旧版外面套有 .overflow-hidden)
    //       children: div.select-none.touch-none[data-session-id=...]  (每个任务的拖拽包装)
    //         child[0]: div.clickable.rounded-[10px]    (真正的任务行，点击导航)
    //           ...icon + div.flex-1.min-w-0            (标题文字)

    function findInnerListIn(outer) {
        // 兼容旧版 (.overflow-hidden > 列表) 和新版 (直接 div.flex.flex-col.gap-px)
        const overflowChild = outer.querySelector(':scope > .overflow-hidden');
        if (overflowChild) return overflowChild.children[0] || null;
        // 新版：跳过第一个 header（含"所有任务"），找第一个 .flex.flex-col 列表容器
        for (let i = 1; i < outer.children.length; i++) {
            const c = outer.children[i];
            if (c.id === 'ianto-folder-manager') continue;
            if (c.classList.contains('flex') && c.classList.contains('flex-col')) return c;
        }
        return null;
    }

    function getOuterContainer() {
        const cands = document.querySelectorAll('div.flex.flex-col[class*="gap-px"][class*="py-"]');
        for (const el of cands) {
            const hdr = el.children[0];
            if (!hdr) continue;
            if (!(hdr.textContent.includes('所有任务') || hdr.textContent.includes('All Tasks'))) continue;
            if (findInnerListIn(el)) return el;
        }
        return null;
    }

    function getInnerList() {
        const outer = getOuterContainer();
        return outer ? findInnerListIn(outer) : null;
    }

    function getAllTaskWrappers() {
        const list = getInnerList();
        if (!list) return [];
        return Array.from(list.children).filter(el => el.classList.contains('select-none'));
    }

    function getTaskItems() {
        return getAllTaskWrappers().filter(el => el.offsetHeight > 0);
    }

    function getTaskHTML(taskWrapper) {
        const clone = taskWrapper.cloneNode(true);
        const btn = clone.querySelector('.ianto-manus-classify-btn');
        if (btn) btn.remove();
        clone.style.position = '';
        clone.style.opacity = '';
        clone.removeAttribute('draggable');
        clone.removeAttribute('data-ianto-mark');
        return clone.innerHTML;
    }

    function syncNativeHides() {
        // Native wrappers stay in the original list; hide those assigned to a folder.
        const sids = new Set();
        const titles = new Set();
        folderData.forEach(f => (f.tasks || []).forEach(t => {
            if (t.sessionId) sids.add(t.sessionId);
            if (t.title) titles.add(t.title);
        }));
        getAllTaskWrappers().forEach(wrapper => {
            const sid = getTaskSessionId(wrapper);
            const title = getTaskTitle(wrapper);
            const inFolder = (sid && sids.has(sid)) || titles.has(title);
            if (inFolder) {
                wrapper.style.display = 'none';
            } else {
                if (wrapper.style.display === 'none') wrapper.style.display = '';
                const classifyBtn = wrapper.querySelector('.ianto-manus-classify-btn');
                if (classifyBtn) classifyBtn.style.display = '';
            }
        });
    }

    function getTaskTitle(taskWrapper) {
        // 标题在 div.flex-1.min-w-0 内
        const titleEl = taskWrapper.querySelector('[class*="flex-1"][class*="min-w-0"]');
        return (titleEl ? titleEl.textContent : taskWrapper.textContent).trim().substring(0, 80);
    }

    function getTaskSessionId(taskWrapper) {
        return taskWrapper.getAttribute('data-session-id') || null;
    }

    // 匹配规则：双方都有 sessionId 时以 sessionId 为准；否则 fallback 到 title
    function taskMatchesWrapper(task, wrapper) {
        const wid = getTaskSessionId(wrapper);
        if (task.sessionId && wid) return task.sessionId === wid;
        return task.title === getTaskTitle(wrapper);
    }

    function tasksEqual(a, b) {
        if (a.sessionId && b.sessionId) return a.sessionId === b.sessionId;
        return a.title === b.title;
    }

    // 懒迁移：把旧数据的 sessionId 字段补齐。返回是否有改动
    function backfillSessionIds() {
        const wrappers = getAllTaskWrappers();
        if (!wrappers.length) return false;
        let changed = false;
        for (const folder of folderData) {
            if (!folder.tasks) continue;
            for (const t of folder.tasks) {
                if (t.sessionId) continue;
                const w = wrappers.find(wr => getTaskTitle(wr) === t.title);
                if (w) {
                    const sid = getTaskSessionId(w);
                    if (sid) { t.sessionId = sid; changed = true; }
                }
            }
        }
        return changed;
    }

    function getClickableEl(taskWrapper) {
        return taskWrapper.querySelector('div[class*="clickable"][class*="rounded"]');
    }

    function navigateToTask(taskRef) {
        // taskRef 可以是 string (legacy) 或 {title, sessionId}
        const ref = typeof taskRef === 'string' ? { title: taskRef } : taskRef;
        const wrappers = getAllTaskWrappers();
        let target = null;
        if (ref.sessionId) target = wrappers.find(el => getTaskSessionId(el) === ref.sessionId);
        if (!target) target = wrappers.find(el => getTaskTitle(el) === ref.title);
        if (target) {
            const btn = getClickableEl(target);
            if (btn) btn.click(); else target.click();
        }
    }

    // ── 自定义弹窗 ──────────────────────────────────────────────────────────
    function getModal() {
        let m = document.getElementById('ianto-manus-modal');
        if (!m) {
            m = document.createElement('div');
            m.id = 'ianto-manus-modal';
            m.className = 'ianto-modal-overlay';
            m.innerHTML = `
              <div class="ianto-modal-card">
                <div class="ianto-modal-title"></div>
                <div class="ianto-modal-desc"></div>
                <input type="text" class="ianto-modal-input" autocomplete="off" style="display:none" />
                <select class="ianto-modal-select" style="display:none"></select>
                <div class="ianto-modal-footer">
                  <button class="ianto-btn-cancel">取消</button>
                  <button class="ianto-btn-confirm">确定</button>
                </div>
              </div>
            `;
            document.body.appendChild(m);
            m.addEventListener('click', e => { if (e.target === m) closeModal(); });
        }
        return m;
    }

    function closeModal() {
        const m = document.getElementById('ianto-manus-modal');
        if (m) m.classList.remove('open');
    }

    function showInputModal(title, desc, onConfirm) {
        const m = getModal();
        m.querySelector('.ianto-modal-title').textContent = title;
        m.querySelector('.ianto-modal-desc').textContent = desc || '';
        const inp = m.querySelector('.ianto-modal-input');
        const sel = m.querySelector('.ianto-modal-select');
        inp.style.display = 'block'; sel.style.display = 'none';
        inp.placeholder = '分组名称…'; inp.value = '';
        m.classList.add('open');
        setTimeout(() => inp.focus(), 80);
        const confirmBtn = m.querySelector('.ianto-btn-confirm');
        const cancelBtn  = m.querySelector('.ianto-btn-cancel');
        confirmBtn.textContent = '确定'; cancelBtn.textContent = '取消';
        confirmBtn.onclick = () => { const v = inp.value.trim(); if (v) { onConfirm(v); closeModal(); } };
        cancelBtn.onclick  = closeModal;
        inp.onkeydown = e => { if (e.key === 'Enter') confirmBtn.click(); if (e.key === 'Escape') cancelBtn.click(); };
    }

    function showSelectModal(title, desc, options, onSelect, onNew) {
        const m = getModal();
        m.querySelector('.ianto-modal-title').textContent = title;
        m.querySelector('.ianto-modal-desc').textContent = desc || '';
        const inp = m.querySelector('.ianto-modal-input');
        const sel = m.querySelector('.ianto-modal-select');
        inp.style.display = 'none'; sel.style.display = 'block';
        sel.innerHTML = options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
        m.classList.add('open');
        const confirmBtn = m.querySelector('.ianto-btn-confirm');
        const cancelBtn  = m.querySelector('.ianto-btn-cancel');
        confirmBtn.textContent = '确定'; cancelBtn.textContent = '＋ 新建分组';
        confirmBtn.onclick = () => { onSelect(sel.value); closeModal(); };
        cancelBtn.onclick  = () => { closeModal(); if (onNew) onNew(); };
    }

    // ── 文件夹渲染 ──────────────────────────────────────────────────────────
    function renderFolders() {
        const mgr = document.getElementById('ianto-folder-manager');
        if (!mgr) return;

        // 旧数据懒迁移：把 title-only 任务补上 sessionId
        if (backfillSessionIds()) saveData();

        // 删除文件夹前，先把task wrapper元素移出来，避免被一起删除
        const tempContainer = document.createElement('div');
        mgr.querySelectorAll('.ianto-folder-content .ianto-folder-item-wrap').forEach(wrap => {
            tempContainer.appendChild(wrap);
        });

        mgr.querySelectorAll('.ianto-folder').forEach(e => e.remove());

        // 把wrapper元素放回原位置（这样后续inline逻辑可以再次找到它们）
        const outer = getOuterContainer();
        if (outer) {
            Array.from(tempContainer.children).forEach(wrap => {
                outer.insertBefore(wrap, mgr.nextSibling);
            });
        }

        folderData.forEach((folder, idx) => {
            const open = folder.open !== false;
            const el = document.createElement('div');
            el.className = 'ianto-folder';
            el.dataset.folderIndex = idx;
            el.id = 'folder-' + idx;
            el.draggable = true;

            const titleEl = document.createElement('div');
            titleEl.className = 'ianto-folder-title';
            titleEl.innerHTML = `
              <span style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden">
                <span style="font-size:9px;opacity:.5">${open ? '▼' : '▶'}</span>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(folder.name)}</span>
                <span style="font-size:11px;opacity:.4;flex-shrink:0">${(folder.tasks||[]).length}</span>
              </span>
              <span class="ianto-folder-del" title="删除分组" data-folder="${esc(folder.name)}">✕</span>
            `;
            titleEl.querySelector('.ianto-folder-del').addEventListener('click', e => { e.stopPropagation(); deleteFolder(idx); });
            titleEl.addEventListener('click', e => {
                if (e.target.classList.contains('ianto-folder-del')) return;
                folder.open = !open; saveData(() => renderFolders());
            });

            el.addEventListener('dragstart', e => {
                if (e.target.closest('.ianto-folder-del')) { e.preventDefault(); return; }
                if (e.target.closest('.ianto-chat-item')) return;
                dragSrc = 'folder';
                dragData = { folderIndex: idx };
                e.dataTransfer.setData('text/plain', 'ianto-folder-drag');
                setTimeout(() => el.classList.add('dragging'), 0);
            });

            el.addEventListener('dragend', () => {
                el.classList.remove('dragging');
                dragSrc = null;
                dragData = null;
            });
            el.appendChild(titleEl);

            // 拖拽放入文件夹
            el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
            el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over'); });
            el.addEventListener('drop', e => {
                e.preventDefault(); el.classList.remove('drag-over');
                if (dragData && dragSrc === 'folder' && dragData.folderIndex !== idx) {
                    // 直接操作 DOM 移动文件夹
                    const mgr = document.getElementById('ianto-folder-manager');
                    const srcEl = document.getElementById('folder-' + dragData.folderIndex);
                    if (srcEl && mgr) {
                        // 计算插入位置（插入到目标元素的前面或后面）
                        const titleNode = el.querySelector('.ianto-folder-title');
                        const rect = (titleNode || el).getBoundingClientRect();
                        const isTopHalf = (e.clientY - rect.top) / rect.height < 0.5;
                        mgr.insertBefore(srcEl, isTopHalf ? el : el.nextSibling);
                        saveFoldersFromDOM();
                    }
                } else if (dragData && dragSrc === 'native') {
                    if (!folder.tasks) folder.tasks = [];
                    const dragRef = { title: dragData.title, sessionId: dragData.sessionId };
                    if (!folder.tasks.some(t => tasksEqual(t, dragRef))) {
                        const entry = dragData.sessionId
                            ? { title: dragData.title, sessionId: dragData.sessionId }
                            : { title: dragData.title };
                        folder.tasks.push(entry); saveData(() => renderFolders());
                    }
                } else if (dragData && dragSrc === 'item' && dragData.folderIndex !== idx) {
                    const srcFolder = folderData[dragData.folderIndex];
                    const dragRef = { title: dragData.title, sessionId: dragData.sessionId };
                    const task = srcFolder && srcFolder.tasks && srcFolder.tasks.find(t => tasksEqual(t, dragRef));
                    if (task) {
                        srcFolder.tasks = srcFolder.tasks.filter(t => !tasksEqual(t, dragRef));
                        if (!folder.tasks) folder.tasks = [];
                        folder.tasks.push(task); saveData(() => renderFolders());
                    }
                }
                dragSrc = null; dragData = null;
            });

            const content = document.createElement('div');
            content.className = 'ianto-folder-content' + (open ? ' open' : '');
            (folder.tasks || []).forEach(task => {
                // 查找对应的原生任务元素：先按 sessionId 找，找不到再按 title
                const allTaskWrappers = getAllTaskWrappers();
                const nativeTask = allTaskWrappers.find(w => taskMatchesWrapper(task, w));

                if (nativeTask && !nativeTask.closest('#ianto-folder-manager')) {
                    // 找到原生任务，将其包装并移到文件夹内
                    let wrapper = nativeTask.closest('.ianto-folder-item-wrap') || nativeTask;
                    if (wrapper === nativeTask) {
                        const newWrapper = document.createElement('div');
                        newWrapper.className = 'ianto-folder-item-wrap';
                        nativeTask.parentNode.insertBefore(newWrapper, nativeTask);
                        newWrapper.appendChild(nativeTask);
                        wrapper = newWrapper;
                    }

                    // 添加移出按钮
                    let removeBtn = wrapper.querySelector('.ianto-chat-remove[data-for-folder]');
                    if (!removeBtn) {
                        removeBtn = document.createElement('span');
                        removeBtn.className = 'ianto-chat-remove';
                        removeBtn.setAttribute('data-for-folder', '1');
                        removeBtn.title = '移出分组';
                        removeBtn.textContent = '−';
                        removeBtn.style.position = 'absolute';
                        removeBtn.style.right = '0';
                        removeBtn.addEventListener('click', e => {
                            e.stopPropagation();
                            folder.tasks = folder.tasks.filter(t => !tasksEqual(t, task));
                            saveData(() => renderFolders());
                        });
                        wrapper.appendChild(removeBtn);
                    }

                    // 设置拖拽
                    wrapper.draggable = true;
                    wrapper.addEventListener('dragstart', e => {
                        dragSrc = 'item'; dragData = { folderIndex: idx, title: task.title, sessionId: task.sessionId || null };
                        e.dataTransfer.setData('text/plain', 'ianto-item-drag');
                        setTimeout(() => wrapper.classList.add('dragging'), 0);
                    });
                    wrapper.addEventListener('dragend', () => {
                        wrapper.classList.remove('dragging');
                        dragSrc = null; dragData = null;
                    });
                    content.appendChild(wrapper);
                } else {
                    // 创建虚拟任务作为备选
                    const item = document.createElement('div');
                    item.className = 'ianto-chat-item ianto-fake-item';
                    item.style.cursor = 'pointer';
                    item.setAttribute('data-title', task.title);
                    if (task.sessionId) item.setAttribute('data-session-id', task.sessionId);
                    item.innerHTML = `<span class="ianto-chat-title">${esc(task.title)}</span>`;
                    item.addEventListener('click', e => {
                        if (e.target.closest('.ianto-chat-remove')) return;
                        navigateToTask(task);
                    });

                    const removeSpan = document.createElement('span');
                    removeSpan.className = 'ianto-chat-remove';
                    removeSpan.title = '移出分组';
                    removeSpan.textContent = '−';
                    removeSpan.addEventListener('click', e => {
                        e.stopPropagation();
                        folder.tasks = folder.tasks.filter(t => !tasksEqual(t, task));
                        saveData(() => renderFolders());
                    });
                    item.appendChild(removeSpan);

                    item.draggable = true;
                    item.addEventListener('dragstart', e => {
                        if (e.target.closest('.ianto-chat-remove')) { e.preventDefault(); return; }
                        e.stopPropagation();
                        dragSrc = 'item'; dragData = { folderIndex: idx, title: task.title, sessionId: task.sessionId || null };
                        e.dataTransfer.setData('text/plain', 'ianto-item-drag');
                        setTimeout(() => item.classList.add('dragging'), 0);
                    });
                    item.addEventListener('dragend', () => { item.classList.remove('dragging'); dragSrc = null; dragData = null; });
                    item.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
                    item.addEventListener('drop', e => {
                        e.preventDefault(); e.stopPropagation();
                        const dragRef = dragData ? { title: dragData.title, sessionId: dragData.sessionId } : null;
                        if (dragSrc === 'item' && dragRef && !tasksEqual(dragRef, task)) {
                            if (dragData.folderIndex === idx) {
                                const srcIdx = folder.tasks.findIndex(t => tasksEqual(t, dragRef));
                                const tgtIdx = folder.tasks.findIndex(t => tasksEqual(t, task));
                                if (srcIdx !== -1 && tgtIdx !== -1) {
                                    const [moved] = folder.tasks.splice(srcIdx, 1);
                                    folder.tasks.splice(tgtIdx, 0, moved);
                                    saveData(() => renderFolders());
                                }
                            } else {
                                const srcFolder = folderData[dragData.folderIndex];
                                const moving = srcFolder && srcFolder.tasks && srcFolder.tasks.find(t => tasksEqual(t, dragRef));
                                if (moving) {
                                    srcFolder.tasks = srcFolder.tasks.filter(t => !tasksEqual(t, dragRef));
                                    if (!folder.tasks) folder.tasks = [];
                                    if (!folder.tasks.some(t => tasksEqual(t, moving))) folder.tasks.push(moving);
                                    saveData(() => renderFolders());
                                }
                            }
                            dragSrc = null; dragData = null;
                        }
                    });

                    content.appendChild(item);
                }
            });
            el.appendChild(content);
            mgr.appendChild(el);
        });
        // 渲染完成后同步隐藏已归档的原生任务条目
        syncNativeHides();
    }

    // ── 构建侧栏 UI ─────────────────────────────────────────────────────────
    function buildFolderUI() {
        if (document.getElementById('ianto-folder-manager')) return;
        const outer = getOuterContainer();
        if (!outer) return;

        const mgr = document.createElement('div');
        mgr.id = 'ianto-folder-manager';

        const hdr = document.createElement('div');
        hdr.className = 'ianto-header';
        hdr.innerHTML = `<span class="ianto-title">分组</span><button class="ianto-new-btn" title="新建分组">＋</button>`;
        hdr.querySelector('.ianto-new-btn').addEventListener('click', () => createFolder());
        mgr.appendChild(hdr);

        // 插入到任务列表之前（兼容新旧 DOM：.overflow-hidden 旧版 / .flex.flex-col 新版）
        const innerList = findInnerListIn(outer);
        if (!innerList) return;
        // 如果 innerList 外面套有 .overflow-hidden，那么把 mgr 插在 .overflow-hidden 之前
        const insertBeforeRef = innerList.parentElement?.classList.contains('overflow-hidden') ? innerList.parentElement : innerList;
        outer.insertBefore(mgr, insertBeforeRef);
        renderFolders(); // ← 必须在插入 DOM 之后调用
    }

    // ── 分类按钮（绑定在外层 wrapper 悬停）──────────────────────────────
    function addClassifyButtons() {
        getTaskItems().forEach(wrapper => {
            if (wrapper.dataset.iantoMark) return;
            wrapper.dataset.iantoMark = '1';
            wrapper.style.position = 'relative';

            const title = getTaskTitle(wrapper);
            const sessionId = getTaskSessionId(wrapper);
            const isClassified = folderData.some(f => f.tasks && f.tasks.some(t => taskMatchesWrapper(t, wrapper)));

            const btn = document.createElement('button');
            btn.className = 'ianto-manus-classify-btn';
            btn.textContent = '📁 分组';
            btn.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); showClassifyModal(wrapper); });
            if (!isClassified) {
                wrapper.appendChild(btn);
                // JS hover（避免 CSS :hover 被拖拽库干扰）
                wrapper.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
                wrapper.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
            }

            // 拖拽支持：整行 + handle 指示器
            wrapper.draggable = true;
            wrapper.addEventListener('dragstart', e => {
                if (wrapper.closest('#ianto-folder-manager')) return; // 已在 folder 内，由 item dragstart 处理
                // 若点击的是原生按钮，取消拖拽
                const btn = e.target.closest('button');
                if (btn && !btn.classList.contains('ianto-manus-classify-btn')) { e.preventDefault(); return; }
                e.stopPropagation(); // block dnd-kit from also handling
                dragSrc = 'native'; dragData = { title, sessionId };
                e.dataTransfer.setData('text/plain', 'ianto-manus-drag');
                setTimeout(() => { wrapper.style.opacity = '0.4'; }, 0);
            });
            wrapper.addEventListener('dragend', () => { wrapper.style.opacity = ''; dragSrc = null; dragData = null; });
            // 拖动把手（视觉提示）
            const handle = document.createElement('span');
            handle.title = '拖入分组';
            handle.style.cssText = 'position:absolute;left:2px;top:50%;transform:translateY(-50%);cursor:grab;opacity:0;font-size:13px;z-index:25;padding:4px 2px;line-height:1;pointer-events:none;user-select:none;';
            handle.textContent = '⠿';
            wrapper.addEventListener('mouseenter', () => { handle.style.opacity = '0.5'; });
            wrapper.addEventListener('mouseleave', () => { handle.style.opacity = '0'; });
            wrapper.appendChild(handle);
        });
        // 每次刷新归档按钮时同步隐藏已归档项
        syncNativeHides();
    }

    // ── 分类弹窗 ────────────────────────────────────────────────────────────
    function showClassifyModal(taskWrapper) {
        const title = getTaskTitle(taskWrapper);
        const sessionId = getTaskSessionId(taskWrapper);
        const newTaskEntry = sessionId ? { title, sessionId } : { title };
        if (!folderData.length) {
            showInputModal('新建分组', '', name => createFolder(newTaskEntry, name));
            return;
        }
        showSelectModal(
            '添加到分组', title,
            folderData.map((f, i) => [String(i), '📁 ' + f.name]),
            idxStr => {
                const idx = parseInt(idxStr);
                const folder = folderData[idx];
                if (folder) {
                    if (!folder.tasks) folder.tasks = [];
                    if (!folder.tasks.some(t => tasksEqual(t, newTaskEntry))) {
                        folder.tasks.push(newTaskEntry); saveData(() => renderFolders());
                    }
                }
            },
            () => showInputModal('新建分组', '', name => createFolder(newTaskEntry, name))
        );
    }

    // ── 创建 / 删除分组 ─────────────────────────────────────────────────────
    function createFolder(autoTask, predefinedName) {
        const doCreate = name => {
            const newFolder = { name, tasks: [], open: true };
            if (autoTask) {
                // autoTask 可以是 string (legacy) 或 {title, sessionId?} 对象
                const taskObj = typeof autoTask === 'string' ? { title: autoTask } : autoTask;
                newFolder.tasks.push(taskObj);
            }
            folderData.push(newFolder);
            saveData(() => renderFolders());
        };
        if (predefinedName) doCreate(predefinedName);
        else showInputModal('新建分组', '', doCreate);
    }

    function deleteFolder(idx) {
        if (!confirm('删除分组"' + (folderData[idx] && folderData[idx].name) + '"？')) return;
        folderData.splice(idx, 1);
        saveData(() => renderFolders());
    }

    // ── 统一开关 ─────────────────────────────────────────────────────────────
    let uiTimer = null;
    let obs = null;
    let isMounting = false;

    function applyFolders(enabled) {
        if (enabled) {
            injectCSS();
            if (!obs) {
                obs = new MutationObserver(() => {
                    // mgr 消失时立即重建
                    if (!isMounting && !document.getElementById('ianto-folder-manager')) {
                        if (getTaskItems().length > 0) {
                            isMounting = true; buildFolderUI(); isMounting = false;
                        }
                    }
                    clearTimeout(uiTimer);
                    uiTimer = setTimeout(() => { addClassifyButtons(); syncNativeHides(); }, 400);
                });
                obs.observe(document.body, { childList: true, subtree: true });
            }
            const tryBuild = () => {
                if (getTaskItems().length > 0) { buildFolderUI(); addClassifyButtons(); }
                else setTimeout(tryBuild, 800);
            };
            tryBuild();
            // setInterval 兜底（参考 Claude 方案）
            if (!window._iantoManusInterval) {
                window._iantoManusInterval = setInterval(() => {
                    if (!isMounting && !document.getElementById('ianto-folder-manager') && getTaskItems().length > 0) {
                        isMounting = true; buildFolderUI(); isMounting = false;
                    }
                }, 1000);
            }
        } else {
            if (obs) { obs.disconnect(); obs = null; }
            if (window._iantoManusInterval) { clearInterval(window._iantoManusInterval); window._iantoManusInterval = null; }
            document.getElementById('ianto-folder-manager')?.remove();
        }
    }

    chrome.storage.local.get(['manus_width_enabled', FOLDER_KEY], r => {
        const data = r[FOLDER_KEY];
        if (Array.isArray(data)) {
            // 新格式：直接使用
            folderData = data;
        } else if (data && typeof data === 'object') {
            // 旧格式：对象转数组
            folderData = Object.entries(data).map(([_, folder]) => ({
                name: folder.name,
                tasks: folder.tasks || [],
                open: folder.open !== false
            }));
            // 保存转换后的新格式
            saveData();
        } else {
            folderData = [];
        }
        applyFolders(!!r['manus_width_enabled']);
    });

    // 监听 width toggle 变化，同步开关 folder 模块
    chrome.storage.onChanged.addListener((changes) => {
        if (changes['manus_width_enabled']) {
            applyFolders(!!changes['manus_width_enabled'].newValue);
        }
    });
})();
