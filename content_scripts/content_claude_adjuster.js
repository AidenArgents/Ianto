// content_scripts/content_claude_adjuster.js

(function() {
    const styleId = 'claude-custom-width-style';
    const storageKey = 'claude_width_enabled';
    const folderDataKey = 'claude_custom_folders_data'; 

    let folderData = []; 
    let observer = null;

    // ==========================================
    // 1. 样式管理 
    // ==========================================
    function applyStyles(enabled) {
        let styleElement = document.getElementById(styleId);
        if (enabled) {
            if (!styleElement) {
                styleElement = document.createElement('style');
                styleElement.id = styleId;
                document.head.appendChild(styleElement);
                
                styleElement.textContent = `
                    /* === Claude 原生宽屏优化 === */
                    .max-w-3xl, .max-w-4xl, .mx-auto.w-full { max-width: 1500px !important; }
                    .grid-cols-1, .prose, [class*="content-"] { max-width: 1450px !important; }
                    [data-testid="attachment-card"], .flex.flex-col.gap-2 img { max-width: 500px !important; width: auto !important; }

                    /* === 全新侧边栏文件夹 UI === */
                    #ianto-folder-manager { margin: 8px 0 16px 0; padding: 0; font-family: inherit; display: flex; flex-direction: column; gap: 2px; color: inherit; }
                    .ianto-header { display: flex; justify-content: space-between; align-items: center; padding: 0 12px; margin-bottom: 4px; }
                    .ianto-title { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; opacity: 0.9; margin-left: 2px; transition: opacity 0.2s; }
                    .ianto-title:hover { opacity: 0.7; }
                    .ianto-new-btn { cursor: pointer; background: transparent; color: inherit; border: none; border-radius: 50px; padding: 4px 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px; transition: all 0.2s; opacity: 0.8; }
                    .ianto-new-btn:hover { background: rgba(128,128,128,0.15); opacity: 1; }
                    
                    .ianto-folder { transition: opacity 0.2s; position: relative; }
                    .ianto-folder.dragging { opacity: 0.4; }
                    .ianto-folder-title { margin: 0 8px; padding: 8px 8px; cursor: pointer; font-size: 13px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; border-radius: 8px; transition: background 0.2s; }
                    .ianto-folder-title:hover { background: rgba(128,128,128,0.08); }
                    .ianto-folder-content { display: none; flex-direction: column; padding-bottom: 4px;}
                    .ianto-folder-content.open { display: flex; }
                    
                    .ianto-chat-item { margin: 2px 8px 0 8px; padding: 8px 8px; font-size: 13px; display: flex; justify-content: space-between; align-items: center; gap: 8px; border-radius: 8px; text-decoration: none; color: inherit; opacity: 0.9; cursor: grab; position: relative; transition: all 0.2s ease; }
                    .ianto-chat-item.dragging { opacity: 0.4; background: rgba(128,128,128,0.15); }
                    .ianto-chat-item:hover { background: rgba(128,128,128,0.08); opacity: 1; }
                    .ianto-chat-title { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; pointer-events: none; }
                    
                    .ianto-chat-remove, .ianto-folder-del { cursor: pointer; padding: 4px; border-radius: 50%; opacity: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
                    .ianto-chat-item:hover .ianto-chat-remove, .ianto-folder-title:hover .ianto-folder-del { opacity: 0.6; }
                    .ianto-chat-remove:hover, .ianto-folder-del:hover { background: rgba(128,128,128,0.2); opacity: 1 !important; color: #d93025; }

                    .ianto-native-wrap { position: relative; cursor: grab;}
                    .ianto-native-wrap.dragging { opacity: 0.4; }
                    .ianto-classify-btn { position: absolute; right: 40px; top: 50%; transform: translateY(-50%); background: #d97757; color: #fff; border: none; border-radius: 6px; padding: 4px 10px; font-size: 11px; font-weight: bold; cursor: pointer; opacity: 0; visibility: hidden; transition: all 0.2s ease; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
                    .ianto-native-wrap:hover .ianto-classify-btn { opacity: 1; visibility: visible; }
                    .ianto-classify-btn:hover { background: #b86043; transform: translateY(-50%) scale(1.05); }

                    .ianto-unarchive-btn { position: absolute; right: 42px; top: 50%; transform: translateY(-50%); background: rgba(217, 119, 87, 0.1); color: #d97757; border: none; border-radius: 50%; width: 24px; height: 24px; display: flex; justify-content: center; align-items: center; cursor: pointer; opacity: 0; transition: all 0.2s ease; z-index: 100; }
                    .ianto-native-wrap:hover .ianto-unarchive-btn { opacity: 0.8; }
                    .ianto-unarchive-btn:hover { opacity: 1 !important; background: rgba(217, 119, 87, 0.2); }

                    .ianto-drag-top { box-shadow: 0 -2px 0 0 #d97757, inset 0 2px 5px rgba(217,119,87,0.1) !important; background: rgba(217,119,87,0.05) !important; }
                    .ianto-drag-bottom { box-shadow: 0 2px 0 0 #d97757, inset 0 -2px 5px rgba(217,119,87,0.1) !important; background: rgba(217,119,87,0.05) !important; }
                    .ianto-drag-into { background-color: rgba(217, 119, 87, 0.15) !important; box-shadow: inset 0 0 0 2px #d97757 !important; }

                    /* ================== 通用高级弹窗 (支持系统亮/暗色自动切换) ================== */
.ianto-modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.4); backdrop-filter: blur(4px); display: flex; justify-content: center; align-items: center; z-index: 999999; }

/* 默认：亮色模式 */
.ianto-modal-card { color-scheme: light dark; background: #ffffff; width: 340px; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.2); color: #202124; font-family: sans-serif; border: 1px solid rgba(0,0,0,0.1); }
.ianto-modal-title { font-size: 18px; font-weight: 600; margin-bottom: 8px; color: #000; }
.ianto-modal-desc { font-size: 14px; color: #5f6368; margin-bottom: 20px; line-height: 1.5; }
.ianto-modal-input, .ianto-modal-select { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 8px; border: 1px solid #dadce0; background: #f1f3f4; color: #202124; font-size: 14px; margin-bottom: 24px; outline: none; transition: border-color 0.2s; }
.ianto-modal-input:focus, .ianto-modal-select:focus { border-color: #1a73e8; }
.ianto-modal-select option { background-color: #ffffff; color: #202124; }
.ianto-modal-footer { display: flex; justify-content: flex-end; gap: 12px; }
.ianto-btn-cancel { padding: 8px 16px; border: none; background: transparent; color: #5f6368; cursor: pointer; border-radius: 20px; font-weight: 500; transition: background 0.2s; }
.ianto-btn-cancel:hover { background: rgba(0,0,0,0.05); color: #202124; }
.ianto-btn-confirm { padding: 8px 20px; border: none; background: #1a73e8; color: #ffffff; cursor: pointer; border-radius: 20px; font-weight: 600; transition: background 0.2s; }
.ianto-btn-confirm:hover { background: #185abc; }

/* 自动适应：暗色模式 */
@media (prefers-color-scheme: dark) {
    .ianto-modal-card { background: #202124; color: #e3e3e3; border: 1px solid rgba(255,255,255,0.1); }
    .ianto-modal-title { color: #fff; }
    .ianto-modal-desc { color: #9aa0a6; }
    .ianto-modal-input, .ianto-modal-select { border: 1px solid #5f6368; background: rgba(0,0,0,0.2); color: #fff; }
    .ianto-modal-input:focus, .ianto-modal-select:focus { border-color: #8ab4f8; }
    .ianto-modal-select option { background-color: #202124; color: #e3e3e3; }
    .ianto-btn-cancel { color: #9aa0a6; }
    .ianto-btn-cancel:hover { background: rgba(255,255,255,0.05); color: #fff; }
    .ianto-btn-confirm { background: #8ab4f8; color: #202124; }
    .ianto-btn-confirm:hover { background: #aecbfa; }
}
                `;
            }
            if (window.location.href.includes('claude.ai')) {
                initClaudeFolders();
                setupGlobalDragAndDrop();
            }
        } else {
            if (styleElement) styleElement.remove();
            if (observer) observer.disconnect();
            const manager = document.getElementById('ianto-folder-manager');
            if (manager) manager.remove();
            document.querySelectorAll('[data-ianto-hidden="true"]').forEach(el => { el.style.display = ''; el.removeAttribute('data-ianto-hidden'); });
            document.querySelectorAll('.ianto-classify-btn').forEach(el => el.remove());
        }
    }

    function showCustomModal({ title, desc, type, options, onConfirm }) {
        let modal = document.getElementById('ianto-custom-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'ianto-custom-modal';
            modal.className = 'ianto-modal-overlay';
            modal.innerHTML = `
                <div class="ianto-modal-card">
                    <div class="ianto-modal-title" id="ianto-modal-title"></div>
                    <div class="ianto-modal-desc" id="ianto-modal-desc"></div>
                    <input type="text" id="ianto-modal-input" class="ianto-modal-input" autocomplete="off" />
                    <select id="ianto-modal-select" class="ianto-modal-select"></select>
                    <div class="ianto-modal-footer">
                        <button class="ianto-btn-cancel" id="ianto-btn-cancel">取消</button>
                        <button class="ianto-btn-confirm" id="ianto-btn-confirm">确定</button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        document.getElementById('ianto-modal-title').innerText = title;
        document.getElementById('ianto-modal-desc').innerText = desc || '';
        const inputEl = document.getElementById('ianto-modal-input');
        const selectEl = document.getElementById('ianto-modal-select');
        inputEl.style.display = 'none'; selectEl.style.display = 'none';
        inputEl.value = ''; selectEl.innerHTML = '';

        if (type === 'input') {
            inputEl.style.display = 'block';
            inputEl.placeholder = '例如：技术文档、项目规划...';
            setTimeout(() => inputEl.focus(), 100);
        } else if (type === 'select') {
            selectEl.style.display = 'block';
            options.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt; o.innerText = opt; selectEl.appendChild(o);
            });
        }
        modal.style.display = 'flex';

        const confirmBtn = document.getElementById('ianto-btn-confirm');
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        document.getElementById('ianto-btn-cancel').onclick = () => modal.style.display = 'none';
        
        const handleConfirm = () => {
            const val = type === 'input' ? inputEl.value.trim() : (type === 'select' ? selectEl.value : null);
            if (val || type === 'alert') { onConfirm(val); modal.style.display = 'none'; }
        };
        newConfirmBtn.onclick = handleConfirm;
        inputEl.onkeydown = (e) => { if (e.key === 'Enter') handleConfirm(); };
    }

    function initClaudeFolders() {
        chrome.storage.local.get([folderDataKey], (result) => {
            let data = result[folderDataKey];
            if (!data) {
                folderData = [];
            } else if (!Array.isArray(data) && typeof data === 'object') {
                folderData = [];
                for (const [folderName, chats] of Object.entries(data)) {
                    folderData.push({ name: folderName, chats: chats, isOpen: true });
                }
                chrome.storage.local.set({ [folderDataKey]: folderData });
            } else {
                folderData = data;
            }
            observeSidebar(); 
        });
    }

    function saveFolders() {
        chrome.storage.local.set({ [folderDataKey]: folderData });
        renderFolderUI();
        processNativeChats(); 
    }

    function saveFoldersFromDOM() {
        const newFolderData = [];
        const folderEls = document.querySelectorAll('.ianto-folder');
        folderEls.forEach(folderEl => {
            const folderName = folderEl.querySelector('.ianto-folder-del').getAttribute('data-folder');
            const isOp = folderEl.querySelector('.ianto-folder-content').classList.contains('open');
            const chats = [];
            
            const contentNode = folderEl.querySelector('.ianto-folder-content');
            const children = Array.from(contentNode.children);
            
            children.forEach(child => {
                let url = null; let title = null;
                if (child.classList.contains('ianto-fake-item') && child.style.display !== 'none') {
                    url = child.getAttribute('data-url');
                    title = child.getAttribute('data-title');
                } else if (child.classList.contains('ianto-native-wrap')) {
                    const link = child.querySelector('a[href^="/chat/"]');
                    if (link) {
                        url = link.getAttribute('href');
                        let titleStr = link.innerText.split('\n')[0].trim();
                        if(titleStr.length < 3 && link.innerText.split('\n').length > 1) {
                            titleStr = link.innerText.split('\n')[1].trim();
                        }
                        title = titleStr || '未命名对话';
                    }
                }
                if (url && title) chats.push({ title, url });
            });

            const uniqueChats = [];
            const seenUrls = new Set();
            for (const c of chats) {
                if (!seenUrls.has(c.url)) { seenUrls.add(c.url); uniqueChats.push(c); }
            }
            newFolderData.push({ name: folderName, chats: uniqueChats, isOpen: isOp });
        });
        folderData = newFolderData;
        chrome.storage.local.set({ [folderDataKey]: folderData });
        processNativeChats(); 
    }

    function injectFolderUI() {
        if (document.getElementById('ianto-folder-manager')) return true;

        let insertAnchor = null;
        const links = Array.from(document.querySelectorAll('a[href^="/chat/"]')).filter(a => !a.classList.contains('ianto-fake-item'));
        
        if (links.length > 0) {
            const firstLink = links[0];
            let container = firstLink.closest('ol') || firstLink.closest('ul') || firstLink.parentElement.parentElement;
            if (container) {
                if (container.previousElementSibling && container.previousElementSibling.textContent.trim().length > 0 && container.previousElementSibling.textContent.trim().length < 20) {
                    insertAnchor = container.previousElementSibling;
                } else {
                    insertAnchor = container;
                }
            }
        }
        if (!insertAnchor || !insertAnchor.parentNode) return false;

        const manager = document.createElement('div');
        manager.id = 'ianto-folder-manager';
        manager.innerHTML = `
            <div class="ianto-header">
                <span class="ianto-title" id="ianto-main-toggle" title="点击展开/收起分类收藏">
                    <span id="ianto-main-caret" style="font-size:12px; margin-right:6px; display:inline-block; transition:transform 0.2s; transform: scale(1.3); position:relative; top:1px;">▼</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    分类收藏
                </span>
                <button class="ianto-new-btn" id="ianto-create-folder">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    新建
                </button>
            </div>
            <div id="ianto-folder-list"></div>
        `;
        insertAnchor.parentNode.insertBefore(manager, insertAnchor);

        document.getElementById('ianto-create-folder').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            showCustomModal({
                title: '新建分类',
                desc: '给你的新文件夹起个名字吧：',
                type: 'input',
                onConfirm: (name) => {
                    if (!folderData.some(f => f.name === name)) { 
                        folderData.push({ name: name, chats: [], isOpen: true }); 
                        saveFolders(); 
                        const listContainer = document.getElementById('ianto-folder-list');
                        if (listContainer.style.display === 'none') {
                            document.getElementById('ianto-main-toggle').click();
                        }
                    }
                }
            });
        });

        document.getElementById('ianto-main-toggle').addEventListener('click', () => {
            const listContainer = document.getElementById('ianto-folder-list');
            const caret = document.getElementById('ianto-main-caret');
            if (listContainer.style.display === 'none') {
                listContainer.style.display = 'block';
                caret.style.transform = 'scale(1.3) rotate(0deg)'; 
                chrome.storage.local.set({ 'claude_main_folder_open': true });
            } else {
                listContainer.style.display = 'none';
                caret.style.transform = 'scale(1.3) rotate(-90deg)'; 
                chrome.storage.local.set({ 'claude_main_folder_open': false });
            }
        });

        chrome.storage.local.get(['claude_main_folder_open'], (res) => {
            if (res.claude_main_folder_open === false) {
                document.getElementById('ianto-folder-list').style.display = 'none';
                document.getElementById('ianto-main-caret').style.transform = 'scale(1.3) rotate(-90deg)';
            } else {
                document.getElementById('ianto-main-caret').style.transform = 'scale(1.3) rotate(0deg)';
            }
        });

        renderFolderUI();
        return true;
    }

    function renderFolderUI() {
        const listContainer = document.getElementById('ianto-folder-list');
        if (!listContainer) return;
        
        listContainer.innerHTML = '';
        for (const folder of folderData) {
            const folderName = folder.name;
            const chats = folder.chats;
            const isOp = folder.isOpen !== false; 
            const openClass = isOp ? ' open' : '';
            const iconChar = isOp ? '▼' : '▶';

            const folderEl = document.createElement('div');
            folderEl.className = 'ianto-folder';
            folderEl.draggable = true; 
            
            let chatsHtml = chats.map(chat => `
                <a href="${chat.url}" class="ianto-chat-item ianto-fake-item" data-url="${chat.url}" data-title="${chat.title}" draggable="true">
                    <span class="ianto-chat-title" title="${chat.title}">${chat.title}</span>
                    <span class="ianto-chat-remove" data-url="${chat.url}" data-folder="${folderName}" title="移出分类 (刷新页面)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </span>
                </a>
            `).join('');

            folderEl.innerHTML = `
                <div class="ianto-folder-title">
                    <span>
                        <span class="ianto-icon-sub" style="font-size:11px; margin-right:4px; display:inline-block; position:relative; top:-1px;">${iconChar}</span>
                        ${folderName} 
                        <span style="opacity:0.5; font-size:11px; margin-left:4px;">(${chats.length})</span>
                    </span>
                    <span class="ianto-folder-del" data-folder="${folderName}" title="解散文件夹">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </span>
                </div>
                <div class="ianto-folder-content${openClass}">${chatsHtml}</div>
            `;
            listContainer.appendChild(folderEl);
        }

        listContainer.querySelectorAll('.ianto-folder-title').forEach(title => {
            title.addEventListener('click', (e) => {
                if (e.target.closest('.ianto-folder-del')) return;
                const content = title.nextElementSibling;
                const icon = title.querySelector('.ianto-icon-sub');
                content.classList.toggle('open');
                const currentIsOp = content.classList.contains('open');
                icon.innerText = currentIsOp ? '▼' : '▶';

                const folderName = title.querySelector('.ianto-folder-del').getAttribute('data-folder');
                let targetFolder = folderData.find(f => f.name === folderName);
                if (targetFolder) {
                    targetFolder.isOpen = currentIsOp;
                    chrome.storage.local.set({ [folderDataKey]: folderData });
                }
            });
        });

        listContainer.querySelectorAll('.ianto-folder-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const folderName = e.currentTarget.getAttribute('data-folder');
                showCustomModal({
                    title: '解散文件夹',
                    desc: `确定要解散分类 [${folderName}] 吗？\n解散后将刷新页面，原生对话会安全还原。`,
                    type: 'alert',
                    onConfirm: () => { 
                        folderData = folderData.filter(f => f.name !== folderName); 
                        chrome.storage.local.set({ [folderDataKey]: folderData }, () => window.location.reload());
                    }
                });
            });
        });

        listContainer.querySelectorAll('.ianto-chat-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const folderName = e.currentTarget.getAttribute('data-folder');
                const url = e.currentTarget.getAttribute('data-url');
                let targetFolder = folderData.find(f => f.name === folderName);
                if (targetFolder) {
                    targetFolder.chats = targetFolder.chats.filter(c => c.url !== url);
                }
                chrome.storage.local.set({ [folderDataKey]: folderData }, () => window.location.reload());
            });
        });
    }

    function processNativeChats() {
        const chatLinks = document.querySelectorAll('a[href^="/chat/"]');
        chatLinks.forEach(link => {
            const url = link.getAttribute('href');
            if(url.length < 20 || link.classList.contains('ianto-fake-item')) return;

            const container = link.closest('li') || link.parentElement;
            if (container.classList.contains('ianto-folder')) return;

            // 【修复重复】检查是否已经被处理过
            if (container.classList.contains('ianto-native-wrap')) return;

            let targetFolder = folderData.find(f => f.chats.some(c => c.url === url));

            if (targetFolder) {
                const folderName = targetFolder.name;
                const folderTitleDel = document.querySelector(`.ianto-folder-del[data-folder="${folderName}"]`);
                if (folderTitleDel) {
                    const folderContent = folderTitleDel.closest('.ianto-folder').querySelector('.ianto-folder-content');

                    if (container.parentElement !== folderContent) {
                        // 【核心修复：精准替换位置，绝不插队到最后面】
                        const fakeItem = folderContent.querySelector(`.ianto-fake-item[data-url="${url}"]`);
                        if (fakeItem) {
                            folderContent.insertBefore(container, fakeItem);
                            fakeItem.style.display = 'none';
                        } else {
                            folderContent.appendChild(container); // 兜底
                        }

                        container.classList.add('ianto-native-wrap');
                        container.setAttribute('draggable', 'true');
                        container.style.display = '';
                        container.removeAttribute('data-ianto-hidden');

                        // 【修复时间戳】移除时间戳显示
                        const timeElements = container.querySelectorAll('[class*="ago"], [class*="time"], [data-testid*="time"]');
                        timeElements.forEach(el => el.style.display = 'none');

                        const archiveBtn = container.querySelector('.ianto-classify-btn');
                        if (archiveBtn) archiveBtn.style.display = 'none';

                        if (!container.querySelector('.ianto-unarchive-btn')) {
                            const unBtn = document.createElement('button');
                            unBtn.className = 'ianto-unarchive-btn';
                            unBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                            unBtn.title = "移出分类 (将自动刷新页面)";
                            unBtn.onclick = (e) => {
                                e.preventDefault(); e.stopPropagation();
                                targetFolder.chats = targetFolder.chats.filter(c => c.url !== url);
                                chrome.storage.local.set({ [folderDataKey]: folderData }, () => {
                                    window.location.reload();
                                });
                            };
                            container.style.position = 'relative';
                            container.appendChild(unBtn);
                        }
                    }
                }
            } else {
                if (container.parentElement && container.parentElement.classList.contains('ianto-folder-content')) {
                    container.style.display = 'none';
                    return;
                }

                container.style.display = '';
                container.removeAttribute('data-ianto-hidden');

                if (!container.hasAttribute('draggable')) {
                    container.classList.add('ianto-native-wrap');
                    container.setAttribute('draggable', 'true');

                    const btn = document.createElement('button');
                    btn.className = 'ianto-classify-btn';
                    btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:text-bottom; margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>归档`;
                    
                    btn.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const foldersList = folderData.map(f => f.name);
                        if (foldersList.length === 0) {
                            showCustomModal({
                                title: '无法操作', desc: '还没有分类文件夹，请先在上方点击“新建”创建一个！', type: 'alert', onConfirm: () => {}
                            });
                            return;
                        }
                        showCustomModal({
                            title: '移动到分类',
                            desc: '请选择你想把该对话存入哪个文件夹：',
                            type: 'select',
                            options: foldersList,
                            onConfirm: (fName) => {
                                let titleStr = link.innerText.split('\n')[0].trim();
                                if(titleStr.length < 3 && link.innerText.split('\n').length > 1) {
                                    titleStr = link.innerText.split('\n')[1].trim();
                                }
                                const title = titleStr || '未命名对话';
                                
                                let tFolder = folderData.find(f => f.name === fName);
                                if (tFolder) {
                                    tFolder.chats.push({ title: title, url: url });
                                    saveFolders();
                                }
                                const listContainer = document.getElementById('ianto-folder-list');
                                if (listContainer && listContainer.style.display === 'none') {
                                    document.getElementById('ianto-main-toggle').click();
                                }
                            }
                        });
                    });
                    container.appendChild(btn);
                } else {
                    const archiveBtn = container.querySelector('.ianto-classify-btn');
                    if (archiveBtn) archiveBtn.style.display = '';
                    const unBtn = container.querySelector('.ianto-unarchive-btn');
                    if (unBtn) unBtn.remove();
                }
            }
        });
    }

    // ==========================================
    // 4. 全局原生拖拽事件管理 (🚀 修复文件夹拖拽不动的 Bug)
    // ==========================================
    function setupGlobalDragAndDrop() {
        if (window.iantoDndInitialized) return;
        window.iantoDndInitialized = true;

        let dragSrcEl = null;
        let dragType = null; 

        function clearDragIndicators() {
            document.querySelectorAll('.ianto-drag-top, .ianto-drag-bottom, .ianto-drag-into').forEach(el => {
                el.classList.remove('ianto-drag-top', 'ianto-drag-bottom', 'ianto-drag-into');
            });
        }

        document.addEventListener('dragstart', function(e) {
            const target = e.target;
            const nativeWrap = target.closest && target.closest('.ianto-native-wrap');
            const fakeItem = target.closest && target.closest('.ianto-fake-item');
            const folder = target.closest && target.closest('.ianto-folder');

            if (nativeWrap) {
                dragSrcEl = nativeWrap;
                dragType = dragSrcEl.closest('.ianto-folder') ? 'teleported-chat' : 'native-chat';
                const link = dragSrcEl.querySelector('a[href^="/chat/"]');
                if (link) {
                    let titleStr = link.innerText.split('\n')[0].trim();
                    if(titleStr.length < 3 && link.innerText.split('\n').length > 1) {
                        titleStr = link.innerText.split('\n')[1].trim();
                    }
                    const title = titleStr || '未命名对话';
                    const url = link.getAttribute('href');
                    if (e.dataTransfer) {
                        e.dataTransfer.setData('application/json', JSON.stringify({title, url}));
                        e.dataTransfer.setData('text/plain', 'ianto-custom-drag'); 
                    }
                }
            } else if (fakeItem) {
                dragSrcEl = fakeItem;
                dragType = 'fake-chat';
                if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'ianto-fake-drag');
            } else if (folder) {
                dragSrcEl = folder;
                dragType = 'folder';
                if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'ianto-folder-drag');
            } else {
                dragType = null; dragSrcEl = null; return;
            }
            
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => dragSrcEl.classList.add('dragging'), 0);
        }, true);

        document.addEventListener('dragenter', function(e) { if (dragType) { e.preventDefault(); e.stopPropagation(); } }, true);
        document.addEventListener('dragleave', function(e) { if (dragType) { e.stopPropagation(); } }, true);

        document.addEventListener('dragover', function(e) {
            if (!dragType) return;
            e.preventDefault(); 
            e.stopPropagation();
            clearDragIndicators();

            const target = e.target;
            const folder = target.closest('.ianto-folder');
            
            if (dragType === 'folder') {
                if (folder && folder !== dragSrcEl) {
                    // 🚀 精准打击：只用标题栏作为碰撞箱，展开时依然顺滑如丝！
                    const titleNode = folder.querySelector('.ianto-folder-title');
                    const rect = (titleNode || folder).getBoundingClientRect();
                    const isTopHalf = (e.clientY - rect.top) / rect.height < 0.5;
                    if (isTopHalf) (titleNode || folder).classList.add('ianto-drag-top');
                    else (titleNode || folder).classList.add('ianto-drag-bottom');
                }
            } 
            else if (dragType === 'fake-chat' || dragType === 'teleported-chat' || dragType === 'native-chat') {
                const chatItem = target.closest('.ianto-fake-item') || target.closest('.ianto-native-wrap');
                const folderTitle = target.closest('.ianto-folder-title');

                if (chatItem && chatItem !== dragSrcEl && chatItem.closest('.ianto-folder')) {
                    const rect = chatItem.getBoundingClientRect();
                    const isTopHalf = (e.clientY - rect.top) / rect.height < 0.5;
                    if (isTopHalf) chatItem.classList.add('ianto-drag-top');
                    else chatItem.classList.add('ianto-drag-bottom');
                } 
                else if (folderTitle || (folder && !chatItem)) {
                    if (folder) folder.classList.add('ianto-drag-into');
                    const content = folder.querySelector('.ianto-folder-content');
                    if (content && !content.classList.contains('open')) {
                        content.classList.add('open');
                        const icon = folder.querySelector('.ianto-icon-sub');
                        if(icon) icon.innerText = '▼';
                    }
                }
            }
        }, true);

        document.addEventListener('drop', function(e) {
            if (!dragType) return;
            e.preventDefault();
            e.stopPropagation();
            
            const target = e.target;
            const folder = target.closest('.ianto-folder');
            const chatItem = target.closest('.ianto-fake-item') || target.closest('.ianto-native-wrap');

            if ((dragType === 'fake-chat' || dragType === 'teleported-chat') && chatItem && chatItem !== dragSrcEl && chatItem.closest('.ianto-folder')) {
                const rect = chatItem.getBoundingClientRect();
                const isTopHalf = (e.clientY - rect.top) / rect.height < 0.5;
                chatItem.parentNode.insertBefore(dragSrcEl, isTopHalf ? chatItem : chatItem.nextSibling);
                saveFoldersFromDOM();
            } 
            else if (folder && dragType !== 'folder') {
                const folderName = folder.querySelector('.ianto-folder-del').getAttribute('data-folder');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('application/json'));
                    if (data.url && data.title) {
                        let tFolder = folderData.find(f => f.name === folderName);
                        if (!tFolder) {
                            tFolder = { name: folderName, chats: [], isOpen: true };
                            folderData.push(tFolder);
                        }
                        
                        if (dragType === 'native-chat') {
                            tFolder.chats.push(data);
                            saveFolders(); 
                        } else {
                            const content = folder.querySelector('.ianto-folder-content');
                            if (content && !content.contains(dragSrcEl)) {
                                content.appendChild(dragSrcEl);
                                saveFoldersFromDOM();
                            }
                        }
                        
                        const listContainer = document.getElementById('ianto-folder-list');
                        if (listContainer && listContainer.style.display === 'none') {
                            document.getElementById('ianto-main-toggle').click();
                        }
                    }
                } catch(err) {}
            }
            else if (dragType === 'folder' && dragSrcEl) {
                if (folder && folder !== dragSrcEl) {
                    const listContainer = document.getElementById('ianto-folder-list');
                    const titleNode = folder.querySelector('.ianto-folder-title');
                    const rect = (titleNode || folder).getBoundingClientRect();
                    const isTopHalf = (e.clientY - rect.top) / rect.height < 0.5;
                    listContainer.insertBefore(dragSrcEl, isTopHalf ? folder : folder.nextSibling);
                    saveFoldersFromDOM();
                }
            }

            clearDragIndicators();
        }, true);

        document.addEventListener('dragend', function(e) {
            if (dragType) { e.stopPropagation(); }
            if (dragSrcEl) dragSrcEl.classList.remove('dragging');
            clearDragIndicators();
            dragType = null; dragSrcEl = null;
        }, true);
    }

    function observeSidebar() {
        if (observer) observer.disconnect();
        let isMounting = false;
        observer = new MutationObserver(() => {
            if (!isMounting && !document.getElementById('ianto-folder-manager')) {
                isMounting = true; injectFolderUI(); isMounting = false;
            }
            processNativeChats();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setInterval(() => {
            if (!isMounting && !document.getElementById('ianto-folder-manager')) {
                isMounting = true; injectFolderUI(); processNativeChats(); isMounting = false;
            }
        }, 1000);
    }

    // ==========================================
    // 5. 插件通信 & 启动逻辑
    // ==========================================
    chrome.storage.local.get([storageKey], (result) => {
        applyStyles(result[storageKey] !== false); 
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggleClaudeWidth') {
            chrome.storage.local.get([storageKey], (result) => {
                const newState = !(result[storageKey] !== false); 
                chrome.storage.local.set({ [storageKey]: newState }, () => {
                    applyStyles(newState);
                    sendResponse({ status: "done", enabled: newState });
                });
            });
            return true;
        }
    });
})();