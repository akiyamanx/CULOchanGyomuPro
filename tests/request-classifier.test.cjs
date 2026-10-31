// メールBOX用: 添付1つ(または本文だけのメール)を 依頼書 / 判別不可 / 通達 に仕分ける純関数のテスト。
// データはすべて架空。誤分類は「判別不可(unreadable)」に倒す。
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../map/request-classifier');

const full = (n = 1) => ({ company: '架空商事' + n, address: '東京都架空区架空町1-' + n, purpose: '修理' });
const base = (extra = {}) => ({ subject: '業務依頼(架空商事)', fileName: '業務依頼書_架空商事_2026.10.01.pdf', kind: 'pdf', senderKind: 'registered', opened: true, items: [], ...extra });
const cls = input => C.classifyAttachment(input);

test('出力の形: bucket / 日本語1行の reason / needsAttention', () => {
    for (const input of [base({ items: [full()] }), base(), base({ fileName: '精算書.pdf' }), {}]) {
        const r = cls(input);
        assert.ok(['request', 'unreadable', 'reference'].includes(r.bucket));
        assert.equal(typeof r.reason, 'string');
        assert.ok(r.reason.length > 0 && !/\n/.test(r.reason));
        assert.equal(typeof r.needsAttention, 'boolean');
    }
});

test('(a) 会社名・住所・作業内容が揃う依頼 → request(要確認なし)', () => {
    const r = cls(base({ kind: 'xls', fileName: '修理.xls', items: [full()] }));
    assert.equal(r.bucket, 'request');
    assert.equal(r.needsAttention, false);
});

test('(a) 月次一覧(リストという語を含む)でも、中身が揃えば request', () => {
    const r = cls(base({ kind: 'xlsx', fileName: '2026年9月メンテナンスリスト架空店.xlsx', subject: '9月 定期メンテナンスリスト', items: [full(1), full(2), full(3)] }));
    assert.equal(r.bucket, 'request');
});

test('(a) 読めたが警告つき → request だが要確認', () => {
    const r = cls(base({ items: [full()], warnings: ['日付が読めません'] }));
    assert.equal(r.bucket, 'request');
    assert.equal(r.needsAttention, true);
});

test('(a) 複数件のうち一部だけ欠け → request(要確認)。欠けた件数が理由に出る', () => {
    const r = cls(base({ kind: 'xlsx', items: [full(1), { company: '架空商事2', address: '', purpose: '修理' }] }));
    assert.equal(r.bucket, 'request');
    assert.equal(r.needsAttention, true);
    assert.match(r.reason, /1件/);
});

test('(b) 欠けのある画像PDF(会社名だけ)→ unreadable、欠け項目を返す', () => {
    const r = cls(base({ ocr: true, items: [{ company: '架空商事', address: '', purpose: '' }] }));
    assert.equal(r.bucket, 'unreadable');
    assert.equal(r.needsAttention, true);
    assert.deepEqual([...r.missing].sort(), ['address', 'purpose']);
});

test('(b) 住所が記号1文字だけ(OCRのごみ)は欠け扱い → unreadable', () => {
    const r = cls(base({ items: [{ company: '架空商事', address: '.', purpose: '設置' }] }));
    assert.equal(r.bucket, 'unreadable');
    assert.ok(r.missing.includes('address'));
});

test('(b) 件数0でも依頼書らしい(見出し「業務依頼書」)→ unreadable', () => {
    const r = cls(base({ fileName: 'scan001.pdf', subject: '', headingText: '業務依頼書\n依頼日 2026/10/01', items: [] }));
    assert.equal(r.bucket, 'unreadable');
    assert.equal(r.needsAttention, true);
});

test('(b) 件数0でファイル名が業務依頼書 → unreadable', () => {
    assert.equal(cls(base({ items: [] })).bucket, 'unreadable');
});

