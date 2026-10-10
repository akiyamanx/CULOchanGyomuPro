const test = require('node:test');
const assert = require('node:assert/strict');
const importer = require('../expense/expense-import.js');

test('日付は時刻を外し、うるう年と存在しない日を検証する', () => {
    assert.equal(importer.normalizeDate('2026/10/9'), '2026-10-09');
    assert.equal(importer.normalizeDate('2026-10-09T09:00'), '2026-10-09');
    assert.equal(importer.normalizeDate('2024-02-29'), '2024-02-29');
    assert.equal(importer.normalizeDate('2026-02-29'), '');
});

test('引用符内のカンマ・改行・二重引用符は列として分割しない', () => {
    assert.deepEqual(importer.parseCsv('a,b\n"1,200","港\n\"\"入口\"\""'), [['a', 'b'], ['1,200', '港\n"入口"']]);
    assert.throws(() => importer.parseCsv('a,"b'), /引用符/);
});

test('全角ヘッダー、3桁カンマの金額、時刻、日別のCSVを読む', () => {
    const csv = '利用年月日,利用ＩＣ（自）,利用ＩＣ（至）,通行料金\r\n2026/10/08,千葉,東京,"1,200"\r\n2026/10/09,東京,横浜,800';
    const records = importer.parseEtcCsv(csv);
    assert.deepEqual(records.map(row => [row.date, row.amount]), [['2026-10-08', 1200], ['2026-10-09', 800]]);
    assert.equal(records[0].entry, '千葉');
});

test('割引後の最終額を使う。同じ内容の2利用を保持し、再取込識別子は安定する', () => {
    const csv = '利用日,入口,出口,通行料金,最終額\n2026/10/08,A,B,1200,900\n2026/10/08,A,B,1200,900';
    const first = importer.parseEtcCsv(csv), second = importer.parseEtcCsv(csv);
    assert.equal(first.length, 2);
    assert.equal(first[0].amount, 900);
    assert.notEqual(first[0].key, first[1].key);
    assert.deepEqual(first, second);
});

test('料金列を推測してカード番号を精算しない', () => {
    assert.throws(() => importer.parseEtcCsv('日付,車両番号\n2026/10/08,123456'), /料金の列/);
    assert.equal(importer.parseEtcCsv('利用日,通行料金\n2026/02/29,600\n2026/10/08,-500').length, 0);
});
