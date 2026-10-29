// メールBOXの行から、元のGmailメールを開くリンクを作る(通信なし・純粋関数)。
// ・直接: メッセージID(16進)で #all/<id> を開く。接続中のアカウント(メモリ上だけ)が分かれば authuser= で
//   アカウント番号(u/0, u/1…)のずれを避ける。分からなければ u/0。アドレスはコードに埋めない。
// ・代わり: Androidなどで直接開けないとき用に、件名と受信日の前後1日で検索するリンク。
const MailGmailLinks = (() => {
    const ID_RE = /^[0-9a-f]{6,32}$/;
    const EMAIL_RE = /^[^\s@"<>()\\,;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
    const BASE = 'https://mail.google.com/mail/';
    function ymd(date, delta) {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
        if (!m) return '';
        const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + delta));
        return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    function prefix(account) {
        return typeof account === 'string' && EMAIL_RE.test(account) ? `${BASE}?authuser=${encodeURIComponent(account)}` : `${BASE}u/0/`;
    }
    function of(row, account) {
        const id = row && String(row.messageId || '');
        if (!ID_RE.test(id)) return null;
        const p = prefix(account);
        const subject = String(row.subject || '').replace(/…$/, '').replace(/["\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
        const terms = [subject ? `subject:"${subject}"` : '', ymd(row.receivedDate, -1) ? `after:${ymd(row.receivedDate, -1)} before:${ymd(row.receivedDate, 1)}` : ''].filter(Boolean).join(' ');
        return { open: `${p}#all/${id}`, search: terms ? `${p}#search/${encodeURIComponent(terms)}` : '' };
    }
    return { of, EMAIL_RE };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MailGmailLinks;
