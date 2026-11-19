const {test}=require('node:test');
const assert=require('node:assert/strict');
const Parser=require('../map/request-parser.js');
const form=(label,date,time='')=>Parser.parseRows([['架空業務依頼書'],['会社名','架空商会'],['住所','東京都架空区1'],['依頼内容','修理'],[label,date],['時間指定',time]])[0];
test('希望と明記された日付および確定と明記された日付と暗黙の日付を分ける',()=>{
    assert.equal(form('作業希望日','2026/11/16','09:00').scheduleKind,'preferred');
    assert.equal(form('工事予定日時','2026/11/16(月) 09:00 確定').scheduleKind,'confirmed');
    assert.equal(form('工事予定日時','2026/11/16(月) 09:00').scheduleKind,'unknown');
    assert.equal(form('工事予定日時','2026/11/16(月) 09:00 未確定').scheduleKind,'unknown');
    assert.equal(form('工事予定日時','').scheduleKind,'undated');
});
test('曜日が日付と食い違う場合は元の文言を残し、訪問日時は採用しない',()=>{
    const row=form('作業希望日','2026/11/16（火）','09:00');
    assert.equal(row.appoDate,'');
    assert.equal(row.workDateText,'2026/11/16（火）');
    assert.equal(row.dateNeedsReview,true);
    assert.match(row.warnings.join(' '),/火.*月/);
});
test('日時欄に自動反映しない月次一覧でも曜日を検証する',()=>{
    const rows=[['会社名','住所','工事予定日'],['架空商会','東京都架空区1','2026/11/16（火）']];
    assert.equal(Parser.parseRows(rows)[0].dateNeedsReview,true);
});
test('PDFの希望・曜日・受注済みではない旧データを取り違えない',()=>{
    const prefix='業務依頼書\n設置先名 架空商店\n設置先住所 東京都架空区1\n依頼内容 修理\n';
    assert.equal(Parser.parsePdfText(prefix+'作業希望日 2026年11月16日（月） 09:00')[0].scheduleKind,'preferred');
    assert.equal(Parser.parsePdfText(prefix+'作業希望日 2026年11月16日（火） 09:00')[0].dateNeedsReview,true);
    assert.equal(Parser.scheduleLabel({appoDate:'2026-11-16T09:00'}),'日程区分未確認');
    assert.equal(Parser.scheduleLabel({}),'日程未定');
});

test('明示された年を使い年またぎも検証するが、年が不明なら曜日を断定しない',()=>{
    assert.equal(form('工事予定日時','２０２７／１／１（金） 09:00 確定').dateNeedsReview,undefined);
    assert.equal(form('工事予定日時','２０２７／１／１（木） 09:00 確定').dateNeedsReview,true);
    assert.equal(form('工事予定日時','1/1（木） 09:00').dateNeedsReview,undefined);
});
test('確定予定や否定を確定としない',()=>{
    for (const note of ['確定次第連絡','確定ではない','確定していません','確定予定','未確定','要確定']) {
        assert.equal(form('工事予定日時','2026/11/16(月) 09:00 '+note).scheduleKind,'unknown',note);
    }
});

test('確定と書かれた日付のみの原文は残すが、確定日時として表示しない',()=>{
    const date=form('工事予定日時','2026/11/16（月）確定');
    assert.equal(date.appoDate,'');
    assert.equal(date.scheduleKind,'unknown');
    assert.match(date.note,/2026\/11\/16（月）確定/);
});
