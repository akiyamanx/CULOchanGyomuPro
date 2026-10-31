const test = require('node:test');
const assert = require('node:assert');
const Guard = require('../map/geocode-guard.js');

test('返事が来ないジオコーディングは時間切れで null(固まらない)', async () => {
    const g = Guard.create({ timeoutMs: 30 });
    const t0 = Date.now();
    const r = await g.run(() => new Promise(() => {}));
    assert.equal(r, null);
    assert.ok(Date.now() - t0 < 1000);
});
test('地図の認証失敗の後は待たずにすぐ null、理由を残す', async () => {
    const g = Guard.create({ timeoutMs: 5000 });
    g.markFailed('auth');
    let called = false;
    const r = await g.run(() => { called = true; return new Promise(() => {}); });
    assert.equal(r, null); assert.equal(called, false);
    assert.equal(g.failed(), 'auth');
    assert.match(Guard.NOTICE, /後で付けます/);
});
test('待っている途中で認証失敗になったら即座に抜ける', async () => {
    const g = Guard.create({ timeoutMs: 5000 });
    const p = g.run(() => new Promise(() => {}));
    setTimeout(() => g.markFailed('auth'), 10);
    const t0 = Date.now();
    assert.equal(await p, null);
    assert.ok(Date.now() - t0 < 1000);
});
test('普通に返ってきた結果はそのまま、失敗(reject)は null', async () => {
    const g = Guard.create({ timeoutMs: 1000 });
    assert.equal(await g.run(() => Promise.resolve('ok')), 'ok');
    assert.equal(await g.run(() => Promise.reject('ZERO_RESULTS')), null);
    assert.equal(g.failed(), '');
});
test('リリース版: 地図キーを他の保存領域から借りない', () => {
    const ls = { getItem: () => JSON.stringify({ apiKey: 'AIzaFAKEKEY_example_not_real_0000' }) };
    assert.equal(Guard.borrowedMapsKey({ staging: true }, ls), '');
    assert.equal(Guard.borrowedMapsKey(), '');
});
test('AppStorage.readProduction: リリース版は何も返さない', () => {
    const vm = require('node:vm'), fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../shared/app-storage.js'), 'utf8');
    const data = new Map([['mm_settings', '{"apiKey":"x"}']]);
    const ctx = vm.createContext({ window: { localStorage: { getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, v), removeItem() {} } } });
    vm.runInContext(src + ';this.S=AppStorage;', ctx);
    assert.equal(ctx.S.readProduction('mm_settings'), null);
    assert.equal(ctx.S.getItem('mm_settings'), '{"apiKey":"x"}');
});
