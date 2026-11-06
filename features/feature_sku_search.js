// features/feature_sku_search.js - SKU 一键查询 (合并自 sku-search-extension)

(function () {
  const BASE = "http://www.instudio.me:6206";
  const URLS = {
    perf:  `${BASE}/v3/overseaStocking/ProductPerformance`,
    repl:  `${BASE}/v3/overseaStocking/Replenishment/plan`,
    eshop: `${BASE}/eshop/product.do`
  };

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEYS = { history: "sku_history", lastSku: "sku_lastSku" };

  function buildUrl(kind, sku, opts) {
    const enc = encodeURIComponent(sku);
    if (kind === "perf")  return `${URLS.perf}?_sku=${enc}`;
    if (kind === "repl")  return `${URLS.repl}?_sku=${enc}${opts.clearDate ? "&_clearDate=1" : ""}`;
    if (kind === "eshop") return `${URLS.eshop}?method=skuOrder&sequenceid=${enc}`;
  }

  async function openTabs(rawStr) {
    const skuInput = $("sku_input");
    const raw = (rawStr || "").trim();
    if (!raw) { skuInput.focus(); return; }

    const skus = raw.split(/[\s,，\n]+/).filter(s => s.trim());
    if (skus.length === 0) return;

    const wantPerf  = $("sku_opt_perf").checked;
    const wantRepl  = $("sku_opt_repl").checked;
    const wantEshop = $("sku_opt_eshop").checked;
    const clearDate = $("sku_opt_clear_date").checked;

    const opts = { clearDate };
    const tabs = [];
    for (const sku of skus) {
      if (wantPerf)  tabs.push(buildUrl("perf",  sku, opts));
      if (wantRepl)  tabs.push(buildUrl("repl",  sku, opts));
      if (wantEshop) tabs.push(buildUrl("eshop", sku, opts));
    }

    if (tabs.length > 15) {
      if (!confirm(`准备一次性打开 ${tabs.length} 个网页标签（${skus.length} 个 SKU），可能会导致浏览器卡顿。确定要继续吗？`)) {
        return;
      }
    }

    for (const url of tabs) {
      await chrome.tabs.create({ url, active: false });
      await new Promise(r => setTimeout(r, 50));
    }

    await saveHistory(skus);
    await renderHistory();
  }

  async function saveHistory(skusArray) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.history);
    const history = data[STORAGE_KEYS.history] || [];
    let next = [...history];

    for (let i = skusArray.length - 1; i >= 0; i--) {
      const sku = skusArray[i];
      next = [sku, ...next.filter(s => s !== sku)];
    }

    next = next.slice(0, 20);
    await chrome.storage.local.set({ [STORAGE_KEYS.history]: next });
  }

  async function renderHistory() {
    const data = await chrome.storage.local.get(STORAGE_KEYS.history);
    const history = data[STORAGE_KEYS.history] || [];
    const wrap = $("sku_history");
    if (!wrap) return;
    wrap.innerHTML = "";
    if (!history.length) {
      wrap.innerHTML = '<span style="color:#bbb;font-size:12px">无</span>';
      return;
    }
    const skuInput = $("sku_input");
    for (const sku of history) {
      const el = document.createElement("span");
      el.className = "sku-history-item";
      el.textContent = sku;
      el.title = "点击填入";
      el.addEventListener("click", () => {
        skuInput.value = sku;
        skuInput.focus();
        skuInput.select();
      });
      wrap.appendChild(el);
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const skuInput = $("sku_input");
    if (!skuInput) return;

    await renderHistory();
    const data = await chrome.storage.local.get(STORAGE_KEYS.lastSku);
    const lastSku = data[STORAGE_KEYS.lastSku];
    if (lastSku) skuInput.value = lastSku;

    skuInput.addEventListener("input", () => {
      chrome.storage.local.set({ [STORAGE_KEYS.lastSku]: skuInput.value });
    });

    skuInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        openTabs(skuInput.value);
      }
    });

    $("sku_go_btn").addEventListener("click", () => openTabs(skuInput.value));

    $("sku_clear_history").addEventListener("click", async () => {
      await chrome.storage.local.remove(STORAGE_KEYS.history);
      renderHistory();
    });
  });
})();
