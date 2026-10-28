// 端末間の処理済み台帳(メールBOX)のテスト。2台のシミュレーション+通信アダプタのモック。データはすべて架空。
// Google・Gmailには一切接続しない(Drive側は差し替え可能なアダプタのモックだけを使う)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const BackupFormat = require('../shared/backup-format');

const KEY_BOX = 'gyomupro_mailbox', KEY_LEDGER = 'gyomupro_mail_ledger', KEY_SYNC = 'gyomupro_mail_sync';
const T0 = '2026-10-28T12:00:00+09:00';
const DAY = 24 * 3600 * 1000;
const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001', ID_B = 'bbbbbbbb-0000-4000-8000-000000000002', ID_C = 'cccccccc-0000-4000-8000-000000000003';
const SECRET_WORDS = ['架空商事', '東京都架空区', '業務依頼のお願い', '業務依頼書.xlsx', '配置図.pdf', '架空太郎'];

// ---------- 架空のDrive(アダプタの向こう側) ----------
function makeDrive() {
    const files = new Map(); let n = 0;
    return { files, nextId: () => 'file' + (++n) };
}
const coded = (code) => Object.assign(new Error('x'), { code });
function makeAdapter(drive, hooks = {}) {
    const calls = { list: 0, read: 0, write: 0 };
    return {
        calls, hooks,
        available: () => ({ connected: hooks.connected !== false }),
        async list() {
            calls.list++;
            if (hooks.hangList) return new Promise(() => {});
            if (hooks.listError) throw coded(hooks.listError);
            return [...drive.files.values()].map(f => ({ id: f.id, deviceId: f.deviceId, savedAt: f.savedAt, size: hooks.fakeSize != null ? hooks.fakeSize : Buffer.byteLength(f.text) }));
        },
        async read(file) {
            calls.read++;
            if (hooks.readError && (hooks.readError.all || hooks.readError.id === file.id)) throw coded(hooks.readError.code);
            return drive.files.get(file.id).text;
        },
        async write({ fileId, deviceId, text, savedAt }) {
            calls.write++;
            if (hooks.writeError) throw coded(hooks.writeError);
            if (hooks.writeDelay) await new Promise(r => setTimeout(r, hooks.writeDelay));
            const id = fileId && drive.files.has(fileId) ? fileId : drive.nextId();
            drive.files.set(id, { id, deviceId, savedAt, text });
            return { id };
        }
    };
}

// ---------- 端末(vm1つ=端末1台。保存領域も別) ----------
const full = (extra = {}) => ({ company: '架空商事', address: '東京都架空区1-2-3', purpose: '修理', equipType: '', unitCount: 1, workDateText: '', titleText: '', appoDate: '', source: 'a.xls · 一覧', kind: '一覧表', warnings: [], ...extra });
const partial = (extra = {}) => full({ address: '', purpose: '', warnings: ['PDFの読取結果です。'], ...extra });
const att = (id, fileName, kind, items, extra = {}) => ({ attachmentId: id, fileName, kind, parse: { opened: true, items, headingText: '', ocr: false, ...extra } });
const mail = (id, attachments, extra = {}) => ({ messageId: id, subject: '業務依頼のお願い', receivedDate: '2026-10-27', senderKind: 'registered', source: 'mock', attachments, ...extra });
const request = id => mail(id, [att('a1', '業務依頼書.xlsx', 'xlsx', [full({ company: '架空商事' + id })])]);
const imageOnly = id => mail(id, [att('a1', '業務依頼書.xlsx', 'xlsx', [partial({ company: '架空商事' + id })], {})]);
const legacy = () => ({
    mm_workspaces: JSON.stringify([{ id: '2026-10', name: '2026年10月', createdAt: 'x' }]),
    mm_workspace_current: '2026-10',
    'mm_customers_2026-10': JSON.stringify([{ id: 'a', company: '既存会社', address: '東京都既存区1', purpose: '修理', status: 'appointed', appoDate: '2026-10-15T15:00', routeId: 'route_2' }])
});

