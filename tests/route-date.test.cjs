// ルートカードの訪問日表示。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function load(customers) {
    const els = {};
    const el = id => els[id] || (els[id] = { innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [] });
    const ctx = vm.createContext({ console, document: { getElementById: el, querySelectorAll: () => [], querySelector: () => null }, window: {},
        DataStorage: { getRoutes: () => [{ id: 'r1', name: 'ルート1', color: '#f00' }], getCustomers: () => customers } });
    for (const f of ['expense/expense-import.js', 'map/route-manager.js']) vm.runInContext(fs.readFileSync(require.resolve('../' + f), 'utf8'), ctx);
    return { ctx, el, info: m => JSON.parse(JSON.stringify(vm.runInContext('RouteManager.routeDateInfo(' + JSON.stringify(m) + ')', ctx))) };
}
const { info } = load([]);
test('全部同じ日なら日付と曜日', () => {
    const r = info([{ appoDate: '2026-11-06T10:00' }, { appoDate: '2026-11-06T14:30' }]);
    assert.equal(r.kind, 'same'); assert.equal(r.text, '11/6(金)');
});
test('バラバラなら最初〜最後、土日に色', () => {
    const r = info([{ appoDate: '2026-11-08T09:00' }, { appoDate: '2026-11-07' }, { appoDate: '2026-11-07T13:00' }]);
    assert.equal(r.kind, 'mixed'); assert.equal(r.text, '11/7(土)〜8(日)');
    assert.equal(info([{ appoDate: '2026-11-30' }, { appoDate: '2026-12-01' }]).text, '11/30(月)〜12/1(火)');
    assert.equal(r.first.cls, 'sat'); assert.equal(r.last.cls, 'sun');
});
test('日付が無ければ日付未定、一部だけ無いのは数える', () => {
    assert.equal(info([{ appoDate: '' }, {}]).kind, 'none');
    assert.equal(info([]).text, '日付未定');
    const r = info([{ appoDate: '2026-11-06T10:00' }, { appoDate: null }]);
    assert.equal(r.kind, 'same'); assert.equal(r.undated, 1);
});
test('ルートカードの見出しに出る・日付を変えると表示も変わる', () => {
    const cs = [{ id: 'a', company: '甲野商事（架空）', routeId: 'r1', appoDate: '2026-11-06T10:00' }];
    const { ctx, el } = load(cs);
    vm.runInContext('RouteManager.updateRoutePanel()', ctx);
    assert.match(el('routeManager').innerHTML, /ルート1<\/span><span class="route-date route-date-same">📅<span class="">11\/6\(金\)/);
    cs[0].appoDate = '2026-11-09T10:00';
    vm.runInContext('RouteManager.updateRoutePanel()', ctx);
    assert.match(el('routeManager').innerHTML, /11\/9\(月\)/);
});
