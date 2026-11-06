// Ianto 多词高亮内容脚本。
// 优先使用 CSS Custom Highlight API：只绘制高亮，不改动网页 DOM，兼容在线文档编辑器。

(function () {
  const ENGINE_VERSION = 2;
  if (globalThis.__iantoMultiHighlightEngineVersion === ENGINE_VERSION) {
    globalThis.__iantoMultiHighlightRefresh?.();
    return;
  }
  globalThis.__iantoMultiHighlightEngineVersion = ENGINE_VERSION;
  globalThis.__iantoMultiHighlightLoaded = true;

  const STORAGE_KEYS = {
    enabled: "multihighlight_enabled",
    keywords: "multihighlight_keywords"
  };
  const COLOR_COUNT = 10;
  const MARK_CLASS = "ianto-multihighlight-mark";
  const STYLE_ID = "ianto-multihighlight-style";
  const HIGHLIGHT_NAME_PREFIX = "ianto-mh-color-";
  const HIGHLIGHT_NAMES = Array.from(
    { length: COLOR_COUNT },
    (_item, index) => `${HIGHLIGHT_NAME_PREFIX}${index + 1}`
  );
  const COMMON_SKIP_SELECTOR = [
    "script",
    "style",
    "noscript",
    "textarea",
    "select",
    "option",
    "[hidden]",
    '[aria-hidden="true"]',
    `.${MARK_CLASS}`
  ].join(",");
  const EDITABLE_SELECTOR = [
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]',
    '[data-slate-editor="true"]',
    '[data-lexical-editor="true"]',
    ".ProseMirror"
  ].join(",");
  const EDITOR_HOST_PATTERN = /(^|\.)(alidocs\.dingtalk\.com|docs\.google\.com|notion\.so|feishu\.cn|larksuite\.com|office\.com|microsoft365\.com)$/i;
  const SUPPORTS_CUSTOM_HIGHLIGHTS = Boolean(
    typeof CSS !== "undefined" &&
    CSS.highlights &&
    typeof Highlight === "function"
  );

  let enabled = true;
  let keywords = [];
  let observer = null;
  let refreshTimer = null;
  let mutationTimer = null;
  let nativeBuckets = [];
  let rangesByTextNode = new WeakMap();

  const pendingAddedRoots = new Set();
  const pendingRemovedRoots = new Set();
  const pendingChangedTextNodes = new Set();

  function parseKeywords(rawValue) {
    const seen = new Set();
    const parsed = [];

    for (const rawKeyword of String(rawValue || "").split(/\s+/)) {
      const text = rawKeyword.trim();
      if (!text) continue;

      const lower = text.toLocaleLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      parsed.push({ text, lower, colorIndex: parsed.length % COLOR_COUNT });
    }

    return parsed;
  }

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }

    style.textContent = `
      ::highlight(ianto-mh-color-1) { color: #000; background-color: #fff200; }
      ::highlight(ianto-mh-color-2) { color: #000; background-color: #ffc400; }
      ::highlight(ianto-mh-color-3) { color: #fff; background-color: #e53935; }
      ::highlight(ianto-mh-color-4) { color: #fff; background-color: #2878e8; }
      ::highlight(ianto-mh-color-5) { color: #000; background-color: #9bea19; }
      ::highlight(ianto-mh-color-6) { color: #fff; background-color: #dc19d9; }
      ::highlight(ianto-mh-color-7) { color: #000; background-color: #19c8d8; }
      ::highlight(ianto-mh-color-8) { color: #fff; background-color: #7b3fc6; }
      ::highlight(ianto-mh-color-9) { color: #000; background-color: #c6d92c; }
      ::highlight(ianto-mh-color-10) { color: #fff; background-color: #795548; }

      .${MARK_CLASS} {
        font: inherit !important;
        font-style: normal !important;
        border-radius: 3px !important;
        padding: 0 2px !important;
        box-shadow: 1px 1px 3px rgba(0, 0, 0, 0.25) !important;
        text-decoration: none !important;
      }
      .${MARK_CLASS}.ianto-mh-color-1 { color: #000 !important; background: #fff200 !important; }
      .${MARK_CLASS}.ianto-mh-color-2 { color: #000 !important; background: #ffc400 !important; }
      .${MARK_CLASS}.ianto-mh-color-3 { color: #fff !important; background: #e53935 !important; }
      .${MARK_CLASS}.ianto-mh-color-4 { color: #fff !important; background: #2878e8 !important; }
      .${MARK_CLASS}.ianto-mh-color-5 { color: #000 !important; background: #9bea19 !important; }
      .${MARK_CLASS}.ianto-mh-color-6 { color: #fff !important; background: #dc19d9 !important; }
      .${MARK_CLASS}.ianto-mh-color-7 { color: #000 !important; background: #19c8d8 !important; }
      .${MARK_CLASS}.ianto-mh-color-8 { color: #fff !important; background: #7b3fc6 !important; }
      .${MARK_CLASS}.ianto-mh-color-9 { color: #000 !important; background: #c6d92c !important; }
      .${MARK_CLASS}.ianto-mh-color-10 { color: #fff !important; background: #795548 !important; }
    `;
  }

  function shouldSkipCommonTextNode(node) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue?.trim()) return true;
    if (parent.namespaceURI !== "http://www.w3.org/1999/xhtml") return true;
    return Boolean(parent.closest(COMMON_SKIP_SELECTOR));
  }

  function shouldSkipDomFallbackTextNode(node) {
    if (shouldSkipCommonTextNode(node)) return true;
    const parent = node.parentElement;
    return Boolean(parent.isContentEditable || parent.closest(EDITABLE_SELECTOR));
  }

  function findNextMatch(lowerText, startIndex) {
    let best = null;

    for (const keyword of keywords) {
      const index = lowerText.indexOf(keyword.lower, startIndex);
      if (index === -1) continue;

      if (
        !best ||
        index < best.index ||
        (index === best.index && keyword.text.length > best.keyword.text.length)
      ) {
        best = { index, keyword };
      }
    }

    return best;
  }

  function collectMatches(text) {
    const matches = [];
    const lowerText = text.toLocaleLowerCase();
    let cursor = 0;
    let match = findNextMatch(lowerText, cursor);

    while (match) {
      const endIndex = Math.min(text.length, match.index + match.keyword.text.length);
      if (endIndex <= match.index) break;
      matches.push({
        startIndex: match.index,
        endIndex,
        colorIndex: match.keyword.colorIndex
      });
      cursor = endIndex;
      match = cursor < text.length ? findNextMatch(lowerText, cursor) : null;
    }

    return matches;
  }

  // ---------- 无侵入式 CSS Custom Highlight 引擎 ----------

  function clearNativeRegistry() {
    if (!SUPPORTS_CUSTOM_HIGHLIGHTS) return;
    HIGHLIGHT_NAMES.forEach((name) => CSS.highlights.delete(name));
    nativeBuckets = [];
    rangesByTextNode = new WeakMap();
  }

  function createNativeRegistry() {
    clearNativeRegistry();
    nativeBuckets = HIGHLIGHT_NAMES.map((name) => {
      const bucket = new Highlight();
      CSS.highlights.set(name, bucket);
      return bucket;
    });
  }

  function removeNativeRangesForTextNode(node) {
    const entries = rangesByTextNode.get(node);
    if (!entries) return;
    entries.forEach(({ colorIndex, range }) => nativeBuckets[colorIndex]?.delete(range));
    rangesByTextNode.delete(node);
  }

  function updateNativeTextNode(node) {
    removeNativeRangesForTextNode(node);
    if (!enabled || keywords.length === 0 || !node.isConnected || shouldSkipCommonTextNode(node)) return;

    const entries = [];
    for (const match of collectMatches(node.nodeValue)) {
      const range = node.ownerDocument.createRange();
      range.setStart(node, match.startIndex);
      range.setEnd(node, match.endIndex);
      nativeBuckets[match.colorIndex].add(range);
      entries.push({ colorIndex: match.colorIndex, range });
    }
    if (entries.length > 0) rangesByTextNode.set(node, entries);
  }

  function forEachTextNode(root, callback) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      callback(root);
      return;
    }
    if (![Node.ELEMENT_NODE, Node.DOCUMENT_NODE, Node.DOCUMENT_FRAGMENT_NODE].includes(root.nodeType)) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) callback(node);
  }

  function addNativeRangesInRoot(root) {
    if (!root?.isConnected) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(COMMON_SKIP_SELECTOR)) return;
    forEachTextNode(root, updateNativeTextNode);
  }

  function removeNativeRangesInRoot(root) {
    forEachTextNode(root, removeNativeRangesForTextNode);
  }

  // ---------- 旧版 Chrome 的安全降级引擎 ----------

  function isEditorLikeDocument() {
    if (EDITOR_HOST_PATTERN.test(location.hostname)) return true;
    return Boolean(document.querySelector(`${EDITABLE_SELECTOR}, iframe#wiki-doc-iframe`));
  }

  function clearDomHighlights() {
    const parents = new Set();
    document.querySelectorAll(`.${MARK_CLASS}`).forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      parents.add(parent);
    });
    parents.forEach((parent) => parent.normalize());
  }

  function highlightDomTextNode(node) {
    if (shouldSkipDomFallbackTextNode(node)) return;
    const text = node.nodeValue;
    const matches = collectMatches(text);
    if (matches.length === 0) return;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of matches) {
      if (match.startIndex > cursor) {
        fragment.appendChild(document.createTextNode(text.slice(cursor, match.startIndex)));
      }
      const mark = document.createElement("mark");
      mark.className = `${MARK_CLASS} ianto-mh-color-${match.colorIndex + 1}`;
      mark.textContent = text.slice(match.startIndex, match.endIndex);
      fragment.appendChild(mark);
      cursor = match.endIndex;
    }
    if (cursor < text.length) fragment.appendChild(document.createTextNode(text.slice(cursor)));
    node.parentNode?.replaceChild(fragment, node);
  }

  function highlightDomRoot(root) {
    if (!enabled || keywords.length === 0 || !root?.isConnected || isEditorLikeDocument()) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(`${COMMON_SKIP_SELECTOR}, ${EDITABLE_SELECTOR}`)) return;

    const textNodes = [];
    forEachTextNode(root, (node) => textNodes.push(node));
    textNodes.forEach(highlightDomTextNode);
  }

  // ---------- 状态刷新与动态页面处理 ----------

  function clearPendingMutations() {
    pendingAddedRoots.clear();
    pendingRemovedRoots.clear();
    pendingChangedTextNodes.clear();
  }

  function applyToDocument() {
    observer?.disconnect();
    clearTimeout(mutationTimer);
    clearPendingMutations();

    // 清理由上一版扩展遗留在页面里的 <mark>。
    clearDomHighlights();
    clearNativeRegistry();

    if (enabled && keywords.length > 0 && document.body) {
      ensureStyle();
      if (SUPPORTS_CUSTOM_HIGHLIGHTS) {
        createNativeRegistry();
        addNativeRangesInRoot(document.body);
      } else if (!isEditorLikeDocument()) {
        highlightDomRoot(document.body);
      }
    }
    startObserver();
  }

  function processPendingMutations() {
    if (!enabled || keywords.length === 0) {
      clearPendingMutations();
      return;
    }

    if (SUPPORTS_CUSTOM_HIGHLIGHTS) {
      pendingRemovedRoots.forEach(removeNativeRangesInRoot);
      pendingChangedTextNodes.forEach(updateNativeTextNode);
      pendingAddedRoots.forEach(addNativeRangesInRoot);
    } else if (!isEditorLikeDocument()) {
      observer?.disconnect();
      pendingChangedTextNodes.forEach(highlightDomRoot);
      pendingAddedRoots.forEach(highlightDomRoot);
      startObserver();
    }
    clearPendingMutations();
  }

  function startObserver() {
    if (!document.documentElement) return;
    observer ||= new MutationObserver((records) => {
      if (!enabled || keywords.length === 0) return;

      for (const record of records) {
        if (record.type === "characterData") {
          pendingChangedTextNodes.add(record.target);
        } else {
          record.removedNodes.forEach((node) => pendingRemovedRoots.add(node));
          record.addedNodes.forEach((node) => pendingAddedRoots.add(node));
        }
      }

      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(processPendingMutations, 100);
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(applyToDocument, 60);
  }
  globalThis.__iantoMultiHighlightRefresh = scheduleRefresh;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;

    let changed = false;
    if (changes[STORAGE_KEYS.enabled]) {
      enabled = changes[STORAGE_KEYS.enabled].newValue !== false;
      changed = true;
    }
    if (changes[STORAGE_KEYS.keywords]) {
      keywords = parseKeywords(changes[STORAGE_KEYS.keywords].newValue);
      changed = true;
    }
    if (changed) scheduleRefresh();
  });

  async function initialize() {
    try {
      const data = await chrome.storage.local.get({
        [STORAGE_KEYS.enabled]: true,
        [STORAGE_KEYS.keywords]: ""
      });
      enabled = data[STORAGE_KEYS.enabled] !== false;
      keywords = parseKeywords(data[STORAGE_KEYS.keywords]);
      applyToDocument();
    } catch (_error) {
      // 扩展刚更新或页面正在销毁时，Chrome 可能使上下文失效。
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
