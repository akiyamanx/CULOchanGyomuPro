// 台帳の実Driveアダプタ(map/mail-ledger-drive.js)と、Drive接続の追加口(DriveTransfer.appdataRequest)のテスト。
// 本物のGoogleには接続しない。「どんなURL・メソッド・本文を送るか」を偽のtransport/fetchで確かめるだけ(実機での動作は未確認)。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Adapter = require('../map/mail-ledger-drive');

const ID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const CH = 'gyomupro-main';

function fakeTransport(handler, connected = true) {
    const calls = [];
    return {
        calls,
        state: () => ({ connected }),
        appdataRequest: async (url, options = {}, consume = async r => r) => {
            calls.push({ url, options });
            const res = await handler(url, options, calls.length);
            return consume(res);
        }
    };
}
const jsonRes = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const textRes = text => ({ ok: true, status: 200, text: async () => text });

test('一覧: appDataFolderのみ・アプリ印と共有先名で絞り込み、安全な項目だけ返す(ページ送りあり)', async () => {
    const pages = [
        { files: [{ id: 'f1', name: 'x', size: '120', appProperties: { app: 'CULOchanMailLedger1', channel: CH, deviceId: ID_A, savedAt: '2026-10-28T03:00:00.000Z' } }, { id: '../evil', size: '1', appProperties: { deviceId: ID_A } }, { id: 'f2', size: '5', appProperties: { deviceId: 'not-a-uuid' } }], nextPageToken: 'tok1' },
        { files: [{ id: 'f3', size: '7', appProperties: { app: 'CULOchanMailLedger1', channel: CH, deviceId: 'bbbbbbbb-0000-4000-8000-000000000002', savedAt: '2026-10-28T04:00:00.000Z' } }] }
    ];
    const t = fakeTransport((url, o, n) => jsonRes(pages[n - 1]));
    const a = Adapter.create({ transport: t, channel: CH });
    assert.deepEqual(a.available(), { connected: true });
    const list = await a.list();
    assert.deepEqual(list.map(f => f.id), ['f1', 'f3']);
    assert.equal(list[0].size, 120); assert.equal(list[0].deviceId, ID_A);
    assert.equal(t.calls.length, 2);
    for (const c of t.calls) {
        assert.ok(c.url.startsWith('https://www.googleapis.com/drive/v3/files?'));
        const q = new URL(c.url).searchParams;
        assert.equal(q.get('spaces'), 'appDataFolder');
        assert.ok(q.get('q').includes("key='app' and value='CULOchanMailLedger1'")); assert.ok(q.get('q').includes("value='" + CH + "'")); assert.ok(q.get('q').includes('trashed = false'));
        assert.ok(!(c.options.method) || c.options.method === 'GET');
    }
    assert.equal(new URL(t.calls[1].url).searchParams.get('pageToken'), 'tok1');
});
test('一覧: ページ送りが終わらなくても上限で止まる', async () => {
    const t = fakeTransport(() => jsonRes({ files: [], nextPageToken: 'again' }));
    const list = await Adapter.create({ transport: t, channel: CH }).list();
    assert.deepEqual(list, []); assert.ok(t.calls.length <= 10);
});
test('読み取り: files/<id>?alt=media だけ。IDの形・大きさを確認し、大きすぎる本文は読まない', async () => {
    const t = fakeTransport(() => textRes('{"ok":1}'));
    const a = Adapter.create({ transport: t, channel: CH });
    assert.equal(await a.read({ id: 'abc_DEF-123', size: 8 }), '{"ok":1}');
    assert.equal(t.calls[0].url, 'https://www.googleapis.com/drive/v3/files/abc_DEF-123?alt=media');
    await assert.rejects(() => a.read({ id: '../x?y', size: 1 }), e => e.code === 'bad_response');
    await assert.rejects(() => a.read({ id: 'ok', size: 600 * 1024 }), e => e.code === 'too_large');
    const big = Adapter.create({ transport: fakeTransport(() => textRes('x'.repeat(600 * 1024))), channel: CH });
    await assert.rejects(() => big.read({ id: 'ok', size: 10 }), e => e.code === 'too_large');
});
test('新規作成: POST multipart。親は appDataFolder。印(app/channel/deviceId/savedAt)と名前に端末IDだけ', async () => {
    const t = fakeTransport(() => jsonRes({ id: 'newfile' }));
    const a = Adapter.create({ transport: t, channel: CH });
    const text = JSON.stringify({ app: 'CULOchanMailLedger1', v: 1, deviceId: ID_A, entries: {} });
    const res = await a.write({ fileId: null, deviceId: ID_A, text, savedAt: '2026-10-28T03:00:00.000Z' });
    assert.deepEqual(res, { id: 'newfile' });
    const c = t.calls[0];
    assert.equal(c.options.method, 'POST');
    assert.ok(c.url.startsWith('https://www.googleapis.com/upload/drive/v3/files?'));
    assert.equal(new URL(c.url).searchParams.get('uploadType'), 'multipart');
    const m = /^multipart\/related; boundary=([\w-]+)$/.exec(c.options.headers['Content-Type']);
    assert.ok(m);
    const parts = c.options.body.split('--' + m[1]);
    assert.equal(parts[0], ''); assert.ok(parts[3].startsWith('--'));   // 開始 / メタデータ / 本文 / 終端
    const meta = JSON.parse(parts[1].split('\r\n\r\n')[1].replace(/\r\n$/, ''));
    assert.deepEqual(meta.parents, ['appDataFolder']);
    assert.equal(meta.name, 'CULOchan-mail-ledger-' + ID_A + '.json');
    assert.deepEqual(meta.appProperties, { app: 'CULOchanMailLedger1', channel: CH, deviceId: ID_A, savedAt: '2026-10-28T03:00:00.000Z' });
    assert.equal(parts[2].split('\r\n\r\n')[1].replace(/\r\n$/, ''), text);
    for (const [k, v] of Object.entries(meta.appProperties)) assert.ok(Buffer.byteLength(k + v) <= 124, k);   // Drive の appProperties 上限
});
test('更新: PATCH multipart で既存ファイルを更新。親(parents)は送らない', async () => {
    const t = fakeTransport(() => jsonRes({ id: 'file9' }));
    const a = Adapter.create({ transport: t, channel: CH });
    await a.write({ fileId: 'file9', deviceId: ID_A, text: '{}', savedAt: '2026-10-28T03:00:00.000Z' });
    const c = t.calls[0];
    assert.equal(c.options.method, 'PATCH');
    assert.ok(c.url.startsWith('https://www.googleapis.com/upload/drive/v3/files/file9?'));
    assert.equal(c.options.body.includes('parents'), false);
    assert.equal(c.options.body.includes('appDataFolder'), false);
});
test('書き込み前の入力確認: 端末ID・時刻・ファイルIDの形が不正なら送らない。本文が大きすぎても送らない', async () => {
    const t = fakeTransport(() => jsonRes({ id: 'x' }));
    const a = Adapter.create({ transport: t, channel: CH });
    for (const bad of [{ fileId: null, deviceId: 'nope', text: '{}', savedAt: '2026-10-28T03:00:00.000Z' }, { fileId: null, deviceId: ID_A, text: '{}', savedAt: 'x y' }, { fileId: '../a', deviceId: ID_A, text: '{}', savedAt: '2026-10-28T03:00:00.000Z' }, { fileId: null, deviceId: ID_A, text: 'x'.repeat(600 * 1024), savedAt: '2026-10-28T03:00:00.000Z' }]) {
        await assert.rejects(() => a.write(bad));
    }
    assert.equal(t.calls.length, 0);
    const t2 = fakeTransport(() => jsonRes({ nope: 1 }));
    await assert.rejects(() => Adapter.create({ transport: t2, channel: CH }).write({ fileId: null, deviceId: ID_A, text: '{}', savedAt: '2026-10-28T03:00:00.000Z' }), e => e.code === 'bad_response');
});
test('通信層のエラーコードをそのまま引き継ぎ、不明なものは network にする。メッセージは持ち越さない', async () => {
    const mk = code => fakeTransport(() => { throw Object.assign(new Error('Googleの許可が切れました(秘密の文言)'), code ? { code } : {}); });
    for (const [given, want] of [['auth_expired', 'auth_expired'], ['forbidden', 'forbidden'], ['not_connected', 'not_connected'], ['timeout', 'timeout'], ['http_error', 'http_error'], [null, 'network'], ['weird', 'network']]) {
        await assert.rejects(() => Adapter.create({ transport: mk(given), channel: CH }).list(), e => e.code === want && !String(e.message).includes('秘密'));
    }
});
test('未接続のときは available が false(通信しない)', async () => {
    const t = fakeTransport(() => jsonRes({}), false);
    assert.deepEqual(Adapter.create({ transport: t, channel: CH }).available(), { connected: false });
    assert.equal(t.calls.length, 0);
});

