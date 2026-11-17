// アポ日を入れると、同じIDのままその月の置き場へ移る（同期は _ws の変更。削除の大量ガードには触れない）。値は架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(initial = {}) {
    const store = new Map(Object.entries(initial));
    const writes = [];
    const storage = {
        getItem: k => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => { store.set(k, String(v)); writes.push(k); },
        removeItem: k => { store.delete(k); }
    };
    const context = vm.createContext({ console: { error() {}, warn() {} }, alert() {}, AppStorage: storage, localStorage: storage });
    vm.runInContext(fs.readFileSync(require.resolve('../map/map-data-storage.js'), 'utf8'), context);
    const run = code => vm.runInContext(code, context);
    const json = code => JSON.parse(JSON.stringify(run(code)));
    return { store, writes, run, json };
}
const c = (id, extra = {}) => ({ id, company: id + '（架空）', address: '架空県架空市1', purpose: '修理', status: 'pending', appoDate: '', routeId: null, note: '元のメモ', ...extra });
function seed() {
    return {
        mm_workspaces: JSON.stringify([
            { id: '2026-11', name: '2026年11月' },
            { id: 'unscheduled', name: '日程未定' }
        ]),
        mm_workspace_current: 'unscheduled',
        'mm_customers_unscheduled': JSON.stringify([c('u1', { company: '甲野商店（架空）' })]),
        'mm_customers_2026-11': JSON.stringify([
            c('n1', { company: '乙川工業（架空）', routeId: 'route_2' }),
            c('n2', { company: '重複先（架空）', address: '架空県架空市9', purpose: '修理' })
        ]),
        'mm_routes_2026-11': JSON.stringify([
            { id: 'route_2', name: 'ルート2', color: '#283593', order: ['n1', 'n2'] }
        ])
    };
}

test('v80相当: updateCustomerだけでは日程未定から月へ移らない', () => {
    const { json } = setup(seed());
    json("DataStorage.updateCustomer('u1', {appoDate:'2026-12-03T10:00'})");
    assert.equal(json("DataStorage.getCustomersForWorkspace('unscheduled')").some(x => x.id === 'u1'), true);
    assert.equal(json("DataStorage.getWorkspaces()").some(w => w.id === '2026-12'), false);
});

test('日程未定の訪問に12月3日を入れると、同じIDのまま12月へ移る', () => {
    const { json, store } = setup(seed());
    const r = json("DataStorage.saveCustomerWithAppoDate('u1', {appoDate:'2026-12-03T10:00', status:'appointed', note:'元のメモ'})");
    assert.equal(r.ok, true); assert.equal(r.moved, true); assert.equal(r.to, '2026-12'); assert.equal(r.from, 'unscheduled');
    const dec = json("DataStorage.getCustomersForWorkspace('2026-12')");
    assert.equal(dec.length, 1);
    assert.equal(dec[0].id, 'u1');
    assert.equal(dec[0].company, '甲野商店（架空）');
    assert.equal(dec[0].note, '元のメモ');
    assert.equal(dec[0].appoDate, '2026-12-03T10:00');
    assert.equal(dec[0].status, 'appointed');
    assert.equal(dec[0].routeId, null);
    assert.ok(!('workspaceId' in JSON.parse(store.get('mm_customers_2026-12'))[0]));
    assert.equal(json("DataStorage.getCustomersForWorkspace('unscheduled')").some(x => x.id === 'u1'), false);
    assert.ok(json('DataStorage.getWorkspaces()').some(w => w.id === '2026-12'));
});

test('11月の訪問に12月の日付を入れると12月へ移り、元のルート順からは外れる', () => {
    const { json } = setup(seed());
    const r = json("DataStorage.saveCustomerWithAppoDate('n1', {appoDate:'2026-12-03T09:00'})");
    assert.equal(r.ok, true); assert.equal(r.moved, true); assert.equal(r.to, '2026-12');
    assert.equal(json("DataStorage.getCustomersForWorkspace('2026-11')").some(x => x.id === 'n1'), false);
    const dec = json("DataStorage.getCustomersForWorkspace('2026-12')")[0];
    assert.equal(dec.id, 'n1'); assert.equal(dec.routeId, null);
    const order = json("JSON.parse(AppStorage.getItem('mm_routes_2026-11'))").find(x => x.id === 'route_2').order;
    assert.deepEqual(order, ['n2']);
});

test('同じ月の日付なら移さず、その場で更新する', () => {
    const { json, writes } = setup(seed());
    json("DataStorage.switchWorkspace('2026-11')");
    writes.length = 0;
    const r = json("DataStorage.saveCustomerWithAppoDate('n1', {appoDate:'2026-11-20T11:00', note:'更新'})");
    assert.equal(r.ok, true); assert.equal(r.moved, false);
    assert.equal(json("DataStorage.getCustomersForWorkspace('2026-11')").find(x => x.id === 'n1').appoDate, '2026-11-20T11:00');
    assert.ok(!json('DataStorage.getWorkspaces()').some(w => w.id === '2026-12'));
});

test('日付を空に戻しても置き場は変えない', () => {
    const { json } = setup(seed());
    json("DataStorage.switchWorkspace('2026-11')");
    const r = json("DataStorage.saveCustomerWithAppoDate('n1', {appoDate:''})");
    assert.equal(r.ok, true); assert.equal(r.moved, false);
    assert.equal(json("DataStorage.getCustomersForWorkspace('2026-11')").some(x => x.id === 'n1'), true);
});

test('移動先に同じ訪問があるときは移さず、元の置き場を残す', () => {
    const { json, run } = setup(seed());
    run("DataStorage.createWorkspace('2026-12')");
    run("DataStorage.saveCustomersForWorkspace('2026-12', [{id:'x', company:'甲野商店（架空）', address:'架空県架空市1', purpose:'修理', appoDate:'2026-12-03T10:00'}])");
    const r = json("DataStorage.saveCustomerWithAppoDate('u1', {appoDate:'2026-12-03T10:00'})");
    assert.equal(r.ok, false); assert.equal(r.reason, 'duplicate');
    assert.equal(json("DataStorage.getCustomersForWorkspace('unscheduled')").some(x => x.id === 'u1'), true);
    assert.equal(json("DataStorage.getCustomersForWorkspace('2026-12')").some(x => x.id === 'u1'), false);
});

test('月の判定', () => {
    const { run } = setup();
    assert.equal(run("DataStorage.monthOfAppoDate('2026-12-03T10:00')"), '2026-12');
    assert.equal(run("DataStorage.monthOfAppoDate('2026-12-03')"), '2026-12');
    assert.equal(run("DataStorage.monthOfAppoDate('')"), '');
    assert.equal(run("DataStorage.monthOfAppoDate('2026-13-01')"), '');
});