test('(b) 顧客名+所在地の項目はあるが中身が空 → unreadable', () => {
    const r = cls(base({ fileName: 'a.pdf', subject: '', headingText: '顧客名\n所在地', items: [] }));
    assert.equal(r.bucket, 'unreadable');
});

test('(b) 開けないファイル(opened=false)→ unreadable', () => {
    const r = cls(base({ kind: 'xls', fileName: 'ご依頼様式.xls', opened: false }));
    assert.equal(r.bucket, 'unreadable');
    assert.equal(r.needsAttention, true);
});

test('(b) 開けなかった場合は、ファイル名が参考資料らしくても unreadable(取りこぼし防止)', () => {
    assert.equal(cls(base({ fileName: '精算書.pdf', opened: false })).bucket, 'unreadable');
});

test('(b) 形式不明・winmail.dat → unreadable', () => {
    assert.equal(cls(base({ kind: 'tnef', fileName: 'winmail.dat', opened: true })).bucket, 'unreadable');
    assert.equal(cls(base({ kind: 'other', fileName: 'data.xyz' })).bucket, 'unreadable');
});

test('(b) 入力が空・不完全でも例外を出さず unreadable', () => {
    assert.equal(cls({}).bucket, 'unreadable');
    assert.equal(cls(undefined).bucket, 'unreadable');
});

test('(b) 登録外の送信者は、中身が揃っていても自動登録せず unreadable', () => {
    const r = cls(base({ senderKind: 'unknown', items: [full()] }));
    assert.equal(r.bucket, 'unreadable');
    assert.match(r.reason, /送信者/);
});

test('(c) 配置図・設置場所資料・店舗リスト・精算書・納品書・送り状・調査票 → reference', () => {
    const names = ['ウォーターサーバー配置図.pdf', '架空店_設置場所資料.pdf', '対象店舗リスト.xlsx', '精算書_9月.pdf', '納品書.pdf', '送り状控え.pdf', '現地設置調査票.xlsx', '見積書.pdf', 'コスト試算.pdf'];
    for (const fileName of names) {
        const ext = fileName.split('.').pop();
        const r = cls({ subject: 'ご連絡', fileName, kind: ext, senderKind: 'registered', opened: true, items: [] });
        assert.equal(r.bucket, 'reference', fileName);
        assert.equal(r.needsAttention, false, fileName);
    }
});

test('(c) 画像PDFの配置図(件数0・件名は業務依頼)→ reference', () => {
    const r = cls(base({ fileName: 'サーバー配置図.pdf', ocr: true, items: [] }));
    assert.equal(r.bucket, 'reference');
});

test('(c) 見出しが精算書 → reference(ファイル名が汎用でも)', () => {
    const r = cls(base({ fileName: 'scan002.pdf', subject: 'ご確認', headingText: '精算書\n合計', items: [] }));
    assert.equal(r.bucket, 'reference');
});

test('(c) 件名だけが参考資料らしい(精算・納品)で、ファイル名と見出しに依頼書の手掛かりなし → reference', () => {
    assert.equal(cls({ subject: '納品書をお送りします', fileName: 'scan.pdf', kind: 'pdf', senderKind: 'registered', opened: true, items: [] }).bucket, 'reference');
});

test('(c) 精算書の誤読で会社+住所だけの行が出ても(作業内容なし)reference', () => {
    const r = cls(base({ fileName: '精算書.pdf', items: [{ company: '架空商事', address: '東京都架空区架空町1', purpose: '' }] }));
    assert.equal(r.bucket, 'reference');
});

test('迷う: 依頼書のファイル名なのに見出しが精算書 → unreadable', () => {
    const r = cls(base({ headingText: '精算書', items: [] }));
    assert.equal(r.bucket, 'unreadable');
});

test('迷う: 店舗リストという名前で、中身は会社+住所+作業内容が揃う → unreadable(本人が確認)', () => {
    const r = cls({ subject: 'ご確認', fileName: '対象店舗リスト.xlsx', kind: 'xlsx', senderKind: 'registered', opened: true, items: [full(1), full(2)] });
    assert.equal(r.bucket, 'unreadable');
});

