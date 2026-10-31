const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('../map/request-parser');
const fx = require('./fixtures/pdf-form-text.cjs');

const pagesOf = ([name, kind, pages]) => Array.from({length:pages}, (_, i) => ({text:fx.reference[kind](i + 1), source:`${name} · ${i + 1}ページ`}));
const itemsFor = files => files.flatMap(file => pagesOf(file).flatMap(page => Parser.parsePdfText(page.text, page.source)));

test('参考資料のPDF(精算書・納品書・調査票・コスト試算)9ファイル29ページから、依頼を1件も作らない', () => {
    assert.equal(fx.referenceFiles.reduce((sum, file) => sum + file[2], 0), 29);
    assert.equal(itemsFor(fx.referenceFiles).length, 0);
});
test('顧客名・所在地が書いてある調査票でも、見出しが調査票なら依頼書ではない', () => {
    assert.deepEqual(Parser.parsePdfText(fx.reference.survey(1), '調査票.pdf · 1ページ'), []);
});
test('見出しの「業務依頼書」があれば依頼書として読む(埋め込みテキスト)', () => {
    assert.equal(Parser.parsePdfText(fx.embedded(fx.work.repair), '依頼書.pdf · 1ページ').length, 1);
});
test('見出しが無くても、顧客名と所在地の組がある画像PDFのOCR結果は依頼書として読む', () => {
    assert.equal(Parser.parsePdfText(fx.ocr, '依頼書.pdf · 1ページ').length, 1);
});
test('旧書式(設置業務依頼書・設置先名/設置先住所)は依頼書として読む', () => {
    const old = '設置業務依頼書\n設置先名 架空商事\n設置先住所 東京都架空区試験1-2-3\nTEL 000-0000-0000';
    assert.equal(Parser.parsePdfText(old, '設置.pdf · 1ページ').length, 1);
});
test('文字がほとんど読めなくても、ファイル名に「業務依頼」があれば1ページ目だけは空欄の依頼として出し、手で補えるようにする', () => {
    const garbled = '架空 7 ■ 3 ー\n0000';
    assert.equal(Parser.parsePdfText(garbled, '業務依頼書_架空商事（修理）.pdf · 1ページ').length, 1);
    assert.equal(Parser.parsePdfText(garbled, '業務依頼書_架空商事（修理）.pdf · 2ページ').length, 0);
    assert.equal(Parser.parsePdfText(garbled, 'scan0001.pdf · 1ページ').length, 0);
});
test('ファイル名が業務依頼書でも、本文の見出しが精算書なら依頼書ではない', () => {
    assert.deepEqual(Parser.parsePdfText(fx.reference.settlement(1), '業務依頼書_架空商事（修理）.pdf · 1ページ'), []);
});
test('特記事項に「見積」「調査」の語があっても、見出しが業務依頼書なら依頼書として読む', () => {
    const text = fx.embedded(fx.work.repair).replace('※架空の注意書き', '※見積書・調査票は別紙');
    assert.equal(Parser.parsePdfText(text, '依頼書.pdf · 1ページ').length, 1);
});
