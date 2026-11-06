// feature_auto_backup_ui.js - 自动备份管理界面

// 下载待下载的备份文件（使用 data URL + chrome.downloads API）
function downloadPendingBackup(backupData) {
    const jsonContent = JSON.stringify(backupData, null, 2);
    const fileName = `Ianto_AI_Bookmarks_${backupData.timestamp}.json`;

    // 使用 data URL 方式（更兼容 chrome.downloads API）
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonContent);

    // 使用 chrome.downloads API 下载到用户指定的下载文件夹
    chrome.downloads.download({
        url: dataUrl,
        filename: fileName,
        saveAs: false  // 不显示保存对话框，直接保存到下载文件夹
    }, (downloadId) => {
        if (chrome.runtime.lastError) {
            console.error('[Auto Backup] 下载失败:', chrome.runtime.lastError);
            alert('❌ 下载失败：' + chrome.runtime.lastError.message);
        } else {
            console.log('[Auto Backup] 文件已下载，ID:', downloadId);
        }
    });

    return fileName;
}

// 手动触发备份
function triggerManualBackup() {
    const btn = document.getElementById('backup_manual_btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '⏳ 正在备份...';

        try {
            // 直接在 popup 中获取数据（更可靠）
            const backupKeys = [
                'gemini_custom_folders_data',
                'gems_custom_folders_data',
                'claude_custom_folders_data',
                'notebooklm_custom_folders_data',
                'chatgpt_custom_folders_data',
                'manus_custom_folders_data',
                'grok_custom_folders_data'
            ];

            const storageData = await new Promise(resolve => {
                chrome.storage.local.get(backupKeys, resolve);
            });

            // 组织数据
            const backupData = {
                Gemini: storageData.gemini_custom_folders_data || {},
                Gems: storageData.gems_custom_folders_data || {},
                Claude: storageData.claude_custom_folders_data || {},
                NotebookLM: storageData.notebooklm_custom_folders_data || {},
                ChatGPT: storageData.chatgpt_custom_folders_data || {},
                Manus: storageData.manus_custom_folders_data || {},
                Grok: storageData.grok_custom_folders_data || {}
            };

            // 生成时间戳和文件名
            const now = new Date();
            const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const fileName = `Ianto_AI_Bookmarks_${timestamp}.json`;

            // 创建 blob 并通过 a 标签下载（最简单最兼容的方法）
            const jsonContent = JSON.stringify({
                backup_time: now.toLocaleString('zh-CN'),
                timestamp: timestamp,
                data: backupData
            }, null, 2);

            const blob = new Blob([jsonContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            setTimeout(() => URL.revokeObjectURL(url), 100);

            // 更新 storage 中的备份时间，让页面显示最新时间
            await new Promise(resolve => {
                chrome.storage.local.set({ auto_backup_last_time: timestamp }, resolve);
            });

            console.log('[Manual Backup] ✅ 文件已下载:', fileName);
            alert('✅ 已保存新备份到本地！\n\n文件名: ' + fileName + '\n\n请检查Chrome下载文件夹：\nCtrl+J 查看下载历史');

            updateBackupStatus();

        } catch (error) {
            console.error('[Manual Backup] ❌ 备份失败:', error);
            alert('❌ 备份失败: ' + error.message);
        }

        btn.disabled = false;
        btn.textContent = '📥 立即备份（综合）';
    });
}

// 触发一键恢复
function triggerGlobalRestore() {
    const btn = document.getElementById('backup_restore_btn');
    const fileInput = document.getElementById('backup_restore_file');
    if (!btn || !fileInput) return;

    btn.addEventListener('click', () => {
        if (confirm('⚠️ 警告：这将会用选中的备份文件直接覆盖当前所有 AI 平台（Gemini, Gems, Claude, NotebookLM, ChatGPT, Manus）的书签分类数据！\n\n您确定要继续恢复吗？')) {
            fileInput.click();
        }
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const content = JSON.parse(event.target.result);
                
                // 验证格式
                if (!content.data || !content.backup_time) {
                    throw new Error('所选文件不是有效的综合备份格式 (缺少 data 或 backup_time)。');
                }

                const d = content.data;
                const updatePayload = {};
                
                if (d.Gemini) updatePayload['gemini_custom_folders_data'] = d.Gemini;
                if (d.Gems) updatePayload['gems_custom_folders_data'] = d.Gems;
                if (d.Claude) updatePayload['claude_custom_folders_data'] = d.Claude;
                if (d.NotebookLM) updatePayload['notebooklm_custom_folders_data'] = d.NotebookLM;
                if (d.ChatGPT) updatePayload['chatgpt_custom_folders_data'] = d.ChatGPT;
                if (d.Manus) updatePayload['manus_custom_folders_data'] = d.Manus;
                if (d.Grok) updatePayload['grok_custom_folders_data'] = d.Grok;

                if (Object.keys(updatePayload).length > 0) {
                    await new Promise(resolve => {
                        chrome.storage.local.set(updatePayload, resolve);
                    });
                    
                    // 👉 关键修复：主动强制刷新相关的 AI 网页，防止内存脏数据再次复写
                    chrome.tabs.query({}, (tabs) => {
                        tabs.forEach(tab => {
                            if (tab.url) {
                                const u = tab.url;
                                if (u.includes('gemini.google.com') ||
                                    u.includes('notebook.google.com') ||
                                    u.includes('claude.ai') ||
                                    u.includes('chatgpt.com') || u.includes('chat.openai.com') ||
                                    u.includes('manus.im') ||
                                    u.includes('grok.com')) {
                                    chrome.tabs.reload(tab.id);
                                }
                            }
                        });
                    });

                    alert(`✅ 综合备份恢复成功！\n\n所属时间: ${content.backup_time}\n共覆盖了 ${Object.keys(updatePayload).length} 个平台的数据。\n\n系统已为您自动刷新相关的 AI 网页即可生效。`);
                } else {
                    throw new Error('虽然格式正确，但在备份文件中没找到那 6 个平台的数据。');
                }
            } catch (error) {
                console.error('[Global Restore] 恢复失败:', error);
                alert('❌ 恢复失败: ' + error.message);
            }
            // 清理 input，方便重复选同名文件
            fileInput.value = '';
        };
        reader.readAsText(file);
    });
}

