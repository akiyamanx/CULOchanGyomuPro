// 差出人の一覧(名前やアドレスの一部)。端末に覚え、設定の同期があれば一緒に届ける。
// 件名・アドレスそのものをログに出さない。保存・通信の本体は呼び出し側。
const GmailSenders = (() => {
    const KEY = 'culo_mail_gmail_senders';
    const FIELD = 'gmailSenders';
    const TERM_RE = /^[\p{L}\p{N}@._+-]{1,80}$/u;
    const MAX = 10;
    const split = raw => String(raw || '').split(/[,、，\n]+/).map(x => x.trim()).filter(Boolean);
    function normalize(terms) {
        const out = [];
        const seen = new Set();
        for (const t of Array.isArray(terms) ? terms : split(terms)) {
            if (typeof t !== 'string') continue;
            const v = t.trim();
            if (!v || !TERM_RE.test(v)) continue;
            const k = v.normalize('NFKC').toLowerCase();
            if (seen.has(k)) continue;
            seen.add(k);
            out.push(v);
            if (out.length >= MAX) break;
        }
        return out;
    }
    function validTerm(t) { return typeof t === 'string' && TERM_RE.test(t.trim()); }
    function read(storage) {
        const S = storage || (typeof AppStorage !== 'undefined' ? AppStorage : null);
        if (!S || typeof S.getItem !== 'function') return [];
        try {
            const settings = JSON.parse(S.getItem('mm_settings') || 'null');
            if (settings && Array.isArray(settings.gmailSenders)) return normalize(settings.gmailSenders);
        } catch (e) { /* 設定が壊れていても、以前の差出人キーを試す */ }
        try { return normalize(S.getItem(KEY) || ''); } catch (e) { return []; }
    }
    function write(storage, terms) {
        const S = storage || (typeof AppStorage !== 'undefined' ? AppStorage : null);
        const list = normalize(terms);
        if (!S || typeof S.setItem !== 'function') return list;
        const csv = list.join(',');
        try { S.setItem(KEY, csv); } catch (e) { /* 片方でも残す */ }
        try {
            let st = {}; try { st = JSON.parse(S.getItem('mm_settings') || '{}') || {}; } catch (e) { st = {}; }
            if (typeof st !== 'object' || Array.isArray(st) || st == null) st = {};
            st.gmailSenders = list;
            S.setItem('mm_settings', JSON.stringify(st));
        } catch (e) { /* 設定側に書けなくても KEY には書けていれば読み戻せる */ }
        return list;
    }
    function add(list, term) {
        const raw = String(term || '').trim();
        if (!raw) return { ok: false, reason: 'empty', terms: normalize(list) };
        if (!validTerm(raw)) return { ok: false, reason: 'bad_terms', terms: normalize(list) };
        const next = normalize([...(list || []), raw]);
        if (normalize(list).length >= MAX && next.length === normalize(list).length && !normalize(list).some(t => t.normalize('NFKC').toLowerCase() === raw.normalize('NFKC').toLowerCase())) {
            return { ok: false, reason: 'too_many', terms: normalize(list) };
        }
        return { ok: true, terms: next };
    }
    function remove(list, term) {
        const k = String(term || '').normalize('NFKC').toLowerCase();
        return normalize((list || []).filter(t => t.normalize('NFKC').toLowerCase() !== k));
    }
    return { KEY, FIELD, TERM_RE, MAX, normalize, validTerm, read, write, add, remove };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GmailSenders;