// ---------- DriveTransfer.appdataRequest(接続の追加口。このアプリのドライブAPI以外へは出さない) ----------
function driveTransferEnv(fetchImpl) {
    const store = new Map([['culo_google_calendar_client_id', '123456-abc.apps.googleusercontent.com']]);
    const fetchCalls = [];
    let cb;
    const ctx = vm.createContext({
        console, setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; }, clearTimeout, AbortController, URLSearchParams, crypto: require('node:crypto').webcrypto, Blob,
        AppStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) },
        BackupStore: { channel: CH }, BackupFormat: { limit: 64 * 1024 * 1024 },
        fetch: async (url, o) => { fetchCalls.push({ url, o }); return fetchImpl(url, o); }
    });
    ctx.google = { accounts: { oauth2: { initTokenClient: c => { cb = c.callback; return { requestAccessToken: () => cb({ access_token: 'test-token', expires_in: 3600 }) }; }, hasGrantedAllScopes: () => true } } };
    ctx.window = { addEventListener() {}, google: { accounts: { oauth2: { initTokenClient: c => { cb = c.callback; return { requestAccessToken: () => cb({ access_token: 'test-token', expires_in: 3600 }) }; }, hasGrantedAllScopes: () => true } } } };
    ctx.document = {};
    vm.runInContext(fs.readFileSync(require.resolve('../shared/drive-transfer.js'), 'utf8') + '\nglobalThis.__DT = DriveTransfer;', ctx);
    return { DT: ctx.__DT, fetchCalls };
}
const okAbout = () => ({ ok: true, status: 200, json: async () => ({ user: { permissionId: 'p1', emailAddress: 'user@example.invalid' } }) });

