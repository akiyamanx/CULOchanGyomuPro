// 「Gmailで開く」リンク・読取失敗の理由コード・profile の許可。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const Links = require('../map/mail-gmail-links');
const Reader = require('../map/request-reader');
const Transport = require('../map/gmail-transport');
const Classifier = require('../map/request-classifier');

test('Gmailで開く: メッセージIDで直接開く。アカウントが分かれば authuser、分からなければ u/0', () => {
    const row = { messageId: '19a2b3c4d5e6f708', subject: '業務依頼のお願い', receivedDate: '2026-10-01' };
    const a = Links.of(row, 'kouno@example.invalid');
    assert.equal(a.open, 'https://mail.google.com/mail/?authuser=kouno%40example.invalid#all/19a2b3c4d5e6f708');
    const b = Links.of(row, '');
    assert.equal(b.open, 'https://mail.google.com/mail/u/0/#all/19a2b3c4d5e6f708');
    assert.equal(decodeURIComponent(b.search.split('#search/')[1]), 'subject:"業務依頼のお願い" after:2026/09/30 before:2026/10/02');
    assert.equal(Links.of(row, 'not an email').open, b.open);
});
test('Gmailで開く: 16進以外のIDはリンクにしない。件名の引用符・改行は除き、日付が無ければ件名だけで探す', () => {
    assert.equal(Links.of({ messageId: '../x' }), null);
    assert.equal(Links.of({ messageId: 'javascript:1' }), null);
    const l = Links.of({ messageId: 'abcdef12', subject: 'a"b\nc…', receivedDate: '' });
    assert.equal(decodeURIComponent(l.search.split('#search/')[1]), 'subject:"a b c"');
    assert.equal(Links.of({ messageId: 'abcdef12' }).search, '');
});
test('readForMail: progress=null・signal無しでも例外にせず、PDF道具の読込失敗は pdf_tool_failed にする', async () => {
    const file = { name: 'x.pdf', size: 10, arrayBuffer: async () => new ArrayBuffer(10) };
    const r = await Reader.readForMail(file, null, undefined);
    assert.equal(r.opened, false);
    assert.equal(r.errorCode, 'pdf_tool_failed');
});
test('読取失敗の理由は種類ごとに分かる文で出す(どれも「AIのキー」の話ではない)', () => {
    for (const code of ['read_failed', 'pdf_tool_failed', 'ocr_tool_failed', 'too_many_pages']) {
        const r = Classifier.classifyAttachment({ fileName: 'x.pdf', kind: 'pdf', opened: false, failure: code, subject: '業務依頼' });
        assert.equal(r.bucket, 'unreadable');
        assert.notEqual(r.reason, 'ファイルを読み取れませんでした。');
    }
});
test('通信の許可: users/me/profile のGETだけ追加。profile配下や他の users は拒否', () => {
    assert.equal(Transport.URL_RE.test('https://gmail.googleapis.com/gmail/v1/users/me/profile'), true);
    for (const u of ['https://gmail.googleapis.com/gmail/v1/users/me/profile/x', 'https://gmail.googleapis.com/gmail/v1/users/me/profile?x=1', 'https://gmail.googleapis.com/gmail/v1/users/other/profile', 'https://gmail.googleapis.com/gmail/v1/users/me/settings'])
        assert.equal(Transport.URL_RE.test(u), false, u);
});
const AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
test('スマホ: 最初からモバイル版(mu/mp)のURLを開く(u/0 経由の転送で#が消えるため)。スレッドIDを優先、?は付けない', () => {
    const l = Links.of({ messageId: '19a2b3c4d5e6f708', threadId: '19a2b3c4d5e6f700', subject: '業務依頼のお願い', receivedDate: '2026-10-01' }, 'kouno@example.invalid', { userAgent: AND });
    assert.equal(l.mobile, true);
    assert.equal(l.open, 'https://mail.google.com/mail/mu/mp/#cv/All%20Mail/19a2b3c4d5e6f700');
    assert.match(l.search, /^https:\/\/mail\.google\.com\/mail\/mu\/mp\/#tl\/search\//);
    assert.equal(decodeURIComponent(l.search.split('#tl/search/')[1]), 'subject:"業務依頼のお願い" after:2026/09/30 before:2026/10/02');
    assert.equal(l.open.includes('example.invalid') || l.search.includes('example.invalid'), false);
    assert.equal(l.subject, '業務依頼のお願い');
    assert.equal(Links.of({ messageId: 'abcdef12', threadId: '../x' }, '', { userAgent: AND }).open.endsWith('/abcdef12'), true);
});
test('件名が業務依頼で、PDFは開けたが依頼書の様式として読めなかったときは、その理由を出す', () => {
    const r = Classifier.classifyAttachment({ fileName: 'x.pdf', kind: 'pdf', opened: true, items: [], subject: '業務依頼(架空 修理)' });
    assert.equal(r.bucket, 'unreadable');
    assert.match(r.reason, /件名は業務依頼ですが/);
});
