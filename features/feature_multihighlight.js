// 多词高亮 Popup 控制器：只使用本地存储，不发送任何网络请求。

(function () {
  const STORAGE_KEYS = {
    enabled: "multihighlight_enabled",
    keywords: "multihighlight_keywords"
  };

  const $ = (id) => document.getElementById(id);
  let enabled = true;
  let saveTimer = null;

  function keywordCount(value) {
    const seen = new Set();
    for (const item of String(value || "").split(/\s+/)) {
      const keyword = item.trim();
      if (keyword) seen.add(keyword.toLocaleLowerCase());
    }
    return seen.size;
  }

  function renderToggle() {
    const button = $("multihighlight_toggle");
    if (!button) return;

    button.textContent = enabled ? "已开启" : "已关闭";
    button.classList.toggle("is-on", enabled);
    button.classList.toggle("is-off", !enabled);
    button.setAttribute("aria-checked", String(enabled));
  }

  function renderStatus(message) {
    const status = $("multihighlight_status");
    if (status) status.textContent = message;
  }

  async function ensureContentScriptInActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^(https?|file):/i.test(tab.url || "")) return false;

      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ["content_scripts/content_multihighlight.js"]
      });
      return true;
    } catch (_error) {
      // Chrome 内部页、应用商店等受保护页面不允许注入，其他网页仍正常工作。
      return false;
    }
  }

  async function saveKeywords(value) {
    await chrome.storage.local.set({ [STORAGE_KEYS.keywords]: value });
    await ensureContentScriptInActiveTab();
    const count = keywordCount(value);
    renderStatus(count ? `已保存 ${count} 个关键词` : "已清除全部高亮关键词");
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const textarea = $("multihighlight_keywords");
    const toggle = $("multihighlight_toggle");
    if (!textarea || !toggle) return;

    const data = await chrome.storage.local.get({
      [STORAGE_KEYS.enabled]: true,
      [STORAGE_KEYS.keywords]: ""
    });

    enabled = data[STORAGE_KEYS.enabled] !== false;
    textarea.value = data[STORAGE_KEYS.keywords] || "";
    renderToggle();
    renderStatus(keywordCount(textarea.value) ? `已载入 ${keywordCount(textarea.value)} 个关键词` : "尚未设置关键词");
    await ensureContentScriptInActiveTab();

    textarea.addEventListener("input", () => {
      clearTimeout(saveTimer);
      renderStatus("正在保存…");
      saveTimer = setTimeout(() => saveKeywords(textarea.value), 180);
    });

    toggle.addEventListener("click", async () => {
      enabled = !enabled;
      renderToggle();
      await chrome.storage.local.set({ [STORAGE_KEYS.enabled]: enabled });
      await ensureContentScriptInActiveTab();
      renderStatus(enabled ? `高亮已开启（${keywordCount(textarea.value)} 个关键词）` : "高亮已关闭，网页中的标记已清除");
    });
  });
})();
