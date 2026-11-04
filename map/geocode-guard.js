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
    function borrowedMapsKey() { return ''; } // 本番では他の保存領域のキーを借りない
    // 住所の言い換え候補（見つからないときに順に試す）。全角→半角、郵便番号・かっこ書き・建物名の後ろを外す
    function addressVariants(address) {
        const raw = String(address || '').trim();
        if (!raw) return [];
        const out = [];
        const add = v => { v = v.replace(/\s+/g, ' ').trim(); if (v && !out.includes(v)) out.push(v); };
        add(raw);
        let n = raw.normalize('NFKC').replace(/[‐－―ー−]/g, m => m === 'ー' ? m : '-');
        n = n.replace(/〒?\s*\d{3}-?\d{4}\s*/, ' ');
        add(n);
        n = n.split(/[\r\n]/)[0].replace(/[(（][^)）]*[)）]/g, ' ');
        // 丁目・番・号を「-」に（5丁目1番18号 → 5-1-18）
        n = n.replace(/(\d+)丁目\s*(\d+)(?:番地?|-)\s*(\d+)号?/g, '$1-$2-$3').replace(/(\d+)丁目\s*(\d+)番地?/g, '$1-$2');
        // 階・F・号室・部屋番号を外す（依頼書は「…5-1-18 3階」のように書いてくることがある）
        const noFloor = n.replace(/\s*(?:地下|B)?\d+\s*(?:階|F|Ｆ)(?![a-zA-Z]).*$/i, ' ')
            .replace(/\s*\d+\s*号室.*$/, ' ').replace(/\s*#\d+.*$/, ' ');
        add(noFloor);
        add(n);
        // 番地(数字-数字…)の後ろの建物名・階数を外す
        const m = n.match(/^(.*?\d+(?:-\d+){1,3})(?=\D|$)/);
        if (m) add(m[1]);
        // 階数・部屋番号を外したものを最初に試す（そのままだと別の場所や見つからないことがある）
        const fl = out.indexOf(noFloor.replace(/\s+/g, ' ').trim());
        if (fl > 0) out.unshift(out.splice(fl, 1)[0]);
        return out;
    }
    return Object.freeze({ create, borrowedMapsKey, addressVariants, NOTICE });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GeocodeGuard;