test('迷う: 手掛かりが何もない(件数0・汎用名)→ unreadable', () => {
    const r = cls({ subject: '', fileName: 'file.pdf', kind: 'pdf', senderKind: 'registered', opened: true, items: [] });
    assert.equal(r.bucket, 'unreadable');
});

test('画像ファイル: 手掛かりなしは unreadable、写真という名前なら reference', () => {
    assert.equal(cls({ subject: '', fileName: 'IMG_0001.jpg', kind: 'image', senderKind: 'registered', opened: true, items: [] }).bucket, 'unreadable');
    assert.equal(cls({ subject: '', fileName: '設置写真.jpg', kind: 'image', senderKind: 'registered', opened: true, items: [] }).bucket, 'reference');
});

test('同じメールに依頼書があれば、手掛かりなしの添付(画像・大きなPDF)は reference', () => {
    const img = { subject: '業務依頼(架空)', fileName: 'IMG_0001.jpg', kind: 'image', senderKind: 'registered', opened: true, items: [], mailHasRequest: true };
    assert.equal(cls(img).bucket, 'reference');
    assert.equal(cls({ ...img, fileName: 'sheet.pdf', kind: 'pdf' }).bucket, 'reference');
});

test('同じメールに依頼書があっても、依頼書らしい添付(欠けあり)は unreadable のまま', () => {
    const r = cls(base({ mailHasRequest: true, items: [{ company: '架空商事', address: '', purpose: '' }] }));
    assert.equal(r.bucket, 'unreadable');
});

test('添付なし: 報告メール・日程調整・返信・運送会社の通知 → reference(通達BOX)', () => {
    for (const subject of ['快作レポート+ 報告書登録のお知らせ', 'RE: 日程のご相談', '【配送】お荷物のお届け予定', 'サーバー保守のお知らせ']) {
        const r = cls({ subject, kind: 'none', senderKind: 'registered' });
        assert.equal(r.bucket, 'reference', subject);
        assert.equal(r.needsAttention, false);
    }
});

test('添付なしでも件名が業務依頼なら、取りこぼさないよう unreadable', () => {
    const r = cls({ subject: '業務依頼(架空商事)', kind: 'none', senderKind: 'registered' });
    assert.equal(r.bucket, 'unreadable');
    assert.equal(r.needsAttention, true);
});

test('添付なし・登録外の送信者・手掛かりなし → reference(通達BOX。通知しない)', () => {
    const r = cls({ subject: 'ニュースレター', kind: 'none', senderKind: 'unknown' });
    assert.equal(r.bucket, 'reference');
    assert.equal(r.needsAttention, false);
});

test('reason に件名・ファイル名・会社名を入れない(個人情報を画面や記録へ増やさない)', () => {
    const r = cls(base({ subject: '業務依頼(秘密商事)', fileName: '秘密商事_依頼書.pdf', items: [{ company: '秘密商事', address: '', purpose: '' }] }));
    assert.ok(!/秘密商事/.test(r.reason));
});

test('classifyMail: 依頼書+参考添付2つ → request / reference / reference、通知なし', () => {
    const m = C.classifyMail({
        subject: '業務依頼(架空商事)', senderKind: 'registered',
        attachments: [
            { fileName: '業務依頼書_架空商事.xls', kind: 'xls', opened: true, items: [full()] },
            { fileName: 'IMG_0001.jpg', kind: 'image', opened: true, items: [] },
            { fileName: '設置場所資料.pdf', kind: 'pdf', opened: true, items: [] }
        ]
    });
    assert.deepEqual(m.results.map(r => r.bucket), ['request', 'reference', 'reference']);
    assert.deepEqual(m.summary, { request: 1, unreadable: 0, reference: 2 });
    assert.equal(m.notify, false);
});

