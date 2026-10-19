const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Planner=require('../map/visit-planner');

test('予定は日付と時刻の両方が必要で、未定や不正日付に時刻を補わない',()=>{
    assert.equal(Planner.combine('',''),'');
    assert.equal(Planner.combine('2026-10-20',''),null);
    assert.equal(Planner.combine('','09:00'),null);
    assert.equal(Planner.combine('2026-02-29','09:00'),null);
    assert.equal(Planner.combine('2028-02-29','09:00'),'2028-02-29T09:00');
    assert.equal(Planner.combine('2026-10-20','24:00'),null);
});
test('複数の電話番号を結合せず、全角と国番号を扱い危険な文字列をリンクにしない',()=>{
    assert.deepEqual(Planner.phoneNumbers('０３－００００－００００ / 090-0000-0000'),['0300000000','09000000000']);
    assert.deepEqual(Planner.phoneNumbers('+81 (3) 0000 0000'),['+81300000000']);
    assert.deepEqual(Planner.phoneNumbers('javascript:alert(1)'),[]);
});
test('月表示は年またぎと閏年を含む42日を順に返す',()=>{
    const days=Planner.monthDays('2028-02');
    assert.equal(days.length,42);assert.ok(days.includes('2028-02-29'));
    assert.equal(new Date(days[0]+'T12:00:00').getDay(),0);
    assert.ok(Planner.monthDays('2027-01')[0].startsWith('2026-12'));
    assert.equal(new Set(days).size,42);
});
test('訪問先の保存に失敗した時は成功結果を返さず、以前の予定を残す',()=>{
    const data=new Map([['mm_workspace_current','2026-10'],['mm_customers_2026-10','[{"id":"test","appoDate":"2026-10-20T09:00"}]']]);
    const context=vm.createContext({console:{error:()=>{}},alert:()=>{},localStorage:{getItem:key=>data.get(key)||null,setItem:()=>{throw Error('quota');}}});
    vm.runInContext(fs.readFileSync(require.resolve('../map/map-data-storage'),'utf8'),context);
    assert.equal(vm.runInContext("DataStorage.updateCustomer('test',{appoDate:'2026-10-21T10:00'})",context),null);
    assert.equal(JSON.parse(data.get('mm_customers_2026-10'))[0].appoDate,'2026-10-20T09:00');
});