function device(deviceId, drive, hooks = {}, opts = {}) {
    const store = new Map(Object.entries(legacy()));
    const storage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
    const logs = [];
    const context = vm.createContext({ console: { error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), log: () => {} }, alert() {}, setTimeout, clearTimeout, AppStorage: storage, localStorage: storage, crypto: require('node:crypto').webcrypto });
    for (const f of ['../map/map-data-storage.js', '../map/request-month.js', '../map/request-parser.js', '../map/request-classifier.js', '../map/mail-box.js', '../map/mail-ledger-sync.js']) {
        vm.runInContext(fs.readFileSync(require.resolve(f), 'utf8'), context);
    }
    const adapter = makeAdapter(drive, hooks);
    context.__adapter = adapter; context.__nowMs = Date.parse(T0); context.__id = deviceId;
    context.__timeout = opts.timeoutMs || 5000;
    const run = code => vm.runInContext(code, context);
    const clone = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
    run('globalThis.__mb = MailBox.create({ now: () => new Date(__nowMs) })');
    run('globalThis.__sync = MailLedgerSync.create({ mailBox: __mb, adapter: __adapter, now: () => new Date(__nowMs), uuid: () => __id, timeoutMs: __timeout })');
    const d = {
        store, storage, logs, hooks, adapter, context, deviceId,
        setNow: iso => { context.__nowMs = Date.parse(iso); },
        ingestLocal: mails => { context.__in = JSON.stringify(mails); return clone(run('__mb.ingest(JSON.parse(__in))')); },
        ingestMails: async mails => { context.__in = JSON.stringify(mails); return clone(await run('__sync.ingestMails(JSON.parse(__in))')); },
        sync: async () => clone(await run('__sync.sync()')),
        syncRaw: () => run('__sync.sync()'),
        status: () => clone(run('__sync.status()')),
        mb: (name, ...args) => { context.__args = JSON.stringify(args); return clone(run(`__mb.${name}(...JSON.parse(__args))`)); },
        ledger: () => JSON.parse(store.get(KEY_LEDGER) || '{"entries":{}}').entries,
        customers: () => [...store.keys()].filter(k => k.startsWith('mm_customers_')).flatMap(k => JSON.parse(store.get(k))).filter(c => c.mailKey),
        eval: code => clone(run(code)),
        fresh: () => { run('globalThis.__sync = MailLedgerSync.create({ mailBox: __mb, adapter: __adapter, now: () => new Date(__nowMs), uuid: () => __id, timeoutMs: __timeout })'); }
    };
    return d;
}
const driveText = drive => JSON.stringify([...drive.files.values()]);
const countFor = (dev, base) => dev.customers().filter(c => c.mailKey.startsWith(base + '/')).length;

// ---------- 1. 基本: 端末Aが取り込む → 台帳を出す → 端末Bが取り込んでも増えない ----------
test('端末Aが取り込むと、自分専用の台帳ファイルがDriveに置かれる。中身はID・結果・時刻だけ(顧客名・件名・ファイル名なし)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    const r = await A.ingestMails([request('m1'), mail('m2', [att('a1', '配置図.pdf', 'pdf', [])], { subject: 'お知らせ' })]);
    assert.equal(r.ok, true); assert.equal(r.registered, 1); assert.equal(r.reference, 1);
    assert.equal(drive.files.size, 1);
    const f = [...drive.files.values()][0];
    assert.equal(f.deviceId, ID_A);
    const doc = JSON.parse(f.text);
    assert.equal(doc.app, 'CULOchanMailLedger1'); assert.equal(doc.v, 1); assert.equal(doc.deviceId, ID_A);
    assert.deepEqual(Object.keys(doc).sort(), ['app', 'deviceId', 'entries', 'savedAt', 'v']);
    assert.deepEqual(Object.keys(doc.entries).sort(), ['m1/a1', 'm2/a1']);
    for (const e of Object.values(doc.entries)) assert.deepEqual(Object.keys(e).sort(), ['at', 'r']);
    assert.equal(doc.entries['m1/a1'].r, 'registered'); assert.equal(doc.entries['m2/a1'].r, 'reference');
    for (const w of SECRET_WORDS) assert.equal(driveText(drive).includes(w), false, w);
    assert.equal(driveText(drive).includes('既存会社'), false);
});
test('端末Bが台帳を取り込んでから同じメールを取り込んでも、登録は増えない(二重登録なし)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    await A.ingestMails([request('m1')]);
    const r = await B.ingestMails([request('m1')]);
    assert.equal(r.ok, true); assert.equal(r.registered, 0); assert.equal(r.skipped, 1);
    assert.equal(countFor(B, 'm1'), 0); assert.equal(countFor(A, 'm1'), 1);
    assert.equal(B.ledger()['m1/a1'].x, 1);                                // 他の端末から知った印
    assert.equal(B.mb('rows').length, 0);                                  // Bには行を作らない(Aの結果)
});
test('他の端末から知った記録は、自分の台帳ファイルには書き戻さない(出どころが混ざらない)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    await A.ingestMails([request('m1')]);
    await B.ingestMails([request('m1'), request('m9')]);
    const docB = JSON.parse([...drive.files.values()].find(f => f.deviceId === ID_B).text);
    assert.deepEqual(Object.keys(docB.entries), ['m9/a1']);
});
test('同じ処理を何度同期しても結果は同じ(べき等)。変化がなければ書き込まない', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    await A.ingestMails([request('m1')]);
    const w = A.adapter.calls.write;
    const r1 = await A.sync(), r2 = await A.sync();
    assert.equal(r1.ok, true); assert.equal(r1.pushed, false); assert.equal(r2.pushed, false);
    assert.equal(A.adapter.calls.write, w);
    assert.equal(drive.files.size, 1);
});
test('台帳のやり取りは3台目以降でも同じ(Cは A と B の記録を両方知る)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive), C = device(ID_C, drive);
    await A.ingestMails([request('m1')]); await B.ingestMails([request('m2')]);
    const r = await C.ingestMails([request('m1'), request('m2'), request('m3')]);
    assert.equal(r.registered, 1); assert.equal(r.skipped, 2);
});

