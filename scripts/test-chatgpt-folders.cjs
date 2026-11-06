// Browser regression tests. Requires Playwright (NODE_PATH may point to a temporary install).
// Uses the installed Chrome/Edge, an isolated profile, and a local fixture; no ChatGPT account is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const source = fs.readFileSync(process.env.IANTO_CHATGPT_SOURCE || path.join(__dirname, '../content_scripts/content_chatgpt_adjuster.js'), 'utf8');
const key = 'chatgpt_custom_folders_data';
const href = id => `https://chatgpt.com/c/chat-${id}-12345678`;
const conv = id => ({ href: href(id), title: id });
const initial = [
  { name: 'Alpha', open: true, convs: ['a', 'lazy', 'pinned', 'b', 'c'].map(conv) },
  { name: 'Beta', open: true, convs: ['d', 'e'].map(conv) },
  { name: 'Empty', open: false, convs: [] }
];
const row = id => `<div role="listitem" data-row="${id}"><a data-sidebar-item href="${href(id)}"><span class="truncate">${id}</span></a><button title="More options" aria-label="Chat actions" aria-haspopup="menu" aria-expanded="false">···</button></div>`;
const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
body { margin: 0; font: 14px Arial; background: #151515; color: white; }
nav { width: 280px; height: 850px; overflow-y: auto; }
nav, #recents { contain: layout paint; }
[role="listitem"] { height: 40px; display: flex; align-items: center; box-sizing: border-box; }
[role="listitem"] > a { color: inherit; display: block; flex: 1; padding: 10px 16px; text-decoration: none; }
button { color: inherit; background: #333; border: 0; }
h2 { font-size: 13px; margin: 12px; }
</style></head><body><nav><section data-section="recents"><h2>Recents</h2><div role="list" id="recents">
${['unclassified', 'reserve', 'a', 'b', 'c', 'd', 'e'].map(row).join('')}
</div></section><section data-section="pinned"><h2>Pinned</h2><div role="list" id="pinned">${row('pinned')}</div></section></nav>
<script>
const defaults = ${JSON.stringify({ [key]: initial, chatgpt_width_enabled: true })};
window.fixtureStorage = JSON.parse(localStorage.getItem('fixtureStorage') || JSON.stringify(defaults));
window.fixtureWrites = 0;
window.fixtureMessageListener = null;
window.fixtureNativeRows = new Map(Array.from(document.querySelectorAll('[data-row]')).map(row => [row.dataset.row, {
  row, parent: row.parentElement, link: row.querySelector('a'), menu: row.querySelector('button')
}]));
window.fixtureNavigations = [];
window.fixtureMenuClicks = 0;
window.fixtureActions = [];
window.fixtureLastTriggerTrusted = false;
window.fixtureCloseMenu = () => {
  document.querySelectorAll('[data-fixture-menu]').forEach(menu => menu.remove());
  document.querySelectorAll('[data-row] button[aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
};
document.addEventListener('pointerdown', event => {
  const trigger = event.target.closest('[data-row] button[aria-haspopup="menu"]');
  if (!trigger || event.button !== 0) return;
  fixtureLastTriggerTrusted = event.isTrusted;
  trigger.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
});
// Model the native Radix keyboard trigger and portaled menu without cloning handlers.
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { fixtureCloseMenu(); return; }
  const trigger = event.target.closest('[data-row] button[aria-haspopup="menu"]');
  if (!trigger || event.key !== 'ArrowDown') return;
  event.preventDefault();
  fixtureCloseMenu();
  const nativeRow = trigger.closest('[data-row]');
  const link = nativeRow.querySelector('a');
  const id = nativeRow.dataset.row;
  const menu = document.createElement('div');
  menu.dataset.fixtureMenu = 'true';
  menu.setAttribute('role', 'menu');
  menu.tabIndex = -1;
  const rect = trigger.getBoundingClientRect();
  menu.style.cssText = 'position:fixed;z-index:100000;background:#333;padding:8px;display:flex;flex-direction:column;left:' + rect.left + 'px;top:' + rect.bottom + 'px';
  const removeNative = () => { nativeRow.remove(); fixtureNativeRows.delete(id); };
  const labels = ['Rename', nativeRow.closest('#pinned') ? 'Unpin' : 'Pin', 'Share', 'Archive', 'Delete', 'Move to project'];
  labels.forEach(label => {
    const item = document.createElement('button');
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    item.onclick = () => {
      fixtureActions.push({id, action:label});
      fixtureCloseMenu();
      if (label === 'Rename') {
        const input = document.createElement('input');
        input.value = link.querySelector('.truncate').textContent;
        link.hidden = true;
        nativeRow.insertBefore(input, link);
        input.onkeydown = event => {
          if (event.key === 'Enter') link.querySelector('.truncate').textContent = input.value;
          if (event.key === 'Enter' || event.key === 'Escape') { input.remove(); link.hidden = false; }
        };
        input.focus();
      } else if (label === 'Pin' || label === 'Unpin') {
        document.querySelector(label === 'Pin' ? '#pinned' : '#recents').appendChild(nativeRow);
        const state = fixtureNativeRows.get(id);
        if (state) state.parent = nativeRow.parentElement;
      } else if (label === 'Archive') {
        removeNative();
      } else {
        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-label', label);
        dialog.style.cssText = 'position:fixed;left:350px;top:100px;background:#333;z-index:100001;padding:20px';
        dialog.textContent = label + ' ' + id;
        const close = document.createElement('button');
        close.textContent = 'Cancel';
        close.onclick = () => dialog.remove();
        dialog.appendChild(close);
        if (label === 'Delete') {
          const confirm = document.createElement('button');
          confirm.textContent = 'Confirm delete';
          confirm.onclick = () => { removeNative(); dialog.remove(); };
          dialog.appendChild(confirm);
        }
        document.body.appendChild(dialog);
        close.focus();
      }
    };
    menu.appendChild(item);
  });
  trigger.setAttribute('aria-expanded', 'true');
  document.body.appendChild(menu);
  menu.focus();
});
document.querySelector('nav').addEventListener('click', event => {
  const link = event.target.closest('[data-row] > a');
  if (link) { event.preventDefault(); fixtureNavigations.push(link.href); }
  if (event.target.matches('[data-row] > button[title="More options"]')) fixtureMenuClicks++;
});
window.chrome = {
  storage: { local: {
    get(keys, callback) { const result = {}; keys.forEach(key => result[key] = structuredClone(fixtureStorage[key])); setTimeout(() => callback(result), 0); },
    set(data, callback) { Object.assign(fixtureStorage, structuredClone(data)); localStorage.setItem('fixtureStorage', JSON.stringify(fixtureStorage)); if ('${key}' in data) window.fixtureWrites++; if (callback) setTimeout(callback, 0); }
  } },
  runtime: { onMessage: { addListener(listener) { window.fixtureMessageListener = listener; } } }
};
window.fixtureToggle = () => new Promise(resolve => fixtureMessageListener({action:'toggleChatGPTWidth'}, {}, resolve));
</script><script src="/adjuster.js"></script></body></html>`;

async function main() {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/adjuster.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    response.end(request.url === '/adjuster.js' ? source : fixture);
  });
  let browser;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const executablePath = process.env.CHROME_PATH || [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    ].find(candidate => fs.existsSync(candidate));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const page = await browser.newPage({ viewport: { width: 1000, height: 950 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('#ianto-folder-list > .ianto-folder');
    const folder = name => page.locator('.ianto-folder').filter({ has: page.locator(`.ianto-folder-del[data-folder="${name}"]`) });
    const bookmark = id => page.locator('.ianto-folder-content > .ianto-chat-item').filter({has: page.locator(`a[href="${href(id)}"]`)});
    const data = () => page.evaluate(key => structuredClone(window.fixtureStorage[key]), key);
    const visible = name => folder(name).locator('.ianto-folder-content > .ianto-chat-item').evaluateAll(rows => rows.map(row => new URL(row.querySelector('a').href).pathname.match(/chat-(.*)-12345678/)[1]));
    const expected = structuredClone(initial);
    const expectedFolder = name => expected.find(folder => folder.name === name);
    const expectSaved = async () => {
      await page.mouse.move(800, 20);
      await page.waitForFunction(({ key, expected }) => JSON.stringify(fixtureStorage[key]) === JSON.stringify(expected), { key, expected });
      await page.waitForTimeout(80);
      assert.deepEqual(await data(), expected);
      assert.deepEqual(await page.locator('#ianto-folder-list > .ianto-folder .ianto-folder-del').evaluateAll(nodes => nodes.map(node => node.dataset.folder)), expected.map(folder => folder.name));
      assert.equal(await page.locator('#ianto-folder-manager > .ianto-folder').count(), 0, 'Folders must stay inside the nested list');
      assert.equal(await page.locator('[role="list"] #ianto-folder-manager').count(), 0, 'Manager must stay outside native lists');
      assert.equal(await page.locator('#ianto-folder-manager [data-row]').count(), 0, 'Manager must never contain native rows');
      assert.equal(await page.evaluate(() => [...fixtureNativeRows.values()].every(({row, parent, link, menu}) =>
        row.parentElement === parent && link.parentElement === row && menu.parentElement === row)), true, 'Every native row, link and menu must retain its original parent');
      assert.equal(await page.locator('#pinned [data-row="pinned"]').count(), 1, 'Native pinned row must stay pinned');
      const savedHrefs = expected.flatMap(folder => folder.convs.map(conv => conv.href));
      await page.waitForFunction(saved => {
        const classified = new Set(saved);
        return Array.from(document.querySelectorAll('nav [data-row]')).every(row => {
          const shouldHide = classified.has(row.querySelector('a').href) && !row.closest('#pinned');
          const style = getComputedStyle(row);
          return (style.display === 'none' || style.visibility === 'hidden') === shouldHide;
        });
      }, savedHrefs, {timeout: 3000}).catch(async error => {
        console.error('Visibility mismatch', await page.locator('nav [data-row]').evaluateAll(rows => rows.map(row => ({id:row.dataset.row,display:getComputedStyle(row).display,visibility:getComputedStyle(row).visibility,classes:row.className}))));
        throw error;
      });
      assert.equal(await page.locator('.dragging, .drag-over-top, .drag-over-bottom, .drag-over-inside').count(), 0, 'Drag feedback must be cleared');
    };
    const drag = async (source, target, after = false, kind = 'row') => {
      const from = await source.boundingBox();
      const to = await target.boundingBox();
      assert(from && to, 'Drag source and destination must be visible');
      await page.mouse.move(from.x + 55, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 65, from.y + from.height / 2, { steps: 4 });
      const y = kind === 'header' ? to.y + to.height / 2 : after ? to.y + to.height - 3 : to.y + 3;
      await page.mouse.move(to.x + 70, y, { steps: 22 });
      await page.mouse.move(to.x + 71, y);
      await page.mouse.up();
    };
    const moveFolder = async (name, targetName, after) => {
      const moved = expectedFolder(name);
      const target = expectedFolder(targetName);
      expected.splice(expected.indexOf(moved), 1);
      expected.splice(expected.indexOf(target) + (after ? 1 : 0), 0, moved);
      await drag(folder(name).locator('.ianto-folder-title'), folder(targetName), after);
      await expectSaved();
    };
    const moveBookmark = async (id, sourceName, targetName, targetId = null, after = false) => {
      const sourceFolder = sourceName && expectedFolder(sourceName);
      const moved = sourceFolder ? sourceFolder.convs.find(item => item.href === href(id)) : conv(id);
      if (sourceFolder) sourceFolder.convs = sourceFolder.convs.filter(item => item.href !== href(id));
      const target = expectedFolder(targetName);
      const anchor = targetId ? target.convs.findIndex(item => item.href === href(targetId)) : -1;
      target.convs.splice(anchor < 0 ? target.convs.length : anchor + (after ? 1 : 0), 0, moved);
      target.open = true;
      const sourceRow = sourceName ? bookmark(id) : page.locator(`[data-row="${id}"]`);
      await drag(sourceRow.locator('a'), targetId ? bookmark(targetId) : folder(targetName).locator('.ianto-folder-title'), after, targetId ? 'row' : 'header');
      await expectSaved();
    };

    await expectSaved();
    assert.deepEqual(await visible('Alpha'), ['a', 'lazy', 'b', 'c']);
    const openBookmarkMenu = async id => {
      await page.mouse.move(800, 20);
      await page.waitForTimeout(260);
      await bookmark(id).locator('.ianto-chat-menu').click({force:true});
      await page.getByRole('menu').waitFor();
      assert.equal(await page.evaluate(() => fixtureLastTriggerTrusted), true, 'The native trigger must receive the real user pointer event');
      assert.equal(await page.locator('.ianto-native-menu-source').count(), 1);
      assert.equal(await page.evaluate(() => [...fixtureNativeRows.values()].every(({row, parent}) => row.parentElement === parent)), true, 'Opening a menu must never reparent native rows');
    };
    const closeBookmarkMenu = async () => {
      await page.getByRole('menu').press('Escape');
      await page.mouse.move(800, 20);
      await page.waitForSelector('.ianto-native-menu-source', {state:'detached'});
      assert.equal(await page.locator('.ianto-native-menu-uncontained').count(), 0, 'Closing a menu must restore the original sidebar containment');
      await expectSaved();
    };
    assert.equal(await bookmark('lazy').locator('.ianto-chat-menu').isDisabled(), true, 'An unloaded native menu must not pretend to be available');
    await openBookmarkMenu('a');
    assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['Rename', 'Pin', 'Share', 'Archive', 'Delete', 'Move to project']);
    const anchor = await bookmark('a').boundingBox();
    const nativeAnchor = await page.locator('[data-row="a"]').boundingBox();
    assert(Math.abs(anchor.y - nativeAnchor.y) < 1 && Math.abs(anchor.x - nativeAnchor.x) < 1, 'The original menu anchor must be positioned at the bookmark');
    await closeBookmarkMenu();

    await openBookmarkMenu('a');
    await page.getByRole('menuitem', {name:'Rename',exact:true}).click();
    await page.locator('[data-row="a"] input').fill('a renamed');
    await page.locator('[data-row="a"] input').press('Enter');
    await page.waitForSelector('.ianto-native-menu-source', {state:'detached'});
    await page.waitForFunction(href => Array.from(document.querySelectorAll('.ianto-chat-item')).some(row => row.querySelector('a').href === href && row.querySelector('.ianto-chat-title').textContent === 'a renamed'), href('a'));
    await expectSaved();

    await openBookmarkMenu('a');
    await page.getByRole('menuitem', {name:'Pin',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#pinned > [data-row="a"]'));
    await page.waitForFunction(href => !Array.from(document.querySelectorAll('.ianto-chat-item a')).some(a => a.href === href), href('a'));
    await page.locator('[data-row="a"] > button[title="More options"]').press('ArrowDown');
    await page.getByRole('menuitem', {name:'Unpin',exact:true}).click();
    await bookmark('a').waitFor();
    await expectSaved();

    for (const action of ['Share', 'Move to project', 'Delete']) {
      await openBookmarkMenu('a');
      await page.getByRole('menuitem', {name:action,exact:true}).click();
      await page.getByRole('dialog', {name:action,exact:true}).getByRole('button', {name:'Cancel',exact:true}).click();
      await page.waitForSelector('.ianto-native-menu-source', {state:'detached'});
      await expectSaved();
    }
    console.log('PASS: classified chats open their original six-item menus, support inline rename and Pin/Unpin, and preserve canceled actions');
    expectedFolder('Alpha').open = false;
    await folder('Alpha').locator('.ianto-folder-title').click();
    await expectSaved();
    expectedFolder('Alpha').open = true;
    await folder('Alpha').locator('.ianto-folder-title').click();
    await expectSaved();
    await page.locator('#ianto-main-toggle').click();
    await expectSaved();
    await page.locator('#ianto-main-toggle').click();
    await expectSaved();
    console.log('PASS: classified chats are hidden only in Recents, including when their folders are collapsed');
    await moveFolder('Empty', 'Alpha', false);
    await moveFolder('Empty', 'Beta', true);
    console.log('PASS: real mouse folder drag in both directions, nested container and unloaded bookmark preservation');

    await moveBookmark('c', 'Alpha', 'Alpha', 'a');
    assert.deepEqual(await visible('Alpha'), ['c', 'a', 'lazy', 'b']);
    await moveBookmark('a', 'Alpha', 'Alpha', 'b', true);
    assert.deepEqual(await visible('Alpha'), ['c', 'lazy', 'b', 'a']);
    await moveBookmark('a', 'Alpha', 'Beta', 'e');
    assert.deepEqual(await visible('Beta'), ['d', 'a', 'e']);
    await moveBookmark('e', 'Beta', 'Empty');
    await moveFolder('Beta', 'Alpha', false);
    await moveBookmark('d', 'Beta', 'Empty', 'e', true);
    await moveBookmark('unclassified', null, 'Empty', 'e');
    console.log('PASS: real mouse bookmark sorting, cross-folder placement, collapsed empty folder and native chat classification');

    const writes = await page.evaluate(() => fixtureWrites);
    await drag(bookmark('e').locator('a'), bookmark('e'));
    await expectSaved();
    assert.equal(await page.evaluate(() => fixtureWrites), writes, 'Dropping onto itself must not write');
    const from = await bookmark('e').boundingBox();
    await page.mouse.move(from.x + 50, from.y + 15);
    await page.mouse.down();
    await page.mouse.move(from.x + 70, from.y + 25, { steps: 4 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expectSaved();
    console.log('PASS: self-drop and canceled drag preserve data and clear indicators');

    await page.reload();
    await page.waitForSelector('#ianto-folder-list .ianto-chat-item');
    await expectSaved();
    assert.deepEqual(await visible('Empty'), ['unclassified', 'e', 'd']);
    await page.locator('#recents').evaluate((list, html) => list.insertAdjacentHTML('beforeend', html), row('lazy'));
    await page.waitForFunction(() => document.querySelector('[data-row="lazy"] .ianto-classify-btn'));
    assert.deepEqual(await visible('Alpha'), ['c', 'lazy', 'b']);
    await expectSaved();
    console.log('PASS: saved order survives reload and late native row loading');

    // Removal must resolve the current folder after a bookmark has moved more than once.
    expectedFolder('Empty').convs = expectedFolder('Empty').convs.filter(item => item.href !== href('d'));
    await page.waitForTimeout(260);
    await bookmark('d').hover();
    await bookmark('d').locator('.ianto-unarchive-btn').click();
    await expectSaved();
    assert.equal(await bookmark('d').count(), 0);
    assert.equal(await page.locator('#recents > [data-row="d"]').count(), 1);
    await page.waitForTimeout(260);
    await bookmark('b').locator('a').click();
    assert.deepEqual(await page.evaluate(() => fixtureNavigations), [href('b')], 'Bookmark must use native SPA navigation when its original link is loaded');
    const menuClicksBefore = await page.evaluate(() => fixtureMenuClicks);
    await page.locator('[data-row="d"] > button[title="More options"]').click();
    assert.equal(await page.evaluate(() => fixtureMenuClicks), menuClicksBefore + 1, 'Native menu must remain usable after removing a chat from its folder');
    await page.getByRole('menu').press('Escape');
    console.log('PASS: bookmark navigation and restored native conversation menus remain functional');

    // Match the DOM operations a React commit performs, using the references it retained.
    // The old adjuster reparented these rows, so removeChild/insertBefore threw NotFoundError.
    await page.evaluate(() => {
      const {row, parent, link, menu} = fixtureNativeRows.get('b');
      for (let i = 0; i < 20; i++) {
        const replacement = row.cloneNode(true);
        replacement.dataset.row = 'temporary';
        parent.insertBefore(replacement, row);
        parent.removeChild(row);
        parent.insertBefore(row, replacement);
        parent.removeChild(replacement);
        link.querySelector('.truncate').firstChild.data = 'b update ' + i;
        if (link.parentElement !== row || menu.parentElement !== row) throw new Error('Native children were detached');
      }
    });
    await page.waitForFunction(href => Array.from(document.querySelectorAll('.ianto-chat-item')).some(row =>
      row.querySelector('a').href === href && row.querySelector('.ianto-chat-title').textContent === 'b update 19'), href('b'));
    await expectSaved();
    console.log('PASS: 20 native sidebar remove/insert updates preserve parent references and refresh bookmark titles');

    // Original Pin/Unpin controls must be free to move the native row themselves.
    await page.evaluate(() => {
      const state = fixtureNativeRows.get('b');
      const button = document.createElement('button');
      button.textContent = 'Pin chat';
      button.onclick = () => {
        document.querySelector('#pinned').appendChild(state.row);
        state.parent = state.row.parentElement;
        button.textContent = 'Unpin chat';
        button.onclick = () => {
          document.querySelector('#recents').appendChild(state.row);
          state.parent = state.row.parentElement;
          button.remove();
        };
      };
      button.id = 'fixture-pin';
      state.row.appendChild(button);
    });
    await page.locator('#fixture-pin').evaluate(button => button.click());
    await page.waitForFunction(href => !Array.from(document.querySelectorAll('.ianto-chat-item a')).some(a => a.href === href), href('b'));
    assert.equal(await page.locator('#pinned > [data-row="b"]').count(), 1);
    await page.locator('#fixture-pin').click();
    await bookmark('b').waitFor();
    await expectSaved();
    console.log('PASS: native Pin/Unpin controls retain ownership of rows and synchronize bookmarks');

    // Full list/sidebar remounts happen during routing; extension data must survive them.
    await page.evaluate(() => {
      const list = document.querySelector('#recents');
      const replacement = list.cloneNode(true);
      replacement.querySelectorAll('.ianto-classify-btn').forEach(button => button.remove());
      replacement.querySelectorAll('[data-row]').forEach(row => { row.classList.remove('ianto-native-wrap', 'ianto-classified-native'); row.removeAttribute('draggable'); });
      list.replaceWith(replacement);
      fixtureNativeRows.clear();
    });
    await expectSaved();
    await page.evaluate(() => {
      const nav = document.querySelector('nav');
      const replacement = nav.cloneNode(true);
      replacement.querySelector('#ianto-folder-manager').remove();
      replacement.querySelectorAll('.ianto-classify-btn').forEach(button => button.remove());
      replacement.querySelectorAll('[data-row]').forEach(row => { row.classList.remove('ianto-native-wrap', 'ianto-classified-native'); row.removeAttribute('draggable'); });
      nav.replaceWith(replacement);
    });
    await page.waitForSelector('#ianto-folder-manager');
    await expectSaved();
    console.log('PASS: native list and full sidebar replacement rebuild the folder UI without data loss');

    await page.waitForTimeout(250);
    await page.evaluate(() => {
      window.fixtureSidebarScans = 0;
      const originalQuery = document.querySelectorAll.bind(document);
      document.querySelectorAll = selector => {
        if (selector === 'nav a[href*="/c/"][data-sidebar-item]') fixtureSidebarScans++;
        return originalQuery(selector);
      };
      const main = document.createElement('main');
      main.id = 'fixture-stream';
      document.body.appendChild(main);
      for (let i = 0; i < 100; i++) main.appendChild(document.createTextNode('token ' + i));
    });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => fixtureSidebarScans), 0, 'Streaming chat content must not trigger sidebar scans');
    console.log('PASS: streamed chat updates do not rescan the sidebar');

    // Disable before a queued observer callback fires; it must not remount afterward.
    const nativeBeforeToggle = await page.locator('nav [data-row]').count();
    await openBookmarkMenu('b');
    for (let i = 0; i < 3; i++) {
      await page.locator('#recents').evaluate(list => list.appendChild(document.createElement('span')));
      assert.deepEqual(await page.evaluate(() => fixtureToggle()), {enabled: false});
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#ianto-folder-manager, #ianto-gpt-width-style, #ianto-gpt-css, #ianto-gpt-native-menu-position, .ianto-classify-btn, .ianto-native-wrap, .ianto-classified-native, .ianto-native-menu-source, .ianto-native-menu-uncontained, [data-fixture-menu]').count(), 0, 'Disable must remove extension UI, close its native menu and cancel pending work');
      assert.equal(await page.locator('nav [data-row]').count(), nativeBeforeToggle, 'Disable must never delete native rows');
      assert.equal(await page.locator('nav [data-row] > a').count(), nativeBeforeToggle, 'Disable must never detach native links');
      assert.equal(await page.locator('nav [data-row][draggable]').count(), 0, 'Native draggable attributes must be restored');
      assert.equal(await page.locator('nav [data-row]').evaluateAll(rows => rows.every(row => getComputedStyle(row).display !== 'none')), true, 'Disable must restore all native conversations');
      assert.deepEqual(await page.evaluate(() => fixtureToggle()), {enabled: true});
      await expectSaved();
    }
    console.log('PASS: repeated disable/enable cancels pending updates, preserves native DOM and restores classification');
    await moveBookmark('reserve', null, 'Empty');
    await openBookmarkMenu('reserve');
    expectedFolder('Empty').convs = expectedFolder('Empty').convs.filter(conv => conv.href !== href('reserve'));
    await page.getByRole('menuitem', {name:'Archive',exact:true}).click();
    await expectSaved();
    assert.equal(await bookmark('reserve').count(), 0, 'A native archive action must remove its bookmark');

    await page.locator('#recents').evaluate((list, html) => {
      list.insertAdjacentHTML('beforeend', html);
      const row = list.lastElementChild;
      fixtureNativeRows.set(row.dataset.row, {row, parent:list, link:row.querySelector('a'), menu:row.querySelector('button')});
    }, row('deletecase'));
    await page.waitForSelector('[data-row="deletecase"] .ianto-classify-btn', {state:'attached'});
    await moveBookmark('deletecase', null, 'Empty');
    await openBookmarkMenu('deletecase');
    await page.getByRole('menuitem', {name:'Delete',exact:true}).click();
    expectedFolder('Empty').convs = expectedFolder('Empty').convs.filter(conv => conv.href !== href('deletecase'));
    await page.getByRole('button', {name:'Confirm delete',exact:true}).click();
    await expectSaved();
    assert.equal(await bookmark('deletecase').count(), 0, 'A confirmed native delete action must remove its bookmark');
    console.log('PASS: native Archive and confirmed Delete clean up bookmarks only after the original row is removed');
    expected.splice(expected.indexOf(expectedFolder('Alpha')), 1);
    page.once('dialog', dialog => dialog.accept());
    await folder('Alpha').locator('.ianto-folder-del').click();
    await expectSaved();
    console.log('PASS: deleting a folder restores its native conversations without moving or deleting rows');
    assert.deepEqual(errors, []);
    console.log('PASS: no uncaught browser exceptions throughout regression scenarios');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
