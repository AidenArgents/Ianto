// ProductPerformance 页面：等表格出第一波数据再填 SKU + 点搜索
// （早填会被页面 mounted 钩子重置）
(function () {
  const TAG = "[SKU-Ext/Perf]";
  const sku = new URLSearchParams(location.search).get("_sku");
  if (!sku) return;
  console.log(TAG, "检测到 _sku =", sku);

  if (window.__skuExtPerfRan) return;
  window.__skuExtPerfRan = true;

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // 稳态填入：被页面 mounted/watch 钩子重置就立刻补，直到连续稳定 stableMs
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

  // 表格就绪 = 有数据行 OR 渲染了"暂无数据"占位
  // 后者也算就绪，避免初始接口返回空时永远等不到，导致 SKU 填不进去
  function tableHasRows() {
    return document.querySelectorAll(".el-table__row, .ant-table-row").length > 0
        || !!document.querySelector(".el-table__empty-text, .ant-empty");
  }

  function pressEnter(el) {
    ["keydown", "keypress", "keyup"].forEach(type => {
      el.dispatchEvent(new KeyboardEvent(type, {
        key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true
      }));
    });
  }

  // 监听 table body 的真实 DOM 变更，最后一次变更后静默 quietMs 才算渲染完
  // 比"行数稳定"靠谱：行数稳定可能只是搜索 XHR 还没返回、旧行没被清，假阳性
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

  async function expandAllRows(targetSku) {
    console.log(TAG, "开始轮询等待目标 SKU 的数据行出现...");
    
    // 轮询最多 15 秒，每次 500ms
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      
      const unexpanded = document.querySelectorAll(".el-table__expand-icon:not(.el-table__expand-icon--expanded)");
      if (!unexpanded.length) continue;

      // 只找第一级（不在 expanded-cell 内的）并且包含我们搜的 SKU 文本的那一行
      const targetIcons = Array.from(unexpanded).filter(icon => {
        if (icon.closest(".el-table__expanded-cell")) return false;
        
        const tr = icon.closest("tr");
        if (!tr) return false;
        
        // 关键判断：这一行的文字里必须包含我们搜索的 SKU，
        // 这样可以完美避开网络请求慢时，错误点击了上一波老数据的展开箭头。
        // 为了提高容错，统一转成大写比较
        return tr.textContent.toUpperCase().includes((targetSku || "").toUpperCase());
      });

      if (targetIcons.length > 0) {
        console.log(TAG, "找到了匹配", targetSku, "的", targetIcons.length, "个第一级行，点击展开！");
        targetIcons.forEach(icon => icon.click());
        return; // 点完就收工，不再循环
      }
    }
    
    console.log(TAG, "15秒内没有找到包含 SKU", targetSku, "的可展开行");
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
      // 1) 等表单输入框出现
      await waitFor(findSkuInput, { timeout: 30000 });
      // 2) 关键：再等表格首屏渲染完成（mounted 钩子的初始 fetch 已经回来）
      await waitFor(tableHasRows, { timeout: 30000 });
      console.log(TAG, "表格已就绪，开始填入");

      // 再等一拍让 Vue 收尾
      await new Promise(r => setTimeout(r, 500));

      const input = findSkuInput();
      input.focus();
      await fillStable(input, sku, { stableMs: 1200, maxMs: 5000 });
      
      // 填完后失焦，确保触发某些框架的 change/blur 验证
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));

      const btn = findSearchButton();
      if (btn) {
        console.log(TAG, "点击搜索按钮", btn);
        btn.click();
      } else {
        console.log(TAG, "未找到搜索按钮，回退到回车");
        pressEnter(input);
      }

      // 直接调用展开逻辑（内部有轮询和重试逻辑，不再依赖容易超时的 loading mask）
      await expandAllRows(sku);
    } catch (e) {
      console.warn(TAG, "失败:", e.message);
    }
  })();
})();
