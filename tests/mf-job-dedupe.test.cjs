const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../map/mf-dedupe');
// Fictional data only.
const c = (id, purpose, extra = {}) => ({ id, company: '甲野架空商店', address: '架空県架空市1', managementNo: 'MF912345', purpose, status: 'pending', ...extra });

test('作業の種類の表記ゆれをまとめる', () => {
    assert.equal(M.jobOf({ purpose: '修理依頼' }), '修理');
    assert.equal(M.jobOf({ purpose: 'フィルター交換' }), 'メンテナンス');
    assert.equal(M.jobOf({ purpose: '本体設置' }), '本体設置');
    assert.equal(M.jobOf({ purpose: '' }), '');
});
test('同じMF・同じ作業でまだ終わっていなければ登録しない', () => {
    const idx = M.index([{ ws: '2026-11', customers: [c('a', '修理')] }]);
    assert.equal(M.decide(c('n', '修理'), '2026-12', idx).action, 'skip');
});
test('同じMFでも作業が違えば、同じ本体の別の依頼として登録する', () => {
    const idx = M.index([{ ws: '2026-11', customers: [c('a', 'メンテナンス')] }]);
    const d = M.decide(c('n', '修理'), '2026-11', idx);
    assert.equal(d.action, 'add'); assert.equal(d.sameUnit, true);
});
test('前回の同じ作業が完了していれば、別の月の新しい依頼は登録する。同じ月は取り込み直しとみなして登録しない', () => {
    const idx = M.index([{ ws: '2026-10', customers: [c('a', '修理', { status: 'completed' })] }]);
    assert.equal(M.decide(c('n', '修理'), '2026-11', idx).action, 'add');
    assert.equal(M.decide(c('n', '修理'), '2026-10', idx).action, 'skip');
});
test('同じ取り込みの中で同じ依頼が2回あれば1件だけ', () => {
    const idx = M.index([]);
    assert.equal(M.decide(c('x', '修理'), '2026-11', idx).action, 'add'); M.remember(idx, c('x', '修理'), '2026-11');
    assert.equal(M.decide(c('y', '修理'), '2026-11', idx).action, 'skip');
    assert.equal(M.decide(c('z', '本体設置'), '2026-11', idx).action, 'add');
});
test('一度だけの掃除は、同じ本体の別の作業(修理)や完了後の新しい依頼を消さない', () => {
    const p = M.plan([{ ws: '2026-11', customers: [
        c('m', 'メンテナンス', { appoDate: '2026-11-04T10:00' }), c('r', '修理'),
        c('done', '本体設置', { status: 'completed', appoDate: '2026-10-01T10:00' }), c('again', '本体設置')
    ] }]);
    assert.deepEqual(p.remove, []);
    const q = M.plan([{ ws: '2026-11', customers: [c('r1', '修理'), c('r2', '修理')] }]);
    assert.equal(q.remove.length, 1);
});
