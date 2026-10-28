const test = require('node:test');
const assert = require('node:assert/strict');
const Reader = require('../map/request-reader');

// Excelの日付シリアル値(1900年系)。架空の日付で作る。
const serial = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
const sheetOf = cells => ({'!ref':'A1:C3', ...cells});

test('日付の書式なしの数値セル(表示だけ 10/15/26 のような月/日/年)をシリアル値から YYYY-MM-DD にする', () => {
    // 実サンプルの「作業希望日」: 型は数値、書式情報なし、表示用の w だけが m/d/yy になっていた。
    const sheet = sheetOf({B1:{t:'n', v:serial(2026,10,15), w:'10/15/26'}, B2:{t:'n', v:serial(2026,11,5), w:'11/05/26'}, B3:{t:'n', v:serial(2027,1,9), w:'1/9/27'}});
    Reader.normalizeDateCells(sheet);
    assert.equal(sheet.B1.w, '2026-10-15');
    assert.equal(sheet.B2.w, '2026-11-05');
    assert.equal(sheet.B3.w, '2027-01-09');
});
test('日付ではない数値(台数・金額・管理番号・郵便番号)は書き換えない', () => {
    const sheet = sheetOf({B1:{t:'n', v:3, w:'3'}, B2:{t:'n', v:46310, w:'46310'}, B3:{t:'n', v:1234567, w:'1,234,567'}, C1:{t:'n', v:0.5, w:'12:00'}, C2:{t:'n', v:serial(2026,10,15), w:'46310'}});
    const before = JSON.stringify(sheet);
    Reader.normalizeDateCells(sheet);
    assert.equal(JSON.stringify(sheet), before);
});
test('2000〜2099年の範囲外のシリアル値は、日付の見た目でも書き換えない', () => {
    const sheet = sheetOf({B1:{t:'n', v:serial(1990,1,1), w:'1/1/90'}, B2:{t:'n', v:serial(2150,1,1), w:'1/1/50'}});
    const before = JSON.stringify(sheet);
    Reader.normalizeDateCells(sheet);
    assert.equal(JSON.stringify(sheet), before);
});
test('従来どおり、日付型セルは年つきの YYYY-MM-DD にし、時刻だけのセルは表示のまま残す', () => {
    const sheet = sheetOf({A1:{t:'d', v:new Date(2026,9,15), z:'m/d/yy', w:'10/15/26'}, A2:{t:'d', v:new Date(2026,9,15,9,30), z:'yyyy/m/d h:mm', w:'2026/10/15 9:30'}, A3:{t:'d', v:new Date(1899,11,30,13,0), z:'h:mm', w:'13:00'}});
    Reader.normalizeDateCells(sheet);
    assert.equal(sheet.A1.w, '2026-10-15');
    assert.equal(sheet.A2.w, '2026-10-15 09:30');
    assert.equal(sheet.A3.w, '13:00');
});
test('文字列セル・空セル・!で始まる管理項目は触らない', () => {
    const sheet = sheetOf({A1:{t:'s', v:'10/15/26', w:'10/15/26'}});
    Reader.normalizeDateCells(sheet);
    assert.equal(sheet.A1.w, '10/15/26');
    assert.equal(sheet['!ref'], 'A1:C3');
});
test('読み取った月/日/年が、月日の判定(登録月)で作業日の月になる', () => {
    const Month = require('../map/request-month');
    const sheet = sheetOf({B1:{t:'n', v:serial(2026,11,5), w:'11/5/26'}});
    Reader.normalizeDateCells(sheet);
    const r = Month.resolveRegistrationMonth({workDateText:sheet.B1.w, receivedDate:'2026-10-28'});
    assert.equal(r.month, '2026-11');
    assert.equal(r.scheduleUnset, false);
});
