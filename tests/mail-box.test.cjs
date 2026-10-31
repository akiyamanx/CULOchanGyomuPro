// メールBOX(取り込み→仕分け→自動登録/判別不可/通達→反映・取り消し)のテスト。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const BackupFormat = require('../shared/backup-format');
const Classifier = require('../map/request-classifier');
const Reader = require('../map/request-reader');

const KEY_BOX = 'gyomupro_mailbox', KEY_LEDGER = 'gyomupro_mail_ledger';
const NOW = '2026-10-28T12:00:00+09:00';

function setup(initial = {}, nowIso = NOW) {
    const store = new Map(Object.entries(initial));
    const hooks = { failKey: null, failOnce: new Set(), failNth: null };
    const storage = {
        getItem: k => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => {
            if (hooks.failKey === k) throw new Error('quota:' + k);
            if (hooks.failOnce.has(k)) { hooks.failOnce.delete(k); throw new Error('quota-once:' + k); }
            store.set(k, String(v));
        },
        removeItem: k => { store.delete(k); }
    };
    const logs = [];
    const context = vm.createContext({ console: { error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')) }, alert() {}, AppStorage: storage, localStorage: storage, crypto: require('node:crypto').webcrypto });
    for (const f of ['../map/map-data-storage.js', '../map/request-month.js', '../map/request-parser.js', '../map/request-classifier.js', '../map/mf-dedupe.js', '../map/mail-box.js']) {
        vm.runInContext(fs.readFileSync(require.resolve(f), 'utf8'), context);
    }
    context.__nowMs = Date.parse(nowIso);
    const run = code => vm.runInContext(code, context);
    const json = code => JSON.parse(JSON.stringify(run(code)));
    run('globalThis.__mb = MailBox.create({ now: () => new Date(__nowMs) })');
    const mb = {
        ingest: mails => { context.__in = JSON.stringify(mails); return JSON.parse(JSON.stringify(run('__mb.ingest(JSON.parse(__in))'))); },
        call: (name, ...args) => { context.__args = JSON.stringify(args); return JSON.parse(JSON.stringify(run(`__mb.${name}(...JSON.parse(__args))`) ?? null)); },
        rows: () => json('__mb.rows()'),
        row: key => json('__mb.rows()').find(r => r.mailKey === key || r.id === key),
        setNow: iso => { context.__nowMs = Date.parse(iso); }
    };
    return { store, hooks, logs, run, json, mb, context };
}

const full = (extra = {}) => ({ company: '架空商事', address: '東京都架空区1-2-3', purpose: '修理', equipType: '', unitCount: 1, workDateText: '', titleText: '', appoDate: '', source: 'a.xls · 一覧', kind: '一覧表', warnings: [], ...extra });
const partial = (extra = {}) => full({ address: '', purpose: '', warnings: ['PDFの読取結果です。原本と照合してください。'], ...extra });
const att = (id, fileName, kind, items, extra = {}) => ({ attachmentId: id, fileName, kind, parse: { opened: true, items, headingText: '', ocr: false, ...extra } });
const mail = (id, attachments, extra = {}) => ({ messageId: id, subject: '業務依頼のお願い', receivedDate: '2026-10-27', senderKind: 'registered', source: 'mock', attachments, ...extra });
const customersOf = (store, ws) => JSON.parse(store.get('mm_customers_' + ws) || '[]');
const allCustomers = store => [...store.keys()].filter(k => k.startsWith('mm_customers_')).flatMap(k => JSON.parse(store.get(k)));
const legacy = () => ({
    mm_workspaces: JSON.stringify([{ id: '2026-09', name: '2026年9月', createdAt: 'x' }, { id: '2026-10', name: '2026年10月', createdAt: 'x' }]),
    mm_workspace_current: '2026-10',
    'mm_customers_2026-10': JSON.stringify([{ id: 'a', company: '既存会社', address: '東京都既存区1', purpose: '修理', status: 'appointed', appoDate: '2026-10-15T15:00', routeId: 'route_2' }]),
    'mm_customers_2026-09': JSON.stringify([{ id: 'z', company: '旧会社', address: '東京都旧区9', purpose: 'メンテナンス', status: 'pending', appoDate: '', routeId: null }])
});

// --- 保存キー・バックアップ許可リスト ---
test('BOXと台帳のキーはバックアップ許可リストに入らない(顧客名・件名がDriveに出ない)', () => {
    assert.equal(BackupFormat.allowedKey(KEY_BOX), false);
    assert.equal(BackupFormat.allowedKey(KEY_LEDGER), false);
    assert.equal(BackupFormat.allowedKey('gyomupro_mailbox_x'), false);
});
test('mailKey・移動由来の項目を持つ訪問先を含むバックアップは検証を通る(後方互換)', () => {
    const payload = { local: { 'mm_customers_2026-10': JSON.stringify([full({ id: 'c_1', mailKey: 'm1/a1/0', status: 'pending', routeId: null })]) }, parking: [], drafts: [], etc: { records: [], days: {}, selectedDate: '' } };
    assert.doesNotThrow(() => BackupFormat.validate(payload));
});

// --- 自動登録(依頼書) ---
test('作業日なしの揃った依頼書は日程未定へ自動登録され、結果の行が依頼書BOXに出る', () => {
    const { mb, store } = setup(legacy());
    const r = mb.ingest([mail('m1', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])])]);
    assert.equal(r.ok, true); assert.equal(r.registered, 1);
    const list = customersOf(store, 'unscheduled');
    assert.equal(list.length, 1); assert.equal(list[0].company, '架空商事'); assert.equal(list[0].mailKey, 'm1/a1/0');
    assert.equal(list[0].status, 'pending'); assert.equal(list[0].routeId, null);
    assert.ok(JSON.parse(store.get('mm_workspaces')).some(w => w.id === 'unscheduled'));
    const row = mb.row('m1/a1');
    assert.equal(row.bucket, 'request'); assert.equal(row.state, 'registered');
    assert.deepEqual(row.result.workspaces, { unscheduled: 1 });
    assert.equal(mb.call('counts').unreadable, 0);
});
test('作業日が来月なら翌月のワークスペースを(無ければ作って)入れる。現在の月は変えない', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('m2', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ workDateText: '2026年11月5日', appoDate: '2026-11-05T10:00' })])])]);
    assert.equal(customersOf(store, '2026-11').length, 1);
    assert.ok(JSON.parse(store.get('mm_workspaces')).some(w => w.id === '2026-11'));
    assert.equal(store.get('mm_workspace_current'), '2026-10');
    assert.deepEqual(mb.row('m2/a1').result.workspaces, { '2026-11': 1 });
});
test('1つのファイルに月違いの行が混ざれば、行ごとにその月へ振り分ける', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('m3', [att('a1', '業務依頼一覧.xlsx', 'xlsx', [
        full({ company: '架空A', workDateText: '2026-10-30' }), full({ company: '架空B', workDateText: '2026-11-02' }), full({ company: '架空C' })])])]);
    assert.equal(customersOf(store, '2026-10').length, 2); // 既存1 + 追加1
    assert.equal(customersOf(store, '2026-11').length, 1);
    assert.equal(customersOf(store, 'unscheduled').length, 1);
});
test('同じメールを2回取り込んでも二重登録しない(台帳)', () => {
    const { mb, store } = setup(legacy());
    const m = mail('m4', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])]);
    mb.ingest([m]);
    const r2 = mb.ingest([m]);
    assert.equal(r2.skipped, 1); assert.equal(r2.registered, 0);
    assert.equal(allCustomers(store).filter(c => c.mailKey && c.mailKey.startsWith('m4/')).length, 1);
    assert.equal(mb.rows().length, 1);
});
test('台帳もBOXも失われた端末でも、訪問先のmailKeyで二重登録を防ぐ', () => {
    const { mb, store } = setup(legacy());
    const m = mail('m5', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])]);
    mb.ingest([m]);
    store.delete(KEY_BOX); store.delete(KEY_LEDGER);
    const r = mb.ingest([m]);
    assert.equal(r.skipped, 1);
    assert.equal(allCustomers(store).filter(c => c.mailKey && c.mailKey.startsWith('m5/')).length, 1);
});
test('古いバックアップの取込で訪問先が消えても、処理済みのメールは勝手に再登録しない(結果の行で知らせる)', () => {
    const { mb, store } = setup(legacy());
    const m = mail('m6', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])]);
    mb.ingest([m]);
    store.set('mm_customers_unscheduled', '[]'); // 復元などで消えた状態
    const r = mb.ingest([m]);
    assert.equal(r.registered, 0); assert.equal(customersOf(store, 'unscheduled').length, 0);
    const st = mb.call('registeredStatus', 'm6/a1');
    assert.equal(st.present, 0); assert.equal(st.total, 1);
});
test('別メール由来でも会社・住所・作業が同じ訪問先は登録せず、重複として結果に残す', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('m7', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])])]);
    const r = mb.ingest([mail('m8', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])])]);
    assert.equal(r.registered, 0); assert.equal(r.duplicates, 1);
    assert.equal(customersOf(store, 'unscheduled').length, 1);
    assert.equal(mb.row('m8/a1').result.duplicates, 1);
});
test('既存の訪問先(アポ済み・ルート割当)は一切変わらない', () => {
    const { mb, store } = setup(legacy());
    const before = store.get('mm_customers_2026-10');
    mb.ingest([mail('m9', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ workDateText: '2026-11-03' })])])]);
    assert.equal(store.get('mm_customers_2026-10'), before);
    assert.equal(store.get('mm_customers_2026-09'), legacy()['mm_customers_2026-09']);
});

