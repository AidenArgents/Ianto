// content_scripts/content_amz_search.js - Amazon 页面图片搜索功能

(function() {
    'use strict';

    // 选择器
    const SEARCH_INPUT_SELECTORS = [
        '#twotabsearchtextbox',
        'input[name="field-keywords"]',
        '.nav-input[type="text"]'
    ];

    const SEARCH_FORM_SELECTORS = [
        '#nav-search-bar-form',
        'form[name="site-search"]',
        '.nav-search-field'
    ];

    const STYLESNAP_URL = `${window.location.origin}/stylesnap`;
    const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB
    const MAX_DIMENSION = 2000;

    // 查找元素
    function findElement(selectors) {
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        return null;
    }

    // 调整图片大小
    async function resizeImageIfNeeded(blob) {
        // StyleSnap 对 JPEG/PNG 的兼容性更稳定。Amazon/Walmart 图片常被保存为
        // WebP、AVIF，甚至没有 MIME；先由浏览器解码，再统一输出为 JPEG。
        if (blob.type?.toLowerCase() === 'image/jpeg' && blob.size <= MAX_IMAGE_BYTES) return blob;

        const bitmap = await createImageBitmap(blob);
        try {
            let scale = Math.min(MAX_DIMENSION / bitmap.width, MAX_DIMENSION / bitmap.height, 1);
            const qualities = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.35];
            for (let attempt = 0; attempt < qualities.length; attempt++) {
                const w = Math.max(1, Math.round(bitmap.width * scale));
                const h = Math.max(1, Math.round(bitmap.height * scale));
                const canvas = new OffscreenCanvas(w, h);
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error('无法创建图片处理画布');
                ctx.fillStyle = '#fff';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(bitmap, 0, 0, w, h);
                const converted = await canvas.convertToBlob({ type: 'image/jpeg', quality: qualities[attempt] });
                if (converted.size <= MAX_IMAGE_BYTES) return converted;
                scale *= 0.8;
            }
            throw new Error('图片过大，无法压缩到上传限制以内');
        } finally {
            bitmap.close();
        }
    }

    // 处理图片
    async function handleCapturedImage(blob) {
        showToast('正在处理图片...');

        try {
            const processed = await resizeImageIfNeeded(blob);
            const originalName = blob.name || 'pasted-image.png';
            const outputName = processed !== blob
                ? originalName.replace(/\.[^.]+$/, '') + '.jpg'
                : originalName;

            const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(processed);
            });

            await chrome.storage.local.set({
                pendingImage: {
                    data: base64,
                    name: outputName,
                    type: processed.type,
                    timestamp: Date.now()
                }
            });

            // Notify background
            chrome.runtime.sendMessage({ type: 'IMAGE_CAPTURED' });

            showToast('正在跳转到图片搜索...');
            window.location.href = STYLESNAP_URL;
        } catch (err) {
            console.error('Ianto Amazon Search: 图片处理失败', err);
            showToast('无法读取这张图片，请改用 JPG 或 PNG 后重试');
        }
    }

    // 显示提示
    function showToast(message) {
        let toast = document.getElementById('ianto-amz-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ianto-amz-toast';
            toast.style.cssText = `
                position: fixed;
                top: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: #232f3e;
                color: #fff;
                padding: 12px 24px;
                border-radius: 8px;
                font-size: 14px;
                z-index: 999999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                opacity: 0;
                transition: opacity 0.3s;
            `;
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.opacity = '1';

        clearTimeout(toast._hideTimer);
        toast._hideTimer = setTimeout(() => {
            toast.style.opacity = '0';
        }, 3000);
    }

    // 创建上传面板
    function createUploadPanel() {
        const panel = document.createElement('div');
        panel.id = 'ianto-amz-upload-panel';
        panel.style.cssText = `
            position: fixed;
            top: 0;
            right: 12px;
            width: 320px;
            max-width: calc(100vw - 24px);
            max-height: calc(100vh - 24px);
            overflow: auto;
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            padding: 16px;
            box-sizing: border-box;
            z-index: 2147483647;
            display: none;
        `;

        panel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <span style="font-weight: bold; font-size: 14px;">图片搜索</span>
                <button id="ianto-close-panel" style="background: none; border: none; font-size: 18px; cursor: pointer; padding: 0;">×</button>
            </div>

            <div id="ianto-upload-area" style="
                border: 2px dashed #ccc;
                border-radius: 8px;
                padding: 20px;
                text-align: center;
                background: #fafafa;
                transition: all 0.3s;
                cursor: pointer;
            ">
                <div style="font-size: 32px; margin-bottom: 8px;">📷</div>
                <div style="font-size: 13px; color: #666; margin-bottom: 12px;">拖拽图片到此处</div>
                <button id="ianto-select-file" style="
                    padding: 8px 16px;
                    background: #2196F3;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                ">选择本地图片</button>
                <input type="file" id="ianto-file-input" accept="image/*" style="display: none;">
            </div>

            <div style="margin-top: 12px; display: flex; gap: 8px;">
                <input type="text" id="ianto-url-input" placeholder="或输入图片 URL" style="
                    flex: 1;
                    padding: 8px;
                    border: 1px solid #ccc;
                    border-radius: 4px;
                    font-size: 13px;
                ">
                <button id="ianto-url-submit" style="
                    padding: 8px 16px;
                    background: #FF9800;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 13px;
                ">搜索</button>
            </div>

            <div id="ianto-preview" style="margin-top: 12px; display: none;">
                <img id="ianto-preview-img" alt="待搜索图片预览" style="display: block; max-width: 100%; max-height: 150px; margin: 0 auto; border-radius: 4px; object-fit: contain;">
                <div id="ianto-file-name" style="margin-top: 6px; color: #666; font-size: 12px; overflow-wrap: anywhere;"></div>
                <button id="ianto-start-search" type="button" style="display: none; width: 100%; margin-top: 10px; padding: 9px 12px; background: #FF9900; color: #111; border: 0; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">开始图片搜索</button>
            </div>
        `;

        document.body.appendChild(panel);
        return panel;
    }

    // 注入相机按钮
    function injectCameraButton() {
        const searchInput = findElement(SEARCH_INPUT_SELECTORS);
        if (!searchInput) return;

        if (document.getElementById('ianto-amz-camera-btn')) return;

        // Keep Amazon's form as the positioning anchor. Making .nav-search-field
        // positioned can trap Amazon's own absolutely-positioned search decoration.
        const parent = findElement(SEARCH_FORM_SELECTORS) ||
                       searchInput.closest('form') ||
                       searchInput.parentElement;
        if (!parent) return;

        const parentPos = getComputedStyle(parent).position;
        if (parentPos === 'static') {
            parent.style.position = 'relative';
        }

        const btn = document.createElement('button');
        btn.id = 'ianto-amz-camera-btn';
        btn.type = 'button';
        btn.setAttribute('aria-label', '以图搜图');
        btn.setAttribute('aria-expanded', 'false');
        btn.style.cssText = `
            position: absolute;
            right: 80px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            cursor: pointer;
            padding: 6px;
            color: #666;
            z-index: 20;
            display: inline-flex;
            align-items: center;
            justify-content: center;
        `;
        btn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
            </svg>
        `;
        btn.title = '以图搜图 - 拖拽、粘贴或选择图片';

        const panel = createUploadPanel();
        let selectedImage = null;
        let previewUrl = null;
        const preview = document.getElementById('ianto-preview');
        const previewImg = document.getElementById('ianto-preview-img');
        const startSearch = document.getElementById('ianto-start-search');

        function selectImage(file) {
            if (!file || !file.size) {
                showToast('没有读取到图片文件，请重新拖入');
                return;
            }
            selectedImage = file;
            startSearch.style.display = 'none';
            preview.style.display = 'block';
            document.getElementById('ianto-file-name').textContent = file.name || '已选择图片';
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(file);
            previewImg.onload = () => { startSearch.style.display = 'block'; };
            previewImg.onerror = () => {
                selectedImage = null;
                preview.style.display = 'none';
                showToast('无法预览这张图片，请改用 JPG 或 PNG');
            };
            previewImg.src = previewUrl;
        }

        startSearch.addEventListener('click', () => {
            if (!selectedImage) return;
            const file = selectedImage;
            selectedImage = null;
            panel.style.display = 'none';
            btn.setAttribute('aria-expanded', 'false');
            handleCapturedImage(file);
        });

        function positionPanel() {
            if (panel.style.display === 'none') return;
            const rect = btn.getBoundingClientRect();
            const panelWidth = Math.min(320, Math.max(0, window.innerWidth - 24));
            const maxRight = Math.max(12, window.innerWidth - panelWidth - 12);
            const right = Math.max(12, Math.min(maxRight, window.innerWidth - rect.right));
            panel.style.width = `${panelWidth}px`;
            panel.style.right = `${right}px`;
            panel.style.left = 'auto';
            let top = rect.bottom + 8;
            if (top + panel.offsetHeight > window.innerHeight - 12) {
                top = Math.max(12, rect.top - panel.offsetHeight - 8);
            }
            panel.style.top = `${top}px`;
        }

        // 点击按钮显示面板
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isHidden = panel.style.display === 'none';
            panel.style.display = isHidden ? 'block' : 'none';
            btn.setAttribute('aria-expanded', String(isHidden));
            if (isHidden) positionPanel();
        });

        // 关闭面板
        document.getElementById('ianto-close-panel').addEventListener('click', () => {
            panel.style.display = 'none';
            btn.setAttribute('aria-expanded', 'false');
        });

        // 点击外部关闭
        document.addEventListener('click', (e) => {
            if (!panel.contains(e.target) && !btn.contains(e.target)) {
                panel.style.display = 'none';
                btn.setAttribute('aria-expanded', 'false');
            }
        });
        window.addEventListener('resize', positionPanel);
        window.addEventListener('scroll', positionPanel, true);

        // 整个面板都接收文件拖放，避免用户把文件放到预览/URL 区域时被网页接管。
        panel.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            panel.style.outline = '2px dashed #4CAF50';
        });

        panel.addEventListener('dragleave', (e) => {
            e.preventDefault();
            if (!panel.contains(e.relatedTarget)) panel.style.outline = '';
        });

        panel.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            panel.style.outline = '';
            const transfer = e.dataTransfer;
            const file = transfer?.files?.[0] || Array.from(transfer?.items || [])
                .map(item => item.kind === 'file' ? item.getAsFile() : null).find(Boolean);
            if (file) {
                selectImage(file);
                return;
            }

            // 从 Amazon/Walmart 等网页直接拖图片时，浏览器通常传递的是
            // text/html 或 text/uri-list，而不是本地 File。
            const imageUrls = getDroppedImageUrls(transfer);
            if (imageUrls.length) {
                panel.style.display = 'none';
                btn.setAttribute('aria-expanded', 'false');
                handleDroppedImageUrls(imageUrls);
                return;
            }
            showToast('拖放内容没有图片文件或图片链接，请从文件夹或网页图片重新拖入');
        });

        // 本地文件选择
        document.getElementById('ianto-select-file').addEventListener('click', () => {
            document.getElementById('ianto-file-input').click();
        });

        document.getElementById('ianto-file-input').addEventListener('change', () => {
            const file = document.getElementById('ianto-file-input').files[0];
            if (file) selectImage(file);
            document.getElementById('ianto-file-input').value = '';
        });

        // URL 输入
        document.getElementById('ianto-url-submit').addEventListener('click', () => {
            const url = document.getElementById('ianto-url-input').value.trim();
            if (url) {
                handleImageUrl(url);
                panel.style.display = 'none';
            } else {
                showToast('请输入图片 URL');
            }
        });

        document.getElementById('ianto-url-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const url = document.getElementById('ianto-url-input').value.trim();
                if (url) {
                    handleImageUrl(url);
                    panel.style.display = 'none';
                }
            }
        });

        parent.appendChild(btn);
    }

    function getDroppedImageUrls(transfer) {
        if (!transfer) return [];
        const candidates = [];
        try {
            const payload = JSON.parse(transfer.getData('application/x-ianto-image+json') || 'null');
            if (payload?.version === 1 && Array.isArray(payload.urls)) {
                candidates.push(...payload.urls.filter(url => typeof url === 'string'));
            }
        } catch (_) {}
        const uriList = transfer.getData('text/uri-list');
        const uriCandidates = uriList
            ? uriList.split(/\r?\n/).filter(line => line && !line.startsWith('#'))
            : [];
        const html = transfer.getData('text/html');
        if (html) {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const base = doc.querySelector('base[href]')?.href || uriCandidates[0] || window.location.href;
            for (const image of doc.querySelectorAll('img')) {
                const srcset = (image.getAttribute('srcset') || '').split(',')
                    .map(part => part.trim().split(/\s+/)[0]).reverse();
                for (const raw of [image.getAttribute('data-original'), image.getAttribute('data-src'),
                    image.getAttribute('data-lazy-src'), image.getAttribute('data-zoom-image'),
                    ...srcset,
                    image.getAttribute('src')]) {
                    if (raw) candidates.push(resolveDroppedUrl(raw, base));
                }
            }
            for (const source of doc.querySelectorAll('source[srcset]')) {
                const srcset = source.getAttribute('srcset').split(',')
                    .map(part => part.trim().split(/\s+/)[0]).reverse();
                candidates.push(...srcset.map(raw => resolveDroppedUrl(raw, base)));
            }
            for (const link of doc.querySelectorAll('a[href]')) {
                candidates.push(resolveDroppedUrl(link.getAttribute('href'), base));
            }
            for (const element of doc.querySelectorAll('[style]')) {
                const style = element.getAttribute('style') || '';
                for (const match of style.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
                    candidates.push(resolveDroppedUrl(match[2], base));
                }
            }
        }

        candidates.push(...uriCandidates);
        const mozUrl = transfer.getData('text/x-moz-url');
        if (mozUrl) candidates.push(mozUrl.split(/\r?\n/)[0]);
        const downloadUrl = transfer.getData('DownloadURL');
        if (downloadUrl) {
            const match = downloadUrl.match(/^[^:]+:[^:]+:(https?:\/\/.*)$/i);
            if (match) candidates.push(match[1]);
        }
        const plain = transfer.getData('text/plain')?.trim();
        if (plain) candidates.push(...extractAbsoluteUrls(plain));

        // Some sites use their own transfer MIME type and put the image URL in its text payload.
        for (const type of Array.from(transfer.types || [])) {
            if (/^(files|text\/(html|uri-list|x-moz-url|plain)|downloadurl|application\/x-ianto-image\+json)$/i.test(type)) continue;
            try {
                const value = transfer.getData(type);
                if (value) candidates.push(...extractAbsoluteUrls(value));
            } catch (_) {}
        }

        const urls = [];
        for (const candidate of candidates) {
            if (!candidate) continue;
            try {
                const url = new URL(candidate, window.location.href);
                if (['http:', 'https:', 'data:', 'blob:'].includes(url.protocol) && !urls.includes(url.href)) {
                    urls.push(url.href);
                }
            } catch (_) {}
        }
        return urls.slice(0, 8);
    }

    function resolveDroppedUrl(raw, base) {
        try { return new URL(raw, base).href; } catch (_) { return raw; }
    }

    function extractAbsoluteUrls(value) {
        const text = String(value || '').trim();
        if (/^data:image\//i.test(text) || /^blob:/i.test(text)) return [text];
        return (text.match(/https?:\/\/[^\s"'<>]+/gi) || []).map(url => url.replace(/[),.;]+$/, ''));
    }

    async function handleDroppedImageUrls(urls) {
        showToast('正在读取拖入的网页图片...');
        let lastError = null;
        for (const url of urls) {
            try {
                const blob = await fetchImageBlob(url);
                await handleCapturedImage(makeImageFile(blob));
                return;
            } catch (error) {
                lastError = error;
            }
        }
        console.error('拖入的网页图片无法读取:', lastError);
        showToast(lastError?.message || '无法读取拖入的图片，请尝试保存到本地后拖入');
    }

    function makeImageFile(blob) {
        const extension = blob.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'img';
        return new File([blob], `dragged-image.${extension}`, {type: blob.type});
    }

    async function fetchImageBlob(url) {
        const parsed = new URL(url, window.location.href);
        let blob;
        if (parsed.protocol === 'data:' || parsed.protocol === 'blob:') {
            const response = await fetch(parsed.href);
            if (!response.ok) throw new Error('无法读取拖放的图片数据');
            blob = await response.blob();
        } else if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            const result = await chrome.runtime.sendMessage({type: 'FETCH_IMAGE_FOR_SEARCH', url: parsed.href});
            if (!result?.ok) throw new Error(result?.error || '无法加载图片地址');
            const binary = atob(result.data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            blob = new Blob([bytes], {type: result.type});
        } else {
            throw new Error('拖放内容不是可读取的图片地址');
        }

        if (!blob.size) throw new Error('图片地址返回了空文件');
        const bitmap = await createImageBitmap(blob);
        bitmap.close();
        return blob;
    }

    // 处理 URL
    async function handleImageUrl(url) {
        showToast('正在加载图片...');

        try {
            const blob = await fetchImageBlob(url);
            await handleCapturedImage(makeImageFile(blob));
        } catch (err) {
            console.error('URL 图片加载失败:', err);
            showToast(err?.message || '无法加载图片 URL，请检查链接是否有效');
        }
    }

    // 粘贴监听
    function setupPasteListener() {
        const searchInput = findElement(SEARCH_INPUT_SELECTORS);
        if (!searchInput) return;

        searchInput.addEventListener('paste', (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const blob = item.getAsFile();
                    if (blob) handleCapturedImage(blob);
                    return;
                }
            }
        });
    }

    // 初始化
    function init() {
        injectCameraButton();
        setupPasteListener();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('Ianto Amazon Search loaded');
})();