// ---------- 2. 競合: 両端末が同時に取り込んだ場合 ----------
test('両端末が同期前に同じメールを取り込むと両方で登録される。次の同期で検出して警告し、データは消さない', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    A.ingestLocal([request('m1')]); B.ingestLocal([request('m1')]);
    assert.equal(countFor(A, 'm1'), 1); assert.equal(countFor(B, 'm1'), 1);
    const ra = await A.sync();
    assert.equal(ra.ok, true); assert.equal(ra.conflicts, 0);               // Aの時点ではBの台帳はまだ無い
    const rb = await B.sync();
    assert.equal(rb.ok, true); assert.equal(rb.conflicts, 1);
    const ra2 = await A.sync();
    assert.equal(ra2.conflicts, 1);
    for (const dev of [A, B]) {
        const cs = dev.mb('conflicts');
        assert.equal(cs.length, 1); assert.equal(cs[0].kind, 'double_registered'); assert.equal(cs[0].key, 'm1/a1');
        assert.equal(dev.status().conflicts, 1); assert.equal(dev.status().level, 'warn');
        assert.equal(countFor(dev, 'm1'), 1);                               // 勝手に消さない
    }
    // 残す側はちょうど1台(IDの小さい方)。両方が取り消してしまうことを防ぐ
    assert.equal(A.mb('conflicts')[0].keep, true); assert.equal(B.mb('conflicts')[0].keep, false);
    const again = await B.sync();
    assert.equal(again.conflicts, 0); assert.equal(B.mb('conflicts').length, 1);   // 同じ警告を増やさない
});
test('警告は確認済みにでき、確認後は同じ競合を再通知しない', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    A.ingestLocal([request('m1')]); B.ingestLocal([request('m1')]);
    await A.sync(); await B.sync();
    assert.equal(B.mb('ackConflict', 'm1/a1', 'double_registered').ok, true);
    assert.equal(B.mb('conflicts').length, 0);
    await B.sync();
    assert.equal(B.mb('conflicts').length, 0);
});
test('Aは自動登録、Bは判別不可で持っている場合: Bの行に「別の端末で登録済みの可能性」を付ける。反映は止めない', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    A.ingestLocal([request('m1')]); B.ingestLocal([imageOnly('m1')]);
    assert.equal(B.mb('rows')[0].bucket, 'unreadable');
    await A.sync(); const r = await B.sync();
    assert.equal(r.ok, true);
    const row = B.mb('rows').find(x => x.state === 'new');
    assert.equal(row.elsewhere, true);
    const res = B.mb('applyRows', [{ rowId: row.id, workspaceId: 'unscheduled' }]);
    assert.equal(res.ok, true);                                              // 止めない(最後は目視確認)
});

