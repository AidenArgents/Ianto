// features/feature_multisearch.js - 批量搜索逻辑

(function() {
// 1. 数据结构：按国家分组
const ALL_PLATFORM_CONFIG = globalThis.IantoSearchPlatforms.countries;

const keywordInput = document.getElementById('multisearch_keyword');
    const countrySelect = document.getElementById('multisearch_country_select');
    const platformListDiv = document.getElementById('multisearch_platform_list');
    const searchButton = document.getElementById('multisearch-button');
    const searchStatus = document.getElementById('multisearch-status');
    const STORAGE_KEYWORD = 'multisearch_lastKeyword';
    const STORAGE_COUNTRY = 'multisearch_lastCountryCode';
    
    let currentPlatforms = [], renderVersion = 0;

    function renderPlatformCheckboxes(countryCode) {
        const version=++renderVersion;
        platformListDiv.innerHTML = '';
        currentPlatforms = ALL_PLATFORM_CONFIG[countryCode] ? ALL_PLATFORM_CONFIG[countryCode].platforms : [];
        
        if (currentPlatforms.length === 0) {
            platformListDiv.innerHTML = `<p id="platformHint">该国家暂无平台配置。</p>`;
            return;
        }

        chrome.storage.local.get(`multisearch_platformSelection_${countryCode}`, (data) => {
            if (countrySelect.value !== countryCode || version !== renderVersion) return;
            const savedSelection = data[`multisearch_platformSelection_${countryCode}`] || {};

            currentPlatforms.forEach(platform => {
                const isChecked = savedSelection.hasOwnProperty(platform.id) ? savedSelection[platform.id] : platform.checked;
                
                const div = document.createElement('div');
                div.className = 'platform-item';
                div.innerHTML = `
                    <input type="checkbox" id="${platform.id}" value="${platform.id}" ${isChecked ? 'checked' : ''}>
                    <label for="${platform.id}">${platform.name}</label>
                `;
                platformListDiv.appendChild(div);
            });
        });
    }

    function initCountrySelector() {
        const countries = Object.keys(ALL_PLATFORM_CONFIG);
        countrySelect.innerHTML = countries.map(code => 
            `<option value="${code}">${ALL_PLATFORM_CONFIG[code].name}</option>`
        ).join('');

        chrome.storage.local.get([STORAGE_KEYWORD, STORAGE_COUNTRY], (data) => {
            if (typeof data[STORAGE_KEYWORD] === 'string') {
                keywordInput.value = data[STORAGE_KEYWORD];
            }
            if (data[STORAGE_COUNTRY] && countries.includes(data[STORAGE_COUNTRY])) {
                countrySelect.value = data[STORAGE_COUNTRY];
            }
            // 渲染默认或记忆的国家
            renderPlatformCheckboxes(countrySelect.value);
        });
    }

    // 搜索事件
    async function handleSearch() {
        if (searchButton.disabled) return;
        const keywords = keywordInput.value
            .split(/\r?\n/)
            .map(keyword => keyword.trim())
            .filter(Boolean);
        const selectedCountryCode = countrySelect.value;
        if (keywords.length === 0) {
            alert("请输入关键词，每行一个!");
            return;
        }

        const selectedCheckboxes = platformListDiv.querySelectorAll('input[type="checkbox"]:checked');
        const selectedIds = Array.from(selectedCheckboxes).map(cb => cb.value);

        if (selectedIds.length === 0) {
            alert("请至少选择一个搜索平台!");
            return;
        }

        // 1. 记忆选择
        const platformSelection = {};
        platformListDiv.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            platformSelection[cb.value] = cb.checked;
        });

        const topicInput = document.getElementById('multisearch_research_topic');
        const topic = topicInput?.value.trim() || keywords[0];
        chrome.storage.local.set({
            [STORAGE_KEYWORD]: keywordInput.value,
            [STORAGE_COUNTRY]: selectedCountryCode,
            [`multisearch_platformSelection_${selectedCountryCode}`]: platformSelection
        });

        // A topic belongs to this search, never to the next search.
        if (topicInput) topicInput.value = '';

        const selected=currentPlatforms.filter(platform=>selectedIds.includes(platform.id));
        searchButton.disabled=true;
        searchStatus.textContent = `准备打开 ${keywords.length * selected.length} 个搜索页面…`;
        document.getElementById('workflow-popup-status').textContent = '';
        try {
            const failures = [];
            const total = keywords.length * selected.length;
            let opened = 0;
            for (const keyword of keywords) {
                for (const platform of selected) {
                    try {
                        const url = globalThis.IantoSearchPlatforms.buildUrl(platform, keyword);
                        // Await each tab so keywords and websites open in the visible list order.
                        await chrome.tabs.create({ url, active: false });
                        opened++;
                    } catch (error) {
                        failures.push(`${keyword} / ${platform.name}: ${error.message}`);
                    }
                    searchStatus.textContent = `正在打开 ${opened + failures.length}/${total} 个搜索页面…`;
                }
            }
            searchStatus.textContent = `已完成 ${opened}/${total} 个搜索页面，关键词 ${keywords.length} 个。`;

            // Search tabs come first so a slow or unavailable workflow service cannot block the main action.
            if(document.getElementById('multisearch-round')){
                const roundSelect = document.getElementById('multisearch-round');
                const productSelect = document.getElementById('multisearch-product');
                let roundId = roundSelect.value;
                let productId = productSelect.value;
                for (const keyword of keywords) {
                    try {
                        const assigned = await chrome.runtime.sendMessage({
                            namespace: 'iantoMarket',
                            type: 'workflowLaunch',
                            input: { roundId, productId, name: topic, productName: topic, word: keyword }
                        });
                        if (!assigned?.ok) throw Error(assigned?.error || '调研归属未保存');
                        roundId = assigned.assignment?.roundId || roundId;
                        productId = assigned.assignment?.productGroupId || productId;
                    } catch (error) {
                        document.getElementById('workflow-popup-status').textContent = '搜索页面已打开；部分关键词的调研归属未保存，可在采集后选择：' + error.message;
                        break;
                    }
                }
            }
            if (failures.length) {
                const detail = failures.slice(0, 10).join('\n');
                alert(`以下搜索页面未能打开：\n${detail}${failures.length > 10 ? `\n另有 ${failures.length - 10} 个失败。` : ''}`);
            }
        } finally {searchButton.disabled=false;const round=document.getElementById('multisearch-round');if(round){round.value='';document.getElementById('multisearch-product').value='';document.getElementById('multisearch-product-wrap').hidden=true;}}
    }

    // 绑定事件和初始化
    document.addEventListener('DOMContentLoaded', () => {
        initCountrySelector(); 
        countrySelect.addEventListener('change', (event) => {
            renderPlatformCheckboxes(event.target.value);
            // 每次切换国家，强制存储国家代码
            chrome.storage.local.set({ [STORAGE_COUNTRY]: event.target.value });
        });
        searchButton.addEventListener('click', handleSearch);
    });
})();
