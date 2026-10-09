// 本体と同じスクリプトを実際のDOMで検証する。テスト専用ページからのみ使用。
function runExpenseTests() {
    const output = document.getElementById('testResults');
    const originalAlert = window.alert, originalConfirm = window.confirm;
    const originalDrafts = PreviewStorage.getItem('travelExpenseDrafts');
    window.alert = () => {}; window.confirm = () => true;
    const checks = [];
    function assert(condition, message) { if (!condition) throw new Error(message); checks.push('PASS ' + message); }
    try {
        document.getElementById('expenseRows').innerHTML = '';
        ExpenseManager.addRow();
        document.getElementById('expSubmitDate').value = '2026-10-09';
        fixture.parking = [{id:'park_a',date:'2026-10-08',amount:600},{id:'park_b',date:'2026-10-09',amount:800}];
        const csv = '利用年月日,利用ＩＣ（自）,利用ＩＣ（至）,通行料金\n2026/10/08,千葉,東京,"1,200"\n2026/10/08,東京,千葉,500\n2026/10/09,東京,横浜,800';
        const records = ExpenseImport.parseEtcCsv(csv);
        assert(ExpenseManager.applyEtcRecords(records).count === 3, 'ETCを3件反映');
        let rows = ExpenseManager.getRowsData();
        assert(rows.length === 2 && rows[0].highway === '1700' && rows[1].highway === '800', 'ETCを日別の2行へ分配');
        assert(rows[0].highwayCount === '2' && rows[1].highwayCount === '1', '枚数も利用日ごとに保持');
        assert(ExpenseManager.applyEtcRecords(records).count === 0, '同じCSV再取込で二重計上しない');
        ExpenseManager.syncParking('2026-10');
        assert(ExpenseManager.getRowsData()[0].parking === '600', '駐車場代を独立欄へ反映');
        ExpenseManager.syncParking('2026-10');
        assert(ExpenseManager.getRowsData()[0].parking === '600', '駐車場の再反映で二重計上しない');
        const first = ExpenseManager.getOrCreateDateRow('2026-10-08');
        first.querySelector('.exp-parking').value = '700'; // 手入力分100円を追加
        fixture.parking[0].amount = 900;
        ExpenseManager.syncParking('2026-10');
        assert(ExpenseManager.getRowsData()[0].parking === '1000', '金額変更を更新し、手入力の100円を保持');
        fixture.parking[0].date = '2026-10-09';
        ExpenseManager.syncParking('2026-10');
        assert(ExpenseManager.getRowsData()[0].parking === '100' && ExpenseManager.getRowsData()[1].parking === '1700', '駐車場の日付変更を旧行・新行へ反映');
        fixture.parking.shift();
        ExpenseManager.syncParking('2026-10');
        assert(ExpenseManager.getRowsData()[1].parking === '800', '削除した駐車場明細は反映額から除外');
        ExpenseManager.applyRoute('2026-10-08', 180, {company:'検証株式会社',address:'千葉県千葉市中央区'});
        assert(ExpenseManager.getRowsData()[0].gasCost === '2400', '既存のガソリン代ルールを維持');
        assert(ExpenseManager.getRowsData()[0].destCompany === '検証株式会社', '行先・住所を日別明細へ反映');
        assert(document.getElementById('expGrandTotal').textContent === '¥5,800', 'ETC・ガソリン・駐車場を総合計');
        ExpenseManager.saveDraft();
        const draft = JSON.parse(PreviewStorage.getItem('travelExpenseDrafts'))[0];
        ExpenseManager.loadDraft(draft.id);
        assert(ExpenseManager.getRowsData()[0].parking === '100', '下書きの駐車場代を復元');
        assert(ExpenseManager.applyEtcRecords(records).count === 0, '下書き復元後のCSV再取込でも重複なし');
        fixture.routes[0].distanceResults = {'2026-10-08': {totalKm:180,signature:RouteManager.distanceSignature('route_1','2026-10-08')}};
        MapExpenseForm.init();
        document.getElementById('mapExpenseDate').value = '2026-10-08';
        MapExpenseForm.updateSummary();
        assert(document.getElementById('mapExpSummary').textContent.includes('180 km'), 'マップ集計に実際の計算済み距離を表示');
        MapExpenseForm.reflectToExpense();
        assert(output.dataset.tab === 'expense', 'マップから反映して精算書を開く');
        fixture.customers[0].address += '変更';
        assert(RouteManager.getDistance('route_1','2026-10-08') === null, '住所変更後の古い距離を使わない');
        fixture.customers[0].address = '千葉県千葉市中央区中央1-1';
        // 7行を用意し、PDFの2ページ出力を手動検証する。
        for (let day = 10; day <= 14; day++) ExpenseManager.applyRoute('2026-10-' + day, 110, {company:'架空訪問先' + day,address:'千葉県千葉市'});
        assert(ExpenseManager.getRowsData().length === 7, '7日分の明細をPDF改ページ検証用に準備');
        output.textContent = checks.join('\n') + '\n完了: ' + checks.length + '項目 PASS（PDFはボタンで別途出力）';
        output.dataset.result = 'pass';
    } catch (error) { output.textContent = checks.join('\n') + '\nFAIL ' + error.stack; output.dataset.result = 'fail'; }
    finally {
        window.alert = originalAlert; window.confirm = originalConfirm;
        if (originalDrafts === null) PreviewStorage.removeItem('travelExpenseDrafts'); else PreviewStorage.setItem('travelExpenseDrafts', originalDrafts);
    }
}
ExpenseManager.init();

