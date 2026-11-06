// Normalize image drags from Walmart result cards and product pages.
// Search-result cards often drag their product link instead of the thumbnail itself.
(() => {
    'use strict';

    function getDraggedImageUrls(event) {
        const target = event.target;
        if (!(target instanceof Element)) return [];

        // Result cards use a transparent <a> over a sibling product image.
        // Read the image under the pointer before falling back to the card boundary.
        const underPointer = Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
            ? document.elementsFromPoint(event.clientX, event.clientY).find(element => element.matches('img'))
            : null;
        const card = target.closest('[data-dca-ctx="itemTile"], [data-test-id="gpt-main"], [data-item-id]');
        const image = target.closest('img') || target.closest('a')?.querySelector('img') ||
            underPointer || card?.querySelector('img[data-testid="productTileImage"], img[id*="productImage"]') ||
            target.closest('[draggable="true"]')?.querySelector('img') || target.querySelector('img');
        if (!image) return [];

        const srcsetCandidates = value => (value || '').split(',')
            .map(part => part.trim().split(/\s+/)[0]).reverse();
        const rawCandidates = [
            image.getAttribute('data-original'),
            image.getAttribute('data-zoom-image'),
            image.getAttribute('data-image'),
            image.getAttribute('data-src'),
            image.getAttribute('data-lazy-src'),
            ...srcsetCandidates(image.getAttribute('data-srcset')),
            ...srcsetCandidates(image.getAttribute('srcset')),
            image.currentSrc,
            image.getAttribute('src'),
        ];
        const urls = [];
        for (const candidate of rawCandidates) {
            if (!candidate) continue;
            try {
                const url = new URL(candidate, location.href);
                if ((url.protocol === 'https:' || url.protocol === 'http:') && !urls.includes(url.href)) {
                    urls.push(url.href);
                }
            } catch (_) {}
        }
        return urls;
    }

    function normalizeImageDrag(event) {
        if (!event.dataTransfer) return;
        const imageUrls = getDraggedImageUrls(event);
        if (!imageUrls.length) return;

        // Standardize the drag payload so the Ianto panel receives the actual
        // thumbnail URL instead of a Walmart product-page link.
        try {
            const escapeAttribute = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
            event.dataTransfer.setData('application/x-ianto-image+json', JSON.stringify({version: 1, urls: imageUrls}));
            event.dataTransfer.setData('text/uri-list', imageUrls.join('\r\n'));
            event.dataTransfer.setData('text/plain', imageUrls[0]);
            event.dataTransfer.setData('text/html', `<img src="${escapeAttribute(imageUrls[0])}">`);
        } catch (_) {}
    }

    window.addEventListener('dragstart', normalizeImageDrag, true);
    window.addEventListener('dragstart', normalizeImageDrag, false);
})();
