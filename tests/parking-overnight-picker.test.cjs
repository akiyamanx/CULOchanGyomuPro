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
