// Gmail 通信層(認証+通信先の制限)のテスト。偽のGoogle・偽のfetchだけを使い、実際のGoogle/Gmailには接続しない。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const CLIENT_ID = '123456-abc.apps.googleusercontent.com';
const TOKEN = 'ya29.FAKE-TOKEN-FOR-TEST';
const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

const load = () => {
    const ctx = vm.createContext({ console, setTimeout, clearTimeout, AbortController, URLSearchParams });
    vm.runInContext(fs.readFileSync(require.resolve('../map/gmail-transport.js'), 'utf8') + '\nglobalThis.__GT = GmailTransport;', ctx);
    return ctx.__GT;
};
const GT = load();

function env(opts = {}) {
    const store = new Map(opts.noClientId ? [] : [['culo_google_calendar_client_id', CLIENT_ID]]);
    const fetchCalls = [], listeners = {}, tokenClients = [];
    let nowMs = 1_000_000;
    const response = opts.response || (() => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) }));
    const fakeGoogle = opts.noGoogle ? null : { accounts: { oauth2: {
        initTokenClient: c => { tokenClients.push(c); return { requestAccessToken: () => { if (opts.denyToken) return c.callback({ error: 'access_denied' }); c.callback({ access_token: TOKEN, expires_in: opts.expiresIn || 3600, scope: SCOPE }); } }; },
        hasGrantedAllScopes: () => opts.granted !== false
    } } };
    const t = GT.create({
        storage: { getItem: k => store.has(k) ? store.get(k) : null },
        win: { google: fakeGoogle, addEventListener: (n, f) => { listeners[n] = f; } },
        doc: {},
        fetch: async (url, o) => { fetchCalls.push({ url, o }); return response(url, o); },
        now: () => nowMs,
        timeoutMs: opts.timeoutMs || 60000
    });
    return { t, store, fetchCalls, listeners, tokenClients, tick: ms => { nowMs += ms; } };
}
const jsonRes = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => headers[String(k).toLowerCase()] ?? null }, json: async () => body });
const reasonBody = (...reasons) => ({ error: { code: 403, errors: reasons.map(reason => ({ reason })), message: 'SECRET-MESSAGE' } });