// ---------- 3. 壊れた・読めない台帳 / 通信の失敗: 取り込みは止めない ----------
test('相手の台帳ファイルが壊れていても、取り込みは止めずローカルの判定で続け、警告を出す', async () => {
    const drive = makeDrive(), B = device(ID_B, drive);
    drive.files.set('f0', { id: 'f0', deviceId: ID_A, savedAt: T0, text: '{not json' });
    const r = await B.ingestMails([request('m1')]);
    assert.equal(r.ok, true); assert.equal(r.registered, 1);
    assert.ok(r.sync.warnings.includes('bad_json'));
    const st = B.status();
    assert.equal(st.level, 'warn'); assert.ok(st.warnings.includes('bad_json'));
    assert.equal(countFor(B, 'm1'), 1);
    assert.ok(drive.files.size >= 1);
});
test('台帳が壊れた端末は、別端末の正常な台帳は読み続け、壊れたファイルだけ無視する', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    await A.ingestMails([request('m1')]);
    drive.files.set('fz', { id: 'fz', deviceId: ID_C, savedAt: T0, text: 'zzz' });
    const r = await B.ingestMails([request('m1')]);
    assert.equal(r.registered, 0); assert.equal(r.skipped, 1);
    assert.ok(r.sync.warnings.includes('bad_json'));
});
test('形式違い・巨大・不正なキーを含む台帳は、不正な部分だけ捨てる(プロトタイプ汚染なし)', async () => {
    const drive = makeDrive(), B = device(ID_B, drive);
    const bad = '{"app":"CULOchanMailLedger1","v":1,"deviceId":"' + ID_A + '","savedAt":"' + new Date(Date.parse(T0)).toISOString() + '","entries":{"__proto__":{"r":"registered","at":"' + new Date(Date.parse(T0)).toISOString() + '"},"ok/1":{"r":"registered","at":"' + new Date(Date.parse(T0)).toISOString() + '"},"bad r/1":{"r":"registered","at":"x"},"k2":{"r":"hacked","at":"' + new Date(Date.parse(T0)).toISOString() + '"},"k3":{"r":"registered","at":"nope"},"k4":"str","<script>":{"r":"registered","at":"' + new Date(Date.parse(T0)).toISOString() + '"},"' + 'L'.repeat(500) + '":{"r":"registered","at":"' + new Date(Date.parse(T0)).toISOString() + '"},"k5":{"r":"registered","at":"2999-01-01T00:00:00.000Z"}}}';
    drive.files.set('f0', { id: 'f0', deviceId: ID_A, savedAt: T0, text: bad });
    const r = await B.sync();
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(B.ledger()), ['ok/1']);
    assert.equal(B.ledger()['ok/1'].x, 1);
    assert.equal(({}).r, undefined);
    assert.ok(r.warnings.includes('entries_invalid'));
});
test('形式が違う台帳(別アプリ・版違い・端末ID不一致・エントリ過多)は丸ごと無視して警告', async () => {
    const drive = makeDrive(), B = device(ID_B, drive);
    const at = new Date(Date.parse(T0)).toISOString();
    const good = { r: 'registered', at };
    const many = {}; for (let i = 0; i < 5001; i++) many['k' + i] = good;
    drive.files.set('f1', { id: 'f1', deviceId: ID_A, savedAt: T0, text: JSON.stringify({ app: 'Other', v: 1, deviceId: ID_A, entries: { a: good } }) });
    drive.files.set('f2', { id: 'f2', deviceId: ID_C, savedAt: T0, text: JSON.stringify({ app: 'CULOchanMailLedger1', v: 2, deviceId: ID_C, entries: { b: good } }) });
    drive.files.set('f3', { id: 'f3', deviceId: ID_A, savedAt: T0, text: JSON.stringify({ app: 'CULOchanMailLedger1', v: 1, deviceId: ID_C, entries: { c: good } }) });
    drive.files.set('f4', { id: 'f4', deviceId: ID_C, savedAt: T0, text: JSON.stringify({ app: 'CULOchanMailLedger1', v: 1, deviceId: ID_C, entries: many }) });
    const r = await B.sync();
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(B.ledger()), []);
    for (const w of ['bad_format', 'bad_version', 'device_mismatch', 'too_many']) assert.ok(r.warnings.includes(w), w);
});
test('大きすぎるファイルは読まずに捨てる', async () => {
    const drive = makeDrive(), B = device(ID_B, drive, { fakeSize: 5 * 1024 * 1024 });
    drive.files.set('f0', { id: 'f0', deviceId: ID_A, savedAt: T0, text: '{}' });
    const r = await B.sync();
    assert.ok(r.warnings.includes('file_too_large'));
    assert.equal(B.adapter.calls.read, 0);
});
test('Driveに接続していない端末でも取り込みは動く(ローカル判定)。状態は「未接続」と画面で分かる', async () => {
    const drive = makeDrive(), A = device(ID_A, drive, { connected: false });
    const r = await A.ingestMails([request('m1')]);
    assert.equal(r.ok, true); assert.equal(r.registered, 1);
    assert.equal(r.sync.code, 'not_connected');
    assert.equal(A.status().level, 'off'); assert.equal(A.status().connected, false);
    assert.equal(A.adapter.calls.list, 0); assert.equal(drive.files.size, 0);
    // ローカルの台帳だけで二重登録しない
    const r2 = await A.ingestMails([request('m1')]);
    assert.equal(r2.skipped, 1); assert.equal(countFor(A, 'm1'), 1);
});
for (const code of ['network', 'auth_expired', 'forbidden', 'timeout']) {
    test(`通信エラー(${code})でも取り込みは続き、失敗が状態に残る。復旧したら次の同期で台帳を出す`, async () => {
        const drive = makeDrive(), A = device(ID_A, drive, { listError: code });
        const r = await A.ingestMails([request('m1')]);
        assert.equal(r.ok, true); assert.equal(r.registered, 1);
        assert.equal(r.sync.ok, false); assert.equal(r.sync.code, code);
        const st = A.status();
        assert.equal(st.level, 'error'); assert.equal(st.lastPull.ok, false); assert.equal(st.lastPull.code, code);
        assert.ok(typeof st.message === 'string' && st.message.length > 0);
        delete A.hooks.listError;
        const r2 = await A.sync();
        assert.equal(r2.ok, true); assert.equal(r2.pushed, true);
        assert.equal(A.status().level, 'ok');
        assert.equal(JSON.parse([...drive.files.values()][0].text).entries['m1/a1'].r, 'registered');
    });
}
test('書き込みが失敗しても取り込みは成功したまま。失敗は残り、次回やり直す', async () => {
    const drive = makeDrive(), A = device(ID_A, drive, { writeError: 'forbidden' });
    const r = await A.ingestMails([request('m1')]);
    assert.equal(r.ok, true); assert.equal(r.registered, 1);
    assert.equal(A.status().lastPush.ok, false); assert.equal(A.status().level, 'error');
    assert.equal(drive.files.size, 0);
    delete A.hooks.writeError;
    const r2 = await A.sync(); assert.equal(r2.pushed, true); assert.equal(drive.files.size, 1);
});
test('応答が返らない通信は時間切れにして取り込みを続ける(タイムアウト後の遅れた結果は使わない)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive, { hangList: true }, { timeoutMs: 30 });
    const r = await A.ingestMails([request('m1')]);
    assert.equal(r.ok, true); assert.equal(r.registered, 1);
    assert.equal(r.sync.code, 'timeout');
    assert.equal(A.status().level, 'error');
});
test('同期の同時実行は1つだけ(2回目は busy で何もしない)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive, { writeDelay: 30 });
    A.ingestLocal([request('m1')]);
    const [r1, r2] = await Promise.all([A.syncRaw().then(x => JSON.parse(JSON.stringify(x))), A.syncRaw().then(x => JSON.parse(JSON.stringify(x)))]);
    assert.equal([r1, r2].filter(r => r.code === 'busy').length, 1);
    assert.equal(A.adapter.calls.write, 1);
});
test('自分のローカル台帳が壊れていたら、取り込みも同期も止め、何も上書きしない(従来どおり)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    A.store.set(KEY_LEDGER, '{broken');
    const r = await A.ingestMails([request('m1')]);
    assert.equal(r.ok, false); assert.equal(r.code, 'ledger_corrupt');
    assert.equal(A.store.get(KEY_LEDGER), '{broken');
    assert.equal(drive.files.size, 0);
    const s = await A.sync();
    assert.equal(s.ok, false); assert.equal(s.code, 'ledger_corrupt'); assert.equal(drive.files.size, 0);
    assert.equal(A.status().level, 'error');
});
test('アダプタが想定外の値を返しても例外を外へ出さない', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    A.adapter.list = async () => 'not an array';
    const r = await A.sync();
    assert.equal(r.ok, false); assert.equal(r.code, 'bad_response');
    A.adapter.list = async () => { throw new Error('boom'); };
    const r2 = await A.sync();
    assert.equal(r2.ok, false); assert.equal(r2.code, 'network');
});

