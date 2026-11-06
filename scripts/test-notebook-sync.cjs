// Run with Playwright available through NODE_PATH. Uses installed Chrome and isolated fixture pages.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../content_scripts/content_gemini_adjuster.js'), 'utf8');
const key = 'notebooklm_custom_folders_data';
const ids = { Alpha: '11111111-1111-4111-8111-111111111111', Beta: '22222222-2222-4222-8222-222222222222', Missing: '33333333-3333-4333-8333-333333333333', New: '44444444-4444-4444-8444-444444444444' };
const initial = [
  { name: 'Tools', isOpen: true, projects: ['Alpha', 'Missing'].map(title => ({ title, uuid: ids[title] })) },
  { name: 'Other', isOpen: false, projects: [{ title: 'Beta', uuid: ids.Beta }] }
];
const names = ['Alpha', 'Beta', 'New'];
const geminiContent = `<project-mgmt><div class="container"><div class="inner-container notebook-card-view"><div class="list-header"><h1>Notebooks</h1><button>新建笔记本</button></div><div class="your-projects"><div class="projects-section-container">${names.map(title => `<project-mgmt-row><div class="project-card-container"><div class="project-card"><div class="card-header"><button aria-label="打开笔记本操作菜单">···</button></div><div class="card-body"><span class="gds-title-l title">${title}</span><div class="card-sources">1 个来源</div></div></div></div></project-mgmt-row>`).join('')}</div></div></div></div></project-mgmt>`;
function notebookContent(all = false) {
  return `<div class="tabs"><nb-button class="${all ? 'nb-button-type-tonal' : ''}"><button>全部</button></nb-button><nb-button class="${all ? '' : 'nb-button-type-tonal'}"><button>我的笔记本</button></nb-button></div><div class="my-projects-container"><div class="projects-header-row"><h2 class="projects-header">${all ? '最近打开过的笔记本' : '我的笔记本'}</h2><button>新建笔记本</button></div><project-grid><div class="project-grid-container">${names.map(title => `<project-button><div><a class="project-card" href="/notebook/${ids[title]}"><span class="project-button-title" id="project-${ids[title]}-title">${title}</span></a><button>项目操作菜单</button></div></project-button>`).join('')}</div></project-grid></div>`;
}
const html = content => `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px Arial;margin:20px} .list-header,.projects-header-row{display:flex;justify-content:space-between}.projects-section-container,.project-grid-container{display:grid;grid-template-columns:repeat(3,260px);gap:12px} project-button,project-mgmt-row{display:block;position:relative;height:224px;background:#ddd;border-radius:12px} .project-card{display:block;padding:20px}.card-body{margin-top:80px} .nlm-folder-grid{min-height:10px}</style></head><body>${content}<script src="/adjuster.js"></script></body></html>`;

