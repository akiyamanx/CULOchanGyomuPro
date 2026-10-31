const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function fakeLocal(init) {
    const m = new Map(Object.entries(init || {}));
    const ls = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
    return { ls, m };
}
// 本番と同じオリジン(akiyamanx.github.io)で、パスだけでお試し版を判別する
function load(pathname, init) {
    const { ls, m } = fakeLocal(init);
    const proxy = new Proxy(ls, { ownKeys: () => [...m.keys()], getOwnPropertyDescriptor: (t, k) => (m.has(k) ? { enumerable: true, configurable: true, value: m.get(k) } : undefined) });
    const ctx = { window: { localStorage: proxy, location: { pathname } }, location: { pathname }, document: undefined };
    vm.createContext(ctx);
    vm.runInContext(read('shared/app-profile.js') + '\n' + read('shared/app-storage.js') + '\nthis.AppProfile=AppProfile;this.AppStorage=AppStorage;', ctx);
    return { ctx, m };
}
const PROD = { mm_settings: '{"x":1}', gyomupro_mailbox: '[1]', culo_google_calendar_client_id: '123-abc.apps.googleusercontent.com' };

// 本番リリース版: どのパスで読み込んでも本番の固定設定(接頭辞なし・本番チャンネル・バナーなし・借用なし)
test('リリース版: どのパスでも staging にならない', () => {
    for (const p of ['/CULOchanGyomuPro/', '/CULOchanGyomuPro/index.html', '/CULOchanGyomuPro-staging/', '/']) assert.equal(load(p).ctx.AppProfile.staging, false, p);
});
test('本番: キー名は今までどおり(接頭辞なし)', () => {
    const { ctx, m } = load('/CULOchanGyomuPro/', PROD);
    assert.equal(ctx.AppStorage.getItem('mm_settings'), '{"x":1}');
    ctx.AppStorage.setItem('gyomupro_mailbox', '[2]');
    assert.equal(m.get('gyomupro_mailbox'), '[2]');
    assert.equal(ctx.AppProfile.channel, 'gyomupro-main');
    assert.equal(ctx.AppProfile.dbName('CULOchanGyomuPro'), 'CULOchanGyomuPro');
    assert.equal(ctx.AppProfile.storagePrefix, '');
    assert.deepEqual([...ctx.AppProfile.readThroughKeys], []);
});
test('リリース版: お試し版の名残(stg・バナー・借用)がアプリ本体に無い', () => {
    const files = ['shared/app-profile.js','shared/app-storage.js','map/geocode-guard.js','map/data-sync-ui.js','index.html'];
    for (const f of files) assert.doesNotMatch(read(f), /stg:|'stg-'|gyomupro-staging|stagingBanner|AppProfile\.staging/, f);
});
test('IndexedDBを開くファイルはすべて AppProfile.dbName を通す', () => {
    for (const f of ['expense/parking-idb.js', 'expense/etc-store.js', 'expense/expense-draft-store.js', 'shared/backup-store.js']) assert.match(read(f), /AppProfile\.dbName\(/, f);
    assert.match(read('shared/backup-store.js'), /AppProfile\.channel/);
});
test('アプリ本体は localStorage を直接さわらない(AppStorage 経由のみ)', () => {
    const html = read('index.html').replace(/<script src[^>]*><\/script>/g, '');
    assert.doesNotMatch(html, /localStorage/);
    const at = f => read('index.html').indexOf(f);
    assert.ok(at('shared/app-profile.js') > 0 && at('shared/app-profile.js') < at('shared/app-storage.js'));
});
test('SW: 本番キャッシュ名は新しい版で、お試し版のキャッシュは消さない', () => {
    const sw = read('sw.js');
    const ctx = { self: { location: { pathname: '/CULOchanGyomuPro/sw.js', origin: 'https://akiyamanx.github.io' }, addEventListener() {} } };
    vm.createContext(ctx);
    vm.runInContext(sw + '\nthis.CACHE_NAME=CACHE_NAME;this.ownCache=ownCache;', ctx);
    assert.equal(ctx.CACHE_NAME, 'gyomupro-v61');
    assert.equal(ctx.ownCache('gyomupro-v44'), true);
    assert.equal(ctx.ownCache('gyomupro-stg-v60'), false);
    assert.doesNotMatch(sw, /caches\.match\(/);
});