// --- 判別不可 / 通達 ---
test('欠けのある依頼書(画像PDF)は登録せず判別不可BOXへ。読めた項目は保持し、通知対象になる', () => {
    const { mb, store } = setup(legacy());
    const r = mb.ingest([mail('n1', [att('a1', '業務依頼書_修理.pdf', 'pdf', [partial()], { ocr: true })])]);
    assert.equal(r.registered, 0); assert.equal(r.unreadable, 1);
    assert.equal(store.has('mm_customers_unscheduled'), false);
    const row = mb.row('n1/a1');
    assert.equal(row.bucket, 'unreadable'); assert.equal(row.state, 'new'); assert.equal(row.needsAttention, true);
    assert.equal(row.applicable, true); assert.equal(row.items.length, 1);
    assert.equal(mb.call('counts').unreadable, 1);
});
test('一部だけ揃うファイル: 揃った項目は自動登録し、欠けた項目は判別不可BOXへ', () => {
    const { mb, store } = setup(legacy());
    const r = mb.ingest([mail('n2', [att('a1', '業務依頼一覧.xlsx', 'xlsx', [full({ company: '架空D' }), partial({ company: '架空E' })])])]);
    assert.equal(r.registered, 1); assert.equal(r.unreadable, 1);
    assert.equal(customersOf(store, 'unscheduled').length, 1);
    assert.equal(mb.row('n2/a1').bucket, 'request');
    const p = mb.row('n2/a1#partial');
    assert.equal(p.bucket, 'unreadable'); assert.equal(p.items.length, 1); assert.equal(p.applicable, true);
});
test('開けない・解析が例外になったファイルは判別不可(反映不可)に倒し、例外を外へ出さない', () => {
    const { mb, store, logs } = setup(legacy());
    const r = mb.ingest([mail('n3', [{ attachmentId: 'a1', fileName: '依頼書.xls', kind: 'xls', parseError: 'parse_failed' }, { attachmentId: 'a2', fileName: 'x.dat', kind: 'other', parse: { opened: false, items: [] } }])]);
    assert.equal(r.ok, true); assert.equal(r.unreadable, 2);
    for (const k of ['n3/a1', 'n3/a2']) { const row = mb.row(k); assert.equal(row.bucket, 'unreadable'); assert.equal(row.applicable, false); assert.equal(row.needsAttention, true); }
    assert.equal(allCustomers(store).length, 2);
});
test('配置図・精算書などは通達BOX。本文だけの連絡メールも通達、件名が業務依頼で添付なしは判別不可', () => {
    const { mb } = setup(legacy());
    mb.ingest([
        mail('r1', [att('a1', '配置図.pdf', 'pdf', [], { ocr: true })], { subject: 'お知らせ' }),
        mail('r2', [], { subject: '本日の報告です' }),
        mail('r3', [], { subject: '業務依頼です。添付なし' })
    ]);
    assert.equal(mb.row('r1/a1').bucket, 'reference');
    assert.equal(mb.row('r2/body').bucket, 'reference');
    assert.equal(mb.row('r3/body').bucket, 'unreadable');
    assert.equal(mb.row('r1/a1').items, undefined);
    assert.equal(mb.call('counts').unreadable, 1);
});
test('作業日が複数月にまたがる項目は自動で決めず、判別不可BOXへ(月は本人が選ぶ)', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('n4', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ workDateText: '10月30日・11月2日' })])])]);
    const row = mb.row('n4/a1#partial') || mb.row('n4/a1');
    assert.equal(allCustomers(store).filter(c => c.mailKey).length, 0);
    assert.equal(mb.rows().filter(r => r.bucket === 'unreadable').length, 1);
    assert.match(mb.rows().find(r => r.bucket === 'unreadable').reason, /月/);
    assert.ok(row);
});
test('1通の処理で例外が出ても、他のメールは処理され、そのメールは判別不可に残る', () => {
    const { mb } = setup(legacy());
    const bad = { messageId: 'x1', subject: 's', attachments: 'broken' };
    const r = mb.ingest([bad, mail('x2', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])])]);
    assert.equal(r.ok, true); assert.equal(r.registered, 1);
    assert.equal(mb.rows().filter(r => r.bucket === 'unreadable').length, 1);
    assert.ok(r.errors.length >= 1);
});
test('保存に失敗したら登録済みにしない(次回やり直せる)。訪問先は半端に残らない', () => {
    const { mb, store, hooks } = setup(legacy());
    hooks.failKey = 'mm_customers_unscheduled';
    const m = mail('f1', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])]);
    const r = mb.ingest([m]);
    assert.equal(r.registered, 0);
    const row = mb.row('f1/a1');
    assert.equal(row.bucket, 'unreadable'); assert.equal(row.applicable, true);
    hooks.failKey = null;
    const ok = mb.call('applyRows', [{ rowId: row.id, workspaceId: 'unscheduled' }]);
    assert.equal(ok.applied, 1);
    assert.equal(customersOf(store, 'unscheduled').length, 1);
});
test('台帳の保存だけ失敗しても、訪問先のmailKeyで二重登録しない', () => {
    const { mb, store, hooks } = setup(legacy());
    hooks.failOnce.add(KEY_LEDGER);
    const m = mail('f2', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])]);
    const r1 = mb.ingest([m]);
    assert.equal(r1.registered, 1);
    const r2 = mb.ingest([m]);
    assert.equal(r2.registered, 0);
    assert.equal(allCustomers(store).filter(c => c.mailKey && c.mailKey.startsWith('f2/')).length, 1);
});
test('壊れたBOXデータは上書きせず、取り込みを止めて知らせる', () => {
    const { mb, store } = setup({ ...legacy(), [KEY_BOX]: '{broken' });
    const r = mb.ingest([mail('c1', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])])]);
    assert.equal(r.ok, false); assert.equal(r.code, 'mailbox_corrupt');
    assert.equal(store.get(KEY_BOX), '{broken');
    assert.equal(allCustomers(store).filter(c => c.mailKey).length, 0);
});
test('旧データ(BOX・台帳キー無し)はそのまま開け、無関係なキーは変わらない', () => {
    const { mb, store } = setup({ ...legacy(), mm_settings: '{"homeAddress":""}', mm_geocache: '{}' });
    const snap = new Map(store);
    assert.deepEqual(mb.rows(), []);
    assert.deepEqual(mb.call('counts'), { unreadable: 0, request: 0, reference: 0, total: 0, favorite: 0 });
    assert.equal(store.size, snap.size);
    mb.ingest([mail('l1', [att('a1', '配置図.pdf', 'pdf', [])])]);
    for (const [k, v] of snap) assert.equal(store.get(k), v, k);
});

