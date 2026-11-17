// 日程未定の一覧: 置き場そのもの＋各月のアポ日なし（完了は除く）。表示用で保存はしない。値はすべて架空。
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
const c = (id, extra = {}) => ({ id, company: id + '（架空）', address: '架空県架空市1', purpose: '修理', status: 'pending', appoDate: '', routeId: null, ...extra });
function seed() {
    return {
        mm_workspaces: JSON.stringify([
            { id: '2026-10', name: '2026年10月' },
            { id: '2026-11', name: '2026年11月' },
            { id: 'unscheduled', name: '日程未定' }
        ]),
        mm_workspace_current: '2026-11',
        'mm_customers_unscheduled': JSON.stringify([
            c('u1', { company: '甲野商店（架空）' }),
            c('u2', { company: '完了未定（架空）', status: 'completed' })
        ]),
        'mm_customers_2026-11': JSON.stringify([
            c('n1', { company: '乙川工業（架空）' }),
            c('n2', { company: '日付あり（架空）', appoDate: '2026-11-20', status: 'appointed' }),
            c('n3', { company: '完了日付なし（架空）', status: 'completed' })
        ]),
        'mm_customers_2026-10': JSON.stringify([
            c('o1', { company: '丙田物産（架空）' })
        ])
    };
}

test('アポ日の判定', () => {
    const { run } = setup();
    assert.equal(run('DataStorage.hasVisitDate({appoDate:"2026-11-04"})'), true);
    assert.equal(run('DataStorage.hasVisitDate({appoDate:"2026-11-04T10:00"})'), true);
    assert.equal(run('DataStorage.hasVisitDate({appoDate:""})'), false);
    assert.equal(run('DataStorage.hasVisitDate({appoDate:null})'), false);
    assert.equal(run('DataStorage.hasVisitDate({})'), false);
});

test('一覧は日程未定の未完了＋各月の日付未定の未完了だけ（完了・日付ありは除く）', () => {
    const { json } = setup(seed());
    const list = json('DataStorage.listUndatedVisits()');
    assert.deepEqual(list.map(x => x.id), ['u1', 'n1', 'o1']);
    assert.equal(list[0].workspaceId, 'unscheduled');
    assert.equal(list[1].workspaceId, '2026-11');
    assert.equal(list[2].workspaceId, '2026-10');
    assert.equal(list.every(x => x.status !== 'completed'), true);
});

test('一覧を見るだけでは保存しない。getCustomers は今の月のまま', () => {
    const { writes, json, run } = setup(seed());
    const before = writes.length;
    json('DataStorage.listUndatedVisits()');
    json('DataStorage.getViewCustomers()');
    assert.equal(writes.length, before);
    assert.equal(run('DataStorage.isUndatedCombinedView()'), false);
    assert.deepEqual(json('DataStorage.getCustomers()').map(x => x.id), ['n1', 'n2', 'n3']);
});

test('日程未定を開くと結合一覧になり、件数は結合後', () => {
    const { run, json } = setup(seed());
    run("DataStorage.switchWorkspace('unscheduled')");
    assert.equal(run('DataStorage.isUndatedCombinedView()'), true);
    assert.equal(json('DataStorage.getViewCustomers()').length, 3);
    assert.deepEqual(json('DataStorage.getCustomers()').map(x => x.id), ['u1', 'u2']);
    assert.equal(run('DataStorage.UNDATED_SUBTITLE'), '日付が決まっていない訪問（全部の月）');
    assert.equal(run("DataStorage.workspaceTag('2026-11')"), '2026年11月');
    assert.equal(run("DataStorage.workspaceTag('unscheduled')"), '日程未定');
});

test('結合一覧から別月の訪問を直しても、元の月だけが変わり日程未定の保存は増えない', () => {
    const { store, writes, run, json } = setup(seed());
    run("DataStorage.switchWorkspace('unscheduled')");
    const afterSwitch = writes.filter(k => k.startsWith('mm_customers_'));
    const updated = json("DataStorage.updateCustomer('n1', {appoDate:'2026-11-21', note:'架空のメモ'})");
    assert.equal(updated.appoDate, '2026-11-21');
    assert.equal(updated.workspaceId, '2026-11');
    const nov = JSON.parse(store.get('mm_customers_2026-11'));
    const uns = JSON.parse(store.get('mm_customers_unscheduled'));
    assert.equal(nov.find(x => x.id === 'n1').appoDate, '2026-11-21');
    assert.equal(nov.find(x => x.id === 'n1').note, '架空のメモ');
    assert.ok(!('workspaceId' in nov.find(x => x.id === 'n1')));
    assert.deepEqual(uns.map(x => x.id), ['u1', 'u2']);
    assert.ok(!uns.some(x => x.id === 'n1'));
    const customerWrites = writes.filter(k => k.startsWith('mm_customers_')).slice(afterSwitch.length);
    assert.deepEqual(customerWrites, ['mm_customers_2026-11']);
    assert.deepEqual(json('DataStorage.listUndatedVisits()').map(x => x.id), ['u1', 'o1']);
});
