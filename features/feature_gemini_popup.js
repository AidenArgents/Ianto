// feature_gemini_popup.js

const toggleWidthButton = document.getElementById('gemini_toggle_width_btn');
const toggleManusButton = document.getElementById('manus_toggle_width_btn');
const toggleClaudeButton = document.getElementById('claude_toggle_width_btn');
const toggleChatGPTBtn  = document.getElementById('chatgpt_toggle_width_btn');
const toggleGrokBtn     = document.getElementById('grok_toggle_width_btn');

// ── 统一按钮状态样式 ──────────────────────────────────────────────────────
function setBtn(btn, enabled, labelOn, labelOff, colorOn, colorOff) {
    if (!btn) return;
    if (enabled) {
        btn.textContent = labelOn;
        btn.style.backgroundColor = colorOn;
        btn.style.color = '#fff';
    } else {
        btn.textContent = labelOff;
        btn.style.backgroundColor = colorOff;
        btn.style.color = '#fff';
    }
}

// ── 加载所有按钮初始状态 ─────────────────────────────────────────────────
chrome.storage.local.get(['gemini_optimized_enabled', 'claude_width_enabled', 'manus_width_enabled', 'chatgpt_width_enabled', 'grok_width_enabled'], (r) => {
    setBtn(toggleWidthButton, r.gemini_optimized_enabled, '✅ Gemini/NotebookLM 已开启', '⭕ 开启 Gemini/NotebookLM 优化', '#4CAF50', '#888');
    setBtn(toggleClaudeButton, r.claude_width_enabled, '✅ Claude 优化 已开启', '⭕ 开启 Claude 优化', '#d97757', '#888');
    setBtn(toggleManusButton, r.manus_width_enabled, '✅ Manus 优化 已开启', '⭕ 开启 Manus 优化', '#333', '#888');
    setBtn(toggleChatGPTBtn, r.chatgpt_width_enabled, '✅ ChatGPT 优化 已开启', '⭕ 开启 ChatGPT 优化', '#10a37f', '#888');
    setBtn(toggleGrokBtn, r.grok_width_enabled, '✅ Grok 优化 已开启', '⭕ 开启 Grok 优化', '#19c37d', '#888');
});

// --- Gemini & NotebookLM 宽度逻辑 ---
if (toggleWidthButton) {
    toggleWidthButton.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (!currentTab || !currentTab.url) return;

            const isGemini = currentTab.url.startsWith('https://gemini.google.com/');
            const isNotebookLM = currentTab.url.startsWith('https://notebook.google.com/');

            if (isGemini || isNotebookLM) {
                chrome.tabs.sendMessage(currentTab.id, { action: 'toggleWidth' }, (response) => {
                    if (chrome.runtime.lastError) {
                        alert('无法发送命令：请确保页面已完全加载并刷新后重试。');
                    } else {
                        const on = response && response.enabled;
                        setBtn(toggleWidthButton, on, '✅ Gemini/NotebookLM 已开启', '⭕ 开启 Gemini/NotebookLM 优化', '#4CAF50', '#888');
                    }
                });
            } else {
                alert('请在 Gemini 或 NotebookLM 页面上使用此功能。');
            }
        });
    });
}

// --- Claude 宽度逻辑 ---
if (toggleClaudeButton) {
    toggleClaudeButton.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (!currentTab || !currentTab.url) return;

            if (currentTab.url.startsWith('https://claude.ai/')) {
                chrome.tabs.sendMessage(currentTab.id, { action: 'toggleClaudeWidth' }, (response) => {
                    if (chrome.runtime.lastError) { alert('无法发送命令：请刷新后重试。'); }
                    else {
                        const on = response && response.enabled;
                        setBtn(toggleClaudeButton, on, '✅ Claude 优化 已开启', '⭕ 开启 Claude 优化', '#d97757', '#888');
                    }
                });
            } else { alert('请在 Claude 页面上使用此功能。'); }
        });
    });
}

// --- Manus 宽度逻辑 ---
if (toggleManusButton) {
    toggleManusButton.addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('manus.im')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleManusWidth' }, (response) => {
                    if (chrome.runtime.lastError) { alert('请在 Manus 页面使用此功能。'); return; }
                    const on = response && response.enabled;
                    setBtn(toggleManusButton, on, '✅ Manus 优化 已开启', '⭕ 开启 Manus 优化', '#333', '#888');
                });
            } else {
                alert('请在 Manus 页面使用此功能。');
            }
        });
    });
}

