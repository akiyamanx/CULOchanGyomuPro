// 「日程未定」置き場(予約済みワークスペース unscheduled)の保存・移動・振り分け・後方互換のテスト。
// データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Month = require('../map/request-month');
const BackupFormat = require('../shared/backup-format');

const U = 'unscheduled';
function setup(initial = {}) {
    const store = new Map(Object.entries(initial));
    const writes = [];
    const hooks = { failKey: null, failAfter: new Set() };
    const storage = {
        getItem: k => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => {
            if (hooks.failKey === k) throw new Error('quota:' + k);
            if (hooks.failAfter.has(k)) { hooks.failAfter.delete(k); store.set(k, String(v)); writes.push(k); return; }
            store.set(k, String(v)); writes.push(k);
        },
        removeItem: k => { store.delete(k); }
    };
    const context = vm.createContext({ console: { error() {}, warn() {} }, alert() {}, AppStorage: storage, localStorage: storage });
    vm.runInContext(fs.readFileSync(require.resolve('../map/map-data-storage.js'), 'utf8'), context);
    const run = code => vm.runInContext(code, context);
    const json = code => JSON.parse(JSON.stringify(run(code)));
    return { store, writes, hooks, run, json, context };
}
const customer = (id, extra = {}) => ({ id, company: '架空会社' + id, address: '東京都架空区' + id, purpose: '修理', status: 'pending', appoDate: '', routeId: null, ...extra });
const legacy = () => ({
    mm_workspaces: JSON.stringify([{ id: '2026-09', name: '2026年9月', createdAt: 'x' }, { id: '2026-10', name: '2026年10月', createdAt: 'x' }]),
    mm_workspace_current: '2026-10',
    'mm_customers_2026-10': JSON.stringify([customer('a', { status: 'appointed', appoDate: '2026-10-15T15:00', routeId: 'route_2' })]),
    'mm_customers_2026-09': JSON.stringify([customer('z')])
});

// --- (1) 予約済みワークスペース ---
test('月ID判定と予約済みID判定', () => {
    const { run } = setup();
    assert.equal(run("DataStorage.isMonthWorkspaceId('2026-11')"), true);
    for (const bad of ['2026-13', '2026-00', 'unscheduled', '', null, undefined, '2026-1', '2026-11-01']) assert.equal(run('DataStorage.isMonthWorkspaceId(' + JSON.stringify(bad ?? null) + ')'), false, String(bad));
    assert.equal(run("DataStorage.isReservedWorkspaceId('unscheduled')"), true);
    assert.equal(run("DataStorage.isReservedWorkspaceId('2026-11')"), false);
});
test('unscheduledを作成すると表示名は「日程未定」、2回目は作らず、現在の月は変えない', () => {
    const { run, json, store } = setup(legacy());
    const ws = json('DataStorage.ensureUnscheduledWorkspace()');
    assert.equal(ws.id, U); assert.equal(ws.name, '日程未定');
    const ids = json('DataStorage.getWorkspaces()').map(w => w.id);
    assert.deepEqual(ids, ['2026-09', '2026-10', U]);
    assert.equal(store.get('mm_workspace_current'), '2026-10');
    const before = store.get('mm_workspaces');
    run('DataStorage.ensureUnscheduledWorkspace()');
    assert.equal(store.get('mm_workspaces'), before);
    assert.equal(json("DataStorage.getCustomersForWorkspace('unscheduled')").length, 0);
});
test('unscheduledを追加しても既存の月データ・設定のキーと値は一切変わらない', () => {
    const { run, store } = setup({ ...legacy(), mm_settings: '{"homeAddress":""}', mm_geocache: '{}' });
    const snapshot = new Map(store);
    run('DataStorage.ensureUnscheduledWorkspace()');
    for (const [k, v] of snapshot) if (k !== 'mm_workspaces') assert.equal(store.get(k), v, k);
    assert.deepEqual(JSON.parse(store.get('mm_workspaces')).slice(0, 2), JSON.parse(snapshot.get('mm_workspaces')));
});
test('unscheduledは削除できない(誤操作で日程未定の訪問先を消さない)。月は従来どおり削除できる', () => {
    const { run, json, store } = setup(legacy());
    run('DataStorage.ensureUnscheduledWorkspace()');
    run("DataStorage.saveCustomersForWorkspace('unscheduled',[{id:'u1'}])");
    assert.equal(run("DataStorage.deleteWorkspace('unscheduled')"), false);
    assert.ok(json('DataStorage.getWorkspaces()').some(w => w.id === U));
    assert.equal(json("DataStorage.getCustomersForWorkspace('unscheduled')").length, 1);
    run("DataStorage.deleteWorkspace('2026-09')");
    assert.equal(store.has('mm_customers_2026-09'), false);
});
test('unscheduledを現在の場所にしても、顧客の保存・読込は通常の月と同じ仕組みで動く', () => {
    const { run, json, store } = setup(legacy());
    run('DataStorage.ensureUnscheduledWorkspace()');
    assert.equal(run("DataStorage.switchWorkspace('unscheduled')"), true);
    run("DataStorage.addCustomer({company:'架空会社U',address:'東京都架空区9'})");
    const list = json('DataStorage.getCustomers()');
    assert.equal(list.length, 1); assert.equal(list[0].status, 'pending'); assert.equal(list[0].appoDate, null);
    assert.ok(store.has('mm_customers_unscheduled'));
    assert.equal(json("DataStorage.getCustomersForWorkspace('2026-10')").length, 1);
});

