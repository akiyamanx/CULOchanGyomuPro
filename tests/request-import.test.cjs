const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Parser = require('../map/request-parser');

// Synthetic documents: real customer documents/contacts must not enter this repository.
test('ACWITH一覧の顧客名・県＋住所・電話を読み、末尾の案内文を取り込まない', () => {
    const rows = [['2026年9月 ACWITH フィルター交換リスト'],[],['顧客名','郵便番号','都道府県','住所','携帯電話','シリアル№'],
        ['架空保育園','0000000','千葉県','架空市例町1','0000000000','CR123'],[],['いつもお世話になっております。'],['交換リストとなります。']];
    const [record,...rest] = Parser.parseRows(rows,'fixture');
    assert.equal(rest.length,0); assert.equal(record.company,'架空保育園');
    assert.equal(record.address,'千葉県架空市例町1'); assert.equal(record.phone,'0000000000');
    assert.equal(record.managementNo,'CR123'); assert.equal(record.purpose,'メンテナンス');
});
test('HW一覧は機種・交換内容・履歴を保持し、同じ住所の異なる客先も残す', () => {
    const result = Parser.parseRows([['メンテナンス管理マスター'],[],['設置先名','住所','固定電話','機種','ＡＣＷＩＴＨ','履歴'],
        ['架空会社A','千葉県架空市1','000-0000-0000','HW-TEST','2本','点検のみ'],
        ['架空会社B','千葉県架空市1','','HW-TEST','1本',''],['アポイントを調整してください。']]);
    assert.equal(result.length,2); assert.equal(result[0].equipType,'HW-TEST');
    assert.match(result[0].note,/点検のみ/); assert.match(result[0].note,/ＡＣＷＩＴＨ: 2本/);
});
test('設置個票のチェック済み業務・連絡先・確定日時を取り込む', () => {
    const [item] = Parser.parseRows([['業 務 依 頼 書'],['浄水器名','ACWITH + AI400','','台数','1 台'],
        ['依頼業務内容','■設置工事','□修理'],['客先名（工事先）','架空店舗 様'],['所在地','東京都架空区1'],
        ['','〒000-0000','TEL.','','携帯. 000-0000-0000'],['特記事項','2機種を設置'],
        ['','依頼SS名','試験SS'],['','工事予定日時','2026/10/10（土）18：00～確定']]);
    assert.equal(item.company,'架空店舗 様'); assert.equal(item.purpose,'本体設置');
    assert.equal(item.appoDate,'2026-10-10T18:00'); assert.equal(item.phone,'000-0000-0000');
    assert.equal(item.branch,'試験SS'); assert.match(item.note,/2機種/);
});
test('修理個票は分割住所、2連絡先、希望日の時間指定を保持する', () => {
    const [item] = Parser.parseRows([['DP-400 業務依頼書'],['会社名','架空銀行'],
        ['住所','東京都','架空区1 テストビル','','搬入時立会者'],['','','','','受付担当者','試験担当'],
        ['','TEL.','000-1111-1111','','ＴＥＬ','000-2222-2222'],['機種（型式）','DP-400','','','数量','1'],
        ['依頼業務内容','修理','','','MF000'],['作業希望日','2026-10-15','','時間指定','15:00'],
        ['備考（設置先情報）','給水しない。']]);
    assert.equal(item.address,'東京都架空区1 テストビル'); assert.equal(item.purpose,'修理');
    assert.equal(item.appoDate,'2026-10-15T15:00'); assert.match(item.phone,/000-1111-1111 \/ 000-2222-2222/);
    assert.equal(item.contact,'試験担当'); assert.equal(item.managementNo,'MF000');
});
test('PDF文字列は郵便番号と右隣の担当欄を分離し、複数日は勝手に単日にしない', () => {
    const [item] = Parser.parsePdfText('HW 設置業務依頼書\n管理No. 123\n依頼内容 設置\n本体種類 HW-TEST 数量 1\n設置日 2026/10/22-23\n設置先住所 000-0000 埼玉県架空市1 TEL 000-0000-0000\n設置先名 架空商事 設置先担当者 試験様\n備考\n本体設置 10月22日・23日');
    assert.equal(item.company,'架空商事'); assert.equal(item.address,'埼玉県架空市1');
    assert.equal(item.contact,'試験様'); assert.equal(item.phone,'000-0000-0000');
    assert.equal(item.appoDate,''); assert.match(item.note,/2026\/10\/22-23/);
});
test('日付だけ・不正日付に推測時刻を補わず、指定時刻を優先する', () => {
    assert.equal(Parser.appointment('2026/10/22'),'');
    assert.equal(Parser.appointment('2026/02/30 15:00'),'');
    assert.equal(Parser.appointment('2026-10-15 00:00:00','15:00'),'2026-10-15T15:00');
});
test('重複判定は別会社・別作業・別日時・別シリアルを同一扱いしない', () => {
    const item = {company:'架空会社',address:'東京都架空区１',purpose:'修理',managementNo:'A'};
    assert.equal(Parser.duplicate(item,{...item,address:'東京都 架空区1'}),true);
    for (const change of [{company:'別会社'},{purpose:'本体設置'},{appoDate:'2026-10-15T15:00'},{managementNo:'B'}]) {
        assert.equal(Parser.duplicate(item,{...item,...change}),false);
    }
});
test('登録先の事前読取は月を変更せず、保存失敗と不正データを隠さない', () => {
    const storage = new Map([['mm_workspace_current','2026-10'],['mm_customers_2026-09','[{"id":"existing","routeId":"route_2"}]']]);
    let fail = false;
    const context = vm.createContext({console, localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('quota');storage.set(key,value);}}});
    vm.runInContext(fs.readFileSync(require.resolve('../map/map-data-storage.js'),'utf8'),context);
    const run = code=>vm.runInContext(code,context);
    assert.equal(run("DataStorage.getCustomersForWorkspace('2026-09')[0].routeId"),'route_2');
    assert.equal(storage.get('mm_workspace_current'),'2026-10');
    fail = true;
    assert.throws(()=>run("DataStorage.saveCustomersForWorkspace('2026-09',[])"),/quota/);
    assert.match(storage.get('mm_customers_2026-09'),/existing/);
    storage.set('mm_customers_2026-09','broken');
    assert.throws(()=>run("DataStorage.getCustomersForWorkspace('2026-09')"));
});
