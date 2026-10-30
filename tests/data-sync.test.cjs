// 訪問先データの端末間自動同期のテスト。2台(3台)の端末を vm で作り、偽のDriveでつなぐ。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001', ID_B = 'bbbbbbbb-0000-4000-8000-000000000002', ID_C = 'cccccccc-0000-4000-8000-000000000003';
const T0 = Date.parse('2026-10-30T10:00:00+09:00'), MIN = 60000;
function makeDrive() { return { files: new Map(), n: 0 }; }
function makeAdapter(drive, hooks = {}) {
    return {
        available: () => ({ connected: hooks.connected !== false }),
        async list() { return [...drive.files.values()].map(f => ({ id: f.id, deviceId: f.deviceId, savedAt: f.savedAt, size: f.text.length })); },
        async read(f) { return drive.files.get(f.id).text; },
        async write({ fileId, deviceId, text, savedAt }) { if (hooks.writeError) throw Object.assign(new Error('x'), { code: 'network' }); const id = fileId && drive.files.has(fileId) ? fileId : 'f' + (++drive.n); drive.files.set(id, { id, deviceId, savedAt, text }); return { id }; }
    };
}
const ws = (...ids) => JSON.stringify(ids.map(id => ({ id, name: id === 'unscheduled' ? '日程未定' : id, createdAt: '2026-10-01T00:00:00.000Z' })));
const cust = (id, extra = {}) => ({ id, company: '架空商事' + id, address: '東京都架空区' + id, purpose: '修理', status: 'pending', routeId: null, createdAt: '2026-10-01T00:00:00.000Z', ...extra });
function device(deviceId, drive, seed = {}, hooks = {}) {
    const store = new Map(Object.entries(seed));
    const storage = { keys: () => [...store.keys()], getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
    const ctx = vm.createContext({ console, setTimeout, clearTimeout, crypto: require('node:crypto').webcrypto });
    vm.runInContext(fs.readFileSync(require.resolve('../map/mf-dedupe.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(require.resolve('../map/data-sync.js'), 'utf8'), ctx);
    let now = T0; const backups = [];
    ctx.__opts = { storage, adapter: makeAdapter(drive, hooks), now: () => new Date(now), uuid: () => deviceId, backup: async () => { backups.push(JSON.stringify([...store.entries()])); } };
    const s = vm.runInContext('DataSync.create(__opts)', ctx);
    const get = k => JSON.parse(store.get(k) || 'null');
    const put = (k, v) => store.set(k, JSON.stringify(v));
    const all = () => [...store.keys()].filter(k => /^mm_customers_/.test(k)).flatMap(k => get(k).map(c => ({ ...c, _ws: k.slice(13) })));
    return {
        store, backups, sync: async o => JSON.parse(JSON.stringify(await s.sync(o))), tick: m => { now += m * MIN; }, status: () => s.status(), cp: () => JSON.parse(JSON.stringify(s.checkpoint())), sig: async () => JSON.parse(JSON.stringify(await s.remoteSignature())), rebase: () => s.rebase(), fp: () => s.fingerprint(),
        get, put, all, find: id => all().find(c => c.id === id),
        edit: (wsId, id, patch) => put('mm_customers_' + wsId, get('mm_customers_' + wsId).map(c => c.id === id ? { ...c, ...patch } : c)),
        add: (wsId, c) => { if (!get('mm_workspaces').some(w => w.id === wsId)) put('mm_workspaces', [...get('mm_workspaces'), { id: wsId, name: wsId }]); put('mm_customers_' + wsId, [...(get('mm_customers_' + wsId) || []), c]); },
        del: (wsId, id) => put('mm_customers_' + wsId, get('mm_customers_' + wsId).filter(c => c.id !== id)),
        move: (from, to, id, patch = {}) => { const c = get('mm_customers_' + from).find(x => x.id === id); put('mm_customers_' + from, get('mm_customers_' + from).filter(x => x.id !== id)); put('mm_customers_' + to, [...(get('mm_customers_' + to) || []), { ...c, ...patch }]); }
    };
}
const seedOf = (custs, extra = {}) => ({ mm_workspaces: ws('2026-10', '2026-11', 'unscheduled'), mm_workspace_current: '2026-10', 'mm_customers_2026-10': JSON.stringify(custs['2026-10'] || []), 'mm_customers_2026-11': JSON.stringify(custs['2026-11'] || []), mm_customers_unscheduled: JSON.stringify(custs.unscheduled || []), mm_settings: JSON.stringify({ homeAddress: '東京都架空区本社', apiKey: 'KEY-架空-ローカル' }), ...extra });
async function settle(...ds) { for (let i = 0; i < 2; i++) for (const d of ds) { const r = await d.sync(); assert.equal(r.ok, true, JSON.stringify(r)); } }
const ids = d => d.all().map(c => c.id).sort();

test('初回: 両端末に別々のデータがあっても置き換えず合わせる。合わせる前に控えを取る', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1'), cust('c2')] }));
    const B = device(ID_B, drive, seedOf({ '2026-10': [cust('c1'), cust('c3')], unscheduled: [cust('u1')] }));
    await settle(A, B);
    assert.deepEqual(ids(A), ['c1', 'c2', 'c3', 'u1']); assert.deepEqual(ids(B), ids(A));
    assert.equal(A.find('u1')._ws, 'unscheduled');
    assert.equal(A.backups.length, 1); assert.equal(B.backups.length, 1);
    assert.equal(A.status().everSynced, true);
});
test('初回: 同じIDで中身が食い違うときは空でない方を採り、以後の本当の編集が必ず勝つ', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1', { note: '' })] }));
    const B = device(ID_B, drive, seedOf({ '2026-10': [cust('c1', { note: '架空メモ' })] }));
    const r = await A.sync(); await B.sync(); await A.sync();
    assert.equal(A.find('c1').note, '架空メモ'); assert.equal(B.find('c1').note, '架空メモ');
    A.tick(1); A.edit('2026-10', 'c1', { note: '' }); await settle(A, B);
    assert.equal(B.find('c1').note, '');
});
test('同時の編集: 別の項目なら両方残る。同じ項目なら後の編集が勝つ', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    A.tick(1); A.edit('2026-10', 'c1', { phone: '000-0000-0001', note: 'Aのメモ' });
    B.tick(2); B.edit('2026-10', 'c1', { status: 'appointed', appoDate: '2026-10-20T10:00', note: 'Bのメモ(後)' });
    await settle(A, B);
    for (const d of [A, B]) { const c = d.find('c1'); assert.equal(c.phone, '000-0000-0001'); assert.equal(c.status, 'appointed'); assert.equal(c.note, 'Bのメモ(後)'); }
});
test('削除: 片方で消すともう片方からも消え、古いファイルや古い端末から復活しない', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1'), cust('c2')] })), B = device(ID_B, drive, seedOf({})), C = device(ID_C, drive, seedOf({}));
    await settle(A, B, C);
    const oldC = drive.files.get([...drive.files.values()].find(f => f.deviceId === ID_C).id).text;
    A.tick(5); A.del('2026-10', 'c2'); await settle(A, B);
    assert.equal(B.find('c2'), undefined);
    // Cはオフラインのまま(古い内容のファイル)。それでもA・Bに戻らない
    const fc = [...drive.files.values()].find(f => f.deviceId === ID_C); fc.text = oldC;
    await settle(A, B); assert.equal(A.find('c2'), undefined); assert.equal(B.find('c2'), undefined);
    await C.sync(); assert.equal(C.find('c2'), undefined);
    const text = [...drive.files.values()].find(f => f.deviceId === ID_A).text;
    assert.equal(text.includes('架空商事c2'), false);   // 削除の印には中身を入れない
});
test('削除と編集が同時: 削除より後の編集は失わない。前の編集は削除が勝つ', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1'), cust('c2')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    B.tick(1); B.edit('2026-10', 'c1', { note: '先に編集' }); B.cp(); A.tick(3); A.del('2026-10', 'c1');
    A.del('2026-10', 'c2'); A.cp(); B.tick(5); B.edit('2026-10', 'c2', { note: '削除の後に編集' }); B.cp();   // 数秒ごとの記録(通信なし)
    await settle(A, B);
    for (const d of [A, B]) { assert.equal(d.find('c1'), undefined); assert.equal(d.find('c2').note, '削除の後に編集'); assert.equal(d.find('c2').company, '架空商事c2'); }
});
test('移動: 日程未定→月、月→別の月が伝わり、二重にならない。移動と編集が同時でも両方残る', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ unscheduled: [cust('u1')], '2026-10': [cust('c1')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    A.tick(1); A.move('unscheduled', '2026-11', 'u1', { appoDate: '2026-11-05T09:00' });
    B.tick(2); B.edit('unscheduled', 'u1', { note: 'Bで追記' });
    B.move('2026-10', '2026-11', 'c1');
    await settle(A, B);
    for (const d of [A, B]) {
        assert.equal(d.all().filter(c => c.id === 'u1').length, 1);
        const u = d.find('u1'); assert.equal(u._ws, '2026-11'); assert.equal(u.appoDate, '2026-11-05T09:00'); assert.equal(u.note, 'Bで追記');
        assert.equal(d.find('c1')._ws, '2026-11'); assert.deepEqual(d.get('mm_customers_unscheduled'), []);
    }
});
test('MF番号が同じで別ID(両端末で同じ依頼を取り込んだ): 入力の無い方をまとめ、ルート・状態を入れた方を残す', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('a1', { managementNo: 'MF12345', routeId: 'route_2', status: 'appointed' })] }));
    const B = device(ID_B, drive, seedOf({ '2026-10': [cust('b1', { managementNo: 'mf-12345', phone: '000-1111-2222' })] }));
    await settle(A, B);
    for (const d of [A, B]) { const list = d.all().filter(c => /12345/.test(c.managementNo || '')); assert.equal(list.length, 1); assert.equal(list[0].id, 'a1'); assert.equal(list[0].phone, '000-1111-2222'); }
});
test('ルート・区間・精算書・月の一覧・会社住所も揃う。APIキーと表示中の月は端末ごと', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] }, { 'mm_routes_2026-10': JSON.stringify([{ id: 'route_1', name: 'ルート1', color: '#4285f4', order: [] }]), 'mm_expenses_2026-10': JSON.stringify([{ id: 'exp_1', createdAt: '2026-10-02T00:00:00Z', total: 1200 }]) }));
    const B = device(ID_B, drive, { ...seedOf({}), mm_settings: JSON.stringify({ homeAddress: '', apiKey: 'B-KEY-架空' }), mm_workspace_current: '2026-11' });
    await settle(A, B);
    A.tick(1); A.put('mm_routes_2026-10', [{ id: 'route_1', name: '午前ルート', color: '#4285f4', order: ['c1'] }]); A.put('mm_segments_2026-10', { 'c1>c2': { toll: true } });
    A.add('2026-12', cust('d1')); A.put('mm_settings', { homeAddress: '東京都架空区新本社', apiKey: 'KEY-架空-ローカル' });
    await settle(A, B);
    assert.deepEqual(B.get('mm_routes_2026-10')[0].order, ['c1']); assert.equal(B.get('mm_routes_2026-10')[0].name, '午前ルート');
    assert.deepEqual(B.get('mm_segments_2026-10'), { 'c1>c2': { toll: true } });
    assert.equal(B.get('mm_expenses_2026-10')[0].total, 1200);
    assert.equal(B.get('mm_workspaces').some(w => w.id === '2026-12'), true); assert.equal(B.find('d1')._ws, '2026-12');
    assert.equal(B.get('mm_settings').homeAddress, '東京都架空区新本社'); assert.equal(B.get('mm_settings').apiKey, 'B-KEY-架空');
    assert.equal(B.store.get('mm_workspace_current'), '2026-11');
    assert.equal(JSON.stringify([...drive.files.values()]).includes('KEY-架空'), false);
});
test('月ごと削除が伝わる(中の訪問先も)', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-11': [cust('n1')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    A.tick(1); A.put('mm_workspaces', A.get('mm_workspaces').filter(w => w.id !== '2026-11')); A.store.delete('mm_customers_2026-11');
    await settle(A, B);
    assert.equal(B.get('mm_workspaces').some(w => w.id === '2026-11'), false); assert.equal(B.store.has('mm_customers_2026-11'), false); assert.equal(B.find('n1'), undefined);
});
test('一度に多く消えたら止めて確認する。「戻す」を選ぶと他端末から戻り、削除は伝わらない', async () => {
    const drive = makeDrive();
    const list = Array.from({ length: 10 }, (_, i) => cust('m' + i));
    const A = device(ID_A, drive, seedOf({ '2026-10': list })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    A.tick(1); A.put('mm_customers_2026-10', list.slice(0, 2));
    const r = await A.sync(); assert.equal(r.ok, false); assert.equal(r.code, 'mass_delete'); assert.equal(r.count, 8);
    const r2 = await A.sync({ massDelete: 'restore' }); assert.equal(r2.ok, true);
    assert.equal(A.all().length, 10); await B.sync(); assert.equal(B.all().length, 10);
    A.tick(1); A.put('mm_customers_2026-10', list.slice(0, 2));
    assert.equal((await A.sync({ massDelete: 'allow' })).ok, true); await B.sync(); assert.equal(B.all().length, 2);
});
test('「受け取る」で入れ替えた後(rebase): 消えた分を削除として伝えない', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1'), cust('c2')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    B.put('mm_customers_2026-10', [cust('c1')]); B.rebase();
    await settle(B, A);
    assert.deepEqual(ids(A), ['c1', 'c2']); assert.deepEqual(ids(B), ['c1', 'c2']);
});
test('不正なファイル・項目は使わない(他端末のファイルは信用しない)', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] }));
    const at = T0;
    drive.files.set('bad', { id: 'bad', deviceId: ID_B, savedAt: '', text: JSON.stringify({ app: 'CULOchanDataSync1', v: 1, deviceId: ID_B, savedAt: '', recs: {
        cust: { '__proto__': { a: at, f: {} }, x1: { a: at, f: { company: [at, '架空'], apiKey: [at, 'k'] } }, x2: { a: at, f: { _ws: [at, '../../etc'] } }, x3: { a: at, f: { company: [at, '架空正常'], _ws: [at, '2026-10'] } }, x4: { a: at + 365 * 86400000, f: { _ws: [at, '2026-10'] } } },
        evil: { k: {} } } }) });
    drive.files.set('newer', { id: 'newer', deviceId: ID_C, savedAt: '', text: JSON.stringify({ app: 'CULOchanDataSync1', v: 2, deviceId: ID_C, recs: {} }) });
    drive.files.set('junk', { id: 'junk', deviceId: 'dddddddd-0000-4000-8000-000000000004', savedAt: '', text: '{oops' });
    const r = await A.sync();
    assert.equal(r.ok, true); assert.ok(r.warnings.includes('records_dropped')); assert.ok(r.warnings.includes('newer_version')); assert.ok(r.warnings.includes('file_invalid'));
    assert.deepEqual(ids(A), ['c1', 'x3']);
    assert.equal(Object.prototype.polluted, undefined);
});
test('読めない手元データがあれば何も書かない', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, { ...seedOf({}), 'mm_customers_2026-10': '{壊れた' });
    const r = await A.sync(); assert.equal(r.ok, false); assert.equal(r.code, 'local_corrupt');
    assert.equal(A.store.get('mm_customers_2026-10'), '{壊れた'); assert.equal(drive.files.size, 0);
});
test('未接続なら何もしない。送信に失敗しても手元は合わせ済みで、次で送る', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] }), { connected: false });
    assert.equal((await A.sync()).code, 'not_connected');
    const hooks = { writeError: true }; const B = device(ID_B, drive, seedOf({ '2026-10': [cust('b1')] }), hooks);
    const r = await B.sync(); assert.equal(r.ok, true); assert.ok(r.warnings.includes('push_failed'));
    hooks.writeError = false; const r2 = await B.sync(); assert.equal(r2.stats.pushed, true);
});
test('変更がなければ送り直さない。変わると要約(fingerprint)が変わる', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] }));
    await A.sync(); const f1 = A.fp();
    const r = await A.sync(); assert.equal(r.stats.pushed, false);
    A.edit('2026-10', 'c1', { note: 'x' }); assert.notEqual(A.fp(), f1);
});
test('IDの無い訪問先にはIDを付けて追う', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [{ company: '架空ID無し', address: '架空' }] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    assert.match(A.all()[0].id, /^c_/); assert.equal(B.all()[0].id, A.all()[0].id);
});
test('通信なしの記録(checkpoint): オフラインで先に編集した方が、後でつないでも後の編集に負ける', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    A.tick(1); A.edit('2026-10', 'c1', { note: 'Aが10:01(オフライン)' }); assert.equal(A.cp().changed, true);
    B.tick(2); B.edit('2026-10', 'c1', { note: 'Bが10:02' }); await B.sync();
    A.tick(30); await settle(A, B);
    assert.equal(A.find('c1').note, 'Bが10:02'); assert.equal(B.find('c1').note, 'Bが10:02');
});
test('大きさの上限: 送れないときは警告し、手元のデータは消さない', async () => {
    const drive = makeDrive();
    const big = Array.from({ length: 260 }, (_, i) => cust('g' + i, { note: '架'.repeat(19000) }));
    const A = device(ID_A, drive, seedOf({ '2026-10': big }));
    const r = await A.sync(); assert.equal(r.ok, true); assert.ok(r.warnings.includes('too_large')); assert.equal(drive.files.size, 0); assert.equal(A.all().length, 260);
});

