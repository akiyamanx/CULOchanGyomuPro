'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../map/geocode-guard.js');

test('住所の言い換え候補：そのまま→半角→郵便番号/建物名を外す', () => {
    const v = G.addressVariants('〒100-0001 架空県甲野市本町５－１－１８ 架空ビル３Ｆ');
    assert.equal(v[0], '架空県甲野市本町5-1-18 架空ビル');
    assert.ok(v.includes('〒100-0001 架空県甲野市本町５－１－１８ 架空ビル３Ｆ'));
    assert.ok(v.includes('架空県甲野市本町5-1-18 架空ビル3F'));
    assert.equal(v[v.length - 1], '架空県甲野市本町5-1-18');
});
test('普通の住所は1つだけ・空は無し・かっこ書きは外す', () => {
    assert.deepEqual(G.addressVariants('架空県乙川市2-3'), ['架空県乙川市2-3']);
    assert.deepEqual(G.addressVariants(''), []);
    assert.ok(G.addressVariants('架空県乙川市2-3（裏口）').includes('架空県乙川市2-3'));
    assert.ok(G.addressVariants('架空県乙川市2-3\n架空ビル').includes('架空県乙川市2-3'));
});
test('階・F・号室は外したものを最初に試す', () => {
    assert.deepEqual(G.addressVariants('架空県甲野市本町5-1-18 3階'), ['架空県甲野市本町5-1-18', '架空県甲野市本町5-1-18 3階']);
    assert.equal(G.addressVariants('架空県甲野市本町5-1-18 架空ビル301号室')[0], '架空県甲野市本町5-1-18 架空ビル');
    assert.equal(G.addressVariants('架空県甲野市本町5-1-18　Ｂ１Ｆ')[0], '架空県甲野市本町5-1-18');
    const v = G.addressVariants('架空県甲野市本町５丁目１番１８号 １０階');
    assert.equal(v[0], '架空県甲野市本町5-1-18');
});
const fs = require('node:fs'), vm = require('node:vm');
test('住所を直したら古い位置を消す（取り直しの対象になる）', () => {
    const store = new Map();
    const storage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    const ctx = vm.createContext({ console: { error() {}, warn() {} }, alert() {}, AppStorage: storage, localStorage: storage, crypto: require('node:crypto').webcrypto });
    vm.runInContext(fs.readFileSync(require.resolve('../map/map-data-storage.js'), 'utf8'), ctx);
    const run = c => JSON.parse(JSON.stringify(vm.runInContext(c, ctx) ?? null));
    const c = run("DataStorage.addCustomer({ company: '甲野商事（架空）', address: '架空県甲野市本町5-1-18 3階', lat: 35.1, lng: 139.1 })");
    const id = c.id || run('DataStorage.getCustomers()')[0].id;
    let u = run(`DataStorage.updateCustomer(${JSON.stringify(id)}, { note: 'x' })`);
    assert.equal(u.lat, 35.1);
    u = run(`DataStorage.updateCustomer(${JSON.stringify(id)}, { address: '架空県甲野市本町5-1-18' })`);
    assert.equal(u.lat, null); assert.equal(u.lng, null);
    u = run(`DataStorage.updateCustomer(${JSON.stringify(id)}, { lat: 35.2, lng: 139.2 })`);
    assert.equal(u.lat, 35.2);
});