// --- 反映(判別不可 → 月/日程未定) ---
function unreadableRow(extraItems) {
    const s = setup(legacy());
    s.mb.ingest([mail('u1', [att('a1', '業務依頼書.pdf', 'pdf', extraItems || [partial({ company: '架空F', address: '東京都架空区9' })], { ocr: true })])]);
    return { ...s, row: s.mb.row('u1/a1') };
}
test('反映: 既存の月へ。要確認つきで追加され、行は反映済みになり、台帳も更新される', () => {
    const { mb, store, row } = unreadableRow();
    const r = mb.call('applyRows', [{ rowId: row.id, workspaceId: '2026-09' }]);
    assert.equal(r.applied, 1);
    const added = customersOf(store, '2026-09').find(c => c.mailKey === 'u1/a1/0');
    assert.ok(added); assert.equal(added.company, '架空F'); assert.equal(added.mailNeedsReview, true);
    assert.match(added.note, /要確認/);
    assert.equal(mb.row('u1/a1').state, 'applied');
    assert.equal(mb.call('counts').unreadable, 0);
    const again = mb.call('applyRows', [{ rowId: row.id, workspaceId: '2026-09' }]);
    assert.equal(again.applied, 0);
    assert.equal(customersOf(store, '2026-09').filter(c => c.mailKey === 'u1/a1/0').length, 1);
});
test('反映: 日程未定へ(作業日は空にする)', () => {
    const { mb, store, row } = unreadableRow([partial({ company: '架空G', address: '東京都架空区8', appoDate: '2026-11-04T10:00', workDateText: '2026-11-04' })]);
    const r = mb.call('applyRows', [{ rowId: row.id, workspaceId: 'unscheduled' }]);
    assert.equal(r.applied, 1);
    assert.equal(customersOf(store, 'unscheduled')[0].appoDate, '');
});
test('反映: まだ無い月(例: 11月)は、作成を許可したときだけ新規作成して入れる', () => {
    const { mb, store, row } = unreadableRow();
    const denied = mb.call('applyRows', [{ rowId: row.id, workspaceId: '2026-11' }]);
    assert.equal(denied.applied, 0); assert.equal(denied.results[0].code, 'month_missing');
    assert.equal(store.has('mm_customers_2026-11'), false);
    assert.equal(JSON.parse(store.get('mm_workspaces')).some(w => w.id === '2026-11'), false);
    assert.equal(mb.row('u1/a1').state, 'new');
    const ok = mb.call('applyRows', [{ rowId: row.id, workspaceId: '2026-11' }], { allowCreateMonth: true });
    assert.equal(ok.applied, 1);
    assert.equal(customersOf(store, '2026-11').length, 1);
    assert.equal(store.get('mm_workspace_current'), '2026-10');
});
test('反映: 不正な月ID・反映できない行・通達の行は何も書かない', () => {
    const { mb, store, row } = unreadableRow();
    const snap = new Map(store);
    for (const ws of ['2026-13', 'abc', '', null]) assert.equal(mb.call('applyRows', [{ rowId: row.id, workspaceId: ws }], { allowCreateMonth: true }).applied, 0, String(ws));
    mb.ingest([mail('u2', [{ attachmentId: 'a1', fileName: 'x.xls', kind: 'xls', parseError: 'parse_failed' }, att('a2', '配置図.pdf', 'pdf', [])])]);
    const keys = ['u2/a1', 'u2/a2'].map(k => mb.row(k).id);
    for (const id of keys) assert.equal(mb.call('applyRows', [{ rowId: id, workspaceId: 'unscheduled' }]).applied, 0);
    assert.equal(store.has('mm_customers_unscheduled'), false);
    for (const [k, v] of snap) if (k.startsWith('mm_customers')) assert.equal(store.get(k), v);
});
test('まとめて反映: 行ごとに別の月へ。失敗した行だけ未処理のまま残る', () => {
    const s = setup(legacy());
    s.mb.ingest([
        mail('b1', [att('a1', '業務依頼書.pdf', 'pdf', [partial({ company: '架空H' })], { ocr: true })]),
        mail('b2', [att('a1', '業務依頼書.pdf', 'pdf', [partial({ company: '架空I' })], { ocr: true })]),
        mail('b3', [att('a1', 'x.xls', 'xls', [], { opened: false })])
    ]);
    const ids = ['b1/a1', 'b2/a1', 'b3/a1'].map(k => s.mb.row(k).id);
    const r = s.mb.call('applyRows', [{ rowId: ids[0], workspaceId: '2026-10' }, { rowId: ids[1], workspaceId: 'unscheduled' }, { rowId: ids[2], workspaceId: 'unscheduled' }]);
    assert.equal(r.applied, 2); assert.equal(r.failed, 1);
    assert.equal(s.mb.row('b3/a1').state, 'new');
    assert.equal(s.mb.call('counts').unreadable, 1);
});
test('反映の保存に失敗したら行は未処理のまま・訪問先は増えない', () => {
    const { mb, store, row, hooks } = unreadableRow();
    hooks.failKey = 'mm_customers_2026-09';
    const r = mb.call('applyRows', [{ rowId: row.id, workspaceId: '2026-09' }]);
    assert.equal(r.applied, 0); assert.equal(r.results[0].code, 'write_failed');
    assert.equal(mb.row('u1/a1').state, 'new');
    assert.equal(customersOf(store, '2026-09').length, 1);
});

