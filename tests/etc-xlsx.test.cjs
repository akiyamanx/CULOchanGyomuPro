// ETC利用照会と同じ並びの架空Excel(.xlsx)を作って読めるか確かめる（値はすべて架空）。
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
const XlsxLite=require('../expense/xlsx-lite.js'),ExpenseImport=require('../expense/expense-import.js');
function zip(files){ // 最小限のzip（deflate）を作る
    const locals=[],centrals=[];let off=0;
    for(const [name,text] of Object.entries(files)){
        const raw=Buffer.from(text,'utf8'),data=zlib.deflateRawSync(raw),n=Buffer.from(name),crc=zlib.crc32(raw);
        const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(8,8);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(raw.length,22);h.writeUInt16LE(n.length,26);
        const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(raw.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(off,42);
        locals.push(h,n,data);centrals.push(c,n);off+=30+n.length+data.length;
    }
    const cd=Buffer.concat(centrals),e=Buffer.alloc(22);e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(centrals.length/2,8);e.writeUInt16LE(centrals.length/2,10);e.writeUInt32LE(cd.length,12);e.writeUInt32LE(off,16);
    return Buffer.concat([...locals,cd,e]);
}
const HEAD=['利用年月日（自）','時分（自）','利用年月日（至）','時分（至）','利用ＩＣ（自）','利用ＩＣ（至）','割引前料金','ＥＴＣ割引額','通行料金','還元額適用料金','後納料金','車種','車両番号','ＥＴＣカード番号','備考'];
const shared=[...HEAD,'架空湾岸','架空本町','架空第一料金所','(架空) 甲野','0000********0000'];
const si=s=>shared.indexOf(s);
const L=i=>String.fromCharCode(65+i);
function sheet(){
    const r=[];
    r.push('<row r="1"><c r="A1" t="inlineStr"><is><t>ＥＴＣ利用照会（架空）</t></is></c></row>');
    r.push('<row r="2">'+HEAD.map((h,i)=>`<c r="${L(i)}2" t="s"><v>${si(h)}</v></c>`).join('')+'</row>');
    // 2026/11/03 = 46329、08:27 = 0.352083…、日付はスタイル1（numFmt 14）、時刻はスタイル2（custom h:mm）
    const line=(n,d,t1,t2,a,b,fee)=>`<row r="${n}"><c r="A${n}" s="1"><v>${d}</v></c><c r="B${n}" s="2"><v>${t1}</v></c><c r="C${n}" s="1"><v>${d}</v></c><c r="D${n}" s="2"><v>${t2}</v></c>`+
        (a?`<c r="E${n}" t="s"><v>${si(a)}</v></c>`:'')+`<c r="F${n}" t="s"><v>${si(b)}</v></c><c r="G${n}"><v>${fee+300}</v></c><c r="H${n}"><v>300</v></c><c r="I${n}"><v>${fee}</v></c>`+
        `<c r="L${n}"><v>1</v></c><c r="M${n}" t="s"><v>${si('(架空) 甲野')}</v></c><c r="N${n}" t="s"><v>${si('0000********0000')}</v></c></row>`;
    r.push(line(3,46329,'0.35208333333333336','0.36875','架空湾岸','架空本町',860));
    r.push(line(4,46329,'0.625','0.65','','架空第一料金所',800));
    r.push(line(5,46330,'0.25','0.2708333333333333','架空湾岸','架空本町',1240));
    return '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+r.join('')+'</sheetData></worksheet>';
}
const files={
    '[Content_Types].xml':'<?xml version="1.0"?><Types/>',
    'xl/workbook.xml':'<workbook xmlns:r="r"><sheets><sheet name="利用明細" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':sheet(),
    'xl/sharedStrings.xml':'<sst>'+shared.map(s=>`<si><t>${s}</t></si>`).join('')+'</sst>',
    'xl/styles.xml':'<styleSheet><numFmts count="1"><numFmt numFmtId="164" formatCode="h:mm"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs></styleSheet>'
};
test('ETC利用照会の並びの.xlsxを行に変換（見出し行の上にタイトル行があってもよい）',async()=>{
    const rows=await XlsxLite.readFirstSheet(zip(files));
    assert.equal(rows[1][0],'利用年月日（自）');
    assert.deepEqual(rows[2].slice(0,9),['2026/11/03','08:27','2026/11/03','08:51','架空湾岸','架空本町','1160','300','860']);
    assert.equal(rows[3][4],'');
});
test('CSVと同じETC明細になる（通行料金を使う・日付ごと）',async()=>{
    const recs=ExpenseImport.parseEtcRows(await XlsxLite.readFirstSheet(zip(files)));
    assert.deepEqual(recs.map(r=>[r.date,r.amount]),[['2026-11-03',860],['2026-11-03',800],['2026-11-04',1240]]);
    assert.equal(new Set(recs.map(r=>r.key)).size,3);
});
test('日付・時刻の変換と書式の判定',()=>{
    assert.equal(XlsxLite.serialToText(46329,'date'),'2026/11/03');
    assert.equal(XlsxLite.serialToText(46329.5,'datetime'),'2026/11/03 12:00');
    assert.equal(XlsxLite.serialToText(0.75,'time'),'18:00');
    assert.equal(XlsxLite.kindOfFormat('yyyy/m/d'),'date');assert.equal(XlsxLite.kindOfFormat('[$-411]ge.m.d'),'date');
    assert.equal(XlsxLite.kindOfFormat('h:mm'),'time');assert.equal(XlsxLite.kindOfFormat('#,##0'),null);
    assert.equal(XlsxLite.kindOfFormat('"円"#,##0'),null);
});
test('2桁の年（26/11/03）も読む・古い.xlsは分かりやすく断る',async()=>{
    const recs=ExpenseImport.parseEtcRows([['利用年月日（自）','通行料金'],['26/11/03','860']]);
    assert.equal(recs[0].date,'2026-11-03');
    await assert.rejects(XlsxLite.readFirstSheet(new Uint8Array([0xD0,0xCF,0x11,0xE0]).buffer),/\.xls/);
    assert.ok(XlsxLite.isXlsx({name:'202611050822.xlsx'}));assert.ok(!XlsxLite.isXlsx({name:'a.csv',type:'text/csv'}));
});