test('スコープは gmail.readonly だけ。接続は他のGoogle許可と混ぜず(include_granted_scopes:false)、接続時に通信しない', async () => {
    assert.equal(GT.SCOPE, SCOPE);
    const e = env();
    const st = await e.t.connect();
    assert.equal(st.connected, true);
    assert.equal(e.tokenClients.length, 1);
    assert.equal(e.tokenClients[0].scope, SCOPE);
    assert.equal(e.tokenClients[0].include_granted_scopes, false);
    assert.equal(e.tokenClients[0].client_id, CLIENT_ID);
    assert.equal(e.fetchCalls.length, 0);
});
test('状態にトークンは含まれない。未接続・クライアントID未設定・Google未読込は通信せず分かる形で断る', async () => {
    const e = env();
    assert.deepEqual(JSON.parse(JSON.stringify(e.t.state())), { connected: false, configured: true });
    await e.t.connect();
    assert.equal(JSON.stringify(e.t.state()).includes('FAKE-TOKEN'), false);
    const noId = env({ noClientId: true });
    assert.equal(noId.t.state().configured, false);
    await assert.rejects(() => noId.t.connect(), x => x.code === 'not_configured');
    const noG = env({ noGoogle: true });
    await assert.rejects(() => noG.t.connect(), x => x.code === 'google_not_ready');
});
test('許可を拒否した・必要な許可が揃っていないときは接続扱いにしない', async () => {
    const e1 = env({ denyToken: true });
    await assert.rejects(() => e1.t.connect(), x => x.code === 'consent_denied');
    assert.equal(e1.t.state().connected, false);
    const e2 = env({ granted: false });
    await assert.rejects(() => e2.t.connect(), x => x.code === 'scope_missing');
    assert.equal(e2.t.state().connected, false);
    await assert.rejects(() => e2.t.request(BASE, {}, r => r.json()), x => x.code === 'not_connected');
    assert.equal(e2.fetchCalls.length, 0);
});
test('未接続のrequestは通信せず not_connected', async () => {
    const e = env();
    await assert.rejects(() => e.t.request(BASE + '?q=x', {}, r => r.json()), x => x.code === 'not_connected');
    assert.equal(e.fetchCalls.length, 0);
});
test('許可するURLだけ通す(gmail.googleapis.com の messages 一覧・1通・添付)。トークンは Authorization だけ、cookie は送らない', async () => {
    const e = env({ response: () => jsonRes(200, { ok: 1 }) });
    await e.t.connect();
    const urls = [BASE + '?q=has%3Aattachment&maxResults=50', BASE + '/18a0b1c2d3e4f5a6?format=full', BASE + '/18a0b1c2d3e4f5a6/attachments/ANGjdJ-abc_DEF123'];
    for (const u of urls) assert.deepEqual(await e.t.request(u, {}, r => r.json()), { ok: 1 });
    assert.equal(e.fetchCalls.length, 3);
    for (const c of e.fetchCalls) {
        assert.equal(c.o.headers.Authorization, 'Bearer ' + TOKEN);
        assert.equal(c.o.credentials, 'omit'); assert.equal(c.o.cache, 'no-store'); assert.equal(c.o.redirect, 'error');
        assert.equal(String(c.o.method || 'GET'), 'GET');
        assert.equal(c.url.includes(TOKEN), false);
    }
});
test('他のホスト・http・別のAPI・書き込み系メソッド・パス操作・認証情報つきURLは通信せずに拒否する', async () => {
    const e = env({ response: () => jsonRes(200, {}) });
    await e.t.connect();
    const bad = [
        'https://evil.example/gmail/v1/users/me/messages', 'http://gmail.googleapis.com/gmail/v1/users/me/messages',
        'https://gmail.googleapis.com.evil.example/gmail/v1/users/me/messages', 'https://user@gmail.googleapis.com/gmail/v1/users/me/messages',
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/abc/modify', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/abc/trash',
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
        'https://gmail.googleapis.com/gmail/v1/users/me/labels', 'https://gmail.googleapis.com/gmail/v1/users/other@example.invalid/messages',
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/../drafts', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/abc/attachments/x/y',
        'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=x#frag', 'https://www.googleapis.com/drive/v3/files', 42, null, undefined
    ];
    for (const u of bad) await assert.rejects(() => e.t.request(u, {}, r => r.json()), x => x.code === 'bad_url', String(u));
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) await assert.rejects(() => e.t.request(BASE, { method }, r => r.json()), x => x.code === 'bad_url', method);
    assert.equal(e.fetchCalls.length, 0);
});
test('401: 接続を破棄して auth_expired。以降は not_connected(トークンを使い回さない)', async () => {
    const e = env({ response: () => jsonRes(401, { error: { message: 'SECRET-MESSAGE' } }) });
    await e.t.connect();
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'auth_expired' && !String(x.message).includes('SECRET') && !String(x.message).includes(TOKEN));
    assert.equal(e.t.state().connected, false);
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'not_connected');
    assert.equal(e.fetchCalls.length, 1);
});
test('403 は理由で分ける: 利用回数の上限=rate_limited / API未有効=api_disabled / 許可不足=scope_missing / その他=forbidden。本文のメッセージは持ち越さない', async () => {
    const cases = [
        [reasonBody('rateLimitExceeded'), 'rate_limited'], [reasonBody('userRateLimitExceeded'), 'rate_limited'], [reasonBody('dailyLimitExceeded'), 'rate_limited'],
        [reasonBody('accessNotConfigured'), 'api_disabled'], [{ error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }] } }, 'api_disabled'],
        [reasonBody('insufficientPermissions'), 'scope_missing'], [{ error: { status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }, 'scope_missing'],
        [reasonBody('domainPolicy'), 'forbidden'], [reasonBody('weird'), 'forbidden'], [null, 'forbidden']
    ];
    for (const [body, code] of cases) {
        const e = env({ response: () => body === null ? { ok: false, status: 403, headers: { get: () => null }, json: async () => { throw new Error('no json'); } } : jsonRes(403, body) });
        await e.t.connect();
        await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === code && !String(x.message).includes('SECRET') && x.status === 403, code);
        assert.equal(e.t.state().connected, code === 'rate_limited' || code === 'forbidden' || code === 'api_disabled' || code === 'scope_missing');   // 403では接続は切らない
    }
});
test('429: rate_limited と retryAfterMs(Retry-After秒を上限30秒でミリ秒に)。5xx は server_error、404 は not_found、400 は http_error(statusつき)', async () => {
    const mk = (status, headers) => env({ response: () => jsonRes(status, {}, headers) });
    let e = mk(429, { 'retry-after': '7' }); await e.t.connect();
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'rate_limited' && x.retryAfterMs === 7000 && x.status === 429);
    e = mk(429, { 'retry-after': '99999' }); await e.t.connect();
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'rate_limited' && x.retryAfterMs === 30000);
    e = mk(429, {}); await e.t.connect();
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'rate_limited' && x.retryAfterMs === 0);
    for (const s of [500, 502, 503, 504]) { e = mk(s); await e.t.connect(); await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'server_error' && x.status === s); }
    e = mk(404); await e.t.connect();
    await assert.rejects(() => e.t.request(BASE + '/18a0b1c2d3e4f5a6', {}, r => r.json()), x => x.code === 'not_found');
    e = mk(400); await e.t.connect();
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'http_error' && x.status === 400);
});
test('通信そのものの失敗は network。トークンやURLを文言に入れない', async () => {
    const e = env({ response: () => { throw new TypeError('Failed to fetch ' + BASE + ' ' + TOKEN); } });
    await e.t.connect();
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'network' && !String(x.message).includes(TOKEN) && !String(x.message).includes('googleapis'));
});
test('タイムアウトは timeout、呼び出し側の中止(signal)は aborted', async () => {
    const slow = (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
    const e = env({ response: slow, timeoutMs: 20 });
    await e.t.connect();
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'timeout');
    const e2 = env({ response: slow });
    await e2.t.connect();
    const ac = new AbortController();
    const p = e2.t.request(BASE, { signal: ac.signal }, r => r.json());
    ac.abort();
    await assert.rejects(() => p, x => x.code === 'aborted');
    const pre = new AbortController(); pre.abort();
    await assert.rejects(() => e2.t.request(BASE, { signal: pre.signal }, r => r.json()), x => x.code === 'aborted');
});
test('トークンは期限で失効し(安全のため60秒手前)、ページを離れる・切断するとメモリから消える', async () => {
    const e = env({ response: () => jsonRes(200, {}), expiresIn: 3600 });
    await e.t.connect();
    e.tick((3600 - 60) * 1000 + 1);
    assert.equal(e.t.state().connected, false);
    await assert.rejects(() => e.t.request(BASE, {}, r => r.json()), x => x.code === 'not_connected');
    const e2 = env({ response: () => jsonRes(200, {}) });
    await e2.t.connect();
    assert.equal(typeof e2.listeners.pagehide, 'function');
    e2.listeners.pagehide();
    assert.equal(e2.t.state().connected, false);
    await e2.t.connect(); e2.t.disconnect();
    await assert.rejects(() => e2.t.request(BASE, {}, r => r.json()), x => x.code === 'not_connected');
});
test('クライアントIDを変えたら接続は無効になる', async () => {
    const e = env({ response: () => jsonRes(200, {}) });
    await e.t.connect();
    e.store.set('culo_google_calendar_client_id', '999-zzz.apps.googleusercontent.com');
    assert.equal(e.t.state().connected, false);
});
test('ソースにトークン・秘密を保存する処理(localStorage/AppStorage.setItem/document.cookie)が無い', () => {
    const src = fs.readFileSync(require.resolve('../map/gmail-transport.js'), 'utf8');
    assert.equal(/setItem|localStorage|sessionStorage|indexedDB|document\.cookie|console\./.test(src), false);
});