async function main() {
  let browser;
  try {
    const executablePath = process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const storage = { [key]: structuredClone(initial), gemini_optimized_enabled: true };
    let notebookWrites = 0;
    await context.exposeBinding('fixtureGet', (_, keys) => Object.fromEntries(keys.map(key => [key, storage[key]])));
    await context.exposeBinding('fixtureSet', async (_, data) => {
      const changes = {};
      for (const [name, value] of Object.entries(data)) {
        if (JSON.stringify(storage[name]) !== JSON.stringify(value)) changes[name] = { oldValue: storage[name], newValue: value };
        storage[name] = structuredClone(value);
      }
      if (key in data) notebookWrites++;
      await Promise.all(context.pages().filter(page => !page.isClosed()).map(page => page.evaluate(changes => {
        window.dispatchEvent(new CustomEvent('fixture-storage', { detail: changes }));
      }, changes).catch(error => { if (!/context was destroyed|Target closed/.test(error.message)) throw error; })));
    });
    await context.addInitScript(() => {
      const listeners = [];
      window.chrome = {
        storage: {
          local: {
            get(keys, callback) { window.fixtureGet(keys).then(callback); },
            set(data, callback) { window.fixtureSet(data).then(() => callback?.()); }
          },
          onChanged: { addListener(listener) { listeners.push(listener); } }
        },
        runtime: { onMessage: { addListener() {} } }
      };
      window.addEventListener('fixture-storage', event => listeners.forEach(listener => listener(event.detail, 'local')));
      if (location.search.includes('view=all')) sessionStorage.setItem('ianto_nlm_skip_auto_redirect', '1');
      document.addEventListener('click', event => {
        if (event.target.closest('.project-card')) window.fixtureNativeClicks = (window.fixtureNativeClicks || 0) + 1;
      });
    });
    await context.route('https://gemini.google.com/**', route => route.fulfill({ contentType: route.request().url().endsWith('adjuster.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('adjuster.js') ? source : html(geminiContent) }));
    await context.route('https://notebook.google.com/**', route => route.fulfill({ contentType: route.request().url().endsWith('adjuster.js') ? 'text/javascript' : 'text/html', body: route.request().url().endsWith('adjuster.js') ? source : html(notebookContent(route.request().url().includes('view=all'))) }));
    const gemini = await context.newPage();
    const notebook = await context.newPage();
    await gemini.goto('https://gemini.google.com/notebooks/view');
    await notebook.goto('https://notebook.google.com/');
    const folder = (page, name) => page.locator('.nlm-folder').filter({ has: page.locator(`.nlm-folder-del[data-folder="${name}"]`) });
    const native = (page, title) => page.locator('project-button,project-mgmt-row').filter({ hasText: title });
    await gemini.waitForSelector('#nlm-folder-manager');
    await notebook.waitForSelector('#nlm-folder-manager');
    assert.equal(await gemini.locator('.notebook-card-view > .list-header + #nlm-folder-manager').count(), 1, 'Gemini classification belongs immediately below the page header');
    assert.equal(await folder(gemini, 'Tools').locator('project-mgmt-row').count(), 1);
    assert.equal(await folder(notebook, 'Tools').locator('project-button').count(), 1);
    assert.equal(await gemini.locator('project-mgmt-row').count(), names.length);
    assert.equal(await folder(gemini, 'Tools').locator('.nlm-fake-item[data-title="Missing"]').getAttribute('href'), `/notebook/${ids.Missing}`);
    assert.deepEqual(storage[key], initial);
    assert.equal(notebookWrites, 0, 'Opening pages must not overwrite notebook bookmarks');
    console.log('PASS: current Gemini page without tabs shares Notebook folders, preserves native cards and uses the current notebook URL');

    await folder(notebook, 'Other').locator('.nlm-folder-title').click();
    await gemini.waitForFunction(() => document.querySelector('.nlm-folder-del[data-folder="Other"]').closest('.nlm-folder').querySelector('.nlm-folder-content').style.display === 'block');
    assert.equal(await gemini.locator('project-mgmt-row').count(), names.length, 'Incoming changes must preserve original card nodes');
    await native(gemini, 'Alpha').locator('.project-card').click();
    assert.equal(await gemini.evaluate(() => window.fixtureNativeClicks), 1, 'Native card remains clickable after synchronization');
    console.log('PASS: Notebook changes update Gemini without reload and preserve native card interactions');

    await native(gemini, 'New').hover();
    await native(gemini, 'New').locator('.nlm-classify-btn').click();
    await gemini.locator('#ianto-modal-select').selectOption('Tools');
    await gemini.locator('#ianto-btn-confirm').click();
    await notebook.waitForFunction(() => document.querySelector('.nlm-folder-del[data-folder="Tools"]').closest('.nlm-folder').querySelectorAll('project-button').length === 2);
    assert.deepEqual(storage[key][0].projects.map(project => project.title), ['Alpha', 'Missing', 'New']);
    assert.equal(storage[key][0].projects[0].uuid, ids.Alpha, 'Existing UUIDs must survive Gemini changes');
    assert.equal(await gemini.locator('project-mgmt-row').count(), names.length);
    console.log('PASS: classifying in Gemini updates the open Notebook page and preserves existing UUIDs');

    await native(notebook, 'New').hover();
    await native(notebook, 'New').locator('.nlm-unarchive-btn').click();
    await gemini.waitForFunction(() => document.querySelector('.projects-section-container > project-mgmt-row .title')?.textContent === 'New');
    assert.equal(storage[key][0].projects.some(project => project.title === 'New'), false);
    assert.equal(await gemini.locator('project-mgmt-row').count(), names.length);
    console.log('PASS: removal in Notebook returns the Gemini card to its original grid without losing cards');

    await gemini.evaluate(() => { history.pushState(null, '', '/app/test'); document.body.innerHTML = '<main>Chat</main>'; });
    await gemini.evaluate(content => { history.pushState(null, '', '/notebooks/view'); document.body.innerHTML = content; }, geminiContent);
    await gemini.waitForSelector('.notebook-card-view > .list-header + #nlm-folder-manager');
    assert.equal(await folder(gemini, 'Tools').locator('project-mgmt-row').count(), 1);
    console.log('PASS: entering Notebooks through Gemini SPA navigation recreates the shared folders');

    const allPage = await context.newPage();
    await allPage.goto('https://notebook.google.com/?view=all');
    await allPage.waitForTimeout(1200);
    assert.equal(await allPage.locator('#nlm-folder-manager').count(), 0, 'Notebook All view must retain its original behavior');
    assert.equal(await allPage.locator('.project-grid-container > project-button').count(), names.length);
    assert.deepEqual(errors, []);
    console.log('PASS: Notebook All view is unchanged; no browser exceptions');
  } finally {
    if (browser) await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
