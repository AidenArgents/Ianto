// DOM-only fallbacks use one inactive tab in a collapsed temporary group. The
// tab is reused for each page in the workflow and removed when the task ends.
async function createLingxingHelperSession(initialUrl) {
    const currentWindow = await chrome.windows.getLastFocused({ populate: false });
    if (!Number.isInteger(currentWindow?.id) || currentWindow.id === chrome.windows.WINDOW_ID_NONE) {
        throw new Error('无法创建折叠辅助标签，请保持 Chrome 窗口开启后重试');
    }
    const tab = await chrome.tabs.create({ windowId: currentWindow.id, url: 'about:blank', active: false });
    try {
        const groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId: currentWindow.id } });
        await chrome.tabGroups.update(groupId, { title: 'Ianto 后台抓取', color: 'grey', collapsed: true });
        await chrome.tabs.update(tab.id, { url: initialUrl, active: false });
    } catch (_) {
        try { await chrome.tabs.remove(tab.id); } catch (_) {}
        throw new Error('Chrome 无法折叠临时标签，已取消页面抓取以避免弹出页面');
    }
    return {
        firstTab: tab,
        async navigate(url) {
            const updated = await chrome.tabs.update(tab.id, { url, active: false });
            return updated || await chrome.tabs.get(tab.id);
        },
        async close() {
            try { await chrome.tabs.remove(tab.id); } catch (_) {}
        }
    };
}

async function waitForLingxingTabComplete(tabId, timeoutMs = 45000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            chrome.tabs.onUpdated.removeListener(onUpdated);
            error ? reject(error) : resolve();
        };
        const onUpdated = (id, changeInfo) => {
            if (id === tabId && changeInfo.status === 'complete') finish();
        };
        const timer = setTimeout(() => finish(new Error('页面加载超时，请检查领星或 Walmart 网络状态')), timeoutMs);
        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.get(tabId).then(tab => {
            if (tab.status === 'complete') finish();
        }).catch(finish);
    });
}

async function fetchLingxingPriceDirect(sku) {
    const unwrap = response => response?.code === undefined && response?.data ? response.data : response;
    async function request(url, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
            const response = await fetch(url, {
                credentials: 'include',
                headers: { Accept: 'application/json, text/plain, */*', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
                ...options,
                signal: controller.signal
            });
            if (!response.ok) throw new Error('Lingxing API HTTP ' + response.status);
            const result = unwrap(await response.json());
            if (Number(result?.code) !== 1) throw new Error('Lingxing API rejected the request');
            return result;
        } finally { clearTimeout(timer); }
    }

    try {
        const list = await request('https://erp.lingxing.com/api/product/lists', {
            method: 'POST',
            body: JSON.stringify({
                search_field: 'sku',
                senior_search_list: JSON.stringify([{ name: 'SKU', search_field: 'sku', search_value: [sku] }]),
                offset: 0, length: 100, product_type: [1, 2], is_aux: 0, is_combo: ''
            })
        });
        if (!Array.isArray(list.list)) return null;
        const matches = list.list.filter(product => product.sku === sku);
        if (!matches.length) return { success: false, error: '领星未找到完全匹配的 SKU，请核对大小写和产品权限' };
        if (matches.length !== 1) return { success: false, error: '领星存在多个相同 SKU，请先在产品管理中确认' };
        const infoUrl = new URL('https://erp.lingxing.com/api/product/info');
        infoUrl.searchParams.set('id', matches[0].id);
        const infoResult = await request(infoUrl.href);
        if (!infoResult || !infoResult.info) return null;
        const product = infoResult.info;
        if (!product || product.sku !== sku) return { success: false, error: '领星商品详情与查询 SKU 不一致，请重试' };
        const number = value => value === null || value === undefined || String(value).trim() === ''
            ? null : (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);
        const convert = (value, unit, factors) => {
            const n = number(value), factor = factors[String(unit || '').toLowerCase()];
            return n !== null && n > 0 && factor ? Number((n * factor).toFixed(6)) : null;
        };
        const cost = number(product.cg_price);
        if (cost === null) return { success: false, error: '该 SKU 未提供有效采购成本，请在领星核对后手动填写' };
        const spec = product.spec_info || {};
        const packs = Array.isArray(spec.spec_pack_list) ? spec.spec_pack_list : [];
        const pack = packs.find(p => Number(p.is_default) === 1) || (packs.length === 1 ? packs[0] : {});
        const weight = convert(pack.cg_product_gross_weight, pack.cg_product_gross_weight_unit,
            { g: 1, kg: 1000, lb: 453.59237, lbs: 453.59237, oz: 28.349523125 });
        const factors = { cm: 1, mm: 0.1, m: 100, in: 2.54, inch: 2.54, inches: 2.54 };
        const length = convert(pack.cg_package_length, pack.cg_package_spec_unit, factors);
        const width = convert(pack.cg_package_width, pack.cg_package_spec_unit, factors);
        const height = convert(pack.cg_package_height, pack.cg_package_spec_unit, factors);
        const warnings = [];
        if (cost === 0) warnings.push('采购成本为 0，请核对');
        if (weight === null) warnings.push('缺少有效包装毛重或重量单位，请手动填写');
        if ([length, width, height].some(n => n === null)) warnings.push('缺少有效包装尺寸或尺寸单位，请手动填写');
        return { success: true, data: {
            __source: 'lingxing', sku, productName: product.product_name || '',
            costPrice: cost, weight, length, width, height, warnings
        } };
    } catch (_) {
        // Some Lingxing sessions require page-specific headers or tokens. The
        // caller silently falls back to the authenticated page request client.
        return null;
    }
}