// ---------- 4. 期限切れ(180日) ----------
test('180日を過ぎた記録は、出さない・読まない(179日はまだ有効)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    A.setNow('2026-04-01T12:00:00+09:00'); B.setNow('2026-04-01T12:00:00+09:00');
    await A.ingestMails([request('old1')]);
    A.setNow('2026-09-28T12:00:00+09:00'); B.setNow('2026-09-28T12:00:00+09:00');   // 180日後(+まだ有効の境目あたり)
    await A.ingestMails([request('new1')]);
    A.setNow('2026-10-28T12:00:00+09:00'); B.setNow('2026-10-28T12:00:00+09:00');   // old1: 210日 / new1: 30日
    await A.sync();
    const doc = JSON.parse([...drive.files.values()].find(f => f.deviceId === ID_A).text);
    assert.deepEqual(Object.keys(doc.entries), ['new1/a1']);
    // 相手のファイルに残っていた古い記録も読まない
    const old = new Date(Date.parse('2026-04-01T12:00:00+09:00')).toISOString(), ok = new Date(Date.parse('2026-05-02T12:00:00+09:00')).toISOString();
    drive.files.set('fx', { id: 'fx', deviceId: ID_C, savedAt: ok, text: JSON.stringify({ app: 'CULOchanMailLedger1', v: 1, deviceId: ID_C, savedAt: ok, entries: { 'e1/a': { r: 'registered', at: old }, 'e2/a': { r: 'registered', at: ok } } }) });
    const r = await B.sync();
    assert.deepEqual(Object.keys(B.ledger()).sort(), ['e2/a', 'new1/a1']);   // e2: 179日
    assert.ok(r.pulled.expired >= 1);
});

