const test=require('node:test'),assert=require('node:assert/strict');
const Parking=require('../expense/parking-document.js');
const a={id:'a',company:'架空甲社',equipType:'機種A',purpose:'修理',address:'架空住所A',routeId:'r1'};
const b={id:'b',company:'架空乙社',equipType:'機種B',purpose:'点検',address:'架空住所B',routeId:'r2'};
const base={id:'receipt',date:'2026-11-21',amount:600,imageDataUrl:'fixture'};
const linked=()=>({...base,...Parking.visitPatch(a,'2026-11',base)});
test('会社の変更で古い自動説明と訪問紐付けを外し、手入力と領収書データを残す',()=>{
  const edited=Parking.applyEdit(linked(),{purpose:'自分で書いた説明'});
  const changed=Parking.applyEdit(edited,{visitCompany:b.company});
  assert.equal(changed.machineName,'');
  assert.equal(changed.purpose,'自分で書いた説明');
  for(const f of ['customerId','workspaceId','visitAddress','routeId'])assert.equal(changed[f],'');
  assert.equal(changed.visitConfirmed,false);
  assert.equal(changed.amount,600);
  assert.equal(changed.imageDataUrl,'fixture');
  assert.match(Parking.validate([changed]),/見直/);
  const chosen={...changed,...Parking.visitPatch(b,'2026-11',changed)};
  assert.equal(chosen.machineName,'機種B');
  assert.equal(chosen.purpose,'自分で書いた説明');
  assert.equal(chosen.customerId,'b');
  assert.equal(Parking.validate([chosen]),'');
});
test('AI読取も利用日の実変更なら同じ確認を通る。同じ日付・金額変更だけならリンクを維持',()=>{
  const unchanged=Parking.applyEdit(linked(),{date:base.date,amount:900,ocrRead:true});
  assert.equal(unchanged.customerId,'a');
  assert.equal(unchanged.machineName,'機種A');
  const changed=Parking.applyEdit(unchanged,{date:'2026-11-22',amount:900,ocrRead:true});
  assert.equal(changed.machineName,'');
  assert.equal(changed.customerId,'');
  assert.equal(changed.visitConfirmed,false);
  assert.equal(changed.visitCaptionReview,true);
  assert.equal(changed.amount,900);
});
test('旧データの自動・手入力は推測で消さず、明示確認までPDFに出さない',()=>{
  const old={...base,visitCompany:a.company,machineName:'旧入力',purpose:'旧作業',customerId:'a'};
  const changed=Parking.applyEdit(old,{date:'2026-11-22'});
  assert.equal(changed.machineName,'旧入力');
  assert.match(Parking.validate([changed]),/見直/);
  const confirmed=Parking.applyEdit(changed,{visitCaptionReview:false});
  assert.equal(Parking.validate([confirmed]),'');
  assert.equal(confirmed.customerId,'');
  const newer={...changed,...Parking.visitPatch(b,'2026-11',changed)};
  assert.equal(newer.machineName,'機種B');
  assert.equal(newer.purpose,'点検');
});
test('紐付けなしの手入力を維持し、分からない機種は確認ボタンだけで出力できない',()=>{
  const hand={...base,visitCompany:a.company,machineName:'手入力の機種',purpose:'手入力の作業'};
  assert.equal(Parking.applyEdit(hand,{date:'2026-11-22'}).machineName,hand.machineName);
  assert.equal(Parking.applyEdit(linked(),{visitCompany:' '+a.company+' '}).customerId,'a');
  const changed=Parking.applyEdit(linked(),{date:'2026-11-22'});
  assert.ok(Parking.validate([Parking.applyEdit(changed,{visitCaptionReview:false})]));
});

test('live manager paths queue, persist and honor the OCR confirmation',async()=>{
  const vm=require('node:vm'), fs=require('node:fs');
  let saved=[linked()], ok=false, fail=false;
  const notices=[];
  const ctx=vm.createContext({
    ParkingDocument:Parking, clearTimeout,
    document:{getElementById:()=>null},
    confirm:()=>ok, alert:message=>notices.push(message),
    ParkingIDB:{migrateFromLocalStorage:async()=>({}),getAll:async()=>structuredClone(saved),putAll:async rows=>{if(fail)return false;saved=structuredClone(rows);return true;}},
    AppCore:{showLoading(){},hideLoading(){}},
    ReceiptScanner:{hasApiKey:()=>true,readParkingImage:async()=>({type:'parking',date:'2026-11-22',total:650})},
  });
  vm.runInContext(fs.readFileSync(require.resolve('../expense/parking-manager.js'),'utf8')+'\nthis.manager=ParkingManager;',ctx);
  const manager=ctx.manager;
  await manager.init();
  await manager.updateField('receipt','purpose','手入力を保存');
  await manager.readReceipt('receipt');
  assert.equal(saved[0].customerId,'a');
  ok=true;fail=true;
  await manager.readReceipt('receipt');
  assert.equal(saved[0].date,base.date);
  assert.equal(manager.getItemById('receipt').customerId,'a');
  assert.match(notices[0],/保存できません/);
  fail=false;
  await manager.readReceipt('receipt');
  assert.equal(saved[0].date,'2026-11-22');
  assert.equal(saved[0].customerId,'');
  assert.equal(saved[0].machineName,'');
  assert.equal(saved[0].purpose,'手入力を保存');
  await manager.init();
  assert.match(Parking.validate((await manager.snapshotSelected()).filter(Boolean)),/見直/);
});

test('loaded draft date/owner correction blocks preview until complete and explicitly checked; source unchanged',async()=>{
  const vm=require('node:vm'), fs=require('node:fs');
  const status={}, nodes={draftReceiptSource:{value:''},draftReceiptCards:{appendChild(card){this.card=card}},draftReceiptEditStatus:{},draftReceiptHint:{}};
  const inputs=new Map(), review={}, card={
    dataset:{},querySelector(k){
      if(k==='[data-draft-review]')return review;
      if(k==='[data-draft-caption-status]')return status;
      if(!inputs.has(k))inputs.set(k,{});
      return inputs.get(k);
    },
    closest(){return this;},
  };
  review.closest=()=>card;
  const ctx=vm.createContext({ExpenseManager:{getRowsData:()=>[{date:linked().date}]},ParkingDocument:Parking,document:{getElementById:id=>nodes[id],createElement:()=>card},ParkingPdf:{generate(snapshot){return Parking.validate(snapshot.items)}}});
  vm.runInContext(fs.readFileSync(require.resolve('../expense/expense-import.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(require.resolve('../expense/expense-draft-receipts.js'),'utf8')+'\nthis.drafts=ExpenseDraftReceipts;',ctx);
  const original={pageSize:6,items:[linked()]};
  ctx.drafts.load(original);
  const input=(key,value)=>nodes.draftReceiptCards.oninput({target:{dataset:{draftField:key},value,closest:()=>card}});
  input('visitCompany',b.company);
  assert.match(status.textContent,/見直/);
  assert.equal(review.hidden,false);
  assert.equal(review.disabled,true);
  input('machineName','機種B');input('purpose','点検');
  assert.equal(review.disabled,false);
  assert.match(Parking.validate((await ctx.drafts.capture()).items),/見直/);
  nodes.draftReceiptCards.onclick({target:{closest:()=>review}});
  assert.equal(review.hidden,true);
  assert.equal(Parking.validate((await ctx.drafts.capture()).items),'');
  assert.equal(original.items[0].customerId,'a');
  assert.equal(original.items[0].visitCompany,a.company);
});
