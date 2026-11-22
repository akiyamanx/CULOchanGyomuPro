const fs=require('node:fs'), vm=require('node:vm'), test=require('node:test'), assert=require('node:assert/strict');
const js = f => fs.readFileSync(require.resolve('../'+f),'utf8');
function fakePage() {
    const els=new Map(), events=new Map(), timers=new Map(), inquiries=[], calls=[], transfers=[];
    function element() {
        return {style:{},dataset:{}, children:[], setAttribute(){}, addEventListener(){}, showModal(){}, close(){}, blur(){},
            append(...el){this.children.push(...el)}, appendChild(el){this.children.push(el)}, insertBefore(el){this.children.unshift(el)},
            replaceChildren(){this.children=[]},insertAdjacentElement(){},contains(){return false}};
    }
    const doc={body:element(),visibilityState:'visible',activeElement:null,querySelectorAll:()=>[],
        createElement:element,getElementById(id){if(id==='stagingBanner'||id==='mailBoxOverlay')return null; if(!els.has(id))els.set(id,element());return els.get(id);},
        addEventListener:(name,fun)=>events.set(name,fun)};
    let id=0, session=0, connected=false, approved=false, editing=false, marker='initial';
    const timer=(fn,delay)=>{timers.set(++id,{fn,delay});return id;};
    const state=()=>({connected,session,email:connected?'fixture@example.test':''});
    const drive={state,async connect(){transfers.push('connect'); connected=true;session++;return state();},async list(){transfers.push('list');return {heads:[]};},disconnect(){connected=false;session++;}};
    const adapter={ async list(){calls.push('poll');return [];}, available:()=>({connected}), };
    const core={status:()=>({}), fingerprint:()=>marker,checkpoint:()=>({ok:true}), rebase(){calls.push('rebase');},
        async remoteSignature(){await adapter.list();return {ok:true,sig:'changed'};},
        async sync(opt){assert.equal(opt.stillAllowed(),true);calls.push('write');return {ok:true,stats:{}};}};
    const ctx=vm.createContext({document:doc,DriveTransfer:drive, AppStorage:{getItem:()=>null},
        DataSync:{create:()=>core},DriveLedgerAdapter:{create:()=>adapter},BackupStore:{},
        setTimeout:timer,clearTimeout:key=>timers.delete(key),setInterval(fn){events.set('tick',fn);},
        confirm:msg=>{inquiries.push(msg);return approved;},getComputedStyle:()=>({display:'none'}),
        SettingsPanel:{canTransfer:()=>true},ExpenseManager:{isBusy:()=>false},
        alert:s=>{throw new Error(s);}});
    vm.runInContext(js('map/data-sync-ui.js')+'\n'+js('shared/transfer-ui.js')+'\nTransferUI.init();',ctx);
    async function runTimer(delay) { for (const [key,obj] of [...timers]) if(obj.delay===delay && timers.delete(key)) await obj.fn(); }
    const fire=async name=>{await events.get(name)?.(); await Promise.resolve();};
    const setup=async()=>{await fire('DOMContentLoaded');await runTimer(0);};
    const startButton=()=>doc.body.children[0].children[1];
    return {ctx,calls,transfers,drive,inquiries,doc,runTimer,fire,setup,startButton,approve:()=>{approved=true;},edit:()=>{marker='edited';editing=true;},rebase:()=>vm.runInContext('DataSyncUI.afterRestore()',ctx)};
}
test('設定のバックアップ一覧、アプリ復帰、入力後、タイマー、復元後も未許可なら同期なし',async()=>{
    const p=fakePage();await p.setup();
    await p.doc.getElementById('driveConnect').onclick();
    assert.deepEqual(p.transfers,['connect','list']);
    p.edit();await p.fire('tick');await p.fire('visibilitychange');await p.fire('focusout');await p.runTimer(300);await p.runTimer(500);await p.runTimer(2000);await p.runTimer(20000);p.rebase();
    assert.deepEqual(p.calls,['rebase']);assert.equal(p.startButton().textContent,'自動同期を始める');
    await p.startButton().onclick();  // consent dialog cancelled
    assert.deepEqual(p.calls,['rebase']);assert.match(p.inquiries[0],/fixture@example\.test/);
});
test('明示開始でのみ同期し、予約済みタイマーも再接続した別セッションには引き継がない',async()=>{
    const p=fakePage();await p.setup();p.approve();await p.startButton().onclick();
    assert.deepEqual(p.calls,['write']);assert.equal(p.startButton().textContent,'今すぐ同期');
    await p.fire('visibilitychange');assert.deepEqual(p.calls,['write','write']);
    p.edit();await p.fire('tick');
    p.drive.disconnect();await p.doc.getElementById('driveConnect').onclick();
    await p.runTimer(2000);await p.fire('visibilitychange');await p.runTimer(500);await p.fire('tick');
    assert.deepEqual(p.calls,['write','write']);assert.equal(p.startButton().textContent,'自動同期を始める');
    await p.startButton().onclick();assert.deepEqual(p.calls,['write','write','write']);
});
test('メール台帳もバックアップだけの接続では読まない。開始後も途中で切り替わった別セッションへ読みに行かない',async()=>{
    const {DriveLedgerAdapter}= {DriveLedgerAdapter:require('../map/mail-ledger-drive.js')};
    let session=1, accepted=0, requests=0;
    const adapter=DriveLedgerAdapter.create({channel:'fixture', isAllowed:s=>s.session===accepted, transport:{
        state:()=>({connected:true,session}),async appdataRequest(){requests++;session++;accepted=session;return {files:[],nextPageToken:'other-page'};}
    }});
    assert.equal(adapter.available().connected,false);
    await assert.rejects(adapter.list(),{code:'not_connected'});assert.equal(requests,0);
    accepted=session; assert.equal(adapter.available().connected,true);
    await assert.rejects(adapter.list(),{code:'not_connected'});assert.equal(requests,1);
});
