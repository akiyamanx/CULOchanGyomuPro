// メールBOXの行から、元のGmailメールを開くリンクを作る(通信なし・純粋関数)。
// ・パソコン: https://mail.google.com/mail/?authuser=<接続中アドレス>#all/<id>(アドレスが不明なら u/0)。
// ・スマホ(Android等): mail.google.com/mail/u/0/ はモバイル版(mail/mu/mp/)へ転送され、そのとき #以降が消えて受信トレイに戻る。
//   そこで最初からモバイル版のURL(#cv/…=スレッド表示、#tl/search/…=検索)を直接開く(転送が起きないので#が残る)。
//   この形はGoogleの公開文書には無く、利用者の実例(2013〜2018年)に基づく。未確認のため「件名をコピー」も必ず用意する。
// アドレスはコードに埋めない(メモリ上の接続中アカウントだけ)。
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
    const isMobile = ua => /Android|iPhone|iPad|iPod|Mobile/i.test(String(ua || ''));
    function cleanSubject(s) { return String(s || '').replace(/…$/, '').replace(/["\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }
    function of(row, account, opts = {}) {
        const id = row && String(row.messageId || '');
        if (!ID_RE.test(id)) return null;
        const thread = ID_RE.test(String(row.threadId || '')) ? row.threadId : id;
        const acct = typeof account === 'string' && EMAIL_RE.test(account) ? account : '';
        const subject = cleanSubject(row.subject);
        const terms = [subject ? `subject:"${subject}"` : '', ymd(row.receivedDate, -1) ? `after:${ymd(row.receivedDate, -1)} before:${ymd(row.receivedDate, 1)}` : ''].filter(Boolean).join(' ');
        const q = encodeURIComponent(terms);
        if (isMobile(opts.userAgent)) {
            const p = `${BASE}mu/mp/`;   // ?付きは転送で#が消えるおそれがあるため付けない(既定のアカウントで開く)
            return { mobile: true, open: "", search: terms ? `${p}#tl/search/${q}` : '', subject };
        }
        const p = acct ? `${BASE}?authuser=${encodeURIComponent(acct)}` : `${BASE}u/0/`;
        return { mobile: false, open: `${p}#all/${id}`, search: terms ? `${p}#search/${q}` : '', subject };
    }
    return { of, isMobile, EMAIL_RE };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MailGmailLinks;
