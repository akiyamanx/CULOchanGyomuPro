const test=require('node:test'), assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const Scan=require('../expense/parking-scan.js');
const img=i=>'data:image/jpeg;base64,'+['YWJj','ZGVm','Z2hp'][i];
const hash='8'.repeat(64);
const batch=(page=1)=>Scan.records(hash,page,[{slot:2,image:img(0)},{slot:4,image:img(1)}]);
test('scanner records preserve stable original slot and exclude original file name and guessed values',()=>{
 const rows=batch();assert.equal(rows[0].sourcePageKey,hash+':1');assert.ok(rows[0].sourceHash.endsWith(':2'));
 assert.equal(rows[0].imageDataUrl,rows[0].originalImageDataUrl);assert.equal(rows[0].pdfSelected,false);
 for(const field of ['date','amount','sourceName','ocrRead','visitCompany'])assert.equal(rows[0][field],undefined);
 assert.throws(()=>Scan.records(hash,1,[{slot:0,image:img(0)},{slot:0,image:img(1)}]));
 assert.throws(()=>Scan.records(hash,1,[{slot:0,image:img(0)},{slot:1,image:img(0)}]));
});
function setup(){
 let saved=[],writes=0,fail=false,reports=0;
 const ctx=vm.createContext({
   console,clearTimeout,alert:()=>reports++,document:{getElementById:()=>null},
   ParkingIDB:{migrateFromLocalStorage:async()=>({}),getAll:async()=>saved,putAll:async rows=>{writes++;if(fail)return false;saved=structuredClone(rows);return true;}},
   ReceiptScanner:{readParkingImage(){throw Error('Gemini must not be called automatically');}}
 });
 vm.runInContext(fs.readFileSync(require.resolve('../expense/parking-manager.js'),'utf8')+'\nthis.m=ParkingManager;',ctx);
 return {manager:ctx.m,writes:()=>writes,fail:v=>{fail=v;},alerts:()=>reports};
}
test('existing records survive, same page is atomic, and concurrent retries never duplicate',async()=>{
 const {manager:m,writes}=setup();await m.init();
 await m.append([{imageDataUrl:img(2),visitCompany:'架空旧会社',date:'2026-11-19',amount:500}]);
 const before=m.getItems()[0];
 assert.deepEqual(await Promise.all([m.appendScanPage(batch()),m.appendScanPage(batch())]),[2,0]);
 assert.equal(writes(),2);
 assert.equal(m.getItems().length,3);assert.deepEqual(m.getItems()[0],before);
 assert.equal(m.getItems()[1].pdfSelected,false);assert.equal(m.getItems()[1].date,'');
 assert.equal(await m.appendScanPage(batch(2)),-2);assert.equal(m.getItems().length,3);
});
test('failed write keeps old data and allows retry',async()=>{
 const s=setup(),m=s.manager;await m.init();
 s.fail(true);assert.equal(await m.appendScanPage(batch()),-1);assert.equal(m.getItems().length,0);
 s.fail(false);assert.equal(await m.appendScanPage(batch()),2);
 assert.equal(s.alerts(),1);
});
