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
test('お試し版だけ、本番の地図キーを読むだけ借りる(書かない・本番では借りない)', () => {
    const store = { mm_settings: JSON.stringify({ apiKey: 'AIzaFAKEKEY_example_not_real_0000', homeAddress: '架空の住所' }) };
    const ls = { getItem: k => (k in store ? store[k] : null), setItem() { throw new Error('書いてはいけない'); } };
    assert.equal(Guard.borrowedMapsKey({ staging: true }, ls), 'AIzaFAKEKEY_example_not_real_0000');
    assert.equal(Guard.borrowedMapsKey({ staging: false }, ls), '');
    assert.equal(Guard.borrowedMapsKey({ staging: true }, { getItem: () => '{"apiKey":"bad key<script>"}' }), '');
    assert.equal(Guard.borrowedMapsKey({ staging: true }, { getItem: () => 'not json' }), '');
});
test('AppStorage.readProduction: お試し版は mm_settings だけ本番を読める、本番では何も返さない', () => {
    const vm = require('node:vm'), fs = require('node:fs');
    const src = fs.readFileSync(require.resolve('../shared/app-storage.js'), 'utf8');
    const mk = prefix => { const data = new Map([['mm_settings', '{"apiKey":"x"}'], ['mm_customers', '[]']]);
        const ctx = vm.createContext({ AppProfile: { storagePrefix: prefix, readThroughKeys: [] }, window: { localStorage: { getItem: k => data.has(k) ? data.get(k) : null, setItem: (k, v) => data.set(k, v), removeItem() {} } } });
        vm.runInContext(src + ';this.S=AppStorage;', ctx); return ctx.S; };
    const stg = mk('stg:');
    assert.equal(stg.readProduction('mm_settings'), '{"apiKey":"x"}');
    assert.equal(stg.readProduction('mm_customers'), null);
    assert.equal(mk('').readProduction('mm_settings'), null);
});
