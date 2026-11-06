// content_scripts/content_echotik_fixer.js
// Echotik: switch country first, then fill keyword and search.

(function () {
    'use strict';

    const PARAM_NAME = 'country';
    const KEYWORD_PARAM = 'keyword';
    const HANDLED_FLAG = '__iantoEchotikFixerHandled';
    const COUNTRY_TEXT_MAP = {
        BR: ['Brazil', 'Brasil', '巴西'],
        MX: ['Mexico', 'México', '墨西哥'],
        ID: ['Indonesia', '印尼'],
        PH: ['Philippines', '菲律宾'],
        MY: ['Malaysia', '马来西亚'],
        VN: ['Vietnam', '越南'],
        TH: ['Thailand', '泰国'],
        SG: ['Singapore', '新加坡']
    };

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function normalizeText(value) {
        return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function getTargetCountryFromSearch(search) {
        const params = new URLSearchParams(search || '');
        const code = (params.get(PARAM_NAME) || '').toUpperCase();
        return COUNTRY_TEXT_MAP[code] ? code : null;
    }

    function getKeywordFromSearch(search) {
        const params = new URLSearchParams(search || '');
        return (params.get(KEYWORD_PARAM) || '').trim();
    }

    const INITIAL_SEARCH = window.location.search;
    const INITIAL_COUNTRY_CODE = getTargetCountryFromSearch(INITIAL_SEARCH);
    const INITIAL_KEYWORD = getKeywordFromSearch(INITIAL_SEARCH);

    function matchesCountry(text, countryCode) {
        const normalized = normalizeText(text);
        return (COUNTRY_TEXT_MAP[countryCode] || []).some((name) => normalized.includes(normalizeText(name)));
    }

    function isVisible(node) {
        return Boolean(node) && node.offsetParent !== null;
    }

    function queryAll(selectors, root = document) {
        return selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)));
    }

    function clickElement(element) {
        if (!element) {
            return false;
        }
        element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        element.click();
        return true;
    }

    async function waitFor(getter, attempts, interval) {
        for (let i = 0; i < attempts; i += 1) {
            const result = getter();
            if (result) {
                return result;
            }
            await sleep(interval);
        }
        return null;
    }

    function findCountryTrigger() {
        const selectors = [
            '[class*="RegionSwitch_capsule"]',
            '[class*="RegionSwitch_countrySelector"]',
            '[class*="RegionSwitch_regionSwitch"]',
            '[class*="RegionSwitch_regionWrap"]',
            '[class*="countrySelector"]',
            '[class*="regionSwitch"]',
            '[class*="regionWrap"]'
        ];

        return queryAll(selectors)
            .filter(isVisible)
            .find((node) => {
                const text = node.textContent || '';
                return Object.keys(COUNTRY_TEXT_MAP).some((countryCode) => matchesCountry(text, countryCode));
            }) || null;
    }

    function findCountryItem(countryCode) {
        const selectors = [
            '[class*="RegionSwitch_regionWrap"]',
            '[class*="RegionSwitch_regionItem"]',
            '[class*="regionWrap"]',
            '[class*="regionItem"]',
            '[role="option"]',
            'li',
            'button',
            'div'
        ];

        return queryAll(selectors)
            .filter(isVisible)
            .find((node) => matchesCountry(node.textContent || '', countryCode)) || null;
    }

    function findActiveCountryItem(countryCode) {
        const selectors = [
            '[class*="RegionSwitch_regionWrapActive"]',
            '[class*="regionWrapActive"]',
            '[class*="active"]'
        ];

        return queryAll(selectors)
            .filter(isVisible)
            .find((node) => matchesCountry(node.textContent || '', countryCode)) || null;
    }

    function findSearchInput() {
        const selectors = [
            'input[placeholder*="Search"]',
            'input[placeholder*="search"]',
            'input[placeholder*="搜索"]',
            'input[type="search"]',
            'input.arco-input'
        ];

        return queryAll(selectors).find((node) => isVisible(node) && !node.disabled) || null;
    }

    function findSearchButton() {
        const input = findSearchInput();
        if (!input) {
            return null;
        }

        // Note: don't match .arco-input-group first — it's the innermost wrapper around
        // just the input itself (no button inside). Walk up to the search container that
        // holds both the input and the actual search button.
        const container = input.closest('[class*="search"], [class*="Search"], [class*="header"], form') || input.parentElement;
        if (!container) {
            return null;
        }

        const buttons = [
            ...Array.from(container.querySelectorAll('button')),
            ...Array.from(container.querySelectorAll('.arco-btn')),
            ...Array.from(container.querySelectorAll('[role="button"]'))
        ].filter((button, index, arr) => arr.indexOf(button) === index);

        const textMatch = buttons.find((button) => {
            if (!isVisible(button) || button.disabled) {
                return false;
            }
            const text = normalizeText(button.textContent);
            return text.includes('search') || text.includes('搜索');
        });
        if (textMatch) {
            return textMatch;
        }

        return buttons.find((button) => {
            if (!isVisible(button) || button.disabled) {
                return false;
            }
            const text = normalizeText(button.textContent);
            if (text.includes('图') || text.includes('image') || text.includes('拍照')) {
                return false;
            }
            return Boolean(button.querySelector('svg'));
        }) || null;
    }

    async function forceSetInputValue(input, value) {
        if (!input || !value) {
            return;
        }

        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (setter) {
            setter.call(input, value);
        } else {
            input.value = value;
        }

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(250);
    }

    async function fillAndSearch() {
        const keyword = INITIAL_KEYWORD;
        const input = await waitFor(findSearchInput, 40, 300);
        if (!input) {
            console.warn('[Ianto/Echotik] Search input not found');
            return false;
        }

        if (keyword) {
            await forceSetInputValue(input, keyword);
        }

        const button = findSearchButton();
        if (button) {
            console.log('[Ianto/Echotik] Click search button');
            clickElement(button);
            return true;
        }

        input.focus();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
        return true;
    }

    async function waitForCountryApplied(countryCode) {
        return waitFor(() => {
            const activeItem = findActiveCountryItem(countryCode);
            if (activeItem) {
                return activeItem;
            }

            const trigger = findCountryTrigger();
            if (trigger && matchesCountry(trigger.textContent || '', countryCode)) {
                return trigger;
            }

            return null;
        }, 20, 120);
    }

    // ── Paywall popup dismissal ──────────────────────────────────────────────

    function tryDismissPaywallModal() {
        // The paywall modal is position:fixed with a zoomModal transition class.
        // Its close button is an SVG with class index_close__.
        const modal = document.querySelector('[class*="index_container__"][class*="zoomModal"]');
        if (!modal) return false;
        if (parseFloat(window.getComputedStyle(modal).opacity) <= 0) return false;

        const closeBtn = modal.querySelector('[class*="index_close"]');
        if (!closeBtn) return false;

        console.log('[Ianto/Echotik] Dismissing paywall popup');
        clickElement(closeBtn);
        return true;
    }

    function watchForPaywallPopup() {
        // Inject CSS to hide the paywall popup entirely. This is the most reliable
        // approach — regardless of how/when echotik tries to show it, it stays hidden.
        const style = document.createElement('style');
        style.setAttribute('data-ianto-echotik', 'paywall-hider');
        // Hide only wrappers that contain the paywall (zoomModal transition +
        // index_container__ CSS-module class). The mask is a sibling of the
        // wrapper, so we target any .arco-modal-mask that precedes one.
        style.textContent = `
            .arco-modal-wrapper:has([class*="index_container__"][class*="zoomModal"]) {
                display: none !important;
            }
            .arco-modal-mask:has(+ .arco-modal-wrapper [class*="index_container__"][class*="zoomModal"]) {
                display: none !important;
            }
        `;
        (document.head || document.documentElement).appendChild(style);
        console.log('[Ianto/Echotik] Paywall hider CSS installed');

        // Belt-and-suspenders: also poll and click the close button (in case the
        // modal body is ever moved outside the wrapper, or echotik inlines it).
        const timer = setInterval(() => {
            tryDismissPaywallModal();
        }, 400);
        setTimeout(() => clearInterval(timer), 120000);
    }

    // ── Main flow ────────────────────────────────────────────────────────────

    async function autoFixEchotik() {
        if (window[HANDLED_FLAG]) {
            return;
        }

        const countryCode = INITIAL_COUNTRY_CODE;
        if (!countryCode && !INITIAL_KEYWORD) {
            return;
        }

        window[HANDLED_FLAG] = true;
        console.log('[Ianto/Echotik] Prepare country switch:', countryCode);

        // No country param — echotik already redirected and switched country itself.
        // Just click search with the keyword that's pre-filled in the input.
        if (!countryCode) {
            await fillAndSearch();
            return;
        }

        try {
            const trigger = await waitFor(findCountryTrigger, 40, 400);
            if (!trigger) {
                console.warn('[Ianto/Echotik] Country trigger not found');
                return;
            }

            if (!matchesCountry(trigger.textContent || '', countryCode)) {
                clickElement(trigger);
                console.log('[Ianto/Echotik] Country panel opened');
                await sleep(120);

                const targetEl = await waitFor(() => findCountryItem(countryCode), 30, 250);
                if (!targetEl) {
                    console.warn('[Ianto/Echotik] Target country not found:', countryCode);
                    return;
                }

                console.log('[Ianto/Echotik] Click country:', countryCode);
                clickElement(targetEl);
                const applied = await waitForCountryApplied(countryCode);
                if (!applied) {
                    console.warn('[Ianto/Echotik] Country apply timeout:', countryCode);
                    return;
                }
            } else {
                console.log('[Ianto/Echotik] Country already matched');
            }

            await fillAndSearch();
        } catch (error) {
            console.error('[Ianto/Echotik] Error:', error);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            watchForPaywallPopup();
            setTimeout(autoFixEchotik, 250);
        }, { once: true });
    } else {
        watchForPaywallPopup();
        setTimeout(autoFixEchotik, 250);
    }
})();
