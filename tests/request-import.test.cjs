const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Parser = require('../map/request-parser');

// Synthetic documents: real customer documents/contacts must not enter this repository.
test('従来のDP-400月次一覧の設置先会社名を読み、県と住所・元の予定を保持する', () => {
    const items = Parser.parseRows([['10月','DP-400定期メンテナンスリスト'],[],['試験SS'],
        ['営業所','型式','U管理NO','交換フィルター','設置先会社名','都道府県','住所','設置先TEL','受付担当者','設置先情報','工事予定日','時間指定'],
        ['試験営業所','タ','TEST001','試験フィルター','架空会社A','千葉県','架空市1','000-0000-0000','試験担当','受付へ','14日','15:00'],
        ['試験営業所','直','TEST002','試験フィルター','架空会社B','東京都','架空区2','','','','','']]);
    assert.equal(items.length,2);
    assert.equal(items[0].company,'架空会社A');
    assert.equal(items[0].address,'千葉県架空市1');
    assert.equal(items[0].purpose,'メンテナンス');
    assert.equal(items[0].managementNo,'TEST001');
    assert.equal(items[0].phone,'000-0000-0000');
    assert.equal(items[0].contact,'試験担当');
    assert.match(items[0].note,/工事予定日: 14日/);
    assert.match(items[0].note,/時間指定: 15:00/);
    assert.equal(items[0].appoDate,'');
});
test('同梱された部品注文書の会社名・住所を訪問先として取り込まない', () => {
    assert.deepEqual(Parser.parseRows([['受注センター行'],['注文日','2026-10-01'],
        ['会社名','架空仕入先'],['住所','神奈川県架空市1'],['商品コード','商品名','数量'],
        ['P001','交換部品','12']],'月次.xlsx · 注文書'),[]);
});
test('Excelの時間指定を1899年の日付に変換せず、日付セルの年は保持する', async () => {
    const sheet = {A1:{t:'d',v:new Date(1899,11,30,15),w:'15:00',z:'h:mm'},
        B1:{t:'d',v:new Date(2026,9,14),w:'10/14',z:'m/d'}};
    const context = vm.createContext({Date,RequestParser:Parser,XLSX:{
        read:()=>({SheetNames:['一覧'],Sheets:{'一覧':sheet}}),
        utils:{sheet_to_json:s=>[['会社名','住所','時間指定','工事予定日'],['架空会社','東京都架空区1',s.A1.w,s.B1.w]]}
    },module:{exports:{}}});
    vm.runInContext(fs.readFileSync(require.resolve('../map/request-reader.js'),'utf8'),context);
    const [item] = await context.module.exports.read({name:'一覧.xlsx',size:100,arrayBuffer:async()=>new ArrayBuffer(0)});
    assert.match(item.note,/時間指定: 15:00/);
    assert.match(item.note,/工事予定日: 2026-10-14/);
    assert.doesNotMatch(item.note,/1899/);
});
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
test('日本時間のExcel日付はUTC変換で前日へずらさない', () => {
    const {spawnSync} = require('node:child_process');
    const code = `const assert=require('node:assert/strict'); const R=require(${JSON.stringify(require.resolve('../map/request-reader'))}); assert.equal(R.excelDate(new Date(2026,9,15)),'2026-10-15'); assert.equal(R.excelDate(new Date(2026,9,15,15,0)),'2026-10-15 15:00');`;
    const result = spawnSync(process.execPath,['-e',code],{env:{...process.env,TZ:'Asia/Tokyo'},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
});
test('PDFのカナ間の空白を整え、文字化けした管理番号を確認待ちにする', () => {
    const [item] = Parser.parsePdfText('HW 設置 業務 依頼 書 管理 No. | sw\n設置 先 名 テス トカ ロー ラ 株 式 会 社 設置 先 担 当 者 試験 様\n設置 先 住 所 東 京 都 架 空 区 1 TEL 000-0000-0000\n【 物 置 設置 】 10 月 8 日\n【 本 体 設置 】 10 月 22 日、23 日');
    assert.equal(item.company,'テストカローラ株式会社'); assert.equal(item.managementNo,'');
    assert.ok(item.warnings.some(value=>value.includes('管理番号'))); assert.match(item.note,/物置設置/);
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
    const mockStorage = {getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(fail)throw Error('quota');storage.set(key,value);},removeItem:key=>storage.delete(key)};
    const context = vm.createContext({console, localStorage:mockStorage, AppStorage:mockStorage});
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
test('登録月の判定用に、作業予定日の原文と一覧表のタイトルを項目へ残す(保存はしない)', () => {
    const [table] = Parser.parseRows([['11月','DP-400定期メンテナンスリスト'],['設置先会社名','住所','工事予定日'],['架空会社A','千葉県架空市1','11月5日']]);
    assert.equal(table.workDateText,'11月5日');
    assert.match(table.titleText,/11月/);
    const [form] = Parser.parsePdfText('設置業務依頼書\n設置先名 架空会社C\n設置先住所 東京都架空区9-9\n設置日 2026/11/05','設置.pdf · 1ページ');
    assert.equal(form.workDateText,'2026/11/05');
    const source = fs.readFileSync(require.resolve('../map/request-import.js'),'utf8');
    assert.match(source,/workDateText,titleText/,'登録するデータにworkDateText/titleTextを含めない');
});

// 実サンプルの月次一覧は、表題行に「作成日(日付だけのセル)」が並ぶ。作成日の月を表題の月と取り違えない。
test('月次一覧の表題に作成日だけのセルがあっても、表題の月だけを titleText にする', () => {
    const Month = require('../map/request-month');
    const items = Parser.parseRows([['2026年11月 フィルター交換リスト','','2026-10-26'],[],
        ['営業所','型式','設置先会社名','住所','交換フィルター'],
        ['試験営業所','タ','架空会社A','千葉県架空市1','試験フィルター']]);
    assert.equal(items.length,1);
    assert.doesNotMatch(items[0].titleText,/2026-10-26/);
    assert.match(items[0].titleText,/2026年11月/);
    const r = Month.resolveRegistrationMonth({workDateText:items[0].workDateText,titleText:items[0].titleText,today:'2026-10-28'});
    assert.equal(r.month,'2026-11');
    assert.equal(r.needsReview,false);
});