// --- 後方互換 ---
test('旧版データ(unscheduled無し)はそのまま開け、勝手にunscheduledを作らない', () => {
    const { run, json, store } = setup(legacy());
    const before = new Map(store);
    run('DataStorage.migrateIfNeeded()');
    assert.deepEqual(json('DataStorage.getWorkspaces()').map(w => w.id), ['2026-09', '2026-10']);
    assert.equal(run('DataStorage.getCurrentWorkspaceId()'), '2026-10');
    assert.equal(json('DataStorage.getCustomers()')[0].id, 'a');
    assert.equal(run("DataStorage.switchWorkspace('2026-09')"), true);
    assert.equal(run("DataStorage.switchWorkspace('unscheduled')"), false);
    for (const [k, v] of before) if (k !== 'mm_workspace_current') assert.equal(store.get(k), v, k);
    assert.equal(store.has('mm_customers_unscheduled'), false);
});
test('旧版の移動対象なしでも移動関数は何も書かずに「見つからない」を返す', () => {
    const { run, json, writes } = setup(legacy());
    const r = json("DataStorage.moveCustomerToWorkspace({id:'nope',from:'unscheduled',to:'2026-11',appoDate:'2026-11-05T10:00'})");
    assert.equal(r.ok, false); assert.equal(r.reason, 'not_found');
    assert.deepEqual(writes, []);
});

// --- バックアップ ---
test('バックアップの許可リストはunscheduledの保存キーを通し、往復しても内容が変わらない', async () => {
    assert.equal(BackupFormat.allowedKey('mm_customers_unscheduled'), true);
    assert.equal(BackupFormat.allowedKey('mm_routes_unscheduled'), true);
    assert.equal(BackupFormat.allowedKey('mm_customers_../x'), false);
    const local = {
        mm_workspaces: JSON.stringify([{ id: '2026-10', name: '2026年10月' }, { id: U, name: '日程未定' }]),
        mm_workspace_current: U,
        'mm_customers_2026-10': '[]',
        mm_customers_unscheduled: JSON.stringify([customer('u1', { receivedMonth: '2026-10', mailKey: 'mk-1' })]),
        mm_routes_unscheduled: '[]', mm_segments_unscheduled: '{}', mm_expenses_unscheduled: '[]'
    };
    const payload = { local, drafts: [], parking: [], etc: { records: [], days: {}, selectedDate: '' } };
    const bundle = await BackupFormat.create(payload);
    const parsed = await BackupFormat.parse(JSON.stringify(bundle));
    assert.equal(JSON.parse(parsed.payload.local.mm_customers_unscheduled)[0].mailKey, 'mk-1');
    assert.match(BackupFormat.summary(parsed), /訪問先 1件/);
});
test('旧版バックアップ(unscheduled無し)も今まで通り検証を通る', async () => {
    const payload = { local: { mm_workspaces: '[{"id":"2026-10","name":"2026年10月"}]', 'mm_customers_2026-10': '[]' }, drafts: [], parking: [], etc: { records: [], days: {}, selectedDate: '' } };
    await BackupFormat.parse(JSON.stringify(await BackupFormat.create(payload)));
});

