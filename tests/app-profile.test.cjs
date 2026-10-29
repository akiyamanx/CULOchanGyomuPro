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

test('判別: お試し版のパスだけを staging とみなす', () => {
    const d = p => load(p).ctx.AppProfile.staging;
    assert.equal(d('/CULOchanGyomuPro-staging/'), true);
    assert.equal(d('/CULOchanGyomuPro-staging/index.html'), true);
    assert.equal(d('/CULOchanGyomuPro/'), false);
    assert.equal(d('/CULOchanGyomuPro/index.html'), false);
    assert.equal(d('/CULOchanGyomuPro-stagingX/'), false);
    assert.equal(d('/'), false);
});
test('本番: キー名は今までどおり(接頭辞なし)', () => {
    const { ctx, m } = load('/CULOchanGyomuPro/', PROD);
    assert.equal(ctx.AppStorage.getItem('mm_settings'), '{"x":1}');
    ctx.AppStorage.setItem('gyomupro_mailbox', '[2]');
    assert.equal(m.get('gyomupro_mailbox'), '[2]');
    assert.equal(ctx.AppProfile.channel, 'gyomupro-main');
    assert.equal(ctx.AppProfile.dbName('CULOchanGyomuPro'), 'CULOchanGyomuPro');
});
test('お試し版: 本番のデータは見えず、書き込みは接頭辞つきキーだけ', () => {
    const { ctx, m } = load('/CULOchanGyomuPro-staging/', PROD);
    const S = ctx.AppStorage;
    assert.equal(S.getItem('mm_settings'), null);
    assert.equal(S.getItem('gyomupro_mailbox'), null);
    S.setItem('gyomupro_mailbox', '[9]');
    S.setItem('mm_settings', '{"stg":1}');
    S.removeItem('mm_settings');
    assert.equal(m.get('gyomupro_mailbox'), '[1]');
    assert.equal(m.get('mm_settings'), '{"x":1}');
    assert.equal(m.get('stg:gyomupro_mailbox'), '[9]');
    assert.deepEqual([...S.keys()].sort(), ['gyomupro_mailbox']);
    assert.deepEqual([...m.keys()].filter(k => !k.startsWith('stg:')).sort(), Object.keys(PROD).sort());
});
test('お試し版: クライアントIDだけは本番の値を読み取り専用で借りる(本番側は書き換えない)', () => {
    const { ctx, m } = load('/CULOchanGyomuPro-staging/', PROD);
    const S = ctx.AppStorage;
    assert.equal(S.getItem('culo_google_calendar_client_id'), PROD.culo_google_calendar_client_id);
    S.setItem('culo_google_calendar_client_id', '999-x.apps.googleusercontent.com');
    assert.equal(m.get('culo_google_calendar_client_id'), PROD.culo_google_calendar_client_id);
    assert.equal(S.getItem('culo_google_calendar_client_id'), '999-x.apps.googleusercontent.com');
    S.removeItem('culo_google_calendar_client_id');
    assert.equal(m.get('culo_google_calendar_client_id'), PROD.culo_google_calendar_client_id);
});
test('お試し版: IndexedDB名・Drive共有チャンネル・キャッシュ名が本番と別', () => {
    const P = load('/CULOchanGyomuPro-staging/').ctx.AppProfile;
    assert.equal(P.dbName('CULOchanGyomuPro'), 'stg-CULOchanGyomuPro');
    assert.equal(P.channel, 'gyomupro-staging');
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
test('SW: お試し版のキャッシュ名は別で、本番のキャッシュを消さない', () => {
    const sw = read('sw.js');
    const run = pathname => {
        const ctx = { self: { location: { pathname, origin: 'https://akiyamanx.github.io' }, addEventListener() {} } };
        vm.createContext(ctx);
        vm.runInContext(sw + '\nthis.CACHE_NAME=CACHE_NAME;this.ownCache=ownCache;', ctx);
        return ctx;
    };
    const s = run('/CULOchanGyomuPro-staging/sw.js'), p = run('/CULOchanGyomuPro/sw.js');
    assert.notEqual(s.CACHE_NAME, p.CACHE_NAME);
    assert.match(s.CACHE_NAME, /^gyomupro-stg-v\d+$/);
    assert.equal(s.ownCache('gyomupro-v46'), false);
    assert.equal(s.ownCache('gyomupro-stg-v46'), true);
    assert.equal(p.ownCache('gyomupro-stg-v46'), false);
    assert.equal(p.ownCache('gyomupro-v46'), true);
    assert.doesNotMatch(sw, /caches\.match\(/);
});