// --- 取り消し(保守的) ---
function registered() {
    const s = setup(legacy());
    s.mb.ingest([mail('k1', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ company: '架空J' })])])]);
    return s;
}
test('取り消し: 登録直後で未編集なら訪問先を削除でき、同じメールは再登録されない', () => {
    const { mb, store } = registered();
    assert.equal(mb.call('registeredStatus', 'k1/a1').cancellable, true);
    const r = mb.call('cancelRegistration', 'k1/a1');
    assert.equal(r.ok, true); assert.equal(r.removed, 1);
    assert.equal(customersOf(store, 'unscheduled').length, 0);
    assert.equal(mb.row('k1/a1').state, 'cancelled');
    const again = mb.ingest([mail('k1', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ company: '架空J' })])])]);
    assert.equal(again.registered, 0); assert.equal(again.skipped, 1);
    assert.equal(customersOf(store, 'unscheduled').length, 0);
});
test('取り消し: 24時間を過ぎたら取り消せない', () => {
    const { mb, store } = registered();
    mb.setNow('2026-10-29T12:00:01+09:00');
    assert.equal(mb.call('registeredStatus', 'k1/a1').cancellable, false);
    const r = mb.call('cancelRegistration', 'k1/a1');
    assert.equal(r.ok, false); assert.equal(r.code, 'too_late');
    assert.equal(customersOf(store, 'unscheduled').length, 1);
});
test('取り消し: 状態が変わった(アポ済み・ルート割当・内容編集)訪問先が1件でもあれば、何も消さない', () => {
    for (const change of [{ status: 'appointed' }, { routeId: 'route_1' }, { company: '架空J改' }, { appoDate: '2026-11-01T10:00' }]) {
        const { mb, store } = registered();
        const list = customersOf(store, 'unscheduled');
        store.set('mm_customers_unscheduled', JSON.stringify([{ ...list[0], ...change }]));
        const r = mb.call('cancelRegistration', 'k1/a1');
        assert.equal(r.ok, false, JSON.stringify(change)); assert.equal(r.code, 'changed');
        assert.equal(customersOf(store, 'unscheduled').length, 1);
        assert.equal(mb.row('k1/a1').state, 'registered');
    }
});
test('取り消し: 判別不可・通達の行や、存在しない行は取り消せない', () => {
    const { mb } = unreadableRow();
    assert.equal(mb.call('cancelRegistration', 'u1/a1').ok, false);
    assert.equal(mb.call('cancelRegistration', 'nothing').ok, false);
});