// --- (3) 日にちが決まったら該当月へ移す ---
const withUnscheduled = () => {
    const env = setup(legacy());
    env.run('DataStorage.ensureUnscheduledWorkspace()');
    env.run("DataStorage.saveCustomersForWorkspace('unscheduled',[{id:'u0',company:'架空会社Q',address:'東京都架空区0',purpose:'点検',status:'pending',appoDate:'',routeId:null},{id:'u1',company:'架空会社R',address:'東京都架空区1',purpose:'修理',status:'pending',appoDate:'',routeId:null,receivedMonth:'2026-10',mailKey:'mk-1'}])");
    env.writes.length = 0;
    return env;
};
const MOVE = (o = {}) => 'DataStorage.moveCustomerToWorkspace(' + JSON.stringify({ id: 'u1', from: U, to: '2026-11', appoDate: '2026-11-05T10:00', ...o }) + ')';

test('日にちが決まった訪問先を該当月へ移す: 移動先へ先に書き、その後に元から消し、他のデータは保つ', () => {
    const { run, json, writes, store } = withUnscheduled();
    store.set('mm_customers_2026-11', JSON.stringify([customer('keep', { appoDate: '2026-11-02T09:00' })]));
    run("DataStorage.createWorkspace('2026-11')");
    writes.length = 0;
    const r = json(MOVE());
    assert.equal(r.ok, true); assert.equal(r.to, '2026-11');
    assert.ok(writes.indexOf('mm_customers_2026-11') >= 0 && writes.indexOf('mm_customers_unscheduled') > writes.indexOf('mm_customers_2026-11'), writes.join());
    const dest = json("DataStorage.getCustomersForWorkspace('2026-11')");
    assert.deepEqual(dest.map(c => c.id), ['keep', 'u1']);
    assert.deepEqual(dest[0], customer('keep', { appoDate: '2026-11-02T09:00' }));
    const moved = dest[1];
    assert.equal(moved.appoDate, '2026-11-05T10:00'); assert.equal(moved.mailKey, 'mk-1'); assert.equal(moved.receivedMonth, '2026-10'); assert.equal(moved.routeId, null);
    assert.deepEqual(json("DataStorage.getCustomersForWorkspace('unscheduled')").map(c => c.id), ['u0']);
    assert.equal(run('DataStorage.getCurrentWorkspaceId()'), '2026-10');
});
test('移動先の月ワークスペースが無ければ作ってから移す(既存の月は作り直さない)', () => {
    const { run, json } = withUnscheduled();
    const r = json(MOVE({ to: '2026-12', appoDate: '2026-12-01T09:00' }));
    assert.equal(r.ok, true);
    assert.ok(json('DataStorage.getWorkspaces()').some(w => w.id === '2026-12'));
    const m = json(MOVE({ id: 'u0', to: '2026-10', appoDate: '2026-10-20T09:00' }));
    assert.equal(m.ok, true);
    assert.deepEqual(json("DataStorage.getCustomersForWorkspace('2026-10')").map(c => c.id), ['a', 'u0']);
});
test('移動先への書き込みが失敗したら、元にも移動先にも何も起きない', () => {
    const { run, json, hooks, store } = withUnscheduled();
    run("DataStorage.createWorkspace('2026-11')");
    const before = new Map(store);
    hooks.failKey = 'mm_customers_2026-11';
    const r = json(MOVE());
    assert.equal(r.ok, false); assert.equal(r.reason, 'destination_write_failed');
    hooks.failKey = null;
    for (const [k, v] of before) assert.equal(store.get(k), v, k);
});
test('元の削除に失敗したら、移動先を元に戻し、元の訪問先は残る(二重登録を残さない)', () => {
    const { run, json, hooks, store } = withUnscheduled();
    run("DataStorage.createWorkspace('2026-11')");
    const before = new Map(store);
    hooks.failKey = 'mm_customers_unscheduled';
    const r = json(MOVE());
    assert.equal(r.ok, false); assert.equal(r.reason, 'source_write_failed'); assert.equal(r.rolledBack, true);
    hooks.failKey = null;
    for (const [k, v] of before) assert.equal(store.get(k), v, k);
    assert.ok(json("DataStorage.getCustomersForWorkspace('unscheduled')").some(c => c.id === 'u1'));
});
test('元の削除と巻き戻しの両方が失敗しても、元の訪問先は消えない(二重の可能性を結果で知らせる)', () => {
    const { run, json, context, store } = withUnscheduled();
    run("DataStorage.createWorkspace('2026-11')");
    store.set('mm_customers_2026-11', '[]');
    // 移動先は1回目の書き込みだけ成功させ、巻き戻し(2回目)は失敗させる
    let n = 0;
    const orig = context.AppStorage.setItem;
    context.AppStorage.setItem = (k, v) => {
        if (k === 'mm_customers_unscheduled') throw new Error('quota');
        if (k === 'mm_customers_2026-11' && ++n >= 2) throw new Error('quota');
        return orig(k, v);
    };
    const r = json(MOVE());
    assert.equal(r.ok, false); assert.equal(r.rolledBack, false); assert.equal(r.maybeDuplicated, true);
    context.AppStorage.setItem = orig;
    assert.ok(json("DataStorage.getCustomersForWorkspace('unscheduled')").some(c => c.id === 'u1'));
});
test('移動先に同じ内容の訪問先がある場合は移さず、確認の上forceで移せる', () => {
    const { run, json, store } = withUnscheduled();
    run("DataStorage.createWorkspace('2026-11')");
    store.set('mm_customers_2026-11', JSON.stringify([customer('x', { company: '架空会社R', address: '東京都 架空区１', purpose: '修理' })]));
    const before = new Map(store);
    const r = json(MOVE());
    assert.equal(r.ok, false); assert.equal(r.reason, 'duplicate'); assert.equal(r.duplicateOf, 'x');
    for (const [k, v] of before) assert.equal(store.get(k), v, k);
    assert.equal(json(MOVE({ force: true })).ok, true);
});
test('別会社・別作業・別管理番号は重複扱いしない。渡された判定関数があればそれを使う', () => {
    const { run, json, store } = withUnscheduled();
    run("DataStorage.createWorkspace('2026-11')");
    store.set('mm_customers_2026-11', JSON.stringify([customer('x', { company: '架空会社R', address: '東京都架空区1', purpose: '本体設置' })]));
    assert.equal(json(MOVE()).ok, true);
    const e = withUnscheduled();
    e.run("DataStorage.createWorkspace('2026-11')");
    e.context.always = () => true;
    e.store.set('mm_customers_2026-11', JSON.stringify([customer('y', { company: '全然違う会社' })]));
    const r = JSON.parse(JSON.stringify(e.run("DataStorage.moveCustomerToWorkspace({id:'u1',from:'unscheduled',to:'2026-11',appoDate:'2026-11-05T10:00',isDuplicate:always})")));
    assert.equal(r.reason, 'duplicate');
});
test('同じIDが移動先に既にある場合は上書きせず止める', () => {
    const { run, json, store } = withUnscheduled();
    run("DataStorage.createWorkspace('2026-11')");
    store.set('mm_customers_2026-11', JSON.stringify([customer('u1', { company: '別の会社' })]));
    const before = store.get('mm_customers_2026-11');
    const r = json(MOVE({ force: true }));
    assert.equal(r.ok, false); assert.equal(r.reason, 'id_conflict');
    assert.equal(store.get('mm_customers_2026-11'), before);
});
test('作業日が空・不正・移動先の月と違う場合は移さない。unscheduledへ戻す時は作業日を持てない', () => {
    const { json, writes } = withUnscheduled();
    for (const appoDate of ['', null, 'あした', '2026-13-40', '2026-12-05T10:00']) {
        const r = json(MOVE({ appoDate }));
        assert.equal(r.ok, false, String(appoDate)); assert.equal(r.reason, 'invalid_date', String(appoDate));
    }
    assert.equal(json(MOVE({ to: 'unscheduled' })).ok, false);
    assert.equal(json(MOVE({ to: 'abc' })).reason, 'invalid_destination');
    assert.equal(json(MOVE({ from: '2026-11', to: '2026-11' })).ok, false);
    assert.deepEqual(writes, []);
});
test('保存データが壊れている場合は空扱いで上書きせず、何も書かない', () => {
    const { run, json, store, writes } = withUnscheduled();
    run("DataStorage.createWorkspace('2026-11')");
    store.set('mm_customers_2026-11', '{broken');
    writes.length = 0;
    const r = json(MOVE());
    assert.equal(r.ok, false); assert.equal(r.reason, 'read_failed');
    assert.equal(store.get('mm_customers_2026-11'), '{broken');
    assert.deepEqual(writes, []);
});
test('月から月への付け替えではルート指定を外す(ルート順は月ごとのため)', () => {
    const { json } = withUnscheduled();
    const r = json("DataStorage.moveCustomerToWorkspace({id:'a',from:'2026-10',to:'2026-11',appoDate:'2026-11-03T10:00'})");
    assert.equal(r.ok, true);
    assert.equal(json("DataStorage.getCustomersForWorkspace('2026-11')")[0].routeId, null);
});

