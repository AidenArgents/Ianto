const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../features/lingxing_erp.js'), 'utf8');

function fixture(overrides = {}, options = {}) {
    const calls = [];
    const product = { id: 1, sku: 'Exact-SKU', product_name: 'Test product', cg_price: '5.1234',
        spec_info: { spec_pack_list: [{ is_default: 1, cg_product_gross_weight: '100',
            cg_product_gross_weight_unit: 'g', cg_package_length: '10', cg_package_width: '5',
            cg_package_height: '2', cg_package_spec_unit: 'cm' }] }, ...overrides };
    const client = {
        async $post(url, params) {
            calls.push({ url, params });
            return options.list || { code: 1, list: [{ id: 1, sku: product.sku }] };
        },
        async $get(url, params) { calls.push({ url, params }); return { code: 1, info: product }; }
    };
    const context = { location: { origin: 'https://erp.lingxing.com' },
        document: { querySelector: () => ({ __vue__: options.loggedOut ? null : client }) },
        setTimeout, clearTimeout, console, chrome: options.chrome };
    vm.createContext(context); vm.runInContext(source, context);
    return { context, calls, product };
}

test('exact SKU lookup uses product cost, default package gross weight and dimensions', async () => {
    const { context, calls } = fixture();
    const result = await context.lingxingQueryInPage('Exact-SKU');
    assert.equal(result.success, true);
    assert.equal(result.data.costPrice, 5.1234);
    assert.deepEqual([result.data.weight, result.data.length, result.data.width, result.data.height], [100, 10, 5, 2]);
    assert.equal(result.data.__source, 'lingxing');
    assert.equal(JSON.parse(calls[0].params.senior_search_list)[0].search_value[0], 'Exact-SKU');
    assert.equal(calls[1].url, '/api/product/info');
});

test('case mismatch and duplicate SKUs never select an arbitrary product', async () => {
    for (const list of [[{ sku: 'exact-sku', id: 1 }], [{ sku: 'Exact-SKU', id: 1 }, { sku: 'Exact-SKU', id: 2 }]]) {
        const { context, calls } = fixture({}, { list: { code: 1, list } });
        assert.equal((await context.lingxingQueryInPage('Exact-SKU')).success, false);
        assert.equal(calls.length, 1);
    }
});

test('kg and inch units convert to g and cm without rounding purchase cost', async () => {
    const { context } = fixture({ spec_info: { spec_pack_list: [{ is_default: 1,
        cg_product_gross_weight: '0.25', cg_product_gross_weight_unit: 'kg',
        cg_package_length: '2', cg_package_width: '1', cg_package_height: '0.5', cg_package_spec_unit: 'in' }] } });
    const result = await context.lingxingQueryInPage('Exact-SKU');
    assert.deepEqual([result.data.weight, result.data.length, result.data.width, result.data.height], [250, 5.08, 2.54, 1.27]);
});

test('zero cost is valid and warned; missing cost fails', async () => {
    const zero = await fixture({ cg_price: '0' }).context.lingxingQueryInPage('Exact-SKU');
    assert.equal(zero.success, true); assert.equal(zero.data.costPrice, 0);
    assert.match(zero.data.warnings[0], /成本为 0/);
    for (const cg_price of [null, '', undefined, 'invalid', '-1']) {
        assert.equal((await fixture({ cg_price }).context.lingxingQueryInPage('Exact-SKU')).success, false);
    }
});

test('missing packages and unknown units return null with visible warnings', async () => {
    for (const spec_info of [{}, { spec_pack_list: [{ cg_product_gross_weight: 50, cg_product_gross_weight_unit: 'unknown' }] }]) {
        const result = await fixture({ spec_info }).context.lingxingQueryInPage('Exact-SKU');
        assert.equal(result.data.weight, null); assert.equal(result.data.length, null);
        assert.equal(result.data.warnings.length, 2);
    }
});

test('login and API errors are returned instead of falling back to the old ERP', async () => {
    assert.match((await fixture({}, { loggedOut: true }).context.lingxingQueryInPage('Exact-SKU')).error, /登录领星/);
    const { context } = fixture({}, { list: { code: 0, msg: 'denied' } });
    assert.match((await context.lingxingQueryInPage('Exact-SKU')).error, /登录状态和产品权限/);
});

test('gateway requires an existing product management tab and executes in its main world', async () => {
    const calls = [];
    const chrome = { tabs: { query: async () => [] }, scripting: { executeScript: async options => {
        calls.push(options); return [{ result: { success: true } }];
    } } };
    const { context } = fixture({}, { chrome });
    assert.equal((await context.fetchLingxingERP('Exact-SKU')).success, false);
    chrome.tabs.query = async () => [{ id: 1, url: 'https://erp.lingxing.com/erp/productManage', lastAccessed: 1 },
        { id: 2, url: 'https://erp.lingxing.com/erp/productManage', lastAccessed: 2 }];
    assert.equal((await context.fetchLingxingERP(' Exact-SKU ')).success, true);
    assert.equal(calls[0].target.tabId, 2); assert.equal(calls[0].world, 'MAIN');
    assert.equal(calls[0].args[0], 'Exact-SKU');
});

test('calculator scripts compile and have a single ERP source with correct input mappings', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../电商AI工具台/算价工具.html'), 'utf8');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (match[1].includes('application/json')) JSON.parse(match[2]);
        else new vm.Script(match[2]);
    }
    for (const old of ['getPreferDirector', 'parseDimString', 'discountCostprice', '__oversea', 'bindDetail']) assert.equal(html.includes(old), false, old);
    assert.match(html, /wt: 'weight', l: 'diml', w: 'dimw', h: 'dimh'/);
    assert.match(html, /_bFill\.active\[rowId\]\?\.requestId !== req\.requestId/);
    const bridge = fs.readFileSync(path.join(__dirname, '../content_scripts/bridge.js'), 'utf8');
    assert.match(bridge, /source: e\.detail\.source/);
});
