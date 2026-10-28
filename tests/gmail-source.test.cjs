// Gmail 取得アダプタ(一覧・1通・添付、制限、失敗の分類、再試行)のテスト。偽のtransportだけを使い、Google/Gmailには接続しない。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const GmailSource = require('../map/gmail-source');

const coded = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const H = (name, value) => ({ name, value });
const part = (partId, mimeType, filename, body, parts) => ({ partId, mimeType, filename, headers: [], body: body || { size: 0 }, ...(parts ? { parts } : {}) });
const attPart = (partId, mimeType, filename, size, attachmentId) => part(partId, mimeType, filename, { size, attachmentId });
function gmailMessage(id, parts, extra = {}) {
    return { id, threadId: id, internalDate: String(Date.parse('2026-10-27T03:30:00Z')), payload: { partId: '', mimeType: 'multipart/mixed', filename: '', headers: [H('From', '"架空 乙川" <otsukawa@example.invalid>'), H('Subject', '業務依頼のお願い'), H('To', 'me@example.invalid')], body: { size: 0 }, parts }, ...extra };
}
const jsonResponse = (body, headers = {}) => ({ ok: true, status: 200, headers: { get: k => headers[String(k).toLowerCase()] ?? null }, json: async () => body });

function fakeTransport(handler) {
    const calls = [];
    return { calls, state: () => ({ connected: true }), request: async (url, options, consume) => { calls.push(url); const r = await handler(new URL(url), calls.length, options); return consume(jsonResponse(r.body, r.headers)); } };
}
const noSleep = () => { const waits = []; const fn = async ms => { waits.push(ms); }; fn.waits = waits; return fn; };