// ---------- 5. 台帳を失った端末の復旧 ----------
test('台帳だけ失った端末は、自分の台帳ファイルから記録を戻し、再登録しない(ファイルも縮めない)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    await A.ingestMails([request('m1')]);
    A.store.delete(KEY_LEDGER); A.store.delete(KEY_BOX);
    for (const k of [...A.store.keys()]) if (k.startsWith('mm_customers_unscheduled')) A.store.delete(k);   // 訪問先も消えた状態
    const r = await A.ingestMails([request('m1')]);
    assert.equal(r.registered, 0); assert.equal(r.skipped, 1);
    assert.equal(A.ledger()['m1/a1'].x, undefined);                            // 自分の記録として戻る
    const doc = JSON.parse([...drive.files.values()][0].text);
    assert.ok(doc.entries['m1/a1']);
});
test('自分のファイルを読めなかった回は、自分のファイルを上書きしない(記録を縮めない)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    await A.ingestMails([request('m1')]);
    const fid = [...drive.files.keys()][0], before = drive.files.get(fid).text;
    A.store.delete(KEY_LEDGER);
    A.hooks.readError = { all: true, code: 'network' };
    const r = await A.sync();
    assert.equal(r.pushed, false);
    assert.equal(drive.files.get(fid).text, before);
});
test('同じ端末のファイルが2つできていても(作成の重複)、まとめて読み、新しい方を更新する', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    const at = new Date(Date.parse(T0)).toISOString();
    const mk = (id, saved, key) => ({ id, deviceId: ID_A, savedAt: saved, text: JSON.stringify({ app: 'CULOchanMailLedger1', v: 1, deviceId: ID_A, savedAt: saved, entries: { [key]: { r: 'registered', at } } }) });
    drive.files.set('old', mk('old', '2026-10-01T00:00:00.000Z', 'k1/a')); drive.files.set('new', mk('new', '2026-10-20T00:00:00.000Z', 'k2/a'));
    const r = await A.sync();
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(A.ledger()).sort(), ['k1/a', 'k2/a']);
    assert.equal(JSON.parse(drive.files.get('new').text).entries['k1/a'].r, 'registered');
    assert.equal(drive.files.size, 2);
});

