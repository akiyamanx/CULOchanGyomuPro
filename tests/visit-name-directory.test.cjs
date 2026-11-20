const {test}=require('node:test'),a=require('node:assert/strict');
const D=require('../expense/visit-name-directory.js');
const seed=[{name:'株式会社アオテスト',reading:'あおてすと',sites:['株式会社アオテスト 西支店']}];
const visit=(company,other={})=>({id:'test',company,address:'試験用住所',...other});
test('same company across months and existing branch alias do not duplicate it',()=>{
 const dir=D.collect(seed,[visit('アオテスト（株）'),visit('（株）アオテスト　西支店'),visit('アオテスト'),visit('合同会社アオテスト')]);
 a.equal(dir.length,2); a.equal(dir.find(x=>x.name==='株式会社アオテスト').sites.length,1);
 a.equal(D.group(dir.find(x=>x.name==='株式会社アオテスト')),'あ行');
});
test('a new saved company is visible on the next read, with no source data copied',()=>{
 const byMonth={'2026-10':[visit('アオテスト')],'2026-11':[]};
 const data={getWorkspaces:()=>Object.keys(byMonth).map(id=>({id})),getCustomersForWorkspace:id=>byMonth[id]};
 a.equal(D.read(data,seed).rows.length,1);
 byMonth['2026-11'].push(visit('有限会社カキテスト',{contact:'非表示',note:'非表示'}));
 const rows=D.read(data,seed).rows;
 a.equal(rows.length,2);a.equal(D.group(rows[1]),'か行');
 a.deepEqual(Object.keys(rows[1]).sort(),['name','reading','sites']);
 byMonth['2026-10'].push(visit('カキテスト（有）')); a.deepEqual(D.read(data,seed).rows,rows);
});
test('unapproved or malformed visits are not promoted, kanji readings are not guessed',()=>{
 const r=D.collect([], [visit('要確認株式会社',{mailNeedsReview:true}),visit('名称不明'),visit('',{}),{company:'未保存株式会社'},visit('青空技研株式会社')]);
 a.deepEqual(r.map(x=>x.name),['青空技研株式会社']);a.equal(D.group(r[0]),'読み未確認');
});
test('one broken month does not replace saved data; malformed seed rejected',()=>{
 const r=D.read({getWorkspaces:()=>[{id:'2026-10'},{id:'2026-11'}],getCustomersForWorkspace:id=>{
  if(id==='2026-11')throw Error();return [visit('タテスト')];
 }},seed);
 a.equal(r.skipped,1); a.equal(r.rows.length,2);
 a.throws(()=>D.parseSeed(JSON.stringify({format:'gyomu-customer-directory-v1',customers:[{name:'A',sites:['']}] })));
});
