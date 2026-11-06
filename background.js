

importScripts('features/video_contract.js', 'features/video_background.js');
importScripts('features/lingxing_erp.js');
importScripts('features/wms_puller_background.js');
importScripts('features/us_review_scraper.js');
// Market capture is isolated so a setup error cannot disable existing tools.
try { importScripts('market_capture/background.js'); } catch (error) { console.warn('[Ianto 市场采集]', error); }

// Clean up stale pending images on extension install/update
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.remove('pendingImage');
});

async function fetchImageForSearch(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('只支持 HTTP 或 HTTPS 图片地址');
  }

  const response = await fetch(parsed.href, {credentials: 'omit', redirect: 'follow', cache: 'no-store'});
  if (!response.ok) throw new Error(`图片请求失败（HTTP ${response.status}）`);
  const contentType = response.headers.get('content-type') || '';
  if (/^(text\/|application\/(json|xml))/i.test(contentType)) {
    throw new Error('图片地址返回了网页内容，可能需要登录或被来源网站拦截');
  }

  const blob = await response.blob();
  if (!blob.size) throw new Error('图片地址返回了空文件');
  if (blob.size > 12 * 1024 * 1024) throw new Error('图片文件超过 12 MB，请先保存到本地再上传');

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return {ok: true, data: btoa(binary), type: blob.type || contentType.split(';')[0] || 'application/octet-stream'};
}

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_IMAGE_FOR_SEARCH') {
    if (!sender.tab?.id) {
      sendResponse({ok: false, error: '图片请求来源无效'});
      return false;
    }
    fetchImageForSearch(message.url)
      .then(sendResponse)
      .catch(error => sendResponse({ok: false, error: error?.message || '无法读取图片地址'}));
    return true;
  }

  if (message.type === 'IMAGE_CAPTURED') {
    // Show brief badge indicator
    if (sender.tab?.id) {
      chrome.action.setBadgeText({ text: '!', tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#f08804', tabId: sender.tab.id });
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
      }, 2000);
    }
  }
  return false;
});

// --- 1. 常量定义 ---
const MODE_A = "DOMAIN_A_FIXED";
const MODE_B = "DOMAIN_B_FIXED";
const MODE_C = "DOMAIN_C_FIXED";
const MODE_NONE = "NONE";
const DOMAIN_A_TARGET = "shop.tiktok.com";
const DOMAIN_B = "shop.tiktokglobalshop.com";

function normalizeTikTokCountry(country) {
    return (country || "").toLowerCase();
}

function getTikTokCountryFromSearch(searchParams) {
    const region = searchParams.get("region") || searchParams.get("country") || searchParams.get("site");
    if (region && /^[a-z]{2}$/i.test(region)) return region;

    const locale = searchParams.get("locale") || searchParams.get("language");
    const localeMatch = locale && locale.match(/[-_]([a-z]{2})$/i);
    return localeMatch ? localeMatch[1] : null;
}

function parseTikTokProductUrl(url) {
    try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname;
        const path = parsedUrl.pathname;
        let country = getTikTokCountryFromSearch(parsedUrl.searchParams);
        let itemId = null;

        let match = path.match(/^\/view\/product\/([^/?#]+)/i);
        if (match) itemId = match[1];

        match = path.match(/^\/shop\/pdp\/([^/?#]+)/i);
        if (!itemId && match) itemId = match[1];

        match = path.match(/^\/shop\/([a-z]{2})\/pdp\/([^/?#]+)/i);
        if (match) {
            country = match[1];
            itemId = match[2];
        }

        const isKnownHost = host === "shop.tiktok.com" || host === "shop.tiktokglobalshop.com" || host === "www.tiktok.com";
        return isKnownHost && itemId ? { parsedUrl, country: normalizeTikTokCountry(country), itemId } : null;
    } catch (e) {
        return null;
    }
}

function buildTikTokProductUrl(currentUrl, targetMode) {
    const product = parseTikTokProductUrl(currentUrl);
    if (!product) return currentUrl;

    const { parsedUrl, country, itemId } = product;
    const searchParams = new URLSearchParams(parsedUrl.search);

    if (targetMode === MODE_A || targetMode === MODE_B) {
        if (country && !searchParams.get("region")) searchParams.set("region", country.toUpperCase());
        const targetDomain = targetMode === MODE_A ? "shop.tiktok.com" : "shop.tiktokglobalshop.com";
        const query = searchParams.toString();
        return `https://${targetDomain}/view/product/${itemId}${query ? `?${query}` : ""}${parsedUrl.hash}`;
    }

    if (targetMode === MODE_C) {
        searchParams.delete("region");
        const query = searchParams.toString();
        return `https://www.tiktok.com/shop/${country.toLowerCase()}/pdp/${itemId}${query ? `?${query}` : ""}${parsedUrl.hash}`;
    }

    return currentUrl;
}

// --- 2. Declarative Net Request 规则辅助函数 ---
async function updateNetRequestRules(newMode) {
    return;
}

// --- 3. 菜单创建函数 ---
function createContextMenus() {

    chrome.contextMenus.removeAll(() => {
        // 产品标题抓取（所有页面）
        chrome.contextMenus.create({
          id: "scrapeTitles",
          title: "抓取本页产品标题",
          contexts: ["page"]
        });
        chrome.storage.local.get('REDIRECT_MODE', (data) => {
            const initialMode = data.REDIRECT_MODE || MODE_NONE;
            updateNetRequestRules(initialMode);
        });
    });
}

// --- 4. 扩展安装或更新时：强制清除并创建菜单 ---
chrome.runtime.onInstalled.addListener(createContextMenus);
chrome.runtime.onStartup.addListener(createContextMenus);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    const url = changeInfo.url || tab.url;
    if (!url) return;

    chrome.storage.local.get("REDIRECT_MODE", (data) => {
        const mode = data.REDIRECT_MODE || MODE_NONE;
        if (![MODE_A, MODE_B, MODE_C].includes(mode)) return;

        const newUrl = buildTikTokProductUrl(url, mode);
        if (newUrl && newUrl !== url) {
            chrome.tabs.update(tabId, { url: newUrl });
        }
    });
});




const scraperFunction = async () => { 

    const selectors = {
        'fastmoss.com': ['h3.content.truncate'],
        'shopee.': ['li.shopee-search-item-result__item div.line-clamp-2'],
        'lazada.': ['div.RfADt a[title]', 'div.p-product-card div.p-title a[title]', 'h1[data-spm-anchor-id]'],
        'aliexpress.': ['div[class*="search-item-card-wrapper"] h3'],
        'mercadolibre.': ['h3.poly-component__title-wrapper a.poly-component__title'],
        'echotik.live': ['span.index_productName__OfVL6'],
        'shopdora.com': ['div.title-info > div.title'],
        'lingdongsz.com': ['h3.title-wrapper a.title'],
        'amazon.': ['div[data-cy="title-recipe"] h2 span'],
        'walmart.com': ['[data-automation-id="product-title"]', '[data-testid="product-title"]', 'h1#main-title'],
        'ebay.com': ['h3.s-item__title', '.s-card__title', 'h1.x-item-title__mainTitle'],
        'temu.com': ['h2 > span:nth-of-type(1)'],
        'tokopedia.': ['div[class*="y-oybT3IAd310DVdH3OwVg=="] > div:nth-child(1) span[class*="=="]']
    };

    const getSelectorsForDomain = (hostname) => {
          if (hostname.includes('fastmoss.com')) return selectors['fastmoss.com'];
          if (hostname.includes('shopee.')) return selectors['shopee.'];
          if (hostname.includes('lazada.')) return selectors['lazada.'];
          if (hostname.includes('aliexpress.')) return selectors['aliexpress.'];
          if (hostname.includes('mercadolibre.')) return selectors['mercadolibre.'];
          if (hostname.includes('mercadolivre.')) return selectors['mercadolibre.'];
          if (hostname.includes('echotik.live')) return selectors['echotik.live'];
          if (hostname.includes('shopdora.com')) return selectors['shopdora.com'];
          if (hostname.includes('lingdongsz.com')) return selectors['lingdongsz.com'];
          if (hostname.includes('amazon.')) return selectors['amazon.'];
          if (hostname==='walmart.com' || hostname.endsWith('.walmart.com')) return selectors['walmart.com'];
          if (hostname==='ebay.com' || hostname.endsWith('.ebay.com')) return selectors['ebay.com'];
          if (hostname.includes('temu.com')) return selectors['temu.com'];
          if (hostname.includes('tokopedia.')) return selectors['tokopedia.'];
          return [];
        };

    async function scrollToBottomSmoothly() {
      const scrollStep = 200;
      let lastScrollPosition = -1;
      let currentScrollPosition = window.scrollY;
      
      while (currentScrollPosition > lastScrollPosition) {
        lastScrollPosition = currentScrollPosition;
        window.scrollBy(0, scrollStep);
        await new Promise(resolve => setTimeout(resolve, 200));
        currentScrollPosition = window.scrollY;
      }
    }
    
    const hostname = window.location.hostname;
    if (hostname.includes('shopee.') || hostname.includes('aliexpress.') || hostname.includes('tokopedia.')) {
        await scrollToBottomSmoothly();

        await new Promise(resolve => setTimeout(resolve, 2500)); 
    }

    const titles = [];
    const domainSelectors = getSelectorsForDomain(hostname);
    
    if (!domainSelectors || domainSelectors.length === 0) {
        return []; 
    }
    
    domainSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        let titleText = '';
        if (hostname.includes('lazada.') && element.hasAttribute('title')) {
          titleText = element.getAttribute('title');
        } else {
          titleText = (element.innerText || '').trim();
        }
        
        titleText = titleText.replace(/\s+/g, ' ').replace(/[\n\r]+/g, '').trim();
        if (titleText && !titles.includes(titleText)) {
          titles.push(titleText);
        }
      });
    });
    
    return titles; 
};


// --- 6. 监听点击事件 ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    
    if (info.menuItemId === "scrapeTitles") {
        
        // 1. 在目标页面上执行抓取脚本
        const response = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: scraperFunction
        });
        
        const titles = response[0].result;
        
        // 2. 存储数据
        await chrome.storage.local.set({ productTitles: titles });
        

        const analysisPageUrl = chrome.runtime.getURL('features/feature_scraper_ui.html'); 
        chrome.tabs.create({ url: analysisPageUrl });
    }
});



chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.namespace === 'iantoMarket') return; // 独立采集模块自行应答，避免通用回执抢答。
    const ownsMessage = request.command === 'SET_MODE_AND_REDIRECT' || ['toggleWidth', 'toggleChatGPTWidth', 'toggleManusWidth', 'toggleGrokWidth'].includes(request.action);
    if (!ownsMessage) return false;
    

    if (request.command === 'SET_MODE_AND_REDIRECT') {
        if (request.mode !== MODE_NONE) {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (tabs[0] && tabs[0].url) {
                    const url = tabs[0].url;
                    let newUrl = buildTikTokProductUrl(url, request.mode);
                    
                    if (false && request.mode === MODE_A && url.includes(DOMAIN_B)) {
                         newUrl = url.replace(DOMAIN_B, DOMAIN_A_TARGET);
                    } else if (false && request.mode === MODE_B) {
                        // 【核心修复】：收紧后台手动触发时的判定条件
                        if (url.includes(DOMAIN_A_TARGET)) {
                            newUrl = url.replace(DOMAIN_A_TARGET, DOMAIN_B);
                        } else if (url.includes("www.tiktok.com/view/product/") || url.includes("www.tiktok.com/shop/pdp/")) {
                            newUrl = url.replace("www.tiktok.com", DOMAIN_B);
                        }
                    }

                    if (newUrl !== url) {
                        chrome.tabs.update(tabs[0].id, { url: newUrl });
                    }
                }
            });
        }
    }
    
    // 7.2. Gemini 宽度调整 (Popup 触发)
    else if (request.action === 'toggleWidth') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0] && tabs[0].url && tabs[0].url.startsWith('https://gemini.google.com/')) {
                 chrome.tabs.sendMessage(tabs[0].id, {action: 'toggleWidth'});
            }
        });
    }
    
    // 7.3. ChatGPT 宽度调整 (Popup 触发)
    else if (request.action === 'toggleChatGPTWidth') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0] && tabs[0].url && (tabs[0].url.includes('chatgpt.com') || tabs[0].url.includes('chat.openai.com'))) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleChatGPTWidth' }, (response) => {
                    // response handled by popup
                });
            }
        });
    }

    // 7.4. Manus 宽度调整 (Popup 触发)
    else if (request.action === 'toggleManusWidth') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {

            if (tabs[0] && tabs[0].url && tabs[0].url.includes('manus.im')) {

                 chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleManusWidth' });
            }
        });
    }

    // 7.5. Grok 宽度调整 (Popup 触发)
    else if (request.action === 'toggleGrokWidth') {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('grok.com')) {
                chrome.tabs.sendMessage(tabs[0].id, { action: 'toggleGrokWidth' });
            }
        });
    }
    
    // Only acknowledge commands owned by this listener. Unknown messages belong
    // to independent modules and must retain their own asynchronous response.
    sendResponse({ status: "processed" });
    return false;
});



chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {


    if (request.action === "scrapeTitles") {
        sendResponse({ started: true });

        const { platforms, jobId, visible } = request;
        const storageKey = 'titleScrape_' + jobId;


        function waitTabComplete(tabId, maxMs) {
            return new Promise(resolve => {
                let done = false;
                const finish = () => { if (!done) { done = true; resolve(); } };

                // 先检查当前状态（tab可能已经complete了）
                chrome.tabs.get(tabId, tab => {
                    if (chrome.runtime.lastError || tab?.status === 'complete') { finish(); return; }

                    const onUpdated = (tid, info) => {
                        if (tid === tabId && info.status === 'complete') {
                            chrome.tabs.onUpdated.removeListener(onUpdated);
                            clearInterval(poll);
                            finish();
                        }
                    };
                    chrome.tabs.onUpdated.addListener(onUpdated);

                    const poll = setInterval(() => {
                        chrome.tabs.get(tabId, t => {
                            if (chrome.runtime.lastError || t?.status === 'complete') {
                                clearInterval(poll);
                                chrome.tabs.onUpdated.removeListener(onUpdated);
                                finish();
                            }
                        });
                    }, 2000);
                    // 瓒呮椂淇濋殰
                    setTimeout(() => {
                        clearInterval(poll);
                        chrome.tabs.onUpdated.removeListener(onUpdated);
                        finish();
                    }, maxMs);
                });
            });
        }

        (async () => {
            const results = {};


            const keepAlive = setInterval(() => chrome.storage.local.get('__ka'), 2000);

            try {


                const tabEntries = [];
                for (const platform of platforms) {
                    try {
                        const tab = await chrome.tabs.create({ url: platform.url, active: visible });
                        tabEntries.push({ tabId: tab.id, name: platform.name });
                    } catch(e) {}
                }


                if (tabEntries.length > 0) {
                    try {
                        const groupId = await chrome.tabs.group({ tabIds: tabEntries.map(t => t.tabId) });
                        await chrome.tabGroups.update(groupId, { title: 'Scraping Titles...', color: 'blue', collapsed: !visible });
                    } catch(e) {}
                }


                await Promise.all(tabEntries.map(async ({ tabId, name }) => {
                    try {
                        await waitTabComplete(tabId, 25000);
                        await new Promise(r => setTimeout(r, 3000));
                        const res = await chrome.scripting.executeScript({ target: { tabId }, func: scraperFunction });
                        results[name] = res[0]?.result || [];
                    } catch(e) {
                        results[name] = [];
                    }

                    // 代价：多轮抓取后标签会堆积，需要手动关闭或关闭整个窗口
                }));

            } finally {
                clearInterval(keepAlive);
                // 4. 无论成功失败都写入storage，触发bridge.js监听
                await chrome.storage.local.set({ [storageKey]: { success: true, results } });
            }
        })();

        return true;
    }


    if (request.action === "fetchERP") {
        // Only the calculator that explicitly selects Lingxing uses this path.
        if (request.source === 'lingxing') {
            fetchLingxingERP(request.sku).then(sendResponse).catch(() => {
                sendResponse({ success: false, error: '领星后台查询失败，请确认登录状态后重试' });
            });
            return true;
        }
        (async () => {
            const ERP_BASE = "http://www.instudio.me:6206";
            const PROD_URL = ERP_BASE + "/erpProduct/erpProduct/product/productInfoForNewEdtion";
            const BIND_URL = ERP_BASE + "/yypms/pms/product/bindProductList";
            const prodPayload = (sku) => ({ fuzzyQuery: sku, page: 1, pageSize: 10, isVideo: 0, numType: "1", orderBy: "HJRESERVE9", applicablePlatformList: [], applicableSiteList: [], brandId: [], certificationList: [], developer2List: [], forbidPlatformIdList: [], keyWords: [], keyWords2: [], keyWords3: [], notContainsKeyWords: [], notContainsProductTagList: [], oper4: [], price5: [], productTagList: [] });
            const jpost = (url, body) => fetch(url, { method: 'POST', credentials: 'include', headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
            // 商品资料库返回里把那条商品记录抠出来（result 优先，其次 esDataList）
            const extractProduct = (data) => {
                const o = data && data.obj;
                if (o) {
                    if (Array.isArray(o.result) && o.result.length) return o.result[0];
                    if (Array.isArray(o.esDataList) && o.esDataList.length) return o.esDataList[0];
                }
                return null;
            };
            // 长宽高：优先解析 packSizes 的 "长 x 宽 x 高" 字符串，退化到 length/width/height
            const parseDims = (it) => {
                const s = it.packSizes2 || it.packSizes || "";
                const nums = (String(s).match(/[\d.]+/g) || []);
                if (nums.length >= 3) return { l: parseFloat(nums[0]) || 0, w: parseFloat(nums[1]) || 0, h: parseFloat(nums[2]) || 0 };
                return { l: parseFloat(it.length) || 0, w: parseFloat(it.width) || 0, h: parseFloat(it.height) || 0 };
            };
            const r2 = (n) => Math.round(n * 100) / 100;
            // ★ 海外仓SKU识别 + 取"总监仓"成本 ★ —— 自门控：只有含TT国家码的SKU才会触发额外请求，普通SKU零开销，故LATAM/直邮工具完全不受影响
            const GPIBS_URL = ERP_BASE + "/erpProduct/erpProduct/productDetails/getProductInfoBySku";
            const OVERSEA_RE = /TT(ID|PH|VN|MY|TH|MX|BR)/i;   // 印尼/菲/越/马/泰/墨/巴
            const isOversea = (sku) => OVERSEA_RE.test(String(sku || ""));
            // 海外仓成本规则(用户拍板)：虚拟仓里排除共享仓=总监仓；高级权限锁王云仓，普通权限只看得到自己上级总监仓→自动落到它。永不取共享仓/本土仓。
            const getDirectorCost = async (sku, prefer) => {
                try {
                    const r = await fetch(GPIBS_URL + "?sku=" + encodeURIComponent(sku), { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } });
                    const d = await r.json();
                    const arr = (d && Array.isArray(d.obj)) ? d.obj : [];
                    const dirs = arr.filter(x => {
                        const virtual = Number(x.STORAGETYPE) === 6 || String(x.STORAGETYPENAME || "").includes("虚拟");
                        const dir = String(x.DIRECTOR || "").trim();
                        return virtual && dir && dir !== "共享仓";
                    });
                    if (!dirs.length) return null;
                    // 所有可选总监仓(供下拉选择；已过滤成有效成本)
                    const options = dirs.map(x => ({ director: String(x.DIRECTOR).trim(), warehouse: x.STORAGE, cost: parseFloat(x.STORAGECOSTPRICE) })).filter(o => isFinite(o.cost));
                    if (!options.length) return null;
                    // 选仓是"使用偏好"非硬规则。有指定(prefer=下拉选中，含默认=列表第一个)→取它，此SKU没货就顺位第一个能查到的；无指定(SEA无下拉)→王云默认→第一个。引擎不再对王云固定优先——王云的"默认"来自前端把她排在下拉第一。
                    let pick = prefer
                      ? (options.find(o => o.director === String(prefer).trim()) || options[0])
                      : (options.find(o => o.director === "王云") || options[0]);
                    // 不做 r2 二位四舍五入——成本是4位小数(如5.3951)，保留原始精度
                    return { warehouse: pick.warehouse, director: pick.director, cost: pick.cost, options };
                } catch (e) { return null; }
            };
            try {
                // 1) 照常查商品资料库
                const data = await jpost(PROD_URL, prodPayload(request.sku));
                if (extractProduct(data)) {
                    // 1.1) 海外仓单品：附加总监仓成本(不动 costPrice，仅加 __oversea 字段；不读它的工具行为不变)
                    if (isOversea(request.sku)) {
                        const ov = await getDirectorCost(request.sku, request.preferDirector);
                        if (ov) data.__oversea = ov;
                        else data.__overseaMiss = true;   // 海外仓但取不到总监仓成本(权限/无虚拟仓)→工具标红手动
                    }
                    sendResponse({ success: true, data });
                    return;
                }

                // 2) 查不到 → 多半是绑定(捆绑)SKU，去捆绑列表按"商品编号"精确匹配
                const bindResp = await jpost(BIND_URL, { page: 1, pageSize: 50, keyword: request.sku });
                const rows = (bindResp && bindResp.obj && bindResp.obj.rows) || [];
                const row = rows.find(r => String(r.productId).trim().toUpperCase() === String(request.sku).trim().toUpperCase());
                // 捆绑也没有 → 交回原空结果，工具按"未找到商品"处理（即真失败：SKU 写错或确实不存在）
                if (!row) { sendResponse({ success: true, data }); return; }

                // 3) 拆子件：捆绑商品列表(alias1) 形如 "SKUA*1,SKUB*2"
                const children = String(row.alias1 || "").split(/[,，]/).map(s => s.trim()).filter(Boolean).map(p => {
                    const m = p.split("*");
                    return { sku: (m[0] || "").trim(), qty: parseInt(m[1], 10) || 1 };
                });

                // 4) 每个子件照常查长宽高/重量/成本，按数量合计
                let volCm3 = 0, weightG = 0, costSum = 0, discSum = 0, anyDisc = false;
                let overseaSum = 0, anyOversea = false; const overseaMiss = []; let overseaOptions = null;   // 海外仓子件：逐子件取总监仓成本(各看自己TT码)
                const detail = [], missing = [];
                for (const ch of children) {
                    const cit = extractProduct(await jpost(PROD_URL, prodPayload(ch.sku)));
                    if (!cit) { missing.push(ch.sku + "*" + ch.qty); detail.push({ sku: ch.sku, qty: ch.qty, found: false }); continue; }
                    const { l, w, h } = parseDims(cit);
                    const wt = parseFloat(cit.weight) || parseFloat(cit.grossweight) || 0;
                    const orig = parseFloat(cit.costPrice) || parseFloat(cit.cost) || 0;
                    let eff = orig;
                    if (cit.discountCostprice !== undefined && cit.discountCostprice !== null && cit.discountCostprice !== "") {
                        const dc = parseFloat(cit.discountCostprice);
                        if (!isNaN(dc)) { eff = dc; if (dc !== orig) anyDisc = true; }
                    }
                    // 海外仓子件：各看自己TT码，命中则取总监仓成本(合计在循环后统一算，避免顺序依赖)
                    let chOv = null;
                    if (isOversea(ch.sku)) {
                        anyOversea = true;
                        chOv = await getDirectorCost(ch.sku, request.preferDirector);
                        if (chOv && chOv.options && !overseaOptions) overseaOptions = chOv.options;
                        if (!chOv) overseaMiss.push(ch.sku + "*" + ch.qty);
                    }
                    volCm3 += l * w * h * ch.qty;
                    weightG += wt * ch.qty;
                    costSum += orig * ch.qty;
                    discSum += eff * ch.qty;
                    detail.push({ sku: ch.sku, qty: ch.qty, found: true, l, w, h, wt, cost: eff, origCost: orig, disc: (!chOv && eff !== orig), overseaCost: chOv ? chOv.cost : null, overseaWh: chOv ? chOv.warehouse : null });
                }

                // 5) 任一子件查不到 / 无法解析构成 → 绝不按 0 回填(否则会算出假价)。走失败路径，不回填、不算价，点名缺哪个子件
                if (children.length === 0 || missing.length > 0) {
                    const why = children.length === 0
                        ? `无法解析捆绑构成(alias1=${row.alias1 || '空'})`
                        : `子件查不到(无权限/不在库): ${missing.join(',')}`;
                    const foundTxt = detail.filter(d => d.found).map(d => `${d.qty}×${d.sku}`).join(',') || '无';
                    sendResponse({
                        success: false,
                        error: `🔗绑定商品 ${request.sku} ${why}。已拦截——不按0回填、不算价，请手动补全尺寸/重量后再算。(已查到的子件: ${foundTxt})`,
                        data: { __bind: true, bindSku: request.sku, bindAlias: row.alias1 || "", bindDetail: detail, bindMissing: missing }
                    });
                    return;
                }

                // 6) 全部子件都查到 → 合成一条"商品记录"喂回工具：把合计体积塞成 长×宽×高（长=合计体积cm³，宽=高=1），乘积=真实总体积
                const synth = {
                    packSizes: r2(volCm3) + " x 1 x 1",
                    weight: r2(weightG),
                    costPrice: r2(costSum),
                    discountCostprice: anyDisc ? r2(discSum) : ""
                };
                // 海外仓绑定：合计总监仓成本(海外仓子件用各自总监仓成本，非海外仓子件退回普通成本)；任一海外仓子件取不到→null，工具标红手动
                let overseaPack = {};
                if (anyOversea) {
                    overseaSum = detail.reduce((s, d) => s + (d.found ? ((d.overseaCost != null ? d.overseaCost : d.cost) * d.qty) : 0), 0);
                    overseaPack = { __overseaAny: true, __overseaCostPrice: overseaMiss.length ? null : r2(overseaSum), __overseaMissing: overseaMiss, __overseaOptions: overseaOptions };
                }
                sendResponse({ success: true, data: { obj: { result: [synth] }, __bind: true, bindSku: request.sku, bindName: row.productName || "", bindAlias: row.alias1 || "", bindDetail: detail, bindMissing: missing, ...overseaPack } });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }


    if (request.action === "fetchSPU") {
        fetchLingxingPhotoBundle(request.spu)
            .then(sendResponse)
            .catch(error => sendResponse({ success: false, error: error?.message || '领星产品与 Walmart 信息抓取失败' }));
        return true;
    }
});



chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.REDIRECT_MODE) {
        const newMode = changes.REDIRECT_MODE.newValue || MODE_NONE;
        updateNetRequestRules(newMode);
    }
});


// ==========================================
// 📁 自动备份功能 (Auto Backup) - 本地文件下载方案
// ==========================================

const BACKUP_STORAGE_KEYS = [
    { key: 'gemini_custom_folders_data', name: 'Gemini' },
    { key: 'gems_custom_folders_data', name: 'Gems' },
    { key: 'claude_custom_folders_data', name: 'Claude' },
    { key: 'notebooklm_custom_folders_data', name: 'NotebookLM' },
    { key: 'chatgpt_custom_folders_data', name: 'ChatGPT' },
    { key: 'manus_custom_folders_data', name: 'Manus' },
    { key: 'grok_custom_folders_data', name: 'Grok' }
];

const BACKUP_CONFIG = {
    backupIntervalMinutes: 480
};


function calculateHash(data) {
    const str = JSON.stringify(data || {});
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}


async function getAllBackupData() {
    const keys = BACKUP_STORAGE_KEYS.map(item => item.key);
    const result = await chrome.storage.local.get(keys);

    const data = {};
    BACKUP_STORAGE_KEYS.forEach(item => {
        data[item.name] = result[item.key] || {};
    });

    return data;
}


async function performAutoBackup() {
    try {

        const backupData = await getAllBackupData();
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5); // 格式: 2026-04-09T10-30-45
        const currentHash = calculateHash(backupData);


        console.log('[Auto Backup] 获取的备份数据:', {
            Gemini: !!backupData.Gemini && Object.keys(backupData.Gemini).length,
            Claude: !!backupData.Claude && Object.keys(backupData.Claude).length,
            ChatGPT: !!backupData.ChatGPT && Object.keys(backupData.ChatGPT).length,
            NotebookLM: !!backupData.NotebookLM && Object.keys(backupData.NotebookLM).length,
            Manus: !!backupData.Manus && Object.keys(backupData.Manus).length,
            Gems: !!backupData.Gems && Object.keys(backupData.Gems).length
        });


        const { auto_backup_last_hash } = await chrome.storage.local.get('auto_backup_last_hash');

        // 3. 如果是首次备份（没有历史记录），直接创建；否则比对hash
        if (auto_backup_last_hash && currentHash === auto_backup_last_hash) {
            console.log('[Auto Backup] 内容未变化，跳过下载');
            return { status: 'identical', timestamp };
        }

        // 4. 内容不同，生成文件内容并直接触发下载
        const backupPayload = {
            backup_time: now.toLocaleString('zh-CN'),
            timestamp: timestamp,
            data: backupData
        };

        const jsonContent = JSON.stringify(backupPayload, null, 2);
        const fileName = `Ianto_AI_Bookmarks_${timestamp}.json`;
        const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonContent);

        try {
            await new Promise((resolve, reject) => {
                chrome.downloads.download({
                    url: dataUrl,
                    filename: fileName,
                    saveAs: false
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                    } else {
                        resolve(downloadId);
                    }
                });
            });
            console.log(`[Auto Backup] 自动下载成功。Hash: ${currentHash}`);
        } catch (downloadErr) {
            console.error('[Auto Backup] 自动下载触发失败:', downloadErr);
        }


        await chrome.storage.local.set({
            auto_backup_last_hash: currentHash,
            auto_backup_last_time: timestamp
        });

        return { status: 'new_version', timestamp };

    } catch (error) {
        console.error('[Auto Backup] 备份失败:', error);
        return { status: 'error', error: error.message };
    }
}

// 设置定时任务
function setupAutoBackupAlarm() {

    chrome.alarms.clear('autoBackupAlarm', () => {
        chrome.alarms.create('autoBackupAlarm', {
            periodInMinutes: BACKUP_CONFIG.backupIntervalMinutes
        });
        console.log('[Auto Backup] 已设置定时备份任务，间隔: ' + BACKUP_CONFIG.backupIntervalMinutes + ' 分钟');
    });
}

// 监听定时任务触发
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'autoBackupAlarm') {
        performAutoBackup();
    }
});


chrome.runtime.onStartup.addListener(() => {
    setupAutoBackupAlarm();
});


chrome.runtime.onInstalled.addListener(() => {
    setupAutoBackupAlarm();
});

// 消息处理：供 popup 调用
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'manualBackup') {
        performAutoBackup().then(result => sendResponse(result));
        return true;
    }

    if (request.action === 'getBackupStatus') {
        chrome.storage.local.get(['auto_backup_last_time', 'auto_backup_pending_download'], (result) => {
            sendResponse({
                lastBackupTime: result.auto_backup_last_time,
                hasPendingDownload: !!result.auto_backup_pending_download
            });
        });
        return true;
    }

    if (request.action === 'downloadPendingBackup') {
        chrome.storage.local.get('auto_backup_pending_download', (result) => {
            if (result.auto_backup_pending_download) {
                sendResponse({
                    success: true,
                    data: result.auto_backup_pending_download
                });
                // 下载后删除待下载记录
                chrome.storage.local.remove('auto_backup_pending_download');
            } else {
                sendResponse({ success: false, error: '没有待下载的备份' });
            }
        });
        return true;
    }
});


setupAutoBackupAlarm();


// ==========================================
// 评论批量抓取（VOC 分析工具 v1）
// ==========================================
// 协议：scrapeReviews（来自 bridge.js / REQUEST_REVIEW_SCRAPE）
// 输入：{ tasks: [{ url, cc, max }], visible, jobId }
// 输出：写入 storage[`reviewScrape_${jobId}`] = { success, results: { [url]: { productName, reviews:[{text,rating,date}] } } }
// 不破坏标题工具的任何现有逻辑。
// ==========================================

