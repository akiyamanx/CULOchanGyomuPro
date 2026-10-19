const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function fixture() {
    const stores={drafts:new Map(),summaries:new Map()},storage=new Map([['travelExpenseDrafts',JSON.stringify([{id:123,date:'旧下書き',rows:[{parking:'300'}]}])]]);
    let fail=false;
    const db={transaction(names,mode) {
        const pending=Object.fromEntries(Object.entries(stores).map(([name,map])=>[name,new Map(map)]));
        const tx={objectStore(name) {return {
            getAll:()=>({result:structuredClone([...stores[name].values()])}),get:id=>({result:structuredClone(stores[name].get(id))}),
            put:item=>pending[name].set(item.id,structuredClone(item)),delete:id=>pending[name].delete(id)
        }},abort(){fail=true}};
        setImmediate(()=>{if(fail && mode==='readwrite'){tx.error=Error('quota');tx.onabort?.();}else {if(mode==='readwrite')Object.assign(stores,pending);tx.oncomplete?.();}});
        return tx;
    }};
    const context=vm.createContext({indexedDB:{open(){const r={result:db};queueMicrotask(()=>r.onsuccess());return r}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}});
    vm.runInContext(fs.readFileSync('expense/expense-draft-store.js','utf8')+'\nthis.store=ExpenseDraftStore;',context);
    return {store:context.store,stores,storage,fail:()=>{fail=true}};
}
test('写真と説明を精算書と一緒に保存し、通常明細を後から変更しても保存時の内容を保持する',async()=>{
    const f=fixture(),draft={id:'draft_1',createdAt:200,rows:[{parking:'1500'}],parkingReceipts:{pageSize:6,items:[{id:'p',imageDataUrl:'original-photo',visitCompany:'保存時の会社',machineName:'DP400',purpose:'修理',pdfScale:80}]}};
    await f.store.save(draft);draft.parkingReceipts.items[0].visitCompany='変更後の会社';draft.parkingReceipts.items[0].imageDataUrl='changed';
    const restored=await f.store.get('draft_1');assert.equal(restored.parkingReceipts.items[0].visitCompany,'保存時の会社');assert.equal(restored.parkingReceipts.items[0].imageDataUrl,'original-photo');assert.equal(restored.parkingReceipts.pageSize,6);
    const list=await f.store.list();assert.equal(list.length,2);assert.equal(list[0].receiptCount,1);assert.equal('parkingReceipts' in list[0],false);assert.equal((await f.store.get(123)).rows[0].parking,'300');
});
test('保存失敗時は一覧だけ残さず、以前の下書きも失わない',async()=>{
    const f=fixture();await f.store.save({id:'first'});f.fail();await assert.rejects(f.store.save({id:'broken',parkingReceipts:{items:[{imageDataUrl:'img'}]}}),/quota/);
    assert.equal(f.stores.drafts.has('broken'),false);assert.equal(f.stores.summaries.has('broken'),false);assert.ok(await f.store.get('first'));assert.ok(await f.store.get(123));
});
test('新旧下書きを個別削除しても他方と通常の領収書には触れない',async()=>{
    const f=fixture();await f.store.save({id:'new'});await f.store.remove(123);assert.equal(await f.store.get(123),undefined);assert.ok(await f.store.get('new'));await f.store.remove('new');assert.equal((await f.store.list()).length,0);
});
