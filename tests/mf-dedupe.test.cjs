// 本体番号(MF)での重複防止・掃除のテスト。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../map/mf-dedupe.js');
const c = (o = {}) => ({ id: 'x', company: '架空商事', address: '東京都架空区1', managementNo: '', status: 'pending', routeId: null, appoDate: '', note: '', createdAt: '2026-10-01T00:00:00Z', ...o });

test('MF番号の取り出し: 全角・空白・小文字も同じ番号に、MF以外は空', () => {
    assert.equal(D.mfOf({ managementNo: 'ＭＦ１２３４５６' }), 'MF123456');
    assert.equal(D.mfOf({ managementNo: 'mf 123456' }), 'MF123456');
    assert.equal(D.mfOf({ managementNo: 'A-100' }), '');
    assert.equal(D.mfOf({}), '');
});
test('取り込み: 同じMFがどの月・日程未定にあっても足さない。MF無しは今まで通り。会社名・住所では判断しない', () => {
    const idx = D.index([{ ws: '2026-10', customers: [c({ id: 'a', managementNo: 'MF100001' })] }, { ws: '2026-11', customers: [c({ id: 'b', managementNo: 'MF100002' })] }]);
    assert.equal(D.decide(c({ managementNo: 'MF100001' }), '2026-11', idx).action, 'skip');
    assert.equal(D.decide(c({ managementNo: 'MF100002', company: '別会社', address: '別住所' }), '2026-10', idx).action, 'skip');
    assert.equal(D.decide(c({ managementNo: 'MF100003' }), '2026-10', idx).action, 'add');
    assert.equal(D.decide(c({ managementNo: '' }), '2026-10', idx).action, 'add');
});
test('取り込み: 日程未定にある機械に作業日つきの依頼が来たら、その月へ移す(足さない)', () => {
    const idx = D.index([{ ws: 'unscheduled', customers: [c({ id: 'u', managementNo: 'MF200001' })] }]);
    const r = D.decide(c({ managementNo: 'MF200001', appoDate: '2026-11-05T10:00' }), '2026-11', idx);
    assert.equal(r.action, 'move'); assert.equal(r.hit.c.id, 'u');
    assert.equal(D.decide(c({ managementNo: 'MF200001', appoDate: '' }), 'unscheduled', idx).action, 'skip');
});
test('掃除: 同じ月の完全な重複は、入力の多い方を残し、もう一方の空欄・メモを足してから消す', () => {
    const lists = [{ ws: '2026-10', customers: [
        c({ id: 'a', managementNo: 'MF300001', phone: '', note: '取り込みメモ' }),
        c({ id: 'b', managementNo: 'MF300001', phone: '03-0000-0000', note: '取り込みメモ\n別メモ', routeId: 'route_1', status: 'appointed', appoDate: '2026-10-10T09:00' }),
        c({ id: 'n1', managementNo: '' }), c({ id: 'n2', managementNo: '' })
    ] }];
    const p = D.plan(lists);
    assert.deepEqual(p.remove, [{ ws: '2026-10', id: 'a' }]);
    assert.equal(p.patch.length, 0); // 残す側(b)にメモも電話もすでにある
});
test('掃除: 利用者の入力(ルート・状態・違う日時)がある方は両方残す。MF無しは触らない', () => {
    const p = D.plan([{ ws: '2026-10', customers: [
        c({ id: 'a', managementNo: 'MF400001', routeId: 'route_1' }), c({ id: 'b', managementNo: 'MF400001', routeId: 'route_2' }),
        c({ id: 'd', managementNo: 'MF400002', appoDate: '2026-10-01T09:00' }), c({ id: 'e', managementNo: 'MF400002', appoDate: '2026-10-20T09:00' })
    ] }]);
    assert.equal(p.remove.length, 0); assert.equal(p.kept, 2);
});
test('掃除: 月と日程未定に同じ機械 → 月の方を残し、日程未定の方は消す。残す側の空欄は埋める', () => {
    const p = D.plan([
        { ws: 'unscheduled', customers: [c({ id: 'u', managementNo: 'MF500001', phone: '03-1111-1111', note: '鍵は受付' })] },
        { ws: '2026-11', customers: [c({ id: 'm', managementNo: 'MF500001', appoDate: '2026-11-02T10:00' })] }
    ]);
    assert.deepEqual(p.remove, [{ ws: 'unscheduled', id: 'u' }]);
    assert.deepEqual(p.patch, [{ ws: '2026-11', id: 'm', changes: { phone: '03-1111-1111', note: '鍵は受付' } }]);
});
test('掃除の実行は一度だけ。消した分は控えに残る', () => {
    const lists = { '2026-10': [c({ id: 'a', managementNo: 'MF600001' }), c({ id: 'b', managementNo: 'MF600001' })] };
    const store = new Map();
    const data = { getWorkspaces: () => [{ id: '2026-10' }], getCustomersForWorkspace: ws => lists[ws], saveCustomersForWorkspace: (ws, l) => { lists[ws] = l; } };
    const storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    const r = D.runOnce(data, storage, '2026-10-30T00:00:00Z');
    assert.equal(r.removed, 1); assert.deepEqual(lists['2026-10'].map(x => x.id), ['a']);
    assert.equal(JSON.parse(store.get(D.BACKUP)).removed[0].c.id, 'b');
    lists['2026-10'].push(c({ id: 'z', managementNo: 'MF600001' }));
    assert.equal(D.runOnce(data, storage).ran, false);
});