// Shopee 商品评论抓取函数（注入到目标页面执行）
// 注意：此函数会被序列化注入，不能引用外部闭包变量；只能通过 args 传参。
const shopeeReviewScraperFunction = async (maxReviews) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getProductName() {


        const dt = (document.title || '').trim();
        if (dt && dt.length > 5) {
            const cleaned = dt
                .replace(/\s*\|\s*Shopee[^|]*$/i, '')
                .replace(/\s*-\s*Shopee[^-]*$/i, '')
                .replace(/\s*-\s*Buy[^-]*$/i, '')
                .trim();
            if (cleaned.length > 5 && cleaned.length < 500) return cleaned;
        }

        const cands = [
            'div.product-briefing h1',
            'section.product-briefing h1',
            '[class*="ProductBriefing"] h1',
            'div[class*="product-briefing"] span[class*="title"]',
            'h1'
        ];
        for (const sel of cands) {
            const el = document.querySelector(sel);
            const t = (el?.innerText || '').trim();

            if (t && t.length > 8 && t.length < 500 && !/^\d+\s*(RB|mil|K|M)\+?$/i.test(t)) return t;
        }
        return '';
    }

    async function scrollToReviews() {
        // 优先寻找评论锚点
        const anchors = [
            '#product_reviews',
            '[class*="ProductRating"]',
            '[class*="product-ratings"]',
            '[class*="product-rating"]',
            'div.shopee-product-rating'
        ];
        for (const sel of anchors) {
            const el = document.querySelector(sel);
            if (el) {
                el.scrollIntoView({ behavior: 'instant', block: 'start' });
                await sleep(1200);
                return true;
            }
        }

        const KEY = /^\s*(Avaliações|Penilaian|Ulasan|Reviews|Ratings|Comentários|评价|评论|Product Ratings|Spec)\s*/i;
        const allHeads = document.querySelectorAll('h1,h2,h3,h4,div,span,section');
        for (const el of allHeads) {
            const t = (el.innerText || '').trim();
            if (t.length > 0 && t.length < 50 && KEY.test(t)) {
                try { el.scrollIntoView({ behavior: 'instant', block: 'start' }); await sleep(1500); return true; } catch(e){}
            }
        }

        const total = document.body.scrollHeight;
        for (let y = 0; y < total; y += 500) {
            window.scrollTo(0, y);
            await sleep(450);
        }

        window.scrollTo(0, document.body.scrollHeight * 0.65);
        await sleep(1500);
        return false;
    }

    function extractReviewsOnPage() {
        const tryExtract = (containers) => {
            if (!containers || containers.length === 0) return [];
            const BTN_LABELS = /^(Reportar|Laporkan|Reportar comentário|Laporkan Penyalahgunaan|Report|举报|举报评论|Helpful|Util|Útil|Berguna|Show more|Ver mais|Lihat selengkapnya|Reply|Responder|Balas|Show translation|Traduzir|Terjemahkan|See more|Show less|Less)/i;
            
            return containers.map(el => {
                let text = '';
                try {
                    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
                        acceptNode: (node) => {
                            const s = (node.textContent || '').trim();
                            if (s.length < 2) return NodeFilter.FILTER_REJECT;
                            if (BTN_LABELS.test(s)) return NodeFilter.FILTER_REJECT;
                            if (/^[\d\s\-\/.,:%鈽呪瓙]+$/.test(s)) return NodeFilter.FILTER_REJECT;
                            return NodeFilter.FILTER_ACCEPT;
                        }
                    });
                    const texts = [];
                    while (walker.nextNode()) {
                        texts.push(walker.currentNode.textContent.trim());
                    }
                    text = texts.join('\n');
                } catch(e) {}

                let rating = null;

                // ── 策略 1：lit-bar 模式（仅限类名精确命中，不做泛匹配兜底）──
                let litBar = el.querySelector('[class*="rating-stars__lit"], [class*="ratingStarsLit"]');
                if (litBar && litBar.style && litBar.style.width) {
                    const pct = parseFloat(litBar.style.width);
                    if (!isNaN(pct) && pct > 0) rating = Math.max(1, Math.min(5, Math.round(pct / 20)));
                }


                if (rating == null) {
                    const tags = ['svg', 'img', 'i'];
                    let starGroup = null;
                    for (const tag of tags) {
                        const allOfTag = el.querySelectorAll(tag);
                        const grouped = new Map();
                        allOfTag.forEach(e => {
                            const p = e.parentElement;
                            if (!p) return;
                            const arr = grouped.get(p) || [];
                            arr.push(e);
                            grouped.set(p, arr);
                        });
                        for (const [p, arr] of grouped) {
                            if (arr.length === 5 && arr.every(c => c.tagName === arr[0].tagName)) {
                                const r0 = arr[0].getBoundingClientRect();
                                if (r0.width >= 8 && r0.width <= 28 && r0.height >= 8 && r0.height <= 28) {
                                    starGroup = arr;
                                    break;
                                }
                            }
                        }
                        if (starGroup) break;
                    }
                    if (starGroup) {



                        const parseColor = (str) => {
                            if (!str) return null;
                            str = str.trim().toLowerCase();
                            if (/^(none|transparent|currentcolor|inherit)$/i.test(str)) return null;
                            const rgbM = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
                            if (rgbM) return [+rgbM[1], +rgbM[2], +rgbM[3]];
                            const hexM = str.match(/^#([0-9a-f]{3,8})$/i);
                            if (hexM) {
                                let h = hexM[1];
                                if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
                                return [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16)];
                            }
                            if (/orange|yellow|gold/i.test(str)) return [255, 165, 0];
                            return null;
                        };
                        const isWarm = (rgb) => rgb && rgb[0] > 180 && rgb[0] > rgb[1] + 50 && rgb[0] > rgb[2] + 80;
                        const isFilled = (s) => {
                            const inner = s.tagName === 'SVG' ? s.querySelector('path,polygon,rect,use') : null;

                            const fa = (inner || s).getAttribute('fill') || s.getAttribute('fill') || '';
                            const rgb1 = parseColor(fa);
                            if (rgb1) return isWarm(rgb1);
                            // 2. computed style
                            try {
                                const cs = window.getComputedStyle(inner || s);
                                const rgb2 = parseColor(cs.fill) || parseColor(cs.color);
                                if (rgb2) return isWarm(rgb2);
                            } catch(e){}

                            const cls = ((s.className && s.className.baseVal) || s.className || '').toString();
                            return /\bactive\b|\blit\b|\bhighlighted\b/i.test(cls);
                        };
                        let n = 0;
                        for (const s of starGroup) if (isFilled(s)) n++;
                        if (n >= 1 && n <= 5) rating = n;
                    }
                }

                let date = '';
                const allText = (el.innerText || '');
                const dm = allText.match(/(\d{4}-\d{2}-\d{2})/);
                if (dm) date = dm[1];

                return { text, rating, date };
            }).filter(r => (r.text && r.text.length >= 1) || r.rating);
        };


        const removeNested = (elements) => {
            const valid = [];
            // 倒序遍历可以优先处理深层节点（如果元素是按文档流排列的）
            Array.from(elements).reverse().forEach(el => {
                let nested = false;
                for (const x of valid) {
                    if (x.contains(el) || el.contains(x)) { nested = true; break; }
                }
                if (!nested) valid.push(el);
            });
            // 恢复正序
            return valid.reverse();
        };

        let items = [];
        const overviews = document.querySelectorAll('.product-rating-overview, [class*="product-rating-overview"]');
        const inOverview = (el) => {
            for (const ov of overviews) { if (ov === el || ov.contains(el)) return true; }
            return false;
        };







        //   日期 = .XYk98l 里的 YYYY-MM-DD

        const preciseCards = Array.from(document.querySelectorAll('[data-cmtid]'))
                                  .filter(el => !inOverview(el));
        if (preciseCards.length > 0) {
            const preciseItems = preciseCards.map(card => {
                // ── 星级：数 .icon-rating-solid ──
                const starWrap = card.querySelector('.rGdC5O') || card;
                const filled = starWrap.querySelectorAll('.icon-rating-solid').length;
                const total = starWrap.querySelectorAll('.icon-rating-solid, .icon-rating').length;

                const rating = (total === 5 && filled >= 1 && filled <= 5) ? filled : null;


                const meta = card.querySelector('.meQyXP');
                const parts = [];
                if (meta) {


                    meta.querySelectorAll('.K5v3lN').forEach(label => {
                        const lblTxt = (label.textContent || '').trim();
                        const valueEl = label.nextElementSibling;
                        const valTxt = valueEl ? (valueEl.textContent || '').trim() : '';
                        if (valTxt) parts.push(lblTxt + valTxt);
                    });

                    const main = meta.querySelector('.YNedDV');
                    const mainTxt = main ? (main.textContent || '').trim() : '';
                    if (mainTxt) parts.push(mainTxt);
                }
                const text = parts.join('\n').trim();


                const authorEl = card.querySelector('.InK5kS');
                const author = authorEl ? (authorEl.textContent || '').trim() : '';

                // ── 日期 ──
                let date = '';
                const dateEl = card.querySelector('.XYk98l');
                if (dateEl) {
                    const dm = (dateEl.textContent || '').match(/(\d{4}-\d{2}-\d{2})/);
                    if (dm) date = dm[1];
                }
                return { text, rating, date, author };
            }).filter(r => r.text && r.text.length >= 1);

            if (preciseItems.length > 0) {

                preciseItems.__via = 'precise-cmtid';
                return preciseItems;
            }
        }


        let ratingsRoot = document.querySelector('.product-ratings, [class*="product-ratings"]:not([class*="overview"])');
        if (!ratingsRoot) {
            // 用带 width:100% 的元素来猜测 root（之前误将其当成了评论卡片）
            const rootCands = Array.from(document.querySelectorAll('div.tpgcVs.x4KXas, div.ZDu7mK')).filter(e => !inOverview(e) && e.innerText.length > 100);
            if (rootCands.length > 0) ratingsRoot = rootCands[0];
        }

        // ── 策略 A0：类频次匹配 ──
        if (ratingsRoot) {
            const allDivs = ratingsRoot.querySelectorAll('div');
            const classElems = new Map();
            allDivs.forEach(d => {
                if (inOverview(d)) return;
                const cls = (d.className || '').toString().trim();
                if (!cls || cls.length > 100) return;
                if (cls.includes('overview') || cls.includes('filter') || cls.includes('wrapper')) return;
                const arr = classElems.get(cls) || [];
                arr.push(d);
                classElems.set(cls, arr);
            });
            const candidates = Array.from(classElems.entries())
                .filter(([cls, els]) => els.length >= 4 && els.length <= 30)
                .map(([cls, els]) => {
                    const valid = els.filter(el => {
                        if (inOverview(el)) return false;
                        const t = (el.innerText || '').trim();
                        return t.length >= 30 && t.length <= 5000;
                    });
                    return { cls, valid, count: valid.length };
                })
                .filter(c => c.count >= 4)
                .sort((a, b) => b.count - a.count);

            for (const c of candidates) {
                const cards = removeNested(c.valid);
                if (cards.length >= 4) {
                    items = tryExtract(cards);
                    if (items.length > 0) return items;
                }
            }
        }


        if (ratingsRoot) {
            const all = ratingsRoot.querySelectorAll('div');
            const cands = [];
            all.forEach(el => {
                if (inOverview(el)) return;
                const t = (el.innerText || '').trim();
                if (t.length < 30 || t.length > 5000) return;
                const imgs = el.querySelectorAll('img');
                if (imgs.length === 0) return;
                const r = imgs[0].getBoundingClientRect();
                if (r.width < 16 || r.width > 80) return;
                cands.push(el);
            });
            const cards = removeNested(cands);
            if (cards.length > 0) {
                items = tryExtract(cards);
                if (items.length > 0) return items;
            }
        }


        const classSels = [
            'div.shopee-product-rating',
            'div[class*="shopee-product-rating"]',
            'div[class*="product-rating-list"] > div',
            'div[class*="ProductRatingItem"]',
            'div[class*="shopee-product-comment-list"] > div'
        ];
        for (const sel of classSels) {
            const els = Array.from(document.querySelectorAll(sel)).filter(el => !inOverview(el));
            if (els.length > 0) {
                const cards = removeNested(els);
                items = tryExtract(cards);
                if (items.length > 0) return items;
            }
        }

        // ── 策略 B：结构检测（5星图标） ──
        const starCandidates = document.querySelectorAll('svg, img, i');
        const starParents = new Set();
        starCandidates.forEach(s => {
            if (inOverview(s)) return;
            const parent = s.parentElement;
            if (!parent || starParents.has(parent) || inOverview(parent)) return;
            const siblings = Array.from(parent.children);
            if (siblings.length === 5 && siblings.every(c => c.tagName === s.tagName)) {
                const r = s.getBoundingClientRect();
                if (r.width >= 6 && r.width <= 28 && r.height >= 6 && r.height <= 28) {
                    starParents.add(parent);
                }
            }
        });
        let blocksB = new Set();
        starParents.forEach(sp => {
            let p = sp;
            for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
                if (inOverview(p)) continue;
                const t = (p.innerText || '').trim();
                if (t.length >= 30 && t.length <= 4000) { blocksB.add(p); break; }
            }
        });
        const cardsB = removeNested(Array.from(blocksB));
        items = tryExtract(cardsB);
        if (items.length > 0) return items;


        const litBars = Array.from(document.querySelectorAll('[style*="width"]')).filter(e => {
            if (inOverview(e)) return false;
            const w = e.style.width || '';
            if (!w.includes('%')) return false;
            const pct = parseFloat(w);
            if (isNaN(pct) || pct <= 0 || pct > 100) return false;
            const r = e.parentElement?.getBoundingClientRect();
            return r && r.width >= 40 && r.width <= 160 && r.height >= 8 && r.height <= 30;
        });
        let blocksC = new Set();
        litBars.forEach(bar => {
            let p = bar;
            for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
                if (inOverview(p)) continue;
                const t = (p.innerText || '').trim();
                if (t.length >= 30 && t.length <= 4000) { blocksC.add(p); break; }
            }
        });
        const cardsC = removeNested(Array.from(blocksC));
        items = tryExtract(cardsC);
        if (items.length > 0) return items;


        let blocksD = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const s = (node.textContent || '').trim();
                if (s.length >= 15 && s.length <= 4000) {
                    if (/^(Reportar|Laporkan|Report|举报|Helpful|Util|Berguna)/i.test(s)) return NodeFilter.FILTER_REJECT;
                    if (node.parentElement && (node.parentElement.tagName === 'SCRIPT' || node.parentElement.tagName === 'STYLE')) return NodeFilter.FILTER_REJECT;
                    return NodeFilter.FILTER_ACCEPT;
                }
                return NodeFilter.FILTER_REJECT;
            }
        });
        while (walker.nextNode()) {
            let p = walker.currentNode.parentElement;
            for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
                if (inOverview(p)) continue;
                const r = p.getBoundingClientRect();
                if (r.height >= 30 && r.height <= 800 && r.width > 100) {
                    blocksD.add(p);
                    break;
                }
            }
        }
        let containersD = Array.from(blocksD).filter(b => {
            if (inOverview(b)) return false;
            const svgs = b.querySelectorAll('svg');
            const bars = Array.from(b.querySelectorAll('[style*="width"]')).filter(e => (e.style.width||'').includes('%'));
            return svgs.length >= 1 || bars.length >= 1;
        });
        const cardsD = removeNested(containersD);
        items = tryExtract(cardsD);
        return items;
    }

    function clickNextPage() {
        const sels = [
            'button.shopee-icon-button--right:not([disabled])',
            'button.shopee-button-no-outline.shopee-icon-button--right:not([disabled])',
            'button[class*="icon-button--right"]:not([disabled])'
        ];
        for (const sel of sels) {
            const btns = document.querySelectorAll(sel);
            for (const btn of btns) {
                // 找位于评论区祖先里的右箭头按钮（避免点到产品图轮播的下一张）
                let p = btn.parentElement;
                let isReviewArea = false;
                for (let i = 0; i < 8 && p; i++, p = p.parentElement) {
                    const c = (p.className || '').toString().toLowerCase();
                    const id = (p.id || '').toLowerCase();
                    if (c.includes('rating') || c.includes('review') || id.includes('review')) {
                        isReviewArea = true;
                        break;
                    }
                }
                if (isReviewArea) {
                    btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                    btn.click();
                    return true;
                }
            }
        }
        return false;
    }


    async function clickWithCommentsFilter() {

        const RE_WITH_COMMENT = /^\s*(Dengan Komentar|Com Comentários?|With Comments?|Dengan Komen|Có bình luận|有评论|有内容评价)\b/i;
        const all = document.querySelectorAll('button, a, div, span, label');
        for (const el of all) {
            const t = (el.innerText || '').trim();
            if (t.length > 0 && t.length < 80 && RE_WITH_COMMENT.test(t)) {
                try {
                    el.scrollIntoView({ behavior: 'instant', block: 'center' });
                    await sleep(300);
                    el.click();
                    await sleep(2800);
                    return { clicked: true, label: t };
                } catch(e) {}
            }
        }
        return { clicked: false, label: null };
    }


    const productName = getProductName();
    await scrollToReviews();
    await sleep(2500);
    const filterResult = await clickWithCommentsFilter();
    await sleep(800);

    // 首次诊断
    const diagItems = extractReviewsOnPage();
    const diagSample = diagItems.slice(0, 5).map(r => ({
        textPreview: (r.text || '').slice(0, 120),
        rating: r.rating,
        date: r.date,
        author: r.author
    }));
    const diagRatingHist = { 1:0, 2:0, 3:0, 4:0, 5:0, null:0 };
    diagItems.forEach(r => {
        const k = (r.rating>=1 && r.rating<=5) ? r.rating : 'null';
        diagRatingHist[k]++;
    });
    const diagStrategy = diagItems.__via || 'fallback';

    // ── 深度诊断 ──
    function deepDiag() {
        const KEY = /rating|review|comment|feedback|penilaian|avalia[cç][aã]o|coment[aá]rio|ulasan/i;
        const classFreq = {};
        const all = document.querySelectorAll('*');
        let totalEls = 0, withKeyClass = 0;
        const sampleEls = [];
        all.forEach(el => {
            totalEls++;
            const cls = (el.className || '').toString();
            if (cls && KEY.test(cls)) {
                withKeyClass++;
                cls.split(/\s+/).forEach(token => {
                    if (token && KEY.test(token)) classFreq[token] = (classFreq[token] || 0) + 1;
                });
                if (sampleEls.length < 5) {
                    sampleEls.push({ tag: el.tagName, class: cls.slice(0,200), textLen: (el.innerText||'').length, textPreview: (el.innerText||'').trim().slice(0,150), childCount: el.children.length });
                }
            }
        });
        const topClasses = Object.entries(classFreq).sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,v])=>k+'脳'+v);
        const litBars = Array.from(document.querySelectorAll('[style*="width"]')).filter(e=>/\d+(\.\d+)?%/.test(e.style.width||'')).slice(0,5).map(e=>({class:(e.className||'').toString().slice(0,100),width:e.style.width}));
        return { totalElements:totalEls, keywordElements:withKeyClass, topClasses:topClasses, svgCount:document.querySelectorAll('svg').length, imgCount:document.querySelectorAll('img').length, widthSample:litBars, sampleElements:sampleEls };
    }
    const deepDiagResult = deepDiag();

    const seen = new Set();
    const collected = [];
    let pageCount = 0;
    let stagnantPages = 0;
    const maxPages = Math.ceil(maxReviews / 6) + 5;

    while (collected.length < maxReviews && pageCount < maxPages) {
        pageCount++;
        window.scrollBy(0, 240);
        await sleep(500);

        const items = extractReviewsOnPage();
        let added = 0;
        for (const r of items) {
            if (collected.length >= maxReviews) break;
            const key = (r.text || '') ? (r.text.length + '_' + r.text) : ('notext_' + r.rating + '_' + (r.date||'') + '_' + collected.length);
            if (!seen.has(key)) {
                seen.add(key);
                collected.push(r);
                added++;
            }
        }

        if (added === 0) {
            stagnantPages++;
            if (stagnantPages >= 3) break;
        } else {
            stagnantPages = 0;
        }
        if (collected.length >= maxReviews) break;

        const ok = clickNextPage();
        if (!ok) break;
        await sleep(3500);
    }

    const finalReviews = collected.slice(0, maxReviews);
    return {
        productName,
        reviews: finalReviews,
        debug: {
            pages: pageCount,
            limit: maxReviews,
            actualCollected: collected.length,
            actualReturned: finalReviews.length,
            filterResult: filterResult,
            firstScreenCount: diagItems.length,
            strategy: diagStrategy,
            ratingHist: diagRatingHist,
            sample: diagSample,
            url: location.href,
            height: document.body.scrollHeight,
            hasNextPage: !!document.querySelector('button.shopee-icon-button--right:not([disabled])'),
            deepDiag: deepDiagResult
        }
    };
};


// 健康检查 ping（VOC 分析工具使用）：立即响应，证明 background.js 正常运行
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "iantoPing") {
        sendResponse({ ok: true, version: "voc-v1", time: Date.now() });
        return false;
    }
});

