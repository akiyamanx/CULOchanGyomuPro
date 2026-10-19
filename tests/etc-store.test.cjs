const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('ETCの保存完了はtransaction完了を待ち、失敗時は直前の保存を保持する',async()=>{
    let stored,fail=false,complete=false;
    const db={transaction(name,mode){let pending;const tx={objectStore:()=>({get:()=>({result:structuredClone(stored)}),put:v=>{pending=structuredClone(v);}})};
        setImmediate(()=>{if(mode==='readwrite'&&fail){tx.error=Error('quota');tx.onabort();}else {if(mode==='readwrite')stored=pending;complete=true;tx.oncomplete();}});return tx;}};
    const c=vm.createContext({indexedDB:{open(){const r={result:db};queueMicrotask(()=>r.onsuccess());return r}}});
    vm.runInContext(fs.readFileSync('expense/etc-store.js','utf8')+'\nthis.store=EtcStore;',c);
    const original={records:[{id:'one',imageDataUrl:'original'}],days:{}};
    const saving=c.store.save(original);assert.equal(complete,false);await saving;original.records[0].imageDataUrl='changed';assert.equal((await c.store.read()).records[0].imageDataUrl,'original');
    fail=true;await assert.rejects(c.store.save({records:[]}),/quota/);assert.equal((await c.store.read()).records.length,1);
});