let lingxingPriceHelperSession = null;
let lingxingPriceHelperQueue = Promise.resolve();
let lingxingPriceHelperCloseTimer = null;

async function queryLingxingPriceInHelper(sku) {
    if (lingxingPriceHelperCloseTimer) clearTimeout(lingxingPriceHelperCloseTimer);
    if (!lingxingPriceHelperSession) {
        lingxingPriceHelperSession = await createLingxingHelperSession('https://erp.lingxing.com/erp/productManage');
    }
    const session = lingxingPriceHelperSession;
    try {
        await waitForLingxingTabComplete(session.firstTab.id);
        const results = await chrome.scripting.executeScript({
            target: { tabId: session.firstTab.id }, world: 'MAIN',
            func: lingxingQueryInPage, args: [sku]
        });
        return results?.[0]?.result || { success: false, error: '领星后台查询页没有返回结果，请确认浏览器已登录领星' };
    } finally {
        if (lingxingPriceHelperCloseTimer) clearTimeout(lingxingPriceHelperCloseTimer);
        lingxingPriceHelperCloseTimer = setTimeout(() => {
            if (lingxingPriceHelperSession !== session) return;
            lingxingPriceHelperSession = null;
            session.close().catch(() => {});
        }, 1200);
    }
}

function queueLingxingPriceHelperQuery(sku) {
    const task = lingxingPriceHelperQueue.catch(() => {}).then(() => queryLingxingPriceInHelper(sku));
    lingxingPriceHelperQueue = task.catch(() => {});
    return task;
}