// ==========================================
// TikTok Shop 评论抓取函数（注入到目标页面执行）
// ==========================================
const tiktokReviewScraperFunction = async (maxReviews) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getProductName() {
        const dt = (document.title || '').trim();
        if (dt && dt.length > 5) {
            const cleaned = dt.replace(/\s*[-|]\s*TikTok.*$/i, '').trim();
            if (cleaned.length > 3 && cleaned.length < 500) return cleaned;
        }
        const cands = ['h1'];
        for (const sel of cands) {
            const el = document.querySelector(sel);
            const t = (el?.innerText || '').trim();
            if (t && t.length > 5 && t.length < 500) return t;
        }
        return '';
    }

    async function scrollToReviews() {
        const anchors = ['#pdp-review-section'];
        for (const sel of anchors) {
            const el = document.querySelector(sel);
            if (el) {
                el.scrollIntoView({ behavior: 'instant', block: 'start' });
                await sleep(1500);
                return true;
            }
        }
        const total = document.body.scrollHeight;
        for (let y = 0; y < total; y += 500) {
            window.scrollTo(0, y);
            await sleep(400);
        }
        window.scrollTo(0, document.body.scrollHeight * 0.65);
        await sleep(1500);
        return false;
    }

    function extractFromCards(cards) {
        return cards.map(card => {
            let text = '';
            const textEl = card.querySelector('.H4-Regular.text-color-UIText1');
            if (textEl) text = (textEl.textContent || '').trim();

            let date = '';
            const dateEls = card.querySelectorAll('.H4-Regular.text-color-UIText3');
            if (dateEls.length > 0) {
                date = (dateEls[dateEls.length - 1].textContent || '').trim();
            }

            let author = '';
            const authorEl = card.querySelector('.H3-Semibold.text-color-UIText1');
            if (authorEl) author = (authorEl.textContent || '').trim();

            let rating = null;
            const starContainer = card.querySelector('[role="img"][aria-label*="out of 5"]');
            if (starContainer) {
                const aria = starContainer.getAttribute('aria-label');
                const m = aria.match(/(\d+(?:\.\d+)?)\s*out of 5/);
                if (m) rating = parseFloat(m[1]);
            } else {
                const ratingDiv = card.querySelector('.overflow-hidden.flex.gap-4.text-color-UIText1');
                if (ratingDiv) rating = ratingDiv.querySelectorAll('svg').length;
            }

            return { text, rating, date, author };
        }).filter(r => (r.text && r.text.length >= 1) || r.rating);
    }

    function extractReviewsOnPage() {
        const reviewSection = document.querySelector('#pdp-review-section');
        if (!reviewSection) return [];
        
        // Strategy 1: direct child structure
        const reviewElements = reviewSection.querySelectorAll('.flex.flex-col.gap-20 > .flex.flex-col.gap-12');
        if (reviewElements.length > 0) return extractFromCards(Array.from(reviewElements));
        
        // Strategy 2: any gap-12 containing author name (H3-Semibold)
        const allGap12 = reviewSection.querySelectorAll('.flex.flex-col.gap-12');
        const cards2 = Array.from(allGap12).filter(c => c.querySelector('.H3-Semibold'));
        if (cards2.length > 0) return extractFromCards(cards2);

        // Strategy 3: any element containing star rating aria-label
        const starEls = reviewSection.querySelectorAll('[role="img"][aria-label*="out of 5"]');
        if (starEls.length > 0) {
            const cards3 = [];
            for (const star of starEls) {
                let parent = star.parentElement;
                for (let i = 0; i < 6 && parent; i++) {
                    if (parent.classList.contains('gap-12') || parent.classList.contains('gap-16') || parent.classList.contains('gap-8')) {
                        cards3.push(parent);
                        break;
                    }
                    parent = parent.parentElement;
                }
            }
            if (cards3.length > 0) return extractFromCards(cards3);
        }

        // Strategy 4: broadest - any flex-col containing both rating and text content
        const allFlexCols = reviewSection.querySelectorAll('.flex.flex-col');
        const cards4 = Array.from(allFlexCols).filter(c => {
            const hasStar = c.querySelector('[role="img"][aria-label*="out of 5"]') || c.querySelector('.overflow-hidden.flex.gap-4');
            const hasText = c.querySelector('.H4-Regular');
            const isSmall = c.children.length <= 15;
            return hasStar && hasText && isSmall;
        });
        if (cards4.length > 0) return extractFromCards(cards4);

        return [];
    }

    function clickNextPage() {
        const reviewSection = document.querySelector('#pdp-review-section');
        if (!reviewSection) return false;
        
        const allPointers = Array.from(reviewSection.querySelectorAll('.cursor-pointer'));
        for (let i = allPointers.length - 1; i >= 0; i--) {
            const btn = allPointers[i];
            const text = (btn.textContent || '').trim();
            if (/(下一步|Next|Siguiente|Kế tiếp|Seterusnya|Selanjutnya)/i.test(text)) {
                if (!btn.classList.contains('text-color-UITextPlaceholder')) {
                    btn.scrollIntoView({ behavior: 'instant', block: 'center' });
                    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    return true;
                } else {
                    return false;
                }
            }
        }

        const gap6s = Array.from(reviewSection.querySelectorAll('.flex.gap-6'));
        for (let i = gap6s.length - 1; i >= 0; i--) {
            const pageContainer = gap6s[i];
            const nextBtn = pageContainer.nextElementSibling;
            if (nextBtn && nextBtn.classList.contains('cursor-pointer')) {
                if (!nextBtn.classList.contains('text-color-UITextPlaceholder')) {
                    nextBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
                    nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    return true;
                } else {
                    return false; // Found the button but it's disabled (last page)
                }
            }
        }
        return false;
    }

    const productName = getProductName();
    await scrollToReviews();
    
    if (!document.querySelector('#pdp-review-section')) {
        return {
            productName,
            reviews: [],
            error: "Network error or no reviews. Please check your TikTok connection and ensure you are using a Mode C URL.",
        };
    }

    await sleep(2500);

    const seen = new Set();
    const collected = [];
    let pageCount = 0;
    let stagnantPages = 0;
    const maxPages = Math.ceil(maxReviews / 5) + 5;

    while (collected.length < maxReviews && pageCount < maxPages) {
        pageCount++;
        window.scrollBy(0, 300);
        await sleep(600);

        const items = extractReviewsOnPage();
        let added = 0;
        for (const r of items) {
            if (collected.length >= maxReviews) break;
            const key = (r.text || '') ? (r.text.length + '_' + r.text) : ('notext_' + r.rating + '_' + (r.author||'') + '_' + (r.date||'') + '_' + collected.length);
            if (!seen.has(key)) {
                seen.add(key);
                collected.push(r);
                added++;
            }
        }
        if (added === 0) {
            stagnantPages++;
            if (stagnantPages >= 3) break;
        } else { stagnantPages = 0; }
        if (collected.length >= maxReviews) break;

        const ok = clickNextPage();
        if (!ok) break;
        await sleep(3000);
    }

    return {
        productName,
        reviews: collected.slice(0, maxReviews),
        debug: {
            platform: 'tiktok',
            pages: pageCount,
            上限: maxReviews,
            实际收集: collected.length,
            椤甸潰URL: location.href
        }
    };
};
// ==========================================
// Lazada Review Scraper (pdp-mod-review-v2)
// 2026-05 rewritten with exact Lazada DOM selectors
// ==========================================
const lazadaReviewScraperFunction = async (maxReviews) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getProductName() {
        const dt = (document.title || '').trim();
        if (dt && dt.length > 5) {
            const cleaned = dt
                .replace(/\s*[-|].*Lazada.*$/i, '')
                .replace(/\s*[-|]\s*Buy\s.*$/i, '')
                .trim();
            if (cleaned.length > 3 && cleaned.length < 500) return cleaned;
        }
        const cands = [
            'h1.pdp-mod-product-badge-title',
            'span.pdp-mod-product-badge-title',
            'h1[class*="product-title"]',
            'div.pdp-product-title span',
            'h1'
        ];
        for (const sel of cands) {
            const el = document.querySelector(sel);
            const t = (el?.innerText || '').trim();
            if (t && t.length > 5 && t.length < 500) return t;
        }
        return '';
    }

    async function scrollToReviews() {
        const anchors = [
            '.pdp-mod-review-v2',
            '#module_product_review',
            '#module_product-review',
            '.pdp-mod-review-main',
            '.mod-reviews'
        ];
        for (const sel of anchors) {
            const el = document.querySelector(sel);
            if (el) {
                el.scrollIntoView({ behavior: 'instant', block: 'start' });
                await sleep(1500);
                return true;
            }
        }
        const KEY = /^\s*(Ratings?\s*&?\s*Reviews?|Reviews?\s*\(\d+\)|Penilaian|Ulasan)/i;
        const allHeads = document.querySelectorAll('h1,h2,h3,h4,div,span,.title-text');
        for (const el of allHeads) {
            const t = (el.innerText || '').trim();
            if (t.length > 0 && t.length < 80 && KEY.test(t)) {
                try { el.scrollIntoView({ behavior: 'instant', block: 'start' }); await sleep(1500); return true; } catch(e){}
            }
        }
        const total = document.body.scrollHeight;
        for (let y = 0; y < total; y += 500) {
            window.scrollTo(0, y);
            await sleep(400);
        }
        window.scrollTo(0, document.body.scrollHeight * 0.65);
        await sleep(1500);
        return false;
    }

    function extractFromCards(cards) {
        return cards.map(card => {
            // Text: .item-content-main-content-reviews-item span (exclude .review-attribute labels)
            let textParts = [];
            const reviewItems = card.querySelectorAll('.item-content-main-content-reviews-item');
            reviewItems.forEach(item => {
                const spans = item.querySelectorAll('span');
                spans.forEach(span => {
                    if (span.classList.contains('review-attribute')) return;
                    const t = (span.textContent || '').trim();
                    if (t.length > 0) textParts.push(t);
                });
            });
            const text = textParts.join('\n').trim();

            // Rating: .container-star.review-star > 5x SVG > second path mask="url(#half_XX%)"
            let rating = null;
            const starContainer = card.querySelector('.container-star.review-star');
            if (starContainer) {
                const starItems = starContainer.querySelectorAll('.i-rate-star-item');
                if (starItems.length === 5) {
                    let filled = 0;
                    starItems.forEach(si => {
                        const svg = si.querySelector('svg');
                        if (!svg) return;
                        const paths = svg.querySelectorAll('path');
                        if (paths.length >= 2) {
                            const maskAttr = paths[1].getAttribute('mask') || '';
                            const m = maskAttr.match(/half_(\d+)%/);
                            if (m && parseInt(m[1], 10) >= 50) filled++;
                        }
                    });
                    if (filled >= 1 && filled <= 5) rating = filled;
                }
            }

            // Date: .time
            let date = '';
            const timeEl = card.querySelector('.time');
            if (timeEl) {
                const t = (timeEl.textContent || '').trim();
                const dm = t.match(/(\d{4}-\d{2}-\d{2})/);
                if (dm) date = dm[1];
                else date = t;
            }

            // Author: .reviewer
            let author = '';
            const reviewerEl = card.querySelector('.reviewer');
            if (reviewerEl) author = (reviewerEl.textContent || '').trim();

            return { text, rating, date, author };
        }).filter(r => (r.text && r.text.length >= 1) || r.rating);
    }

    function extractReviewsOnPage() {
        const cards = Array.from(document.querySelectorAll('.mod-reviews .item'));
        if (cards.length > 0) return extractFromCards(cards);
        const alt = Array.from(document.querySelectorAll('.pdp-mod-review-main .item, .pdp-review-list .item'));
        if (alt.length > 0) return extractFromCards(alt);
        return [];
    }

    function clickNextPage() {
        const nextLi = document.querySelector('.iweb-pagination-next:not(.iweb-pagination-disabled)');
        if (nextLi) {
            const btn = nextLi.querySelector('button') || nextLi;
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            btn.click();
            return true;
        }
        const sels = ['.next:not(.disabled)', 'button[aria-label="Next"]:not([disabled])'];
        for (const sel of sels) {
            const btn = document.querySelector(sel);
            if (btn) { btn.scrollIntoView({ behavior: 'instant', block: 'center' }); btn.click(); return true; }
        }
        return false;
    }

    const productName = getProductName();
    await scrollToReviews();
    await sleep(2500);

    const seen = new Set();
    const collected = [];
    let pageCount = 0;
    let stagnantPages = 0;
    const maxPages = Math.ceil(maxReviews / 5) + 5;

    while (collected.length < maxReviews && pageCount < maxPages) {
        pageCount++;
        window.scrollBy(0, 300);
        await sleep(600);

        const items = extractReviewsOnPage();
        let added = 0;
        for (const r of items) {
            if (collected.length >= maxReviews) break;
            const key = (r.text || '') ? (r.text.length + '_' + r.text) : ('notext_' + r.rating + '_' + (r.author||'') + '_' + (r.date||'') + '_' + collected.length);
            if (!seen.has(key)) {
                seen.add(key);
                collected.push(r);
                added++;
            }
        }
        if (added === 0) {
            stagnantPages++;
            if (stagnantPages >= 3) break;
        } else { stagnantPages = 0; }
        if (collected.length >= maxReviews) break;

        const ok = clickNextPage();
        if (!ok) break;
        await sleep(3000);
    }

    return {
        productName,
        reviews: collected.slice(0, maxReviews),
        debug: {
            platform: 'lazada',
            pages: pageCount,
            maxTarget: maxReviews,
            actualCollected: collected.length,
            pageURL: location.href
        }
    };
};


// ==========================================
// Tokopedia Review Scraper
// ==========================================
const tokopediaReviewScraperFunction = async (maxReviews) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getProductName() {
        const h1 = document.querySelector('h1[data-testid="lblPDPDetailProductName"]');
        if (h1) return (h1.innerText || '').trim();
        const title = (document.title || '').split('|')[0].trim();
        return title;
    }

    async function scrollToReviews() {
        const anchors = ['#pdp_comp-review', '[data-testid="pdpReviewContainer"]'];
        for (const sel of anchors) {
            const el = document.querySelector(sel);
            if (el) {
                el.scrollIntoView({ behavior: 'instant', block: 'start' });
                await sleep(1500);
                return true;
            }
        }
        window.scrollTo(0, document.body.scrollHeight * 0.65);
        await sleep(1500);
        return false;
    }

    function extractReviewsOnPage() {
        const reviewContainer = document.querySelector('#pdp_comp-review') || document;
        const cards = Array.from(reviewContainer.querySelectorAll('article.css-15m2bcr'));
        return cards.map(card => {
            let text = '';
            const textEl = card.querySelector('[data-testid="lblItemUlasan"]');
            if (textEl) text = (textEl.textContent || '').trim();

            let author = '';
            const authorEl = card.querySelector('span.name');
            if (authorEl) author = (authorEl.textContent || '').trim();

            let date = '';
            const dateEl = card.querySelector('div.css-1w6pe1p > p');
            if (dateEl) date = (dateEl.textContent || '').trim();

            let rating = null;
            const starContainer = card.querySelector('[data-testid="icnStarRating"]');
            if (starContainer) {
                const aria = starContainer.getAttribute('aria-label');
                if (aria) {
                    const m = aria.match(/\d+/);
                    if (m) rating = parseInt(m[0], 10);
                }
                if (!rating) {
                    rating = starContainer.querySelectorAll('svg').length;
                }
            }

            return { text, rating, date, author };
        }).filter(r => (r.text && r.text.length >= 2) || r.rating);
    }

    function clickNextPage() {
        const nextBtn = document.querySelector('button[aria-label="Laman berikutnya"]');
        if (nextBtn && !nextBtn.hasAttribute('disabled')) {
            nextBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        }
        return false;
    }

    const productName = getProductName();
    await scrollToReviews();
    await sleep(2500);

    const seen = new Set();
    const collected = [];
    let pageCount = 0;
    let stagnantPages = 0;
    const maxPages = Math.ceil(maxReviews / 5) + 5;

    while (collected.length < maxReviews && pageCount < maxPages) {
        pageCount++;
        window.scrollBy(0, 300);
        await sleep(600);

        const items = extractReviewsOnPage();
        let added = 0;
        for (const r of items) {
            if (collected.length >= maxReviews) break;
            const key = (r.text || '') + '_' + r.author + '_' + r.date;
            if (!seen.has(key)) {
                seen.add(key);
                collected.push(r);
                added++;
            }
        }
        
        if (added === 0) {
            stagnantPages++;
            if (stagnantPages >= 3) break;
        } else {
            stagnantPages = 0;
        }

        if (collected.length >= maxReviews) break;

        const ok = clickNextPage();
        if (!ok) break;
        await sleep(3000);
    }

    return {
        productName,
        reviews: collected.slice(0, maxReviews),
        debug: {
            platform: 'tokopedia',
            pages: pageCount,
            上限: maxReviews,
            实际收集: collected.length
        }
    };
};


// ==========================================
// Amazon Review Scraper
// ==========================================
const amazonReviewScraperFunction = async (maxReviews) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getProductName() {
        const el = document.querySelector('[data-hook="product-link"], #cm_cr-product_info a, #productTitle');
        if (el) return (el.innerText || '').trim();
        return (document.title || '').split(':')[0].trim();
    }

    function extractReviewsOnPage() {
        const cards = Array.from(document.querySelectorAll('[data-hook="review"]'));
        return cards.map(card => {
            let text = '';
            const textEl = card.querySelector('[data-hook="review-body"] span, [data-hook="review-body"]');
            if (textEl) text = (textEl.innerText || '').trim();

            let rating = null;
            const starEl = card.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt');
            if (starEl) {
                const m = (starEl.textContent || '').match(/(\d+(?:\.\d+)?)/);
                if (m) rating = parseFloat(m[1]);
            }

            let author = '';
            const authorEl = card.querySelector('[data-hook="review-author"] .a-profile-name, .a-profile-name');
            if (authorEl) author = (authorEl.textContent || '').trim();

            let date = '';
            const dateEl = card.querySelector('[data-hook="review-date"]');
            if (dateEl) {
                const dm = (dateEl.textContent || '').match(/(\w+ \d+, \d{4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[-\/-]\d{2}[-\/-]\d{2})/);
                if (dm) date = dm[1];
            }

            return { text, rating, date, author };
        }).filter(r => (r.text && r.text.length >= 1) || r.rating);
    }

    const productName = getProductName();
    await sleep(2500);

    const seen = new Set();
    const collected = [];
    let pageCount = 0;
    let stagnantPages = 0;
    const maxPages = Math.ceil(maxReviews / 10) + 10;

    while (collected.length < maxReviews && pageCount < maxPages) {
        pageCount++;
        window.scrollBy(0, 800);
        await sleep(500);

        const items = extractReviewsOnPage();
        let added = 0;
        for (const r of items) {
            if (collected.length >= maxReviews) break;
            const key = (r.text || '') ? (r.text.length + '_' + r.text) : ('notext_' + r.rating + '_' + (r.author||'') + '_' + (r.date||'') + '_' + collected.length);
            if (!seen.has(key)) {
                seen.add(key);
                collected.push(r);
                added++;
            }
        }

        if (added === 0) { stagnantPages++; if (stagnantPages >= 4) break; } else { stagnantPages = 0; }
        if (collected.length >= maxReviews) break;

        // Amazon "展示更多" 按钮 (Exibir mais X avaliações / See more reviews)
        // 先滚到底部让按钮可见
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(800);
        const showMoreBtn = document.querySelector(
            '[data-hook="show-more-button"],' +
            '.cm-cr-show-more a,' +
            '#cm_cr-pagination_bar a,' +
            '[data-hook="pagination-bar-next-button"], .a-last a'
        );
        if (showMoreBtn) {
            showMoreBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(300);
            showMoreBtn.click();
            await sleep(3500);
        } else {
            // 没有"展示更多"按钮，可能到头了
            break;
        }
    }

    return {
        productName,
        reviews: collected.slice(0, maxReviews),
        debug: { platform: 'amazon', pages: pageCount, 上限: maxReviews, 实际收集: collected.length }
    };
};

