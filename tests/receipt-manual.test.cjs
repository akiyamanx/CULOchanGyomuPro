const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs');
function fixture(api=false) {
    const storage=new Map(api?[['gyomupro_gemini_key','unit-test-dummy']]:[]), alerts=[],nodes=new Map();
    const node=()=>({dataset:{},style:{},innerHTML:'',children:[],appendChild(child){this.children.push(child)},scrollIntoView(){},querySelector(){return {textContent:''}}});
    ['scanPreview','scanImage','recognizedList','recognizedReceipts','detectedReceipts','detectedCount','detectionResult','savedReceiptList'].forEach(id=>nodes.set(id,node()));
    let storedParking=[],calls=0;
    const ctx=vm.createContext({console:{log(){},warn(){},error(){}},setTimeout,clearTimeout,Date,Math,
        localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},
        alert:m=>alerts.push(m),confirm:()=>true,
        document:{addEventListener(){},getElementById:id=>nodes.get(id)||null,createElement:node,querySelectorAll:()=>[]},
        FileReader:class{readAsDataURL(file){this.onload({target:{result:file.data}})}},
        AppCore:{showLoading(){},hideLoading(){}},WorkflowUI:{openParking(){}},
        ParkingIDB:{migrateFromLocalStorage:async()=>({}),getAll:async()=>[],putAll:async list=>{storedParking=structuredClone(list);return true}},
        fetch:async()=>{calls++;throw Error('simulated OCR unavailable')}
    });
    vm.runInContext(fs.readFileSync('receipt/receipt-scanner.js','utf8')+'\nthis.scanner=ReceiptScanner;',ctx);
    vm.runInContext(fs.readFileSync('expense/parking-manager.js','utf8')+'\nthis.parking=ParkingManager;',ctx);
    const scanner=ctx.scanner;
    function photo(data='data:image/png;base64,TEST') {scanner.handleFileSelect({target:{files:[{name:'test.png',type:'image/png',data}],value:''}});scanner.prepareManual(true);}
    function fill() {for(const [key,val] of Object.entries({date:'2026-10-19',store:'架空駐車場 <テスト>',total:'1500',type:'parking',address:'架空区1-1',enterTime:'15:06'})) scanner.updateField(0,key,val);}
    return {ctx,scanner,storage,alerts,nodes,photo,fill,parking:()=>storedParking,calls:()=>calls};
}
test('AI失敗後も写真を保持し、入力イベントから修正して保存・駐車場へ取り込める',async()=>{
    const f=fixture(true);f.photo();await f.scanner.recognizeAll();
    const r=f.scanner.getRecognizedReceipts()[0];assert.equal(r.status,'failed');assert.equal(r.data.total,'');assert.equal(r.imageDataUrl,'data:image/png;base64,TEST');
    f.fill();
    // The amount can be saved immediately after an input event, without waiting for blur/change.
    f.nodes.get('recognizedReceipts').oninput({target:{closest:()=>({dataset:{index:'0'},querySelector:()=>({})}),hasAttribute:()=>false,dataset:{field:'total'},value:'1600'}});
    await f.scanner.saveAll();const saved=JSON.parse(f.storage.get('gyomupro_receipts'));
    assert.equal(saved[0].total,1600);assert.equal(saved[0].address,'架空区1-1');assert.equal(saved[0].enterTime,'15:06');assert.equal(saved[0].imageDataUrl,r.imageDataUrl);
    await f.ctx.parking.init();await f.scanner.sendToParking();
    assert.equal(f.parking()[0].amount,1600);assert.equal(f.parking()[0].ocrStore,'架空駐車場 <テスト>');assert.equal(f.parking()[0].machineName,'');
    assert.equal(f.parking()[0].imageDataUrl,r.imageDataUrl);
});
test('キーなしでも手入力でき、再読取は手修正を上書きしない',async()=>{
    const f=fixture();f.photo();await f.scanner.recognizeAll();assert.equal(f.calls(),0);f.fill();await f.scanner.saveAll();
    f.storage.set('gyomupro_gemini_key','unit-test-dummy');await f.scanner.recognizeAll();assert.equal(f.calls(),0);assert.equal(f.scanner.getRecognizedReceipts()[0].data.total,1500);
});
test('未入力・不正日付・負数を保存/転記せず、0円は明示入力なら保存できる',async()=>{
    const f=fixture();f.photo();await f.scanner.saveAll();assert.equal(f.storage.has('gyomupro_receipts'),false);
    f.fill();f.scanner.updateField(0,'date','2026-02-30');await f.scanner.saveAll();assert.equal(f.storage.has('gyomupro_receipts'),false);
    f.fill();f.scanner.updateField(0,'total','-1');await f.ctx.parking.init();await f.scanner.sendToParking();assert.equal(f.parking().length,0);
    f.scanner.updateField(0,'total','0');await f.scanner.saveAll();assert.equal(JSON.parse(f.storage.get('gyomupro_receipts'))[0].total,0);
});
test('同一写真の修正保存は更新、同日同額でも別写真なら別の明細にする',async()=>{
    const f=fixture();f.photo();f.fill();await f.scanner.saveAll();f.scanner.updateField(0,'total','1700');await f.scanner.saveAll();
    assert.equal(JSON.parse(f.storage.get('gyomupro_receipts')).length,1);
    f.photo('data:image/png;base64,SECOND');f.fill();f.scanner.updateField(0,'total','1700');await f.scanner.saveAll();assert.equal(JSON.parse(f.storage.get('gyomupro_receipts')).length,2);
});
test('保存容量不足でも入力と写真を保持し、成功扱いしない',async()=>{
    const f=fixture();f.photo();f.fill();f.ctx.localStorage.setItem=()=>{throw Error('quota')};await f.scanner.saveAll();
    assert.match(f.alerts.at(-1),/保存できません/);assert.equal(f.scanner.getRecognizedReceipts()[0].data.total,1500);assert.ok(f.scanner.getRecognizedReceipts()[0].imageDataUrl);
});
