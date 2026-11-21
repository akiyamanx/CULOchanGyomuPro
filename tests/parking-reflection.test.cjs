const test=require('node:test'), a=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function setup() {
 function makeRow(date) {
  const fields={};
  const row={dataset:{},querySelector(s){return fields[s]??={value:'',closest:()=>row}},querySelectorAll(){return Object.values(fields)}};
  row.querySelector('.exp-date').value=date;
  return row;
 }
 const row=makeRow('2026-10-08'), rows=[row];
 const nodes={parkingFilterMonth:{value:'2026-10'},parkingFilterDay:{value:''},parkingReflectPreview:{},parkingReflectButton:{},parkingReflectStatus:{},parkingReflectJump:{hidden:true}};
 const state={items:[{id:'p',date:'2026-10-08',amount:600},{id:'blank',date:'2026-10-08',amount:0},{id:'other',date:'2026-11-08',amount:900}]};
 let settle;
 const manager={getItems:()=>state.items,getSelectedItems:()=>[],settled:()=>new Promise((resolve,reject)=>{settle={resolve,reject};})};
 const ctx=vm.createContext({console,document:{getElementById:id=>nodes[id],querySelectorAll:s=>s.includes('.exp-row')?rows:[]},ParkingManager:manager});
 for(const file of ['expense-import','expense-manager'])vm.runInContext(fs.readFileSync(require.resolve('../expense/'+file+'.js'),'utf8'),ctx);
 const api=vm.runInContext('ExpenseManager',ctx);
 return {state,nodes,row,rows,makeRow,api,settle:()=>settle};
}
test('reflection waits for saved edits, ignores duplicate click, and reports amount separately from PDF photos',async()=>{
 const {state,nodes,row,api,settle}=setup();
 api.syncParking('2026-10-08');a.equal(row.querySelector('.exp-parking').value,600);
 nodes.parkingFilterDay.value='2026-10-08';api.previewParkingReflection();
 a.match(nodes.parkingReflectPreview.textContent,/2026-10-08.*600円.*0枚/);
 const pending=api.reflectParkingMonth();a.equal(nodes.parkingReflectButton.disabled,true);await api.reflectParkingMonth();
 a.equal(row.querySelector('.exp-parking').value,600);
 state.items[0].amount=800;settle().resolve();await pending;
 a.equal(row.querySelector('.exp-parking').value,800);
 a.match(nodes.parkingReflectStatus.textContent,/1件・800円.*0枚.*1件は対象外/);
});
test('changed period or failed saving cannot apply old values; all-period view disables the action',async()=>{
 const {nodes,row,api,settle}=setup();
 const pending=api.reflectParkingMonth();nodes.parkingFilterMonth.value='2026-11';settle().resolve();await pending;
 a.equal(row.querySelector('.exp-parking').value,'');a.match(nodes.parkingReflectStatus.textContent,/対象期間が変わりました/);
 const failed=api.reflectParkingMonth();settle().reject(new Error('保存失敗'));await failed;
 a.match(nodes.parkingReflectStatus.textContent,/反映できません.*保存失敗/);
 nodes.parkingFilterMonth.value='';api.previewParkingReflection();a.equal(nodes.parkingReflectButton.disabled,true);
});

test('day-only date correction moves a source across a month or year without removing manual or unrelated parking amounts',()=>{
 for(const newDate of ['2026-10-09','2026-11-09','2027-01-01']){
  const {state,row,rows,makeRow,api}=setup();
  state.items.push({id:'keep',date:'2026-10-08',amount:200});
  api.syncParking('2026-10-08');
  row.querySelector('.exp-parking').value=950; // 600 + 200 imported and 150 manual
  const target=makeRow(newDate); target.querySelector('.exp-parking').value=100; rows.push(target);
  state.items[0].date=newDate; state.items[0].amount=650;
  for(let i=0;i<2;i++){
   const result=api.syncParking(newDate);
   a.deepEqual(Array.from(result.dates),[newDate]);
   a.equal(row.querySelector('.exp-parking').value,350);
   a.deepEqual(JSON.parse(row.dataset.parkingImports),{keep:200});
   a.equal(target.querySelector('.exp-parking').value,750);
   a.deepEqual(JSON.parse(target.dataset.parkingImports),{p:650});
  }
 }
});
test('successful reflection offers a direct jump; a changed filter or failure does not',async()=>{
 const {nodes,api,settle}=setup();
 const first=api.reflectParkingMonth();settle().resolve();await first;
 a.equal(nodes.parkingReflectJump.hidden,false);
 nodes.parkingFilterDay.value='2026-10-08';api.previewParkingReflection();
 a.equal(nodes.parkingReflectJump.hidden,true);
 const next=api.reflectParkingMonth();settle().reject(new Error('save failure'));await next;
 a.equal(nodes.parkingReflectJump.hidden,true);
});