// ==========================================
// AliExpress Review Scraper
// ==========================================
const aliexpressReviewScraperFunction = async (maxReviews) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getProductName() {
        const el = document.querySelector('h1[class*="title"], .product-title, h1');
        if (el) return (el.innerText || '').trim();
        return (document.title || '').split('|')[0].trim();
    }

    // 是否真正有"完整评论 modal"打开（不是页面 inline 预览）
    function reviewModalOpen() {
        const m = document.querySelector('.comet-v2-modal-body, [class*="comet-modal-body"]');
        return !!(m && m.offsetParent !== null && m.querySelector('[class*="list--itemBox"]'));
    }

    // 锁定到 #nav-review 区域内的"Ver más"按钮（避免点到详情/描述/推荐区域的同名按钮）
    function findReviewVerMasBtn() {
        const navReview = document.querySelector('#nav-review, [id*="review"]');
        const scopes = [];
        if (navReview) scopes.push(navReview);
        // 兜底：从 inline 评论卡片往上回溯找按钮
        const lastCard = document.querySelectorAll('[class*="list--itemBox"]');
        if (lastCard.length > 0) {
            let p = lastCard[lastCard.length - 1].parentElement;
            for (let i = 0; i < 6 && p && p !== document.body; i++, p = p.parentElement) {
                if (!scopes.includes(p)) scopes.push(p);
            }
        }
        for (const scope of scopes) {
            const btns = scope.querySelectorAll('button');
            for (const b of btns) {
                const txt = (b.textContent || '').trim().toLowerCase();
                if (/^(ver m[aá]s|see all|see more|valoraciones)$/i.test(txt) ||
                    txt.includes('ver más') || txt.includes('see all reviews')) {
                    return b;
                }
            }
        }
        return null;
    }

    async function openReviewModal() {
        // 已经打开了就不点
        if (reviewModalOpen()) return true;

        // 一线：锁定评论区域内的 Ver más 按钮
        const reviewBtn = findReviewVerMasBtn();
        if (reviewBtn) {
            reviewBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(600);
            reviewBtn.click();
            await sleep(3000);
            if (reviewModalOpen()) return true;
        }

        // 二线：广搜 Ver más / See all reviews（按文本，避免类名漂移）
        const allBtns = Array.from(document.querySelectorAll('button, span, a'));
        const fb = allBtns.find(b => {
            const txt = (b.textContent || '').trim().toLowerCase();
            return txt === 'ver más' || txt === 'see all' || txt === 'see more' ||
                   txt === 'valoraciones' || txt.includes('see all reviews') || txt.includes('evaluaciones');
        });
        if (fb) {
            fb.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(600);
            fb.click();
            await sleep(3000);
            if (reviewModalOpen()) return true;
        }

        // 三线：点击评分区域
        const ratingArea = document.querySelector('[class*="title--rating"], [class*="review--wrap"], [class*="rating-info"]');
        if (ratingArea) {
            ratingArea.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(500);
            ratingArea.click();
            await sleep(3000);
            if (reviewModalOpen()) return true;
        }

        // 兜底：modal 没开起来，退而求其次，看看页面 inline 是否有卡片可抓
        return document.querySelectorAll('[class*="list--itemBox"]').length > 0;
    }

    // 找到"真正包含评论卡片"的那个 modal（页面上可能并列好几个 dialog）
    function getReviewModal() {
        const all = Array.from(document.querySelectorAll(
            '.comet-v2-modal-body, [class*="comet-modal-body"], [role="dialog"]'
        ));
        // 优先：内部有 list--itemBox 卡片的那个
        const withCards = all.find(m => m.querySelector('[class*="list--itemBox"]'));
        if (withCards) return withCards;
        // 次优：标题或内容含 review/calificaciones/reseña/evaluaci 关键词且可见
        const byText = all.find(m => {
            if (m.offsetParent === null) return false;
            return /calificacion|rese[ñn]a|review|valoraci|opini|evaluaci/i.test(m.textContent || '');
        });
        return byText || all[0] || null;
    }

    function getModal() { return getReviewModal(); }

    // 当 0 条卡片时用，回传 modal 内部样本，方便定位真实 className
    function sampleModalDOM() {
        const allModals = Array.from(document.querySelectorAll(
            '.comet-v2-modal-body, [class*="comet-modal-body"], [role="dialog"]'
        ));
        const modal = getReviewModal();
        const sampleOf = (m) => {
            if (!m) return null;
            const all = Array.from(m.querySelectorAll('*'));
            return {
                cls: typeof m.className === 'string' ? m.className.slice(0, 100) : '',
                visible: m.offsetParent !== null,
                childCount: m.children.length,
                totalDescendants: all.length,
                sample: all.slice(0, 30)
                    .filter(el => typeof el.className === 'string' && el.className)
                    .map(el => ({
                        tag: el.tagName,
                        cls: el.className.slice(0, 80),
                        text: ((el.innerText || el.textContent || '').trim().slice(0, 60))
                    }))
            };
        };
        return {
            modalsFound: allModals.length,
            globalListItemBox: document.querySelectorAll('[class*="list--itemBox"]').length,
            chosenModal: sampleOf(modal),
            allModalsCls: allModals.map(m => ({
                cls: typeof m.className === 'string' ? m.className.slice(0, 80) : '',
                visible: m.offsetParent !== null,
                hasCards: !!m.querySelector('[class*="list--itemBox"]')
            }))
        };
    }

    // 数字日期格式（"01 MAY 2026" / "09 MAR 2026"）
    const DATE_RE = /^\d{1,2}\s+[A-Za-zÀ-ÿ]{3,9}\.?\s+\d{4}$/;
    function looksLikeDate(t) { return DATE_RE.test((t || '').trim()); }

    function extractFromCard(card) {
        let text = '';
        const textEl = card.querySelector(
            '.list--itemReview--d9Z9Z5Z, [class*="itemReview"], [class*="review-content"], [class*="reviewContent"]'
        );
        if (textEl) text = (textEl.innerText || '').trim();

        // 文本兜底：找卡片内最长的、不含 svg/img/按钮、不是元数据行的文本
        if (!text) {
            const candidates = Array.from(card.querySelectorAll('div, p, span'))
                .map(el => ({ el, t: (el.innerText || '').trim() }))
                .filter(({ el, t }) => {
                    if (t.length < 3 || t.length > 1000) return false;
                    if (/^Color\s*[:：]/i.test(t)) return false;
                    if (/^Tama[ñn]o\s*[:：]/i.test(t)) return false;
                    if (looksLikeDate(t)) return false;
                    if (/Te ha ayudado|Útil|Helpful/i.test(t)) return false;
                    if (/\|\s*\d{1,2}\s+[A-Za-zÀ-ÿ]{3}/.test(t)) return false; // "x***x | 01 MAY 2026"
                    if (el.querySelector('svg, img, button')) return false;
                    if (el.children.length > 4) return false; // 不是叶子级
                    return true;
                })
                .sort((a, b) => b.t.length - a.t.length);
            if (candidates.length) text = candidates[0].t;
        }

        let rating = null;
        const filled = card.querySelectorAll(
            '.comet-icon-starreviewfilled, [class*="starreviewfilled"], [class*="star-full"], [class*="starFull"]'
        );
        if (filled.length > 0 && filled.length <= 5) rating = filled.length;
        // 兜底：aria-label
        if (rating === null) {
            const ariaEl = card.querySelector('[aria-label*="star"], [aria-label*="estrella"], [aria-label*="estrela"]');
            if (ariaEl) {
                const m = (ariaEl.getAttribute('aria-label') || '').match(/(\d+(?:\.\d+)?)/);
                if (m) rating = parseFloat(m[1]);
            }
        }

        let author = '';
        let date = '';
        const infoEl = card.querySelector(
            '.list--itemInfo--VEcgSFh span, [class*="itemInfo"] span, [class*="user-name"], [class*="userInfo"]'
        );
        if (infoEl) {
            const infoText = (infoEl.textContent || '').trim();
            if (infoText.includes('|')) {
                const parts = infoText.split('|');
                author = parts[0].trim();
                date = parts[1].trim();
            } else {
                author = infoText;
            }
        }
        // 日期兜底：扫卡片所有文本节点
        if (!date) {
            const all = Array.from(card.querySelectorAll('div, span, p'));
            for (const el of all) {
                const t = (el.innerText || '').trim();
                if (looksLikeDate(t)) { date = t; break; }
                const m = t.match(/(\d{1,2}\s+[A-Za-zÀ-ÿ]{3,9}\.?\s+\d{4})/);
                if (m && t.length < 50) { date = m[1]; if (!author && t.includes('|')) author = t.split('|')[0].trim(); break; }
            }
        }

        return { text, rating, date, author };
    }

    function findCardsByStars(container) {
        const stars = Array.from(container.querySelectorAll(
            '[class*="star-full"], [class*="starreviewfilled"], [class*="starFull"], [class*="comet-icon-star"]'
        ));
        if (stars.length === 0) return [];
        const cardSet = new Set();
        for (const star of stars) {
            let el = star.parentElement;
            for (let i = 0; i < 10 && el && el !== container && el !== document.body; i++, el = el.parentElement) {
                const text = (el.innerText || '').trim();
                if (text.length >= 15 && text.length < 2000 && el.children.length >= 2) {
                    // 必须含有星星 + 文本（不止一行）
                    cardSet.add(el);
                    break;
                }
            }
        }
        // 去掉互相嵌套的：只保留最深层的
        const arr = Array.from(cardSet);
        return arr.filter(a => !arr.some(b => b !== a && a.contains(b)));
    }

    function findCardsByDate(container) {
        const all = Array.from(container.querySelectorAll('div, span, p'));
        const dateNodes = all.filter(el => {
            const t = (el.innerText || '').trim();
            return t.length < 60 && (looksLikeDate(t) || /\|\s*\d{1,2}\s+[A-Za-zÀ-ÿ]{3,9}\.?\s+\d{4}/.test(t));
        });
        const cardSet = new Set();
        for (const dn of dateNodes) {
            let el = dn.parentElement;
            for (let i = 0; i < 10 && el && el !== container && el !== document.body; i++, el = el.parentElement) {
                const text = (el.innerText || '').trim();
                if (text.length >= 20 && text.length < 2000 && el.children.length >= 2) {
                    cardSet.add(el);
                    break;
                }
            }
        }
        const arr = Array.from(cardSet);
        return arr.filter(a => !arr.some(b => b !== a && a.contains(b)));
    }

    function extractReviewsFromModal() {
        // 优先：modal 打开时只在 modal 内抓（避免 inline 预览和 modal 双份重复）
        const modal = document.querySelector('.comet-v2-modal-body, [class*="comet-modal-body"]');
        if (modal && modal.offsetParent !== null) {
            const modalCards = Array.from(modal.querySelectorAll(
                '[class*="list--itemBox"], [class*="review-item"], [class*="reviewItem"]'
            ));
            const r = modalCards.map(extractFromCard).filter(x => (x.text && x.text.length >= 1) || x.rating);
            if (r.length > 0) return r;
        }

        // 一线兜底：全局找 list--itemBox（modal 没开起来时用 inline 预览）
        let cards = Array.from(document.querySelectorAll(
            '[class*="list--itemBox"], [class*="review-item"], [class*="reviewItem"]'
        ));
        let result = cards.map(extractFromCard).filter(r => (r.text && r.text.length >= 1) || r.rating);
        if (result.length > 0) return result;

        // 二/三线 fallback：结构性回溯
        const container = modal || getReviewModal() || document;

        cards = findCardsByStars(container);
        result = cards.map(extractFromCard).filter(r => (r.text && r.text.length >= 1) || r.rating);
        if (result.length > 0) return result;

        cards = findCardsByDate(container);
        return cards.map(extractFromCard).filter(r => (r.text && r.text.length >= 1) || r.rating);
    }

    const productName = getProductName();

    window.scrollTo(0, document.body.scrollHeight * 0.65);
    await sleep(2000);

    await openReviewModal();
    await sleep(2000);

    const seen = new Set();
    const collected = [];
    let pageCount = 0;
    let stagnantPages = 0;
    const maxPages = Math.ceil(maxReviews / 10) + 10;

    while (collected.length < maxReviews && pageCount < maxPages) {
        pageCount++;

        // 滚动：modal 打开就在 modal 内滚；否则滚整个文档（让 inline 卡片懒挂载）
        const modal = document.querySelector('.comet-v2-modal-body, [class*="comet-modal-body"]');
        if (modal && modal.offsetParent !== null) {
            // modal 内部可能有专门的滚动容器
            const scrollable = modal.querySelector('[class*="scroll"]') || modal;
            scrollable.scrollBy(0, 1200);
            // 同时把最后一张卡片滚到视口（强制 lazy render）
            const cards = modal.querySelectorAll('[class*="list--itemBox"]');
            if (cards.length > 0) cards[cards.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
        } else {
            // 没 modal 时：滚 window 触发 inline lazy 渲染
            window.scrollBy(0, 800);
            const cards = document.querySelectorAll('[class*="list--itemBox"]');
            if (cards.length > 0) cards[cards.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
        }
        await sleep(1200);

        const items = extractReviewsFromModal();
        let added = 0;
        for (const r of items) {
            if (collected.length >= maxReviews) break;
            const key = (r.text || '') ? (r.text.length + '_' + r.text) : ('notext_' + r.rating + '_' + (r.author||'') + '_' + (r.date||'') + '_' + collected.length);
            if (!seen.has(key)) {
                seen.add(key);
                collected.push(r);
                added++;
            }
        }

        if (added === 0) { stagnantPages++; if (stagnantPages >= 4) break; } else { stagnantPages = 0; }
        if (collected.length >= maxReviews) break;

        const nextBtn = document.querySelector(
            '[class*="pagination"] [class*="next"]:not([class*="disabled"]),' +
            '.comet-pagination-next:not(.comet-pagination-disabled),' +
            'button[class*="next"]:not([disabled])'
        );
        if (nextBtn && added === 0) {
            // 注意：不要在 click next 时清零 stagnant，否则没有真分页的小商品会撑到 maxPages
            nextBtn.click();
            await sleep(2500);
        }
    }

    const debug = { platform: 'aliexpress', pages: pageCount, 上限: maxReviews, 实际收集: collected.length };
    if (collected.length === 0) debug.modalSample = sampleModalDOM();

    return {
        productName,
        reviews: collected.slice(0, maxReviews),
        debug
    };
};

// ==========================================
// Temu Review Scraper
// ==========================================
const temuReviewScraperFunction = async (maxReviews) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function getProductName() {
        const el = document.querySelector('h1.product-title, h1[class*="title"], h1');
        if (el) return (el.innerText || '').trim();
        return (document.title || '').split('|')[0].trim();
    }

    async function openModal() {
        const modal = document.querySelector('._2OaJDN8Y[role="dialog"], [role="dialog"]');
        if (modal && (modal.textContent || '').includes('reviews')) return true;

        const reviewArea = document.querySelector('#reviewContent, [data-nosnippet="true"]');
        if (reviewArea) {
            reviewArea.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(1500);
        } else {
            window.scrollTo(0, document.body.scrollHeight * 0.6);
            await sleep(1500);
        }

        const isVisible = (el) => {
            if (!el || !el.offsetParent) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };

        const findSeeAllBtn = () => {
            // 优先：role=button 且文本严格等于 "See all reviews" / "查看全部评论" 等
            const exactPhrases = ['see all reviews', '查看全部评论', '查看所有评论', '查看全部评价', '查看所有评价', 'ver todas las reseñas', 'voir tous les avis', 'alle bewertungen anzeigen'];
            const candidates = Array.from(document.querySelectorAll('[role="button"], button, a, div'));

            // 1. 精确匹配
            let btn = candidates.find(el => {
                if (!isVisible(el)) return false;
                const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                return exactPhrases.some(p => txt === p);
            });
            if (btn) return btn;

            // 2. role=button 且文本以 "See all" 开头并包含 reviews
            btn = candidates.find(el => {
                if (!isVisible(el)) return false;
                if (el.getAttribute('role') !== 'button') return false;
                const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
                return txt.startsWith('see all') && txt.includes('review');
            });
            if (btn) return btn;

            // 3. 通过内部 span 文本精确匹配 "See all reviews"
            const span = Array.from(document.querySelectorAll('span')).find(s => {
                const t = (s.textContent || '').trim().toLowerCase();
                return exactPhrases.includes(t) && isVisible(s);
            });
            if (span) {
                const parent = span.closest('[role="button"], button, a, div[tabindex]');
                if (parent) return parent;
                return span.parentElement;
            }

            return null;
        };

        const seeAllBtn = findSeeAllBtn();

        if (seeAllBtn) {
            seeAllBtn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(500);
            seeAllBtn.click();
            await sleep(2500);
            const m2 = document.querySelector('._2OaJDN8Y, [role="dialog"], [aria-modal="true"]');
            if (m2) return true;
        }

        const starArea = document.querySelector('.dkJHVAVx, .UadtlhRd, ._3Vcd6clk, [class*="rating-info"]');
        if (starArea) {
            starArea.click();
            await sleep(2500);
            return true;
        }
        return false;
    }

    function getModal() {
        const modals = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], ._2OaJDN8Y'));
        // 优先选取包含 review 卡片的 modal
        const withCards = modals.find(m => m.querySelector('._244ldJXl, [class*="review-item"], .review-card'));
        return withCards || modals[modals.length - 1] || null;
    }

    function findScrollableInModal(modal) {
        if (!modal) return null;
        // 走查 modal 内所有元素，找可滚动且 scrollHeight > clientHeight 的最深节点
        const all = modal.querySelectorAll('*');
        let best = null;
        let bestArea = 0;
        for (const el of all) {
            const cs = getComputedStyle(el);
            const oy = cs.overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight - el.clientHeight > 20) {
                const r = el.getBoundingClientRect();
                const area = r.width * r.height;
                if (area > bestArea) { best = el; bestArea = area; }
            }
        }
        return best;
    }

    function extractFromCard(card) {
        let text = '';
        const textEl = card.querySelector('._2EO0yd2j, [class*="review-text"], [class*="comment"]');
        if (textEl) text = (textEl.innerText || '').trim();
        let rating = null;
        const starEl = card.querySelector('[aria-label*="out of five stars"], [aria-label*="stars"]');
        if (starEl) {
            const aria = starEl.getAttribute('aria-label') || '';
            const m = aria.match(/(\d+(?:\.\d+)?)/);
            if (m) rating = parseFloat(m[1]);
        }
        const dateEl = card.querySelector('._1tSRIohB.oGEL6d3R, [class*="date"]');
        const date = (dateEl?.textContent || '').trim();
        return { text, rating, date, author: '' };
    }

    function getCards() {
        const modal = getModal();
        const container = modal || document;
        return Array.from(container.querySelectorAll('._244ldJXl, [class*="review-item"], .review-card'));
    }

    function getTotalReviewCountHint() {
        // 尝试从页面 / modal 标题里解析"54 reviews"
        const txt = (document.body.innerText || '');
        const matches = [...txt.matchAll(/(\d{1,5})\s*reviews?/gi)];
        if (matches.length === 0) return null;
        // 取最大值（通常是总数）
        const nums = matches.map(m => parseInt(m[1])).filter(n => n > 0 && n < 100000);
        return nums.length ? Math.max(...nums) : null;
    }

    const productName = getProductName();
    const totalHint = getTotalReviewCountHint();

    // 打开弹窗
    await openModal();
    await sleep(2500);

    // 用 WeakSet 按 DOM 节点去重 —— 同一张卡片不会被重复抓，
    // 但两张内容相同（如都写"Nice"、5★同月）的卡片会各自计入。
    const seenEls = new WeakSet();
    const collected = [];
    let pageCount = 0;
    let stagnantPages = 0;
    const realCap = totalHint ? Math.min(maxReviews, totalHint) : maxReviews;
    const maxPages = Math.max(80, Math.ceil(realCap / 3) + 40);

    function harvest() {
        const cards = getCards();
        let added = 0;
        for (const card of cards) {
            if (collected.length >= realCap) break;
            if (seenEls.has(card)) continue;
            const r = extractFromCard(card);
            if (!(r.text && r.text.length >= 1) && !r.rating) continue; // 与原过滤逻辑一致
            seenEls.add(card);
            collected.push(r);
            added++;
        }
        return added;
    }

    // 先把弹窗滚回顶部，再开始增量收集（避免遗漏前几条）
    {
        const modal0 = getModal();
        const sc0 = findScrollableInModal(modal0) || modal0;
        if (sc0) { sc0.scrollTop = 0; await sleep(800); }
        harvest(); // 抓取首屏
    }

    while (collected.length < realCap && pageCount < maxPages) {
        pageCount++;

        // --- 处理干扰弹窗（跳过主评论弹窗本身）---
        const popups = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
        for (const p of popups) {
            if (p.querySelector('._244ldJXl, [class*="review-item"], .review-card')) continue;
            const okBtn = Array.from(p.querySelectorAll('button, div')).find(el => {
                const t = (el.textContent || '').trim().toUpperCase();
                return t === 'OK' || t === 'ENTENDIDO' || t === 'ACEPTAR';
            });
            if (okBtn && okBtn.offsetParent !== null) { okBtn.click(); await sleep(600); }
        }

        const modal = getModal();
        const scrollable = findScrollableInModal(modal) ||
                           document.querySelector('[data-scroll="true"]') ||
                           modal;

        const beforeH = scrollable ? scrollable.scrollHeight : 0;
        const beforeTop = scrollable ? scrollable.scrollTop : 0;
        const viewport = scrollable ? scrollable.clientHeight : window.innerHeight;
        // 增量滚 ~80% 视口高度，让虚拟列表保留交界处卡片，避免顶部卡片被卸载
        const step = Math.max(400, Math.floor(viewport * 0.8));

        if (scrollable) {
            scrollable.scrollTop = beforeTop + step;
            scrollable.dispatchEvent(new Event('scroll', { bubbles: true }));
        } else {
            window.scrollBy(0, step);
        }
        await sleep(1200);

        // 抓取一次（捕获新进入视口的卡片）
        let added = harvest();

        // 判断是否到底：scrollTop 已经无法再增加
        const afterTop = scrollable ? scrollable.scrollTop : 0;
        const afterH = scrollable ? scrollable.scrollHeight : 0;
        const reachedBottom = scrollable && (afterTop + viewport >= afterH - 5);
        const heightGrew = afterH > beforeH + 10;

        if (reachedBottom && !heightGrew && added === 0) {
            stagnantPages++;
            // 给 lazy load 多一些时间，再尝试再次推到底触发 fetch
            if (scrollable) {
                scrollable.scrollTop = scrollable.scrollHeight;
                scrollable.dispatchEvent(new Event('scroll', { bubbles: true }));
            }
            await sleep(1500);
            added += harvest();
            if (stagnantPages >= 4) break;
        } else if (added === 0 && !heightGrew && afterTop === beforeTop) {
            // 完全没动也没新内容
            stagnantPages++;
            if (stagnantPages >= 5) break;
        } else {
            stagnantPages = 0;
        }

        if (totalHint && collected.length >= totalHint) break;
    }

    return {
        productName,
        reviews: collected.slice(0, maxReviews),
        debug: {
            platform: 'temu',
            pages: pageCount,
            上限: maxReviews,
            页面提示总数: totalHint,
            实际收集: collected.length,
            停滞页数: stagnantPages
        }
    };
};

