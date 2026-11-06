// content_scripts/content_grok_adjuster.js
(function () {
  const STYLE_ID   = 'ianto-grok-width-style';
  const CSS_ID     = 'ianto-grok-css';
  const WIDTH_KEY  = 'grok_width_enabled';
  const FOLDER_KEY = 'grok_custom_folders_data';
  const ACCENT     = '#19c37d';

  let folderData = [];
  let dragSrc = null, dragData = null;
  let obs = null, uiTimer = null, isMounting = false;

  function injectCSS() {
    if (document.getElementById(CSS_ID)) return;
    const s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = `
      #ianto-folder-manager { margin: 8px 0 12px 0; padding: 0; font-family: inherit; display: flex; flex-direction: column; gap: 2px; color: inherit; }
      .ianto-header { display: flex; justify-content: space-between; align-items: center; padding: 0 12px; margin-bottom: 4px; }
      .ianto-title { font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 5px; cursor: pointer; user-select: none; opacity: 0.6; margin-left: 2px; transition: opacity 0.2s; letter-spacing: 0.05em; text-transform: uppercase; }
      .ianto-title:hover { opacity: 1; }
      .ianto-new-btn { cursor: pointer; background: transparent; color: inherit; border: none; border-radius: 50px; padding: 3px 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px; transition: all 0.2s; opacity: 0.6; }
      .ianto-new-btn:hover { background: rgba(128,128,128,0.15); opacity: 1; }
      .ianto-folder { transition: opacity 0.2s; position: relative; }
      .ianto-folder.dragging { opacity: 0.4; }
      .ianto-folder-title { margin: 0 6px; padding: 6px 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; border-radius: 8px; transition: background 0.2s; }
      .ianto-folder-title:hover { background: rgba(128,128,128,0.08); }
      .ianto-folder-content { display: none; flex-direction: column; padding-bottom: 4px; }
      .ianto-folder-content.open { display: flex; }
      .ianto-native-wrap { position: relative; }
      .ianto-native-wrap.dragging { opacity: 0.4; }
      .ianto-classify-btn { position: absolute; right: 32px; top: 50%; transform: translateY(-50%); background: ${ACCENT}; color: #fff; border: none; border-radius: 6px; padding: 3px 9px; font-size: 11px; font-weight: bold; cursor: pointer; opacity: 0; visibility: hidden; transition: all 0.2s ease; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.35); white-space: nowrap; pointer-events: auto; }
      .ianto-native-wrap:hover .ianto-classify-btn { opacity: 1; visibility: visible; }
      .ianto-classify-btn:hover { filter: brightness(1.1); transform: translateY(-50%) scale(1.05); }
      .ianto-unarchive-btn { position: absolute; right: 34px; top: 50%; transform: translateY(-50%); background: rgba(25,195,125,0.12); color: ${ACCENT}; border: none; border-radius: 50%; width: 22px; height: 22px; display: flex; justify-content: center; align-items: center; cursor: pointer; opacity: 0; transition: all 0.2s ease; z-index: 100; font-size: 13px; padding: 0; pointer-events: auto; }
      .ianto-native-wrap:hover .ianto-unarchive-btn { opacity: 0.8; }
      .ianto-unarchive-btn:hover { opacity: 1 !important; background: rgba(25,195,125,0.25); }
      .ianto-chat-remove, .ianto-folder-del { cursor: pointer; padding: 4px; border-radius: 50%; opacity: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 11px; }
      .ianto-folder-title:hover .ianto-folder-del { opacity: 0.5; }
      .ianto-folder-del:hover { background: rgba(128,128,128,0.2); opacity: 1 !important; color: #e84040; }
      .ianto-folder.drag-over-top::before { content: ''; position: absolute; top: -2px; left: 6px; right: 6px; height: 2px; background: ${ACCENT}; border-radius: 1px; z-index: 10; }
      .ianto-folder.drag-over-bottom::after { content: ''; position: absolute; bottom: -2px; left: 6px; right: 6px; height: 2px; background: ${ACCENT}; border-radius: 1px; z-index: 10; }
      .ianto-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.5); backdrop-filter: blur(6px); display: none; justify-content: center; align-items: center; z-index: 999999; }
      .ianto-modal-overlay.open { display: flex; }
      .ianto-modal-card { background: #1a1a1a; width: 340px; border-radius: 16px; padding: 24px; box-shadow: 0 12px 40px rgba(0,0,0,0.6); color: #f0f0f0; font-family: sans-serif; border: 1px solid rgba(255,255,255,0.1); }
      .ianto-modal-title { font-size: 17px; font-weight: 600; margin-bottom: 8px; }
      .ianto-modal-desc { font-size: 13px; color: #888; margin-bottom: 16px; line-height: 1.5; word-break: break-all; max-height: 60px; overflow: hidden; }
      .ianto-modal-input { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.07); color: #f0f0f0; font-size: 14px; margin-bottom: 20px; outline: none; }
      .ianto-modal-input:focus { border-color: ${ACCENT}; }
      .ianto-modal-select { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.07); color: #f0f0f0; font-size: 14px; margin-bottom: 20px; outline: none; }
      .ianto-modal-select option { background: #1a1a1a; color: #f0f0f0; }
      .ianto-modal-footer { display: flex; justify-content: flex-end; gap: 10px; }
      .ianto-btn-cancel { padding: 8px 16px; border: none; background: transparent; color: #777; cursor: pointer; border-radius: 20px; font-weight: 500; }
      .ianto-btn-cancel:hover { background: rgba(255,255,255,0.06); color: #ccc; }
      .ianto-btn-confirm { padding: 8px 20px; border: none; background: ${ACCENT}; color: #fff; cursor: pointer; border-radius: 20px; font-weight: 600; }
      .ianto-btn-confirm:hover { filter: brightness(1.1); }
      @media (prefers-color-scheme: light) {
        .ianto-modal-card { background: #ffffff; color: #111; border: 1px solid rgba(0,0,0,0.1); }
        .ianto-modal-desc { color: #666; }
        .ianto-modal-input, .ianto-modal-select { border: 1px solid #ddd; background: #f4f4f4; color: #111; }
        .ianto-modal-select option { background: #fff; color: #111; }
        .ianto-btn-cancel { color: #666; }
        .ianto-btn-cancel:hover { background: rgba(0,0,0,0.05); color: #333; }
      }
    `;
    document.head.appendChild(s);
  }

  function applyWidth(enabled) {
    let s = document.getElementById(STYLE_ID);
    if (enabled) {
      if (!s) { s = document.createElement('style'); s.id = STYLE_ID; document.head.appendChild(s); }
      s.textContent = `
        main, main * { --content-max-width: 92vw !important; }
        main [class*="max-w-"] { max-width: 92vw !important; }
        main .max-w-sm, main .max-w-md, main .max-w-lg,
        main .max-w-xl, main .max-w-2xl, main .max-w-3xl,
        main .max-w-4xl, main .max-w-5xl, main .max-w-6xl,
        main .max-w-7xl { max-width: 92vw !important; width: 92vw !important; }
        nav [class*="max-w-"] { max-width: revert !important; width: revert !important; }
      `;
    } else {
      s && s.remove();
    }
  }

  function saveData(cb) { chrome.storage.local.set({ [FOLDER_KEY]: folderData }, cb || (() => {})); }
  function esc(s) { const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

  function getConvLinks() {
    const results = [], seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href') || '';
      if (/^\/c\/[a-zA-Z0-9_-]{6,}/.test(href) && !a.dataset.iantoGrok) {
        if (!seen.has(href)) { seen.add(href); results.push(a); }
      }
    }
    return results;
  }

  function saveFoldersFromDOM() {
    const newData = [];
    document.querySelectorAll('#ianto-folder-manager > .ianto-folder').forEach(folderEl => {
      const name = folderEl.querySelector('.ianto-folder-del')?.getAttribute('data-folder');
      const isOpen = folderEl.querySelector('.ianto-folder-content')?.classList.contains('open');
      const convs = [];
      folderEl.querySelectorAll('.ianto-native-wrap a[href]').forEach(a => {
        const href = a.getAttribute('href');
        const title = a.title || a.textContent.trim().substring(0, 80);
        if (href && title) convs.push({ href, title });
      });
      if (name) newData.push({ name, convs, open: isOpen });
    });
    folderData = newData;
    saveData();
  }

  function getModal() {
    let m = document.getElementById('ianto-grok-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'ianto-grok-modal';
      m.className = 'ianto-modal-overlay';
      m.innerHTML = `<div class="ianto-modal-card"><div class="ianto-modal-title"></div><div class="ianto-modal-desc"></div><input type="text" class="ianto-modal-input" autocomplete="off" style="display:none"/><select class="ianto-modal-select" style="display:none"></select><div class="ianto-modal-footer"><button class="ianto-btn-cancel">Cancel</button><button class="ianto-btn-confirm">OK</button></div></div>`;
      document.body.appendChild(m);
      m.addEventListener('click', e => { if (e.target === m) closeModal(); });
    }
    return m;
  }

  function closeModal() { document.getElementById('ianto-grok-modal')?.classList.remove('open'); }

  function showInputModal(title, desc, placeholder, onConfirm) {
    const m = getModal();
    m.querySelector('.ianto-modal-title').textContent = title;
    m.querySelector('.ianto-modal-desc').textContent = desc || '';
    const inp = m.querySelector('.ianto-modal-input');
    const sel = m.querySelector('.ianto-modal-select');
    inp.style.display = 'block'; sel.style.display = 'none';
    inp.placeholder = placeholder || ''; inp.value = '';
    m.classList.add('open');
    setTimeout(() => inp.focus(), 80);
    const ok = m.querySelector('.ianto-btn-confirm');
    const cancel = m.querySelector('.ianto-btn-cancel');
    ok.onclick = () => { const v = inp.value.trim(); if (v) { onConfirm(v); closeModal(); } };
    cancel.onclick = closeModal;
    inp.onkeydown = e => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') cancel.click(); };
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
    const ok = m.querySelector('.ianto-btn-confirm');
    const cancel = m.querySelector('.ianto-btn-cancel');
    ok.textContent = 'OK';
    ok.onclick = () => { onSelect(sel.value); closeModal(); };
    cancel.textContent = onNew ? '+ New group' : 'Cancel';
    cancel.onclick = () => { closeModal(); if (onNew) onNew(); };
  }

  function renderFolders() {
    const mgr = document.getElementById('ianto-folder-manager');
    if (!mgr) return;
    const temp = document.createElement('div');
    mgr.querySelectorAll('.ianto-folder-content .ianto-native-wrap').forEach(w => temp.appendChild(w));
    mgr.querySelectorAll('.ianto-folder').forEach(e => e.remove());
    const nav = mgr.parentElement;
    Array.from(temp.children).forEach(w => nav && nav.insertBefore(w, mgr.nextSibling));

    folderData.forEach((folder, idx) => {
      const open = folder.open !== false;
      const el = document.createElement('div');
      el.className = 'ianto-folder'; el.dataset.folderIndex = idx;
      el.id = 'ianto-grok-folder-' + idx; el.draggable = true;

      const titleEl = document.createElement('div');
      titleEl.className = 'ianto-folder-title';
      titleEl.innerHTML = `<span style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;overflow:hidden"><span style="font-size:9px;opacity:.45">${open ? 'v' : '>'}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(folder.name)}</span><span style="font-size:11px;opacity:.35;flex-shrink:0">${(folder.convs||[]).length}</span></span><span class="ianto-folder-del" title="Delete" data-folder="${esc(folder.name)}">x</span>`;
      titleEl.querySelector('.ianto-folder-del').addEventListener('click', e => { e.stopPropagation(); deleteFolder(idx); });
      titleEl.addEventListener('click', e => {
        if (e.target.classList.contains('ianto-folder-del')) return;
        folder.open = !open; saveData(() => renderFolders());
      });

      el.addEventListener('dragstart', e => {
        if (e.target.closest('.ianto-folder-del') || e.target.closest('.ianto-native-wrap')) return;
        dragSrc = 'folder'; dragData = { folderIndex: idx };
        e.dataTransfer.setData('text/plain', 'ianto-folder');
        setTimeout(() => el.classList.add('dragging'), 0);
      });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragSrc = null; dragData = null; });
      el.addEventListener('dragover', e => {
        e.preventDefault();
        if (dragSrc === 'folder') {
          const rect = titleEl.getBoundingClientRect();
          const top = (e.clientY - rect.top) / rect.height < 0.5;
          el.classList.remove('drag-over-bottom');
          el.classList.add(top ? 'drag-over-top' : 'drag-over-bottom');
        }
      });
      el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drag-over-top','drag-over-bottom'); });
      el.addEventListener('drop', e => {
        e.preventDefault();
        el.classList.remove('drag-over-top','drag-over-bottom');
        if (dragSrc === 'folder' && dragData && dragData.folderIndex !== idx) {
          const srcEl = document.getElementById('ianto-grok-folder-' + dragData.folderIndex);
          const rect = titleEl.getBoundingClientRect();
          const top = (e.clientY - rect.top) / rect.height < 0.5;
          mgr.insertBefore(srcEl, top ? el : el.nextSibling);
          saveFoldersFromDOM();
        } else if (dragSrc === 'native' && dragData) {
          if (!folder.convs) folder.convs = [];
          if (!folder.convs.some(c => c.href === dragData.href)) {
            folder.convs.push(dragData);
            saveData(() => renderFolders());
          }
        }
        dragSrc = null; dragData = null;
      });

      el.appendChild(titleEl);
      const content = document.createElement('div');
      content.className = 'ianto-folder-content' + (open ? ' open' : '');
      el.appendChild(content);

      (folder.convs || []).forEach(conv => {
        document.querySelectorAll('.ianto-native-wrap').forEach(wrap => {
          const link = wrap.querySelector('a[href]');
          if (!link) return;
          if (link.href === conv.href || link.getAttribute('href') === conv.href) {
            if (wrap.parentElement !== content) {
              content.appendChild(wrap);
              if (!wrap.querySelector('.ianto-unarchive-btn')) addUnarchiveBtn(wrap, folder, conv.href);
            }
          }
        });
      });

      mgr.appendChild(el);
    });
  }

  function addUnarchiveBtn(wrap, folder, href) {
    const unBtn = document.createElement('button');
    unBtn.className = 'ianto-unarchive-btn';
    unBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    unBtn.title = 'Remove from group';
    unBtn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      folder.convs = folder.convs.filter(c => c.href !== href);
      saveData(() => renderFolders());
    });
    wrap.style.position = 'relative';
    wrap.appendChild(unBtn);
  }

  function buildFolderUI() {
    if (document.getElementById('ianto-folder-manager')) return;
    const anchor = document.querySelector('.ianto-native-wrap') || document.querySelector('a[href^="/c/"]');
    if (!anchor) return;
    const listNode = anchor.closest('ul') || anchor.closest('ol') || anchor.closest('nav') || anchor.parentElement;
    if (!listNode || !listNode.parentElement) return;
    const mgr = document.createElement('div');
    mgr.id = 'ianto-folder-manager';
    const hdr = document.createElement('div');
    hdr.className = 'ianto-header';
    hdr.innerHTML = '<span class="ianto-title">Groups</span><button class="ianto-new-btn" title="New group">+</button>';
    hdr.querySelector('.ianto-new-btn').addEventListener('click', () => createFolder());
    mgr.appendChild(hdr);
    listNode.parentElement.insertBefore(mgr, listNode);
  }

  // KEY: Gemini pattern - mark parent <li> as ianto-native-wrap, no new div created.
  // This preserves Grok native peer/menu-button CSS and three-dot menu event flow.
  function addClassifyButtons() {
    getConvLinks().forEach(a => {
      a.dataset.iantoGrok = '1';
      const href = a.getAttribute('href');
      const title = (a.title || a.querySelector('[class*="truncate"]')?.textContent?.trim() || a.textContent.trim()).substring(0, 80);
      const container = a.closest('li') || a.parentElement;
      if (!container || container.id === 'ianto-folder-manager') return;
      if (!container.classList.contains('ianto-native-wrap')) {
        container.classList.add('ianto-native-wrap');
        container.style.position = 'relative';
        container.setAttribute('draggable', 'true');
      }
      container.addEventListener('dragstart', e => {
        if (container.closest('#ianto-folder-manager')) return;
        const btn = e.target.closest('button');
        if (btn && !btn.classList.contains('ianto-classify-btn')) { e.preventDefault(); return; }
        dragSrc = 'native'; dragData = { href, title };
        e.dataTransfer.setData('text/plain', 'ianto-native');
        setTimeout(() => container.classList.add('dragging'), 0);
      });
      container.addEventListener('dragend', () => { container.classList.remove('dragging'); dragSrc = null; dragData = null; });
      const isClassified = folderData.some(f => f.convs && f.convs.some(c => c.href === href));
      if (!isClassified && !container.querySelector('.ianto-classify-btn')) {
        const btn = document.createElement('button');
        btn.className = 'ianto-classify-btn';
        btn.textContent = 'Group';
        btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); showClassifyModal(a, href, title); });
        container.appendChild(btn);
      }
    });
  }

  function showClassifyModal(convLink, href, title) {
    if (!folderData.length) {
      showInputModal('New group', '', 'Group name...', name => createFolder(href, title, name));
      return;
    }
    showSelectModal('Add to group', title,
      folderData.map((f, i) => [String(i), 'Folder: ' + f.name]),
      idxStr => {
        const folder = folderData[parseInt(idxStr)];
        if (folder) {
          if (!folder.convs) folder.convs = [];
          if (!folder.convs.some(c => c.href === href)) { folder.convs.push({ href, title }); saveData(() => renderFolders()); }
        }
      },
      () => showInputModal('New group', '', 'Group name...', name => createFolder(href, title, name))
    );
  }

  function createFolder(autoHref, autoTitle, predefinedName) {
    const doCreate = name => {
      const f = { name, convs: [], open: true };
      if (autoHref) f.convs.push({ href: autoHref, title: autoTitle || autoHref });
      folderData.push(f);
      saveData(() => renderFolders());
    };
    if (predefinedName) doCreate(predefinedName);
    else showInputModal('New group', '', 'Group name...', doCreate);
  }

  function deleteFolder(idx) {
    if (!confirm('Delete group "' + (folderData[idx]?.name || '') + '"?')) return;
    folderData.splice(idx, 1);
    saveData(() => renderFolders());
  }

  function syncAll() {
    addClassifyButtons();
    buildFolderUI();
    renderFolders();
  }

  function applyAll(enabled) {
    applyWidth(enabled);
    if (enabled) {
      injectCSS();
      if (!obs) {
        obs = new MutationObserver(() => {
          if (!isMounting && !document.getElementById('ianto-folder-manager')) {
            isMounting = true; buildFolderUI(); isMounting = false;
          }
          clearTimeout(uiTimer);
          uiTimer = setTimeout(syncAll, 350);
        });
        obs.observe(document.body, { childList: true, subtree: true });
      }
      syncAll();
      setTimeout(syncAll, 800);
      setTimeout(syncAll, 2000);
      setTimeout(syncAll, 4000);
      if (!window._iantoGrokInterval) {
        window._iantoGrokInterval = setInterval(() => {
          if (!isMounting && !document.getElementById('ianto-folder-manager')) {
            isMounting = true; buildFolderUI(); isMounting = false;
          }
          addClassifyButtons();
          renderFolders();
        }, 3000);
      }
    } else {
      if (obs) { obs.disconnect(); obs = null; }
      if (window._iantoGrokInterval) { clearInterval(window._iantoGrokInterval); window._iantoGrokInterval = null; }
      document.getElementById('ianto-folder-manager')?.remove();
      document.querySelectorAll('.ianto-native-wrap').forEach(c => {
        c.classList.remove('ianto-native-wrap', 'dragging');
        c.removeAttribute('draggable');
        c.querySelector('.ianto-classify-btn')?.remove();
        c.querySelector('.ianto-unarchive-btn')?.remove();
        c.querySelectorAll('a[data-ianto-grok]').forEach(a => delete a.dataset.iantoGrok);
      });
      document.getElementById(CSS_ID)?.remove();
    }
  }

  chrome.storage.local.get([WIDTH_KEY, FOLDER_KEY], r => {
    const data = r[FOLDER_KEY];
    if (Array.isArray(data)) {
      folderData = data;
    } else if (data && typeof data === 'object') {
      folderData = Object.entries(data).map(([_, f]) => ({ name: f.name, convs: f.convs || [], open: f.open !== false }));
      saveData();
    } else {
      folderData = [];
    }
    applyAll(!!r[WIDTH_KEY]);
  });

  chrome.runtime.onMessage.addListener((req, _, sendResponse) => {
    if (req.action === 'toggleGrokWidth') {
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