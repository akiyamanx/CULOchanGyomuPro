const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Gmailの中身(メール情報・添付)をService Workerのキャッシュに残さないための確認
test('SWはGoogle APIと認証つきリクエストをキャッシュしない', () => {
    assert.match(sw, /Authorization/);
    assert.match(sw, /endsWith\('\.googleapis\.com'\)/);
    assert.match(sw, /request\.method !== 'GET'/);
});
test('Gmail用ファイルがSWの事前キャッシュに入っている', () => {
    for (const f of ['gmail-transport', 'gmail-source', 'gmail-import']) assert.ok(sw.includes('./map/' + f + '.js'), f);
});
test('index.htmlはGmail層をUIより先に読む', () => {
    const at = f => html.indexOf('map/' + f + '.js');
    for (const f of ['gmail-transport', 'gmail-source', 'gmail-import']) assert.ok(at(f) > 0 && at(f) < at('mail-box-ui'), f);
});