// --- Mercado Libre scraper ---
const mercadolibreReviewScraperFunction = async (maxReviews) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const getPName = () => {
        const meta = document.querySelector('meta[property="og:title"], meta[name="twitter:title"]');
        if (meta && meta.content) {
            const t = meta.content.split('|')[0].split('-')[0].trim();
            if (t) return t;
        }
        const el = document.querySelector('.ui-pdp-title, [data-testid="pdp-title"], h1');
        if (el && el.innerText) return el.innerText.trim();
        return document.title.split('|')[0].split('-')[0].trim();
    };
    const productName = getPName();

    // 检查是否在独立的 noindex 评论页
    const isNoIndexPage = location.href.includes('/noindex/catalog/reviews/') || location.href.includes('/opiniones/');
    
    if (!isNoIndexPage) {
        // 尝试从多个源提取 domain_id
        let domainId = '';
        try {
            // 1) 从 dataLayer 找
            if (window.dataLayer && Array.isArray(window.dataLayer)) {
                const entry = window.dataLayer.find(i => i && i.domainId);
                if (entry) domainId = entry.domainId;
            }
            // 2) 如果没找到，从页面脚本中正则提取（针对 melidata 或其它配置对象）
            if (!domainId) {
                const scripts = Array.from(document.getElementsByTagName('script'));
                for (const s of scripts) {
                    const match = (s.textContent || '').match(/"domain_id"\s*:\s*"([^"]+)"/);
                    if (match) {
                        domainId = match[1];
                        break;
                    }
                }
            }
        } catch(e) {}

        // 提取 MLB/MLM ID
        const mlbMatch = location.href.match(/(ML[BM]-?\d{8,12})/i);
        if (mlbMatch) {
            const mlbId = mlbMatch[1].replace('-', '');
            // 严格按照你提供的格式构造，确保参数一个不少
            let baseUrl = `${location.origin}/noindex/catalog/reviews/${mlbId}?controlled=true`;
            if (domainId) {
                baseUrl += `&domain_id=${domainId}`;
            } else {
                // 如果实在没找到 domain_id，尝试用 ID 的前缀补全（例如 MLB- + ID 的分类猜想，但通常上面正则能抓到）
                console.warn("未能自动提取到 domain_id，尝试跳转可能失效");
            }
            
            console.log("执行精准格式跳转:", baseUrl, "商品名:", productName);
            return { navigateTo: baseUrl, productName: productName };
        }

        // 兜底：提取“查看全部”链接
        const phrases = ['mostrar todas las opiniones', 'ver todas las opiniones', 'ver todas as opiniões', 'ver todas as opinioes', 'mostrar todas as opiniões'];
        const candidates = Array.from(document.querySelectorAll('a, button, [role="link"]'));
        const linkEl = candidates.find(el => {
            const al = (el.getAttribute('aria-label') || '').toLowerCase();
            const tx = (el.innerText || el.textContent || '').trim().toLowerCase();
            const hr = el.href || '';
            return phrases.some(p => al.includes(p) || tx.includes(p)) && (hr.includes('/noindex/') || hr.includes('/opiniones/'));
        });
        
        if (linkEl && linkEl.href) {
            return { navigateTo: linkEl.href };
        }
    }

    
    // 强制解除美客多弹窗滚动锁定
    try {
        const style = document.createElement('style');
        style.innerHTML = `
            .andes-modal, .andes-modal__scroll, .andes-modal__content, .ui-pdp-iframe-reviews__container {
                overflow: auto !important;
                max-height: 100vh !important;
                -webkit-overflow-scrolling: touch !important;
            }
            #ui-pdp-iframe-reviews {
                height: 100vh !important;
                min-height: 600px !important;
                display: block !important;
            }
            body.andes-modal-opened {
                overflow: hidden !important; /* Keep background locked but allow modal internal scroll */
            }
        `;
        document.head.appendChild(style);
        
        // 尝试给 iframe 焦点
        const iframe = document.getElementById('ui-pdp-iframe-reviews');
        if (iframe) {
            iframe.focus();
            // 某些情况下需要点击一下才能激活滚动
            iframe.click();
        }
    } catch(e) {}


    const isVisible = (el) => {
        if (!el || !el.offsetParent) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };

    function isModalLike(el) {
        if (!el || el === document.body || el === document.documentElement) return false;
        if (el.matches && el.matches('[role="dialog"], [aria-modal="true"], [class*="andes-modal"], [class*="Modal"], [class*="dialog"]')) return true;
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || cs.position === 'absolute') {
            const z = parseInt(cs.zIndex || '0', 10);
            if (!isNaN(z) && z >= 100) return true;
        }
        return false;
    }

    function findModalAncestor(el) {
        let p = el ? el.parentElement : null;
        while (p && p !== document.body && p !== document.documentElement) {
            if (isModalLike(p)) return p;
            p = p.parentElement;
        }
        return null;
    }

    function isInsideModal(el) {
        return !!findModalAncestor(el);
    }

    function getModal() {
        const sections = Array.from(document.querySelectorAll('section[data-testid="reviews-desktop"], section.ui-review-capability-main'));
        // 1) 优先：真正包在 modal 容器里的 section
        const inModal = sections.filter(s => isInsideModal(s));
        const inModalWithCards = inModal.find(s => s.querySelector('article[data-testid="comment-component"], .ui-review-capability-comments__comment'));
        if (inModalWithCards) return inModalWithCards;
        if (inModal.length) return inModal[0];

        // 2) 兜底：直接找 modal 容器内的评论卡片
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="andes-modal"], [class*="Modal"]'));
        const dialogWithCards = dialogs.find(d => d.querySelector('article[data-testid="comment-component"], .ui-review-capability-comments__comment'));
        if (dialogWithCards) {
            // 优先返回 dialog 内的 review section，否则返回 dialog 本身
            return dialogWithCards.querySelector('section[data-testid="reviews-desktop"], section.ui-review-capability-main') || dialogWithCards;
        }
        return null;
    }

    function isScrollable(el) {
        if (!el || el === document.documentElement || el === document.body) return false;
        const cs = getComputedStyle(el);
        const oy = cs.overflowY;
        if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
        return el.scrollHeight > el.clientHeight + 20;
    }

    // 模拟鼠标滚轮（用户建议的保底方案）
    function simulateWheel(el, deltaY = 100) {
        if (!el) return;
        const event = new WheelEvent('wheel', {
            deltaY: deltaY,
            deltaMode: 0,
            bubbles: true,
            cancelable: true
        });
        el.dispatchEvent(event);
        // 如果是 iframe，尝试给其内部也发一个（如果同源的话，虽然美客多通常不是，但聊胜于无）
        try {
            if (el.tagName === 'IFRAME' && el.contentWindow) {
                el.contentWindow.postMessage({ type: 'SIMULATE_SCROLL', deltaY }, '*');
            }
        } catch(e) {}
    }

    // 直接根据"评论卡片"找滚动容器：从任一卡片往上走，第一个可滚动祖先就是要的
    function findScrollableForCards() {
        const cards = document.querySelectorAll('article[data-testid="comment-component"], article.ui-review-capability-comments__comment');
        if (!cards.length) return null;
        // 优先从靠后的卡片往上找（更接近 modal 底部）
        const probes = [cards[0], cards[Math.floor(cards.length / 2)], cards[cards.length - 1]];
        for (const c of probes) {
            let p = c.parentElement;
            while (p && p !== document.body && p !== document.documentElement) {
                if (isScrollable(p)) return p;
                p = p.parentElement;
            }
        }
        return null;
    }

    function findScrollableInModal(modal) {
        // 1) 通过卡片定位，最稳
        const fromCards = findScrollableForCards();
        if (fromCards) return fromCards;

        // 2) 退回基于 modal 的旧逻辑
        if (!modal) return null;
        if (isScrollable(modal)) return modal;
        let p = modal.parentElement;
        while (p && p !== document.body && p !== document.documentElement) {
            if (isScrollable(p)) return p;
            p = p.parentElement;
        }
        const all = modal.querySelectorAll('*');
        let best = null;
        let bestArea = 0;
        for (const el of all) {
            if (!isScrollable(el)) continue;
            const r = el.getBoundingClientRect();
            const area = r.width * r.height;
            if (area > bestArea) { best = el; bestArea = area; }
        }
        return best;
    }

    async function openModal() {
        // 已在 modal 内
        if (getModal() && getModal().querySelector('article[data-testid="comment-component"]')) return true;

        // 找触发按钮：先按 aria-label/文本精确匹配（最稳），再退回 data-testid
        const phrases = ['mostrar todas las opiniones', 'ver todas las opiniones', 'ver todas as opiniões', 'ver todas as opinioes', 'mostrar todas as opiniões'];
        const candidates = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        let btn = candidates.find(el => {
            if (!isVisible(el)) return false;
            const al = (el.getAttribute('aria-label') || '').toLowerCase();
            const tx = (el.innerText || el.textContent || '').trim().toLowerCase();
            return phrases.some(p => al === p || tx === p);
        });
        if (!btn) {
            btn = candidates.find(el => {
                if (!isVisible(el)) return false;
                const tx = (el.innerText || el.textContent || '').trim().toLowerCase();
                return phrases.some(p => tx.includes(p));
            });
        }
        if (!btn) {
            // 仅在能确认所在区块是评论区时，才允许 fallback 到 data-testid="see-more"
            const seeMore = document.querySelector('button[data-testid="see-more"]');
            if (seeMore) {
                const ctx = seeMore.closest('section, [class*="review"], [class*="opin"], [class*="reviews"]');
                if (ctx && /opin|review|coment/i.test(ctx.className || '')) btn = seeMore;
            }
        }

        if (btn) {
            btn.scrollIntoView({ behavior: 'instant', block: 'center' });
            await sleep(500);
            btn.click();
            await sleep(2500);
            if (getModal()) return true;
        }

        // 兜底：旧版独立评论页
        if (location.href.includes('/opiniones/')) {
            window.scrollTo(0, document.body.scrollHeight * 0.4);
            await sleep(1500);
            return true;
        }
        return false;
    }

    function extractFromCard(card) {
        let text = '';
        const textEl = card.querySelector('[data-testid="comment-content-component"], .ui-review-capability-comments__comment__content, p[class*="comment__content"]');
        if (textEl) text = (textEl.innerText || '').trim();

        let rating = null;
        // 隐藏可读文本："Calificación X de 5" / "Avaliação X de 5"
        const ratingHidden = Array.from(card.querySelectorAll('.andes-visually-hidden, p.andes-visually-hidden'))
            .map(el => (el.textContent || '').trim())
            .find(t => /Calificaci[oó]n|Avalia[cç][aã]o/i.test(t));
        if (ratingHidden) {
            const m = ratingHidden.match(/(\d+(?:\.\d+)?)/);
            if (m) rating = parseFloat(m[1]);
        }
        if (rating === null) {
            // 数星法：填充星数 = 全 star 数 - empty star 数
            const filled = card.querySelectorAll('.ui-review-capability-comments__comment__rating__star:not(.ui-review-capability-comments__comment__rating__star-empty)');
            if (filled.length > 0 && filled.length <= 5) rating = filled.length;
        }

        // 日期：comment__date 通常有两个，第一个是国家/地区，第二个才是日期
        const dateEls = card.querySelectorAll('.ui-review-capability-comments__comment__date');
        let date = '';
        if (dateEls.length >= 2) {
            date = (dateEls[dateEls.length - 1].textContent || '').trim();
        } else if (dateEls.length === 1) {
            date = (dateEls[0].textContent || '').trim();
        }

        return { text, rating, date, author: '' };
    }

    function getCards() {
        const modal = getModal();
        const root = modal || document;
        // 增加对独立页特有结构的兼容
        return Array.from(root.querySelectorAll('article[data-testid="comment-component"], article[data-testid*="review-component"], article.ui-review-capability-comments__comment, .ui-review-capability-comments__comment'));
    }

    function getTotalReviewCountHint() {
        // .total-opinion 里写的是评论数，比如 "12 comentarios"
        const el = document.querySelector('.total-opinion');
        if (el) {
            const m = (el.textContent || '').match(/(\d+)/);
            if (m) return parseInt(m[1]);
        }
        // 兜底：从全文提取 "X comentarios" / "X comentários"
        const txt = (document.body.innerText || '');
        const m = txt.match(/(\d{1,5})\s*coment[aá]rios?/i);
        if (m) return parseInt(m[1]);
        return null;
    }

    if (!isNoIndexPage) {
        await openModal();
        await sleep(1500);
    } else {
        // 在独立页，尝试滚一下触发首屏渲染
        window.scrollTo(0, 500);
        await sleep(1000);
    }

    const totalHint = getTotalReviewCountHint();

    // WeakSet 按 DOM 节点去重，允许内容相同但属于不同卡片的评论各自计入
    const seenEls = new WeakSet();
    const collected = [];
    let pageCount = 0;
    let stagnantPages = 0;
    const realCap = totalHint ? Math.min(maxReviews, totalHint) : maxReviews;
    const maxPages = isNoIndexPage ? Math.max(150, Math.ceil(realCap / 1) + 50) : Math.max(60, Math.ceil(realCap / 3) + 30);

    function harvest() {
        const cards = getCards();
        let added = 0;
        for (const card of cards) {
            if (collected.length >= realCap) break;
            if (seenEls.has(card)) continue;
            const r = extractFromCard(card);
            if (!(r.text && r.text.length >= 1) && !r.rating) continue;
            seenEls.add(card);
            collected.push(r);
            added++;
        }
        return added;
    }

    // 滚回顶部，先抓首屏
    {
        const m0 = getModal();
        const sc0 = findScrollableInModal(m0);
        if (sc0) { sc0.scrollTop = 0; await sleep(800); }
        harvest();
    }

    // 如果首屏已经把所有评论都抓到了，直接结束（ML 经常一次性渲染所有 51 条）
    if (totalHint && collected.length >= totalHint) {
        return {
            productName,
            reviews: collected.slice(0, maxReviews),
            debug: {
                platform: 'mercadolibre',
                pages: 0,
                上限: maxReviews,
                页面提示总数: totalHint,
                实际收集: collected.length,
                备注: '首屏即抓全'
            }
        };
    }

    let noScrollableHits = 0;
    while (collected.length < realCap && pageCount < maxPages) {
        pageCount++;

        const modal = getModal();
        let scrollable = findScrollableInModal(modal);
        
        if (!scrollable && isNoIndexPage) {
            scrollable = document.documentElement;
        }

        if (!scrollable) {
            // 没找到弹窗的可滚动容器 —— 绝不去滚背景页（那只会滚到推荐区）
            // 再尝试 harvest 一次（可能 modal 还在加载 / DOM 已更新）
            await sleep(800);
            const got = harvest();
            if (got === 0) {
                noScrollableHits++;
                if (noScrollableHits >= 3) break;
            } else {
                noScrollableHits = 0;
            }
            continue;
        }
        noScrollableHits = 0;

        const beforeH = scrollable.scrollHeight;
        const beforeTop = scrollable.scrollTop;
        const viewport = scrollable.clientHeight;
        const step = Math.max(400, Math.floor(viewport * 0.8));

        scrollable.scrollTop = beforeTop + step;
        scrollable.dispatchEvent(new Event('scroll', { bubbles: true }));
        // 增加：保底模拟滚轮事件，防止 scrollTop 赋值失效
        simulateWheel(scrollable, step);
        const iframe = document.getElementById('ui-pdp-iframe-reviews');
        if (iframe) simulateWheel(iframe, step);
        
        await sleep(1200);

        let added = harvest();

        const afterTop = scrollable.scrollTop;
        const afterH = scrollable.scrollHeight;
        const reachedBottom = (afterTop + viewport >= afterH - 5);
        const heightGrew = afterH > beforeH + 10;
        const scrolledForward = afterTop > beforeTop;

        if (reachedBottom && !heightGrew && added === 0) {
            stagnantPages++;
            scrollable.scrollTop = scrollable.scrollHeight;
            scrollable.dispatchEvent(new Event('scroll', { bubbles: true }));
            await sleep(1500);
            added += harvest();
            if (stagnantPages >= 4) break;
        } else if (added === 0 && !heightGrew && !scrolledForward) {
            stagnantPages++;
            if (stagnantPages >= 5) break;
        } else {
            stagnantPages = 0;
        }

        if (totalHint && collected.length >= totalHint) break;
    }

    return {
        productName,
        reviews: collected.slice(0, maxReviews),
        debug: {
            platform: 'mercadolibre',
            pages: pageCount,
            上限: maxReviews,
            页面提示总数: totalHint,
            实际收集: collected.length,
            停滞页数: stagnantPages
        }
    };
};

