const test = require('node:test');
const assert = require('node:assert/strict');
const Parking = require('../expense/parking-document.js');
const Planner = require('../map/visit-planner.js');

const nov = '2026-11', dec = '2026-12';
const repo = {
    [nov]: [
        {id:'across', appoDate:'2026-11-30T22:00',appoEndDate:'2026-12-01T09:00',company:'検証用甲社'},
        {id:'midnight', appoDate:'2026-11-30T22:00',appoEndDate:'2026-12-01T00:00'},
        {id:'nov-only', appoDate:'2026-11-30T09:00'},
    ],
    [dec]: [
        {id:'day', appoDate:'2026-12-01T15:00'},
        {id:'same-month', appoDate:'2026-12-02T21:00',appoEndDate:'2026-12-03T07:00'},
        {id:'undated'},
    ],
};
const storage = {
    getWorkspaces:()=>[nov,dec,dec].map(id=>({id})),
    getCurrentWorkspaceId:()=>dec,
    getCustomersForWorkspace:id=>repo[id] || [],
};
const choices = (date,other=false) => Parking.workspaceCandidates(storage,date,other,Planner.onDay);
const ids = list => list.map(x=>x.customer.id);

test('月またぎの訪問は翌月の利用日でも選べる。翌日0時終了や単日の予定は混ぜない', () => {
    const list = choices('2026-12-01');
    assert.deepEqual(ids(list), ['across','day']);
    const patch=Parking.visitPatch(list[0].customer,list[0].workspaceId);
    assert.equal(patch.workspaceId, nov);
    assert.equal(patch.customerId,'across');
    assert.equal(Object.hasOwn(patch,'date'),false);
    assert.equal(Object.hasOwn(patch,'amount'),false);
});
test('同じ月の翌日と日付なし・ほかの日の切替は従来どおり選べる', () => {
    assert.deepEqual(ids(choices('2026-12-03')), ['same-month']);
    assert.deepEqual(ids(choices('2026-12-01',true)), ['undated','across','day','same-month']);
    assert.deepEqual(ids(choices('',false)), []);
    assert.deepEqual(ids(choices('',true)), ['undated','day','same-month']);
});

test('翌月の領収書で泊まり訪問を選んでも手入力を残し、利用日変更では旧訪問の自動入力と紐付けだけ解除する',()=>{
    const {customer,workspaceId}=choices('2026-12-01')[0];
    const original={date:'2026-12-01',amount:1200,machineName:'手入力の型式'};
    const patch=Parking.visitPatch({...customer,equipType:'自動候補の型式',purpose:'点検'},workspaceId,original);
    const selected=Parking.applyEdit(original,patch);
    assert.equal(selected.workspaceId,nov);
    assert.equal(selected.customerId,'across');
    assert.equal(selected.date,'2026-12-01');
    assert.equal(selected.amount,1200);
    assert.equal(selected.machineName,'手入力の型式');
    assert.equal(selected.purpose,'点検');
    assert.equal(Parking.validate([selected]),'');
    const edited=Parking.applyEdit(selected,{date:'2026-12-02'});
    assert.equal(edited.machineName,'手入力の型式');
    assert.equal(edited.purpose,'');
    assert.equal(edited.customerId,'');
    assert.equal(edited.workspaceId,'');
    assert.equal(edited.amount,1200);
    assert.equal(edited.visitCaptionReview,true);
    assert.match(Parking.validate([edited]),/見直し/);
});
