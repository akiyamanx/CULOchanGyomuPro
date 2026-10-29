// 地図(Google Maps)が使えないときに、住所→位置の変換(ジオコーディング)で画面が固まらないようにする見張り役。
// ・1件ごとに時間切れ(既定8秒)。Mapsのキーが無効だと geocode の返事が永遠に来ないことがある。
// ・地図の認証失敗(gm_authFailure)が起きたら、残りは待たずに飛ばす。取り込んだデータはそのまま残る。
// ・お試し版だけ、本番の地図キーを「読むだけ」借りられる(書き込みはしない)。
const GeocodeGuard = (() => {
    const NOTICE = '地図を読み込めないため(地図のキーが未設定か無効)、地図の位置は後で付けます。取り込んだデータはそのまま残っています。';
    const KEY_RE = /^[A-Za-z0-9_-]{20,64}$/;
    function create({ timeoutMs = 8000 } = {}) {
        let reason = '';
        const waiters = new Set();
        function markFailed(why) {
            reason = reason || String(why || 'failed');
            for (const w of waiters) w();
            waiters.clear();
        }
        function run(task) {
            if (reason) return Promise.resolve(null);
            return new Promise(resolve => {
                let done = false;
                const finish = v => { if (done) return; done = true; clearTimeout(timer); waiters.delete(stop); resolve(v); };
                const stop = () => finish(null);
                const timer = setTimeout(stop, timeoutMs);
                waiters.add(stop);
                let p;
                try { p = Promise.resolve(task()); } catch (e) { finish(null); return; }
                p.then(v => finish(v == null ? null : v), () => finish(null));
            });
        }
        return { run, markFailed, failed: () => reason };
    }
    function borrowedMapsKey(profile, ls) {
        if (!profile || !profile.staging || !ls) return '';
        try {
            const raw = ls.getItem('mm_settings');
            const key = raw ? String((JSON.parse(raw) || {}).apiKey || '') : '';
            return KEY_RE.test(key) ? key : '';
        } catch (e) { return ''; }
    }
    return Object.freeze({ create, borrowedMapsKey, NOTICE });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GeocodeGuard;
