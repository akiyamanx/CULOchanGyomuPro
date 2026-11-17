// Gmail読み取りと Drive(アプリ専用領域)を、1回の許可操作でつなぐ。
// トークンはメモリだけ(ここにも保存しない)。呼び出し側へは可否だけ返し、トークンは acceptToken 経由で渡す。
// ※ 実際のGoogleに対する動作はテストでは偽のGISで確認する。
const GoogleConnect = (() => {
    const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
    const DRIVE = 'https://www.googleapis.com/auth/drive.appdata';
    const CLIENT_KEY = 'culo_google_calendar_client_id';
    const CLIENT_RE = /^\d+-[\w-]+\.apps\.googleusercontent\.com$/;
    const coded = (code, extra) => Object.assign(new Error(code), { code }, extra || {});

    function create(opts = {}) {
        const win = opts.win || (typeof window !== 'undefined' ? window : {});
        const storage = opts.storage || (typeof AppStorage !== 'undefined' ? AppStorage : { getItem: () => null });
        const now = opts.now || (() => Date.now());
        const configured = () => String(storage.getItem(CLIENT_KEY) || '');
        function oauth() { return win.google && win.google.accounts && win.google.accounts.oauth2; }
        function prepare() {
            if (typeof opts.prepare === 'function') return opts.prepare();
            if (typeof GmailTransport !== 'undefined' && GmailTransport.create) { /* 既存の読込に任せる */ }
            if (oauth()) return Promise.resolve();
            if (typeof DriveTransfer !== 'undefined' && DriveTransfer.prepare) return DriveTransfer.prepare();
            return Promise.reject(coded('google_not_ready'));
        }
        function requestToken(scopeList, prompt) {
            const id = configured();
            if (!CLIENT_RE.test(id)) return Promise.reject(coded('not_configured'));
            const g = oauth();
            if (!g) { prepare().catch(() => {}); return Promise.reject(coded('google_not_ready')); }
            const scope = scopeList.join(' ');
            return new Promise((resolve, reject) => {
                let finished = false;
                const end = (err, value) => { if (finished) return; finished = true; clearTimeout(timer); err ? reject(err) : resolve(value); };
                const timer = setTimeout(() => end(coded('consent_timeout')), 120000);
                if (timer.unref) timer.unref();
                try {
                    const client = g.initTokenClient({
                        client_id: id, scope, include_granted_scopes: false,
                        callback: response => {
                            if (!response || response.error || !response.access_token) return end(coded('consent_denied'));
                            const granted = {};
                            for (const s of scopeList) granted[s] = !!(g.hasGrantedAllScopes && g.hasGrantedAllScopes(response, s));
                            end(null, { response, granted });
                        },
                        error_callback: () => end(coded('consent_denied'))
                    });
                    client.requestAccessToken({ prompt: prompt == null ? 'select_account' : prompt });
                } catch (e) { end(coded('consent_denied')); }
            });
        }
        async function apply(result, targets) {
            const gmailGranted = !!result.granted[GMAIL];
            const driveGranted = !!result.granted[DRIVE];
            let gmail = false, drive = false;
            if (gmailGranted && targets.gmail && typeof targets.gmail.acceptToken === 'function') {
                try {
                    const r = targets.gmail.acceptToken(result.response, { scope: GMAIL });
                    const v = r && typeof r.then === 'function' ? await r : r;
                    gmail = !(v && v.ok === false);
                } catch (e) { gmail = false; }
            } else if (gmailGranted) gmail = true;
            if (driveGranted && targets.drive && typeof targets.drive.acceptToken === 'function') {
                try {
                    const r = targets.drive.acceptToken(result.response, { scope: DRIVE });
                    if (r && typeof r.then === 'function') await r;
                    drive = true;
                } catch (e) { drive = false; }
            } else if (driveGranted) drive = true;
            return { gmail, drive, gmailGranted, driveGranted };
        }
        async function connectBoth(targets, prompt) {
            const result = await requestToken([GMAIL, DRIVE], prompt);
            if (!result.granted[GMAIL] && !result.granted[DRIVE]) throw coded('scope_missing');
            return apply(result, targets || {});
        }
        return { prepare, requestToken, connectBoth, GMAIL, DRIVE };
    }
    return { create, GMAIL_SCOPE: 'https://www.googleapis.com/auth/gmail.readonly', DRIVE_SCOPE: 'https://www.googleapis.com/auth/drive.appdata' };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GoogleConnect;