// ---- 触っていない端末も自動で変わる(定期の確認) ----
const { createPoller } = require('../map/data-sync-ui.js');
function pollRig(A, extra = {}) {
    const env = { visible: true, connected: true, editing: false, syncs: 0, listCalls: 0, fail: false };
    const core = { async remoteSignature() { env.listCalls++; if (env.fail) return { ok: false, code: 'network' }; return A.sig(); } };
    const p = createPoller({ core, isVisible: () => env.visible, isConnected: () => env.connected, isEditing: () => env.editing, runSync: async () => { env.syncs++; return A.sync(); }, ...extra });
    return { env, p };
}
test('定期の確認: もう1台の変更を、触っていない端末が一覧だけ見て取り込む。変化が無ければ中身を読まない', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    const { env, p } = pollRig(B);
    assert.equal(await p.check(), 'synced');      // 起動後の1回目は合わせる
    assert.equal(await p.check(), 'same'); assert.equal(env.syncs, 1);
    A.tick(1); A.edit('2026-10', 'c1', { note: 'Aで変更' }); await A.sync();
    assert.equal(await p.check(), 'synced'); assert.equal(B.find('c1').note, 'Aで変更');
    assert.equal(await p.check(), 'same'); assert.equal(env.syncs, 2);
});
test('定期の確認: 入力中は反映を待ち、入力が終わったら反映する(打っている文字は消えない)', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    const { env, p } = pollRig(B); await p.check();
    A.tick(1); A.edit('2026-10', 'c1', { note: 'Aで変更' }); await A.sync();
    env.editing = true;
    assert.equal(await p.check(), 'deferred'); assert.equal(B.find('c1').note, undefined); assert.equal(p.isDeferred(), true);
    assert.equal(await p.check(), 'deferred');
    // Bで入力していた内容が保存される → 両方残る
    B.tick(2); B.edit('2026-10', 'c1', { phone: '000-2222-3333' }); env.editing = false;
    assert.equal(await p.check(), 'synced');
    assert.equal(B.find('c1').note, 'Aで変更'); assert.equal(B.find('c1').phone, '000-2222-3333');
    assert.equal(await p.check(), 'same');
});
test('定期の確認: 裏に回っている・未接続のときは通信しない。失敗が続くと間隔を延ばし、成功で戻す', async () => {
    const drive = makeDrive();
    const B = device(ID_B, drive, seedOf({}));
    const { env, p } = pollRig(B, { baseMs: 20000, maxMs: 300000 });
    env.visible = false; assert.equal(await p.check(), 'paused');
    env.visible = true; env.connected = false; assert.equal(await p.check(), 'paused');
    assert.equal(env.listCalls, 0);
    env.connected = true; env.fail = true;
    for (const want of [40000, 80000, 160000, 300000, 300000]) { assert.equal(await p.check(), 'error'); assert.equal(p.delay(), want); }
    env.fail = false; await p.check(); assert.equal(p.delay(), 20000);
});
test('remoteSignature: 自分のファイルは見ず、他の端末が送ると変わる', async () => {
    const drive = makeDrive();
    const A = device(ID_A, drive, seedOf({ '2026-10': [cust('c1')] })), B = device(ID_B, drive, seedOf({}));
    await settle(A, B);
    const s1 = await B.sig(); assert.equal(s1.ok, true);
    B.tick(1); B.edit('2026-10', 'c1', { note: 'B' }); await B.sync();
    assert.equal((await B.sig()).sig, s1.sig);
    A.tick(2); A.edit('2026-10', 'c1', { note: 'A' }); await A.sync();
    assert.notEqual((await B.sig()).sig, s1.sig);
});
