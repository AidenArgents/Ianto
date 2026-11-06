// content_scripts/content_amz_stylesnap.js - Amazon StyleSnap 页面自动上传

(async function() {
    'use strict';

    // 只在 StyleSnap 页面运行
    if (!window.location.href.includes('/stylesnap')) return;

    const STALE_THRESHOLD = 30000; // 30秒
    const ELEMENT_TIMEOUT = 10000; // 10秒

    // 检查待上传图片
    const result = await chrome.storage.local.get('pendingImage');
    if (!result.pendingImage) return;

    const imageData = result.pendingImage;

    // 立即清理，防止重复触发
    await chrome.storage.local.remove('pendingImage');

    // 过期检查
    if (Date.now() - imageData.timestamp > STALE_THRESHOLD) {
        console.log('Ianto: 待上传图片已过期，忽略');
        return;
    }

    console.log('Ianto: 发现待上传图片，尝试自动上传...');

    // 等待元素出现
    function waitForElement(selectors, timeout) {
        if (typeof selectors === 'string') selectors = [selectors];

        return new Promise((resolve) => {
            // 检查是否已存在
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el) return resolve(el);
            }

            const observer = new MutationObserver(() => {
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        observer.disconnect();
                        return resolve(el);
                    }
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    // base64 转 File
    function base64ToFile(dataUrl, filename, mimeType) {
        const arr = dataUrl.split(',');
        const bstr = atob(arr[1]);
        const n = bstr.length;
        const u8arr = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
            u8arr[i] = bstr.charCodeAt(i);
        }
        return new File([u8arr], filename, { type: mimeType });
    }

    // 策略1: 直接设置 file input
    async function tryFileInput(file) {
        const fileInput = await waitForElement(
            ['input[type="file"][accept*="image"]', 'input[type="file"]'],
            ELEMENT_TIMEOUT
        );
        if (!fileInput) return false;

        console.log('Ianto: 找到 file input，设置文件...');

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        // 触发事件
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
        fileInput.dispatchEvent(new Event('input', { bubbles: true }));

        return true;
    }

    // 策略2: 模拟拖拽到上传区域
    async function tryDropZone(file) {
        const dropZone = await waitForElement(
            [
                '[class*="dropzone"]',
                '[class*="drop-zone"]',
                '[class*="upload"]',
                '[class*="DropZone"]',
                '[data-testid*="upload"]',
                '.stylesnap-upload-area',
                '[role="button"][class*="upload"]'
            ],
            3000
        );

        if (!dropZone) return false;

        console.log('Ianto: 找到 drop zone，模拟拖拽...');

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const events = ['dragenter', 'dragover', 'drop'];
        for (const type of events) {
            const event = new DragEvent(type, {
                bubbles: true,
                cancelable: true,
                dataTransfer: dataTransfer
            });
            dropZone.dispatchEvent(event);
        }

        return true;
    }

    // 策略3: 点击上传按钮后再设置
    async function tryClickThenUpload(file) {
        const uploadBtn = await waitForElement(
            [
                'button[class*="upload"]',
                '[class*="upload"] button',
                'a[class*="upload"]',
                '[class*="Upload"]',
                'label[for*="file"]'
            ],
            3000
        );

        if (!uploadBtn) return false;

        console.log('Ianto: 找到上传按钮，点击...');
        uploadBtn.click();

        // 等待 file input 出现
        await new Promise(r => setTimeout(r, 500));

        return await tryFileInput(file);
    }

    // 执行上传策略
    const file = base64ToFile(imageData.data, imageData.name, imageData.type);

    const strategies = [tryFileInput, tryDropZone, tryClickThenUpload];
    let success = false;

    for (const strategy of strategies) {
        try {
            success = await strategy(file);
            if (success) {
                console.log('Ianto: 上传触发成功');
                break;
            }
        } catch (err) {
            console.warn('Ianto: 策略失败', err);
        }
    }

    if (!success) {
        console.warn('Ianto: 所有上传策略失败');
        // 显示提示
        const msg = document.createElement('div');
        msg.style.cssText = `
            position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
            background: #232f3e; color: #fff; padding: 14px 24px; border-radius: 8px;
            font-size: 14px; z-index: 99999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            max-width: 400px; text-align: center; line-height: 1.5;
        `;
        msg.textContent = '图片已准备好，请手动点击页面上的上传按钮完成搜索。';
        document.body.appendChild(msg);
        setTimeout(() => msg.remove(), 6000);
    }
})();
