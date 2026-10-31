// ETC明細の照合補助: 仮の出発時刻・提案区間（架空データのみ）。
const test=require('node:test'),assert=require('node:assert/strict');
const EtcDocument=require('../expense/etc-document.js'),EtcJourney=require('../expense/etc-journey.js');
// 実際の利用証明書と同じ並び（料金所(自)/(至)、日付＋出口時刻、通行料金、取扱番号、登録番号）。値は架空。
const cell=(entry,exit,day,time,fee,no)=>['利 用 証 明 書','料金所(自) '+entry,'料金所(至) '+exit,'２６年 ９月 '+day+'日 '+time,'割引前料金 ￥３，１４０－','割引△','通行料金 ￥'+fee+'－','(ETCｸﾚｼﾞｯﾄ) 車種 1','取扱番号','X00000-000000-'+no,'※本利用証明書はＥＴＣ利用照会サービ','スで印字されたものです。','登録番号：T0000000000000'].join('\n');
const rows=[cell('','架空第一料金所','３','８時２７分','８００','000001'),cell('架空湾岸','架空本町','３','１２時３０分','８６０','000002'),
    cell('','架空第一料金所','３','１５時３９分','８００','000003'),cell('','架空第一料金所','３','６時 ０分','８００','000004')].map(EtcDocument.parseCell);
function makeDay() {
    const d={date:'2026-09-03',stops:[{id:'home_start',name:'会社',job:'hq',departure:''},{id:'a',name:'甲野商店（架空）',job:'hq',arrival:'10:00',departure:''},
        {id:'b',name:'乙川工業（架空）',job:'hq',arrival:'14:00',departure:''},{id:'home_end',name:'会社',job:'hq',arrival:''}],legs:[]};
    return EtcJourney.rebuild(d);
}
test('実物と同じ並びの明細を読める（入口空欄も可・時刻は出口時刻）',()=>{
    assert.ok(rows.every(r=>r.valid));
    assert.deepEqual(rows.map(r=>r.time),['08:27','12:30','15:39','06:00']);
    assert.equal(rows[0].entry,'');assert.equal(rows[0].amount,800);assert.equal(rows[1].date,'2026-09-03');
});
test('空欄の出発に仮の時刻（既定: 作業60分・最初は120分前・帰りは240分以内）',()=>{
    assert.deepEqual({...EtcJourney.TIMING},{onSiteMinutes:60,leadMinutes:120,returnMinutes:240,graceMinutes:15});
    const t=EtcJourney.effectiveTimes(makeDay());
    assert.deepEqual(t.map(x=>[x.departure,x.departureProvisional]),[[480,true],[660,true],[900,true],[null,false]]);
    assert.deepEqual([t[3].arrival,t[3].arrivalProvisional],[1140,true]);
    assert.equal(EtcJourney.provisionalLabel(makeDay(),1,'departure'),'11:00');
});
test('次の訪問の予定時刻より遅くしない・設定で変えられる',()=>{
    const d=makeDay();d.stops[2].arrival='10:30';
    assert.equal(EtcJourney.effectiveTimes(d)[1].departure,630);
    assert.equal(EtcJourney.effectiveTimes(makeDay(),{onSiteMinutes:90})[1].departure,690);
});
test('入力済みの時刻は上書きしない・保存データも変えない',()=>{
    const d=makeDay();d.stops[1].departure='12:15';const before=JSON.stringify(d);
    const t=EtcJourney.effectiveTimes(d);
    assert.deepEqual([t[1].departure,t[1].departureProvisional],[735,false]);
    assert.equal(EtcJourney.provisionalLabel(d,1,'departure'),'');
    EtcJourney.candidates(rows[1],d);EtcJourney.suggestion(rows[1],d);
    assert.equal(JSON.stringify(d),before);assert.equal(d.stops[0].departure,'');
});
test('出口時刻で区間を判定して、1つに決まる明細だけ提案する',()=>{
    const d=makeDay();
    assert.equal(EtcJourney.suggestion(rows[0],d),'home_start>a');
    assert.equal(EtcJourney.suggestion(rows[1],d),'a>b');
    assert.equal(EtcJourney.suggestion(rows[2],d),'b>home_end');
    assert.equal(EtcJourney.suggestion(rows[3],d),'');
    assert.match(EtcJourney.candidates(rows[0],d)[0].reasons.join(),/仮の時刻で判定/);
});
test('到着予定を少し過ぎた出口時刻も区間内（15分まで）',()=>{
    const d=makeDay(),late={...rows[0],time:'10:10'},later={...rows[0],time:'10:20'};
    assert.equal(EtcJourney.suggestion(late,d),'home_start>a');
    assert.equal(EtcJourney.suggestion(later,d),'');
});
test('時刻で2区間に当たる時は差が4点以上ある場合だけ提案',()=>{
    const d=makeDay();d.stops[1].departure='09:00';d.stops[1].arrival='09:30'; // 重なる窓を作る
    const both={...rows[0],time:'09:20'};
    assert.equal(EtcJourney.candidates(both,d).filter(c=>c.timeMatch).length,2);
    assert.equal(EtcJourney.suggestion(both,d),'');
    d.legs[1].exit='架空第一料金所';
    assert.equal(EtcJourney.suggestion(both,d),'a>b');
});
test('提案しても確定にはならず、未確定は合計から除外',()=>{
    const d=makeDay(),r={...rows[0],id:'x',owner:'hold',confirmed:false,legId:EtcJourney.suggestion(rows[0],d),legSuggested:true,claimAmount:800};
    assert.equal(EtcJourney.validDecision(r,d),false);
    const tot=EtcJourney.totals([r],d);assert.equal(tot.amount,0);assert.equal(tot.pending,1);
});
