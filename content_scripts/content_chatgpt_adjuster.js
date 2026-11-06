// content_scripts/content_chatgpt_adjuster.js
(function () {
  const STYLE_ID   = 'ianto-gpt-width-style';
  const CSS_ID     = 'ianto-gpt-css';
  const WIDTH_KEY  = 'chatgpt_width_enabled';
  const FOLDER_KEY = 'chatgpt_custom_folders_data';
  const MAIN_FOLDER_OPEN_KEY = 'chatgpt_main_folder_open';
  const PROJECTION_STYLE_ID = 'ianto-gpt-native-menu-position';
  let folderData = [];  // 数组结构：[{ name, convs: [{href, title}], open }, ...]
  let dragSrc = null, dragData = null; // 拖拽状态
  let suppressDragClickUntil = 0;
  const draggableRows = new WeakSet();
  const nativeRows = new Map();
  const nativeRowStates = new WeakMap();
  const pinStateOverrides = new Map(); // 本页内及时响应原生 Pin/Unpin，再由原生分区作为最终状态
  let nativeMenuHref = null;
  let nativeMenuHrefTimer = null;
  let nativePinClickListener = null;
  let enabled = false;
  let folderSurfaceActive = false;
  let nativeProjection = null;
  let projectionCloseTimer = null;
  const pendingNativeRemovals = new Map();
  const projectedTriggers = new WeakSet();
  let restoringMenuFocus = false;

  // ── CSS 注入 ────────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
      #ianto-folder-manager { margin: 8px 0 12px 0; padding: 0; font-family: inherit; display: flex; flex-direction: column; gap: 2px; color: inherit; width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
      .ianto-header { display: flex; justify-content: space-between; align-items: center; padding: 0 12px; margin-bottom: 4px; min-width: 0; box-sizing: border-box; }
      .ianto-title { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; opacity: 0.7; margin-left: 2px; transition: opacity 0.2s; min-width: 0; }
      .ianto-title:hover { opacity: 1; }
      .ianto-new-btn { cursor: pointer; background: transparent; color: inherit; border: none; border-radius: 50px; padding: 3px 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px; transition: all 0.2s; opacity: 0.7; }
      .ianto-new-btn:hover { background: rgba(128,128,128,0.15); opacity: 1; }
      #ianto-folder-list { width: 100%; max-width: 100%; min-width: 0; box-sizing: border-box; }
      .ianto-folder { transition: opacity 0.2s; position: relative; }
      .ianto-folder-title { margin: 0 8px; padding: 8px 8px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; border-radius: 8px; transition: background 0.2s; }
      .ianto-folder-title:hover { background: rgba(128,128,128,0.08); }
      .ianto-folder-title[draggable="true"] { cursor: grab; user-select: none; }
      .ianto-folder-title[draggable="true"]:active { cursor: grabbing; }
      .ianto-folder-content { display: none; flex-direction: column; padding-bottom: 4px; }
      .ianto-folder-content.open { display: flex; }
      .ianto-chat-item { margin: 2px 8px 0 8px; padding: 8px 8px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px; border-radius: 8px; text-decoration: none; color: inherit; opacity: 0.9; cursor: pointer; position: relative; transition: all 0.2s ease; box-sizing: border-box; min-width: 0; }
      .ianto-chat-item > a { display: flex; flex: 1; min-width: 0; color: inherit; text-decoration: none; }
      .ianto-chat-menu { flex-shrink: 0; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: transparent; color: inherit; font: inherit; font-size: 20px; line-height: 1; cursor: pointer; opacity: 0; }
      .ianto-chat-item:hover .ianto-chat-menu, .ianto-chat-item:focus-within .ianto-chat-menu { opacity: 0.8; }
      .ianto-chat-menu:hover { background: rgba(128,128,128,0.2); }
      .ianto-chat-menu:disabled { cursor: default; opacity: 0.3; }
      .ianto-chat-projecting > .ianto-chat-menu, .ianto-chat-editing > a { visibility: hidden; }
      .ianto-chat-projecting > .ianto-unarchive-btn { opacity: 0.8 !important; }
      .ianto-chat-item:hover { background: rgba(128,128,128,0.08); opacity: 1; }
      .ianto-chat-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
      .ianto-chat-remove, .ianto-folder-del { cursor: pointer; padding: 4px; border-radius: 50%; opacity: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; }
      .ianto-chat-item:hover .ianto-chat-remove, .ianto-folder-title:hover .ianto-folder-del { opacity: 0.5; }
      .ianto-chat-remove:hover, .ianto-folder-del:hover { background: rgba(128,128,128,0.2); opacity: 1 !important; color: #d93025; }
      .ianto-unarchive-btn { position: absolute !important; right: 66px !important; top: 50% !important; transform: translateY(-50%) !important; background: rgba(217,48,37,0.1) !important; color: #d93025 !important; border: none !important; border-radius: 50% !important; width: 24px !important; height: 24px !important; display: flex !important; justify-content: center !important; align-items: center !important; cursor: pointer !important; opacity: 0 !important; transition: all 0.2s ease !important; z-index: 100 !important; font-size: 12px !important; padding: 0 !important; }
      .ianto-native-wrap:hover .ianto-unarchive-btn { opacity: 0.8 !important; }
      .ianto-unarchive-btn:hover { opacity: 1 !important; background: rgba(217,48,37,0.2) !important; }
      .ianto-chat-item .ianto-unarchive-btn { position: static !important; transform: none !important; flex-shrink: 0; }
      /* 分类收藏只渲染扩展自己的书签；原生行始终由 ChatGPT 管理。 */
      .ianto-native-wrap { position: relative; }
      nav .ianto-classified-native { display: none !important; }
      /* 用 CSS 在收藏条目处展示原生行，原生节点始终留在原父节点中。 */
      nav .ianto-native-menu-source { display: block !important; position: fixed !important; margin: 0 !important; padding: 0 !important; box-sizing: border-box !important; overflow: visible !important; visibility: hidden !important; z-index: 40 !important; }
      nav .ianto-native-menu-source.ianto-native-editing { visibility: visible !important; }
      .ianto-native-menu-source * { opacity: 1 !important; }
      .ianto-native-menu-trigger { visibility: visible !important; position: fixed !important; z-index: 41 !important; }
      .ianto-native-menu-uncontained { contain: none !important; }
      .ianto-native-menu-source > .ianto-classify-btn { display: none !important; }
      .ianto-folder-content > .ianto-chat-item { flex: 0 0 auto; }
      .ianto-classify-btn { position: absolute; right: 66px; top: 50%; transform: translateY(-50%); background: #10a37f; color: #fff; border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: bold; cursor: pointer; opacity: 0; visibility: hidden; transition: all 0.2s ease; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.3); white-space: nowrap; }
      .ianto-native-wrap:hover .ianto-classify-btn { opacity: 1; visibility: visible; }
      .ianto-classify-btn:hover { transform: translateY(-50%) scale(1.05); background: #0d8a6b; }
      .ianto-folder-content .ianto-classify-btn { display: none; }
      #ianto-folder-manager .drag-over-top::before { content: ''; position: absolute; top: 0; left: 8px; right: 8px; height: 2px; background: #10a37f; border-radius: 1px; z-index: 110; pointer-events: none; }
      #ianto-folder-manager .drag-over-bottom::after { content: ''; position: absolute; bottom: 0; left: 8px; right: 8px; height: 2px; background: #10a37f; border-radius: 1px; z-index: 110; pointer-events: none; }
      .ianto-folder.drag-over-inside > .ianto-folder-title { background: rgba(16,163,127,0.18); outline: 1px solid #10a37f; }
      .ianto-folder-content > .ianto-native-wrap[draggable="true"] { cursor: grab; }
      .ianto-native-wrap.dragging, .ianto-chat-item.dragging { opacity: 0.4; }
      .ianto-folder.dragging { opacity: 0.5; }
      .ianto-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.45); backdrop-filter: blur(4px); display: none; justify-content: center; align-items: center; z-index: 999999; }
      .ianto-modal-overlay.open { display: flex; }
      .ianto-modal-card { background: #ffffff; width: 340px; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); color: #202124; font-family: sans-serif; border: 1px solid rgba(0,0,0,0.1); }
      .ianto-modal-title { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
      .ianto-modal-desc { font-size: 13px; color: #5f6368; margin-bottom: 16px; line-height: 1.5; word-break: break-all; max-height: 60px; overflow: hidden; text-overflow: ellipsis; }
      .ianto-modal-input { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 8px; border: 1px solid #dadce0; background: #f1f3f4; color: #202124; font-size: 14px; margin-bottom: 20px; outline: none; }
      .ianto-modal-input:focus { border-color: #10a37f; }
      .ianto-modal-select { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 8px; border: 1px solid #dadce0; background: #f1f3f4; color: #202124; font-size: 14px; margin-bottom: 20px; outline: none; }
      .ianto-modal-footer { display: flex; justify-content: flex-end; gap: 10px; }
      .ianto-btn-cancel { padding: 8px 16px; border: none; background: transparent; color: #5f6368; cursor: pointer; border-radius: 20px; font-weight: 500; }
      .ianto-btn-cancel:hover { background: rgba(0,0,0,0.05); }
      .ianto-btn-confirm { padding: 8px 20px; border: none; background: #10a37f; color: #fff; cursor: pointer; border-radius: 20px; font-weight: 600; }
      .ianto-btn-confirm:hover { background: #0d8a6b; }
      @media (prefers-color-scheme: dark) {
        .ianto-modal-card { background: #202124; color: #e3e3e3; border: 1px solid rgba(255,255,255,0.1); }
        .ianto-modal-desc { color: #9aa0a6; }
        .ianto-modal-input, .ianto-modal-select { border: 1px solid #5f6368; background: rgba(255,255,255,0.06); color: #e3e3e3; }
        .ianto-modal-input:focus { border-color: #10a37f; }
        .ianto-btn-cancel { color: #9aa0a6; }
        .ianto-modal-select option { background: #202124; }
      }
    `;
    document.head.appendChild(s);
  }

  // ChatGPT's global sidebar is also present on settings pages. Keep Ianto's
  // folder UI and row changes confined to the normal ChatGPT chat surface.
  function isChatSurface() {
    return !/^\/settings(?:\/|$)/i.test(location.pathname);
  }

  function syncFolderSurface() {
    const shouldBeActive = enabled && isChatSurface();
    if (shouldBeActive === folderSurfaceActive) return;
    folderSurfaceActive = shouldBeActive;

    if (shouldBeActive) {
      injectCSS();
      buildFolderUI();
      addClassifyButtons();
      return;
    }

    releaseNativeProjection();
    document.getElementById('ianto-folder-manager')?.remove();
    document.getElementById('ianto-gpt-modal')?.remove();
    document.getElementById(CSS_ID)?.remove();
    nativeRows.forEach((state, wrap) => {
      wrap.querySelectorAll('.ianto-classify-btn').forEach(button => button.remove());
      wrap.classList.remove('ianto-native-wrap', 'ianto-classified-native');
      if (state.draggable === null) wrap.removeAttribute('draggable');
      else wrap.setAttribute('draggable', state.draggable);
      nativeRowStates.delete(wrap);
    });
    nativeRows.clear();
  }

  // ── 宽度 ────────────────────────────────────────────────────────────────
  function applyWidth(enabled) {
    let s = document.getElementById(STYLE_ID);
    if (enabled) {
      if (!s) { s = document.createElement('style'); s.id = STYLE_ID; document.head.appendChild(s); }
      s.textContent = `
        /* ChatGPT 宽度扩展 - Ianto */
        [class*="--thread-content-max-width"] {
          --thread-content-max-width: 1400px !important;
        }

        /* ChatGPT 用户消息：随对话内容区动态占约一半宽度。
           用对话容器的百分比而不是固定像素，窗口/宽屏变化时会同步调整。 */
        [class~="bg-user-message"][class~="text-user-message"] {
          width: 50% !important;
          max-width: 50% !important;
          min-width: 0 !important;
          box-sizing: border-box !important;
        }
      `;
    } else { s && s.remove(); }
  }

  // ── 工具 ────────────────────────────────────────────────────────────────
  function saveData(cb) { chrome.storage.local.set({ [FOLDER_KEY]: folderData }, cb || (() => {})); }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  // 直接调整完整数据，避免从 DOM 重建时漏掉未加载或置顶中的书签。
  function clearDropIndicators() {
    document.querySelectorAll('#ianto-folder-manager .drag-over-top, #ianto-folder-manager .drag-over-bottom, #ianto-folder-manager .drag-over-inside')
      .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside'));
  }

  function finishDrag() {
    if (dragData) suppressDragClickUntil = Date.now() + 250;
    dragSrc = null;
    dragData = null;
    clearDropIndicators();
    document.querySelectorAll('.ianto-native-wrap.dragging, .ianto-folder.dragging')
      .forEach(el => el.classList.remove('dragging'));
    scheduleSidebarSync();
  }

  function beginDrag(event, node, type, data) {
    finishDrag();
    dragSrc = type;
    dragData = data;
    event.stopPropagation(); // 不让原生行的拖动被外层文件夹或 ChatGPT 接管。
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', 'ianto-' + type + '-drag');
    setTimeout(() => {
      if (dragData === data && node.isConnected) node.classList.add('dragging');
    }, 0);
  }

  function isDropAfter(event, node) {
    const rect = node.getBoundingClientRect();
    return event.clientY >= rect.top + rect.height / 2;
  }

  function reorderFolder(targetIndex, after) {
    const source = folderData[dragData.folderIndex];
    const target = folderData[targetIndex];
    if (!source || !target || source === target) return false;
    folderData.splice(dragData.folderIndex, 1);
    folderData.splice(folderData.indexOf(target) + (after ? 1 : 0), 0, source);
    return true;
  }

  function moveConversation(targetIndex, targetHref = null, after = false) {
    const target = folderData[targetIndex];
    const source = dragSrc === 'item' ? folderData[dragData.folderIndex] : null;
    const conv = dragSrc === 'item'
      ? source?.convs?.find(c => c.href === dragData.href)
      : { href: dragData.href, title: dragData.title };
    if (!target || !conv || targetHref === conv.href) return false;
    const convs = (target.convs || []).filter(c => c.href !== conv.href);
    const anchorIndex = targetHref ? convs.findIndex(c => c.href === targetHref) : -1;
    convs.splice(anchorIndex < 0 ? convs.length : anchorIndex + (after ? 1 : 0), 0, conv);
    if (source && source !== target) source.convs = source.convs.filter(c => c.href !== conv.href);
    target.convs = convs;
    target.open = true;
    return true;
  }

  function commitDrop(changed) {
    finishDrag();
    if (changed) saveData(() => renderFolders());
  }

  function installConversationDrag(wrap) {
    wrap.draggable = true;
    if (draggableRows.has(wrap)) return;
    draggableRows.add(wrap);
    wrap.addEventListener('dragstart', event => {
      if (!enabled) return;
      if (event.target.closest('button, [role="button"], .ianto-chat-remove')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const link = getConversationLink(wrap);
      if (!link) return;
      const folderEl = wrap.closest('.ianto-folder');
      const folderIndex = folderEl ? Number(folderEl.dataset.folderIndex) : null;
      const href = link.href;
      const title = folderData[folderIndex]?.convs?.find(c => c.href === href)?.title
        || (link.querySelector('[class*="truncate"], [data-fill]')?.textContent?.trim() || link.textContent.trim()).substring(0, 80);
      beginDrag(event, wrap, folderEl ? 'item' : 'native', { href, title, folderIndex });
    }, true);
    wrap.addEventListener('dragend', event => { if (!enabled) return; event.stopPropagation(); finishDrag(); }, true);
    wrap.addEventListener('dragover', event => {
      if (!dragData || !['item', 'native'].includes(dragSrc) || !wrap.closest('.ianto-folder')) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      clearDropIndicators();
      if (getConversationLink(wrap)?.href !== dragData.href) {
        wrap.classList.add(isDropAfter(event, wrap) ? 'drag-over-bottom' : 'drag-over-top');
      }
    }, true);
    wrap.addEventListener('dragleave', event => {
      if (!wrap.contains(event.relatedTarget)) wrap.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    wrap.addEventListener('drop', event => {
      const folderEl = wrap.closest('.ianto-folder');
      if (!dragData || !['item', 'native'].includes(dragSrc) || !folderEl) return;
      event.preventDefault();
      event.stopPropagation();
      commitDrop(moveConversation(Number(folderEl.dataset.folderIndex), getConversationLink(wrap)?.href, isDropAfter(event, wrap)));
    }, true);
  }

  function ensureUnarchiveButton(wrap) {
    if (wrap.querySelector('.ianto-unarchive-btn')) return;
    const button = document.createElement('button');
    button.className = 'ianto-unarchive-btn';
    button.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    button.title = '移出分组';
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const folderEl = wrap.closest('.ianto-folder');
      const folder = folderEl && folderData[Number(folderEl.dataset.folderIndex)];
      const href = getConversationLink(wrap)?.href;
      if (!folder || !href) return;
      folder.convs = folder.convs.filter(c => c.href !== href);
      saveData(() => renderFolders());
    });
    wrap.appendChild(button);
  }
  function getConvLinks() {
    const isNativeLink = a => !a.closest('#ianto-folder-manager');
    // 先尝试带 data-sidebar-item 属性的选择器，如页面改版则 fallback 到纯 href 匹配
    const primary = Array.from(document.querySelectorAll('nav a[href*="/c/"][data-sidebar-item]')).filter(isNativeLink);
    if (primary.length > 0) return primary;
    // fallback：匹配 /c/UUID 格式的链接，排除 ianto 自己的节点
    return Array.from(document.querySelectorAll('nav a[href*="/c/"]')).filter(a => {
      const href = a.getAttribute('href') || '';
      return /^\/c\/[a-zA-Z0-9-]{8,}/.test(href) && isNativeLink(a);
    });
  }

  function getConversationLink(row) {
    if (!row) return null;
    if (row.matches?.('a[href*="/c/"]')) return row;
    return row.querySelector('a[href*="/c/"]') || row.querySelector('a[href]');
  }

  function getNativeMenuButton(row) {
    if (!row) return null;
    return row.querySelector('button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"]')
      || Array.from(row.querySelectorAll('button, [role="button"]')).find(button =>
        /chat actions|chat options|more options|更多选项|更多操作|对话选项/i.test([
          button.getAttribute('aria-label'), button.getAttribute('title'), button.getAttribute('data-testid')
        ].filter(Boolean).join(' ')));
  }

  function releaseNativeProjection() {
    clearTimeout(projectionCloseTimer);
    projectionCloseTimer = null;
    if (!nativeProjection) return;
    const { source, bookmark, trigger, ancestors } = nativeProjection;
    nativeProjection = null;
    const restoreFocus = source.contains(document.activeElement);
    if (trigger.getAttribute('aria-expanded') === 'true') {
      const menu = document.getElementById(trigger.getAttribute('aria-controls')) || document.querySelector('[role="menu"]');
      menu?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    }
    source.classList.remove('ianto-native-menu-source');
    source.classList.remove('ianto-native-editing');
    trigger.classList.remove('ianto-native-menu-trigger');
    ancestors.forEach(node => node.classList.remove('ianto-native-menu-uncontained'));
    bookmark.classList.remove('ianto-chat-projecting', 'ianto-chat-editing');
    document.getElementById(PROJECTION_STYLE_ID)?.remove();
    if (enabled && restoreFocus && bookmark.isConnected) {
      restoringMenuFocus = true;
      bookmark.querySelector('.ianto-chat-menu')?.focus({ preventScroll: true });
      restoringMenuFocus = false;
    }
  }

  function positionNativeProjection() {
    if (!nativeProjection) return;
    const { source, bookmark } = nativeProjection;
    if (!source.isConnected || !bookmark.isConnected || !enabled) { releaseNativeProjection(); return; }
    const rect = bookmark.getBoundingClientRect();
    const removeRect = bookmark.querySelector('.ianto-unarchive-btn')?.getBoundingClientRect();
    const menuRect = bookmark.querySelector('.ianto-chat-menu')?.getBoundingClientRect();
    if (!rect.width || !rect.height) { releaseNativeProjection(); return; }
    let style = document.getElementById(PROJECTION_STYLE_ID);
    if (!style) { style = document.createElement('style'); style.id = PROJECTION_STYLE_ID; document.head.appendChild(style); }
    const width = removeRect ? removeRect.left - rect.left - 4 : rect.width;
    style.textContent = `nav .ianto-native-menu-source { left: ${rect.left}px !important; top: ${rect.top}px !important; width: ${Math.max(width, 80)}px !important; height: ${rect.height}px !important; }
      .ianto-native-menu-trigger { left: ${menuRect.left}px !important; top: ${menuRect.top}px !important; width: ${menuRect.width}px !important; height: ${menuRect.height}px !important; }`;
  }

  function refreshNativeProjection() {
    if (!nativeProjection) return;
    const { source, trigger, bookmark } = nativeProjection;
    if (!source.isConnected || !bookmark.isConnected) { releaseNativeProjection(); return; }
    const editing = source.querySelector('input, textarea, [contenteditable="true"]');
    source.classList.toggle('ianto-native-editing', !!editing);
    bookmark.classList.toggle('ianto-chat-editing', !!editing);
    const active = () => trigger.getAttribute('aria-expanded') === 'true'
      || trigger.getAttribute('data-state') === 'open'
      || source.querySelector('input, textarea, [contenteditable="true"]')
      || trigger.matches(':hover') || document.activeElement === trigger;
    if (active()) {
      clearTimeout(projectionCloseTimer);
      projectionCloseTimer = null;
      positionNativeProjection();
    } else if (projectionCloseTimer === null) {
      projectionCloseTimer = setTimeout(() => { projectionCloseTimer = null; if (!active()) releaseNativeProjection(); }, 100);
    }
  }

  function prepareNativeBookmarkMenu(bookmark, focus = false) {
    if (!enabled) return;
    if (nativeProjection?.bookmark === bookmark) { if (focus) nativeProjection.trigger.focus({ preventScroll: true }); return; }
    releaseNativeProjection();
    const href = getConversationLink(bookmark)?.href;
    const link = getConvLinks().find(a => a.href === href);
    const source = link?.closest('[role="listitem"], li') || link?.parentElement;
    const trigger = getNativeMenuButton(source);
    if (!trigger) return;
    // ChatGPT 的侧栏存在 contain: layout paint；临时解除裁剪，关闭后恢复。
    // 只改扩展的 CSS 标记，不改动原生节点的父子关系或内联样式。
    const ancestors = [];
    for (let node = source.parentElement; node && node !== document.body; node = node.parentElement) {
      if (/layout|paint|strict|content/.test(getComputedStyle(node).contain)) {
        node.classList.add('ianto-native-menu-uncontained');
        ancestors.push(node);
      }
    }
    nativeProjection = { source, bookmark, trigger, ancestors };
    bookmark.classList.add('ianto-chat-projecting');
    source.classList.add('ianto-native-menu-source');
    trigger.classList.add('ianto-native-menu-trigger');
    positionNativeProjection();
    nativeMenuHref = href;
    if (!projectedTriggers.has(trigger)) {
      projectedTriggers.add(trigger);
      trigger.addEventListener('pointerleave', () => {
        if (!nativeProjection || nativeProjection.trigger !== trigger) return;
        if (trigger.getAttribute('aria-expanded') !== 'true' && !source.querySelector('input, textarea, [contenteditable="true"]')) releaseNativeProjection();
        else refreshNativeProjection();
      });
      trigger.addEventListener('blur', refreshNativeProjection);
    }
    // 原生按钮覆盖在书签三点按钮的位置，由真正的鼠标/键盘事件打开菜单。
    if (focus) trigger.focus({ preventScroll: true });
  }

  function handleProjectionEscape(event) {
    if (event.key !== 'Escape' || !nativeProjection) return;
    setTimeout(() => {
      if (nativeProjection && nativeProjection.trigger.getAttribute('aria-expanded') !== 'true'
        && !nativeProjection.source.querySelector('input, textarea, [contenteditable="true"]')) releaseNativeProjection();
    }, 0);
  }

  function dismissNativeProjection(event) {
    if (!nativeProjection || !(event.target instanceof Element)) return;
    const { source, bookmark } = nativeProjection;
    if (source.contains(event.target) || bookmark.contains(event.target) || event.target.closest('[role="menu"]')) return;
    releaseNativeProjection();
  }

  function rememberNativeMenuContext(event) {
    if (event.type === 'keydown' && !['ArrowDown', 'Enter', ' '].includes(event.key)) return;
    const control = event.target instanceof Element ? event.target.closest('[aria-haspopup="menu"]') : null;
    const row = control?.closest('.ianto-native-wrap, [role="listitem"], li');
    const href = getConversationLink(row)?.href;
    if (!href) return;
    nativeMenuHref = href;
    clearTimeout(nativeMenuHrefTimer);
    nativeMenuHrefTimer = setTimeout(() => { nativeMenuHref = null; nativeMenuHrefTimer = null; }, 15000);
  }

  function getSidebarSectionName(row) {
    if (!row) return '';
    const nav = row.closest('nav') || document.querySelector('nav');
    const list = row.closest('[role="list"]') || row.closest('ul, ol');
    if (!nav || !list) return '';

    // 优先使用 ChatGPT 可能提供的分区标记。
    for (let node = row; node && node !== nav; node = node.parentElement) {
      const marker = [
        node.id,
        node.getAttribute('aria-label'),
        node.getAttribute('data-testid'),
        node.getAttribute('data-test-id'),
        node.getAttribute('data-section')
      ].filter(Boolean).join(' ');
      if (/pinned/i.test(marker)) return 'pinned';
      if (/recents?/i.test(marker)) return 'recents';
    }

    // 新版侧栏常把 “Pinned/Recents” 标题与对应列表放在同一分区容器中。
    let path = list;
    while (path && path !== nav) {
      const parent = path.parentElement;
      if (!parent) break;
      for (const sibling of parent.children) {
        if (sibling === path || sibling.contains(path)) continue;
        const label = (sibling.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        if (/^pinned(?:\s+chats?)?(?:\s+\d+)?$/.test(label) || /^(?:置顶|已置顶)$/.test(label)) return 'pinned';
        if (/^recents?(?:\s+\d+)?$/.test(label) || /^(?:最近|最近聊天|最近对话)$/.test(label)) return 'recents';
      }
      if (parent === nav) break;
      path = parent;
    }
    return '';
  }

  function isConversationPinned(href, row) {
    const section = getSidebarSectionName(row);
    if (section) return section === 'pinned';
    if (pinStateOverrides.has(href)) return pinStateOverrides.get(href);
    return false;
  }

  function getPinAction(control) {
    const label = [
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.getAttribute('data-testid'),
      control.getAttribute('data-test-id'),
      control.textContent
    ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (/\bunpin\b|取消(?:聊天)?置顶|取消置顶/.test(label)) return false;
    if (/\bpin(?:\s+chat)?\b|置顶/.test(label)) return true;
    return null;
  }

  function installNativePinClickListener() {
    if (nativePinClickListener) return;
    nativePinClickListener = event => {
      const control = event.target instanceof Element
        ? event.target.closest('button, [role="button"], [role="menuitem"]')
        : null;
      if (!control) return;

      const row = control.closest('.ianto-native-wrap, [role="listitem"], li');
      const link = getConversationLink(row);
      const href = link?.href || null;
      const action = getPinAction(control);
      if (control.matches('[role="menuitem"]') && /^(?:delete|archive|删除|归档)(?: chat|对话|聊天)?$/i.test(control.textContent.trim())) {
        const targetHref = href || nativeMenuHref;
        if (targetHref) pendingNativeRemovals.set(targetHref, Date.now() + 120000);
      }

      if (action !== null) {
        const targetHref = href || nativeMenuHref;
        if (targetHref) {
          pinStateOverrides.set(targetHref, action);
          if (nativeMenuHrefTimer) clearTimeout(nativeMenuHrefTimer);
          nativeMenuHrefTimer = null;
          nativeMenuHref = null;
          // 等 ChatGPT 完成自己的 Pin/Unpin 列表更新，再按当前分组状态同步。
          scheduleSidebarSync();
        }
        return;
      }

      const label = [control.getAttribute('aria-label'), control.getAttribute('title'), control.getAttribute('data-testid'), control.getAttribute('data-test-id'), control.textContent]
        .filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (href && /more options|chat actions|chat options|更多选项|更多操作|对话选项/.test(label)) {
        nativeMenuHref = href;
        if (nativeMenuHrefTimer) clearTimeout(nativeMenuHrefTimer);
        nativeMenuHrefTimer = setTimeout(() => { nativeMenuHref = null; nativeMenuHrefTimer = null; }, 15000);
      }
    };
    document.addEventListener('click', nativePinClickListener, true);
    document.addEventListener('pointerdown', dismissNativeProjection, true);
    document.addEventListener('pointerdown', rememberNativeMenuContext, true);
    document.addEventListener('keydown', rememberNativeMenuContext, true);
    document.addEventListener('keydown', handleProjectionEscape, true);
    window.addEventListener('scroll', positionNativeProjection, true);
    window.addEventListener('resize', positionNativeProjection);
  }

  function removeNativePinClickListener() {
    if (!nativePinClickListener) return;
    document.removeEventListener('click', nativePinClickListener, true);
    document.removeEventListener('pointerdown', dismissNativeProjection, true);
    document.removeEventListener('pointerdown', rememberNativeMenuContext, true);
    document.removeEventListener('keydown', rememberNativeMenuContext, true);
    document.removeEventListener('keydown', handleProjectionEscape, true);
    window.removeEventListener('scroll', positionNativeProjection, true);
    window.removeEventListener('resize', positionNativeProjection);
    releaseNativeProjection();
    pendingNativeRemovals.clear();
    nativePinClickListener = null;
    pinStateOverrides.clear();
    nativeMenuHref = null;
    if (nativeMenuHrefTimer) clearTimeout(nativeMenuHrefTimer);
    nativeMenuHrefTimer = null;
  }

  // ── 自定义弹窗 ──────────────────────────────────────────────────────────
  function getModal() {
    let m = document.getElementById('ianto-gpt-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'ianto-gpt-modal';
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
    const m = document.getElementById('ianto-gpt-modal');
    if (m) m.classList.remove('open');
  }

  function showInputModal(title, desc, placeholder, onConfirm) {
    const m = getModal();
    m.querySelector('.ianto-modal-title').textContent = title;
    m.querySelector('.ianto-modal-desc').textContent = desc || '';
    const inp = m.querySelector('.ianto-modal-input');
    const sel = m.querySelector('.ianto-modal-select');
    inp.style.display = 'block'; sel.style.display = 'none';
    inp.placeholder = placeholder || '';
    inp.value = '';
    m.classList.add('open');
    setTimeout(() => inp.focus(), 80);
    const confirmBtn = m.querySelector('.ianto-btn-confirm');
    const cancelBtn = m.querySelector('.ianto-btn-cancel');
    confirmBtn.onclick = () => { const v = inp.value.trim(); if (v) { onConfirm(v); closeModal(); } };
    cancelBtn.onclick = closeModal;
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
    const cancelBtn = m.querySelector('.ianto-btn-cancel');
    confirmBtn.textContent = '确定';
    confirmBtn.onclick = () => { onSelect(sel.value); closeModal(); };
    cancelBtn.textContent = onNew ? '＋ 新建分组' : '取消';
    cancelBtn.onclick = () => { closeModal(); if (onNew) onNew(); };
  }

  // ── 文件夹渲染 ──────────────────────────────────────────────────────────
  function renderFolders() {
    if (!enabled || dragData) return;
    releaseNativeProjection();
    const mgr = document.getElementById('ianto-folder-manager');
    const listContainer = document.getElementById('ianto-folder-list');
    if (!mgr || !listContainer) return;

    // 此处只有扩展创建的节点，重建不会触碰 ChatGPT 持有的 DOM 引用。
    listContainer.querySelectorAll('.ianto-folder').forEach(e => e.remove());

    folderData.forEach((folder, idx) => {
      const open = folder.open !== false;
      const el = document.createElement('div');
      el.className = 'ianto-folder';
      el.dataset.folderIndex = idx;
      el.id = 'folder-' + idx;

      const titleEl = document.createElement('div');
      titleEl.className = 'ianto-folder-title';
      titleEl.draggable = true;
      titleEl.title = '按住拖动调整分组顺序';
      titleEl.innerHTML = `
        <span style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden">
          <span style="font-size:9px;opacity:.5">${open ? '▼' : '▶'}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(folder.name)}</span>
          <span style="font-size:11px;opacity:.4;flex-shrink:0">${(folder.convs||[]).length}</span>
        </span>
        <span class="ianto-folder-del" title="删除分组" data-folder="${esc(folder.name)}">✕</span>
      `;
      titleEl.querySelector('.ianto-folder-del').addEventListener('click', e => { e.stopPropagation(); deleteFolder(idx); });
      titleEl.addEventListener('click', e => {
        if (Date.now() < suppressDragClickUntil || e.target.classList.contains('ianto-folder-del')) return;
        folder.open = !open; saveData(() => renderFolders());
      });

      titleEl.addEventListener('dragstart', e => {
        if (e.target.closest('.ianto-folder-del')) { e.preventDefault(); return; }
        beginDrag(e, el, 'folder', { folderIndex: idx });
      });

      titleEl.addEventListener('dragend', finishDrag);
      el.appendChild(titleEl);

      // 拖拽放入文件夹 - 显示插入位置指示器
      el.addEventListener('dragover', e => {
        if (!dragData) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        clearDropIndicators();
        if (dragSrc === 'folder') {
          if (dragData.folderIndex !== idx) el.classList.add(isDropAfter(e, el) ? 'drag-over-bottom' : 'drag-over-top');
        } else {
          el.classList.add('drag-over-inside');
        }
      });

      el.addEventListener('dragleave', e => {
        if (!el.contains(e.relatedTarget)) {
          el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-inside');
        }
      });

      el.addEventListener('drop', e => {
        if (!dragData) return;
        e.preventDefault();
        e.stopPropagation();
        commitDrop(dragSrc === 'folder' ? reorderFolder(idx, isDropAfter(e, el)) : moveConversation(idx));
      });

      const content = document.createElement('div');
      content.className = 'ianto-folder-content' + (open ? ' open' : '');
      el.appendChild(content);

      listContainer.appendChild(el);
    });
    syncFolderBookmarks();
  }

  // ── 独立书签：绝不移动、替换或删除 ChatGPT 的原生对话节点 ────────────────
  function syncFolderBookmarks() {
    if (!enabled || dragData) return;
    const links = getConvLinks();
    const nativeLinks = new Map(links.map(a => [a.href, a]));
    let removed = false;
    pendingNativeRemovals.forEach((deadline, href) => {
      if (Date.now() > deadline) { pendingNativeRemovals.delete(href); return; }
      if (nativeLinks.has(href)) return;
      // 只在原生归档/删除操作实际移除了对话后，清理对应收藏。
      pendingNativeRemovals.delete(href);
      folderData.forEach(folder => {
        const remaining = (folder.convs || []).filter(conv => conv.href !== href);
        if (remaining.length !== (folder.convs || []).length) { folder.convs = remaining; removed = true; }
      });
    });
    if (removed) { saveData(); renderFolders(); return; }
    const bookmarkedHrefs = new Set();
    folderData.forEach((folder, folderIndex) => {
      const folderEl = document.querySelector(`.ianto-folder[data-folder-index="${folderIndex}"]`);
      if (!folderEl) return;

      const folderContent = folderEl.querySelector('.ianto-folder-content');
      if (!folderContent) return;
      const existing = new Map(Array.from(folderContent.children).map(row => [getConversationLink(row)?.href, row]));
      const kept = new Set();
      let previousWrap = null;

      (folder.convs || []).forEach(conv => {
        let url;
        try { url = new URL(conv.href, 'https://chatgpt.com'); } catch { return; }
        if (url.protocol !== 'https:' || !['chatgpt.com', 'chat.openai.com'].includes(url.hostname) || !url.pathname.startsWith('/c/')) return;
        const href = url.href;
        const nativeLink = nativeLinks.get(href);
        const nativeRow = nativeLink?.closest('[role="listitem"], li') || nativeLink?.parentElement;
        // 置顶仍由原生 Pinned 分区展示；未加载的收藏也能正常显示和打开。
        if (isConversationPinned(href, nativeRow) || kept.has(href)) return;
        let bookmark = existing.get(href);
        if (!bookmark) {
          bookmark = document.createElement('div');
          bookmark.className = 'ianto-chat-item ianto-native-wrap';
          const link = document.createElement('a');
          link.href = href;
          const title = document.createElement('span');
          title.className = 'ianto-chat-title';
          link.appendChild(title);
          link.addEventListener('click', event => {
            if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            // 可用时沿用原生导航；未加载的书签保留普通链接行为。
            const native = getConvLinks().find(a => a.href === link.href);
            if (native) { event.preventDefault(); native.click(); }
          });
          bookmark.appendChild(link);
          const menu = document.createElement('button');
          menu.type = 'button';
          menu.className = 'ianto-chat-menu';
          menu.textContent = '⋯';
          menu.setAttribute('aria-label', 'Chat actions');
          menu.setAttribute('aria-haspopup', 'menu');
          menu.addEventListener('pointerenter', () => { if (!menu.disabled) prepareNativeBookmarkMenu(bookmark); });
          menu.addEventListener('focus', () => { if (!menu.disabled && !restoringMenuFocus) prepareNativeBookmarkMenu(bookmark, true); });
          menu.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); prepareNativeBookmarkMenu(bookmark, true); });
          bookmark.appendChild(menu);
          installConversationDrag(bookmark);
          ensureUnarchiveButton(bookmark);
        }
        const title = nativeLink?.querySelector('[class*="truncate"], [data-fill]')?.textContent?.trim() || conv.title || href;
        const titleNode = bookmark.querySelector('.ianto-chat-title');
        if (titleNode.textContent !== title) titleNode.textContent = title;
        if (bookmark.title !== title) bookmark.title = title;
        const menu = bookmark.querySelector('.ianto-chat-menu');
        menu.disabled = !getNativeMenuButton(nativeRow);
        menu.title = menu.disabled ? '打开此对话后可使用原生菜单' : '更多操作';
        // 只整理扩展自己创建的书签，位置不变时不重复写 DOM。
        const nextWrap = previousWrap ? previousWrap.nextElementSibling : folderContent.firstElementChild;
        if (nextWrap !== bookmark) folderContent.insertBefore(bookmark, nextWrap);
        previousWrap = bookmark;
        kept.add(href);
        bookmarkedHrefs.add(href);
      });
      existing.forEach((bookmark, href) => { if (!kept.has(href)) bookmark.remove(); });
    });
    // 仅隐藏已有收藏入口的重复行，保留节点及原父子关系供 ChatGPT 更新。
    // 分组折叠仍算已分类；移出/删除分组后恢复显示，置顶行始终保留。
    links.forEach(link => {
      const row = link.closest('[role="listitem"], li') || link.parentElement;
      if (row) row.classList.toggle('ianto-classified-native', bookmarkedHrefs.has(link.href) && !isConversationPinned(link.href, row));
    });
  }

  // ── ChatGPT 原生对话列表定位 ────────────────────────────────────────────
  function getChatListContext() {
    const links = getConvLinks();
    const firstConv = links.find(a => getSidebarSectionName(a) === 'recents') || links[0];
    const nav = firstConv?.closest('nav') || document.querySelector('nav:not([class*="sidebar-rail"])');
    if (!nav) return null;
    // 新版 ChatGPT 使用 div[role="list"] / div[role="listitem"]，不再是 ul/li。
    const list = firstConv?.closest('[role="list"], ul, ol') || nav.querySelector('[role="list"], ul, ol');
    return { list, host: list?.parentElement || nav };
  }

  function placeFolderManager(mgr) {
    const context = getChatListContext();
    if (!mgr || !context) return false;
    if (mgr.parentElement !== context.host || (context.list && mgr.nextElementSibling !== context.list)) {
      context.host.insertBefore(mgr, context.list || null);
    }
    return true;
  }

  function setMainFolderOpen(open, persist = true) {
    const listContainer = document.getElementById('ianto-folder-list');
    const caret = document.getElementById('ianto-main-caret');
    if (!listContainer) return;
    listContainer.style.display = open ? 'block' : 'none';
    if (caret) caret.style.transform = `scale(1.3)${open ? ' rotate(0deg)' : ' rotate(-90deg)'}`;
    if (persist) chrome.storage.local.set({ [MAIN_FOLDER_OPEN_KEY]: open });
  }

  // ── 构建侧栏 UI ─────────────────────────────────────────────────────────
  function buildFolderUI() {
    if (!enabled) return;

    const existingManager = document.getElementById('ianto-folder-manager');
    if (existingManager) {
      // 只移动扩展自己的容器，始终放在原生列表外。
      placeFolderManager(existingManager);
      return;
    }

    const context = getChatListContext();
    if (!context) return; // 对话尚未加载，observer 会重试

    const mgr = document.createElement('div');
    mgr.id = 'ianto-folder-manager';
    mgr.addEventListener('click', event => {
      if (Date.now() < suppressDragClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, true);

    const hdr = document.createElement('div');
    hdr.className = 'ianto-header';
    hdr.innerHTML = `
      <span class="ianto-title" id="ianto-main-toggle" title="点击展开/收起分类收藏">
        <span id="ianto-main-caret" style="font-size:12px;margin-right:6px;display:inline-block;transition:transform 0.2s;transform:scale(1.3);position:relative;top:1px;">▼</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        分类收藏
      </span>
      <button class="ianto-new-btn" id="ianto-create-folder" title="新建分类">＋ 新建</button>`;
    mgr.appendChild(hdr);

    const listContainer = document.createElement('div');
    listContainer.id = 'ianto-folder-list';
    mgr.appendChild(listContainer);

    // 不进入由 ChatGPT 管理的原生列表，更不接管其中的对话行。
    context.host.insertBefore(mgr, context.list || null);

    const mainToggle = document.getElementById('ianto-main-toggle');
    mainToggle?.addEventListener('click', () => {
      setMainFolderOpen(listContainer.style.display === 'none');
    });
    document.getElementById('ianto-create-folder')?.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      createFolder();
    });
    chrome.storage.local.get([MAIN_FOLDER_OPEN_KEY], res => {
      setMainFolderOpen(res[MAIN_FOLDER_OPEN_KEY] !== false, false);
    });

    renderFolders(); // ← 必须在插入 DOM 之后调用
  }

  // ── 分类按钮（悬停显示）───────────────────────────────────────────────
  function addClassifyButtons() {
    if (!enabled) return;
    nativeRows.forEach((_state, row) => { if (!row.isConnected) nativeRows.delete(row); });
    getConvLinks().forEach(a => {
      // 仅添加扩展按钮和拖拽监听；原生行及其链接、菜单保持原父子关系。
      const wrap = a.closest('[role="listitem"], li') || a.parentElement;
      if (!wrap || wrap.closest('#ianto-folder-manager')) return;
      if (!nativeRowStates.has(wrap)) nativeRowStates.set(wrap, { draggable: wrap.getAttribute('draggable') });
      nativeRows.set(wrap, nativeRowStates.get(wrap));
      wrap.classList.add('ianto-native-wrap');
      installConversationDrag(wrap);

      if (!wrap.querySelector('.ianto-classify-btn')) {
        const btn = document.createElement('button');
        btn.className = 'ianto-classify-btn';
        btn.textContent = '📁 分组';
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); showClassifyModal(a); });
        wrap.appendChild(btn);
      }
    });
    syncFolderBookmarks();
  }

  // ── 分类弹窗 ────────────────────────────────────────────────────────────
  function showClassifyModal(convLink) {
    const href  = convLink.href;
    const title = (convLink.querySelector('[class*="truncate"], [data-fill]')?.textContent?.trim()
                   || convLink.textContent.replace(/[✕📁]/g, '').trim()).substring(0, 80);
    if (!folderData.length) {
      showInputModal('新建分组', '', '分组名称…', name => {
        createFolder(href, title, name);
      });
      return;
    }
    showSelectModal(
      '添加到分组',
      title,
      folderData.map((f, i) => [String(i), '📁 ' + f.name]),
      idxStr => {
        const idx = parseInt(idxStr);
        const folder = folderData[idx];
        if (folder) {
          if (!folder.convs) folder.convs = [];
          if (!folder.convs.some(c => c.href === href)) {
            folder.convs.push({ href, title });
            saveData(() => renderFolders());
          }
        }
      },
      () => showInputModal('新建分组', '', '分组名称…', name => createFolder(href, title, name))
    );
  }

  // ── 创建 / 删除分组 ─────────────────────────────────────────────────────
  function createFolder(autoHref, autoTitle, predefinedName) {
    const doCreate = name => {
      const newFolder = { name, convs: [], open: true };
      if (autoHref) newFolder.convs.push({ href: autoHref, title: autoTitle || autoHref });
      folderData.push(newFolder);
      saveData(() => { renderFolders(); setMainFolderOpen(true); });
    };
    if (predefinedName) doCreate(predefinedName);
    else showInputModal('新建分组', '', '分组名称…', doCreate);
  }

  function deleteFolder(idx) {
    if (!confirm(`删除分组"${folderData[idx]?.name}"？`)) return;
    folderData.splice(idx, 1);
    saveData(() => renderFolders());
  }

  // ── 统一开关 ─────────────────────────────────────────────────────────────
  let uiTimer = null;
  let obs = null;

  function scheduleSidebarSync() {
    if (!enabled || !isChatSurface() || uiTimer !== null) return;
    uiTimer = setTimeout(() => {
      uiTimer = null;
      if (!enabled || dragData) return;
      syncFolderSurface();
      if (!folderSurfaceActive) return;
      buildFolderUI();
      addClassifyButtons();
    }, 100);
  }

  function applyAll(nextEnabled) {
    enabled = nextEnabled;
    applyWidth(enabled);
    if (enabled) {
      installNativePinClickListener();
      if (!obs) {
        obs = new MutationObserver(records => {
          if (!enabled || dragData) return;
          syncFolderSurface();
          refreshNativeProjection();
          const sidebarChanged = records.some(record => {
            const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
            if (target?.closest('#ianto-folder-manager, #ianto-gpt-modal')) return false;
            if (target?.closest('nav')) return true;
            // 侧栏被整块替换时仍能重建；主对话的流式输出不触发侧栏扫描。
            return [...record.addedNodes, ...record.removedNodes].some(node =>
              node.nodeType === Node.ELEMENT_NODE && (node.matches('nav') || node.querySelector('nav')));
          });
          if (sidebarChanged) scheduleSidebarSync();
        });
        obs.observe(document.body, {
          childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter: ['href', 'aria-label', 'data-section', 'aria-expanded', 'data-state']
        });
      }
      folderSurfaceActive = false;
      syncFolderSurface();
      window.addEventListener('popstate', syncFolderSurface);
      window.navigation?.addEventListener('navigatesuccess', syncFolderSurface);
    } else {
      window.removeEventListener('popstate', syncFolderSurface);
      window.navigation?.removeEventListener('navigatesuccess', syncFolderSurface);
      folderSurfaceActive = true;
      syncFolderSurface();
      finishDrag();
      removeNativePinClickListener();
      if (obs) { obs.disconnect(); obs = null; }
      clearTimeout(uiTimer);
      uiTimer = null;
      document.getElementById('ianto-folder-manager')?.remove();
      document.getElementById('ianto-gpt-modal')?.remove();
      document.getElementById(CSS_ID)?.remove();
      // 只清理扩展加上的属性和按钮，绝不删除或拆散原生行。
      nativeRows.forEach((state, wrap) => {
        wrap.querySelectorAll('.ianto-classify-btn').forEach(button => button.remove());
        wrap.classList.remove('ianto-native-wrap', 'ianto-classified-native');
        if (state.draggable === null) wrap.removeAttribute('draggable');
        else wrap.setAttribute('draggable', state.draggable);
        nativeRowStates.delete(wrap);
      });
      nativeRows.clear();
    }
  }

  chrome.storage.local.get([WIDTH_KEY, FOLDER_KEY], r => {
    const data = r[FOLDER_KEY];
    if (Array.isArray(data)) {
      // 新格式：直接使用
      folderData = data;
    } else if (data && typeof data === 'object') {
      // 旧格式：对象转数组
      folderData = Object.entries(data).map(([_, folder]) => ({
        name: folder.name,
        convs: folder.convs || [],
        open: folder.open !== false
      }));
      // 保存转换后的新格式
      saveData();
    } else {
      folderData = [];
    }
    applyAll(!!r[WIDTH_KEY]);
  });

  // ── 消息监听 ──────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((req, _, sendResponse) => {
    if (req.action === 'toggleChatGPTWidth') {
      chrome.storage.local.get([WIDTH_KEY], r => {
        const next = !r[WIDTH_KEY];
        chrome.storage.local.set({ [WIDTH_KEY]: next }, () => {
          applyAll(next);
          sendResponse({ enabled: next });
        });
      });
      return true;
    }
  });
})();