// --- 行の操作・整理 ---
test('閉じる / 通達から「依頼書として見直す」', () => {
    const { mb } = setup(legacy());
    mb.ingest([mail('d1', [att('a1', '配置図.pdf', 'pdf', [])]), mail('d2', [att('a1', 'x.xls', 'xls', [], { opened: false })])]);
    assert.equal(mb.call('dismissRow', mb.row('d2/a1').id).ok, true);
    assert.equal(mb.row('d2/a1').state, 'dismissed');
    assert.equal(mb.call('counts').unreadable, 0);
    assert.equal(mb.call('reclassify', mb.row('d1/a1').id).ok, true);
    const row = mb.row('d1/a1');
    assert.equal(row.bucket, 'unreadable'); assert.equal(row.state, 'new'); assert.equal(row.applicable, false);
    assert.equal(mb.call('counts').unreadable, 1);
});
test('古い行(90日超)と、300行を超える分は整理される。未確認の判別不可は残す', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('p1', [att('a1', '配置図.pdf', 'pdf', [])]), mail('p2', [att('a1', 'x.xls', 'xls', [], { opened: false })])]);
    mb.setNow('2027-02-10T12:00:00+09:00');
    mb.ingest([mail('p3', [att('a1', '配置図.pdf', 'pdf', [])])]);
    const keys = mb.rows().map(r => r.mailKey);
    assert.equal(keys.includes('p1/a1'), false); // 古い通達は消える
    assert.equal(keys.includes('p2/a1'), true);  // 未確認の判別不可は残る
    assert.equal(keys.includes('p3/a1'), true);
    assert.equal(Boolean(JSON.parse(store.get(KEY_LEDGER)).entries['p1/a1']), true); // 台帳は180日残す
    mb.setNow('2027-05-10T12:00:00+09:00');
    mb.ingest([mail('p4', [att('a1', '配置図.pdf', 'pdf', [])])]);
    const ledger = JSON.parse(store.get(KEY_LEDGER));
    assert.equal(Boolean(ledger.entries['p1/a1']), false);
    assert.equal(Boolean(ledger.entries['p2/a1']), true); // 行が残っているものは台帳も残す
});
test('月の選択肢(既存の月+日程未定)と、新しい月の候補(翌月)', () => {
    const { mb } = setup(legacy());
    mb.call('ensureUnscheduled');
    const opts = mb.call('monthOptions');
    assert.deepEqual(opts.map(o => o.id), ['2026-10', '2026-09', 'unscheduled']);
    assert.equal(mb.call('suggestNewMonth'), '2026-11');
    assert.equal(mb.call('nextMonth', '2026-12'), '2027-01');
});

