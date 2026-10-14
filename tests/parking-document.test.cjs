const {test} = require('node:test');
const assert = require('node:assert/strict');
const doc = require('../expense/parking-document.js');

test('訪問先から機種・作業内容を転記し、駐車場名を機種として流用しない', () => {
    assert.deepEqual(doc.visitPatch({id:'c', company:'架空商事', equipType:'DP400', purpose:'修理'}, '2026-10'),
        {customerId:'c',visitCompany:'架空商事',machineName:'DP400',purpose:'修理',workspaceId:'2026-10',visitAddress:'',routeId:'',visitConfirmed:true});
    assert.equal(doc.visitPatch({company:'架空商事'}, '2026-10').machineName, '');
});
test('同日の訪問だけを候補にし、未確定の作業依頼も選択できる', () => {
    const customers = [{id:'b',appoDate:'2026-10-15T10:00'}, {id:'a',appoDate:'2026-10-14T09:00',status:'pending'}, {id:'c'}];
    assert.deepEqual(doc.candidates(customers,'2026-10-14').map(c=>c.id), ['a']);
    assert.equal(doc.candidates(customers,'2026-10-14',true).length,3);
});
test('対象月・日付・選択状態に合う画像だけを出力し、元明細は変更しない', () => {
    const items = [{id:'1',date:'2026-10-14',imageDataUrl:'img'}, {id:'2',date:'2026-10-14',imageDataUrl:'img',pdfSelected:false},
        {id:'3',date:'2026-11-14',imageDataUrl:'img'}, {id:'4',date:'2026-10-15',imageDataUrl:'img'}, {id:'5',date:'2026-10-14'}];
    assert.deepEqual(doc.selected(items,'2026-10','2026-10-14').map(i=>i.id),['1']);
    assert.equal(items.length,5);
});
test('6枚を基本に改ページし、4枚も選べる。空欄のまま提出しない', () => {
    const items = Array.from({length:7},(_,i)=>({id:String(i),imageDataUrl:'img',date:'2026-10-14',visitCompany:'架空',machineName:'DP400',purpose:'修理'}));
    assert.deepEqual(doc.pages(items).map(p=>p.length),[6,1]);
    assert.deepEqual(doc.pages(items,4).map(p=>p.length),[4,3]);
    assert.equal(doc.validate(items),'');
    assert.ok(doc.validate([{...items[0],machineName:''}]));
});

const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function managerFixture() {
    let records=[{id:'legacy',date:'2026-09-01',amount:300,originalImageDataUrl:'original',imageDataUrl:'edited',customField:'keep'}];
    const context=vm.createContext({console,Date,Math,document:{getElementById:()=>null},alert(){},confirm:()=>true,
        ParkingIDB:{migrateFromLocalStorage:async()=>({}),getAll:async()=>structuredClone(records),putAll:async list=>{records=structuredClone(list);return true;}}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../expense/parking-manager.js'),'utf8'),context);
    return {context,records:()=>records};
}
test('連続撮影・同時編集を直列保存し、元画像と旧明細を失わない',async()=>{
    const f=managerFixture();await vm.runInContext('ParkingManager.init()',f.context);
    await vm.runInContext("Promise.all([ParkingManager.append([{imageDataUrl:'new-1',sourceHash:'hash-1'}]),ParkingManager.append([{imageDataUrl:'new-2',sourceHash:'hash-2'}]),ParkingManager.updateField('legacy','amount','800')])",f.context);
    assert.equal(f.records().length,3);assert.equal(f.records()[0].amount,800);
    assert.equal(f.records()[0].originalImageDataUrl,'original');assert.equal(f.records()[0].customField,'keep');
    assert.equal(await vm.runInContext("ParkingManager.append([{imageDataUrl:'changed',sourceHash:'hash-1'}])",f.context),0);
    assert.equal(f.records().length,3);
});
test('日付の変更で前の日の訪問先との確定リンクを解除する',async()=>{
    const f=managerFixture();await vm.runInContext('ParkingManager.init()',f.context);
    await vm.runInContext("ParkingManager.patchItem('legacy',{customerId:'a',visitConfirmed:true,visitCompany:'架空会社'})",f.context);
    await vm.runInContext("ParkingManager.updateField('legacy','date','2026-10-14')",f.context);
    assert.equal(f.records()[0].customerId,'');assert.equal(f.records()[0].visitConfirmed,false);
    assert.equal(f.records()[0].visitCompany,'架空会社');
});
