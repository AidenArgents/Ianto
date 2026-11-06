// content_scripts/content_gemini_adjuster.js

(function() {
    const styleId = 'gemini-custom-width-style';
    const storageKey = 'gemini_optimized_enabled'; 
    const folderDataKey = 'gemini_custom_folders_data'; 

    let folderData = []; 
    let observer = null;
    let sidebarSyncTimer = null;
    let sidebarSyncInterval = null;
    let sidebarSyncing = false;
    let optimizationEnabled = false;

    // ==========================================
    // 1. 样式管理 
    // ==========================================
    function applyStyles(enabled) {
        optimizationEnabled = enabled;
        let styleElement = document.getElementById(styleId);
        if (enabled) {
            if (!styleElement) {
                styleElement = document.createElement('style');
                styleElement.id = styleId;
                document.head.appendChild(styleElement);

                styleElement.textContent = `
                    /* === Gemini & NotebookLM 宽屏 === */
                    div.conversation-container { max-width: 1600px !important; margin: 0 auto !important; }
                    [data-test-id="chat-history-container"] { max-width: 1500px !important; margin: 0 auto !important; padding: 20px !important; }
                    .response-content { max-width: 1500px !important; margin: 0 auto !important; padding: 0 !important; }
                    /* Gemini 新版会给 markdown 顶层段落/标题重新加 708px 宽度和 390px 左右边距，
                       只放宽外层容器不够，会在对话左侧留下大块空白。宽屏模式需要同步覆盖这一层。 */
                    .markdown.markdown-main-panel > *,
                    .markdown-main-panel > * {
                        width: 100% !important;
                        max-width: 100% !important;
                        margin-left: 0 !important;
                        margin-right: 0 !important;
                        box-sizing: border-box !important;
                    }
                    user-query { width: 100% !important; max-width: 1500px !important; display: flex !important; justify-content: flex-end !important; margin: 0 !important; }
                    user-query .user-query-container.right-align-content { margin-left: auto !important; margin-right: 0 !important; }
                    .user-query-bubble-with-background { max-width: 750px !important; }

                    .section-container, .chat-message-pair, .chat-message-pair.is-rich-chat-ui { max-inline-size: 1600px !important; max-width: 1600px !important; width: 100% !important; margin-left: auto !important; margin-right: auto !important; }
                    .to-user-message-card-content, .from-user-message-card-content, .message-content { max-inline-size: 1500px !important; max-width: 1500px !important; }
                    omnibar { display: block !important; width: 100% !important; max-inline-size: 1600px !important; max-width: 1600px !important; margin-left: auto !important; margin-right: auto !important; }
                    .omnibar-container { max-width: 100% !important; max-inline-size: 100% !important; }

                    /* === 放开表格与“导出表格”区域的宽度限制 === */
                    .markdown, 
                    .markdown table, 
                    .markdown-table-container, 
                    div[class*="table-wrapper"], 
                    div[class*="table-container"],
                    .message-content table {
                        max-width: 100% !important;
                        width: 100% !important;
                    }
                    .message-content > div, 
                    .response-content > div, 
                    .model-response-text,
                    div[class*="export-button"], 
                    [data-test-id*="table"] {
                        max-width: 100% !important;
                        max-inline-size: 100% !important;
                    }

                    /* === 全新侧边栏文件夹 UI === */
                    #ianto-folder-manager { 
                        margin: 8px 0 16px 0; padding: 0; 
                        font-family: inherit; display: flex; flex-direction: column; gap: 2px; 
                        color: var(--md-sys-color-on-surface, inherit); 
                        width: 100%; max-width: 100%; min-width: 0;
                        box-sizing: border-box; flex: 0 0 auto; align-self: stretch;
                        overflow: visible;
                    }
                    .ianto-header { display: flex; justify-content: space-between; align-items: center; padding: 0 16px; margin-bottom: 4px; min-width: 0; box-sizing: border-box; }
                    .ianto-title { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; opacity: 0.9; margin-left: 2px; transition: opacity 0.2s; }
                    .ianto-title:hover { opacity: 0.7; }
                    .ianto-new-btn { cursor: pointer; background: transparent; color: inherit; border: none; border-radius: 50px; padding: 4px 8px; font-size: 12px; font-weight: 600; display: flex; align-items: center; gap: 4px; transition: all 0.2s; opacity: 0.8; }
                    .ianto-new-btn:hover { background: rgba(128,128,128,0.15); opacity: 1; }
                    
                    .ianto-folder { transition: opacity 0.2s; position: relative; }
                    .ianto-folder.dragging { opacity: 0.4; }
                    .ianto-folder-title { margin: 0 8px; padding: 10px 8px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; border-radius: 50px; transition: background 0.2s; }
                    .ianto-folder-title:hover { background: rgba(128,128,128,0.08); }
                    
                    /* 文件夹内容区 */
                    .ianto-folder-content { display: none; flex-direction: column; padding: 0; margin: 0; list-style: none; }
                    .ianto-folder-content.open { display: flex; }
                    
                    /* Fake 假节点样式 (替身) */
                    .ianto-chat-item { margin: 2px 8px 0 8px; padding: 8px 8px 8px 12px; font-size: 14px; display: flex; justify-content: space-between; align-items: center; gap: 4px; height: 38px; min-height: 38px; max-height: 38px; box-sizing: border-box; border-radius: 50px; text-decoration: none; color: inherit; opacity: 0.9; cursor: grab; position: relative; transition: all 0.2s ease; }
                    .ianto-chat-item.dragging { opacity: 0.4; background: rgba(128,128,128,0.15); }
                    .ianto-chat-item:hover { background: rgba(128,128,128,0.08); opacity: 1; }
                    .ianto-chat-title { flex: 1 1 auto; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; line-height: 1.35; padding: 1px 0; pointer-events: none;}
                    
                    /* 分类替身只渲染标题；移出分类按钮浮在行上方，不为隐藏状态预留横向空间。 */
                    .ianto-chat-remove { position: absolute; right: 6px; top: 50%; transform: translateY(-50%); cursor: pointer; padding: 4px; border: 0; border-radius: 50%; opacity: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; box-sizing: border-box; }
                    .ianto-folder-del { cursor: pointer; padding: 4px; border-radius: 50%; opacity: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; flex: 0 0 28px; width: 28px; height: 28px; box-sizing: border-box; }
                    .ianto-chat-item:hover .ianto-chat-remove, .ianto-folder-title:hover .ianto-folder-del { opacity: 0.72; visibility: visible; }
                    .ianto-chat-remove:hover, .ianto-folder-del:hover { background: rgba(128,128,128,0.2); opacity: 1 !important; color: #d93025; }


                    /* === 原生传送节点的“防弹药丸”样式 === */
                    .ianto-native-wrap { position: relative; cursor: grab;}
                    .ianto-native-wrap.dragging { opacity: 0.4; }

                    .ianto-folder-content .ianto-native-wrap {
                        margin: 2px 8px 0 8px !important; 
                        padding: 0 !important; 
                        border-radius: 50px !important; 
                        list-style: none !important;
                        height: 38px !important;
                        min-height: 38px !important;
                        max-height: 38px !important;
                        position: relative !important;
                        background: transparent !important;
                        transition: background 0.2s ease !important;
                        display: block !important;    
                        overflow: visible !important; 
                    }
                    
                    .ianto-folder-content .ianto-native-wrap:hover {
                        background: rgba(128, 128, 128, 0.08) !important; 
                    }

                    .ianto-folder-content .ianto-native-wrap a[href*="/app/"] {
                        color: var(--md-sys-color-on-surface, #e3e3e3) !important;
                        text-decoration: none !important;
                        display: flex !important;
                        align-items: center !important;
                        min-height: 38px !important;
                        height: 38px !important;
                        padding-left: 12px !important; 
                        box-sizing: border-box !important;
                    }

                    .ianto-folder-content .ianto-native-wrap a[href*="/app/"] .title-text {
                        white-space: nowrap !important;
                        overflow: hidden !important;
                        text-overflow: ellipsis !important;
                        overflow-wrap: normal !important;
                        line-height: 1.35 !important;
                    }

                    .ianto-folder-content .ianto-native-wrap:hover button[aria-label*="更多选项"] {
                        visibility: visible !important;
                        opacity: 1 !important;
                    }

                    .ianto-folder-content .ianto-native-wrap a[href*="/app/"] * {
                        margin: 0 !important;
                        line-height: 1.2 !important;
                    }

                    /* 原生列表处的归档按钮 */
                    .ianto-classify-btn { position: absolute; right: 40px; top: 50%; transform: translateY(-50%); background: #0b57d0; color: #fff; border: none; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: bold; cursor: pointer; opacity: 0; visibility: hidden; transition: all 0.2s ease; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
                    .ianto-native-wrap:hover .ianto-classify-btn { opacity: 1; visibility: visible; }
                    .ianto-classify-btn:hover { background: #0842a0; transform: translateY(-50%) scale(1.05); }

                    /* 移出分类的小红减号 */
                    .ianto-unarchive-btn { position: absolute !important; right: 44px !important; top: 50% !important; transform: translateY(-50%) !important; background: rgba(217, 48, 37, 0.1) !important; color: #d93025 !important; border: none !important; border-radius: 50% !important; width: 22px !important; height: 22px !important; display: flex !important; justify-content: center !important; align-items: center !important; cursor: pointer !important; opacity: 0 !important; transition: all 0.2s ease !important; z-index: 100 !important; }
                    .ianto-native-wrap:hover .ianto-unarchive-btn { opacity: 0.8 !important; }
                    .ianto-unarchive-btn:hover { opacity: 1 !important; background: rgba(217, 48, 37, 0.2) !important; }

                    /* 拖拽提示线 */
                    .ianto-drag-top { box-shadow: 0 -2px 0 0 #0b57d0, inset 0 2px 5px rgba(11,87,208,0.1) !important; background: rgba(11,87,208,0.05) !important; }
                    .ianto-drag-bottom { box-shadow: 0 2px 0 0 #0b57d0, inset 0 -2px 5px rgba(11,87,208,0.1) !important; background: rgba(11,87,208,0.05) !important; }
                    .ianto-drag-into { background-color: rgba(11, 87, 208, 0.15) !important; box-shadow: inset 0 0 0 2px #0b57d0 !important; }

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
/* === NotebookLM 文件夹标题栏自适应 (解决白条问题) === */
.nlm-folder-title {
    background: #f0f4f9 !important;
    color: #202124 !important;
    border-radius: 50px !important;
}

/* 自动识别系统暗色模式：消除截图中的白条 */
@media (prefers-color-scheme: dark) {
    .nlm-folder-title {
        background: #28292a !important;
        color: #e3e3e3 !important;
    }
}

/* 兼容性处理：如果页面带有暗色类名 */
.dark-theme .nlm-folder-title {
    background: #28292a !important;
    color: #e3e3e3 !important;
}

/* === NotebookLM 新建按钮主题自适应 === */
#nlm-create-folder {
    background: #f0f4f9 !important;
    color: #202124 !important;
}

@media (prefers-color-scheme: dark) {
    #nlm-create-folder {
        background: #28292a !important;
        color: #e3e3e3 !important;
    }
}

.dark-theme #nlm-create-folder {
    background: #28292a !important;
    color: #e3e3e3 !important;
}
                `;
            }
            if (window.location.href.includes('gemini.google.com')) {
                initGeminiFolders();
                setupGlobalDragAndDrop();
            }
            if (window.location.href.includes('notebook.google.com') || window.location.href.includes('gemini.google.com')) {
                initNLMFolders();
                setupNLMDragAndDrop();
            }
        } else {
            if (styleElement) styleElement.remove();
            if (observer) observer.disconnect();
            if (sidebarSyncTimer) {
                clearTimeout(sidebarSyncTimer);
                sidebarSyncTimer = null;
            }
            if (sidebarSyncInterval) {
                clearInterval(sidebarSyncInterval);
                sidebarSyncInterval = null;
            }
            const manager = document.getElementById('ianto-folder-manager');
            if (manager) manager.remove();
            document.querySelectorAll('[data-ianto-hidden="true"]').forEach(el => { el.style.display = ''; el.removeAttribute('data-ianto-hidden'); });
            document.querySelectorAll('.ianto-classify-btn').forEach(el => el.remove());
            // NotebookLM 清理
            if (observerNLM) observerNLM.disconnect();
            observerNLM = null;
            if (nlmSyncInterval) clearInterval(nlmSyncInterval);
            nlmSyncInterval = null;
            restoreNLMNativeChats();
            const nlmManager = document.getElementById('nlm-folder-manager');
            if (nlmManager) nlmManager.remove();
            document.querySelectorAll('.nlm-classify-btn').forEach(el => el.remove());
            document.querySelectorAll('.featured-projects-container').forEach(el => el.style.display = '');
        }
    }

    // ==========================================
    // 2. 自定义高级弹窗系统
    // ==========================================
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
            inputEl.placeholder = '例如：工作规划、代码片段...';
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

    // ==========================================
    // 3. 文件夹核心逻辑 
    // ==========================================
    function initGeminiFolders() {
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
            // 【清理null文件夹】
            folderData = folderData.filter(f => f && f.name !== null && f.name !== undefined && f.name !== '');
            chrome.storage.local.set({ [folderDataKey]: folderData });
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
                    const link = child.querySelector('a[href*="/app/"]');
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

    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = String(value ?? '');
        return div.innerHTML;
    }

    function getGeminiSidebarContext() {
        const scrollRoot = document.querySelector('side-navigation-content infinite-scroller');
        if (!scrollRoot) return null;

        // 2026 版 Gemini 暴露了稳定的 data-test-id。只允许在侧栏滚动区的直接子节点中找聊天区，
        // 避免再次把分类面板误挂到“对话”模式按钮或其他同名元素里。
        let chatsSection = scrollRoot.querySelector(':scope > expandable-section[data-test-id="chats-expandable-section"]');
        if (!chatsSection) {
            chatsSection = Array.from(scrollRoot.children).find(el =>
                el.tagName === 'EXPANDABLE-SECTION' &&
                !!el.querySelector('conversations-list[data-test-id="all-conversations"]')
            ) || null;
        }

        if (!chatsSection || chatsSection.parentElement !== scrollRoot) return null;
        return {
            scrollRoot,
            chatsSection,
            conversationsList: chatsSection.querySelector('conversations-list[data-test-id="all-conversations"]')
        };
    }

    function injectFolderUI() {
        const sidebar = getGeminiSidebarContext();
        if (!sidebar) return false;

        const existingManager = document.getElementById('ianto-folder-manager');
        if (existingManager) {
            const isCorrectlyPlaced =
                existingManager.parentElement === sidebar.scrollRoot &&
                existingManager.nextElementSibling === sidebar.chatsSection;
            if (!isCorrectlyPlaced) {
                sidebar.scrollRoot.insertBefore(existingManager, sidebar.chatsSection);
            }
            return true;
        }

        const manager = document.createElement('div');
        manager.id = 'ianto-folder-manager';
        manager.innerHTML = `
            <div class="ianto-header">
                <span class="ianto-title" id="ianto-main-toggle" title="点击展开/收起分类收藏">
                    <span id="ianto-main-caret" style="font-size:12px; margin-right:6px; display:inline-block; transition:transform 0.2s; transform: scale(1.3); position:relative; top:1px;">▼</span>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    分类收藏
                </span>
                <button class="ianto-new-btn" id="ianto-create-folder">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    新建
                </button>
            </div>
            <div id="ianto-folder-list"></div>
        `;
        sidebar.scrollRoot.insertBefore(manager, sidebar.chatsSection);

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
                chrome.storage.local.set({ 'gemini_main_folder_open': true });
            } else {
                listContainer.style.display = 'none';
                caret.style.transform = 'scale(1.3) rotate(-90deg)'; 
                chrome.storage.local.set({ 'gemini_main_folder_open': false });
            }
        });

        chrome.storage.local.get(['gemini_main_folder_open'], (res) => {
            if (res.gemini_main_folder_open === false) {
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
            const folderName = String(folder.name ?? '未命名分类');
            const chats = folder.chats;
            const isOp = folder.isOpen !== false; 
            const openClass = isOp ? ' open' : '';
            const iconChar = isOp ? '▼' : '▶';

            const folderEl = document.createElement('div');
            folderEl.className = 'ianto-folder';
            folderEl.draggable = true; 
            
            let chatsHtml = chats.map(chat => {
                const url = escapeHtml(chat.url);
                const title = escapeHtml(chat.title || '未命名对话');
                return `
                <a href="${url}" class="ianto-chat-item ianto-fake-item" data-url="${url}" data-title="${title}" draggable="true">
                    <span class="ianto-chat-title" title="${title}">${title}</span>
                    <span class="ianto-chat-remove" data-url="${url}" data-folder="${escapeHtml(folderName)}" title="移出分类 (刷新页面)">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </span>
                </a>
                `;
            }).join('');

            folderEl.innerHTML = `
                <div class="ianto-folder-title">
                    <span>
                        <span class="ianto-icon-sub" style="font-size:11px; margin-right:4px; display:inline-block; position:relative; top:-1px;">${iconChar}</span>
                        ${escapeHtml(folderName)} 
                        <span style="opacity:0.5;font-size:11px;margin-left:4px;">(${chats.length})</span>
                    </span>
                    <span class="ianto-folder-del" data-folder="${escapeHtml(folderName)}" title="解散文件夹（对话不丢失）">
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
                    desc: `确定要解散分类 [${folderName}] 吗？\n\n（解散后将刷新页面，里面的对话安全回到下方原列表中）`,
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
        const sidebar = getGeminiSidebarContext();
        const manager = document.getElementById('ianto-folder-manager');
        if (!sidebar || !manager || manager.parentElement !== sidebar.scrollRoot) return;

        const rowSelector = 'gem-nav-list-item[data-test-id="conversation"]';
        const chatRows = [
            ...sidebar.chatsSection.querySelectorAll(rowSelector),
            ...manager.querySelectorAll(rowSelector)
        ];

        Array.from(new Set(chatRows)).forEach(container => {
            const link = container.querySelector('a[href*="/app/"]');
            if (!link) return;
            const url = link.getAttribute('href');
            if(url === "/app/" || url.endsWith("/app") || link.classList.contains('ianto-fake-item')) return;
            if (container.classList.contains('ianto-folder')) return;

            let targetFolder = folderData.find(f => f.chats.some(c => c.url === url));

            if (targetFolder) {
                const folderName = targetFolder.name;
                const folderTitleDel = document.querySelector(`.ianto-folder-del[data-folder="${folderName}"]`);
                if (folderTitleDel) {
                    const folderContent = folderTitleDel.closest('.ianto-folder').querySelector('.ianto-folder-content');

                    if (container.parentElement !== folderContent) {
                        const fakeItem = folderContent.querySelector(`.ianto-fake-item[data-url="${url}"]`);
                        if (fakeItem) {
                            folderContent.insertBefore(container, fakeItem);
                            fakeItem.style.display = 'none';
                        } else {
                            folderContent.appendChild(container);
                        }

                        container.classList.add('ianto-native-wrap');
                        container.setAttribute('draggable', 'true');
                        container.style.display = '';
                        container.removeAttribute('data-ianto-hidden');

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

                container.classList.add('ianto-native-wrap');
                container.setAttribute('draggable', 'true');
                if (!container.querySelector('.ianto-classify-btn')) {
                    const btn = document.createElement('button');
                    btn.className = 'ianto-classify-btn';
                    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:text-bottom; margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>归档`;
                    
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
                const link = dragSrcEl.querySelector('a[href*="/app/"]');
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
        if (sidebarSyncInterval) clearInterval(sidebarSyncInterval);

        const scheduleSidebarSync = () => {
            if (sidebarSyncTimer) return;
            sidebarSyncTimer = setTimeout(() => {
                sidebarSyncTimer = null;
                if (sidebarSyncing) return;
                sidebarSyncing = true;
                try {
                    if (injectFolderUI()) processNativeChats();
                } finally {
                    sidebarSyncing = false;
                }
            }, 120);
        };

        // Gemini 是 SPA，侧栏会在路由和折叠状态变化时整体重建。保留 body 级监听以发现新侧栏，
        // 但实际同步做节流，并且只扫描精确的聊天区和分类区。
        observer = new MutationObserver(scheduleSidebarSync);
        observer.observe(document.body, { childList: true, subtree: true });
        sidebarSyncInterval = setInterval(scheduleSidebarSync, 1000);
        scheduleSidebarSync();
    }

    // ==========================================
    // 5. 插件通信 & 启动逻辑
    // ==========================================
    chrome.storage.local.get([storageKey], (result) => {
        applyStyles(result[storageKey] !== false); 
    });

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'toggleWidth') {
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

    // =========================================================================================
    // NotebookLM 书签模块（变量声明在顶层，函数在下方）
    // =========================================================================================
    const folderDataKeyNLM = 'notebooklm_custom_folders_data';
    let folderDataNLM = [];
    let observerNLM = null;
    let nlmSyncInterval = null;

    function isGeminiNotebookListView() {
        return window.location.hostname === 'gemini.google.com' && /^\/notebooks(?:\/view)?\/?$/.test(window.location.pathname);
    }

    // ======================= NotebookLM 独有标识获取 =======================
    // Gemini 升级后 /notebooks/view 的 project-mgmt-row 不再暴露 UUID，
    // 拿不到真 UUID 时回退到 't::TITLE'，整套比较逻辑用 nlmProjectMatches 统一处理
    function getNlmUuid(el) {
        const titleEl = el.querySelector('.project-button-title');
        if (titleEl && titleEl.id) {
            const match = titleEl.id.match(/project-(.*?)-title/);
            if (match) return match[1];
        }
        const cardLink = el.classList.contains('project-card') ? el : el.querySelector('.project-card');
        if (cardLink && cardLink.getAttribute('href')) {
            const hrefParts = cardLink.getAttribute('href').split('/').filter(Boolean);
            if (hrefParts.length > 0) return hrefParts[hrefParts.length - 1];
        }
        // Fallback：用标题当 key（前缀避免与真 UUID 冲突）
        const t = getNlmTitle(el);
        // Gemini 卡片未提供 UUID 时，优先保留 Notebook 端已保存的真实标识。
        const saved = folderDataNLM.flatMap(folder => folder.projects || [])
            .find(project => project.title === t && project.uuid && !isTitleKey(project.uuid));
        if (saved) return saved.uuid;
        return t ? 't::' + t : null;
    }

    function isTitleKey(uuid) { return typeof uuid === 'string' && uuid.startsWith('t::'); }

    // 比较存储的 project 与当前活动卡片 / 拖拽源是否同一个
    function nlmProjectMatches(p, uuid, title) {
        if (!p) return false;
        if (uuid && p.uuid === uuid) return true;
        if (title && p.title === title) return true;
        return false;
    }

    // 由 fake item 触发：当存的是 title-keyed 项，找原生 project-mgmt-row 并模拟点击
    function clickNlmNativeByTitle(title) {
        const rows = document.querySelectorAll('project-button, project-mgmt-row');
        for (const r of rows) {
            if (getNlmTitle(r) === title) {
                const click = r.querySelector('.project-card-container') || r.querySelector('.project-card') || r;
                click.click();
                return true;
            }
        }
        return false;
    }

    function getNlmTitle(el) {
        const titleEl = el.querySelector('.project-button-title');
        if (titleEl) return titleEl.innerText.trim();
        const cardTitle = el.querySelector('.gds-title-l.title, .title');
        return cardTitle ? cardTitle.innerText.trim() : '未命名笔记本';
    }

    // ======================= NotebookLM 核心逻辑 =======================
    function initNLMFolders() {
        chrome.storage.local.get([folderDataKeyNLM], (result) => {
            let data = result[folderDataKeyNLM];
            if (!data) { folderDataNLM = []; }
            else { folderDataNLM = data; }
            observeNLMSidebar();
        });
    }

    // 两个站点共用同一个 storage key；另一标签页保存后同步刷新当前分类。
    chrome.storage.onChanged.addListener((changes, areaName) => {
        const change = changes[folderDataKeyNLM];
        if (areaName !== 'local' || !change) return;
        const next = Array.isArray(change.newValue) ? change.newValue : [];
        if (JSON.stringify(next) === JSON.stringify(folderDataNLM)) return;
        folderDataNLM = next;
        if (!optimizationEnabled || !isNlmMyNotebooksView()) return;
        if (document.getElementById('nlm-folder-manager')) renderNLMFolderUI();
        else injectNLMFolderUI();
        processNLMNativeChats();
    });

    function saveNLMFolders() {
        chrome.storage.local.set({ [folderDataKeyNLM]: folderDataNLM });
        renderNLMFolderUI();
        processNLMNativeChats();
    }

    function saveNLMFoldersFromDOM() {
        const newFolderData = [];
        const folderEls = document.querySelectorAll('.nlm-folder');
        folderEls.forEach(folderEl => {
            const folderName = folderEl.querySelector('.nlm-folder-del').getAttribute('data-folder');
            const isOp = folderEl.querySelector('.nlm-folder-content').classList.contains('open');
            const projects = [];
            const gridNode = folderEl.querySelector('.nlm-folder-grid');
            const children = Array.from(gridNode.children);
            children.forEach(child => {
                let uuid = null; let title = null;
                if (child.classList.contains('nlm-fake-item') && child.style.display !== 'none') {
                    uuid = child.getAttribute('data-uuid'); title = child.getAttribute('data-title');
                } else if (child.classList.contains('ianto-native-wrap')) {
                    uuid = getNlmUuid(child); title = getNlmTitle(child);
                }
                if (uuid && title) projects.push({ title, uuid });
            });
            const uniqueProjects = []; const seenUuids = new Set();
            for (const p of projects) { if (!seenUuids.has(p.uuid)) { seenUuids.add(p.uuid); uniqueProjects.push(p); } }
            newFolderData.push({ name: folderName, projects: uniqueProjects, isOpen: isOp });
        });
        folderDataNLM = newFolderData;
        chrome.storage.local.set({ [folderDataKeyNLM]: folderDataNLM });
        processNLMNativeChats();
    }

    function getNlmTabButton(tabNames) {
        const names = new Set(tabNames);
        const hostButton = Array.from(document.querySelectorAll('nb-button')).find(host => {
            const text = (host.innerText || host.textContent || '').trim();
            return names.has(text);
        });
        if (hostButton) return hostButton;
        return Array.from(document.querySelectorAll('button')).find(button => {
            const text = (button.innerText || button.textContent || '').trim();
            return names.has(text);
        }) || null;
    }

    function isNlmTabActive(button) {
        if (!button) return false;
        const nativeButton = button.matches('button') ? button : button.querySelector('button');
        const parent = nativeButton?.parentElement;
        return button.classList.contains('nb-button-type-tonal') ||
            nativeButton?.classList.contains('mat-tonal-button') ||
            parent?.classList.contains('nb-button-type-tonal') ||
            nativeButton?.getAttribute('aria-current') === 'page' ||
            nativeButton?.getAttribute('aria-pressed') === 'true';
    }

    function isNlmMyNotebooksView() {
        // Gemini 的 Notebooks 列表没有 Notebook 站点的“我的笔记本 / 全部”标签。
        if (isGeminiNotebookListView()) return !!document.querySelector('.notebook-card-view .list-header');
        const myButton = getNlmTabButton(['我的笔记本', 'My notebooks']);
        const allButton = getNlmTabButton(['全部', 'All']);
        const myActive = isNlmTabActive(myButton);
        const allActive = isNlmTabActive(allButton);
        if (myActive || allActive) return myActive;
        const heading = document.querySelector('.my-projects-container .projects-header');
        return (heading?.innerText || '').trim() === '我的笔记本';
    }

    function autoOpenNlmMyNotebooks() {
        if (window.iantoNlmAutoRedirectDone || window.location.pathname !== '/') return;
        let skipAutoRedirect = false;
        try {
            skipAutoRedirect = sessionStorage.getItem('ianto_nlm_skip_auto_redirect') === '1';
            if (skipAutoRedirect) sessionStorage.removeItem('ianto_nlm_skip_auto_redirect');
        } catch (_) {}
        if (skipAutoRedirect) {
            window.iantoNlmAutoRedirectDone = true;
            return;
        }
        const myButton = getNlmTabButton(['我的笔记本', 'My notebooks']);
        if (!myButton) return;
        window.iantoNlmAutoRedirectDone = true;
        if (!isNlmTabActive(myButton)) myButton.click();
    }

    function handleNotebookLMVisibility() {
        if (isGeminiNotebookListView()) {
            const manager = document.getElementById('nlm-folder-manager');
            if (manager) manager.style.display = 'block';
            return;
        }
        autoOpenNlmMyNotebooks();

        const folderManager = document.getElementById('nlm-folder-manager');
        const myButton = getNlmTabButton(['我的笔记本', 'My notebooks']);
        const allButton = getNlmTabButton(['全部', 'All']);
        const heading = (document.querySelector('.my-projects-container .projects-header')?.innerText || '').trim();
        const myActive = isNlmTabActive(myButton);
        const allActive = isNlmTabActive(allButton);
        const hasActiveTab = myActive || allActive;
        const isMyView = myActive || (!hasActiveTab && heading === '我的笔记本');
        const isAllView = allActive || (!hasActiveTab && (heading === '最近打开过的笔记本' || heading === '精选笔记本'));

        const currentView = isMyView ? 'my' : (isAllView ? 'all' : 'other');
        const previousView = window.iantoNlmLastView;
        window.iantoNlmLastView = currentView;
        if (currentView === 'all' && previousView === 'my' && !window.iantoNlmReloadingAll) {
            // 分类页移动过原生卡片后，NotebookLM 的 SPA 切换可能复用旧 DOM。
            // 让 NotebookLM 自己重建“全部”列表，保证恢复官方排序。
            window.iantoNlmReloadingAll = true;
            try { sessionStorage.setItem('ianto_nlm_skip_auto_redirect', '1'); } catch (_) {}
            window.location.reload();
            return;
        }

        if (isMyView && !isAllView) {
            if (folderManager) folderManager.style.display = 'block';
        } else {
            // “全部”页不参与分类逻辑：还原节点并移除注入的容器，避免改变原生顺序。
            restoreNLMNativeChats();
            if (folderManager) folderManager.remove();
        }
    }

    function placeNLMFolderManager(manager, projectsHeader) {
        if (!manager || !projectsHeader) return false;
        const headerRow = projectsHeader.matches('.list-header')
            ? projectsHeader
            : projectsHeader.closest('.projects-header-row') || projectsHeader.parentElement;
        const insertionParent = headerRow?.parentElement || projectsHeader.parentElement;
        if (!headerRow || !insertionParent) return false;
        // 分类容器必须是标题栏的同级元素，不能插在标题与右侧操作按钮之间。
        if (manager.parentElement !== insertionParent || manager.previousElementSibling !== headerRow) {
            insertionParent.insertBefore(manager, headerRow.nextSibling);
        }
        return true;
    }

    function injectNLMFolderUI() {
        if (!isNlmMyNotebooksView()) return false;
        const projectsHeader = document.querySelector('.my-projects-container .projects-header, .notebook-card-view .list-header');
        if (!projectsHeader) return false;
        const existingManager = document.getElementById('nlm-folder-manager');
        if (existingManager) {
            placeNLMFolderManager(existingManager, projectsHeader);
            handleNotebookLMVisibility();
            return true;
        }

        const manager = document.createElement('div');
        manager.id = 'nlm-folder-manager';
        manager.style.cssText = 'margin: 16px 0 24px 0; width: 100%; color: var(--mat-sys-on-surface, inherit); font-family: inherit;';
        manager.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <span id="nlm-main-toggle" style="font-size:16px;font-weight:700;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;opacity:0.9;" title="点击展开/收起分类收藏">
                    <span id="nlm-main-caret" style="font-size:12px;margin-right:6px;display:inline-block;transition:transform 0.2s;transform:scale(1.3);position:relative;top:1px;">▼</span>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    分类收藏
                </span>
                <button id="nlm-create-folder" style="cursor:pointer;background:var(--v2-surface-container-high,#e3e8ee);color:inherit;border:none;border-radius:50px;padding:6px 12px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:4px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    新建
                </button>
            </div>
            <div id="nlm-folder-list"></div>
        `;
        placeNLMFolderManager(manager, projectsHeader);

        document.getElementById('nlm-create-folder').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            showCustomModal({
                title: '新建分类',
                desc: '给你的新笔记本归类夹起个名字：',
                type: 'input',
                onConfirm: (name) => {
                    if (!folderDataNLM.some(f => f.name === name)) {
                        folderDataNLM.push({ name: name, projects: [], isOpen: true });
                        saveNLMFolders();
                        const listContainer = document.getElementById('nlm-folder-list');
                        if (listContainer.style.display === 'none') { document.getElementById('nlm-main-toggle').click(); }
                    }
                }
            });
        });

        document.getElementById('nlm-main-toggle').addEventListener('click', () => {
            const listContainer = document.getElementById('nlm-folder-list');
            const caret = document.getElementById('nlm-main-caret');
            if (listContainer.style.display === 'none') {
                listContainer.style.display = 'block';
                caret.style.transform = 'scale(1.3) rotate(0deg)';
                chrome.storage.local.set({ 'nlm_main_folder_open': true });
            } else {
                listContainer.style.display = 'none';
                caret.style.transform = 'scale(1.3) rotate(-90deg)';
                chrome.storage.local.set({ 'nlm_main_folder_open': false });
            }
        });

        chrome.storage.local.get(['nlm_main_folder_open'], (res) => {
            if (res.nlm_main_folder_open === false) {
                document.getElementById('nlm-folder-list').style.display = 'none';
                document.getElementById('nlm-main-caret').style.transform = 'scale(1.3) rotate(-90deg)';
            } else {
                document.getElementById('nlm-main-caret').style.transform = 'scale(1.3) rotate(0deg)';
            }
        });

        renderNLMFolderUI();
        return true;
    }

    function renderNLMFolderUI() {
        const listContainer = document.getElementById('nlm-folder-list');
        if (!listContainer) return;
        // 同步更新分类前先归还原生卡片，避免重建 HTML 时把卡片及其事件一起删除。
        restoreNLMNativeChats();
        listContainer.innerHTML = '';
        for (const folder of folderDataNLM) {
            const folderName = folder.name; const projects = folder.projects;
            const isOp = folder.isOpen !== false; const openClass = isOp ? ' open' : ''; const iconChar = isOp ? '▼' : '▶';

            const folderEl = document.createElement('div');
            folderEl.className = 'nlm-folder';
            folderEl.draggable = true;
            folderEl.style.cssText = 'margin-bottom:16px;position:relative;';

            let projectsHtml = projects.map(p => {
                const titleKey = isTitleKey(p.uuid);
                // title-keyed 项没有真 URL，渲染为 # 并用 JS 拦截点击
                const linkHref = titleKey ? 'javascript:void(0)' : `/notebook/${p.uuid}`;
                const safeUuid = (p.uuid || '').replace(/"/g, '&quot;');
                const safeTitle = (p.title || '').replace(/"/g, '&quot;');
                return `
                <a href="${linkHref}" class="nlm-fake-item${titleKey ? ' nlm-title-keyed' : ''}" data-uuid="${safeUuid}" data-title="${safeTitle}" draggable="true"
                    style="background:var(--v2-surface-container-low,#f0f4f9);border-radius:12px;padding:24px;height:224px;box-sizing:border-box;display:flex;flex-direction:column;position:relative;opacity:0.8;text-decoration:none;color:inherit;cursor:pointer;">
                    <div style="font-size:1.25rem;font-weight:500;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;margin-top:auto;margin-bottom:8px;">${p.title}</div>
                    <div style="color:#777;font-size:0.875rem;">(官方暂未展示此原生卡片)</div>
                    <button class="nlm-unarchive-btn" data-uuid="${safeUuid}" data-title="${safeTitle}" title="移出分类" style="position:absolute;top:16px;left:16px;z-index:100;background:rgba(179,38,30,0.8);color:#fff;border:none;border-radius:50%;width:30px;height:30px;display:flex;justify-content:center;align-items:center;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.3);opacity:0;visibility:hidden;transition:opacity 0.2s;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                    </button>
                </a>
            `}).join('');

            folderEl.innerHTML = `
                <div class="nlm-folder-title" style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;background:var(--v2-surface-container-low,#f0f4f9);border-radius:12px;cursor:pointer;font-size:15px;font-weight:600;">
                    <span>
                        <span class="nlm-icon-sub" style="font-size:12px;margin-right:8px;">${iconChar}</span>
                        ${folderName}
                        <span style="opacity:0.5;font-size:12px;margin-left:6px;">(${projects.length})</span>
                    </span>
                    <span class="nlm-folder-del" data-folder="${folderName}" title="解散分类（笔记本不丢失）" style="cursor:pointer;padding:4px;border-radius:50%;display:flex;align-items:center;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </span>
                </div>
                <div class="nlm-folder-content${openClass}" style="${isOp ? 'display:block' : 'display:none'};padding:16px 0;">
                    <div class="nlm-folder-grid" style="display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(16.25rem,1fr));">${projectsHtml}</div>
                </div>
            `;
            listContainer.appendChild(folderEl);
        }

        // 假节点卡片：hover 才显示移除按钮
        listContainer.querySelectorAll('.nlm-fake-item').forEach(card => {
            const btn = card.querySelector('.nlm-unarchive-btn');
            if (!btn) return;
            card.addEventListener('mouseenter', () => { btn.style.opacity = '1'; btn.style.visibility = 'visible'; });
            card.addEventListener('mouseleave', () => { btn.style.opacity = '0'; btn.style.visibility = 'hidden'; });
        });

        listContainer.querySelectorAll('.nlm-folder-title').forEach(title => {
            title.addEventListener('click', (e) => {
                if (e.target.closest('.nlm-folder-del')) return;
                const content = title.nextElementSibling; const icon = title.querySelector('.nlm-icon-sub');
                const currentIsOp = !content.style.display || content.style.display === 'none' ? true : false;
                content.style.display = currentIsOp ? 'block' : 'none';
                icon.innerText = currentIsOp ? '▼' : '▶';
                const folderName = title.querySelector('.nlm-folder-del').getAttribute('data-folder');
                let targetFolder = folderDataNLM.find(f => f.name === folderName);
                if (targetFolder) { targetFolder.isOpen = currentIsOp; chrome.storage.local.set({ [folderDataKeyNLM]: folderDataNLM }); }
            });
        });

        listContainer.querySelectorAll('.nlm-folder-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); const folderName = e.currentTarget.getAttribute('data-folder');
                showCustomModal({
                    title: '解散文件夹',
                    desc: `确定要解散分类 [${folderName}] 吗？\n\n（解散后将刷新页面，笔记本会安全回到下方）`,
                    type: 'alert',
                    onConfirm: () => { folderDataNLM = folderDataNLM.filter(f => f.name !== folderName); chrome.storage.local.set({ [folderDataKeyNLM]: folderDataNLM }, () => window.location.reload()); }
                });
            });
        });

        listContainer.querySelectorAll('.nlm-unarchive-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault(); e.stopPropagation();
                const uuid = e.currentTarget.getAttribute('data-uuid');
                const title = e.currentTarget.getAttribute('data-title');
                let targetFolder = folderDataNLM.find(f => f.projects.some(p => nlmProjectMatches(p, uuid, title)));
                if (targetFolder) {
                    targetFolder.projects = targetFolder.projects.filter(p => !nlmProjectMatches(p, uuid, title));
                    chrome.storage.local.set({ [folderDataKeyNLM]: folderDataNLM }, () => window.location.reload());
                }
            });
        });

        // title-keyed fake-item 没有真 URL，点击时拦截 → 找原生卡片模拟点击
        listContainer.querySelectorAll('a.nlm-fake-item.nlm-title-keyed').forEach(a => {
            a.addEventListener('click', (e) => {
                if (e.target.closest('.nlm-unarchive-btn')) return;
                e.preventDefault();
                const title = a.getAttribute('data-title');
                clickNlmNativeByTitle(title);
            });
        });
    }

    function getNLMMainProjectGrid() {
        return document.querySelector('.my-projects-container > project-grid') ||
            document.querySelector('.my-projects-container project-grid') ||
            (isGeminiNotebookListView() ? document.querySelector('.notebook-card-view .your-projects .projects-section-container') : null);
    }

    function restoreNLMNativeChats() {
        const mainGrid = getNLMMainProjectGrid();
        const movedRows = document.querySelectorAll('#nlm-folder-manager .ianto-native-wrap');
        if (mainGrid) movedRows.forEach(pb => {
            const original = pb.__iantoNlmOriginalPosition;
            const originalParent = original?.parent;
            const canRestoreOriginal = originalParent && originalParent.isConnected && !originalParent.closest('#nlm-folder-manager');
            const target = canRestoreOriginal ? originalParent : mainGrid.querySelector('.project-grid-container') || mainGrid;
            if (!target) return;

            if (original?.next && original.next.parentElement === target) target.insertBefore(pb, original.next);
            else target.appendChild(pb);

            pb.classList.remove('ianto-native-wrap');
            pb.removeAttribute('draggable');
            pb.style.position = '';
            pb.style.display = '';
            const archiveBtn = pb.querySelector('.nlm-classify-btn');
            if (archiveBtn) archiveBtn.remove();
            const unarchiveBtn = pb.querySelector('.nlm-unarchive-btn');
            if (unarchiveBtn) unarchiveBtn.remove();
        });

        // 兼容扩展热重载：清理旧脚本可能留在原生列表上的控制按钮和标记。
        document.querySelectorAll('project-button.ianto-native-wrap, project-mgmt-row.ianto-native-wrap').forEach(pb => {
            pb.classList.remove('ianto-native-wrap');
            pb.removeAttribute('draggable');
            pb.style.position = '';
            pb.style.display = '';
        });
        document.querySelectorAll('.nlm-classify-btn, .nlm-unarchive-btn').forEach(el => el.remove());
    }

    function processNLMNativeChats() {
        if (!isNlmMyNotebooksView()) {
            restoreNLMNativeChats();
            return;
        }

        const projectButtons = document.querySelectorAll('project-button, project-mgmt-row');
        projectButtons.forEach(pb => {
            if (pb.querySelector('.create-new-action-button')) return;
            if (pb.closest('.featured-projects-container')) return;
            const uuid = getNlmUuid(pb);
            const title = getNlmTitle(pb);
            if (!uuid) return;

            // 通过 uuid 或 title 任一命中即视为同一笔记本（兼容旧真 UUID + 新 title 兜底）
            let targetFolder = folderDataNLM.find(f => f.projects.some(p => nlmProjectMatches(p, uuid, title)));

            if (targetFolder) {
                const folderName = targetFolder.name;
                const folderTitleDel = document.querySelector(`.nlm-folder-del[data-folder="${folderName}"]`);
                if (folderTitleDel) {
                    const folderGrid = folderTitleDel.closest('.nlm-folder').querySelector('.nlm-folder-grid');
                    if (pb.parentElement !== folderGrid) {
                        // 找匹配的 fake-item（按 uuid 或 title）
                        let fakeItem = folderGrid.querySelector(`.nlm-fake-item[data-uuid="${CSS.escape(uuid)}"]`);
                        if (!fakeItem) {
                            fakeItem = Array.from(folderGrid.querySelectorAll('.nlm-fake-item'))
                                .find(it => it.getAttribute('data-title') === title);
                        }
                        if (!pb.__iantoNlmOriginalPosition) {
                            pb.__iantoNlmOriginalPosition = { parent: pb.parentElement, next: pb.nextSibling };
                        }
                        if (fakeItem) { folderGrid.insertBefore(pb, fakeItem); fakeItem.style.display = 'none'; }
                        else { folderGrid.appendChild(pb); }
                        pb.classList.add('ianto-native-wrap'); pb.setAttribute('draggable', 'true');
                        const archiveBtn = pb.querySelector('.nlm-classify-btn');
                        if (archiveBtn) archiveBtn.style.display = 'none';
                        if (!pb.querySelector('.nlm-unarchive-btn')) {
                            const uBtn = document.createElement('button'); uBtn.className = 'nlm-unarchive-btn';
                            uBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
                            uBtn.title = "移出分类 (将自动刷新页面)";
                            uBtn.style.cssText = 'position:absolute;top:16px;left:16px;z-index:100;background:rgba(179,38,30,0.8);color:#fff;border:none;border-radius:50%;width:30px;height:30px;display:flex;justify-content:center;align-items:center;cursor:pointer;opacity:0;visibility:hidden;transition:opacity 0.2s;';
                            pb.addEventListener('mouseenter', () => { uBtn.style.opacity = '1'; uBtn.style.visibility = 'visible'; });
                            pb.addEventListener('mouseleave', () => { uBtn.style.opacity = '0'; uBtn.style.visibility = 'hidden'; });
                            uBtn.onclick = (e) => {
                                e.preventDefault(); e.stopPropagation();
                                targetFolder.projects = targetFolder.projects.filter(p => !nlmProjectMatches(p, uuid, title));
                                chrome.storage.local.set({ [folderDataKeyNLM]: folderDataNLM }, () => { window.location.reload(); });
                            };
                            pb.style.position = 'relative'; pb.appendChild(uBtn);
                        }
                    }
                }
            } else {
                if (pb.parentElement && pb.parentElement.classList.contains('nlm-folder-grid')) {
                    pb.style.display = 'none'; return;
                }
                if (!pb.hasAttribute('draggable')) {
                    pb.classList.add('ianto-native-wrap'); pb.setAttribute('draggable', 'true');
                    const cBtn = document.createElement('button'); cBtn.className = 'nlm-classify-btn';
                    cBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:text-bottom;margin-right:4px;"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>归档`;
                    cBtn.style.cssText = 'position:absolute;top:16px;left:16px;z-index:100;background:#0b57d0;color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:12px;font-weight:bold;cursor:pointer;opacity:0;visibility:hidden;transition:all 0.2s ease;box-shadow:0 2px 6px rgba(0,0,0,0.3);';
                    cBtn.addEventListener('mouseenter', () => { cBtn.style.opacity = '1'; cBtn.style.visibility = 'visible'; });
                    pb.addEventListener('mouseenter', () => { cBtn.style.opacity = '1'; cBtn.style.visibility = 'visible'; });
                    pb.addEventListener('mouseleave', () => { cBtn.style.opacity = '0'; cBtn.style.visibility = 'hidden'; });
                    cBtn.addEventListener('click', (e) => {
                        e.preventDefault(); e.stopPropagation();
                        const foldersList = folderDataNLM.map(f => f.name);
                        if (foldersList.length === 0) {
                            showCustomModal({ title: '无法操作', desc: '还没有分类文件夹，请先在上方点击"新建"创建一个！', type: 'alert', onConfirm: () => {} });
                            return;
                        }
                        showCustomModal({
                            title: '移动到分类', desc: '请选择你想把该笔记本存入哪个文件夹：', type: 'select', options: foldersList,
                            onConfirm: (fName) => {
                                let tFolder = folderDataNLM.find(f => f.name === fName);
                                if (tFolder) { tFolder.projects.push({ title, uuid }); saveNLMFolders(); }
                                const listContainer = document.getElementById('nlm-folder-list');
                                if (listContainer && listContainer.style.display === 'none') { document.getElementById('nlm-main-toggle').click(); }
                            }
                        });
                    });
                    pb.style.position = 'relative'; pb.appendChild(cBtn);
                } else {
                    const archiveBtn = pb.querySelector('.nlm-classify-btn'); if (archiveBtn) archiveBtn.style.display = '';
                    const unBtn = pb.querySelector('.nlm-unarchive-btn'); if (unBtn) unBtn.remove();
                }
            }
        });
    }

    function setupNLMDragAndDrop() {
        if (window.nlmDndInitialized) return;
        window.nlmDndInitialized = true;
        let dragSrcEl = null; let dragType = null;
        function clearDragIndicators() {
            document.querySelectorAll('.nlm-drag-left, .nlm-drag-right, .nlm-drag-top, .nlm-drag-bottom, .nlm-drag-into').forEach(el => {
                el.classList.remove('nlm-drag-left', 'nlm-drag-right', 'nlm-drag-top', 'nlm-drag-bottom', 'nlm-drag-into');
                el.style.boxShadow = ''; el.style.border = '';
            });
        }

        document.addEventListener('dragstart', function(e) {
            const target = e.target;
            const nativeWrap = target.closest && target.closest('.ianto-native-wrap');
            const fakeItem = target.closest && target.closest('.nlm-fake-item');
            const folder = target.closest && target.closest('.nlm-folder');
            if (nativeWrap) {
                if (nativeWrap.querySelector('.create-new-action-button')) return;
                dragSrcEl = nativeWrap; dragType = dragSrcEl.closest('.nlm-folder') ? 'teleported-nlm' : 'native-nlm';
                const uuid = getNlmUuid(dragSrcEl); const title = getNlmTitle(dragSrcEl);
                if (uuid && e.dataTransfer) { e.dataTransfer.setData('application/json', JSON.stringify({title, uuid})); e.dataTransfer.setData('text/plain', 'nlm-drag'); }
            } else if (fakeItem) {
                dragSrcEl = fakeItem; dragType = 'fake-nlm';
                if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'nlm-fake-drag');
            } else if (folder) {
                dragSrcEl = folder; dragType = 'nlm-folder';
                if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'nlm-folder-drag');
            } else { dragType = null; dragSrcEl = null; return; }
            e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => { if (dragSrcEl) dragSrcEl.style.opacity = '0.4'; }, 0);
        }, true);

        document.addEventListener('dragenter', function(e) { if (dragType) { e.preventDefault(); e.stopPropagation(); } }, true);
        document.addEventListener('dragleave', function(e) { if (dragType) { e.stopPropagation(); } }, true);

        document.addEventListener('dragover', function(e) {
            if (!dragType) return;
            e.preventDefault(); e.stopPropagation(); clearDragIndicators();
            const target = e.target; const folder = target.closest('.nlm-folder');
            if (dragType === 'nlm-folder') {
                if (folder && folder !== dragSrcEl) {
                    const titleNode = folder.querySelector('.nlm-folder-title'); const rect = (titleNode || folder).getBoundingClientRect();
                    const isTopHalf = (e.clientY - rect.top) / rect.height < 0.5;
                    (titleNode || folder).style.boxShadow = isTopHalf ? '0 -3px 0 0 #0b57d0' : '0 3px 0 0 #0b57d0';
                }
            } else if (dragType === 'fake-nlm' || dragType === 'teleported-nlm' || dragType === 'native-nlm') {
                const chatItem = target.closest('.nlm-fake-item') || target.closest('.ianto-native-wrap');
                const folderTitle = target.closest('.nlm-folder-title');
                if (chatItem && chatItem !== dragSrcEl && chatItem.closest('.nlm-folder')) {
                    const rect = chatItem.getBoundingClientRect();
                    const isLeftHalf = (e.clientX - rect.left) / rect.width < 0.5;
                    chatItem.style.boxShadow = isLeftHalf ? '-3px 0 0 0 #0b57d0' : '3px 0 0 0 #0b57d0';
                } else if (folderTitle || (folder && !chatItem)) {
                    if (folder) folder.style.outline = '2px dashed #0b57d0';
                    const content = folder.querySelector('.nlm-folder-content');
                    if (content && content.style.display === 'none') {
                        content.style.display = 'block'; const icon = folder.querySelector('.nlm-icon-sub'); if(icon) icon.innerText = '▼';
                    }
                }
            }
        }, true);

        document.addEventListener('drop', function(e) {
            if (!dragType) return;
            e.preventDefault(); e.stopPropagation();
            const target = e.target; const folder = target.closest('.nlm-folder');
            const chatItem = target.closest('.nlm-fake-item') || target.closest('.ianto-native-wrap');
            if ((dragType === 'fake-nlm' || dragType === 'teleported-nlm') && chatItem && chatItem !== dragSrcEl && chatItem.closest('.nlm-folder')) {
                const rect = chatItem.getBoundingClientRect(); const isLeftHalf = (e.clientX - rect.left) / rect.width < 0.5;
                chatItem.parentNode.insertBefore(dragSrcEl, isLeftHalf ? chatItem : chatItem.nextSibling);
                saveNLMFoldersFromDOM();
            } else if (folder && dragType !== 'nlm-folder') {
                const folderName = folder.querySelector('.nlm-folder-del').getAttribute('data-folder');
                try {
                    const data = JSON.parse(e.dataTransfer.getData('application/json'));
                    if (data.uuid && data.title) {
                        let tFolder = folderDataNLM.find(f => f.name === folderName);
                        if (!tFolder) { tFolder = { name: folderName, projects: [], isOpen: true }; folderDataNLM.push(tFolder); }
                        if (dragType === 'native-nlm') { tFolder.projects.push(data); saveNLMFolders(); }
                        else {
                            const grid = folder.querySelector('.nlm-folder-grid');
                            if (grid && !grid.contains(dragSrcEl)) { grid.appendChild(dragSrcEl); saveNLMFoldersFromDOM(); }
                        }
                        const listContainer = document.getElementById('nlm-folder-list');
                        if (listContainer && listContainer.style.display === 'none') { document.getElementById('nlm-main-toggle').click(); }
                    }
                } catch(err) {}
            } else if (dragType === 'nlm-folder' && dragSrcEl) {
                if (folder && folder !== dragSrcEl) {
                    const listContainer = document.getElementById('nlm-folder-list'); const titleNode = folder.querySelector('.nlm-folder-title');
                    const rect = (titleNode || folder).getBoundingClientRect(); const isTopHalf = (e.clientY - rect.top) / rect.height < 0.5;
                    listContainer.insertBefore(dragSrcEl, isTopHalf ? folder : folder.nextSibling);
                    saveNLMFoldersFromDOM();
                }
            }
            clearDragIndicators();
        }, true);

        document.addEventListener('dragend', function(e) {
            if (dragType) { e.stopPropagation(); }
            if (dragSrcEl) { dragSrcEl.style.opacity = ''; }
            clearDragIndicators(); dragType = null; dragSrcEl = null;
        }, true);
    }

    function observeNLMSidebar() {
        if (observerNLM) observerNLM.disconnect();
        if (nlmSyncInterval) clearInterval(nlmSyncInterval);
        let isMounting = false;
        const syncNotebookView = () => {
            if (!optimizationEnabled) return;
            if (window.location.hostname === 'gemini.google.com' && !isGeminiNotebookListView()) return;
            handleNotebookLMVisibility();
            if (!isMounting && !document.getElementById('nlm-folder-manager')) { isMounting = true; injectNLMFolderUI(); isMounting = false; }
            processNLMNativeChats();
        };
        observerNLM = new MutationObserver(syncNotebookView);
        observerNLM.observe(document.body, { childList: true, subtree: true });
        nlmSyncInterval = setInterval(syncNotebookView, 1000);
        syncNotebookView();
    }

    // ========================================
    // Gems 页面书签分组系统（仅在/gems/view生效）
    // ========================================
    (function setupGemsBookmarks() {
        const FOLDER_KEY = 'gems_custom_folders_data';
        const CSS_ID     = 'ianto-gems-css';
        let folders = [];
        let enabled = false;
        var gemDragSrc = null, gemDragData = null;
        var gemFolderDragId = null;
        var gemStagingDiv = null; // renderFolders 重建期间拿移 bot-list-row 的暂存区

        function injectCSS() {
            if (document.getElementById(CSS_ID)) return;
            const s = document.createElement('style');
            s.id = CSS_ID;
            s.textContent = [
                '#ianto-gems-manager { margin: 0 0 16px 0; font-family: inherit; display: flex; flex-direction: column; gap: 2px; color: inherit; }',
                '#ianto-gems-manager .ianto-header { display: flex; justify-content: space-between; align-items: center; padding: 0 4px; margin-bottom: 6px; }',
                '#ianto-gems-manager .ianto-title { font-size: 13px; font-weight: 700; display: flex; align-items: center; gap: 6px; opacity: 0.9; }',
                '#ianto-gems-manager .ianto-new-btn { cursor: pointer; background: transparent; color: inherit; border: 1px dashed rgba(128,128,128,.4); border-radius: 50px; padding: 3px 10px; font-size: 12px; transition: all 0.2s; opacity: 0.75; }',
                '#ianto-gems-manager .ianto-new-btn:hover { background: rgba(128,128,128,0.1); opacity: 1; }',
                '#ianto-gems-manager .ianto-folder { margin-bottom: 4px; border-radius: 10px; background: rgba(128,128,128,0.05); }',
                '.ianto-folder-title { padding: 8px 12px; cursor: pointer; font-size: 14px; font-weight: 600; display: flex; justify-content: space-between; align-items: center; border-radius: 10px; transition: background 0.2s; }',
                '.ianto-folder-title:hover { background: rgba(128,128,128,0.1); }',
                '#ianto-gems-manager .ianto-folder-content { display: none; flex-direction: column; padding: 0 4px 4px 4px; }',
                '#ianto-gems-manager .ianto-folder-content.open { display: flex; }',
                '#ianto-gems-manager .ianto-folder-content bot-list-row { width: 100%; }',
                '#ianto-gems-manager .ianto-gem-item { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 8px; font-size: 14px; text-decoration: none; color: inherit; transition: background 0.2s; cursor: pointer; gap: 8px; }',
                '#ianto-gems-manager .ianto-gem-item:hover { background: rgba(128,128,128,0.08); }',
                '#ianto-gems-manager .ianto-gem-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
                '#ianto-gems-manager .ianto-gem-remove, .ianto-folder-del { cursor: pointer; padding: 3px 5px; border-radius: 4px; opacity: 0; transition: all 0.2s; font-size: 11px; flex-shrink: 0; }',
                '#ianto-gems-manager .ianto-gem-item:hover .ianto-gem-remove, .ianto-folder-title:hover .ianto-folder-del { opacity: 0.5; }',
                '#ianto-gems-manager .ianto-gem-remove:hover, .ianto-folder-del:hover { background: rgba(217,48,37,0.1); opacity: 1 !important; color: #d93025; }',
                /* no position override for CDK compatibility */
                '.ianto-gem-classify-btn { position: absolute !important; right: 36px !important; top: 50% !important; transform: translateY(-50%) !important; background: #0b57d0 !important; color: #fff !important; border: none !important; border-radius: 6px !important; padding: 3px 8px !important; font-size: 11px !important; font-weight: bold !important; cursor: pointer !important; opacity: 0; transition: opacity 0.2s ease !important; z-index: 100 !important; white-space: nowrap !important; pointer-events: auto !important; }',
                '.ianto-gem-classify-btn:hover { background: #0842a0 !important; opacity: 1 !important; }'
            ].join(' ');
            document.head.appendChild(s);
        }

        function removeAll() {
            document.getElementById(CSS_ID) && document.getElementById(CSS_ID).remove();
            document.getElementById('ianto-gems-manager') && document.getElementById('ianto-gems-manager').remove();
            document.querySelectorAll('.ianto-gem-classify-btn').forEach(function(e) { e.remove(); });
        }

        function esc(s) { var d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }
        function saveData(cb) {
            console.log('[Gems] ===== SAVING DATA TO STORAGE =====');
            folders.forEach(function(f) { console.log('[Gems]   ' + f.name + ': open=' + f.open); });
            chrome.storage.local.set({ [FOLDER_KEY]: folders }, function() {
                console.log('[Gems] ===== VERIFYING SAVE FROM STORAGE =====');
                chrome.storage.local.get([FOLDER_KEY], function(r) {
                    if (r[FOLDER_KEY]) r[FOLDER_KEY].forEach(function(f) { console.log('[Gems]   ' + f.name + ': open=' + f.open); });
                    (cb || function(){})();
                });
            });
        }

        function getGemRows() {
            // Only select rows in the sidebar (side-navigation), not in the main gems page content
            var sidebar = document.querySelector('side-navigation-v2, side-navigation-drawer, nav');
            if (!sidebar) return [];
            return Array.from(sidebar.querySelectorAll('bot-list-row .bot-list-row-container'));
        }

        function syncGemHides() {
            var inFolder = new Set();
            folders.forEach(function(f) {
                (f.gems || []).forEach(function(g) { if (g.href) inFolder.add(g.href); });
            });
            getGemRows().forEach(function(rowContainer) {
                var info = getGemInfo(rowContainer);
                if (!info) return;
                var row = rowContainer.closest('bot-list-row') || rowContainer.parentElement;
                // 已传送到我们的文件夹内，跳过
                if (row.closest('#ianto-gems-manager')) return;
                if (inFolder.has(info.href)) {
                    row.style.display = 'none';
                } else {
                    if (row.style.display === 'none') row.style.display = '';
                }
            });
        }

        function getGemInfo(rowContainer) {
            var a = rowContainer.querySelector('a.bot-row') || rowContainer.querySelector('a[href]');
            if (!a) return null;
            return { href: a.getAttribute('href') || '', name: a.textContent.trim().substring(0, 80) };
        }

        function renderFolders() {
            console.log('[Gems] ===== renderFolders STARTING =====');
            folders.forEach(function(f) { console.log('[Gems]   folder ' + f.name + ': open=' + f.open); });
            var mgr = document.getElementById('ianto-gems-manager');
            if (!mgr) return;

            // Clear existing folder UI (keep header)
            var hdr = mgr.querySelector('.ianto-header');
            mgr.innerHTML = '';
            if (hdr) mgr.appendChild(hdr);

            folders.forEach(function(folder) {
                var id = folder.id;
                var open = folder.open !== false;
                console.log('[Gems]   rendering: ' + folder.name + ' -> open=' + open);

                var el = document.createElement('div');
                el.className = 'ianto-folder';
                el.dataset.folderId = id;
                el.setAttribute('draggable', 'true');

                var titleEl = document.createElement('div');
                titleEl.className = 'ianto-folder-title';
                titleEl.innerHTML =
                    '<span style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">' +
                    '<span style="font-size:9px;opacity:.5">' + (open ? '\u25BC' : '\u25B6') + '</span>' +
                    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(folder.name) + '</span>' +
                    '<span style="font-size:11px;opacity:.4;margin-left:4px">' + (folder.gems || []).length + '</span>' +
                    '</span>' +
                    '<span class="ianto-folder-del" title="\u5220\u9664\u5206\u7ec4">\u2715</span>';

                titleEl.querySelector('.ianto-folder-del').addEventListener('click', function(e) {
                    e.stopPropagation();
                    if (!confirm('\u5220\u9664\u5206\u7ec4"' + folder.name + '"\uff1f')) return;
                    (folder.gems || []).forEach(function(gem) { _returnGemRow(gem.href); });
                    folders = folders.filter(function(f) { return f.id !== id; }); saveData(renderFolders);
                });
                titleEl.addEventListener('click', function(e) {
                    if (e.target.closest('.ianto-folder-del')) return;
                    // 重新从数组中查找当前folder，确保获取最新的状态
                    console.log('[Gems] click on folder ' + id + ', current folders array:', folders.map(function(f) { return { id: f.id, name: f.name, open: f.open }; }));
                    var currentFolder = folders.find(function(f) { return f.id === id; });
                    if (currentFolder) {
                        console.log('[Gems] folder click, id=' + id + ', old open=' + currentFolder.open);
                        currentFolder.open = !currentFolder.open;
                        console.log('[Gems] after toggle, new open=' + currentFolder.open + ', folders array now:', folders.map(function(f) { return { id: f.id, name: f.name, open: f.open }; }));

                        // 立即更新 DOM（避免重新渲染导致的 DOM 状态丢失）
                        content.classList.toggle('open');
                        // 同时更新其中的 gem 行的 display 状态
                        var isOpen = content.classList.contains('open');
                        content.querySelectorAll('bot-list-row').forEach(function(row) {
                            row.style.display = isOpen ? '' : 'none';
                        });

                        saveData();
                    } else {
                        console.log('[Gems] ERROR: could not find folder with id=' + id + ' in folders array!');
                    }
                });

                // Drag: 借鉴 Claude 侧边栏的实现
                el.draggable = true;

                // 同时保留 HTML5 drag API 的支持
                el.addEventListener('dragenter', function(e) {
                    if (gemDragData && gemDragSrc === 'folder') {
                        e.preventDefault();
                        console.log('[Gems] dragenter on folder:', id);
                        titleEl.style.background = 'rgba(11,87,208,0.12)';
                    }
                });
                el.addEventListener('dragover', function(e) {
                    if (gemDragData && gemDragSrc === 'folder') {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                    }
                });
                el.addEventListener('dragleave', function(e) { if (!el.contains(e.relatedTarget)) titleEl.style.background = ''; });
                el.addEventListener('drop', function(e) {
                    console.log('[Gems] drop on folder:', id, 'gemDragSrc:', gemDragSrc, 'gemDragData:', gemDragData);
                    e.preventDefault(); titleEl.style.background = '';
                    if (gemDragData && gemDragSrc === 'folder' && gemDragData.folderId !== id) {
                        console.log('[Gems] folder reorder: src=' + gemDragData.folderId + ' -> tgt=' + id);
                        var srcIdx = folders.findIndex(function(f) { return f.id === gemDragData.folderId; });
                        var tgtIdx = folders.findIndex(function(f) { return f.id === id; });
                        console.log('[Gems] indices: srcIdx=' + srcIdx + ' tgtIdx=' + tgtIdx);
                        if (srcIdx !== -1 && tgtIdx !== -1) {
                            var movedFolder = folders.splice(srcIdx, 1)[0];
                            // 如果源索引小于目标索引，删除后目标索引会自动减1
                            if (srcIdx < tgtIdx) tgtIdx--;
                            folders.splice(tgtIdx, 0, movedFolder);
                            console.log('[Gems] reorder done, new folders:', folders.map(function(f) { return f.id; }));
                            saveData(renderFolders);
                        }
                    } else if (gemDragData && gemDragSrc === 'native') {
                        var tgtFolder = folders.find(function(f) { return f.id === id; });
                        if (tgtFolder) {
                            if (!tgtFolder.gems) tgtFolder.gems = [];
                            if (!tgtFolder.gems.some(function(g) { return g.href === gemDragData.href; })) {
                                tgtFolder.gems.push({ href: gemDragData.href, name: gemDragData.name });
                                saveData(renderFolders);
                            }
                        }
                    } else if (gemDragData && gemDragSrc === 'item' && gemDragData.folderId !== id) {
                        var srcFolder = folders.find(function(f) { return f.id === gemDragData.folderId; });
                        var tgtFolder = folders.find(function(f) { return f.id === id; });
                        if (srcFolder && tgtFolder) {
                            var moving = srcFolder.gems && srcFolder.gems.find(function(g) { return g.href === gemDragData.href; });
                            if (moving) {
                                srcFolder.gems = srcFolder.gems.filter(function(g) { return g.href !== gemDragData.href; });
                                if (!tgtFolder.gems) tgtFolder.gems = [];
                                if (!tgtFolder.gems.some(function(g) { return g.href === moving.href; })) {
                                    tgtFolder.gems.push({ href: moving.href, name: moving.name });
                                }
                                saveData(renderFolders);
                            }
                        }
                    }
                    gemDragSrc = null; gemDragData = null;
                });

                el.appendChild(titleEl);

                var content = document.createElement('div');
                content.className = 'ianto-folder-content' + (open ? ' open' : '');

                // Move native bot-list-row nodes into this folder content area
                (folder.gems || []).forEach(function(gem) {
                    var row = _findGemRow(gem.href);
                    if (row) {
                        row.style.display = '';
                        content.appendChild(row);
                        _ensureGemRemoveBtn(row, gem.href, id);
                        // Hide classify button inside folder
                        var cBtn = row.querySelector('.ianto-gem-classify-btn');
                        if (cBtn) cBtn.style.display = 'none';
                    }
                });

                el.appendChild(content);
                mgr.appendChild(el);
            });

            // After moving rows into folders, sync hides for remaining rows
            syncGemHides();
        }

        function reteleportGems() {
            // Re-teleport gems that should be in folders but aren't
            folders.forEach(function(folder) {
                var id = folder.id;
                var folderEl = document.querySelector('#ianto-gems-manager .ianto-folder[data-folder-id="' + id + '"]');
                if (!folderEl) return;
                var contentEl = folderEl.querySelector('.ianto-folder-content');
                if (!contentEl) return;
                (folder.gems || []).forEach(function(gem) {
                    var row = _findGemRow(gem.href);
                    if (!row) return;
                    // Only teleport if not already in the folder
                    if (!row.closest('.ianto-folder-content')) {
                        row.style.display = contentEl.classList.contains('open') ? '' : 'none';
                        contentEl.appendChild(row);
                        _ensureGemRemoveBtn(row, gem.href, id);
                        var cBtn = row.querySelector('.ianto-gem-classify-btn');
                        if (cBtn) cBtn.style.display = 'none';
                    }
                });
            });
        }

        // 在所有 bot-list-row 中（包括暂存区）按 href 查找
        function _findGemRow(href) {
            var found = null;
            // Search in both the sidebar AND our gems manager (rows get moved there)
            document.querySelectorAll('side-navigation-v2 bot-list-row, side-navigation-drawer bot-list-row, nav bot-list-row, #ianto-gems-manager bot-list-row').forEach(function(row) {
                var a = row.querySelector('a.bot-row') || row.querySelector('a[href]');
                if (a && a.getAttribute('href') === href) found = row;
            });
            return found;
        }

        // 在 row 中注入"移出分组"按钮（克隆原生按钮以保持样式一致）
        function _ensureGemRemoveBtn(row, href, folderId) {
            var container = row.querySelector('.bot-list-row-container');
            if (!container) return;

            // Already has one
            if (container.querySelector('.ianto-gem-remove-btn')) return;

            // Find the native action buttons container (the wrapper that holds the 3-dot button)
            // In Gemini's sidebar, buttons are inside a container with class containing 'action'
            // or they are direct children buttons of the row container
            var nativeButtons = container.querySelectorAll('button');
            var threeDotBtn = null;
            nativeButtons.forEach(function(btn) {
                // The 3-dot menu button typically has mat-mdc-icon-button class or contains a vertical ellipsis icon
                if (btn.classList.contains('mat-mdc-icon-button') && !btn.classList.contains('ianto-gem-classify-btn')) {
                    threeDotBtn = btn;
                }
            });

            var removeBtn = document.createElement('button');
            removeBtn.className = 'ianto-gem-remove-btn';
            removeBtn.title = '\u79fb\u51fa\u5206\u7ec4';
            removeBtn.style.cssText = 'background:transparent;border:none;cursor:pointer;color:inherit;padding:4px;border-radius:50%;opacity:0;transition:opacity 0.15s;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;flex-shrink:0;';
            removeBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>';

            // Show on row hover
            container.addEventListener('mouseenter', function() { removeBtn.style.opacity = '1'; });
            container.addEventListener('mouseleave', function() { removeBtn.style.opacity = '0'; removeBtn.style.background = 'transparent'; });
            removeBtn.addEventListener('mouseenter', function() { removeBtn.style.background = 'rgba(128,128,128,0.15)'; });
            removeBtn.addEventListener('mouseleave', function() { removeBtn.style.background = 'transparent'; });

            removeBtn.addEventListener('click', function(e) {
                e.preventDefault(); e.stopPropagation();
                var targetFolder = folders.find(function(f) { return f.id === folderId; });
                if (targetFolder && targetFolder.gems) {
                    targetFolder.gems = targetFolder.gems.filter(function(g) { return g.href !== href; });
                }
                _returnGemRow(href);
                saveData(renderFolders);
            });

            // Insert before the 3-dot button if found, otherwise append
            if (threeDotBtn && threeDotBtn.parentElement) {
                threeDotBtn.parentElement.insertBefore(removeBtn, threeDotBtn);
            } else {
                container.appendChild(removeBtn);
            }
        }

        // 将 bot-list-row 移回暂存区，后续由 syncGemHides 和 addGemClassifyButtons 重新接管
        function _returnGemRow(href) {
            var row = _findGemRow(href);
            if (!row) return;
            // Move back to sidebar list
            var sidebar = document.querySelector('side-navigation-v2, side-navigation-drawer, nav');
            if (!sidebar) return;
            var listContainer = sidebar.querySelector('.bot-list-container, bot-list');
            if (listContainer) {
                listContainer.appendChild(row);
            }
            row.style.display = '';
            row.style.order = '';
            var removeBtn = row.querySelector('.ianto-gem-remove-btn');
            if (removeBtn) removeBtn.remove();
            var classifyBtn = row.querySelector('.ianto-gem-classify-btn');
            if (classifyBtn) classifyBtn.style.display = '';
        }

        function buildGemsUI() {
            if (document.getElementById('ianto-gems-manager')) return;
            var insertBefore = document.querySelector('.list-header, .bot-list-container');
            if (!insertBefore) return;
            var parent = insertBefore.parentElement;
            if (!parent) return;

            var mgr = document.createElement('div');
            mgr.id = 'ianto-gems-manager';

            var hdr = document.createElement('div');
            hdr.className = 'ianto-header';
            hdr.innerHTML = '<span class="ianto-title">\u5206\u7ec4</span><button class="ianto-new-btn">\uff0b \u65b0\u5efa\u5206\u7ec4</button>';
            hdr.querySelector('.ianto-new-btn').addEventListener('click', function() { promptCreate(null); });
            mgr.appendChild(hdr);
            parent.insertBefore(mgr, insertBefore);
            renderFolders(); // 必须在插入 DOM 之后调用
        }

        function addGemClassifyButtons() {
            if (!enabled) return;
            getGemRows().forEach(function(rowContainer) {
                // 已在文件夹内的 gem，由 reteleportGems 管理，跳过
                if (rowContainer.closest('#ianto-gems-manager')) return;
                if (rowContainer.dataset.iantoGemMark) return;
                rowContainer.dataset.iantoGemMark = '1';

                var btn = document.createElement('button');
                btn.className = 'ianto-gem-classify-btn';
                btn.textContent = '\uD83D\uDCC1 \u5206\u7ec4';
                btn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); showClassifyModal(rowContainer); });
                rowContainer.appendChild(btn);

                rowContainer.addEventListener('mouseenter', function() { btn.style.opacity = '1'; });
                rowContainer.addEventListener('mouseleave', function() { btn.style.opacity = '0'; });

                var info = getGemInfo(rowContainer);
                if (info) {
                    rowContainer.draggable = true;
                    rowContainer.addEventListener('dragstart', function(e) {
                        if (rowContainer.closest('#ianto-gems-manager')) return;
                        gemDragSrc = 'native'; gemDragData = { href: info.href, name: info.name };
                        e.dataTransfer.setData('text/plain', 'ianto-gem-drag');
                        setTimeout(function() { rowContainer.style.opacity = '0.4'; }, 0);
                    });
                    rowContainer.addEventListener('dragend', function() {
                        rowContainer.style.opacity = ''; gemDragSrc = null; gemDragData = null;
                    });
                }
            });
            syncGemHides();
        }

        function showClassifyModal(rowContainer) {
            var info = getGemInfo(rowContainer);
            if (!info) return;
            if (!folders.length) { promptCreate(info); return; }

            var overlay = document.getElementById('ianto-gem-modal') || document.createElement('div');
            overlay.id = 'ianto-gem-modal';
            overlay.className = 'ianto-modal-overlay';
            overlay.style.display = 'flex';
            overlay.innerHTML =
                '<div class="ianto-modal-card">' +
                '<div class="ianto-modal-title">\u6dfb\u52a0\u5230\u5206\u7ec4</div>' +
                '<div class="ianto-modal-desc">' + esc(info.name) + '</div>' +
                '<select class="ianto-modal-select" id="ianto-gem-sel">' +
                folders.map(function(folder) { return '<option value="' + esc(folder.id) + '">' + esc(folder.name) + '</option>'; }).join('') +
                '</select>' +
                '<div class="ianto-modal-footer">' +
                '<button class="ianto-btn-cancel" id="ianto-gem-new">\uff0b \u65b0\u5efa\u5206\u7ec4</button>' +
                '<button class="ianto-btn-confirm" id="ianto-gem-ok">\u786e\u5b9a</button>' +
                '</div></div>';
            if (!overlay.parentElement) document.body.appendChild(overlay);
            overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.style.display = 'none'; });
            overlay.querySelector('#ianto-gem-ok').onclick = function() {
                var selId = overlay.querySelector('#ianto-gem-sel').value;
                var targetFolder = folders.find(function(f) { return f.id === selId; });
                if (targetFolder) {
                    if (!targetFolder.gems) targetFolder.gems = [];
                    if (!targetFolder.gems.some(function(g) { return g.href === info.href; })) {
                        targetFolder.gems.push({ href: info.href, name: info.name });
                        saveData(); renderFolders();
                    }
                }
                overlay.style.display = 'none';
            };
            overlay.querySelector('#ianto-gem-new').onclick = function() {
                overlay.style.display = 'none'; promptCreate(info);
            };
        }

        function promptCreate(autoGem) {
            var overlay = document.getElementById('ianto-gem-create-modal') || document.createElement('div');
            overlay.id = 'ianto-gem-create-modal';
            overlay.className = 'ianto-modal-overlay';
            overlay.style.display = 'flex';
            overlay.innerHTML =
                '<div class="ianto-modal-card">' +
                '<div class="ianto-modal-title">\u65b0\u5efa\u5206\u7ec4</div>' +
                '<div class="ianto-modal-desc">' + (autoGem ? esc(autoGem.name) : '') + '</div>' +
                '<input type="text" class="ianto-modal-input" id="ianto-gem-inp" placeholder="\u5206\u7ec4\u540d\u79f0\u2026" autocomplete="off" />' +
                '<div class="ianto-modal-footer">' +
                '<button class="ianto-btn-cancel" id="ianto-gem-cancel">\u53d6\u6d88</button>' +
                '<button class="ianto-btn-confirm" id="ianto-gem-create">\u786e\u5b9a</button>' +
                '</div></div>';
            if (!overlay.parentElement) document.body.appendChild(overlay);
            overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.style.display = 'none'; });
            var inp = overlay.querySelector('#ianto-gem-inp');
            setTimeout(function() { inp.focus(); }, 80);
            overlay.querySelector('#ianto-gem-create').onclick = function() {
                var name = inp.value.trim(); if (!name) return;
                var id = 'gemf_' + Date.now();
                var newFolder = { id: id, name: name, gems: [], open: true };
                if (autoGem) newFolder.gems.push({ href: autoGem.href, name: autoGem.name });
                folders.push(newFolder);
                saveData(); renderFolders();
                overlay.style.display = 'none';
            };
            overlay.querySelector('#ianto-gem-cancel').onclick = function() { overlay.style.display = 'none'; };
            inp.onkeydown = function(e) { if (e.key === 'Enter') overlay.querySelector('#ianto-gem-create').click(); };
        }

        function setupMoveGemsLabsToBottom() {
            // 用 MutationObserver 监听"Gems made by Labs"出现，然后移到最后
            if (window.iantoGemsLabsObserverSetup) return;
            window.iantoGemsLabsObserverSetup = true;

            var moved = false;
            new MutationObserver(function() {
                if (moved) return;

                var allText = Array.from(document.querySelectorAll('*')).filter(function(el) {
                    return el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 && el.textContent.trim() === 'Gems made by Labs';
                });

                if (allText.length > 0) {
                    var heading = allText[0];
                    var mainContainer = heading.closest('main, [role="main"]');
                    if (mainContainer) {
                        moved = true;
                        console.log('[Gems] found "Gems made by Labs", moving to bottom');
                        // 找到heading后面的所有siblings，都移到最后
                        var el = heading.nextElementSibling;
                        while (el) {
                            var next = el.nextElementSibling;
                            mainContainer.appendChild(el);
                            el = next;
                        }
                        mainContainer.appendChild(heading);
                    }
                }
            }).observe(document.body, { childList: true, subtree: true });
        }

        function applyGemsBookmarks(isEnabled) {
            enabled = isEnabled !== false;
            if (!window.location.href.includes('/gems/view')) return;
            if (enabled) {
                console.log('[Gems] applyGemsBookmarks: starting with folders:', folders.map(function(f) { return { id: f.id, name: f.name, open: f.open }; }));
                injectCSS(); buildGemsUI(); addGemClassifyButtons(); setupMoveGemsLabsToBottom();
                // 延迟重试：部分区域（如"与我共享"）lazy-load，初始化时节点尚未覆盖
                setTimeout(function() {
                    console.log('[Gems] applyGemsBookmarks delayed: re-rendering with folders:', folders.map(function(f) { return { id: f.id, name: f.name, open: f.open }; }));
                    var placeholders = document.querySelectorAll('#ianto-gems-manager a.ianto-gem-item');
                    if (placeholders.length > 0) renderFolders();
                    addGemClassifyButtons(); syncGemHides();
                }, 1500);
            } else { removeAll(); }
        }

        console.log('[Gems] starting storage load...');
        chrome.storage.local.get(['gemini_optimized_enabled', FOLDER_KEY], function(r) {
            console.log('[Gems] storage.get callback fired, FOLDER_KEY=' + FOLDER_KEY + ', r[FOLDER_KEY]=' + (r[FOLDER_KEY] ? (Array.isArray(r[FOLDER_KEY]) ? 'array' : 'object') : 'undefined'));
            if (r[FOLDER_KEY]) {
                if (Array.isArray(r[FOLDER_KEY])) {
                    folders = r[FOLDER_KEY];
                    console.log('[Gems] ===== PAGE REFRESH: loaded folders from storage =====');
                    folders.forEach(function(f) { console.log('[Gems]   - ' + f.name + ' (id=' + f.id + ') open=' + f.open); });
                } else {
                    // 从旧的对象格式转换到新的数组格式
                    console.log('[Gems] converting from old object format...');
                    folders = Object.keys(r[FOLDER_KEY]).map(function(id) {
                        var obj = r[FOLDER_KEY][id];
                        return { id: id, name: obj.name, gems: obj.gems || [], open: obj.open !== false };
                    });
                    console.log('[Gems] converted from old format:', folders.map(function(f) { return { id: f.id, name: f.name, open: f.open }; }));
                    saveData(); // 保存转换后的数据
                }
            } else {
                console.log('[Gems] no stored folders found, starting with empty array');
                folders = [];
            }
            enabled = r['gemini_optimized_enabled'] !== false;
            console.log('[Gems] enabled=' + enabled + ', location includes /gems/view: ' + window.location.href.includes('/gems/view'));
            if (window.location.href.includes('/gems/view')) {
                (function tryBuild() {
                    if (document.querySelector('bot-list-row')) { applyGemsBookmarks(true); }
                    else setTimeout(tryBuild, 600);
                })();
            }
        });

        chrome.storage.onChanged.addListener(function(changes) {
            if (changes['gemini_optimized_enabled']) {
                enabled = changes['gemini_optimized_enabled'].newValue !== false;
                if (window.location.href.includes('/gems/view')) applyGemsBookmarks(true);
            }
        });

        // 全局拖拽事件（借鉴 Claude 侧边栏实现）
        var gemsDragSrc = null, gemsDragType = null;
        if (!window.iantoGemsGlobalDragInitialized) {
            window.iantoGemsGlobalDragInitialized = true;
            document.addEventListener('dragstart', function(e) {
                var folder = e.target.closest('.ianto-folder[draggable="true"]');
                if (folder && folder.closest('#ianto-gems-manager')) {
                    gemsDragSrc = folder;
                    gemsDragType = 'gems-folder';
                    if (e.dataTransfer) e.dataTransfer.setData('text/plain', 'ianto-gems-folder');
                    e.stopPropagation();
                    console.log('[Gems] dragstart, folder id:', folder.dataset.folderId);
                }
            }, true);
            document.addEventListener('dragover', function(e) {
                if (gemsDragType === 'gems-folder' && gemsDragSrc) {
                    var targetFolder = e.target.closest('.ianto-folder');
                    if (targetFolder && targetFolder.closest('#ianto-gems-manager')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                    }
                }
            }, true);
            document.addEventListener('drop', function(e) {
                if (gemsDragType === 'gems-folder' && gemsDragSrc) {
                    var targetFolder = e.target.closest('.ianto-folder');
                    var container = document.querySelector('#ianto-gems-manager');
                    if (targetFolder && targetFolder !== gemsDragSrc && container) {
                        e.preventDefault();
                        var rect = targetFolder.getBoundingClientRect();
                        var isTopHalf = (e.clientY - rect.top) / rect.height < 0.5;
                        container.insertBefore(gemsDragSrc, isTopHalf ? targetFolder : targetFolder.nextSibling);
                        console.log('[Gems] drop done, updating folders array from DOM');
                        // 根据新的 DOM 顺序更新 folders 数组
                        var newOrder = [];
                        container.querySelectorAll('.ianto-folder').forEach(function(el) {
                            var id = el.dataset.folderId;
                            var folder = folders.find(function(f) { return f.id === id; });
                            if (folder) newOrder.push(folder);
                        });
                        folders = newOrder;
                        saveData(renderFolders);
                    }
                    gemsDragSrc = null; gemsDragType = null;
                }
            }, true);
        }

        var gemsUiTimer = null;
        var gemsMounting = false;
        new MutationObserver(function() {
            if (!window.location.href.includes('/gems/view')) return;
            // mgr 消失时立即重建
            if (!gemsMounting && !document.getElementById('ianto-gems-manager')) {
                gemsMounting = true; buildGemsUI(); gemsMounting = false;
            }
            clearTimeout(gemsUiTimer);
            gemsUiTimer = setTimeout(function() {
                addGemClassifyButtons();
                reteleportGems();
                syncGemHides();
            }, 400);
        }).observe(document.body, { childList: true, subtree: true });
    })();

})();
