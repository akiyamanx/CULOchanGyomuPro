// Run against a local HTTP server. All accounts and calendar responses are synthetic.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + '/playwright' : 'playwright');
let base = process.argv[2], server;
const output = process.env.SETTINGS_REVIEW_OUTPUT;
const prefix = process.env.SETTINGS_STORAGE_PREFIX || '';
(async () => {
    if (!base) {
        const root = path.resolve(process.env.SETTINGS_REVIEW_ROOT || path.join(__dirname, '..'));
        server = http.createServer(async (req, res) => {
            const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
            if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
            try {
                const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png' };
                res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
                res.end(await fs.readFile(file));
            } catch (_) { res.writeHead(404).end(); }
        });
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${server.address().port}`;
    }
    const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        for (const width of (process.env.SETTINGS_TEST_WIDTHS || '320,390,768,1024,1440').split(',').map(Number)) {
            const context = await browser.newContext({ viewport: { width, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await context.addInitScript(({ prefix }) => {
                localStorage.setItem(prefix + 'culo_google_calendar_client_id', '123-browser-test.apps.googleusercontent.com');
                window.testAuthRequests = 0; window.testRevokes = 0;
                window.google = { accounts: { oauth2: {
                    initTokenClient(options) { return { requestAccessToken() { window.testAuthRequests++; options.callback({ access_token: 'synthetic-token-only', expires_in: 3600 }); } }; },
                    hasGrantedAllScopes: () => true,
                    revoke(token, done) { window.testRevokes++; done({ successful: true }); }
                } } };
            }, { prefix });
            await page.route('**/*', async route => {
                const url = route.request().url();
                if (url.startsWith(base)) return route.continue();
                if (process.env.TEST_FONT_DIR && url.startsWith('https://fonts.googleapis.com/')) {
                    if (new URL(url).pathname.startsWith('/files/')) return route.fulfill({ body: await fs.readFile(path.join(process.env.TEST_FONT_DIR, 'files', path.basename(new URL(url).pathname))), contentType: 'font/woff2', headers: { 'Access-Control-Allow-Origin': '*' } });
                    return route.fulfill({ body: (await Promise.all(['400.css', '600.css'].map(name => fs.readFile(path.join(process.env.TEST_FONT_DIR, name), 'utf8')))).join('\n'), contentType: 'text/css' });
                }
                if (url.startsWith('https://www.googleapis.com/calendar/v3/')) {
                    const items = url.includes('calendarList')
                        ? [{ id: 'synthetic', summary: '確認用カレンダー（架空）', primary: true, accessRole: 'owner' }]
                        : [{ id: 'test-event', summary: '確認用の予定（架空）', start: { dateTime: '2026-10-19T09:00:00+09:00' }, end: { dateTime: '2026-10-19T10:00:00+09:00' } }];
                    return route.fulfill({ json: { items } });
                }
                return route.fulfill({ status: 200, body: '', contentType: 'text/plain' });
            });
            await page.goto(base + '/index.html', { waitUntil: 'networkidle' });
            await page.waitForFunction(() => document.getElementById('googleCalendarStatus').textContent.includes('準備できました'));
            await page.evaluate(() => {
                const customer = DataStorage.addCustomer({ company: '設定確認用の会社（架空）', address: '東京都・架空住所', note: '元の備考', purpose: '修理' });
                MapCore.openEdit(customer.id);
            });
            await page.locator('#visitScheduleDay').fill('2026-10-19');
            await page.locator('#visitScheduleTime').fill('13:45');
            await page.locator('#editNote').fill('設定を往復しても残す入力');
            await page.locator('#editStatus').selectOption('appointed');
            assert.equal(await page.locator('#editModal #googleCalendarConnect, #editModal #googleCalendarDisconnect, #editModal #googleCalendarClientId').count(), 0);
            if (width === 390) await page.evaluate(() => document.body.classList.add('map-focus'));
            await page.locator('#googleCalendarSettings').click();
            await page.locator('#settingsModal').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#editModal').isVisible(), false);
            assert.equal(await page.locator('[data-settings-category="google"]').getAttribute('open'), '');
            assert.equal(await page.locator('#settingsModal [data-settings-category]').count(), 4);
            await page.locator('#googleCalendarConnect').click();
            await page.waitForFunction(() => GoogleVisitCalendar.snapshot().status === 'ready');
            const before = await page.evaluate(() => JSON.stringify(GoogleVisitCalendar.snapshot()));
            page.once('dialog', dialog => dialog.dismiss());
            await page.locator('#googleCalendarConnect').click();
            page.once('dialog', dialog => dialog.dismiss());
            await page.locator('#googleCalendarDisconnect').click();
            assert.equal(await page.evaluate(() => JSON.stringify(GoogleVisitCalendar.snapshot())), before);
            assert.equal(await page.evaluate(() => window.testAuthRequests), 1);
            assert.equal(await page.evaluate(() => window.testRevokes), 0);
            await page.locator('#googleCalendarSetup > summary').click();
            await page.locator('#googleCalendarSaveClient').click();
            assert.equal(await page.evaluate(() => GoogleVisitCalendar.snapshot().connected), true);
            await page.locator('#googleCalendarSetup > summary').click();
            await page.locator('#googleCalendarSelection > summary').click();
            await page.locator('[data-google-calendar="0"]').uncheck();
            await page.waitForFunction(() => GoogleVisitCalendar.snapshot().status === 'unselected');
            await page.locator('[data-google-calendar="0"]').check();
            await page.waitForFunction(() => GoogleVisitCalendar.snapshot().status === 'ready');
            if (output && width === 390) await page.screenshot({ path: path.join(output, 'settings-calendar-mobile.png') });
            await page.locator('#settingsReturn').click();
            await page.locator('#editModal').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#visitScheduleDay').inputValue(), '2026-10-19');
            assert.equal(await page.locator('#visitScheduleTime').inputValue(), '13:45');
            assert.equal(await page.locator('#editNote').inputValue(), '設定を往復しても残す入力');
            assert.equal(await page.locator('#editStatus').inputValue(), 'appointed');
            await page.waitForFunction(() => document.activeElement.id === 'googleCalendarSettings');
            assert.match(await page.locator('#googleVisitAgenda').textContent(), /確認用の予定/);
            if (output && width === 390) await page.screenshot({ path: path.join(output, 'visit-settings-mobile.png') });
            await page.locator('#googleCalendarSettings').click();
            await page.locator('[data-settings-category="google"] > summary').click();
            if (output && width === 390) await page.screenshot({ path: path.join(output, 'settings-categories-mobile.png') });
            const overflow = await page.locator('#settingsModal .modal-content').evaluate(el => el.scrollWidth > el.clientWidth + 1);
            assert.equal(overflow, false, `settings overflow at ${width}`);
            await page.locator('[data-settings-category="maps"] > summary').click();
            await page.locator('#settingHomeAddr').fill('設定確認用の会社住所');
            await page.locator('#settingMapsKey').fill('synthetic-maps-key');
            await page.getByRole('button', { name: '地図・住所の設定を保存' }).click();
            assert.equal(await page.locator('#settingsReload').isDisabled(), true);
            assert.match(await page.locator('#settingsMapsStatus').textContent(), /再読み込み後/);
            assert.equal(await page.evaluate(() => GoogleVisitCalendar.snapshot().connected), true);
            await page.locator('[data-settings-category="data"] > summary').click();
            assert.equal(await page.getByRole('button', { name: 'バックアップから復元', exact: true }).isDisabled(), true);
            assert.equal(await page.getByRole('button', { name: '現在の対象月のデータを削除', exact: true }).isDisabled(), true);
            // Unsaved setting edits require a deliberate discard; Escape still returns to the draft.
            await page.locator('#settingHomeAddr').fill('未保存の変更');
            page.once('dialog', dialog => dialog.dismiss());
            await page.locator('#settingsReturn').click();
            assert.equal(await page.locator('#settingsModal').isVisible(), true);
            page.once('dialog', dialog => dialog.accept());
            await page.keyboard.press('Escape');
            await page.locator('#editModal').waitFor({ state: 'visible' });
            assert.equal(await page.locator('#editNote').inputValue(), '設定を往復しても残す入力');
            await page.locator('#googleCalendarSettings').click();
            await page.waitForFunction(() => document.activeElement.matches('[data-settings-category="google"] > summary'));
            await page.locator('#settingsReturn').focus();
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '設定を閉じる');
            await page.keyboard.press('Shift+Tab');
            assert.equal(await page.evaluate(() => document.activeElement.id), 'settingsReturn');
            page.once('dialog', dialog => dialog.accept());
            await page.locator('#googleCalendarDisconnect').click();
            assert.equal(await page.evaluate(() => GoogleVisitCalendar.snapshot().connected), false);
            assert.equal(await page.evaluate(() => window.testRevokes), 1);
            await page.locator('#settingsReturn').click();
            assert.match(await page.locator('#googleCalendarSettings').textContent(), /接続設定を開く/);
            await page.evaluate(() => { hideEditModal(true); document.body.classList.remove('map-focus'); });
            await page.locator('.settings-btn').click();
            assert.equal(await page.locator('#settingsModal .settings-category[open]').count(), 0);
            await page.locator('[data-settings-category="data"] > summary').click();
            assert.equal(await page.getByRole('button', { name: 'バックアップから復元', exact: true }).isEnabled(), true);
            assert.equal(await page.getByRole('button', { name: '現在の対象月のデータを削除', exact: true }).isEnabled(), true);
            await page.getByRole('button', { name: '現在の対象月のデータを削除', exact: true }).click();
            await page.locator('#resetModal').waitFor({ state: 'visible' });
            await page.locator('#resetModal .modal-cancel').click();
            assert.equal(await page.evaluate(() => DataStorage.getCustomers().length), 1);
            const persisted = await page.evaluate(() => JSON.stringify(localStorage));
            assert.doesNotMatch(persisted, /synthetic-token-only|確認用の予定/);
            if (prefix) assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => !key.startsWith('culo_preview_expense_20261009:'))), false);
            assert.deepEqual(errors, []);
            console.log(`PASS ${width}px: draft, OAuth guards, settings save, no reload, focus, storage isolation`);
            await context.close();
        }
    } finally { await browser.close(); server?.close(); }
})().catch(error => { server?.close(); console.error(error); process.exitCode = 1; });
