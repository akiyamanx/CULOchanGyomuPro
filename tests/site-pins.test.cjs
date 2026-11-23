const assert=require('node:assert/strict');
const test=require('node:test');
const SitePins=require('../map/site-pins.js');
const visit=(id,extra={})=>({id,company:'架空サービス㈱',address:'架空区1-2-3 中央ビル4F',managementNo:'MF000'+id,status:'appointed',appoDate:'2026-12-03T10:00',...extra});
test('枝番号と階は同じ会社同じ建物のピンだけに集約。住所・棟・会社が別なら別ピン',()=>{
 const a=visit('1',{company:'架空サービス㈱①'}),b=visit('2',{company:'架空サービス（株）②',address:'架空区1-2-3 中央ビル 5階'});
 assert.equal(SitePins.key(a),SitePins.key(b));
 for(const x of [visit('3',{address:'架空区1-2-8 中央ビル4F'}),visit('3',{address:'架空区1-2-3 中央ビルAIR 4F'}),visit('3',{company:'別会社'}),visit('3',{buildingName:'別棟'})])
   assert.notEqual(SitePins.key(a),SitePins.key(x));
 assert.notEqual(SitePins.key(visit('1',{address:''})),SitePins.key(visit('2',{address:''})));
});
test('未完了にチェックした機体と既に完了の記録には触れず、残りだけ完了する',()=>{
 const a=visit('1'),b=visit('2'),c=visit('3',{status:'completed'}),d=visit('4',{appoDate:'2026-12-04T10:00'});
 let raw=JSON.stringify([a,b,c,d]), writes=0;
 const storage={getItem:()=>raw,setItem:(k,v)=>{writes++;raw=v;}};
 const snapshot=[a,b,d];
 assert.equal(SitePins.keepByDefault(a,d),true);
 assert.equal(SitePins.keepByDefault(a,b),false);
 assert.deepEqual(SitePins.apply(storage,'2026-12',snapshot,['2','4']),{ok:true,done:1,kept:2});
 assert.deepEqual(JSON.parse(raw).map(x=>x.status),['completed','appointed','completed','appointed']);
 assert.equal(SitePins.apply(storage,'2026-12',snapshot,[]).ok,false);
 assert.equal(writes,1);
});
test('表示中に変更された予定・別現場・全件を残す場合に誤更新しない',()=>{
 const a=visit('1'),b=visit('2'),changes=[a,{...b,note:'変更済み'}];
 let raw=JSON.stringify(changes);
 const storage={getItem:()=>raw,setItem:()=>{throw Error('must not write');}};
 assert.equal(SitePins.apply(storage,'2026-12',[a,b],['1']).ok,false);
 assert.equal(SitePins.apply(storage,'bad',[a],[]).ok,false);
 assert.deepEqual(SitePins.apply(storage,'2026-12',[a],['1']),{ok:true,done:0,kept:1});
 assert.equal(SitePins.apply(storage,'2026-12',[a,{...changes[1],address:'別住所'}],[]).ok,false);
});

test('月次表の同一ビル6件はフロア表記が違っても1組。未作業の1件と別棟を誤完了しない',()=>{
 const Parser=require('../map/request-parser.js');
 const base='架空区1-2-3 架空タワー';
 const floors=['16F','16F','16F受付15階設置','16F','16F','17階中央','17階中央','17階中央'];
 const suffixes=['①','②','③','④','⑤','⑥','⑦','⑧'];
 const sheet=[['12月 DP-400定期メンテナンスリスト'],['営業所','型式','U管理NO','交換フィルター','設置先会社名','都道府県','住所','工事予定日','時間指定'],
   ...floors.map((f,i)=>['架空SS','タ','MF99800'+i,'標準','試験会社㈱'+suffixes[i],'東京都',base+(i===6?'別棟':i===7?'B':'')+' '+f,'2026-12-03','10:00'])];
 const visits=Parser.parseRows(sheet,'架空.xlsx').map((c,i)=>({...c,id:String(i),status:'appointed'}));
 assert.equal(visits.length,8);
 assert.match(visits[5].address,/17階中央$/);
 const groups=[...SitePins.group(visits).values()];
 assert.deepEqual(groups.map(g=>g.length),[6,1,1]);
 let raw=JSON.stringify(visits);
 const storage={getItem:()=>raw,setItem:(_,value)=>{raw=value;}};
 assert.deepEqual(SitePins.apply(storage,'2026-12',groups[0],['2']),{ok:true,done:5,kept:1});
 assert.deepEqual(JSON.parse(raw).filter(row=>row.status!=='completed').map(row=>row.id),['2','6','7']);
 assert.match(JSON.parse(raw)[5].address,/17階中央$/);
});
