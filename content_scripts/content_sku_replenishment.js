// Replenishment/plan 页面：等表格 mounted → 清默认时间（仅有值的） → 填 SKU → 搜索
(function () {
  const TAG = "[SKU-Ext/Repl]";
  const params = new URLSearchParams(location.search);
  const sku = params.get("_sku");
  const clearDate = params.get("_clearDate") === "1";
  if (!sku) return;
  console.log(TAG, "检测到 _sku =", sku, "clearDate =", clearDate);

  if (window.__skuExtReplRan) return;
  window.__skuExtReplRan = true;

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function fillStable(input, value, { stableMs = 800, maxMs = 3500 } = {}) {
    setNativeValue(input, value);
    const start = Date.now();
    let lastSet = Date.now();
    let resets = 0;
    while (Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 100));
      if (input.value !== value) {
        resets++;
        lastSet = Date.now();
        setNativeValue(input, value);
      } else if (Date.now() - lastSet >= stableMs) {
        break;
      }
    }
    console.log(TAG, "稳态填入完成 value=", input.value, "重置次数=", resets, "耗时=", Date.now() - start, "ms");
  }

  function isVisible(el) {
    if (!el || el.offsetParent === null) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findSkuInput() {
    const inputs = Array.from(document.querySelectorAll("input"))
      .filter(isVisible)
      .filter(el => !el.disabled && !el.readOnly && el.type !== "hidden");

    let hit = inputs.find(el => /可按多个|空格分隔/i.test(el.placeholder || ""));
    if (hit) return hit;

    hit = inputs.find(el => {
      const ph = el.placeholder || "";
      return /sku/i.test(ph) && ph.length > 5;
    });
    if (hit) return hit;

    const items = document.querySelectorAll(".el-form-item, .ant-form-item");
    for (const item of items) {
      const label = item.querySelector("label");
      if (label && /sku/i.test(label.textContent || "")) {
        const inp = Array.from(item.querySelectorAll("input"))
          .filter(isVisible)
          .find(i => !i.readOnly && !i.disabled);
        if (inp) return inp;
      }
    }
    return null;
  }

  function findSearchButton() {
    return Array.from(document.querySelectorAll("button"))
      .filter(isVisible)
      .find(b => /^\s*(搜索|查询|search)\s*$/i.test((b.textContent || "").trim())) || null;
  }

  function tableReady() {
    // 补货页有可能初始无数据，所以再等"无数据占位"也算就绪
    return document.querySelectorAll(".el-table__row, .ant-table-row").length > 0
        || document.querySelector(".el-table__empty-text, .ant-empty");
  }

  function pressEnter(el) {
    ["keydown", "keypress", "keyup"].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
      }));
    });
  }

  // Element UI 的 close 图标用 v-if 控制，必须先 hover 让它渲染出来再点
  // 只对"已有值"的日期框处理，避免 hover 空框误开日历
  async function clearDateFilters() {
    const editors = Array.from(document.querySelectorAll(".el-date-editor"));
    let cleared = 0;
    for (const editor of editors) {
      const inputs = editor.querySelectorAll("input");
      const hasValue = Array.from(inputs).some(inp => inp.value && inp.value.trim());
      if (!hasValue) continue;

      editor.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));

      const closeIcon = editor.querySelector(".el-range__close-icon, .el-input__icon.el-icon-circle-close");
      if (closeIcon) {
        closeIcon.click();
        cleared++;
      }

      editor.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      await new Promise(r => setTimeout(r, 50));
    }
    console.log(TAG, "已清", cleared, "个有值的日期框");

    // 万一不小心弹了面板，点 body 关掉
    document.body.click();
    await new Promise(r => setTimeout(r, 100));
  }

  function waitForTableSettled({ maxMs = 7000, quietMs = 500 } = {}) {
    return new Promise((resolve) => {
      const tbody = document.querySelector(".el-table__body-wrapper, .ant-table-body");
      if (!tbody) { resolve(false); return; }
      const overall = setTimeout(() => { observer.disconnect(); resolve(false); }, maxMs);
      let quiet = null;
      const observer = new MutationObserver(() => {
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(() => {
          clearTimeout(overall);
          observer.disconnect();
          resolve(true);
        }, quietMs);
      });
      observer.observe(tbody, { childList: true, subtree: true });
    });
  }

  async function expandAllRows() {
    const settled = await waitForTableSettled();
    console.log(TAG, "table settled =", settled);
    await new Promise(r => setTimeout(r, 200));
    for (let i = 0; i < 5; i++) {
      const unexpanded = document.querySelectorAll(".el-table__expand-icon:not(.el-table__expand-icon--expanded)");
      if (!unexpanded.length) break;
      console.log(TAG, "展开", unexpanded.length, "行");
      unexpanded.forEach(icon => icon.click());
      await new Promise(r => setTimeout(r, 200));
    }
  }

  function waitFor(fn, { timeout = 30000, interval = 200 } = {}) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        try { const v = fn(); if (v) { clearInterval(t); resolve(v); return; } } catch (e) {}
        if (Date.now() - start > timeout) { clearInterval(t); reject(new Error("timeout")); }
      }, interval);
    });
  }

  (async () => {
    try {
      await waitFor(findSkuInput, { timeout: 30000 });
      await waitFor(tableReady, { timeout: 30000 });
      console.log(TAG, "表格已就绪，开始操作");

      await new Promise(r => setTimeout(r, 300));

      if (clearDate) {
        await clearDateFilters();
      }

      const input = findSkuInput();
      input.focus();
      await fillStable(input, sku);

      const btn = findSearchButton();
      if (btn) {
        console.log(TAG, "点击搜索按钮", btn);
        btn.click();
      } else {
        console.log(TAG, "未找到搜索按钮，回退到回车");
        pressEnter(input);
      }

      await expandAllRows();
    } catch (e) {
      console.warn(TAG, "失败:", e.message);
    }
  })();
})();