// --- 個人情報をログに出さない ---
test('動作記録・コンソールに、会社名・住所・件名・ファイル名を出さない', () => {
    const { mb, store, logs } = setup(legacy());
    mb.ingest([
        mail('s1', [att('a1', '秘密の依頼書ファイル.pdf', 'pdf', [partial({ company: '秘密商事', address: '秘密県秘密市1' })], { ocr: true })], { subject: '秘密の件名' }),
        mail('s2', [{ attachmentId: 'a1', fileName: '秘密のファイル.xls', kind: 'xls', parseError: 'parse_failed' }]),
        { messageId: 's3', subject: '秘密の件名3', attachments: 'broken' }
    ]);
    const log = mb.call('log');
    assert.ok(log.length >= 1);
    const text = JSON.stringify(log) + logs.join('\n');
    for (const secret of ['秘密', '架空', 's1/a1']) assert.equal(text.includes(secret), false, secret);
    const box = JSON.parse(store.get(KEY_BOX));
    assert.equal(JSON.stringify(box.log).includes('秘密'), false);
    const ledgerText = store.get(KEY_LEDGER);
    for (const secret of ['秘密', '架空']) assert.equal(ledgerText.includes(secret), false, 'ledger:' + secret);
});
test('処理済み台帳には ID・結果・時刻だけが入る', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('g1', [att('a1', '業務依頼書.xlsx', 'xlsx', [full()])], { subject: '件名テスト' })]);
    const ledger = JSON.parse(store.get(KEY_LEDGER));
    assert.deepEqual(Object.keys(ledger.entries['g1/a1']).sort(), ['at', 'r']);
    assert.equal(ledger.entries['g1/a1'].r, 'registered');
    assert.equal(store.get(KEY_LEDGER).includes('架空商事'), false);
});

