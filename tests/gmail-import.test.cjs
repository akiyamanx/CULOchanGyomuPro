// Gmail取り込みの流れ(一覧→1通→添付→解析→仕分け→自動登録→BOX→台帳)のテスト。
// Gmailの代わりに「偽の取得アダプタ」、解析は「偽のリーダー」、BOXは本物(MailBox)。実際のGoogle/Gmailには接続しない。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const T0 = Date.parse('2026-10-28T12:00:00+09:00');
const DAY = 24 * 3600 * 1000;
const coded = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
const SECRET_WORDS = ['架空商事', '東京都架空区', '甲野', '乙川', '業務依頼のお願い', '業務依頼書', 'example.invalid', 'ya29', 'Bearer'];

const full = (extra = {}) => ({ company: '架空商事', address: '東京都架空区1-2-3', purpose: '修理', equipType: '', unitCount: 1, workDateText: '', titleText: '', appoDate: '', source: 'a.xls · 一覧', kind: '一覧表', warnings: [], ...extra });
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d], ZIP = [0x50, 0x4b, 0x03, 0x04], OLE = [0xd0, 0xcf, 0x11, 0xe0];
const sig = { pdf: PDF, xlsx: ZIP, xls: OLE, csv: [0x61, 0x2c, 0x62, 0x0a] };

// ---------- 偽のGmail(メール表と、呼び出し記録) ----------
function makeGmail(hooks = {}) {
    const msgs = new Map(); const calls = { list: 0, get: [], dl: [] }; let seq = 0;
    const api = {
        calls, hooks, msgs,
        add(id, attachments, extra = {}) {
            msgs.set(id, { id, internalDateMs: extra.internalDateMs ?? T0 - DAY, from: extra.from ?? '"架空 甲野" <kouno@example.invalid>', subject: extra.subject ?? '業務依頼のお願い', attachments, partsTruncated: !!extra.partsTruncated });
        },
        att(partId, fileName, mimeType, size, bytes) { return { partKey: 'p' + partId, partId, fileName, mimeType, size, attachmentId: 'ATT-' + (++seq) + '-' + partId, bytes: bytes || [] }; },
        source: {
            buildQuery: ({ terms, days }) => `has:attachment newer_than:${days}d from:(${terms.join(' OR ')})`,
            async listMessageIds({ query, maxMessages, signal }) {
                calls.list++; calls.query = query; calls.maxMessages = maxMessages;
                if (hooks.listError) throw coded(hooks.listError);
                const ids = [...msgs.keys()];
                return { ids: ids.slice(0, maxMessages), truncated: ids.length > maxMessages, pages: 1 };
            },
            async getMessage(id) {
                calls.get.push(id);
                const h = hooks.getError && hooks.getError(id, calls.get.length);
                if (h) throw coded(h);
                const m = msgs.get(id); if (!m) throw coded('not_found');
                return { ...m, attachments: m.attachments.map(a => ({ ...a, attachmentId: a.attachmentId })) };   // 取得のたびに attachmentId を作り直す(実Gmailと同じ)
            },
            async downloadAttachment(messageId, attachmentId, { maxBytes }) {
                calls.dl.push(attachmentId);
                const h = hooks.dlError && hooks.dlError(messageId, attachmentId);
                if (h) throw coded(h);
                const a = [...msgs.get(messageId).attachments].find(x => x.attachmentId === attachmentId) || [...msgs.values()].flatMap(m => m.attachments).find(x => x.attachmentId === attachmentId);
                if (!a) throw coded('not_found');
                const b = Uint8Array.from(a.bytes.length ? a.bytes : []);
                if (b.length > maxBytes) throw coded('too_large');
                return b;
            },
            stats: () => ({ requests: 0, retries: 0 })
        }
    };
    return api;
}
// 偽のリーダー: ファイル名で結果を決める(本物のPDF/Excel解析はブラウザ専用のため、ここでは使わない)
function makeReader(table = {}) {
    const calls = [];
    return { calls, async readForMail(file, progress, signal) {
        calls.push(file.name);
        const r = table[file.name];
        if (r instanceof Error) throw r;
        if (!r) return { kind: 'xlsx', opened: true, items: [full({ company: '架空商事' + file.name.length + file.name.charCodeAt(2), address: '東京都架空区' + file.name })] };
        return r;
    } };
}

