const test = require('node:test');
const assert = require('node:assert/strict');
const Parser = require('../map/request-parser');

// Synthetic rental request form (fictional data only). Labels in column A, values sometimes one cell further right.
const form = (gap) => [
    [],['業　務　依　頼　書（レンタル）'],[],
    ['浄水器名','架空-400','','台数','','','1　台'],
    ['出荷日','2026-10-27','','到着日','','','2026-10-28'],
    ['初回設置日','','','最終訪問日','','',''],
    ['販社名','架空販社','','',''],
    gap ? ['依頼業務内容','','設置'] : ['依頼業務内容','設置'],
    [],
    gap ? ['客先名（工事先）','','甲野架空商店'] : ['客先名（工事先）','甲野架空商店'],
    ['所在地','〒000-0000','架空県架空市1-2-3'],
    ['','TEL','000-0000-0000'],
    ['特記事項','レンタル、架空-400'],
    ['本部','依頼SS名','乙川架空SS']
];

test('見出しと値の間に空白マスがある依頼書も読める', () => {
    const [item] = Parser.parseRows(form(true), 'fictional.xlsx');
    assert.equal(item.company, '甲野架空商店');
    assert.equal(item.purpose, '本体設置');
    assert.equal(item.address, '〒000-0000架空県架空市1-2-3');
    assert.equal(item.unitCount, 1);
    assert.equal(item.branch, '乙川架空SS');
});

test('従来の隣接レイアウトも同じ結果になる', () => {
    const a = Parser.parseRows(form(true), 'f')[0], b = Parser.parseRows(form(false), 'f')[0];
    for (const k of ['company','purpose','address','equipType','branch','unitCount']) assert.equal(a[k], b[k], k);
});

test('空欄の見出しの右に別の見出しがあれば値にしない', () => {
    const rows = form(true);
    rows[9] = ['客先名（工事先）','','台数'];
    assert.equal(Parser.parseRows(rows, 'f').length, 0);
    const [item] = Parser.parseRows(form(true), 'f');
    assert.ok(!/最終訪問日/.test(item.workDateText + item.note));
});