// Route VOC by actual marketplace host. Unknown hosts must not fall through to Shopee.
function getScraperForUrl(url) {
    const host = new URL(url).hostname.toLowerCase();
    const matches = domain => host===domain || host.endsWith('.'+domain);
    if (matches('walmart.com') || matches('ebay.com')) return globalThis.IantoUsReviewScraper;
    if (host.includes('tiktok') || host.includes('tiktokglobalshop')) return tiktokReviewScraperFunction;
    if (host.includes('lazada')) return lazadaReviewScraperFunction;
    if (host.includes('tokopedia')) return tokopediaReviewScraperFunction;
    if (host.includes('amazon')) return amazonReviewScraperFunction;
    if (host.includes('aliexpress')) return aliexpressReviewScraperFunction;
    if (host.includes('mercadolibre') || host.includes('mercadolivre')) return mercadolibreReviewScraperFunction;
    if (host.includes('temu')) return temuReviewScraperFunction;
    if (host.includes('shopee')) return shopeeReviewScraperFunction;
    return null;
}

// 监听 scrapeReviews 通道（独立 listener，不影响其他通道）
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action !== "scrapeReviews") return;
    sendResponse({ started: true });

    const { tasks, jobId, visible } = request;
    const storageKey = 'reviewScrape_' + jobId;

    // 等待标签页 complete（与 scrapeTitles 相同的双保险写法）
    function waitTabComplete(tabId, maxMs) {
        return new Promise(resolve => {
            let done = false;
            const finish = () => { if (!done) { done = true; resolve(); } };
            chrome.tabs.get(tabId, tab => {
                if (chrome.runtime.lastError || tab?.status === 'complete') { finish(); return; }
                const onUpdated = (tid, info) => {
                    if (tid === tabId && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(onUpdated);
                        clearInterval(poll);
                        finish();
                    }
                };
                chrome.tabs.onUpdated.addListener(onUpdated);
                const poll = setInterval(() => {
                    chrome.tabs.get(tabId, t => {
                        if (chrome.runtime.lastError || t?.status === 'complete') {
                            clearInterval(poll);
                            chrome.tabs.onUpdated.removeListener(onUpdated);
                            finish();
                        }
                    });
                }, 2000);
                setTimeout(() => {
                    clearInterval(poll);
                    chrome.tabs.onUpdated.removeListener(onUpdated);
                    finish();
                }, maxMs);
            });
        });
    }

    (async () => {
        const results = {};
        const keepAlive = setInterval(() => chrome.storage.local.get('__ka_voc'), 2000);

        try {
            // 建一个标签组装载所有评论页
            const tabIds = [];

            // 顺序抓取，避免太多 tab 同时打开互相影响
            for (const task of tasks) {
                let tab;
                try {
                    let targetUrl = task.url;
                    // TikTok 强制转 Mode C
                    if ((targetUrl.includes('tiktok') || targetUrl.includes('tiktokglobalshop')) && typeof buildTikTokProductUrl === 'function') {
                        const modeCUrl = buildTikTokProductUrl(targetUrl, "DOMAIN_C_FIXED");
                        if (modeCUrl && modeCUrl !== targetUrl) {
                            targetUrl = modeCUrl;
                            console.log("TikTok 评论抓取: 已将 URL 强制重定向至 Mode C", targetUrl);
                        }
                    }

                    // Amazon URL 跳转：从商品页跳转到产品评论列表页
                    if (targetUrl.includes('amazon.') && targetUrl.match(/\/(dp|gp\/product)\/(B[A-Z0-9]{9})/)) {
                        const m = targetUrl.match(/\/(dp|gp\/product)\/(B[A-Z0-9]{9})/);
                        if (m) {
                            const urlObj = new URL(targetUrl);
                            urlObj.pathname = `/product-reviews/${m[2]}`;
                            urlObj.search = '?reviewerType=all_reviews';
                            targetUrl = urlObj.href;
                        }
                    }

                    // Mercado Libre: 保持产品页原 URL，由 scraper 在页面上点击 "Ver mas opiniones" 打开弹窗
                    tab = await chrome.tabs.create({ url: targetUrl, active: visible });
                    tabIds.push(tab.id);

                    // 把所有评论 tab 归到一个组，方便识别和管理
                    try {
                        const groups = await chrome.tabGroups.query({ title: 'VOC 评论抓取' });
                        if (groups && groups.length > 0) {
                            await chrome.tabs.group({ tabIds: [tab.id], groupId: groups[0].id });
                        } else {
                            const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
                            await chrome.tabGroups.update(groupId, {
                                title: 'VOC 评论抓取', color: 'purple', collapsed: !visible
                            });
                        }
                    } catch (e) {}

                    await waitTabComplete(tab.id, 30000);
                    await new Promise(r => setTimeout(r, 4500)); // SPA 渲染缓冲

                    // Follow only explicit product-review pages; preserve reviews gathered before each navigation.
                    const scraperFunc = getScraperForUrl(task.url);
                    if (!scraperFunc) throw Error('VOC 暂不支持该平台的商品评论抓取');
                    const limit = Math.max(1, Math.min(1000, Number(task.max) || 200));
                    const reviews = [], seenReviews = new Set(), visited = new Set([new URL(targetUrl).href]);
                    let out = {productName:'',reviews:[]}, productName = '', hops = 0;
                    for (let pass = 0; pass < 40; pass++) {
                        const res = await chrome.scripting.executeScript({
                            target: { tabId: tab.id }, func: scraperFunc, args: [Math.max(1, limit - reviews.length)]
                        });
                        out = res?.[0]?.result || {productName:'',reviews:[]};
                        if (out.productName && (!productName || !/^(?:product reviews|opiniones del producto|opiniões do produto)$/i.test(out.productName.trim()))) {
                            productName = out.productName;
                        }
                        for (const review of out.reviews || []) {
                            const key = [review.text||'',review.rating??'',review.date||'',review.author||''].join('|');
                            if (seenReviews.has(key)) continue;
                            seenReviews.add(key); reviews.push(review);
                            if (reviews.length>=limit) break;
                        }
                        if (!out.navigateTo || reviews.length>=limit) break;
                        const nextUrl = new URL(out.navigateTo, targetUrl);
                        const initial = new URL(task.url), initialHost = initial.hostname.toLowerCase(), nextHost = nextUrl.hostname.toLowerCase();
                        const marketplace = initialHost.replace(/^(?:www|lista|listado|m)\./,'');
                        if (!['http:','https:'].includes(nextUrl.protocol) ||
                            !(nextHost===marketplace || nextHost.endsWith('.'+marketplace))) {
                            out.debug = {...out.debug, navigationWarning:'已拒绝跳转到其他平台'};
                            break;
                        }
                        if (visited.has(nextUrl.href)) break;
                        visited.add(nextUrl.href);hops++;
                        targetUrl = nextUrl.href;
                        await chrome.tabs.update(tab.id, { url: targetUrl });
                        await waitTabComplete(tab.id, 30000);
                        await new Promise(r=>setTimeout(r,3500));
                    }
                    results[task.url] = {...out, productName:productName || out.productName || '',
                        reviews:reviews.slice(0,limit), debug:{...out.debug, navigations:hops, actualReturned:reviews.length}};

                } catch (e) {
                    results[task.url] = { productName: '', reviews: [], error: e.message };
                }
                // 评论 tab 抓完后保留，方便用户检查页面和数据
            }
        } finally {
            clearInterval(keepAlive);
            await chrome.storage.local.set({
                [storageKey]: { success: true, results }
            });
        }
    })();

    return true; // 异步响应
});

// ============================================================================
// AI Photo Editor · Gemini / ChatGPT / Leopard X 网页作图通道
// 本通道只复用 Chrome 当前网页的登录状态，不读取或保存账号密码/Cookie。
// ============================================================================
const WEB_IMAGE_PROTOCOL = 2;
const WEB_IMAGE_BUILD = '2026-11-06.1';
// Workers renew this lease while they are queued or generating. A fixed short
// timeout cannot represent a real image task, which may legitimately take many
// minutes. Missing tabs are released immediately; silent workers are released
// only after the heartbeat lease expires.
const WEB_IMAGE_LEASE_MS = 90 * 1000;
const WEB_IMAGE_PROVIDERS = {
    gemini: {
        stateKey: 'geminiWebAutomationTab',
        openUrl: 'https://gemini.google.com/app',
        urlPrefix: 'https://gemini.google.com/',
        isConversationUrl: url => /^https:\/\/gemini\.google\.com\/(?:u\/\d+\/)?app\/[^/?#]+/i.test(String(url || '')),
        pingAction: 'geminiWebWorkerPing',
        runAction: 'runGeminiWebImageJob',
        label: 'Gemini'
    },
    chatgpt: {
        stateKey: 'chatgptWebAutomationTab',
        openUrl: 'https://chatgpt.com/',
        urlPrefix: 'https://chatgpt.com/',
        isConversationUrl: url => /^https:\/\/chatgpt\.com\/(?:g\/[^/]+\/)?c\/[^/?#]+/i.test(String(url || '')),
        pingAction: 'chatgptWebWorkerPing',
        runAction: 'runChatGPTWebImageJob',
        label: 'ChatGPT'
    },
    leopard: {
        stateKey: 'leopardWebAutomationTab',
        openUrl: 'https://leopard-x.memofun.net/',
        urlPrefix: 'https://leopard-x.memofun.net/',
        isConversationUrl: url => /^https:\/\/leopard-x\.memofun\.net\/c\//i.test(String(url || '')),
        pingAction: 'leopardWebWorkerPing',
        runAction: 'runLeopardWebImageJob',
        label: 'Leopard X'
    }
};

function geminiWebDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function geminiWebWaitTabComplete(tabId, timeoutMs = 45000) {
    return new Promise(resolve => {
        let done = false;
        let timer = null;
        const finish = () => {
            if (done) return;
            done = true;
            chrome.tabs.onUpdated.removeListener(onUpdated);
            if (timer) clearTimeout(timer);
            resolve();
        };
        const onUpdated = (updatedTabId, changeInfo) => {
            if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
        };
        chrome.tabs.onUpdated.addListener(onUpdated);
        timer = setTimeout(finish, timeoutMs);
        chrome.tabs.get(tabId).then(tab => {
            if (tab?.status === 'complete') finish();
        }).catch(finish);
    });
}

function geminiWebSendToTab(tabId, message) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, message, response => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}

async function geminiWebWaitForWorker(tabId, providerConfig) {
    let lastError = null;
    for (let attempt = 0; attempt < 30; attempt++) {
        try {
            const response = await geminiWebSendToTab(tabId, { action: providerConfig.pingAction });
            if (response?.ready) {
                if (response.protocolVersion !== WEB_IMAGE_PROTOCOL || response.workerBuild !== WEB_IMAGE_BUILD) {
                    throw Object.assign(new Error('[WORKER_VERSION] ' + providerConfig.label + ' 页面执行脚本与后台不兼容：worker=' + (response.workerBuild || 'legacy') + ', background=' + WEB_IMAGE_BUILD), { incompatible: true });
                }
                return response;
            }
        } catch (error) {
            if (error.incompatible) throw error;
            lastError = error;
            // 关键自愈：如果插件刚重载过，旧标签页的 Content Script 会变成僵尸；第 2 次尝试直接强制刷新该标签页，完成自愈！
            if (attempt === 2) {
                try {
                    console.log('[Ianto] 检测到标签页可能因扩展重载失联，正在自动刷新标签页完成重连...', tabId);
                    await chrome.tabs.reload(tabId);
                    await geminiWebWaitTabComplete(tabId);
                    await geminiWebDelay(2000);
                } catch (_) {}
            }
        }
        await geminiWebDelay(500);
    }
    throw new Error('Ianto 无法连接 ' + providerConfig.label + ' 页面' + (lastError ? '：' + lastError.message : ''));
}

async function geminiWebEnsureTab(provider, conversationKey, resumeUrl) {
    const providerConfig = WEB_IMAGE_PROVIDERS[provider];
    if (!providerConfig) throw new Error('[PROVIDER] 未知出图渠道：' + provider);
    const shouldActivate = true;
    const saved = (await chrome.storage.local.get(providerConfig.stateKey))[providerConfig.stateKey] || {};
    const effectiveResumeUrl = resumeUrl || (saved.conversationKey === conversationKey ? saved.resumeUrl : null);
    const openUrl = effectiveResumeUrl && providerConfig.isConversationUrl(effectiveResumeUrl) ? effectiveResumeUrl : providerConfig.openUrl;
    let tab = null;
    if (saved.tabId) {
        try { tab = await chrome.tabs.get(saved.tabId); } catch (_) {}
    }

    if (!tab) {
        tab = await chrome.tabs.create({ url: openUrl, active: shouldActivate });
        try {
            const groupId = await chrome.tabs.group({ tabIds: tab.id });
            await chrome.tabGroups.update(groupId, { title: 'Ianto 🤖', color: 'cyan' });
        } catch (e) {}
        await chrome.storage.local.set({
            [providerConfig.stateKey]: { tabId: tab.id, conversationKey, ...(providerConfig.isConversationUrl(openUrl) ? { resumeUrl: openUrl } : {}) }
        });
        await geminiWebWaitTabComplete(tab.id);
        await geminiWebDelay(2000);
    } else if (saved.conversationKey !== conversationKey || !String(tab.url || '').startsWith(providerConfig.urlPrefix) || (effectiveResumeUrl && tab.url !== openUrl)) {
        tab = await chrome.tabs.update(tab.id, { url: openUrl, active: shouldActivate });
        try {
            const groupId = await chrome.tabs.group({ tabIds: tab.id });
            await chrome.tabGroups.update(groupId, { title: 'Ianto 🤖', color: 'cyan' });
        } catch (e) {}
        await chrome.storage.local.set({
            [providerConfig.stateKey]: { tabId: tab.id, conversationKey, ...(providerConfig.isConversationUrl(openUrl) ? { resumeUrl: openUrl } : {}) }
        });
        await geminiWebWaitTabComplete(tab.id);
        await geminiWebDelay(2000);
    }

    if (shouldActivate) await geminiWebActivateTab(tab.id);
    await geminiWebWaitForWorker(tab.id, providerConfig);
    return tab;
}

const geminiWebActiveJobs = new Map();
const geminiWebSessionKey = jobId => 'webImageJob_' + jobId;
async function geminiWebGetJob(jobId) {
    return geminiWebActiveJobs.get(jobId) || (await chrome.storage.session.get(geminiWebSessionKey(jobId)))[geminiWebSessionKey(jobId)];
}
async function geminiWebSaveJob(jobId, info) {
    const saved = { ...info, updatedAt: Date.now() };
    geminiWebActiveJobs.set(jobId, saved);
    await chrome.storage.session.set({ [geminiWebSessionKey(jobId)]: saved });
    return saved;
}

async function geminiWebRemoveJob(jobId) {
    geminiWebActiveJobs.delete(jobId);
    await chrome.storage.session.remove(geminiWebSessionKey(jobId));
}

async function geminiWebForgetAutomationTab(provider, tabId) {
    const providerConfig = WEB_IMAGE_PROVIDERS[provider];
    if (!providerConfig) return;
    const saved = (await chrome.storage.local.get(providerConfig.stateKey))[providerConfig.stateKey];
    if (saved?.tabId === tabId) {
        const retained = { ...saved };
        delete retained.tabId;
        await chrome.storage.local.set({ [providerConfig.stateKey]: retained });
    }
}

async function geminiWebJobTabExists(jobInfo) {
    if (!Number.isInteger(jobInfo?.automationTabId)) return false;
    try {
        const tab = await chrome.tabs.get(jobInfo.automationTabId);
        return !!tab && String(tab.url || '').startsWith(WEB_IMAGE_PROVIDERS[jobInfo.provider]?.urlPrefix || 'about:blank');
    } catch (_) {
        return false;
    }
}

async function geminiWebActivateTab(tabId) {
    if (!Number.isInteger(tabId)) throw new Error('待激活的标签页无效');
    const tab = await chrome.tabs.get(tabId);
    if (!tab) throw new Error('找不到待激活的标签页');
    if (!tab.active) await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId) {
        try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) {}
    }
    return tab;
}