// ==========================================
// 📁 统一数据导出/导入工厂函数
// ==========================================
function setupExportImport(exportBtnId, importBtnId, importFileId, storageKey, fileNamePrefix, successMsg) {
    const exportBtn = document.getElementById(exportBtnId);
    const importBtn = document.getElementById(importBtnId);
    const importFile = document.getElementById(importFileId);

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            chrome.storage.local.get([storageKey], function(result) {
                const dataStr = JSON.stringify(result[storageKey] || {}, null, 2);
                const blob = new Blob([dataStr], {type: "application/json"});
                const url = URL.createObjectURL(blob);
                const date = new Date().toISOString().slice(0, 10);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${fileNamePrefix}_${date}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });
        });
    }

    if (importBtn && importFile) {
        importBtn.addEventListener('click', () => importFile.click());
        importFile.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const data = JSON.parse(e.target.result);
                    chrome.storage.local.set({ [storageKey]: data }, function() {
                        // 触发对应的页面强制刷新，防止脏数据覆盖
                        chrome.tabs.query({}, (tabs) => {
                            tabs.forEach(tab => {
                                if (tab.url) {
                                    const u = tab.url;
                                    if (u.includes('gemini.google.com') ||
                                        u.includes('notebook.google.com') ||
                                        u.includes('claude.ai') ||
                                        u.includes('chatgpt.com') || u.includes('chat.openai.com') ||
                                        u.includes('manus.im')) {
                                        chrome.tabs.reload(tab.id);
                                    }
                                }
                            });
                        });
                        alert(successMsg.replace('请刷新', '系统已为您自动刷新'));
                        importFile.value = ''; 
                    });
                } catch (error) {
                    alert('❌ 解析文件失败，请确保选择了正确的 JSON 备份文件。');
                }
            };
            reader.readAsText(file);
        });
    }
}

// 绑定三大平台的备份按钮
setupExportImport('gemini_export_btn', 'gemini_import_btn', 'gemini_import_file', 'gemini_custom_folders_data', 'Gemini_Folders_Backup', '✅ Gemini 文件夹分类数据恢复成功！\n请刷新页面查看最新分类。');
setupExportImport('gems_export_btn', 'gems_import_btn', 'gems_import_file', 'gems_custom_folders_data', 'Gems_Bookmarks_Backup', '✅ Gems 书签数据恢复成功！\n请刷新 Gems 页面查看。');
setupExportImport('claude_export_btn', 'claude_import_btn', 'claude_import_file', 'claude_custom_folders_data', 'Claude_Folders_Backup', '✅ Claude 文件夹分类数据恢复成功！\n请刷新页面查看最新分类。');
setupExportImport('nlm_export_btn', 'nlm_import_btn', 'nlm_import_file', 'notebooklm_custom_folders_data', 'NotebookLM_Folders_Backup', '✅ NotebookLM 文件夹分类数据恢复成功！\n请刷新页面查看最新分类。');
// --- ChatGPT 宽度逻辑 ---
if (toggleChatGPTBtn) {
    toggleChatGPTBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (!currentTab || !currentTab.url) return;
            const isChatGPT = currentTab.url.includes('chatgpt.com') || currentTab.url.includes('chat.openai.com');
            if (isChatGPT) {
                chrome.tabs.sendMessage(currentTab.id, { action: 'toggleChatGPTWidth' }, (response) => {
                    if (chrome.runtime.lastError) { alert('无法发送命令：请确保页面已完全加载并刷新后重试。'); return; }
                    const on = response && response.enabled;
                    setBtn(toggleChatGPTBtn, on, '✅ ChatGPT 优化 已开启', '⭕ 开启 ChatGPT 优化', '#10a37f', '#888');
                });
            } else { alert('请在 ChatGPT 页面上使用此功能。'); }
        });
    });
}

// ChatGPT 数据备份
setupExportImport('chatgpt_export_btn', 'chatgpt_import_btn', 'chatgpt_import_file', 'chatgpt_custom_folders_data', 'ChatGPT_Folders_Backup', '✅ ChatGPT 文件夹分类数据恢复成功！\n请刷新页面查看最新分类。');
// Manus 数据备份
setupExportImport('manus_export_btn', 'manus_import_btn', 'manus_import_file', 'manus_custom_folders_data', 'Manus_Folders_Backup', '✅ Manus 文件夹分类数据恢复成功！\n请刷新页面查看最新分类。');

// --- Grok 宽度逻辑 ---
if (toggleGrokBtn) {
    toggleGrokBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (!currentTab || !currentTab.url) return;
            if (currentTab.url.includes('grok.com')) {
                chrome.tabs.sendMessage(currentTab.id, { action: 'toggleGrokWidth' }, (response) => {
                    if (chrome.runtime.lastError) { alert('无法发送命令：请确保页面已完全加载并刷新后重试。'); return; }
                    const on = response && response.enabled;
                    setBtn(toggleGrokBtn, on, '✅ Grok 优化 已开启', '⭕ 开启 Grok 优化', '#19c37d', '#888');
                });
            } else { alert('请在 Grok 页面上使用此功能。'); }
        });
    });
}

// Grok 数据备份
setupExportImport('grok_export_btn', 'grok_import_btn', 'grok_import_file', 'grok_custom_folders_data', 'Grok_Folders_Backup', '✅ Grok 文件夹分类数据恢复成功！\n请刷新页面查看最新分类。');