test('appdataRequest: 許可するURL(googleapis.comのdrive/v3/files系)だけ通し、トークンは Authorization に付ける', async () => {
    const { DT, fetchCalls } = driveTransferEnv(url => url.includes('/about') ? okAbout() : { ok: true, status: 200, json: async () => ({ files: [] }) });
    await DT.connect();
    fetchCalls.length = 0;
    const r = await DT.appdataRequest('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder', {}, res => res.json());
    assert.deepEqual(JSON.parse(JSON.stringify(r)), { files: [] });
    assert.equal(fetchCalls[0].o.headers.Authorization, 'Bearer test-token');
    assert.equal(fetchCalls[0].o.credentials, 'omit');
    await DT.appdataRequest('https://www.googleapis.com/upload/drive/v3/files/abc-1?uploadType=multipart', { method: 'PATCH', body: 'x' }, res => res.json());
    assert.equal(fetchCalls.length, 2);
});
test('appdataRequest: 他のホスト・http・別のAPI・DELETEなどは通信せずに拒否する', async () => {
    const { DT, fetchCalls } = driveTransferEnv(url => url.includes('/about') ? okAbout() : { ok: true, status: 200, json: async () => ({}) });
    await DT.connect();
    fetchCalls.length = 0;
    for (const url of ['https://evil.example/drive/v3/files', 'http://www.googleapis.com/drive/v3/files', 'https://www.googleapis.com.evil.example/drive/v3/files', 'https://www.googleapis.com/drive/v3/about', 'https://www.googleapis.com/drive/v3/files/abc/permissions', 'https://www.googleapis.com/drive/v3/files/../about', 'https://user@www.googleapis.com/drive/v3/files', 42, null]) {
        await assert.rejects(() => DT.appdataRequest(url), e => e.code === 'bad_url', String(url));
    }
    await assert.rejects(() => DT.appdataRequest('https://www.googleapis.com/drive/v3/files/abc', { method: 'DELETE' }), e => e.code === 'bad_url');
    assert.equal(fetchCalls.length, 0);
});
test('appdataRequest: 未接続・401・403・その他のエラーにコードが付く(401は接続を切る)', async () => {
    let status = 200;
    const { DT } = driveTransferEnv(url => url.includes('/about') ? okAbout() : { ok: status === 200, status, json: async () => ({}) });
    await assert.rejects(() => DT.appdataRequest('https://www.googleapis.com/drive/v3/files'), e => e.code === 'not_connected');
    await DT.connect();
    status = 403; await assert.rejects(() => DT.appdataRequest('https://www.googleapis.com/drive/v3/files'), e => e.code === 'forbidden');
    status = 500; await assert.rejects(() => DT.appdataRequest('https://www.googleapis.com/drive/v3/files'), e => e.code === 'http_error');
    status = 401; await assert.rejects(() => DT.appdataRequest('https://www.googleapis.com/drive/v3/files'), e => e.code === 'auth_expired');
    assert.equal(DT.state().connected, false);
});
test('台帳ファイルはバックアップ送信(CULOchanTransfer1)の一覧・履歴に混ざらない(app印が別)', () => {
    const src = fs.readFileSync(require.resolve('../shared/drive-transfer.js'), 'utf8');
    assert.ok(src.includes("value='CULOchanTransfer1'"));
    assert.ok(!src.includes('CULOchanMailLedger1'));
    assert.notEqual('CULOchanMailLedger1', 'CULOchanTransfer1');
});