// ---------- 端末(MailBox は本物) ----------
function device(opts = {}) {
    const store = new Map([
        ['mm_workspaces', JSON.stringify([{ id: '2026-10', name: '2026年10月', createdAt: 'x' }])], ['mm_workspace_current', '2026-10'],
        ['mm_customers_2026-10', JSON.stringify([{ id: 'a', company: '既存会社', address: '東京都既存区1', purpose: '修理', status: 'appointed', appoDate: '2026-10-15T15:00', routeId: 'route_2' }])]
    ]);
    const storage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } };
    const logs = [];
    const ctx = vm.createContext({ console: { error: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), log: () => {} }, alert() {}, setTimeout, clearTimeout, AppStorage: storage, localStorage: storage, crypto: require('node:crypto').webcrypto, TextDecoder, Uint8Array });
    for (const f of ['../map/map-data-storage.js', '../map/request-month.js', '../map/request-parser.js', '../map/request-classifier.js', '../map/mail-box.js', '../map/gmail-import.js']) vm.runInContext(fs.readFileSync(require.resolve(f), 'utf8'), ctx);
    ctx.__now = T0;
    vm.runInContext('globalThis.__mb = MailBox.create({ now: () => new Date(__now) })', ctx);
    const run = code => vm.runInContext(code, ctx);
    const clone = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
    const d = { store, logs, ctx, mb: (name, ...a) => { ctx.__args = JSON.stringify(a); return clone(run(`__mb.${name}(...JSON.parse(__args))`)); } };
    d.make = (gmail, reader, extra = {}) => {
        ctx.__gmail = gmail.source; ctx.__reader = reader; ctx.__extra = extra;
        ctx.__makeFile = (bytes, name, mime) => ({ name, size: bytes.length, type: mime, bytes });
        return run('GmailImport.create({ source: __gmail, reader: __reader, mailBox: __mb, makeFile: __makeFile, terms: ["甲野", "乙川"], days: 62, now: () => __now, ...__extra })');
    };
    d.rows = () => d.mb('rows');
    d.customers = () => [...store.keys()].filter(k => k.startsWith('mm_customers_')).flatMap(k => JSON.parse(store.get(k))).filter(c => c.mailKey);
    d.ledger = () => JSON.parse(store.get('gyomupro_mail_ledger') || '{"entries":{}}').entries;
    return d;
}
const plainRun = async (imp, o) => JSON.parse(JSON.stringify(await imp.run(o || {})));
const M = (g, id, name, mime, size, kind, extra = {}) => g.add(id, [g.att('1', name, mime, size, [...(sig[kind] || []), 1, 2, 3])], extra);
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const IDS = i => 'aaaaaa' + String(i).padStart(2, '0');

