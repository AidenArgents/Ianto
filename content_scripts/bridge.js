document.addEventListener('REQUEST_ERP_FETCH', function(e) {
    var done = false;
    function reply(detail) {
        if (done) return; done = true;
        clearTimeout(timer);
        detail.reqData = e.detail;            // 错误也带上 reqData，批量模式才能定位到具体行
        document.dispatchEvent(new CustomEvent('RESPONSE_ERP_FETCH', { detail: detail }));
    }
    // 后台页首次加载可能较慢；超时也必须回错，绝不让页面一直转
    var timer = setTimeout(function() {
        reply({ success: false, error: "查询超时（90秒）。请确认已在此浏览器登录领星，再刷新算价工具重试；正常无需手动打开领星页面" });
    }, 90000);
    try {
        chrome.runtime.sendMessage({ action: "fetchERP", sku: e.detail.sku, source: e.detail.source, preferDirector: e.detail.preferDirector }, function(response) {
            if (chrome.runtime.lastError || !response) {
                return reply({ success: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || "网关未响应" });
            }
            reply(response);
        });
    } catch (err) {
        // 插件刚重载、本页还是旧内容脚本时，sendMessage 会抛 "Extension context invalidated" → 这正是"一直转圈"的元凶
        reply({ success: false, error: "插件已更新，请刷新本页面(F5)后再查询" });
    }
});

document.addEventListener('REQUEST_SPU_FETCH', function(e) {
    let done = false;
    const timer = setTimeout(() => {
        if (done) return;
        done = true;
        document.dispatchEvent(new CustomEvent('RESPONSE_SPU_FETCH', { detail: { success: false, error: '抓取超时。请确认此浏览器中的领星登录状态和网络后重试；正常情况下无需手动打开领星或 Walmart 页面。' } }));
    }, 360000);
    const reply = response => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        document.dispatchEvent(new CustomEvent('RESPONSE_SPU_FETCH', { detail: response }));
    };
    try {
        chrome.runtime.sendMessage({ action: "fetchSPU", spu: e.detail.spu }, function(response) {
            if (chrome.runtime.lastError || !response) {
                reply({ success: false, error: chrome.runtime.lastError?.message || "网关未响应" });
            } else {
                reply(response);
            }
        });
    } catch (error) {
        reply({ success: false, error: '插件连接已更新，请刷新作图页面后重试。' });
    }
});

// --- 标题爬取桥接 ---
document.addEventListener('REQUEST_TITLE_SCRAPE', function(e) {
    const jobId = 'ts_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    chrome.runtime.sendMessage({ action: "scrapeTitles", ...e.detail, jobId: jobId }, function(response) {
        if (chrome.runtime.lastError || !response || !response.started) {
            document.dispatchEvent(new CustomEvent('RESPONSE_TITLE_SCRAPE', {
                detail: { success: false, error: chrome.runtime.lastError?.message || "插件未响应，请确认Ianto已安装并启用" }
            }));
            return;
        }

        const storageKey = 'titleScrape_' + jobId;

        const timer = setTimeout(function() {
            chrome.storage.onChanged.removeListener(onChanged);
            chrome.storage.local.remove(storageKey);
            document.dispatchEvent(new CustomEvent('RESPONSE_TITLE_SCRAPE', {
                detail: { success: false, error: "爬取超时（90秒），部分平台可能加载较慢" }
            }));
        }, 90000);

        function onChanged(changes, area) {
            if (area === 'local' && changes[storageKey]) {
                clearTimeout(timer);
                chrome.storage.onChanged.removeListener(onChanged);
                var result = changes[storageKey].newValue;
                chrome.storage.local.remove(storageKey);
                document.dispatchEvent(new CustomEvent('RESPONSE_TITLE_SCRAPE', { detail: result }));
            }
        }
        chrome.storage.onChanged.addListener(onChanged);
    });
});

