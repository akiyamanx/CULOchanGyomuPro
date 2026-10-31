// 走行距離の請求(1日ごと): 0〜100kmは0円、101〜200kmは1kmごと30円、201km以上は1kmごと38円。1km未満は切り捨て。
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const vm = require('node:vm');
const ctx = vm.createContext({ console, window: {}, document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] } });
vm.runInContext(fs.readFileSync(require.resolve('../expense/expense-manager.js'), 'utf8') + '\n;globalThis.__EM = ExpenseManager;', ctx);
const calc = ctx.__EM.calcGasCost;
test('境目の距離', () => {
    for (const [km, yen] of [[0, 0], [100, 0], [101, 30], [150, 1500], [200, 3000], [201, 3038], [250, 4900], [300, 6800]]) {
        assert.equal(calc(km), yen, km + 'km'); assert.equal(calc(String(km)), yen, km + 'km(文字)');
    }
});
test('小数は1km未満を切り捨て・空や不正は0円', () => {
    assert.equal(calc('100.9'), 0); assert.equal(calc('150.5'), 1500); assert.equal(calc(200.99), 3000); assert.equal(calc('250.4'), 4900);
    assert.equal(calc(''), 0); assert.equal(calc(undefined), 0); assert.equal(calc('abc'), 0); assert.equal(calc('-50'), 0);
});
test('入力欄の説明が新しい段階に合っている', () => {
    const src = fs.readFileSync(require.resolve('../expense/expense-manager.js'), 'utf8');
    assert.ok(src.includes('101〜200kmは1kmごと30円') && src.includes('201km以上は1kmごと38円'));
    assert.ok(!src.includes('※100km以上で自動計算'));
});
