// 精算の行先: 作業日（アポ日）が同じで「完了」の訪問だけを既定にする（架空データ）。
const test=require('node:test'),assert=require('node:assert/strict');
const VisitPicker=require('../expense/visit-picker.js');
const cs=[
    {company:'甲野商店（架空）',address:'架空県甲野市1',status:'completed',appoDate:'2026-11-04'},
    {company:'乙川工業（架空）',address:'架空県乙川市2',status:'appointed',appoDate:'2026/11/04'},
    {company:'丙田物産（架空）',address:'架空県丙田市3',status:'completed',appoDate:'2026-11-05'},
    {company:'丁原（架空）',address:'架空県丁原市4',status:'appointed',appoDate:'2026-11-05'},
    {company:'未アポ（架空）',status:'pending',appoDate:'2026-11-04'},
    {company:'日付なし（架空）',status:'completed',appoDate:''}];
test('作業日が同じ完了だけを既定・アポ済みは「完了にし忘れ？」・ほかの日は別',()=>{
    const g=VisitPicker.groupForDay(cs,'2026-11-04');
    assert.deepEqual(g.done.map(c=>c.company),['甲野商店（架空）']);
    assert.deepEqual(g.forgot.map(c=>c.company),['乙川工業（架空）']);
    assert.deepEqual(g.others.map(c=>c._day),['2026-11-05','2026-11-05']);
});
test('作業日の初期値は明細の最後の日付（提出日ではない）・なければ今日',()=>{
    assert.equal(VisitPicker.defaultDay(['2026-11-03','','2026-11-04'],'2026-11-10'),'2026-11-04');
    assert.equal(VisitPicker.defaultDay([],'2026-11-10'),'2026-11-10');
});
test('精算書へ反映した訪問のうち完了でないものだけを完了の候補にする',()=>{
    const r=VisitPicker.notDone([{id:'a',status:'appointed'},{id:'b',status:'completed'},{id:'c'},null]);
    assert.deepEqual(r.map(c=>c.id),['a','c']);
});
