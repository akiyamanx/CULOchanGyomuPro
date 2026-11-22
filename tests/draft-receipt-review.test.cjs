const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function fixture() {
    const node=()=>({value:'',hidden:false,innerHTML:'',textContent:'',querySelector:()=>null,scrollIntoView(){}});
    const els=Object.fromEntries(['draftReceiptSource','draftReceiptHint','draftReceiptReview','draftReceiptLoadedOption'].map(id=>[id,node()]));
    els.draftReceiptSource.value='current';
    const row={date:'2026-11-21'};
    const photos=[{id:'same',date:'2026-11-21',amount:700},{id:'old',date:'2026-10-21',amount:950},{id:'unknown',amount:null}];
    const ctx=vm.createContext({document:{getElementById:id=>els[id]},ExpenseManager:{getRowsData:()=>[row]},ParkingManager:{getSelectedItems:()=>photos,snapshotSelected:async()=>photos}});
    for(const f of ['expense-import','expense-draft-receipts'])vm.runInContext(fs.readFileSync(require.resolve('../expense/'+f+'.js'),'utf8'),ctx);
    return {api:vm.runInContext('ExpenseDraftReceipts',ctx),els,photos,row};
}
const ids=result=>Array.from(result.items,r=>r.id);
function choose(els,n,value) { els.draftReceiptReview.onchange({target:{dataset:{receiptReview:String(n)},value}}); }
test('別の日・日付不明の写真は選択前に保存せず、選んだものだけ保存する',async()=>{
    const {api,els,photos}=fixture();
    api.updateHint();
    assert.match(els.draftReceiptReview.innerHTML,/2026-10-21.*950/);
    assert.match(els.draftReceiptReview.innerHTML,/日付不明/);
    await assert.rejects(api.capture(),/付けるか外すか/);
    choose(els,1,'exclude');choose(els,2,'include');
    const saved=await api.capture();
    assert.deepEqual(ids(saved),['same','unknown']);
    assert.equal(photos.length,3);
    api.load(saved);
    assert.deepEqual(ids(await api.capture()),['same','unknown']);
});
test('精算日や領収書の金額が変わると、以前の選択を流用しない',async()=>{
    const {api,els,photos,row}=fixture();
    photos.pop();
    api.updateHint();choose(els,1,'include');
    assert.deepEqual(ids(await api.capture()),['same','old']);
    photos[1].amount=1000;
    await assert.rejects(api.capture(),/付けるか外すか/);
    choose(els,1,'include');
    row.date='2026-12-21';
    await assert.rejects(api.capture(),/付けるか外すか/);
    els.draftReceiptSource.value='none';api.updateHint();
    assert.deepEqual(ids(await api.capture()),[]);
});
