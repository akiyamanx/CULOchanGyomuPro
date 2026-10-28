const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const swSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function loadSw() {
    const listeners = {};
    const self = { location: { origin: 'https://example.test' }, addEventListener: (n, f) => { listeners[n] = f; } };
    const ctx = vm.createContext({ self, URL, Request, Response, caches: {}, fetch: () => {}, Promise });
    vm.runInContext(swSource + '\n;this.__out = { CACHE_NAME, ASSETS, shouldHandle };', ctx);
    return ctx.__out;
}
const sw = loadSw();
const req = (url, method = 'GET', headers = {}) => ({ url, method, headers: new Headers(headers) });

test('ASSETSは全て実在するファイル', () => {
    for (const asset of sw.ASSETS) {
        const rel = asset.replace(/^\.\//, '');
        const file = path.join(root, rel === '' ? 'index.html' : rel);
        assert.ok(fs.existsSync(file), `${asset} が存在しない`);
    }
});

test('index.htmlが読む自サイトのjs/css/manifestは全てASSETSに入っている', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1].split('?')[0])
        .filter(r => !/^https?:/.test(r) && /\.(js|css|json|png)$/.test(r));
    const set = new Set(sw.ASSETS.map(a => a.replace(/^\.\//, '')));
    for (const r of refs) assert.ok(set.has(r), `${r} がASSETSに無い`);
});

test('CACHE_NAMEは旧本番(gyomupro-v43)より新しい', () => {
    const n = Number(/gyomupro-v(\d+)/.exec(sw.CACHE_NAME)[1]);
    assert.ok(n > 43);
});

test('manifestのアイコンは実在する', () => {
    const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    for (const i of m.icons) assert.ok(fs.existsSync(path.join(root, i.src)), i.src);
});

test('非GET・Google認証付き通信・お試し版・未知の外部ホストはSWで扱わない', () => {
    assert.equal(sw.shouldHandle(req('https://example.test/index.html', 'POST')), false);
    assert.equal(sw.shouldHandle(req('https://example.test/index.html', 'GET', { Authorization: 'Bearer x' })), false);
    assert.equal(sw.shouldHandle(req('https://www.googleapis.com/drive/v3/files')), false);
    assert.equal(sw.shouldHandle(req('https://accounts.google.com/gsi/client')), false);
    assert.equal(sw.shouldHandle(req('https://maps.googleapis.com/maps/api/js')), false);
    assert.equal(sw.shouldHandle(req('https://generativelanguage.googleapis.com/v1/models')), false);
    assert.equal(sw.shouldHandle(req('https://example.test/preview/expense-repair-20261009/index.html')), false);
    assert.equal(sw.shouldHandle(req('https://other.example/a.js')), false);
});

test('自サイトの静的ファイルと既知のCDNはGETでキャッシュ対象', () => {
    assert.equal(sw.shouldHandle(req('https://example.test/shared/app-core.js?v=1')), true);
    assert.equal(sw.shouldHandle(req('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')), true);
});