// --- (4) 取り込み時の振り分け ---
test('登録先の判定: 作業日あり→その月 / なし→unscheduled / 複数月→自動では決めない', () => {
    const t = { today: '2026-10-28' };
    assert.deepEqual(pick(Month.registrationTarget(Month.resolveRegistrationMonth({ workDateText: '2026-11-05', ...t }))), { workspaceId: '2026-11', reviewNeeded: false });
    assert.deepEqual(pick(Month.registrationTarget(Month.resolveRegistrationMonth({ workDateText: '', receivedDate: '2026-10-20', ...t }))), { workspaceId: U, reviewNeeded: false });
    assert.deepEqual(pick(Month.registrationTarget(Month.resolveRegistrationMonth({ workDateText: '11/5と12/3', ...t }))), { workspaceId: null, reviewNeeded: true });
    assert.deepEqual(pick(Month.registrationTarget(null)), { workspaceId: null, reviewNeeded: true });
});
function pick(x) { return { workspaceId: x.workspaceId, reviewNeeded: x.reviewNeeded }; }
test('取り込み項目の振り分け: 月ごと・日程未定・要確認に分け、受信月を参考情報として残す', () => {
    const items = [
        { id: 1, workDateText: '2026-11-05' }, { id: 2, workDateText: '' }, { id: 3, workDateText: '2026-11-20' },
        { id: 4, workDateText: '11/5と12/3' }, { id: 5, workDateText: '2026-10-30' }, { id: 6, workDateText: '   ' }
    ];
    const plan = Month.routeItems(items, { today: '2026-10-28', receivedDate: '2026-10-20' });
    assert.deepEqual(plan.workspaces['2026-11'].map(i => i.id), [1, 3]);
    assert.deepEqual(plan.workspaces['2026-10'].map(i => i.id), [5]);
    assert.deepEqual(plan.workspaces[U].map(i => i.id), [2, 6]);
    assert.deepEqual(plan.review.map(i => i.id), [4]);
    assert.ok(plan.workspaces[U].every(i => i.receivedMonth === '2026-10'));
    assert.equal(plan.total, items.length);
    assert.equal(items[0].receivedMonth, undefined, '元の項目は書き換えない');
});
test('項目ごとの受信日・タイトルがあればそれを使い、一覧表のタイトル月を作業日の代わりに使う', () => {
    const plan = Month.routeItems([
        { id: 1, workDateText: '', titleText: '12月定期メンテナンスリスト', receivedDate: '2026-10-25' },
        { id: 2, workDateText: '', receivedDate: '2026-09-30' }
    ], { today: '2026-10-28' });
    assert.deepEqual(plan.workspaces['2026-12'].map(i => i.id), [1]);
    assert.deepEqual(plan.workspaces[U].map(i => i.id), [2]);
    assert.equal(plan.workspaces[U][0].receivedMonth, '2026-09');
});