test('検索式: 差出人(OR)+添付あり+newer_than。既読・未読には頼らない。差出人の語は安全な文字だけ', () => {
    const src = GmailSource.create({ transport: fakeTransport(() => ({ body: {} })) });
    assert.equal(src.buildQuery({ terms: ['甲野', '乙川'], days: 62 }), 'has:attachment newer_than:62d from:(甲野 OR 乙川)');
    assert.equal(src.buildQuery({ terms: ['otsukawa@example.invalid'], days: 7 }), 'has:attachment newer_than:7d from:(otsukawa@example.invalid)');
    const q = src.buildQuery({ terms: ['甲野', '乙川'], days: 62 });
    assert.equal(/is:unread|is:read|label:|in:/.test(q), false);
    for (const bad of [[], ['a b'], ['a)', 'b'], ['x OR in:anywhere'], ['"q"'], ['-x'], ['a:b'], ['{x}'], [''], ['a'.repeat(81)], Array(11).fill('abc')]) assert.throws(() => src.buildQuery({ terms: bad, days: 62 }), e => e.code === 'bad_terms', JSON.stringify(bad));
    for (const bad of [0, -1, 400, 1.5, 'x', NaN]) assert.throws(() => src.buildQuery({ terms: ['甲野'], days: bad }), e => e.code === 'bad_days', String(bad));
});
test('一覧: ページを分けて取得し、上限で止める(truncated)。トークンの繰り返しは打ち切る', async () => {
    const pages = { '': { messages: [{ id: 'aaaaaa01' }, { id: 'aaaaaa02' }], nextPageToken: 'T1' }, T1: { messages: [{ id: 'aaaaaa03' }, { id: 'aaaaaa04' }], nextPageToken: 'T2' }, T2: { messages: [{ id: 'aaaaaa05' }] } };
    const t = fakeTransport(u => ({ body: pages[u.searchParams.get('pageToken') || ''] }));
    const src = GmailSource.create({ transport: t });
    const all = await src.listMessageIds({ query: 'has:attachment', maxMessages: 100 });
    assert.deepEqual(all.ids, ['aaaaaa01', 'aaaaaa02', 'aaaaaa03', 'aaaaaa04', 'aaaaaa05']); assert.equal(all.truncated, false); assert.equal(all.pages, 3);
    assert.equal(t.calls.every(u => u.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')), true);
    const first = new URL(t.calls[0]);
    assert.equal(first.searchParams.get('q'), 'has:attachment'); assert.equal(first.searchParams.get('maxResults'), '50'); assert.equal(first.searchParams.has('pageToken'), false);
    const capped = await GmailSource.create({ transport: fakeTransport(u => ({ body: pages[u.searchParams.get('pageToken') || ''] })) }).listMessageIds({ query: 'q', maxMessages: 3 });
    assert.deepEqual(capped.ids, ['aaaaaa01', 'aaaaaa02', 'aaaaaa03']); assert.equal(capped.truncated, true);
    const loop = fakeTransport(() => ({ body: { messages: [{ id: 'aaaaaa01' }], nextPageToken: 'SAME' } }));
    await assert.rejects(() => GmailSource.create({ transport: loop }).listMessageIds({ query: 'q', maxMessages: 500 }), e => e.code === 'bad_response');
    const many = fakeTransport((u, n) => ({ body: { messages: [{ id: 'bbbbbb' + String(n).padStart(2, '0') }], nextPageToken: 'P' + n } }));
    const r = await GmailSource.create({ transport: many, limits: { maxPages: 3 } }).listMessageIds({ query: 'q', maxMessages: 500 });
    assert.equal(r.pages, 3); assert.equal(r.truncated, true);
    const empty = await GmailSource.create({ transport: fakeTransport(() => ({ body: { resultSizeEstimate: 0 } })) }).listMessageIds({ query: 'q', maxMessages: 10 });
    assert.deepEqual(empty, { ids: [], truncated: false, pages: 1 });
});
test('一覧: 想定外の応答(配列でない・IDが不正)は bad_response', async () => {
    for (const body of [{ messages: 'x' }, { messages: [{ id: 5 }] }, { messages: [{ id: 'has space' }] }, null, 'x']) {
        await assert.rejects(() => GmailSource.create({ transport: fakeTransport(() => ({ body })) }).listMessageIds({ query: 'q', maxMessages: 10 }), e => e.code === 'bad_response', JSON.stringify(body));
    }
});
test('1通の取得: 入れ子のパートをたどり、添付だけを partId つきで取り出す。キーは attachmentId ではなく partId 由来', async () => {
    const msg = gmailMessage('18a0b1c2d3e4f5a6', [
        part('0', 'multipart/alternative', '', null, [part('0.0', 'text/plain', '', { size: 5, data: b64url('hello') }), part('0.1', 'text/html', '', { size: 5, data: b64url('<b>') })]),
        attPart('1', 'application/pdf', '業務依頼書.pdf', 1234, 'ATT-ONE'),
        part('2', 'multipart/mixed', '', null, [attPart('2.0', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '一覧.xlsx', 4321, 'ATT-TWO')])
    ]);
    const t = fakeTransport(() => ({ body: msg }));
    const m = await GmailSource.create({ transport: t }).getMessage('18a0b1c2d3e4f5a6');
    assert.equal(new URL(t.calls[0]).pathname, '/gmail/v1/users/me/messages/18a0b1c2d3e4f5a6'); assert.equal(new URL(t.calls[0]).searchParams.get('format'), 'full');
    assert.equal(m.id, '18a0b1c2d3e4f5a6'); assert.equal(m.internalDateMs, Date.parse('2026-10-27T03:30:00Z'));
    assert.equal(m.from, '"架空 乙川" <otsukawa@example.invalid>'); assert.equal(m.subject, '業務依頼のお願い');
    assert.deepEqual(m.attachments.map(a => [a.partKey, a.fileName, a.mimeType, a.size, a.attachmentId]), [
        ['p1', '業務依頼書.pdf', 'application/pdf', 1234, 'ATT-ONE'],
        ['p2.0', '一覧.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4321, 'ATT-TWO']]);
    assert.equal(m.partsTruncated, false);
    assert.equal(JSON.stringify(m).includes('hello'), false);   // 本文は持ち出さない
});
test('1通の取得: 同じ中身で attachmentId だけが変わっても partKey は同じ(実Gmailで attachmentId が毎回変わることを確認済み)', async () => {
    const build = idSuffix => gmailMessage('18a0b1c2d3e4f5a6', [attPart('1', 'application/pdf', 'a.pdf', 10, 'ANGjdJ-' + idSuffix), attPart('2', 'image/jpeg', 'b.jpg', 10, 'ANGjdJ-z' + idSuffix)]);
    const a = await GmailSource.create({ transport: fakeTransport(() => ({ body: build('one') })) }).getMessage('18a0b1c2d3e4f5a6');
    const b = await GmailSource.create({ transport: fakeTransport(() => ({ body: build('two') })) }).getMessage('18a0b1c2d3e4f5a6');
    assert.notDeepEqual(a.attachments.map(x => x.attachmentId), b.attachments.map(x => x.attachmentId));
    assert.deepEqual(a.attachments.map(x => x.partKey), b.attachments.map(x => x.partKey));
});
test('1通の取得: ファイル名の制御文字は除き、長すぎる名前は切る。差出人・件名ヘッダは大文字小文字を問わない', async () => {
    const msg = gmailMessage('18a0b1c2d3e4f5a6', [attPart('1', 'application/pdf', 'a\u0000b\u202e\nc.pdf' + 'x'.repeat(400), 5, 'A')]);
    msg.payload.headers = [H('FROM', 'x@example.invalid'), H('subject', 's')];
    const m = await GmailSource.create({ transport: fakeTransport(() => ({ body: msg })) }).getMessage('18a0b1c2d3e4f5a6');
    assert.equal(/[\u0000-\u001f\u202e]/.test(m.attachments[0].fileName), false);
    assert.equal(m.attachments[0].fileName.length <= 200, true);
    assert.equal(m.from, 'x@example.invalid'); assert.equal(m.subject, 's');
});
test('1通の取得: パートが多すぎる/深すぎるときは partsTruncated(見落としを黙って捨てない)。取り出せる分は返す', async () => {
    const wide = gmailMessage('18a0b1c2d3e4f5a6', Array.from({ length: 40 }, (_, i) => attPart(String(i + 1), 'application/pdf', `f${i}.pdf`, 5, 'A' + i)));
    const m1 = await GmailSource.create({ transport: fakeTransport(() => ({ body: wide })), limits: { maxParts: 10 } }).getMessage('18a0b1c2d3e4f5a6');
    assert.equal(m1.partsTruncated, true); assert.equal(m1.attachments.length <= 10, true);
    let deep = attPart('9', 'application/pdf', 'deep.pdf', 5, 'D');
    for (let i = 0; i < 12; i++) deep = part('1.' + i, 'multipart/mixed', '', null, [deep]);
    const m2 = await GmailSource.create({ transport: fakeTransport(() => ({ body: gmailMessage('18a0b1c2d3e4f5a6', [deep]) })) }).getMessage('18a0b1c2d3e4f5a6');
    assert.equal(m2.partsTruncated, true);
});
test('1通の取得: 想定外の形・IDの食い違いは bad_response。添付の実体が無い名前つきパートは attachmentId を空で返す', async () => {
    for (const body of [null, {}, { id: 'zzz', payload: {} }, gmailMessage('18a0b1c2d3e4f5a7', [])]) {
        await assert.rejects(() => GmailSource.create({ transport: fakeTransport(() => ({ body })) }).getMessage('18a0b1c2d3e4f5a6'), e => e.code === 'bad_response', JSON.stringify(body)?.slice(0, 40));
    }
    await assert.rejects(() => GmailSource.create({ transport: fakeTransport(() => ({ body: {} })) }).getMessage('not hex!'), e => e.code === 'bad_response');
    const m = await GmailSource.create({ transport: fakeTransport(() => ({ body: gmailMessage('18a0b1c2d3e4f5a6', [part('1', 'application/pdf', 'x.pdf', { size: 9 })]) })) }).getMessage('18a0b1c2d3e4f5a6');
    assert.equal(m.attachments[0].attachmentId, '');
});
test('添付の取得: base64url を復号して返す。応答が大きすぎる/復号後が上限超過なら取り込まない', async () => {
    const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xfb, 0xff, 0x00, 0x01]);
    const t = fakeTransport(() => ({ body: { size: bytes.length, data: b64url(bytes) } }));
    const out = await GmailSource.create({ transport: t }).downloadAttachment('18a0b1c2d3e4f5a6', 'ANGjdJ-x_Y', { maxBytes: 1000 });
    assert.deepEqual(Buffer.from(out), bytes);
    assert.equal(new URL(t.calls[0]).pathname, '/gmail/v1/users/me/messages/18a0b1c2d3e4f5a6/attachments/ANGjdJ-x_Y');
    await assert.rejects(() => GmailSource.create({ transport: fakeTransport(() => ({ body: { size: 2000, data: b64url(Buffer.alloc(2000)) } })) }).downloadAttachment('18a0b1c2d3e4f5a6', 'A', { maxBytes: 1000 }), e => e.code === 'too_large');
    await assert.rejects(() => GmailSource.create({ transport: fakeTransport(() => ({ body: { size: 1, data: b64url(Buffer.alloc(10)) }, headers: { 'content-length': '999999' } })) }).downloadAttachment('18a0b1c2d3e4f5a6', 'A', { maxBytes: 1000 }), e => e.code === 'too_large');
    for (const body of [{ size: 1 }, { data: 5 }, { data: '***' }, null]) await assert.rejects(() => GmailSource.create({ transport: fakeTransport(() => ({ body })) }).downloadAttachment('18a0b1c2d3e4f5a6', 'A', { maxBytes: 1000 }), e => e.code === 'bad_response', JSON.stringify(body));
    await assert.rejects(() => GmailSource.create({ transport: fakeTransport(() => ({ body: {} })) }).downloadAttachment('18a0b1c2d3e4f5a6', 'A', {}), e => e.code === 'bad_args');
});
test('再試行: 429 は待ってから(Retry-After 優先・指数バックオフ)最大3回。それでも駄目なら rate_limited。認証・権限エラーは再試行しない', async () => {
    const sleep = noSleep(); let n = 0;
    const t = { calls: [], state: () => ({ connected: true }), request: async (url, o, consume) => { n++; if (n <= 2) throw coded('rate_limited', { status: 429, retryAfterMs: n === 1 ? 5000 : 0 }); return consume(jsonResponse({ messages: [] })); } };
    const r = await GmailSource.create({ transport: t, sleep }).listMessageIds({ query: 'q', maxMessages: 5 });
    assert.deepEqual(r.ids, []); assert.deepEqual(sleep.waits, [5000, 2000]);
    const s2 = noSleep(); let m = 0;
    const always = { state: () => ({ connected: true }), request: async () => { m++; throw coded('rate_limited', { status: 429, retryAfterMs: 0 }); } };
    await assert.rejects(() => GmailSource.create({ transport: always, sleep: s2 }).listMessageIds({ query: 'q', maxMessages: 5 }), e => e.code === 'rate_limited');
    assert.equal(m, 4); assert.deepEqual(s2.waits, [1000, 2000, 4000]);
    for (const code of ['auth_expired', 'forbidden', 'scope_missing', 'api_disabled', 'timeout', 'not_connected', 'aborted', 'bad_url', 'not_found', 'http_error']) {
        let k = 0; const tr = { state: () => ({ connected: true }), request: async () => { k++; throw coded(code, { status: 400 }); } };
        await assert.rejects(() => GmailSource.create({ transport: tr, sleep: noSleep() }).listMessageIds({ query: 'q', maxMessages: 5 }), e => e.code === code, code);
        assert.equal(k, 1, code);
    }
});
test('再試行: 5xx は2回、通信失敗は1回だけ。実行全体の再試行にも上限があり、超えたら諦める', async () => {
    let n = 0; const flaky = { state: () => ({ connected: true }), request: async () => { n++; throw coded('server_error', { status: 503, retryAfterMs: 0 }); } };
    await assert.rejects(() => GmailSource.create({ transport: flaky, sleep: noSleep() }).listMessageIds({ query: 'q', maxMessages: 5 }), e => e.code === 'server_error');
    assert.equal(n, 3);
    n = 0; const net = { state: () => ({ connected: true }), request: async () => { n++; throw coded('network'); } };
    await assert.rejects(() => GmailSource.create({ transport: net, sleep: noSleep() }).listMessageIds({ query: 'q', maxMessages: 5 }), e => e.code === 'network');
    assert.equal(n, 2);
    n = 0; const src = GmailSource.create({ transport: flaky, sleep: noSleep(), limits: { maxRetries: 2 } });
    await assert.rejects(() => src.listMessageIds({ query: 'q', maxMessages: 5 }), e => e.code === 'server_error');
    n = 0;
    await assert.rejects(() => src.listMessageIds({ query: 'q', maxMessages: 5 }), e => e.code === 'server_error');
    assert.equal(n, 1);   // 予算を使い切った後は再試行しない
});
test('待機中に中止(signal)されたら aborted で止まる', async () => {
    const ac = new AbortController();
    const sleepAbort = ms => new Promise((res, rej) => { ac.abort(); rej(coded('aborted')); });
    const tr = { state: () => ({ connected: true }), request: async () => { throw coded('rate_limited', { retryAfterMs: 1000 }); } };
    await assert.rejects(() => GmailSource.create({ transport: tr, sleep: sleepAbort }).listMessageIds({ query: 'q', maxMessages: 5, signal: ac.signal }), e => e.code === 'aborted');
});
test('エラーに Googleの文言・URL・トークン・件名を持ち越さない', async () => {
    const tr = { state: () => ({ connected: true }), request: async () => { throw Object.assign(new Error('Bearer ya29.SECRET https://gmail.googleapis.com/x 業務依頼のお願い'), { code: 'weird', status: 500 }); } };
    await assert.rejects(() => GmailSource.create({ transport: tr, sleep: noSleep() }).getMessage('18a0b1c2d3e4f5a6'), e => e.code === 'network' && !/ya29|googleapis|業務依頼/.test(String(e.message)));
});
test('1通の取得: ヘッダーが RFC 2047 の符号化(=?UTF-8?B?...?= / Q)でも、差出人・件名・ファイル名を読める形に戻す。壊れた符号化はそのまま', async () => {
    const B = s => '=?UTF-8?B?' + Buffer.from(s).toString('base64') + '?=';
    const Q = s => '=?UTF-8?Q?' + [...Buffer.from(s)].map(b => '=' + b.toString(16).toUpperCase().padStart(2, '0')).join('') + '?=';
    const msg = gmailMessage('18a0b1c2d3e4f5a6', [attPart('1', 'application/pdf', B('依頼書.pdf'), 10, 'A1')]);
    msg.payload.headers = [H('FROM', B('架空 乙川') + ' <otsukawa@example.invalid>'), H('subject', B('業務依頼') + ' ' + Q('のお願い')), H('To', 'x@example.invalid')];
    const m = await GmailSource.create({ transport: fakeTransport(() => ({ body: msg })) }).getMessage('18a0b1c2d3e4f5a6');
    assert.equal(m.from, '架空 乙川 <otsukawa@example.invalid>'); assert.equal(m.subject, '業務依頼のお願い'); assert.equal(m.attachments[0].fileName, '依頼書.pdf');
    msg.payload.headers = [H('From', '=?UTF-8?B?!!!?= <a@example.invalid>'), H('Subject', '=?x-unknown-charset?B?AAAA?=')];
    const m2 = await GmailSource.create({ transport: fakeTransport(() => ({ body: msg })) }).getMessage('18a0b1c2d3e4f5a6');
    assert.match(m2.from, /=\?UTF-8\?B\?/); assert.match(m2.subject, /=\?x-unknown/);
});