test('基本: 一覧→1通→添付→解析→仕分け→自動登録→BOX→台帳。依頼書は登録、参考資料は通達BOX、画像だけは添付を落とさず扱う', async () => {
    const g = makeGmail(), dev = device(), reader = makeReader({ '配置図.pdf': { kind: 'pdf', opened: true, items: [] } });
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx');
    M(g, IDS(2), '配置図.pdf', 'application/pdf', 3000, 'pdf', { subject: 'お知らせ' });
    g.add(IDS(3), [g.att('1', '現場写真.jpg', 'image/jpeg', 4_000_000)], { subject: '写真' });
    const r = await plainRun(dev.make(g, reader));
    assert.equal(r.ok, true); assert.equal(r.code, '');
    assert.equal(r.found, 3); assert.equal(r.mails, 3);
    assert.equal(r.ingest.registered, 1); assert.equal(r.ingest.reference >= 1, true);
    assert.equal(dev.customers().length, 1);
    assert.deepEqual(g.calls.dl.length, 2);              // 画像はダウンロードしない
    assert.deepEqual(reader.calls.sort(), ['業務依頼書.xlsx', '配置図.pdf']);
    assert.equal(r.attachments.imageSkipped, 1);
    assert.match(g.calls.query, /^has:attachment newer_than:62d from:\(甲野 OR 乙川\)$/);
    assert.equal(g.calls.query.includes('unread'), false);
    const ledger = dev.ledger();
    assert.ok(ledger[IDS(1) + '/p1'] && ledger[IDS(2) + '/p1'] && ledger[IDS(3) + '/p1']);
    assert.equal(dev.rows().every(row => row.source === 'gmail'), true);
});
test('台帳のキーは partId 由来。attachmentId が毎回変わっても、2回目の取り込みで二重登録も再ダウンロードもしない', async () => {
    const g = makeGmail(), dev = device();
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx');
    const imp = dev.make(g, makeReader());
    await plainRun(imp);
    assert.equal(dev.customers().length, 1); assert.equal(g.calls.dl.length, 1);
    g.msgs.get(IDS(1)).attachments[0].attachmentId = 'ATT-CHANGED';
    const r2 = await plainRun(imp);
    assert.equal(dev.customers().length, 1);
    assert.equal(g.calls.dl.length, 1);                 // 取得済みはダウンロードしない
    assert.equal(r2.attachments.skippedKnown, 1); assert.equal(r2.mails, 0);
    assert.deepEqual(Object.keys(dev.ledger()), [IDS(1) + '/p1']);
});
test('差出人が対象外のメールは、ダウンロードも登録もせず件数だけ数える(Gmailの検索を過信しない)', async () => {
    const g = makeGmail(), dev = device(), reader = makeReader();
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx', { from: '"架空 丙野" <other@example.invalid>' });
    M(g, IDS(2), '業務依頼書2.xlsx', XLSX_MIME, 3000, 'xlsx', { from: '"架空 乙川" <otsukawa@example.invalid>' });
    const r = await plainRun(dev.make(g, reader));
    assert.equal(r.skippedSender, 1); assert.equal(r.mails, 1);
    assert.deepEqual(g.calls.dl.length, 1);
    assert.equal(dev.rows().filter(x => x.messageId === IDS(1)).length, 0);
});
test('受信が検索期間より古いメールは対象外(日付の食い違いを黙って取り込まない)', async () => {
    const g = makeGmail(), dev = device();
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx', { internalDateMs: T0 - 90 * DAY });
    const r = await plainRun(dev.make(g, makeReader()));
    assert.equal(r.skippedOld, 1); assert.equal(r.mails, 0); assert.equal(g.calls.dl.length, 0);
});
test('受信日は日本時間(Asia/Tokyo)の日付にする', async () => {
    const g = makeGmail(), dev = device();
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx', { internalDateMs: Date.parse('2026-10-27T16:00:00Z') });
    await plainRun(dev.make(g, makeReader()));
    assert.equal(dev.rows().find(x => x.messageId === IDS(1)).receivedDate, '2026-10-28');
});
test('TNEF(winmail.dat)は開けないのでダウンロードせず、判別不可BOXに理由つきで回す', async () => {
    const g = makeGmail(), dev = device(), reader = makeReader();
    g.add(IDS(1), [g.att('1', 'winmail.dat', 'application/ms-tnef', 5000), g.att('2', 'ATT00001.DAT', 'application/vnd.ms-tnef', 100)]);
    const r = await plainRun(dev.make(g, reader));
    assert.equal(g.calls.dl.length, 0); assert.equal(reader.calls.length, 0);
    assert.equal(r.attachments.tnef, 2);
    const rows = dev.rows().filter(x => x.messageId === IDS(1));
    assert.equal(rows.length, 2); assert.equal(rows.every(x => x.bucket === 'unreadable' && x.needsAttention), true);
    assert.equal(rows.some(x => /winmail|Outlook|TNEF/.test(x.reason)), true);
    assert.equal(dev.customers().length, 0);
});
test('大きすぎる添付(宣言サイズ)・許可しない形式・MIME食い違いは、ダウンロードせず判別不可へ', async () => {
    const g = makeGmail(), dev = device(), reader = makeReader();
    g.add(IDS(1), [g.att('1', '大きい.xlsx', XLSX_MIME, 11 * 1024 * 1024)]);
    g.add(IDS(2), [g.att('1', '資料.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 100)]);
    g.add(IDS(3), [g.att('1', '怪しい.pdf', 'application/x-msdownload', 100)]);
    g.add(IDS(4), [g.att('1', '圧縮.zip', 'application/zip', 100)]);
    g.add(IDS(5), [{ ...g.att('1', '実体なし.pdf', 'application/pdf', 100), attachmentId: '' }]);
    const r = await plainRun(dev.make(g, reader));
    assert.equal(g.calls.dl.length, 0); assert.equal(reader.calls.length, 0);
    assert.equal(r.attachments.tooLarge, 1); assert.equal(r.attachments.blocked, 3); assert.equal(r.attachments.noBody, 1);
    const rows = dev.rows();
    assert.equal(rows.length, 5); assert.equal(rows.every(x => x.bucket === 'unreadable'), true);
});
test('MIMEは application/octet-stream でも拡張子が正しければ通す(実Gmailでxlsがこの形で届くことを確認済み)', async () => {
    const g = makeGmail(), dev = device(), reader = makeReader();
    M(g, IDS(1), '旧形式.xls', 'application/octet-stream', 4000, 'xls');
    const r = await plainRun(dev.make(g, reader));
    assert.equal(g.calls.dl.length, 1); assert.equal(r.attachments.blocked, 0);
});
test('中身が拡張子と合わない(PDFなのに先頭が違う等)ものは、解析せず判別不可へ', async () => {
    const g = makeGmail(), dev = device(), reader = makeReader();
    g.add(IDS(1), [g.att('1', '偽物.pdf', 'application/pdf', 100, [0x4d, 0x5a, 0x90, 0x00])]);    // 実行ファイルの先頭
    g.add(IDS(2), [g.att('1', '偽物.xlsx', XLSX_MIME, 100, [0x25, 0x50, 0x44, 0x46])]);
    g.add(IDS(3), [g.att('1', '偽物.csv', 'text/csv', 100, [0x61, 0x00, 0x62, 0x00])]);
    const r = await plainRun(dev.make(g, reader));
    assert.equal(reader.calls.length, 0); assert.equal(r.attachments.blocked, 3);
    assert.equal(dev.rows().every(x => x.bucket === 'unreadable'), true);
});
test('ダウンロード後に実サイズが上限を超えた(too_large)ときも、そのファイルだけ判別不可へ', async () => {
    const g = makeGmail({ dlError: () => 'too_large' }), dev = device(), reader = makeReader();
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx');
    const r = await plainRun(dev.make(g, reader));
    assert.equal(r.attachments.tooLarge, 1); assert.equal(dev.rows()[0].bucket, 'unreadable');
});
test('リーダーが失敗する・開けない添付は、判別不可BOXへ(登録しない)。例外は外へ出さない', async () => {
    const g = makeGmail(), dev = device();
    M(g, IDS(1), '壊れた.xlsx', XLSX_MIME, 3000, 'xlsx');
    M(g, IDS(2), '開けない.pdf', 'application/pdf', 3000, 'pdf');
    const reader = makeReader({ '壊れた.xlsx': new Error('boom 架空商事'), '開けない.pdf': { kind: 'pdf', opened: false, items: [], errorCode: 'read_failed' } });
    const r = await plainRun(dev.make(g, reader));
    assert.equal(r.ok, true); assert.equal(r.attachments.parseFailed, 2);
    assert.equal(dev.rows().filter(x => x.bucket === 'unreadable').length, 2); assert.equal(dev.customers().length, 0);
    assert.equal(JSON.stringify(r).includes('boom'), false);
});
test('認証切れ(401)は一覧で起きたら何も取り込まず ok:false。途中で起きたらそこまでの分は取り込んで止まる', async () => {
    const g1 = makeGmail({ listError: 'auth_expired' }), d1 = device();
    M(g1, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx');
    const r1 = await plainRun(d1.make(g1, makeReader()));
    assert.equal(r1.ok, false); assert.equal(r1.code, 'auth_expired'); assert.equal(r1.stage, 'list'); assert.equal(d1.rows().length, 0);
    const g2 = makeGmail({ getError: (id) => id === IDS(3) ? 'auth_expired' : '' }), d2 = device();
    for (let i = 1; i <= 4; i++) M(g2, IDS(i), `依頼${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
    const reader = makeReader({}); const r2 = await plainRun(d2.make(g2, reader));
    assert.equal(r2.ok, false); assert.equal(r2.code, 'auth_expired'); assert.equal(r2.stage, 'fetch');
    assert.equal(r2.mails, 2); assert.equal(d2.rows().length, 2);        // 止まる前の2通は登録済み
    assert.equal(g2.calls.get.length, 3);                                // 4通目は取りに行かない
});
test('止めるべき失敗(利用上限・権限・API未有効・接続なし)は、続けずにコードつきで止まる。取り込み済み分は残る', async () => {
    for (const code of ['rate_limited', 'forbidden', 'scope_missing', 'api_disabled', 'not_connected']) {
        const g = makeGmail({ getError: id => id === IDS(2) ? code : '' }), dev = device();
        for (let i = 1; i <= 3; i++) M(g, IDS(i), `依頼${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
        const r = await plainRun(dev.make(g, makeReader()));
        assert.equal(r.ok, false, code); assert.equal(r.code, code); assert.equal(r.mails, 1, code); assert.equal(g.calls.get.length, 2, code);
    }
});
test('一時的な失敗(通信・サーバー・タイムアウト)の1通は、飛ばして次へ進む。台帳に残さないので次回また取りに行く', async () => {
    const g = makeGmail({ getError: id => id === IDS(2) ? 'network' : '' }), dev = device();
    for (let i = 1; i <= 3; i++) M(g, IDS(i), `依頼${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
    const imp = dev.make(g, makeReader());
    const r = await plainRun(imp);
    assert.equal(r.ok, true); assert.equal(r.failedMails, 1); assert.equal(r.mails, 2);
    assert.equal(dev.ledger()[IDS(2) + '/p1'], undefined);
    g.hooks.getError = () => '';
    const r2 = await plainRun(imp);
    assert.equal(r2.mails, 1); assert.equal(r2.failedMails, 0); assert.ok(dev.ledger()[IDS(2) + '/p1']);
    assert.equal(dev.customers().length, 3);
});
test('添付のダウンロードに失敗したメールは、一部だけ登録せず丸ごと見送る(次回やり直す)', async () => {
    const g = makeGmail({ dlError: (m, a) => /-2$/.test(a) ? 'network' : '' }), dev = device();
    g.add(IDS(1), [g.att('1', 'a.xlsx', XLSX_MIME, 100, [...ZIP, 1]), g.att('2', 'b.xlsx', XLSX_MIME, 100, [...ZIP, 1])]);
    const r = await plainRun(dev.make(g, makeReader()));
    assert.equal(r.failedMails, 1); assert.equal(r.mails, 0); assert.equal(dev.rows().length, 0); assert.equal(Object.keys(dev.ledger()).length, 0);
});
test('連続して失敗が続いたら(既定3通)、無駄に叩かず止まる', async () => {
    const g = makeGmail({ getError: () => 'server_error' }), dev = device();
    for (let i = 1; i <= 8; i++) M(g, IDS(i), `依頼${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
    const r = await plainRun(dev.make(g, makeReader()));
    assert.equal(r.ok, false); assert.equal(r.code, 'server_error'); assert.equal(g.calls.get.length, 3); assert.equal(r.failedMails, 3);
});
test('1回の取得上限: 一覧の上限(maxMessages)を渡し、超えた分は truncated で画面に出す(次回続きから)', async () => {
    const g = makeGmail(), dev = device();
    for (let i = 1; i <= 5; i++) M(g, IDS(i), `依頼${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
    const r = await plainRun(dev.make(g, makeReader(), { limits: { maxMessages: 3 } }));
    assert.equal(g.calls.maxMessages, 3); assert.equal(r.found, 3); assert.equal(r.truncated, true); assert.equal(r.mails, 3);
    const d2 = device(); const r2 = await plainRun(d2.make(g, makeReader(), { limits: { maxMessages: 10 } }));
    assert.equal(r2.truncated, false);
});
test('1回の総ダウンロード量の上限を超える前に止める。そのメールは見送り、残りは次回', async () => {
    const g = makeGmail(), dev = device();
    for (let i = 1; i <= 4; i++) M(g, IDS(i), `依頼${i}.xlsx`, XLSX_MIME, 400, 'xlsx');
    const r = await plainRun(dev.make(g, makeReader(), { limits: { maxTotalBytes: 1000 } }));
    assert.equal(r.truncated, true); assert.equal(r.code, ''); assert.equal(r.ok, true); assert.equal(r.mails, 2); assert.equal(r.stoppedBy, 'run_limit');
    assert.equal(g.calls.dl.length, 2);
});
test('1通に添付が多すぎる・パートが多すぎて見落とす恐れがあるときは、その旨の行を判別不可BOXに残す(黙って捨てない)', async () => {
    const g = makeGmail(), dev = device();
    g.add(IDS(1), Array.from({ length: 5 }, (_, i) => g.att(String(i + 1), `写真${i}.jpg`, 'image/jpeg', 100)));
    g.add(IDS(2), [g.att('1', 'a.xlsx', XLSX_MIME, 100, [...ZIP, 1])], { partsTruncated: true });
    await plainRun(dev.make(g, makeReader(), { limits: { maxAttachmentsPerMail: 3 } }));
    const l = dev.ledger();
    assert.ok(l[IDS(1) + '/p-over'] && l[IDS(2) + '/p-over']);
    assert.equal(dev.rows().filter(x => x.id.endsWith('/p-over')).every(x => x.bucket === 'unreadable'), true);
});
test('中止(AbortSignal)で止まり、取り込み済み分は残る。中止後はダウンロードしない', async () => {
    const g = makeGmail(), dev = device(); const ac = new AbortController();
    for (let i = 1; i <= 4; i++) M(g, IDS(i), `依頼${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
    const reader = makeReader(); const orig = reader.readForMail.bind(reader);
    reader.readForMail = async (...a) => { const r = await orig(...a); if (reader.calls.length === 2) ac.abort(); return r; };
    const r = await plainRun(dev.make(g, reader), { signal: ac.signal });
    assert.equal(r.ok, false); assert.equal(r.code, 'aborted'); assert.equal(r.mails, 2); assert.equal(g.calls.dl.length, 2);
});
test('差出人の設定が無い/不正なら、通信せず no_senders / bad_terms', async () => {
    const g = makeGmail(), dev = device();
    ctxTerms: {
        dev.ctx.__gmail = g.source;
    }
    for (const [terms, code] of [[[], 'no_senders'], [['a b'], 'bad_terms']]) {
        dev.ctx.__terms = terms;
        const imp = vm.runInContext('GmailImport.create({ source: __gmail, reader: { readForMail: async () => ({}) }, mailBox: __mb, terms: __terms, days: 62 })', dev.ctx);
        const r = await plainRun(imp);
        assert.equal(r.ok, false); assert.equal(r.code, code); assert.equal(g.calls.list, 0);
    }
    assert.equal(g.calls.list, 0);
});
test('進捗は件数だけ(件名・ファイル名・差出人を含まない)', async () => {
    const g = makeGmail(), dev = device(); const seen = [];
    for (let i = 1; i <= 2; i++) M(g, IDS(i), `業務依頼書${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
    await plainRun(dev.make(g, makeReader()), { onProgress: p => seen.push(JSON.parse(JSON.stringify(p))) });
    assert.ok(seen.length >= 3);
    for (const p of seen) for (const w of SECRET_WORDS) assert.equal(JSON.stringify(p).includes(w), false, w);
    assert.equal(seen.every(p => typeof p.stage === 'string' && Number.isFinite(p.done) && Number.isFinite(p.total)), true);
    assert.equal(seen[seen.length - 1].stage, 'done');
});
test('動作記録・結果・コンソールに、件名・ファイル名・会社名・差出人・トークンが出ない(名前と数だけ)', async () => {
    const g = makeGmail({ getError: id => id === IDS(2) ? 'network' : '' }), dev = device();
    for (let i = 1; i <= 3; i++) M(g, IDS(i), `業務依頼書${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
    g.add(IDS(9), [g.att('1', 'winmail.dat', 'application/ms-tnef', 10)]);
    const r = await plainRun(dev.make(g, makeReader()));
    const log = JSON.stringify(dev.mb('log')), out = JSON.stringify(r) + log + dev.logs.join('\n');
    for (const w of SECRET_WORDS.filter(w => !['架空商事', '東京都架空区'].includes(w))) assert.equal(out.includes(w), false, w);
    assert.match(log, /gmail_import/);
    const ev = dev.mb('log').find(e => /gmail_import/.test(e.name || e.event || JSON.stringify(e)));
    assert.ok(ev);
});
test('MailBox.processedBases: 台帳・登録済み・行のあるキーだけを返す', async () => {
    const dev = device(), g = makeGmail();
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx');
    await plainRun(dev.make(g, makeReader()));
    const got = dev.mb('processedBases', [IDS(1) + '/p1', IDS(1) + '/p2', 'zzzzzz/p1', '__proto__']);
    assert.deepEqual(got, [IDS(1) + '/p1']);
    assert.deepEqual(dev.mb('processedBases', 'x'), []);
});
test('台帳の同期層(syncer)があるときは、その ingestMails を通す。取り込み失敗は ok:false で画面に出す', async () => {
    const g = makeGmail(), dev = device(); const seen = [];
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx');
    dev.ctx.__syncer = { sync: async () => ({ ok: true }), ingestMails: async mails => { seen.push(mails.length); return { ok: false, code: 'ledger_save_failed', mails: mails.length, registered: 0, skipped: 0, unreadable: 0, reference: 0, errors: [] }; } };
    const r = await plainRun(dev.make(g, makeReader(), { syncer: dev.ctx.__syncer }));
    assert.deepEqual(seen, [1]); assert.equal(r.ok, false); assert.equal(r.code, 'ledger_save_failed'); assert.equal(r.stage, 'ingest');
});
test('取り込みは20通ずつに分けてBOXへ渡す(途中で閉じても、済んだ分は残る)', async () => {
    const g = makeGmail(), dev = device(); const sizes = [];
    for (let i = 1; i <= 5; i++) M(g, IDS(i), `依頼${i}.xlsx`, XLSX_MIME, 3000, 'xlsx');
    dev.ctx.__syncer = { ingestMails: async mails => { sizes.push(mails.length); return { ok: true, mails: mails.length, registered: mails.length, skipped: 0, unreadable: 0, reference: 0, duplicates: 0, errors: [] }; } };
    const r = await plainRun(dev.make(g, makeReader(), { syncer: dev.ctx.__syncer, limits: { batchSize: 2 } }));
    assert.deepEqual(sizes, [2, 2, 1]); assert.equal(r.ingest.registered, 5);
});
test('差出人が符号化されたまま(戻せない)のときは、Gmailの検索結果を信じて取り込み、件数だけ数える', async () => {
    const g = makeGmail(), dev = device();
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx', { from: '=?UTF-8?B?!!!?= <a@example.invalid>' });
    const r = await plainRun(dev.make(g, makeReader()));
    assert.equal(r.mails, 1); assert.equal(r.senderUnverified, 1); assert.equal(r.skippedSender, 0);
});
test('同時に2回は走らない(busy)。ソースにトークン保存・コンソール出力・ストレージ書込みが無い', async () => {
    const g = makeGmail(), dev = device();
    M(g, IDS(1), '業務依頼書.xlsx', XLSX_MIME, 3000, 'xlsx');
    const imp = dev.make(g, makeReader());
    const [a, b] = await Promise.all([plainRun(imp), plainRun(imp)]);
    assert.equal([a, b].filter(x => x.code === 'busy').length, 1);
    const src = fs.readFileSync(require.resolve('../map/gmail-import.js'), 'utf8');
    assert.equal(/localStorage|AppStorage|setItem|console\.|token|access_token/i.test(src.replace(/\/\/.*$/gm, '')), false);
});