// --- (2) 月切替UIの保護 ---
function loadUi(withReserved = true) {
    const els = {};
    const el = id => els[id] || (els[id] = { id, innerHTML: '', textContent: '', style: {}, value: '', classList: { add() {}, remove() {}, contains: () => false } });
    const env = setup(legacy());
    if (withReserved) {
        env.run('DataStorage.ensureUnscheduledWorkspace()');
        env.run("DataStorage.saveCustomersForWorkspace('unscheduled',[{id:'u0'}])");
    }
    vm.runInContext('globalThis.DataStorage = DataStorage', env.context);
    Object.assign(env.context, {
        document: { getElementById: el, querySelector: () => null, addEventListener() {} },
        ExpenseImport: require('../expense/expense-import'), MapCore: { refreshAllMarkers() {} }, RouteManager: { updateRoutePanel() {} },
        toggleMenu() {}, confirm: () => false, window: {}
    });
    vm.runInContext(fs.readFileSync(require.resolve('../map/ui-actions.js'), 'utf8'), env.context, { filename: 'map/ui-actions.js' });
    return { ...env, el };
}
test('月切替ボタン: unscheduledを選んでも「日程未定」と表示し、NaNや英字IDを出さない', () => {
    const { run, el } = loadUi();
    run("DataStorage.switchWorkspace('unscheduled'); updateWsButton()");
    assert.equal(el('wsSwitchBtn').textContent, '📅 日程未定');
    assert.doesNotMatch(el('wsSwitchBtn').textContent, /NaN|unscheduled/);
    run("DataStorage.switchWorkspace('2026-10'); updateWsButton()");
    assert.equal(el('wsSwitchBtn').textContent, '📅 10月');
});
test('月メニュー: 日程未定は表示名と件数を出し、削除ボタンを出さず、月は従来表示のまま', () => {
    const { run, el } = loadUi();
    run('showWorkspaceMenu()');
    const html = el('wsMenuList').innerHTML;
    assert.match(html, /日程未定/); assert.doesNotMatch(html, /NaN/);
    assert.doesNotMatch(html, /ws-menu-name">unscheduled/);
    assert.doesNotMatch(html, /confirmDeleteWorkspace\(&quot;unscheduled/);
    assert.match(html, /2026年10月/);
    assert.match(html, /confirmDeleteWorkspace\(&quot;2026-09/);
});
test('月の追加ダイアログ: 月の形式以外(予約名を含む)では作成せず、正しい月は従来どおり作れる', () => {
    const { run, el, json } = loadUi(false);
    for (const bad of ['unscheduled', 'abc', '2026-13']) {
        el('addWsMonth').value = bad;
        run('addWorkspace()');
    }
    assert.deepEqual(json('DataStorage.getWorkspaces()').map(w => w.id), ['2026-09', '2026-10']);
    el('addWsMonth').value = '2026-11';
    run('addWorkspace()');
    assert.deepEqual(json('DataStorage.getWorkspaces()').map(w => w.id), ['2026-09', '2026-10', '2026-11']);
});
test('取り込み側と保存側の予約IDは同じ値', () => {
    const { run } = setup();
    assert.equal(Month.UNSCHEDULED_ID, run('DataStorage.UNSCHEDULED_ID'));
    assert.equal(run('DataStorage.UNSCHEDULED_NAME'), '日程未定');
});