// --- 取り込み用の読取(ファイル種別) ---
test('ファイル名から種別を決める。対応外はother', () => {
    assert.equal(Reader.kindOf('a.PDF'), 'pdf'); assert.equal(Reader.kindOf('a.xls'), 'xls'); assert.equal(Reader.kindOf('a.xlsx'), 'xlsx');
    assert.equal(Reader.kindOf('a.csv'), 'csv'); assert.equal(Reader.kindOf('a.jpg'), 'image'); assert.equal(Reader.kindOf('a.JPEG'), 'image');
    assert.equal(Reader.kindOf('winmail.dat'), 'other'); assert.equal(Reader.kindOf('noext'), 'other');
});
test('readForMail は開けないとき例外を投げず opened:false を返す(実装コードのみ。個人情報は返さない)', async () => {
    const big = { name: 'a.pdf', size: 21 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) };
    const r1 = await Reader.readForMail(big, () => {}, new AbortController().signal);
    assert.equal(r1.opened, false); assert.match(r1.errorCode, /^[a-z_]+$/);
    const r2 = await Reader.readForMail({ name: 'winmail.dat', size: 10 }, () => {}, new AbortController().signal);
    assert.equal(r2.opened, false); assert.equal(r2.kind, 'other');
    const r3 = await Reader.readForMail({ name: 'photo.jpg', size: 10 }, () => {}, new AbortController().signal);
    assert.equal(r3.opened, true); assert.equal(r3.kind, 'image'); assert.deepEqual(r3.items, []);
});

