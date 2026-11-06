(function(root){
'use strict';
const countries = {
    "US": {
        name: "美国 (US)",
        platforms: [
            { name: '1-Walmart', url: 'https://www.walmart.com/search?q=[KEYWORD]', id: 'wm_us', checked: true },
            { name: '2-Amazon', url: 'https://www.amazon.com/s?k=[KEYWORD]', id: 'az_us', checked: true },
            { name: 'eBay', url: 'https://www.ebay.com/sch/i.html?_nkw=[KEYWORD]', id: 'ebay_us', checked: false }
        ]
    },
    "BR": {
        name: "巴西 (BR)",
        platforms: [
            { name: '1-Mercado Livre', url: 'https://lista.mercadolivre.com.br/[KEYWORD]#D[A:[KEYWORD]]', id: 'ml_br', checked: true },
            { name: '2-Amazon', url: 'https://www.amazon.com.br/s?k=[KEYWORD]&__mk_pt_BR=%C3%85M%C3%85%C5%BD%C3%95%C3%91&ref=nb_sb_noss_2', id: 'az_br', checked: true },
            // Shopee: 保持小写转换
            { name: '3-Shopee', url: 'https://shopee.com.br/search?keyword=[KEYWORD]', id: 'shp_br', checked: true, forceLowercase: true },
            { name: 'AliExpress', url: 'https://pt.aliexpress.com/wholesale?SearchText=[KEYWORD]', id: 'ali-br', checked: false },
            { name: 'OLX', url: 'https://www.olx.com.br/brasil?q=[KEYWORD]', id: 'olx-br', checked: false },
            { name: 'TT-FastMoss', url: 'https://www.fastmoss.com/zh/e-commerce/search?page=1&words=[KEYWORD]&region=BR', id: 'fm_br', checked: true },
            { name: 'TT-Echotik', url: 'https://echotik.live/products?page=1&keyword=[KEYWORD]&type=1&order=total_sale_nd_cnt&sort=desc&per_page=50&country=BR', id: 'et_tt', checked: true }
        ]
    },
    "MX": {
        name: "墨西哥 (MX)",
        platforms: [
            { name: '1-Mercado Libre', url: 'https://listado.mercadolibre.com.mx/[KEYWORD]#D[A:[KEYWORD]]', id: 'ml_mx', checked: true },
            { name: '2-Amazon', url: 'https://www.amazon.com.mx/s?k=[KEYWORD]&__mk_es_MX=%C3%85M%C3%85%C5%BD%C3%95%C3%91&ref=nb_sb_noss_1', id: 'az_mx', checked: true },
            { name: 'AliExpress', url: 'https://es.aliexpress.com/wholesale?SearchText=[KEYWORD]', id: 'ali_mx', checked: false },
            { name: 'Temu', url: 'https://www.temu.com/search_result.html?search_key=[KEYWORD]&search_method=user&srch_enter_source=top_search_entrance_10005', id: 'temu', checked: false },
            { name: 'TT-FastMoss', url: 'https://www.fastmoss.com/zh/e-commerce/search?page=1&words=[KEYWORD]&region=MX', id: 'fm_mx', checked: true },
            { name: 'TT-Echotik', url: 'https://echotik.live/products?page=1&keyword=[KEYWORD]&type=1&order=total_sale_nd_cnt&sort=desc&per_page=50&country=MX', id: 'et_tt', checked: true }
        ]
    },
    "ID": {
        name: "印度尼西亚 (ID)",
        platforms: [
            { name: 'TT-FastMoss', url: 'https://www.fastmoss.com/zh/e-commerce/search?page=1&words=[KEYWORD]&region=ID', id: 'fm_id', checked: true },
            { name: 'TT-Echotik', url: 'https://echotik.live/products?page=1&keyword=[KEYWORD]&type=1&order=total_sale_nd_cnt&sort=desc&per_page=50&country=ID', id: 'et_tt', checked: true },
            // Shopee: 保持小写转换
            { name: '1-Shopee', url: 'https://shopee.co.id/search?keyword=[KEYWORD]', id: 'shp_id', checked: true, forceLowercase: true },
            { name: '2-Tokopedia', url: 'https://www.tokopedia.com/search?q=[KEYWORD]', id: 'toko', checked: true, forcePlusSpace: true },
            { name: 'Blibli', url: 'https://www.blibli.com/cari/[KEYWORD]', id: 'bilbil', checked: false },
            { name: 'Lazada', url: 'https://www.lazada.co.id/catalog/?q=[KEYWORD]', id: 'laz_id', checked: false }
        ]
    },
    "PH": {
        name: "菲律宾 (PH)",
        platforms: [
            { name: 'TT-FastMoss', url: 'https://www.fastmoss.com/zh/e-commerce/search?page=1&words=[KEYWORD]&region=PH', id: 'fm_ph', checked: true },
            { name: 'TT-Echotik', url: 'https://echotik.live/products?page=1&keyword=[KEYWORD]&type=1&order=total_sale_nd_cnt&sort=desc&per_page=50&country=PH', id: 'et_tt', checked: true },
            // Shopee: 保持小写转换
            { name: '1-Shopee', url: 'https://shopee.ph/search?keyword=[KEYWORD]', id: 'shp_ph', checked: true, forceLowercase: true },
            { name: '2-Lazada', url: 'https://www.lazada.com.ph/catalog/?q=[KEYWORD]', id: 'laz_ph', checked: true }
        ]
    },
    "MY": {
        name: "马来西亚 (MY)",
        platforms: [
            { name: 'TT-FastMoss', url: 'https://www.fastmoss.com/zh/e-commerce/search?page=1&words=[KEYWORD]&region=MY', id: 'fm_my', checked: true },
            { name: 'TT-Echotik', url: 'https://echotik.live/products?page=1&keyword=[KEYWORD]&type=1&order=total_sale_nd_cnt&sort=desc&per_page=50&country=MY', id: 'et_tt', checked: true },
            // Shopee: 保持小写转换
            { name: '1-Shopee', url: 'https://shopee.com.my/search?keyword=[KEYWORD]', id: 'shp_my', checked: true, forceLowercase: true },
            { name: 'Lazada', url: 'https://www.lazada.com.my/catalog/?q=[KEYWORD]', id: 'laz_my', checked: false },
            { name: 'Mudah', url: 'https://www.mudah.my/malaysia/all?q=[KEYWORD]', id: 'mudah', checked: false, forcePlusSpace: true }
        ]
    },
    "VN": {
        name: "越南 (VN)",
        platforms: [
            { name: 'TT-FastMoss', url: 'https://www.fastmoss.com/zh/e-commerce/search?page=1&words=[KEYWORD]&region=VN', id: 'fm_vn', checked: true },
            { name: 'TT-Echotik', url: 'https://echotik.live/products?page=1&keyword=[KEYWORD]&type=1&order=total_sale_nd_cnt&sort=desc&per_page=50&country=VN', id: 'et_tt', checked: true },
            // Shopee: 保持小写转换
            { name: '1-Shopee', url: 'https://shopee.vn/search?keyword=[KEYWORD]', id: 'shp_vn', checked: true, forceLowercase: true },
            { name: 'Lazada', url: 'https://www.lazada.vn/catalog/?q=[KEYWORD]', id: 'laz_vn', checked: false }
        ]
    },
    "TH": {
        name: "泰国 (TH)",
        platforms: [
            { name: 'TT-FastMoss', url: 'https://www.fastmoss.com/zh/e-commerce/search?page=1&words=[KEYWORD]&region=TH', id: 'fm_th', checked: true },
            { name: 'TT-Echotik', url: 'https://echotik.live/products?page=1&keyword=[KEYWORD]&type=1&order=total_sale_nd_cnt&sort=desc&per_page=50&country=TH', id: 'et_tt', checked: true },
            // Shopee: 保持小写转换
            { name: '1-Shopee', url: 'https://shopee.co.th/search?keyword=[KEYWORD]', id: 'shp_th', checked: true, forceLowercase: true },
            { name: '2-Lazada', url: 'https://www.lazada.co.th/catalog/?q=[KEYWORD]', id: 'laz_th', checked: true }
        ]
    },
    "SG": {
        name: "新加坡 (SG)",
        platforms: [
            { name: 'TT-FastMoss', url: 'https://www.fastmoss.com/zh/e-commerce/search?page=1&words=[KEYWORD]&region=SG', id: 'fm_sg', checked: true },
            { name: 'TT-Echotik', url: 'https://echotik.live/products?page=1&keyword=[KEYWORD]&type=1&order=total_sale_nd_cnt&sort=desc&per_page=50&country=SG', id: 'et_tt', checked: true },
            // Shopee: 保持小写转换
            { name: '1-Shopee', url: 'https://shopee.sg/search?keyword=[KEYWORD]', id: 'shp_sg', checked: true, forceLowercase: true },
            { name: 'Carousell', url: 'https://www.carousell.sg/search/[KEYWORD]', id: 'carousell', checked: false },
            { name: 'Amazon', url: 'https://www.amazon.sg/s?k=[KEYWORD]&ref=nb_sb_noss', id: 'az_sg', checked: false },
            { name: 'Lazada', url: 'https://www.lazada.sg/catalog/?q=[KEYWORD]', id: 'laz_sg', checked: false }
        ]
    },
};
function buildUrl(platform,keyword){let value=platform.forceLowercase?keyword.toLowerCase():keyword;let encoded=encodeURIComponent(value);if(platform.forcePlusSpace)encoded=encoded.replace(/%20/g,'+');return platform.url.replace(/\[KEYWORD\]/g,encoded);}
const api={countries,buildUrl};root.IantoSearchPlatforms=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(globalThis);
