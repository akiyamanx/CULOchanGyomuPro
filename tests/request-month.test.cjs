const test = require('node:test');
const assert = require('node:assert/strict');
const Month = require('../map/request-month');

const TODAY = '2026-10-28';
const months = (text, today = TODAY) => Month.parseDates(text, {today}).map(d => d.month);
const one = (text, expected, today = TODAY) => assert.deepEqual([...new Set(months(text, today))], [expected], `${text} → ${expected}`);

test('年付きの日付表記(西暦・和暦・全角・ISO・曜日付き)から月を読む', () => {
    one('2026/11/05','2026-11');
    one('2026-11-5','2026-11');
    one('2026-11-05 13:00','2026-11');
    one('2026年11月5日','2026-11');
    one('2026年11月','2026-11');
    one('26/11/5','2026-11');
    one('令和8年11月5日','2026-11');
    one('令和８年１１月５日','2026-11');
    one('R8.11.5','2026-11');
    one('R8/11/5','2026-11');
    one('令和元年5月1日','2019-05');
    one('H30.4.1','2018-04');
    one('2026年11月5日（木）13：00～','2026-11');
});
test('年の無い日付表記は、今日に最も近い年として読む', () => {
    one('11/5','2026-11');
    one('11月5日','2026-11');
    one('11月5日（木）','2026-11');
    one('11月','2026-11');
    one('11月中','2026-11');
    one('11月上旬','2026-11');
    one('１１月５日','2026-11');
    one('1/10','2027-01');       // 今が10月なら来年の1月
    one('12/20','2026-12');
    one('1月15日','2027-01', '2026-12-20');
    one('12/20','2025-12', '2026-01-05'); // 年初に前年12月の日付
    one('9/30','2026-09');
    one('4月','2027-04');         // 半年先と半年前が同距離なら未来側
});
test('日が伏せ字・未記入(○○日・丸々日・××日)でも月が書かれていれば月を読む', () => {
    one('11月○○日','2026-11');
    one('11月〇〇日','2026-11');
    one('11月丸々日','2026-11');
    one('11月丸丸日','2026-11');
    one('11月××日','2026-11');
    one('11月xx日','2026-11');
    one('11月□□日','2026-11');
    one('11月末','2026-11');
    one('2026/11/○○','2026-11');
});
test('複数日・期間は含まれる月をすべて返し、同じ月なら1つにまとまる', () => {
    one('設置（10/29、30）','2026-10');
    one('11/5(木)～11/7(土)','2026-11');
    one('11月5日・6日・9日','2026-11');
    assert.deepEqual([...new Set(months('10/31〜11/2'))].sort(),['2026-10','2026-11']);
});
test('日付ではない数字(電話・郵便番号・時刻・台数・型番)は月として読まない', () => {
    for (const text of ['045-641-6115','000-0000-0000','〒100-0001','13:00','1.5台','3台','XX-00ZZ0','HW-20KP2','100-0001 東京都架空区1-2-3','12345','']) {
        assert.deepEqual(months(text),[], text);
    }
});
test('存在しない月日は読まない', () => {
    assert.deepEqual(months('13/5'),[]);
    assert.deepEqual(months('13月5日'),[]);
    assert.deepEqual(months('0月3日'),[]);
    assert.deepEqual(months('2/30'),[]);
    assert.deepEqual(months('11/5/6'),[]); // 2桁年は今年の前後2年だけ
    assert.deepEqual(months('11月32日'),[]);
    assert.deepEqual(months('2026/2/29'),[]);
    one('2028/2/29','2028-02');
});

test('登録月: 作業予定日があればそれを使う(今月でなくても)', () => {
    const r = Month.resolveRegistrationMonth({workDateText:'11月○○日',titleText:'10月 定期メンテナンスリスト',today:TODAY});
    assert.equal(r.month,'2026-11');
    assert.equal(r.basis,'作業予定日');
    assert.equal(r.needsReview,false);
});
test('登録月: 作業予定日が無ければ件名・タイトルの月を使う', () => {
    const r = Month.resolveRegistrationMonth({workDateText:'',titleText:'【依頼】11月分 DP-400定期メンテナンスリスト',today:TODAY});
    assert.equal(r.month,'2026-11');
    assert.equal(r.basis,'件名・タイトル');
    assert.equal(r.needsReview,false);
    // 作業予定日が「未定」など月を含まない場合も同じ。
    const undecided = Month.resolveRegistrationMonth({workDateText:'未定',titleText:'12月分リスト',today:TODAY});
    assert.equal(undecided.month,'2026-12');
    assert.equal(undecided.basis,'件名・タイトル');
});
test('登録月: どちらにも月が無ければ要確認(自動登録しない)', () => {
    for (const input of [{}, {workDateText:'',titleText:''}, {workDateText:'未定',titleText:'HW修理 業務依頼'}, {workDateText:null,titleText:undefined}]) {
        const r = Month.resolveRegistrationMonth({...input,today:TODAY});
        assert.equal(r.month,null);
        assert.equal(r.needsReview,true);
        assert.ok(r.reason);
    }
});
test('登録月: 作業予定日が複数の月にまたがる・複数の項目が食い違うときは要確認で、候補月を示す', () => {
    const r = Month.resolveRegistrationMonth({workDateText:'10/31〜11/2',titleText:'10月分',today:TODAY});
    assert.equal(r.month,null);
    assert.equal(r.needsReview,true);
    assert.deepEqual(r.candidates,['2026-10','2026-11']);
    const multi = Month.resolveRegistrationMonth({workDateText:['11/5','12/3'],today:TODAY});
    assert.equal(multi.needsReview,true);
    assert.deepEqual(multi.candidates,['2026-11','2026-12']);
});
test('登録月: 作業予定日が複数でも同じ月なら、その月を使う', () => {
    const r = Month.resolveRegistrationMonth({workDateText:['11/5','11月12日','2026/11/○○'],today:TODAY});
    assert.equal(r.month,'2026-11');
});
test('登録月: 依頼日・受付日・設置日などの過去日はこの関数へ渡す側で除外する(依頼書の依頼日で月を決めない)', () => {
    // PDF依頼書は依頼日・受付年月日を持つが、パーサーは作業予定日(workDateText)にそれらを入れない。
    const Parser = require('../map/request-parser');
    const fx = require('./fixtures/pdf-form-text.cjs');
    const [item] = Parser.parsePdfText(fx.embedded(fx.work.repair),'依頼書.pdf · 1ページ');
    const r = Month.resolveRegistrationMonth({workDateText:item.workDateText,titleText:'',today:TODAY});
    assert.equal(r.month,null);
    assert.equal(r.needsReview,true);
});
test('登録月: today省略時は日本時間の現在日を使い、不正なtodayは拒否する', () => {
    assert.match(Month.resolveRegistrationMonth({workDateText:'11/5'}).month,/^\d{4}-11$/);
    assert.throws(() => Month.resolveRegistrationMonth({workDateText:'11/5',today:'2026/10/28'}));
});
test('登録月: 結果の月はワークスペースID(YYYY-MM)の形式', () => {
    const r = Month.resolveRegistrationMonth({workDateText:'令和8年11月5日',today:TODAY});
    assert.match(r.month,/^\d{4}-(0[1-9]|1[0-2])$/);
});