// --- 本体番号(MF)で二重登録しない ---
test('同じMF番号は、別のメール・住所の書き方違い(階数あり/なし)・別の月でも二重に登録しない', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('f1', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ managementNo: 'MF900001', workDateText: '2026-10-29', appoDate: '2026-10-29T10:00' })])])]);
    const r = mb.ingest([mail('f2', [att('a1', '業務依頼書.pdf', 'pdf', [full({ managementNo: 'MF900001', address: '東京都架空区1-2-3 3F', purpose: '点検', workDateText: '2026-11-04', appoDate: '2026-11-04T10:00' })])])]);
    assert.equal(r.registered, 0); assert.equal(r.duplicates, 1);
    assert.equal(allCustomers(store).filter(c => c.managementNo === 'MF900001').length, 1);
});
test('同じ会社・同じ住所でもMF番号が違えば別の機械として両方登録する', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('f3', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ managementNo: 'MF900002', workDateText: '2026-10-29' }), full({ managementNo: 'MF900003', workDateText: '2026-10-29' })])])]);
    assert.equal(allCustomers(store).filter(c => /^MF90000[23]$/.test(c.managementNo)).length, 2);
});
test('日程未定にある機械に作業日つきの依頼が来たら、その月へ移す。利用者のメモ・電話は残る', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('f4', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ managementNo: 'MF900004' })])])]);
    const u = customersOf(store, 'unscheduled'); assert.equal(u.length, 1);
    u[0].note = '利用者メモ'; u[0].phone = '03-0000-0000'; store.set('mm_customers_unscheduled', JSON.stringify(u));
    const r = mb.ingest([mail('f5', [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ managementNo: 'MF900004', phone: '03-9999-9999', workDateText: '2026年11月5日', appoDate: '2026-11-05T10:00' })])])]);
    assert.equal(r.registered, 0);
    assert.equal(customersOf(store, 'unscheduled').length, 0);
    const m = customersOf(store, '2026-11'); assert.equal(m.length, 1);
    assert.equal(m[0].id, u[0].id); assert.equal(m[0].appoDate, '2026-11-05T10:00'); assert.equal(m[0].note, '利用者メモ'); assert.equal(m[0].phone, '03-0000-0000');
});

// --- ⭐お気に入り ---
test('お気に入り: どのBOXの行でも付け外しでき、一覧と件数に出る(確認済みにしても残る)', () => {
    const { mb } = setup(legacy());
    mb.ingest([mail('s1', [att('a1', '配置図.pdf', 'pdf', [])], { subject: 'お知らせ' }), mail('s2', [att('a1', 'x.xls', 'xls', [], { opened: false })])]);
    const ref = mb.row('s1/a1'), un = mb.row('s2/a1');
    assert.equal(mb.call('setStar', ref.id, true).ok, true);
    assert.equal(mb.call('setStar', un.id, true).ok, true);
    assert.equal(mb.call('counts').favorite, 2);
    assert.deepEqual(mb.call('favorites').map(r => r.bucket).sort(), ['reference', 'unreadable']);
    mb.call('dismissRow', un.id);
    assert.equal(mb.call('favorites').length, 2);           // 確認済みでもお気に入りからは消えない
    assert.equal(mb.call('setStar', ref.id, false).ok, true);
    assert.deepEqual(mb.call('favorites').map(r => r.mailKey), ['s2/a1']);
    assert.equal(mb.row('s1/a1').starred, undefined);
    assert.equal(mb.call('setStar', 'nope', true).ok, false);
});
test('お気に入り: 90日超・件数超えの整理でも消えない', () => {
    const { mb } = setup(legacy());
    mb.ingest([mail('k1', [att('a1', '配置図.pdf', 'pdf', [])]), mail('k2', [att('a1', '配置図.pdf', 'pdf', [])])]);
    mb.call('setStar', mb.row('k1/a1').id, true);
    mb.setNow('2027-06-10T12:00:00+09:00');
    mb.ingest([mail('k3', [att('a1', '配置図.pdf', 'pdf', [])])]);
    const keys = mb.rows().map(r => r.mailKey);
    assert.equal(keys.includes('k1/a1'), true);
    assert.equal(keys.includes('k2/a1'), false);
});
test('お気に入り: 読み直し(再取り込み)で行が作り直されても星は残る', () => {
    const { mb } = setup(legacy());
    mb.ingest([mail('t1', [{ ...att('a1', 'x.xls', 'xls', [], { opened: false }), parseError: 'read_failed' }])]);
    mb.call('setStar', mb.row('t1/a1').id, true);
    mb.ingest([mail('t1', [{ ...att('a1', 'x.xls', 'xls', [], { opened: false }), parseError: 'read_failed' }])]);
    assert.equal(mb.row('t1/a1').tries, 2);
    assert.equal(mb.row('t1/a1').starred, true);
});
test('差出人は表示名だけ保存し、メールアドレスは残さない', () => {
    const { mb, store } = setup(legacy());
    mb.ingest([mail('f1', [att('a1', '配置図.pdf', 'pdf', [])], { from: '"架空 甲野" <koono@example.invalid>' }), mail('f2', [att('a1', '配置図.pdf', 'pdf', [])], { from: 'otsukawa@example.invalid' })]);
    assert.equal(mb.row('f1/a1').from, '架空 甲野');
    assert.equal(mb.row('f2/a1').from, undefined);
    assert.equal(store.get(KEY_BOX).includes('example.invalid'), false);
});