// ---------- 6. 端末ID・保存場所 ----------
test('端末IDは端末ごとに1つ作って保存し、バックアップ許可リストには入れない(復元で2台が同じIDにならない)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    await A.sync();
    const st = JSON.parse(A.store.get(KEY_SYNC));
    assert.equal(st.deviceId, ID_A);
    assert.equal(BackupFormat.allowedKey(KEY_SYNC), false);
    assert.equal(BackupFormat.allowedKey(KEY_LEDGER), false);
    A.context.__id = 'dddddddd-0000-4000-8000-000000000009'; A.fresh();
    await A.sync();
    assert.equal(JSON.parse(A.store.get(KEY_SYNC)).deviceId, ID_A);          // 保存済みのIDを使い続ける
});
test('端末IDの保存が壊れていたら作り直して警告(取り込みは止めない)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    A.store.set(KEY_SYNC, '{oops');
    const r = await A.ingestMails([request('m1')]);
    assert.equal(r.ok, true); assert.equal(r.registered, 1);
    assert.ok(A.status().warnings.includes('state_reset'));
});

// ---------- 7. 結果の種別 ----------
test('結果の種別(登録/判別不可/通達/対象外/取消)が台帳に記録される。対象外メールは行を作らない', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    const r = await A.ingestLocal([
        request('k1'), imageOnly('k2'),
        mail('k3', [att('a1', '配置図.pdf', 'pdf', [])], { subject: 'お知らせ' }),
        mail('k4', [], { subject: '通知', excluded: true }),
        request('k5')
    ]);
    assert.equal(r.ok, true); assert.equal(r.excluded, 1);
    const l = A.ledger();
    assert.equal(l['k1/a1'].r, 'registered'); assert.equal(l['k2/a1'].r, 'unreadable'); assert.equal(l['k3/a1'].r, 'reference'); assert.equal(l['k4/excluded'].r, 'excluded');
    assert.equal(A.mb('rows').some(x => x.id.startsWith('k4')), false);
    A.mb('dismissRow', 'k2/a1'); assert.equal(A.ledger()['k2/a1'].r, 'dismissed');
    A.mb('cancelRegistration', 'k5/a1'); assert.equal(A.ledger()['k5/a1'].r, 'cancelled');
    const kinds = A.eval('MailBox.RESULT_KIND');
    assert.deepEqual([kinds.registered, kinds.applied, kinds.unreadable, kinds.reference, kinds.dismissed, kinds.excluded, kinds.cancelled], ['登録', '登録', '判別不可', '通達', '対象外', '対象外', '取消']);
    const again = A.ingestLocal([mail('k4', [], { subject: '通知', excluded: true })]);
    assert.equal(again.excluded, 0); assert.equal(again.skipped, 1);
    // 台帳ファイルにも種別が出る
    await A.sync();
    const doc = JSON.parse([...drive.files.values()][0].text);
    assert.deepEqual(Object.values(doc.entries).map(e => e.r).sort(), ['cancelled', 'dismissed', 'excluded', 'reference', 'registered']);
});
test('Bで「対象外/通達/判別不可」にした記録も、Aが同じメールを処理済みとして扱う', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    await A.ingestMails([mail('k4', [], { subject: '通知', excluded: true }), imageOnly('k2')]);
    const r = await B.ingestMails([mail('k4', [], { subject: '通知', excluded: true }), imageOnly('k2')]);
    assert.equal(r.excluded, 0); assert.equal(r.unreadable, 0); assert.equal(r.skipped, 2);
    assert.equal(B.mb('rows').length, 0);
});

