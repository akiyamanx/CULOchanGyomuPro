const {test}=require('node:test');
const assert=require('node:assert/strict');
const Format=require('../shared/backup-format.js');
const Graph=require('../shared/drive-graph.js');
const fixture=()=>({local:{mm_workspaces:'[{"id":"2026-10"}]',mm_customers_202610:'[{"id":"customer","company":"架空の訪問先"}]',mm_settings:'{"homeAddress":"架空の会社住所"}'},parking:[{id:'photo',imageDataUrl:'data:image/png;base64,YWJj',originalImageDataUrl:'data:image/jpeg;base64,YWJj'}],drafts:[{id:'draft',rows:[],parkingReceipts:{items:[{id:'copy',imageDataUrl:'data:image/png;base64,YWJj'}]}}],etc:{records:[{id:'etc',imageDataUrl:'data:image/png;base64,YWJj'}],days:{},selectedDate:'2026-10-19'}});
test('写真入り保存形式は全記録を往復し、JSONキー順によらず破損検知する',async()=>{
 const source=fixture(),bundle=await Format.create(source);assert.deepEqual((await Format.parse(JSON.stringify(bundle))).payload,source);
 assert.equal(bundle.sha256,await Format.hash({etc:source.etc,drafts:source.drafts,parking:source.parking,local:source.local}));
 bundle.payload.parking[0].amount=500;await assert.rejects(Format.verify(bundle),/破損/);
});
test('接続情報・外部画像・危険なキー・欠落・重複・旧形式を拒否する',async()=>{
 for(const change of [p=>p.local.culo_google_calendar_client_id='secret',p=>p.local.mm_settings='{"apiKey":"secret"}',p=>p.parking[0].imageDataUrl='https://example.com/private.png',p=>p.drafts.push(p.drafts[0]),p=>delete p.etc,p=>p.etc.days=JSON.parse('{"__proto__":{"admin":true}}')]) {
  const p=fixture();change(p);await assert.rejects(Format.create(p));
 }
 await assert.rejects(Format.parse('{"customers":[]}'));
 await assert.rejects(Format.parse('{unfinished'));
});
const revision=(n,parents=[])=>({id:'file'+n,appProperties:{revision:String(n).padStart(36,'0'),sha256:'a'.repeat(64),savedAt:'2026-10-19T00:00:00Z',...Object.fromEntries(parents.map((v,i)=>['parent'+i,String(v).padStart(36,'0')]))}});
test('別端末からの同時送信を残し、両方を親にした明示的な選択で解決する',()=>{
 const a=revision(1),b=revision(2,[1]),c=revision(3,[1]),d=revision(4,[2,3]);
 assert.deepEqual(Graph.heads([a,b,c]).map(f=>f.id).sort(),['file2','file3']);
 assert.deepEqual(Graph.heads([a,b,c,d]).map(f=>f.id),['file4']);
 assert.throws(()=>Graph.assertSend([b],[a.appProperties.revision],false),/別の端末/);
 assert.throws(()=>Graph.assertSend([b],[],false),/別の端末/);
 assert.doesNotThrow(()=>Graph.assertSend([b],[b.appProperties.revision],false));
 assert.doesNotThrow(()=>Graph.assertSend([b,c],[],true));
});
test('不完全な共有履歴や不一致の重複版では送信・取り込みを進めない',()=>{
 assert.throws(()=>Graph.heads([revision(2,[1])]),/不足/);
 const a=revision(1),b=revision(1);b.appProperties.sha256='b'.repeat(64);
 assert.throws(()=>Graph.heads([a,b]),/一致しない/);
 assert.throws(()=>Graph.heads([revision(1,[1])]),/不正/);
});