// --- 健康检查 ping（VOC 分析工具用 · 判断 bridge.js 是否注入）---
document.addEventListener('REQUEST_IANTO_PING', function(e) {
    chrome.runtime.sendMessage({ action: "iantoPing" }, function(response) {
        document.dispatchEvent(new CustomEvent('RESPONSE_IANTO_PING', {
            detail: {
                bridgeLoaded: true,
                bgResponded: !chrome.runtime.lastError && !!response,
                bgError: chrome.runtime.lastError?.message || null,
                bgVersion: response?.version || null
            }
        }));
    });
});

// --- 评论爬取桥接（VOC 分析工具 v1）---
// 协议：REQUEST_REVIEW_SCRAPE
//   payload: { tasks: [{ url, cc, max }], visible }
// 响应：RESPONSE_REVIEW_SCRAPE
//   payload: { success, error?, results: { [url]: { productName, reviews:[{text,rating,date}] } } }
document.addEventListener('REQUEST_REVIEW_SCRAPE', function(e) {
    const jobId = 'rs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

    chrome.runtime.sendMessage({ action: "scrapeReviews", ...e.detail, jobId: jobId }, function(response) {
        if (chrome.runtime.lastError || !response || !response.started) {
            document.dispatchEvent(new CustomEvent('RESPONSE_REVIEW_SCRAPE', {
                detail: { success: false, error: chrome.runtime.lastError?.message || "插件未响应，请确认 Ianto 已安装并已重载" }
            }));
            return;
        }

        const storageKey = 'reviewScrape_' + jobId;

        // 评论翻页比标题搜索慢得多，给 25 分钟兜底
        const timer = setTimeout(function() {
            chrome.storage.onChanged.removeListener(onChanged);
            chrome.storage.local.remove(storageKey);
            document.dispatchEvent(new CustomEvent('RESPONSE_REVIEW_SCRAPE', {
                detail: { success: false, error: "评论抓取超时（25分钟）" }
            }));
        }, 25 * 60 * 1000);

        function onChanged(changes, area) {
            if (area === 'local' && changes[storageKey]) {
                clearTimeout(timer);
                chrome.storage.onChanged.removeListener(onChanged);
                var result = changes[storageKey].newValue;
                chrome.storage.local.remove(storageKey);
                document.dispatchEvent(new CustomEvent('RESPONSE_REVIEW_SCRAPE', { detail: result }));
            }
        }
        chrome.storage.onChanged.addListener(onChanged);
    });
});

// --- AI Photo Editor → Gemini 网页作图桥接 ---
// 只接受约定客户端，避免其他 localhost 页面误触发网页自动化。
const GEMINI_WEB_CLIENT = 'ai-photo-editor-gemini-web';
const WEB_IMAGE_BRIDGE_BUILD = '2026-11-06.1';
const WEB_IMAGE_PENDING = new Map();
document.addEventListener('REQUEST_IANTO_WEB_MODELS', function(event) {
    const detail = event.detail || {};
    if (detail.client !== GEMINI_WEB_CLIENT) return;
    chrome.runtime.sendMessage({ action: 'webImageListModels', client: detail.client, provider: detail.provider, protocolVersion: detail.protocolVersion, bridgeBuild: WEB_IMAGE_BRIDGE_BUILD }, function(response) {
        document.dispatchEvent(new CustomEvent('RESPONSE_IANTO_WEB_MODELS', { detail: { ...response, requestId: detail.requestId, success: !chrome.runtime.lastError && !!response?.success, error: chrome.runtime.lastError?.message || response?.error } }));
    });
});

document.addEventListener('REQUEST_IANTO_GEMINI_WEB_PING', function(event) {
    const detail = event.detail || {};
    if (detail.client !== GEMINI_WEB_CLIENT) return;
    chrome.runtime.sendMessage({ action: 'geminiWebPing', client: detail.client }, function(response) {
        document.dispatchEvent(new CustomEvent('RESPONSE_IANTO_GEMINI_WEB_PING', {
            detail: {
                requestId: detail.requestId,
                success: !chrome.runtime.lastError && !!response?.success,
                bridgeLoaded: true,
                bridgeBuild: WEB_IMAGE_BRIDGE_BUILD,
                protocolVersion: response?.protocolVersion || null,
                backgroundBuild: response?.backgroundBuild || null,
                providers: response?.providers || [],
                continuousMaterials: !!response?.continuousMaterials,
                version: response?.version || null,
                error: chrome.runtime.lastError?.message || response?.error || null
            }
        }));
    });
});