test('classifyMail: 欠けのある画像PDFがあれば notify(「依頼書が来たよ」)', () => {
    const m = C.classifyMail({
        subject: '業務依頼(架空商事)', senderKind: 'registered',
        attachments: [{ fileName: '業務依頼書_架空商事.pdf', kind: 'pdf', opened: true, ocr: true, items: [{ company: '架空商事', address: '', purpose: '' }] }]
    });
    assert.equal(m.summary.unreadable, 1);
    assert.equal(m.notify, true);
});

test('classifyMail: 添付なしのメールも1件として仕分ける', () => {
    const m = C.classifyMail({ subject: 'RE: 日程のご相談', senderKind: 'registered', attachments: [] });
    assert.equal(m.results.length, 1);
    assert.equal(m.results[0].bucket, 'reference');
    assert.equal(m.notify, false);
});

test('classifyMail: 入力を書き換えない', () => {
    const mail = { subject: 's', senderKind: 'registered', attachments: [{ fileName: 'a.jpg', kind: 'image', opened: true, items: [] }] };
    const copy = JSON.stringify(mail);
    C.classifyMail(mail);
    assert.equal(JSON.stringify(mail), copy);
});

test('(b) 作業内容をファイル名から推定しただけの画像PDFは、項目が埋まって見えても unreadable', () => {
    const hint = '作業内容のチェック欄を読み取れなかったため、ファイル名の「修理」から推定しました。原本で確認してください。';
    const r = cls(base({ ocr: true, items: [{ ...full(), warnings: ['PDFの読取結果です。原本と照合してください。', hint] }] }));
    assert.equal(r.bucket, 'unreadable');
    assert.ok(r.missing.includes('purpose'));
});

test('(b) 住所に文字化け(�・□・■)が混ざる読取は欠け扱い → unreadable', () => {
    for (const address of ['東京都架空区�町1-2', '東京都架空区□□町1-2', '■■■■']) {
        const r = cls(base({ ocr: true, items: [{ company: '架空商事', address, purpose: '修理' }] }));
        assert.equal(r.bucket, 'unreadable', address);
        assert.ok(r.missing.includes('address'), address);
    }
});

test('PDF共通の「原本と照合してください」警告だけでは、揃った依頼書を要確認にしない', () => {
    const r = cls(base({ items: [{ ...full(), warnings: ['PDFの読取結果です。会社名・住所・電話・日程を原本と照合してください。'] }] }));
    assert.equal(r.bucket, 'request');
    assert.equal(r.needsAttention, false);
});

// ---- Gmail取り込み: 開けなかった理由を、具体的に画面へ出す(すべて判別不可。登録はしない) ----
test('(Gmail) TNEF(winmail.dat)は、開けない理由を具体的に言って unreadable', () => {
    for (const a of [{ kind: 'tnef', fileName: 'winmail.dat' }, { kind: 'other', fileName: 'winmail.dat', failure: 'tnef_unsupported' }]) {
        const r = C.classifyAttachment({ ...a, subject: '業務依頼', senderKind: 'registered', opened: false, items: [] });
        assert.equal(r.bucket, 'unreadable'); assert.match(r.reason, /winmail|Outlook/);
    }
});
test('(Gmail) 開けなかった理由コードごとに、別々の説明が付く。未知のコードは汎用の説明', () => {
    const reasons = new Set();
    for (const f of ['too_large', 'type_blocked', 'content_mismatch', 'no_body', 'over_limit', 'read_failed']) {
        const r = C.classifyAttachment({ kind: 'pdf', fileName: 'a.pdf', subject: '業務依頼', senderKind: 'registered', opened: false, items: [], failure: f });
        assert.equal(r.bucket, 'unreadable', f); assert.ok(r.reason.length > 8, f); reasons.add(r.reason);
    }
    assert.equal(reasons.size, 6);
    const g = C.classifyAttachment({ kind: 'pdf', fileName: 'a.pdf', opened: false, items: [], failure: 'zzz' });
    assert.equal(g.bucket, 'unreadable'); assert.equal(g.reason, 'ファイルを開けませんでした。');
});