// ---------- 8. mailKey と台帳の整合 ----------
test('訪問先のmailKeyだけが残り台帳が無い場合: 取り込みで二重登録せず、台帳へ「他端末由来」で補う(アップロードしない)', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    A.ingestLocal([request('m1')]);
    B.store.set('mm_customers_unscheduled', A.store.get('mm_customers_unscheduled'));
    B.store.set('mm_workspaces', A.store.get('mm_workspaces'));
    const r = await B.ingestMails([request('m1')]);
    assert.equal(r.registered, 0); assert.equal(r.skipped, 1);
    assert.equal(B.ledger()['m1/a1'].x, 1);
    assert.equal(B.mb('ownLedger').count, 0);
});
test('reconcile: mailKeyのある訪問先のうち台帳に無いものを補う。2回目は何もしない。台帳が壊れていれば何もしない', () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    A.ingestLocal([request('m1')]);
    A.store.delete(KEY_LEDGER);
    const r1 = A.mb('reconcile');
    assert.equal(r1.ok, true); assert.equal(r1.backfilled, 1);
    assert.equal(A.ledger()['m1/a1'].r, 'registered'); assert.equal(A.ledger()['m1/a1'].x, 1);
    assert.equal(A.mb('reconcile').backfilled, 0);
    A.store.set(KEY_LEDGER, '{bad');
    assert.equal(A.mb('reconcile').ok, false); assert.equal(A.store.get(KEY_LEDGER), '{bad');
});
test('他端末で登録済みだがこの端末の訪問先にまだ無い件数・他端末で確認待ちの件数を数える', async () => {
    const drive = makeDrive(), A = device(ID_A, drive), B = device(ID_B, drive);
    await A.ingestMails([request('m1'), request('m2'), imageOnly('m3')]);
    await B.sync();
    const info = B.mb('syncInfo');
    assert.equal(info.remoteRegisteredNotHere, 2); assert.equal(info.remoteUnreadable, 1);
    assert.equal(B.status().remote.registeredNotHere, 2);
    // バックアップでAの訪問先がBに届けば、「まだ無い」は0になる
    B.store.set('mm_customers_unscheduled', A.store.get('mm_customers_unscheduled'));
    B.store.set('mm_workspaces', A.store.get('mm_workspaces'));
    assert.equal(B.mb('syncInfo').remoteRegisteredNotHere, 0);
});

// ---------- 9. 後方互換 ----------
test('旧形式(出どころ印・競合欄なし)の台帳とBOXをそのまま読める', async () => {
    const drive = makeDrive(), A = device(ID_A, drive);
    const at = new Date(Date.parse(T0)).toISOString();
    A.store.set(KEY_LEDGER, JSON.stringify({ v: 1, entries: { 'o1/a': { r: 'registered', at }, 'o2/a': { r: 'unreadable', at } } }));
    A.store.set(KEY_BOX, JSON.stringify({ v: 1, rows: [], log: [] }));
    assert.deepEqual(A.mb('conflicts'), []);
    const r = await A.sync();
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(JSON.parse([...drive.files.values()][0].text).entries).sort(), ['o1/a', 'o2/a']);
});

// ---------- 10. 個人情報・ログ ----------
test('動作記録・状態・コンソールに、会社名・住所・件名・ファイル名・メッセージIDを出さない', async () => {
    const drive = makeDrive(), A = device(ID_A, drive, {}), B = device(ID_B, drive, { listError: 'network' });
    await A.ingestMails([request('secretmsg1'), imageOnly('secretmsg2')]);
    await B.ingestMails([request('secretmsg1')]);
    A.setNow(T0);
    const A2 = device(ID_C, drive);
    A2.ingestLocal([request('secretmsg1')]); await A2.sync(); await A.sync();
    for (const dev of [A, B, A2]) {
        const blob = JSON.stringify([dev.mb('log'), dev.status(), dev.logs, dev.store.get(KEY_SYNC)]);
        for (const w of [...SECRET_WORDS, 'secretmsg1', 'secretmsg2', '既存会社']) assert.equal(blob.includes(w), false, w);
    }
});

// ---------- 検証関数の単体 ----------
test('validateEntries: __proto__ / constructor などの危険なキーは捨て、結果のプロトタイプを汚さない', () => {
    const A = device(ID_A, makeDrive());
    const at = new Date(Date.parse(T0)).toISOString();
    A.context.__raw = `{"__proto__":{"r":"registered","at":"${at}"},"constructor":{"r":"registered","at":"${at}"},"prototype":{"r":"registered","at":"${at}"},"good/1":{"r":"reference","at":"${at}","extra":"drop me"}}`;
    const v = A.eval(`(() => { const v = MailBox.validateEntries(JSON.parse(__raw), ${Date.parse(T0)}); return { keys: Object.keys(v.entries), dropped: v.dropped, plainProto: Object.getPrototypeOf(v.entries) === Object.prototype, entry: v.entries['good/1'] }; })()`);
    assert.deepEqual(v.keys, ['good/1']); assert.equal(v.dropped, 3); assert.equal(v.plainProto, true);
    assert.deepEqual(v.entry, { r: 'reference', at });
});