// Runs inside a signed-in Lingxing page as a compatibility fallback when the
// background API request needs page-specific headers or tokens.
async function lingxingQueryInPage(sku) {
    try {
        if (location.origin !== 'https://erp.lingxing.com') throw new Error('请在领星 ERP 页面查询');
        const vm = document.querySelector('#app')?.__vue__;
        if (typeof vm?.$post !== 'function' || typeof vm?.$get !== 'function') {
            throw new Error('领星当前没有可用的登录会话，请先登录一次后重试');
        }
        const unwrap = response => response?.code === undefined && response?.data ? response.data : response;
        async function request(method, url, params) {
            let timer;
            try {
                const result = unwrap(await Promise.race([
                    vm[method](url, params),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('领星查询超时，请稍后重试')), 15000); })
                ]));
                if (Number(result?.code) !== 1) throw new Error('领星查询失败，请检查登录状态和产品权限');
                return result;
            } finally { clearTimeout(timer); }
        }
        const list = await request('$post', '/api/product/lists', {
            search_field: 'sku',
            senior_search_list: JSON.stringify([{ name: 'SKU', search_field: 'sku', search_value: [sku] }]),
            offset: 0, length: 100, product_type: [1, 2], is_aux: 0, is_combo: ''
        });
        const matches = (list.list || []).filter(product => product.sku === sku);
        if (!matches.length) throw new Error('领星未找到完全匹配的 SKU，请核对大小写和产品权限');
        if (matches.length !== 1) throw new Error('领星存在多个相同 SKU，请先在产品管理中确认');
        const product = (await request('$get', '/api/product/info', { id: matches[0].id })).info;
        if (!product || product.sku !== sku) throw new Error('领星商品详情与查询 SKU 不一致，请重试');
        const number = value => value === null || value === undefined || String(value).trim() === ''
            ? null : (Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null);
        const convert = (value, unit, factors) => {
            const n = number(value), factor = factors[String(unit || '').toLowerCase()];
            return n !== null && n > 0 && factor ? Number((n * factor).toFixed(6)) : null;
        };
        const cost = number(product.cg_price);
        if (cost === null) throw new Error('该 SKU 未提供有效采购成本，请在领星核对后手动填写');
        const spec = product.spec_info || {};
        const packs = Array.isArray(spec.spec_pack_list) ? spec.spec_pack_list : [];
        const pack = packs.find(p => Number(p.is_default) === 1) || (packs.length === 1 ? packs[0] : {});
        const weight = convert(pack.cg_product_gross_weight, pack.cg_product_gross_weight_unit,
            { g: 1, kg: 1000, lb: 453.59237, lbs: 453.59237, oz: 28.349523125 });
        const factors = { cm: 1, mm: 0.1, m: 100, in: 2.54, inch: 2.54, inches: 2.54 };
        const length = convert(pack.cg_package_length, pack.cg_package_spec_unit, factors);
        const width = convert(pack.cg_package_width, pack.cg_package_spec_unit, factors);
        const height = convert(pack.cg_package_height, pack.cg_package_spec_unit, factors);
        const warnings = [];
        if (cost === 0) warnings.push('采购成本为 0，请核对');
        if (weight === null) warnings.push('缺少有效包装毛重或重量单位，请手动填写');
        if ([length, width, height].some(n => n === null)) warnings.push('缺少有效包装尺寸或尺寸单位，请手动填写');
        return { success: true, data: {
            __source: 'lingxing', sku, productName: product.product_name || '',
            costPrice: cost, weight, length, width, height, warnings
        } };
    } catch (error) {
        return { success: false, error: error.message || '领星查询失败，请刷新领星页面后重试' };
    }
}

async function fetchLingxingERP(sku) {
    if (typeof sku !== 'string' || !sku.trim()) return { success: false, error: '请输入 SKU' };
    const exactSku = sku.trim();
    const directResult = await fetchLingxingPriceDirect(exactSku);
    if (directResult) return directResult;

    if (lingxingPriceHelperSession) {
        try { return await queueLingxingPriceHelperQuery(exactSku); }
        catch (_) { return { success: false, error: '无法在后台连接领星；请确认已在此浏览器登录领星后重试' }; }
    }

    const tabs = await chrome.tabs.query({ url: 'https://erp.lingxing.com/*' });
    const candidates = tabs.filter(tab => /^https:\/\/erp\.lingxing\.com\//.test(tab.url || ''));
    candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (candidates.length) {
        let lastError = null;
        for (const tab of candidates) {
            try {
                await waitForLingxingTabComplete(tab.id);
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id }, world: 'MAIN',
                    func: lingxingQueryInPage, args: [exactSku]
                });
                const existingResult = results?.[0]?.result;
                if (existingResult?.success) return existingResult;
                if (existingResult?.error) lastError = existingResult.error;
            } catch (_) {}
        }
        return { success: false, error: `${lastError || '当前已打开的领星页面暂不可查询'}；为避免多开页面，本次未另开领星标签` };
    }

    try {
        return await queueLingxingPriceHelperQuery(exactSku);
    } catch (_) {
        return { success: false, error: '无法在后台连接领星；请确认已在此浏览器登录领星后重试' };
    }
}