// 更新备份状态显示
function updateBackupStatus() {
    const statusDiv = document.getElementById('backup_status');
    if (!statusDiv) return;

    chrome.runtime.sendMessage({ action: 'getBackupStatus' }, (response) => {
        if (response && response.lastBackupTime) {
            const timeStr = response.lastBackupTime;
            // 格式化时间戳显示，比如 "2026-04-09 10:30:45"
            const formatted = timeStr.replace('T', ' ').replace(/-(\d{2})$/g, ':$1');
            statusDiv.innerHTML = `<p style="margin: 0;">✅ 上次备份时间：<strong>${formatted}</strong></p>`;
        } else {
            statusDiv.innerHTML = `<p style="margin: 0;">⏳ 等待首次备份...（第一次备份将在下次运行时进行）</p>`;
        }
    });
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    triggerManualBackup();
    triggerGlobalRestore();
    updateBackupStatus();

    // 定期刷新备份状态（每2分钟）
    setInterval(updateBackupStatus, 120000);

    // 诊断：打印 storage 中的数据情况
    console.log('[Auto Backup] 开始诊断...');
    const backupKeys = [
        'gemini_custom_folders_data',
        'gems_custom_folders_data',
        'claude_custom_folders_data',
        'notebooklm_custom_folders_data',
        'chatgpt_custom_folders_data',
        'manus_custom_folders_data',
        'grok_custom_folders_data'
    ];

    chrome.storage.local.get(backupKeys, (result) => {
        console.log('[Auto Backup] Storage 中的数据：', result);
        console.log('[Auto Backup] 数据摘要：');
        backupKeys.forEach(key => {
            const data = result[key];
            console.log(`  ${key}: ${data ? Object.keys(data).length + ' 项' : '无数据'}`);
        });
    });
});
