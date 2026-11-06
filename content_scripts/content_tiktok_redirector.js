// content.js
const DOMAIN_A_TARGET = "shop.tiktok.com";
const DOMAIN_B = "shop.tiktokglobalshop.com";
const DOMAIN_C = "www.tiktok.com";

const MODE_A = "DOMAIN_A_FIXED";
const MODE_B = "DOMAIN_B_FIXED";
const MODE_C = "DOMAIN_C_FIXED";
const MODE_NONE = "NONE";

function normalizeCountry(country) {
    return (country || "").toLowerCase();
}

function getCountryFromSearch(searchParams) {
    const region = searchParams.get("region") || searchParams.get("country") || searchParams.get("site");
    if (region && /^[a-z]{2}$/i.test(region)) return region;

    const locale = searchParams.get("locale") || searchParams.get("language");
    const localeMatch = locale && locale.match(/[-_]([a-z]{2})$/i);
    return localeMatch ? localeMatch[1] : null;
}

function parseTikTokProductUrl(url) {
    try {
        const parsedUrl = new URL(url);
        const host = parsedUrl.hostname;
        const path = parsedUrl.pathname;
        let country = getCountryFromSearch(parsedUrl.searchParams);
        let itemId = null;

        let match = path.match(/^\/view\/product\/([^/?#]+)/i);
        if (match) itemId = match[1];

        match = path.match(/^\/shop\/pdp\/([^/?#]+)/i);
        if (!itemId && match) itemId = match[1];

        match = path.match(/^\/shop\/([a-z]{2})\/pdp\/([^/?#]+)/i);
        if (match) {
            country = match[1];
            itemId = match[2];
        }

        const isKnownHost = host === DOMAIN_A_TARGET || host === DOMAIN_B || host === DOMAIN_C;
        return isKnownHost && itemId ? { parsedUrl, country: normalizeCountry(country), itemId } : null;
    } catch (e) {
        return null;
    }
}

function buildTikTokProductUrl(currentUrl, targetMode) {
    const product = parseTikTokProductUrl(currentUrl);
    if (!product) return currentUrl;

    const { parsedUrl, country, itemId } = product;
    const searchParams = new URLSearchParams(parsedUrl.search);

    if (targetMode === MODE_A || targetMode === MODE_B) {
        if (country && !searchParams.get("region")) searchParams.set("region", country.toUpperCase());
        const targetDomain = targetMode === MODE_A ? DOMAIN_A_TARGET : DOMAIN_B;
        const query = searchParams.toString();
        return `https://${targetDomain}/view/product/${itemId}${query ? `?${query}` : ""}${parsedUrl.hash}`;
    }

    if (targetMode === MODE_C) {
        searchParams.delete("region");
        const query = searchParams.toString();
        return `https://${DOMAIN_C}/shop/${country.toLowerCase()}/pdp/${itemId}${query ? `?${query}` : ""}${parsedUrl.hash}`;
    }

    return currentUrl;
}

function isConnectionErrorPage() {
    return document.body && document.body.innerText.includes("ERR_CONNECTION_TIMED_OUT");
}

function isTargetUrl(url) {
    if (url.includes(DOMAIN_B)) return true;
    if (url.includes(DOMAIN_A_TARGET)) return true;
    return !!parseTikTokProductUrl(url);
}

async function checkAndRedirect() {
    const currentUrl = window.location.href;

    if (!isTargetUrl(currentUrl)) {
        return;
    }

    if (!isConnectionErrorPage()) {
        return;
    }

    const { REDIRECT_MODE } = await chrome.storage.local.get("REDIRECT_MODE");
    const mode = REDIRECT_MODE || MODE_NONE;

    if (![MODE_A, MODE_B, MODE_C].includes(mode)) {
        return;
    }

    const newUrl = buildTikTokProductUrl(currentUrl, mode);

    if (newUrl !== currentUrl) {
        console.log(`[Content Script redirect] ${currentUrl} -> ${newUrl}`);
        window.location.replace(newUrl);
    }
}

setTimeout(checkAndRedirect, 500);
window.addEventListener("load", checkAndRedirect);