// Photo editor lookup: product identity and the full-resolution source image
// come from Lingxing Product Management, while listing metadata comes from the
// Walmart listing screen and the selected Walmart detail page.
async function lingxingPhotoProductQueryInPage(sku) {
    try {
        if (location.origin !== 'https://erp.lingxing.com') throw new Error('当前页面不是领星 ERP');
        const vm = document.querySelector('#app')?.__vue__;
        if (typeof vm?.$post !== 'function' || typeof vm?.$get !== 'function') {
            throw new Error('领星当前没有可用的登录会话，请先登录一次后重试');
        }
        const unwrap = response => response?.code === undefined && response?.data ? response.data : response;
        async function request(method, url, params) {
            let timer;
            try {
                const result = unwrap(await Promise.race([
                    vm[method](url, params),
                    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('领星产品查询超时')), 20000); })
                ]));
                if (Number(result?.code) !== 1) throw new Error('领星产品查询失败，请检查登录状态和产品权限');
                return result;
            } finally { clearTimeout(timer); }
        }
        const exactSku = String(sku || '').trim();
        const list = await request('$post', '/api/product/lists', {
            search_field: 'sku',
            senior_search_list: JSON.stringify([{ name: 'SKU', search_field: 'sku', search_value: [exactSku] }]),
            offset: 0, length: 100, product_type: [1, 2], is_aux: 0, is_combo: ''
        });
        const matches = (list.list || []).filter(product => String(product.sku || '').trim() === exactSku);
        if (!matches.length) throw new Error('领星产品管理中未找到完全匹配的 SKU：' + exactSku);
        if (matches.length !== 1) throw new Error('领星产品管理中存在多个相同 SKU，请先核对产品记录');
        const row = matches[0];
        const product = (await request('$get', '/api/product/info', { id: row.id })).info;
        if (!product || String(product.sku || '').trim() !== exactSku) throw new Error('领星商品详情与查询 SKU 不一致，请重试');

        const productUrls = new Set();
        const rowUrls = new Set();
        const seen = new Set();
        function collect(value, target, depth = 0) {
            if (depth > 9 || value == null) return;
            if (typeof value === 'string') {
                const text = value.replace(/\\\//g, '/');
                const extracted = text.match(/(?:https?:\/\/|\/)[^\s"'<>\\]+/g) || [];
                for (let candidate of extracted) {
                    candidate = candidate.replace(/[),;]+$/g, '');
                    try {
                        const url = new URL(candidate, location.origin).href;
                        if (/^https?:/i.test(url) && (/\.(?:png|jpe?g|webp|gif|bmp)(?:[?#]|$)/i.test(url) || /image\./i.test(new URL(url).hostname))) target.add(url);
                    } catch (_) {}
                }
                if (/^[\[{]/.test(text.trim())) {
                    try { collect(JSON.parse(text), target, depth + 1); } catch (_) {}
                }
                return;
            }
            if (typeof value !== 'object' || seen.has(value)) return;
            seen.add(value);
            if (Array.isArray(value)) value.forEach(item => collect(item, target, depth + 1));
            else Object.values(value).forEach(item => collect(item, target, depth + 1));
        }
        collect(product, productUrls);
        collect(row, rowUrls);

        // Prefer every source URL from the product record. The list row is only
        // a fallback because its DOM usually exposes a thumbnail of the first image.
        const urls = productUrls.size ? productUrls : rowUrls;
        if (!urls.size) {
            const rowEl = Array.from(document.querySelectorAll('tr')).find(el => el.innerText?.includes(exactSku));
            if (rowEl) {
                for (const image of rowEl.querySelectorAll('img')) {
                    for (const candidate of [image.currentSrc, image.src, image.getAttribute('data-src'), image.getAttribute('srcset')]) {
                        if (!candidate) continue;
                        for (const item of String(candidate).split(',').map(part => part.trim().split(/\s+/)[0])) {
                            try {
                                const url = new URL(item, location.origin).href;
                                if (/\.(?:png|jpe?g|webp|gif|bmp)(?:[?#]|$)/i.test(url) || /image\./i.test(new URL(url).hostname)) urls.add(url);
                            } catch (_) {}
                        }
                    }
                }
            }
        }

        const candidates = Array.from(urls);
        const probed = await Promise.all(candidates.map(url => new Promise(resolve => {
            const image = new Image();
            let settled = false;
            const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
            const timer = setTimeout(() => finish(null), 7000);
            image.onload = () => finish({ url, width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => finish(null);
            image.src = url;
        })));
        const valid = probed.filter(item => item && item.width > 0 && item.height > 0)
            .sort((a, b) => (b.width * b.height) - (a.width * a.height));
        if (!valid.length) throw new Error('领星产品记录中没有可读取的原图地址，请打开产品详情核对图片信息');

        const chineseTitle = String(product.product_name || product.name_cn || row.product_name || row.name || '').trim();
        if (!chineseTitle) throw new Error('领星产品记录中没有汉语标题');
        return { success: true, data: {
            sku: exactSku, chineseTitle,
            images: valid.map(item => ({ url: item.url, width: item.width, height: item.height })),
            imageUrl: valid[0].url, imageWidth: valid[0].width, imageHeight: valid[0].height
        } };
    } catch (error) {
        return { success: false, error: error?.message || '领星产品查询失败' };
    }
}

async function lingxingWalmartListingSearchInPage(sku) {
    try {
        if (location.origin !== 'https://erp.lingxing.com' || !location.pathname.includes('/erp/mmulti/walmartListing')) {
            throw new Error('领星 Walmart 商品列表未能打开');
        }
        const exactSku = String(sku || '').trim();
        const deadline = Date.now() + 25000;
        let input = null;
        while (Date.now() < deadline && !input) {
            input = Array.from(document.querySelectorAll('input')).find(el => {
                const placeholder = String(el.getAttribute('placeholder') || '');
                return /搜索内容/.test(placeholder) && el.getClientRects().length > 0;
            }) || null;
            if (!input) await new Promise(resolve => setTimeout(resolve, 250));
        }
        if (!input) throw new Error('领星 Walmart 列表的搜索框未加载，请确认已登录领星');

        input.focus();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(input, exactSku); else input.value = exactSku;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        const searchRoot = input.closest('.ant-input-search, .el-input-group, .ant-input-group-wrapper');
        const searchButton = searchRoot?.querySelector('button');
        if (searchButton) searchButton.click();
        else {
            for (const type of ['keydown', 'keypress', 'keyup']) input.dispatchEvent(new KeyboardEvent(type, {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
            }));
        }

        const parseNumber = value => {
            const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
            return match ? Number(match[0]) : null;
        };
        const findRows = () => Array.from(document.querySelectorAll('tr')).filter(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            return cells.length > 0 && row.querySelector('a[href*="/ip/"]') && cells.some(cell => String(cell.innerText || cell.textContent || '').trim() === exactSku);
        });
        let rows = [];
        const searchDeadline = Date.now() + 30000;
        while (Date.now() < searchDeadline && !rows.length) {
            rows = findRows();
            if (!rows.length) await new Promise(resolve => setTimeout(resolve, 350));
        }
        if (!rows.length) throw new Error('领星 Walmart 商品中没有找到 MSKU/SKU 完全匹配的商品：' + exactSku);

        const headers = Array.from(document.querySelectorAll('th')).map(el => String(el.innerText || el.textContent || '').replace(/\s+/g, '').trim());
        const titleIndex = headers.findIndex(value => value.includes('标题'));
        const ratingIndex = headers.findIndex(value => value === '评分' || value.includes('评分'));
        const reviewIndex = headers.findIndex(value => value.includes('评论数'));
        const listings = [];
        for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('td'));
            const links = Array.from(row.querySelectorAll('a[href]'));
            const link = links.find(el => /(?:walmart\.com)?\/ip\//i.test(el.href || el.getAttribute('href') || ''));
            if (!link) continue;
            const url = new URL(link.href || link.getAttribute('href'), location.origin).href;
            const ratingText = ratingIndex >= 0 && cells[ratingIndex] ? cells[ratingIndex].innerText : '';
            const reviewText = reviewIndex >= 0 && cells[reviewIndex] ? cells[reviewIndex].innerText : '';
            const rating = parseNumber(ratingText);
            const reviewCount = parseNumber(reviewText);
            const title = String(titleIndex >= 0 && cells[titleIndex] ? cells[titleIndex].innerText : '').replace(/\s+/g, ' ').trim();
            listings.push({ url, title, rating: rating !== null && rating <= 5 ? rating : null, reviewCount: reviewCount !== null ? reviewCount : null });
        }
        const unique = Array.from(new Map(listings.map(item => [item.url, item])).values());
        if (!unique.length) throw new Error('领星 Walmart 列表找到 SKU，但没有读取到商品链接');
        return { success: true, data: { listings: unique } };
    } catch (error) {
        return { success: false, error: error?.message || '领星 Walmart 商品查询失败' };
    }
}

async function lingxingWalmartAboutInPage() {
    try {
        const pageText = String(document.body?.innerText || '');
        if (/robot or human|press\s*&\s*hold|verify you are human|human verification/i.test(pageText)) {
            return { success: false, needsHumanVerification: true, error: 'Walmart 要求人机验证' };
        }
        const deadline = Date.now() + 35000;
        let title = '';
        let details = null;
        while (Date.now() < deadline) {
            const currentText = String(document.body?.innerText || '');
            if (/robot or human|press\s*&\s*hold|verify you are human|human verification/i.test(currentText)) {
                return { success: false, needsHumanVerification: true, error: 'Walmart 要求人机验证' };
            }
            title = String(document.querySelector('#main-title')?.innerText || document.querySelector('h1')?.innerText || '').replace(/\s+/g, ' ').trim();
            details = document.querySelector('#item-product-details, [id*="item-product-details"], .item-product-details, [class*="item-product-details"]');
            if (!details) {
                // Walmart's markup sometimes exposes this as an id or nests
                // the content under the About this item section instead of
                // the historical item-product-details class.
                const aboutHeading = document.querySelector('#about-this-item-section');
                for (let node = aboutHeading?.parentElement; node && node !== document.body; node = node.parentElement) {
                    const text = String(node.innerText || node.textContent || '').trim();
                    if (/product details/i.test(text) && text.length > 100 && text.length < 12000) {
                        details = node;
                        break;
                    }
                }
            }
            const detailsText = String(details?.innerText || details?.textContent || '').trim();
            if (title && details && detailsText.length >= 40) break;
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        if (!title || !details) throw new Error('Walmart 商品详情页未加载标题或 About this item');
        const toggles = Array.from(details.querySelectorAll('button, [role="button"]'));
        const toggleLabel = button => {
            const labelledBy = String(button.getAttribute('aria-labelledby') || '')
                .split(/\s+/)
                .map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '')
                .join(' ');
            return [
                button.getAttribute('aria-label'),
                button.getAttribute('title'),
                button.innerText,
                button.textContent,
                labelledBy
            ].filter(Boolean).join(' ');
        };
        // Walmart currently labels this accordion through aria-labelledby, so
        // its visible/accessibility name is not always present on the button
        // itself. If that label is absent, the Product details container has
        // a single collapsed control; use that scoped fallback rather than
        // leaving the details closed and returning an incomplete scrape.
        const toggle = toggles.find(button => /product details/i.test(toggleLabel(button))) ||
            (String(details.innerText || details.textContent || '').trim().length < 100
                ? toggles.find(button => button.getAttribute('aria-expanded') === 'false')
                : null);
        const expanded = toggle?.getAttribute('aria-expanded');
        const currentDetailsText = String(details.innerText || details.textContent || '').trim();
        if (toggle && (expanded === 'false' || (expanded == null && currentDetailsText.length < 100))) {
            toggle.click();
            const expandDeadline = Date.now() + 5000;
            while (Date.now() < expandDeadline) {
                await new Promise(resolve => setTimeout(resolve, 250));
                const current = String(details.innerText || details.textContent || '').trim();
                if (current.length >= 100) break;
            }
        }
        const aboutText = String(details.innerText || details.textContent || '').replace(/\u200b/g, '').replace(/\n{3,}/g, '\n\n').trim();
        const about = aboutText
            .replace(/^About this item\s*/i, '')
            .replace(/^Product details\s*/i, '')
            .replace(/\n?info:\s*We aim to show you accurate product information[\s\S]*$/i, '')
            .trim();
        if (!about || about.length < 40) throw new Error('Walmart 商品页的 About this item 内容没有展开或为空');
        return { success: true, data: { title, aboutThisItem: about } };
    } catch (error) {
        return { success: false, error: error?.message || '读取 Walmart About this item 失败' };
    }
}

async function fetchLingxingPhotoBundle(sku) {
    const exactSku = String(sku || '').trim();
    if (!exactSku) return { success: false, error: '请输入 SKU' };
    let session = null;
    const productUrl = 'https://erp.lingxing.com/erp/productManage';
    const listingUrl = 'https://erp.lingxing.com/erp/mmulti/walmartListing';
    const runInHelperTab = async (url, func, args = []) => {
        if (!session) session = await createLingxingHelperSession(url);
        else {
            const current = await chrome.tabs.get(session.firstTab.id);
            if (current.url !== url) await session.navigate(url);
        }
        const tab = session.firstTab;
        await waitForLingxingTabComplete(tab.id);
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func, args });
        return results?.[0]?.result || { success: false, error: '页面没有返回抓取结果' };
    };
    const runWalmartDetail = async url => {
        const canonical = value => {
            try {
                const parsed = new URL(value);
                return `${parsed.hostname.replace(/^www\./, '').toLowerCase()}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
            } catch (_) { return ''; }
        };
        const wanted = canonical(url);
        if (!session) session = await createLingxingHelperSession(url);
        else await session.navigate(url);
        const tab = session.firstTab;
        await waitForLingxingTabComplete(tab.id);
        const loadedTab = await chrome.tabs.get(tab.id);
        if (canonical(loadedTab.url || '') !== wanted) {
            return { success: false, error: `Walmart 页面尚未到达商品详情页（当前地址：${loadedTab.url || '未知'}）` };
        }
        const results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: lingxingWalmartAboutInPage });
        const result = results?.[0]?.result || {
            success: false,
            error: `Walmart 页面抓取脚本没有返回数据（标签页状态：${loadedTab.status || '未知'}；执行帧数：${results?.length || 0}）`
        };
        if (!result.success) {
            if (result.needsHumanVerification) {
                result.error = `Walmart 要求人机验证。页面不会自动弹出；如需继续，请手动打开商品页完成验证后重试：${url}`;
            }
            return result;
        }
        return result;
    };

    try {
        // Product identity and the source image come from an already-open
        // Lingxing page whenever possible. Do not navigate or focus that page.
        const openLingxingTabs = await chrome.tabs.query({ url: 'https://erp.lingxing.com/*' });
        const productTabs = openLingxingTabs.filter(tab => /^https:\/\/erp\.lingxing\.com\//.test(tab.url || ''));
        productTabs.sort((a, b) => {
            const aProductPage = /\/erp\/productManage(?:[/?#]|$)/.test(a.url || '') ? 1 : 0;
            const bProductPage = /\/erp\/productManage(?:[/?#]|$)/.test(b.url || '') ? 1 : 0;
            return (bProductPage - aProductPage) || ((b.lastAccessed || 0) - (a.lastAccessed || 0));
        });
        let productResult = null;
        let productError = null;
        for (const tab of productTabs) {
            try {
                await waitForLingxingTabComplete(tab.id);
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id }, world: 'MAIN',
                    func: lingxingPhotoProductQueryInPage, args: [exactSku]
                });
                productResult = results?.[0]?.result || null;
                if (productResult?.success) break;
                productError = productResult?.error || productError;
            } catch (_) {}
        }
        if (productTabs.length && !productResult?.success) {
            return { success: false, error: `${productError || '当前已打开的领星页面暂不可查询'}；为避免多开页面，本次未另开领星产品页` };
        }
        if (!productTabs.length) productResult = await runInHelperTab(productUrl, lingxingPhotoProductQueryInPage, [exactSku]);
        if (!productResult?.success) return productResult || { success: false, error: '领星产品资料没有返回结果' };

        const partialResult = (error, selected = null) => ({
            success: false,
            error,
            partial: {
                chineseTitle: productResult.data.chineseTitle,
                englishTitle: selected?.title || '',
                aboutThisItem: '',
                images: productResult.data.images || [{ url: productResult.data.imageUrl, width: productResult.data.imageWidth, height: productResult.data.imageHeight }],
                imageUrl: productResult.data.imageUrl,
                imageWidth: productResult.data.imageWidth,
                imageHeight: productResult.data.imageHeight
            }
        });

        // The Walmart listing UI and detail DOM are the remaining page-based
        // parts. Reuse one inactive, collapsed helper tab for both pages.
        const listingResult = await runInHelperTab(listingUrl, lingxingWalmartListingSearchInPage, [exactSku]);
        if (!listingResult.success) return partialResult(listingResult.error);
        const listings = listingResult.data?.listings || [];
        const rated = listings.filter(item => Number.isFinite(item.rating));
        if (!listings.length) return partialResult('领星 Walmart 商品中没有找到完全匹配的商品链接');
        if (listings.length > 1 && !rated.length) return partialResult('找到多个 Walmart 商品链接，但领星没有提供可比较的评分，请先在领星核对链接');
        const selected = (rated.length ? rated : listings).sort((a, b) =>
            (Number(b.rating ?? -1) - Number(a.rating ?? -1)) || (Number(b.reviewCount ?? -1) - Number(a.reviewCount ?? -1))
        )[0];

        const walmartResult = await runWalmartDetail(selected.url);
        if (!walmartResult.success) return partialResult(walmartResult.error, selected);
        const { chineseTitle, imageUrl } = productResult.data;
        const productImages = productResult.data.images || [{ url: imageUrl, width: productResult.data.imageWidth, height: productResult.data.imageHeight }];
        const { title: walmartTitle, aboutThisItem } = walmartResult.data;
        const englishDescription = `【Walmart 英文标题】\n${walmartTitle}\n\n【Walmart About this item】\n${aboutThisItem}`;
        return {
            success: true,
            infoData: { obj: { name_cn: chineseTitle, description_en: englishDescription } },
            imgData: { obj: productImages.map(image => ({ pictureUrl: image.url, width: image.width, height: image.height })) },
            source: 'lingxing-walmart',
            product: { sku: exactSku, chineseTitle, imageUrl, imageWidth: productResult.data.imageWidth, imageHeight: productResult.data.imageHeight, images: productImages },
            walmart: { title: walmartTitle, url: selected.url, rating: selected.rating, reviewCount: selected.reviewCount, aboutThisItem }
        };
    } catch (error) {
        return { success: false, error: error?.message || '领星产品与 Walmart 信息抓取失败' };
    } finally {
        await session?.close();
    }
}
