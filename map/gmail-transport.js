// [Gmail 通信層] Google への接続(gmail.readonly のみ)と、Gmail API v1 への「読み取りだけ」の通信。仕様書 §20。
//   ・トークンはこの関数の中(メモリ)にだけ置く。保存しない・ログに出さない・外へ渡さない。ページを離れる/切断/期限で消える。
//   ・Drive の接続とは別のトークン(include_granted_scopes:false)。クライアントIDは Drive/カレンダーと同じ設定を使う。
//   ・通信先は gmail.googleapis.com/gmail/v1/users/me/messages 系の GET だけ(送信・削除・ラベル変更などは通信前に拒否)。
//   ・失敗は Error に .code(と .status/.retryAfterMs)だけを付ける。Googleの文言・URL・トークンは持ち越さない。
//   ※ 実際のGoogleに対する動作は未確認(テストは偽のGoogle/fetchで、形だけ確認)。
const GmailTransport = (() => {
    const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
    const CLIENT_KEY = 'culo_google_calendar_client_id';
    const CLIENT_RE = /^\d+-[\w-]+\.apps\.googleusercontent\.com$/;
    // GET だけ・自分(me)のメール一覧/1通/添付だけ。パス中の「.」「..」や余計な区切りは通らない文字集合にしてある。
    const URL_RE = /^https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages(\/[0-9a-f]{6,32}(\/attachments\/[A-Za-z0-9_-]{1,4096})?)?(\?[^#\s]*)?$/;
    const RATE = ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded'];
    const DISABLED = ['accessNotConfigured', 'SERVICE_DISABLED'];
    const SCOPE_LACK = ['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'];
    const MAX_RETRY_AFTER_MS = 30000;

    const coded = (code, extra) => Object.assign(new Error(code), { code }, extra || {});

    function create(opts = {}) {
        const win = opts.win || (typeof window !== 'undefined' ? window : {});
        const doc = opts.doc || (typeof document !== 'undefined' ? document : null);
        const storage = opts.storage || (typeof AppStorage !== 'undefined' ? AppStorage : { getItem: () => null });
        const doFetch = opts.fetch || ((...a) => fetch(...a));
        const now = opts.now || (() => Date.now());
        const timeoutMs = opts.timeoutMs || 60000;
        let token = '', expiry = 0, clientId = '', generation = 0, preparing = null;
        const inflight = new Set();
        const configured = () => String(storage.getItem(CLIENT_KEY) || '');

        function disconnect() { generation++; token = ''; expiry = 0; inflight.forEach(c => c.abort()); inflight.clear(); }
        function alive() { return !!token && now() < expiry && clientId === configured(); }
        function state() {
            if (token && !alive()) disconnect();
            return { connected: !!token, configured: CLIENT_RE.test(configured()) };
        }
        function prepare() {
            if (win.google && win.google.accounts && win.google.accounts.oauth2) return Promise.resolve();
            if (!doc || typeof doc.createElement !== 'function') return Promise.reject(coded('google_not_ready'));
            if (!preparing) preparing = new Promise((resolve, reject) => {
                const script = doc.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
                const timer = setTimeout(() => { preparing = null; reject(coded('google_not_ready')); }, 15000);
                script.onload = () => { clearTimeout(timer); resolve(); };
                script.onerror = () => { clearTimeout(timer); preparing = null; reject(coded('google_not_ready')); };
                doc.head.appendChild(script);
            });
            return preparing;
        }
        function connect() {
            const id = configured();
            if (!CLIENT_RE.test(id)) return Promise.reject(coded('not_configured'));
            const g = win.google && win.google.accounts && win.google.accounts.oauth2;
            if (!g) { prepare().catch(() => {}); return Promise.reject(coded('google_not_ready')); }
            disconnect(); clientId = id; const own = generation;
            return new Promise((resolve, reject) => {
                let finished = false;
                const end = error => { if (finished) return; finished = true; clearTimeout(timer); error ? reject(error) : resolve(state()); };
                const timer = setTimeout(() => { if (own === generation) disconnect(); end(coded('consent_timeout')); }, 120000);
                if (timer.unref) timer.unref();
                let client;
                try {
                    client = g.initTokenClient({
                        client_id: id, scope: SCOPE, include_granted_scopes: false,
                        callback: response => {
                            if (finished) return;
                            if (own !== generation) return end(coded('aborted'));
                            if (!response || response.error || !response.access_token) return end(coded('consent_denied'));
                            if (!g.hasGrantedAllScopes(response, SCOPE)) return end(coded('scope_missing'));
                            token = response.access_token; expiry = now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
                            end();
                        },
                        error_callback: () => end(coded('consent_denied'))
                    });
                    client.requestAccessToken({ prompt: '' });
                } catch (e) { end(coded('consent_denied')); }
            });
        }
        function classify403(body) {
            const reasons = [];
            const err = body && body.error;
            if (err && Array.isArray(err.errors)) err.errors.forEach(x => x && typeof x.reason === 'string' && reasons.push(x.reason));
            if (err && Array.isArray(err.details)) err.details.forEach(x => x && typeof x.reason === 'string' && reasons.push(x.reason));
            if (reasons.some(r => RATE.indexOf(r) >= 0)) return 'rate_limited';
            if (reasons.some(r => DISABLED.indexOf(r) >= 0)) return 'api_disabled';
            if (reasons.some(r => SCOPE_LACK.indexOf(r) >= 0)) return 'scope_missing';
            return 'forbidden';
        }
        const retryAfter = response => {
            const raw = response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null;
            const sec = Number(raw);
            return Number.isFinite(sec) && sec > 0 ? Math.min(MAX_RETRY_AFTER_MS, Math.round(sec * 1000)) : 0;
        };
        async function request(url, options = {}, consume = async r => r) {
            const method = String(options.method || 'GET').toUpperCase();
            if (typeof url !== 'string' || !URL_RE.test(url) || method !== 'GET') throw coded('bad_url');
            if (!alive()) { disconnect(); throw coded('not_connected'); }
            const outer = options.signal;
            if (outer && outer.aborted) throw coded('aborted');
            const own = generation, controller = new AbortController(); inflight.add(controller);
            let timedOut = false, callerAborted = false;
            const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
            if (timer.unref) timer.unref();
            const onAbort = () => { callerAborted = true; controller.abort(); };
            if (outer) outer.addEventListener('abort', onAbort, { once: true });
            try {
                const response = await doFetch(url, { method: 'GET', signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
                if (own !== generation) throw coded('aborted');
                const status = response.status;
                if (status === 401) { disconnect(); throw coded('auth_expired', { status }); }
                if (!response.ok) {
                    if (status === 403) {
                        let body = null; try { body = await response.json(); } catch (e) { body = null; }
                        const code = classify403(body);
                        throw coded(code, { status, retryAfterMs: code === 'rate_limited' ? retryAfter(response) : 0 });
                    }
                    if (status === 429) throw coded('rate_limited', { status, retryAfterMs: retryAfter(response) });
                    if (status === 404) throw coded('not_found', { status });
                    if (status >= 500) throw coded('server_error', { status, retryAfterMs: retryAfter(response) });
                    throw coded('http_error', { status });
                }
                const result = await consume(response);
                if (own !== generation) throw coded('aborted');
                return result;
            } catch (error) {
                if (error && typeof error.code === 'string' && /^[a-z_]{1,40}$/.test(error.code) && error instanceof Error && error.message === error.code) throw error;
                if (error && error.name === 'AbortError') throw coded(timedOut ? 'timeout' : 'aborted');
                if (callerAborted) throw coded('aborted');
                throw coded('network');
            } finally { clearTimeout(timer); inflight.delete(controller); if (outer) outer.removeEventListener('abort', onAbort); }
        }
        if (typeof win.addEventListener === 'function') win.addEventListener('pagehide', disconnect);
        return { prepare, connect, disconnect, state, request };
    }
    return { create, SCOPE, URL_RE };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GmailTransport;
