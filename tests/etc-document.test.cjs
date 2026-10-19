const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../expense/etc-document.js');
const text='利用証明書 登録番号：T1234567890123 料金所(自) テスト入口 料金所(至) テスト出口 ２６年９月３日 ８時３７分 割引前料金 ￥３，１４０－ 割引△ ￥２，３４０－ 通行料金 ￥８００－ 取扱番号 A00000-000000-000001';
test('ETC証明書は割引後通行料金と年月日時刻を読み取る',()=>{const r=E.parseCell(text);assert.equal(r.date,'2026-09-03');assert.equal(r.time,'08:37');assert.equal(r.amount,800);assert.equal(r.entry,'テスト入口');assert.equal(r.exit,'テスト出口');assert.equal(r.valid,true);assert.equal(E.parseCell(text.replace('９月３日','２月３０日')).valid,false);});
test('再取込は取扱番号で重複を防ぎ、同番号の変更は停止する',()=>{const a={...E.parseCell(text),id:'one',status:'hq'};assert.equal(E.merge([a],[{...a,status:'pending'}]).records[0].status,'hq');assert.equal(E.merge([a],[a]).added,0);assert.throws(()=>E.merge([a],[{...a,amount:900}]));assert.equal(E.merge([a],[{...a,id:'two'}]).added,1);});
test('未対応の配置や不完全な証明書を黙って捨てない',()=>{assert.throws(()=>E.pageCells([],595,842));assert.throws(()=>E.pageCells([{text:'別の書式',x:30,y:40}],842,595));assert.throws(()=>E.pageCells([{text:'利用証明書',x:30,y:40}],842,595));});