document.addEventListener('REQUEST_GEMINI_WEB_IMAGE', function(event) {
    const detail = event.detail || {};
    if (detail.client !== GEMINI_WEB_CLIENT) return;

    const jobId = detail.requestId || ('gmw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    const storageKey = 'geminiWebResult_' + jobId;
    let finished = false;

    function reply(result) {
        if (finished) return;
        finished = true;
        WEB_IMAGE_PENDING.delete(jobId);
        clearTimeout(timer);
        chrome.storage.onChanged.removeListener(onChanged);
        chrome.runtime.onMessage.removeListener(onDirectMessage);
        chrome.storage.local.remove(storageKey);
        document.dispatchEvent(new CustomEvent('RESPONSE_GEMINI_WEB_IMAGE', {
            detail: Object.assign({}, result, { requestId: jobId, jobId: jobId })
        }));
    }

    function onDirectMessage(request) {
        if (request?.action === 'geminiWebJobProgress' && request?.jobId === jobId) {
            document.dispatchEvent(new CustomEvent('PROGRESS_GEMINI_WEB_IMAGE', {
                detail: {
                    requestId: jobId,
                    jobId: jobId,
                    status: String(request.status || ''),
                    type: String(request.type || 'info')
                }
            }));
            return;
        }
        if (request?.action === 'geminiWebJobResultDirect' && request?.jobId === jobId) {
            reply(request.result || { success: false, error: '网页任务未返回有效结果' });
        }
    }

    function onChanged(changes, area) {
        if (area !== 'local' || !changes[storageKey]) return;
        reply(changes[storageKey].newValue || { success: false, error: 'Gemini 网页任务没有返回结果' });
    }

    const timer = setTimeout(function() {
        reply({ success: false, error: 'Gemini 网页作图超时（25分钟）' });
    }, 25 * 60 * 1000);

    chrome.runtime.onMessage.addListener(onDirectMessage);
    chrome.storage.onChanged.addListener(onChanged);
    WEB_IMAGE_PENDING.set(jobId, reply);
    try {
        chrome.runtime.sendMessage({
            action: 'geminiWebGenerate',
            client: detail.client,
            jobId: jobId,
            prompt: detail.prompt,
            images: detail.images,
            uploadMode: detail.uploadMode,
            materialKey: detail.materialKey,
            materialRules: detail.materialRules,
            materialOnly: !!detail.materialOnly,
            materialIndex: detail.materialIndex,
            materialCount: detail.materialCount,
            materialRole: detail.materialRole,
            materialManifest: detail.materialManifest,
            materialFinalRules: !!detail.materialFinalRules,
            provider: detail.provider,
            siteModel: detail.siteModel,
            modelOptions: detail.modelOptions,
            taskKey: detail.taskKey,
            protocolVersion: detail.protocolVersion,
            bridgeBuild: WEB_IMAGE_BRIDGE_BUILD,
            aspectRatio: detail.aspectRatio,
            conversationKey: detail.conversationKey,
            taskLabel: detail.taskLabel,
            restoreEditor: !!detail.restoreEditor
        }, function(response) {
            if (chrome.runtime.lastError || !response?.started) {
                reply({
                    success: false,
                    error: chrome.runtime.lastError?.message || response?.error || 'Ianto 后台未接受 Gemini 网页任务'
                });
            }
        });
    } catch (error) {
        reply({ success: false, error: 'Ianto 已更新，请刷新本页面后重试' });
    }
});

document.addEventListener('CANCEL_GEMINI_WEB_IMAGE', function(event) {
    const detail = event.detail || {};
    if (detail.client !== GEMINI_WEB_CLIENT || !detail.jobId) return;
    WEB_IMAGE_PENDING.get(detail.jobId)?.({ success: false, error: '网页作图已由新的操作接管', cancelled: true });
    chrome.runtime.sendMessage({
        action: 'geminiWebCancel',
        client: detail.client,
        jobId: detail.jobId
    }, function() { void chrome.runtime.lastError; });
});
