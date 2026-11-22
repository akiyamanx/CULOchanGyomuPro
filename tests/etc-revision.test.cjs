const test=require('node:test'), a=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
function setup(){
 const fields={};
 const row={dataset:{},querySelector(s){return fields[s]??={value:'',closest:()=>row}},querySelectorAll(){return Object.values(fields)}};
 row.querySelector('.exp-date').value='2026-10-08';
 const ctx=vm.createContext({console,document:{getElementById:()=>null,querySelectorAll:s=>s.includes('.exp-row')?[row]:[]}});
 for(const file of ['expense-import','expense-manager'])vm.runInContext(fs.readFileSync(require.resolve('../expense/'+file+'.js'),'utf8'),ctx);
 return {row,api:vm.runInContext('ExpenseManager',ctx),imports:vm.runInContext('ExpenseImport',ctx)};
}
const csv=(...rows)=>'利用年月日,利用時刻,入口,出口,取扱番号,通行料金\n'+rows.map(row=>['2026/10/08',row[0],'架空入口','架空出口',row[1],row[2]].join(',')).join('\n');
test('確定額は選ぶまで加算せず、反映済み額を差し替え旧版も再加算しない',()=>{
 const {api,row,imports}=setup();
 const [before]=imports.parseEtcCsv(csv(['09:30','A1',1000]));
 const [after]=imports.parseEtcCsv(csv(['09:30','A1',800]));
 row.querySelector('.exp-highway').value='250';
 api.applyEtcRecords([before]);
 a.equal(api.reviewEtcRecords([after])[0].candidates[0].amount,1000);
 a.throws(()=>api.applyEtcRecords([after]),/差し替えか別/);
 a.equal(row.querySelector('.exp-highway').value,'1250');
 const r=api.applyEtcRecords([{...after,review:{replace:before.key}}]);
 a.equal(r.replaced,1); a.equal(r.amount,-200);
 a.equal(row.querySelector('.exp-highway').value,'1050');
 a.equal(row.querySelector('.exp-highway-count').value,'1');
 a.equal(api.applyEtcRecords([before,after]).count,0);
 a.equal(api.reviewEtcRecords([before])[0].duplicate,true);
 a.deepEqual(JSON.parse(row.dataset.etcEntries)[0].aliases,[before.key]);
});
test('異なる通行番号や時刻を残し、同じ候補も利用者が別の通行と判定できる',()=>{
 const {api,row,imports}=setup();
 const before=imports.parseEtcCsv(csv(['09:30','A1',1000],['10:30','A2',1000],['10:30','A2',1000]));
 a.equal(api.applyEtcRecords(before).count,3);
 const [after]=imports.parseEtcCsv(csv(['09:30','A1',800]));
 a.equal(api.reviewEtcRecords([after])[0].candidates.length,1);
 a.equal(api.applyEtcRecords([{...after,review:{distinct:true}}]).replaced,0);
 a.equal(row.querySelector('.exp-highway').value,'3800');
 a.equal(row.querySelector('.exp-highway-count').value,'4');
});
const previousCsv='利用年月日,利用時刻,入口,出口,通行料金,割引前料金\n2026/10/08,09:30,架空入口,架空出口,1000,1500';
const revisedCsv='利用年月日,利用時刻,入口,出口,割引前料金,確定料金\n2026/10/08,09:30,架空入口,架空出口,1500,800';
test('旧下書きは新しいファイルの列位置を使って元料金を推測せず、金額と履歴を変えない',()=>{
 const {api,row,imports}=setup();
 const [before]=imports.parseEtcCsv(previousCsv);
 const [after]=imports.parseEtcCsv(revisedCsv);
 a.equal(before.amount,1000); a.equal(after.amount,800);
 row.dataset.etcKeys=JSON.stringify([before.key]);
 row.querySelector('.exp-highway').value='1600';row.querySelector('.exp-highway-count').value='1';
 const old=api.reviewEtcRecords([after])[0].candidates[0];
 a.equal(old.key,before.key);
 a.equal(old.amount,undefined);
 a.throws(()=>api.applyEtcRecords([{...after,review:{replace:before.key}}]),/元のETC料金が記録されていない/);
 a.equal(row.querySelector('.exp-highway').value,'1600');
 a.equal(row.querySelector('.exp-highway-count').value,'1');
 a.deepEqual(JSON.parse(row.dataset.etcKeys),[before.key]);
 a.equal(row.dataset.etcEntries,undefined);
 a.equal(api.applyEtcRecords([before]).count,0);
});
test('元料金を記録した下書きなら、列が変わっても手入力分を残して差額だけ反映',()=>{
 const {api,row,imports}=setup();
 const [before]=imports.parseEtcCsv(previousCsv);
 const [after]=imports.parseEtcCsv(revisedCsv);
 api.applyEtcRecords([before]);
 row.querySelector('.exp-highway').value='1600';
 a.equal(api.reviewEtcRecords([after])[0].candidates[0].amount,1000);
 a.equal(api.applyEtcRecords([{...after,review:{replace:before.key}}]).amount,-200);
 a.equal(row.querySelector('.exp-highway').value,'1400');
 a.equal(row.querySelector('.exp-highway-count').value,'1');
});
test('保存用行データから復元した場合も、差し替え前の通行は再加算しない',()=>{
 const {api,row,imports}=setup();
 const [before]=imports.parseEtcCsv(csv(['09:30','A1',1000]));
 const [after]=imports.parseEtcCsv(csv(['09:30','A1',800]));
 api.applyEtcRecords([before]);
 api.applyEtcRecords([{...after,review:{replace:before.key}}]);
 const saved=JSON.parse(JSON.stringify(api.getRowsData()[0]));
 const restored=setup();
 restored.row.dataset.etcKeys=JSON.stringify(saved.etcKeys);
 restored.row.dataset.etcEntries=JSON.stringify(saved.etcEntries);
 restored.row.querySelector('.exp-highway').value=saved.highway;
 restored.row.querySelector('.exp-highway-count').value=saved.highwayCount;
 a.equal(restored.api.applyEtcRecords([before,after]).count,0);
 a.equal(restored.row.querySelector('.exp-highway').value,'800');
});
test('利用照会の時分（自）と車両情報で、入口のない同じ出口の通行を区別する',()=>{
 const {imports}=setup();
 const parsed=imports.parseEtcRows([
  ['利用年月日（自）','時分（自）','利用ＩＣ（自）','利用ＩＣ（至）','車両番号','通行料金'],
  ['2026/10/08','09:30','','架空出口','12-34','1000'],
  ['2026/10/08','09:30','','架空出口','12-34','800'],
  ['2026/10/08','10:30','','架空出口','12-34','800'],
  ['2026/10/08','09:30','','架空出口','55-67','800'],
 ]);
 a.equal(parsed[0].time,'09:30');
 a.equal(imports.etcCandidate(parsed[0],parsed[1]),true);
 a.equal(imports.etcCandidate(parsed[0],parsed[2]),false);
 a.equal(imports.etcCandidate(parsed[0],parsed[3]),false);
});