async function geminiWebActivateForJob(request, sender) {
    const automationTabId = sender.tab?.id;
    const automationUrl = String(sender.tab?.url || '');
    const originTabId = Number.isInteger(request.originTabId) ? request.originTabId : null;
    const provider = automationUrl.startsWith('https://gemini.google.com/')
        ? 'gemini'
        : automationUrl.startsWith('https://leopard-x.memofun.net/') ? 'leopard'
        : (/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\//.test(automationUrl) ? 'chatgpt' : null);
    if (!automationTabId || !provider || !originTabId || !request.jobId || request.provider !== provider) {
        throw new Error('[ACTIVATE_CONTEXT] 渠道=' + (request.provider || 'missing') + '，页面=' + (provider || 'unknown') + '，任务=' + (request.jobId || 'missing') + '，编辑器标签=' + originTabId + '，后台=' + WEB_IMAGE_BUILD);
    }

    const originTab = await chrome.tabs.get(originTabId);
    const originUrl = String(originTab?.url || '');
    if (!/^http:\/\/(?:localhost|127\.0\.0\.1):3000\//.test(originUrl)) {
        throw new Error('找不到 AI Photo Editor 标签页');
    }

    const jobInfo = await geminiWebGetJob(request.jobId);
    if (!jobInfo || jobInfo.provider !== provider || jobInfo.originTabId !== originTabId || jobInfo.automationTabId !== automationTabId) throw new Error('[ACTIVATE_JOB] 当前任务与标签归属不一致：' + provider + ' / ' + request.jobId);
    jobInfo.originTabId = originTabId;
    jobInfo.provider = provider;
    jobInfo.originWindowId = originTab.windowId;
    jobInfo.automationTabId = automationTabId;
    await geminiWebSaveJob(request.jobId, jobInfo);

    await geminiWebActivateTab(automationTabId);
}

async function geminiWebStoreResult(jobId, result) {
    const jobInfo = await geminiWebGetJob(jobId);
    // A cancelled/replaced task no longer owns a result slot. Ignore a late
    // worker response instead of reviving it and overwriting the new run.
    if (!jobInfo) return false;
    const canResumeMaterialConversation = jobInfo.uploadMode === 'continuous'
        && result?.conversationUrl
        && (result?.materialRegistered || jobInfo.materialOnly);
    if (canResumeMaterialConversation) {
        const providerConfig = WEB_IMAGE_PROVIDERS[jobInfo.provider];
        if (providerConfig) {
            const saved = (await chrome.storage.local.get(providerConfig.stateKey))[providerConfig.stateKey] || {};
            if (saved.conversationKey === jobInfo.conversationKey && providerConfig.isConversationUrl(result.conversationUrl)) {
                await chrome.storage.local.set({ [providerConfig.stateKey]: { ...saved, resumeUrl: result.conversationUrl } });
            }
        }
    }
    if (jobInfo?.originTabId) {
        try {
            chrome.tabs.sendMessage(jobInfo.originTabId, {
                action: 'geminiWebJobResultDirect',
                jobId,
                result
            }, () => { void chrome.runtime.lastError; });
        } catch (_) {}
    }
    await geminiWebRemoveJob(jobId);
    const storageKey = 'geminiWebResult_' + jobId;
    await chrome.storage.local.set({ [storageKey]: result });

    // 不要每张图完成后都切回编辑器：保持网页作图标签页在前端，避免后台节流导致 ChatGPT / Gemini 假死。
    if (jobInfo?.originTabId && jobInfo?.restoreEditor) {
        try { await geminiWebActivateTab(jobInfo.originTabId); } catch (_) {}
    }
    return true;
}

const webImageDispatchLocks = new Map();
function geminiWebDispatchJob(request, originTabId) {
    const previous = webImageDispatchLocks.get(request.provider) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => geminiWebDispatchReservedJob(request, originTabId));
    webImageDispatchLocks.set(request.provider, next);
    next.finally(() => { if (webImageDispatchLocks.get(request.provider) === next) webImageDispatchLocks.delete(request.provider); }).catch(() => {});
    return next;
}
async function webImageBlobToDataUrl(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    const base64 = btoa(binary);
    return `data:${blob.type || 'image/png'};base64,${base64}`;
}

async function geminiWebDispatchReservedJob(request, originTabId) {
    const provider = request.provider;
    if (!WEB_IMAGE_PROVIDERS[provider]) throw new Error('[PROVIDER] 未指定有效出图渠道');
    if (request.protocolVersion !== WEB_IMAGE_PROTOCOL || request.bridgeBuild !== WEB_IMAGE_BUILD) throw new Error('[CLIENT_VERSION] 网页桥接与后台不兼容，后台=' + WEB_IMAGE_BUILD + '，桥接=' + (request.bridgeBuild || 'legacy'));

    const sessions = Object.entries(await chrome.storage.session.get(null));
    // 自动自愈：标签已经关闭时立即释放；仍有标签但心跳停止时，
    // 等待完整租约后释放并重建，避免永久 PROVIDER_BUSY。
    for (const [key, value] of sessions) {
        if (key.startsWith('webImageJob_')) {
            const lastSeen = Number(value.updatedAt || value.createdAt || 0);
            const tabExists = await geminiWebJobTabExists(value);
            const isExpired = !lastSeen || (Date.now() - lastSeen) > WEB_IMAGE_LEASE_MS;
            if (!tabExists || isExpired) {
                if (value.jobId) await geminiWebRemoveJob(value.jobId);
                else await chrome.storage.session.remove(key);
                await geminiWebForgetAutomationTab(value.provider, value.automationTabId);
                if (tabExists && isExpired) {
                    try { await chrome.tabs.remove(value.automationTabId); } catch (_) {}
                }
            }
        }
    }

    const currentSessions = Object.entries(await chrome.storage.session.get(null));
    const occupied = currentSessions.find(([key, value]) => key.startsWith('webImageJob_') && value.provider === provider && (Date.now() - Number(value.updatedAt || value.createdAt || 0)) <= WEB_IMAGE_LEASE_MS);
    if (occupied) {
        const occupiedJob = occupied[1];
        if (occupiedJob.originTabId === originTabId && occupiedJob.jobId) {
            // A new explicit request from the same editor means the user is
            // retrying or switching providers. Retire the orphan/current DOM
            // run so it cannot keep this batch permanently blocked.
            await geminiWebCancelJob(occupiedJob.jobId, originTabId);
        } else {
            throw new Error('[PROVIDER_BUSY] ' + WEB_IMAGE_PROVIDERS[provider].label + ' 正在执行另一项任务，请等它完成；未切换或覆盖该任务');
        }
    }
    if (request?.jobId) {
        await geminiWebSaveJob(request.jobId, { jobId: request.jobId, originTabId, provider, conversationKey: request.conversationKey, uploadMode: request.uploadMode, materialOnly: !!request.materialOnly, createdAt: Date.now(), restoreEditor: !!request.restoreEditor });
    }
    try {
        const providerConfig = WEB_IMAGE_PROVIDERS[provider];
        const continuous = request.uploadMode === 'continuous';
        const journal = provider === 'leopard' && request.taskKey ? (await chrome.storage.local.get('leopardImageTask_' + request.taskKey))['leopardImageTask_' + request.taskKey] : null;
        if (journal && ['submitting','submitted','done'].includes(journal.phase) && !String(journal.conversationUrl || '').startsWith('https://leopard-x.memofun.net/c/')) throw new Error('[SUBMISSION_UNKNOWN] Leopard X 任务可能已提交但尚未记录会话地址，请先在网站确认，系统未重复发送');
        let resumeUrl=journal?.conversationUrl;
        if (continuous && !resumeUrl) {
            const saved=(await chrome.storage.local.get(providerConfig.stateKey))[providerConfig.stateKey];
            if (saved?.conversationKey === request.conversationKey) resumeUrl=saved.resumeUrl || null;
        }
        if (provider === 'leopard' && /\/c\/WEB(?::|%3A)/i.test(String(resumeUrl || ''))) {
            const saved=(await chrome.storage.local.get(providerConfig.stateKey))[providerConfig.stateKey];
            if (saved?.conversationKey === request.taskKey) {
                try {
                    const current=await chrome.tabs.get(saved.tabId);
                    if (String(current.url || '').startsWith(providerConfig.urlPrefix+'c/') && !/\/c\/WEB(?::|%3A)/i.test(current.url)) resumeUrl=current.url;
                } catch (_) {}
            }
        }
        const tab = await geminiWebEnsureTab(provider, provider === 'leopard' && !continuous ? String(request.taskKey || request.jobId) : String(request.conversationKey || 'default'), resumeUrl);
        if (continuous) {
            const worker = await geminiWebSendToTab(tab.id, { action: providerConfig.pingAction });
            if (!worker?.continuousMaterials) throw new Error('[WORKER_VERSION] 连续模式执行脚本未加载，请刷新作图网页或关闭该标签后重试');
        }
        const jobInfo = await geminiWebGetJob(request.jobId);
        if (!jobInfo) throw new Error('[JOB_CANCELLED] 网页作图任务已由新的操作接管');
        jobInfo.automationTabId = tab.id; jobInfo.restoreEditor = !!request.restoreEditor; await geminiWebSaveJob(request.jobId, jobInfo);
        // Register ownership first, then perform the one authoritative activation. The page
        // worker must not request a second activation for the same job: that redundant
        // round-trip was able to reject an otherwise valid Gemini/ChatGPT task.
        await geminiWebActivateTab(tab.id);
        const activeTab = await chrome.tabs.get(tab.id);
        if (!activeTab?.active) throw new Error('[ACTIVATE_TAB] ' + providerConfig.label + ' 标签页没有进入活动状态');
        const ownedJob = await geminiWebGetJob(request.jobId);
        if (!ownedJob || ownedJob.automationTabId !== tab.id) throw new Error('[JOB_CANCELLED] 网页作图任务已由新的操作接管');
        const response = await geminiWebSendToTab(tab.id, {
            action: providerConfig.runAction,
            provider,
            protocolVersion: WEB_IMAGE_PROTOCOL,
            backgroundBuild: WEB_IMAGE_BUILD,
            jobId: request.jobId,
            originTabId,
            prompt: request.prompt,
            images: request.images,
            uploadMode: request.uploadMode,
            materialKey: request.materialKey,
            materialRules: request.materialRules,
            materialOnly: !!request.materialOnly,
            materialIndex: request.materialIndex,
            materialCount: request.materialCount,
            materialRole: request.materialRole,
            materialManifest: request.materialManifest,
            materialFinalRules: !!request.materialFinalRules,
            aspectRatio: request.aspectRatio,
            siteModel: request.siteModel,
            modelOptions: request.modelOptions,
            taskKey: request.taskKey,
            conversationKey: request.conversationKey,
            taskLabel: request.taskLabel
        });
        if (!response?.accepted) throw new Error(response?.error || providerConfig.label + ' 页面未接受作图任务');
        return { started: true, jobId: request.jobId };
    } catch (error) {
        await geminiWebStoreResult(request.jobId, {
            success: false,
            error: error?.message || 'Ianto 无法启动网页作图任务'
        });
        throw error;
    }
}

async function geminiWebCancelJob(jobId, originTabId) {
    const jobInfo = await geminiWebGetJob(jobId);
    if (!jobInfo || jobInfo.originTabId !== originTabId) return { cancelled: false };
    await geminiWebRemoveJob(jobId);
    await geminiWebForgetAutomationTab(jobInfo.provider, jobInfo.automationTabId);
    if (Number.isInteger(jobInfo.automationTabId)) {
        // Closing the managed automation tab is the only reliable way to stop a
        // DOM worker that is already waiting inside a third-party generation.
        // The next request recreates the correct provider page automatically.
        try { await chrome.tabs.remove(jobInfo.automationTabId); } catch (_) {}
    }
    return { cancelled: true };
}

chrome.tabs.onRemoved.addListener((tabId) => {
    (async () => {
        for (const provider of Object.keys(WEB_IMAGE_PROVIDERS)) {
            await geminiWebForgetAutomationTab(provider, tabId);
        }
        const sessions = Object.values(await chrome.storage.session.get(null));
        const affected = sessions.filter(job => job?.automationTabId === tabId && job?.jobId);
        for (const job of affected) {
            await geminiWebStoreResult(job.jobId, {
                success: false,
                error: '[PROVIDER_TAB_CLOSED] ' + (WEB_IMAGE_PROVIDERS[job.provider]?.label || '网页作图') + ' 标签页已关闭；系统将用同一提示词自动重开并续做'
            });
        }
    })().catch(error => console.warn('[Ianto] 处理网页作图标签关闭失败:', error));
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.action === 'webImageActivateForJob' || request?.action === 'geminiWebActivateForJob') {
        geminiWebActivateForJob(request, sender)
            .then(() => sendResponse({ activated: true }))
            .catch(error => sendResponse({
                activated: false,
                error: error?.message || 'Ianto 无法激活网页作图标签页'
            }));
        return true;
    }

    if (request?.action === 'geminiWebPing') {
        sendResponse({ success: true, version: chrome.runtime.getManifest().version, protocolVersion: WEB_IMAGE_PROTOCOL, backgroundBuild: WEB_IMAGE_BUILD, providers: Object.keys(WEB_IMAGE_PROVIDERS), continuousMaterials: true });
        return false;
    }

    if (request?.action === 'webImageListModels') {
        const editorUrl = String(sender.tab?.url || '');
        if (request.client !== 'ai-photo-editor-gemini-web' || !/^http:\/\/(?:localhost|127\.0\.0\.1):3000\//.test(editorUrl) || request.provider !== 'leopard' || request.protocolVersion !== WEB_IMAGE_PROTOCOL || request.bridgeBuild !== WEB_IMAGE_BUILD) {
            sendResponse({ success: false, error: '[PROVIDER] 无效的模型清单请求或插件版本不匹配' }); return false;
        }
        const previous = webImageDispatchLocks.get('leopard') || Promise.resolve();
        const operation = previous.catch(() => {}).then(async () => {
            const jobs = Object.values(await chrome.storage.session.get(null));
            if (jobs.some(job => job?.provider === 'leopard' && job?.jobId)) throw new Error('[PROVIDER_BUSY] Leopard X 正在作图，请结束后刷新模型');
            const tab = await geminiWebEnsureTab('leopard', '__catalog__');
            const result = await geminiWebSendToTab(tab.id, { action: 'leopardWebListModels' });
            if (!result?.success) throw new Error(result?.error || '读取 Leopard X 模型失败');
            return result;
        }).finally(async () => { try { await geminiWebActivateTab(sender.tab.id); } catch (_) {} });
        webImageDispatchLocks.set('leopard', operation);
        operation.then(sendResponse).catch(cause => sendResponse({success:false,error:cause.message}));
        operation.finally(() => { if (webImageDispatchLocks.get('leopard') === operation) webImageDispatchLocks.delete('leopard'); }).catch(() => {});
        return true;
    }

    if (request?.action === 'geminiImageWorkerStatus') {
        const senderUrl = String(sender.tab?.url || '');
        const originTabId = Number.isInteger(request.originTabId) ? request.originTabId : null;
        if (!/^https:\/\/(?:gemini\.google\.com|chatgpt\.com|chat\.openai\.com|leopard-x\.memofun\.net)\//.test(senderUrl) || !originTabId || !request.jobId) {
            sendResponse({ forwarded: false });
            return false;
        }
        chrome.tabs.sendMessage(originTabId, {
            action: 'geminiWebJobProgress',
            jobId: request.jobId,
            status: String(request.status || ''),
            type: String(request.type || 'info')
        }, () => { void chrome.runtime.lastError; });
        geminiWebGetJob(request.jobId).then(job => {
            if (job?.automationTabId !== sender.tab?.id) return;
            return geminiWebSaveJob(request.jobId, job);
        }).catch(() => {});
        sendResponse({ forwarded: true });
        return false;
    }

    if (request?.action === 'webImageJobHeartbeat') {
        geminiWebGetJob(request.jobId).then(job => {
            if (!job || job.automationTabId !== sender.tab?.id || job.provider !== request.provider) {
                sendResponse({ renewed: false });
                return;
            }
            geminiWebSaveJob(request.jobId, job)
                .then(() => sendResponse({ renewed: true }))
                .catch(() => sendResponse({ renewed: false }));
        }).catch(() => sendResponse({ renewed: false }));
        return true;
    }

    if (request?.action === 'geminiWebCancel') {
        const senderUrl = String(sender.tab?.url || '');
        const isEditorPage = /^http:\/\/(?:localhost|127\.0\.0\.1):3000\//.test(senderUrl);
        if (request.client !== 'ai-photo-editor-gemini-web' || !request.jobId || !isEditorPage) {
            sendResponse({ cancelled: false });
            return false;
        }
        geminiWebCancelJob(request.jobId, sender.tab.id)
            .then(sendResponse)
            .catch(error => sendResponse({ cancelled: false, error: error?.message || '取消网页任务失败' }));
        return true;
    }

    if (request?.action === 'geminiWebGenerate') {
        const senderUrl = String(sender.tab?.url || '');
        const isEditorPage = /^http:\/\/(?:localhost|127\.0\.0\.1):3000\//.test(senderUrl);
        if (request.client !== 'ai-photo-editor-gemini-web' || !request.jobId || !isEditorPage) {
            sendResponse({ started: false, error: '无效的网页作图任务来源' });
            return false;
        }
        // Keep the message channel alive until the target worker has actually
        // accepted the job. A synchronous optimistic ACK can let an MV3 service
        // worker suspend before the first awaited dispatch step completes.
        geminiWebDispatchJob(request, sender.tab?.id)
            .then(result => sendResponse(result))
            .catch(error => sendResponse({
                started: false,
                error: error?.message || 'Ianto 无法启动网页作图任务'
            }));
        return true;
    }

    if (request?.action === 'geminiWebJobResult') {
        if (!request.jobId || !request.result) {
            sendResponse({ stored: false });
            return false;
        }
        geminiWebGetJob(request.jobId).then(job => {
            if (!job || job.automationTabId !== sender.tab?.id) throw new Error('[RESULT_OWNER] 结果与任务标签不一致');
            return geminiWebStoreResult(request.jobId, request.result);
        })
            .then(() => sendResponse({ stored: true }))
            .catch(error => sendResponse({ stored: false, error: error.message }));
        return true;
    }

    if (request?.action === 'webImageFetchDataUrl') {
        const url = String(request.url || '');
        if (!/^https?:\/\//i.test(url) && !url.startsWith('data:image/')) {
            sendResponse({ success: false, error: '无效的图片 URL' });
            return false;
        }
        if (url.startsWith('data:image/')) {
            sendResponse({ success: true, dataUrl: url });
            return false;
        }
        fetch(url)
            .then(res => {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.blob();
            })
            .then(webImageBlobToDataUrl)
            .then(dataUrl => sendResponse({ success: true, dataUrl }))
            .catch(error => sendResponse({ success: false, error: error?.message || '读取图片失败' }));
        return true;
    }

    return;
});
