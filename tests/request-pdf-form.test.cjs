const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('../map/request-parser');
const fx = require('./fixtures/pdf-form-text.cjs');

// 実際のPDF業務依頼書(「顧客名」「所在地」見出し・■チェック欄)の形を架空データで再現する。
test('PDF業務依頼書: 顧客名・所在地・電話・型式・台数を読み、「様」と郵便番号は除く', () => {
    const [item] = Parser.parsePdfText(fx.embedded(fx.work.filterIrregular),'依頼書.pdf · 1ページ');
    assert.equal(item.company,'架空商事(株) テスト店');
    assert.equal(item.address,'東京都架空区試験1-2-3');
    assert.equal(item.phone,'000-0000-0000');
    assert.equal(item.equipType,'XX-00ZZ0');
    assert.equal(item.unitCount,1);
    assert.equal(item.branch,'架空SS');
});
test('PDF業務依頼書: ■の付いた作業だけを作業内容にし、ポンプ有無・住居形態などの■は無視する', () => {
    const purposeOf = work => Parser.parsePdfText(fx.embedded(work),'依頼書.pdf · 1ページ')[0].purpose;
    assert.equal(purposeOf(fx.work.filterIrregular),'メンテナンス');
    assert.equal(purposeOf(fx.work.install),'本体設置');
    assert.equal(purposeOf(fx.work.repair),'修理');
});
test('PDF業務依頼書: 依頼日・受付日・最終訪問日を訪問予定日にしない', () => {
    const [item] = Parser.parsePdfText(fx.embedded(fx.work.repair),'依頼書.pdf · 1ページ');
    assert.equal(item.appoDate,'');
    assert.equal(item.workDateText,'');
});
test('PDF業務依頼書: 台数が2台以上ならそのまま読む', () => {
    const [item] = Parser.parsePdfText(fx.embedded(fx.work.install,{units:3}),'依頼書.pdf · 1ページ');
    assert.equal(item.unitCount,3);
});
test('OCR結果(チェック記号なし・文字間に空白)でも会社名・住所・電話を読み、作業内容を推測で埋めない', () => {
    const [item] = Parser.parsePdfText(fx.ocr,'依頼書.pdf · 1ページ');
    assert.equal(item.company,'架空商事(株) テスト店');
    assert.equal(item.address,'東京都架空区試験1-2-3');
    assert.equal(item.phone,'000-0000-0000');
    assert.equal(item.purpose,'');
    assert.ok(item.warnings.some(w => /作業内容/.test(w)),'作業内容を確認するよう警告する');
});
test('OCR結果でチェック欄を読めないときだけ、ファイル名の（修理）等を手掛かりにし、その旨を警告する', () => {
    const [item] = Parser.parsePdfText(fx.ocr,'業務依頼書_架空商事（修理）_2026.10.21.pdf · 1ページ');
    assert.equal(item.purpose,'修理');
    assert.ok(item.warnings.some(w => /ファイル名/.test(w)));
    // チェック欄が読めた場合はファイル名より■を優先する。
    const [checked] = Parser.parsePdfText(fx.embedded(fx.work.install),'業務依頼書_架空商事（修理）.pdf · 1ページ');
    assert.equal(checked.purpose,'本体設置');
    assert.ok(!checked.warnings.some(w => /ファイル名/.test(w)));
});
test('PDF業務依頼書: 何も■が付いていない場合は作業内容を空にして警告する', () => {
    const [item] = Parser.parsePdfText(fx.embedded(fx.work.none),'依頼書.pdf · 1ページ');
    assert.equal(item.purpose,'');
    assert.ok(item.warnings.some(w => /作業内容/.test(w)));
});
test('従来の設置業務依頼書(設置先名・設置先住所)の読み取りは変わらない', () => {
    const [item] = Parser.parsePdfText('設置業務依頼書\n設置先名 架空会社C 設置先担当者 試験\n設置先住所 〒100-0001 東京都架空区9-9 TEL 000-0000-0000\n本体種類 試験機 数量 1\n管理No TEST9\n設置日 2026/11/05 10:00','設置.pdf · 1ページ');
    assert.equal(item.company,'架空会社C');
    assert.equal(item.address,'東京都架空区9-9');
    assert.equal(item.purpose,'本体設置');
    assert.equal(item.appoDate,'2026-11-05T10:00');
});
test('PDF業務依頼書: 特記事項を備考へ残し、住所・電話などの個人情報を警告文に出さない', () => {
    const [item] = Parser.parsePdfText(fx.embedded(fx.work.repair),'依頼書.pdf · 1ページ');
    assert.match(item.note,/架空の注意書き/);
    assert.ok(item.warnings.every(w => !/架空商事|試験1-2-3|000-0000/.test(w)));
});
