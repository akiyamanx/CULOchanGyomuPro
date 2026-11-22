// 本体と同じスクリプトを実際のDOMで検証する。テスト専用ページからのみ使用。
async function runExpenseTests() {
    const output = document.getElementById('testResults');
    const originalAlert = window.alert, originalConfirm = window.confirm;
    let testDraftId;
    window.alert = () => {}; window.confirm = () => true;
    const checks = [];
    function assert(condition, message) { if (!condition) throw new Error(message); checks.push('PASS ' + message); }
    try {
        await ExpenseDraftStore.replaceAll([]);
        AppStorage.removeItem('travelExpenseDrafts');
        ExpenseManager.clearAll();
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
        assert(ExpenseManager.getRowsData()[0].gasCost === '2400', '180kmは2,400円(100kmまで0円・超えた分30円)');
        assert(ExpenseManager.getRowsData()[0].destCompany === '検証株式会社', '行先・住所を日別明細へ反映');
        assert(document.getElementById('expGrandTotal').textContent === '¥5,800', 'ETC・ガソリン・駐車場を総合計');
        fixture.attachments = [{ id:'p1', date:'2026-10-08', amount:800, imageDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1sAAAAASUVORK5CYII=', purpose:'架空の点検' }];
        etcFixture = {records:[{ id:'e1', amount:1200 }], days:{}, selectedDate:'2026-10-08'};
        fixture.attachments.push({...fixture.attachments[0],id:'p2',date:'2026-09-30',amount:950});
        ExpenseDraftReceipts.updateHint();
        const attachmentReview=document.getElementById('draftReceiptReview');
        assert(attachmentReview.textContent.includes('2026-09-30 ／ 950円'),'保存欄で別の日の領収書の日付と金額を表示');
        assert(!await ExpenseManager.saveDraft() && (await ExpenseDraftStore.list()).length===0, '日付の違う領収書を未確認のまま保存しない');
        const disposition=attachmentReview.querySelector('[data-receipt-review]');
        disposition.value='exclude';
        disposition.dispatchEvent(new Event('change',{bubbles:true}));
        testDraftId = await ExpenseManager.saveDraft();
        assert((await ExpenseDraftStore.get(testDraftId)).parkingReceipts.items.length===1 && fixture.attachments.length===2,
            '今回の下書きからだけ外し、元の領収書は残す');
        fixture.attachments.pop();
        await ExpenseManager.loadDraft(testDraftId);
        assert(ExpenseManager.getRowsData()[0].parking === '100', '下書きの駐車場代を復元');
        assert(ExpenseManager.applyEtcRecords(records).count === 0, '下書き復元後のCSV再取込でも重複なし');
        fixture.routes[0].distanceResults = {'2026-10-08': {totalKm:180,signature:RouteManager.distanceSignature('route_1','2026-10-08')}};
        MapExpenseForm.init();
        document.getElementById('mapExpenseDate').value = '2026-10-08';
        MapExpenseForm.updateSummary();
        assert(document.getElementById('mapExpSummary').textContent.includes('180 km'), 'マップ集計に実際の計算済み距離を表示');
        await MapExpenseForm.reflectToExpense();
        assert(output.dataset.tab === 'expense', 'マップから反映して精算書を開く');
        const priorMonth = ExpenseManager.getOrCreateDateRow('2026-09-30');
        priorMonth.dataset.parkingImports = '{"corrected":600}';
        priorMonth.querySelector('.exp-parking').value = '800';
        const duplicate = ExpenseManager.addRow();
        duplicate.querySelector('.exp-date').value = '2026-09-30';
        duplicate.querySelector('.exp-month').value = '9';
        duplicate.querySelector('.exp-day').value = '30';
        fixture.parking.push({id:'corrected',date:'2026-10-08',amount:600});
        const beforeBlocked = JSON.stringify(ExpenseManager.getRowsData());
        let blocked = false;
        try { ExpenseManager.reflectRouteAndParking('2026-10-08',145,{company:'架空・変更後',address:'架空'}); }
        catch (e) { blocked = /2026-09-30 の明細が複数/.test(e.message); }
        assert(blocked && JSON.stringify(ExpenseManager.getRowsData())===beforeBlocked, '元月に重複があると新月の行先・距離・駐車場代を変更しない');
        duplicate.remove();
        ExpenseManager.reflectRouteAndParking('2026-10-08',145,{company:'架空・変更後',address:'架空'});
        const after = ExpenseManager.getOrCreateDateRow('2026-10-08');
        assert(after.querySelector('.exp-distance').value==='145' && after.querySelector('.exp-parking').value==='700' && priorMonth.querySelector('.exp-parking').value==='200', '月をまたぐ反映に成功しても両日の手入力の駐車場代を維持');
        priorMonth.remove();
        fixture.parking.pop();
        fixture.customers[0].address += '変更';
        assert(RouteManager.getDistance('route_1','2026-10-08') === null, '住所変更後の古い距離を使わない');
        fixture.customers[0].address = '千葉県千葉市中央区中央1-1';
        // 7行を用意し、PDFの2ページ出力を手動検証する。
        for (let day = 10; day <= 14; day++) ExpenseManager.applyRoute('2026-10-' + day, 110, {company:'架空訪問先' + day,address:'千葉県千葉市'});
        assert(ExpenseManager.getRowsData().length === 7, '7日分の明細をPDF改ページ検証用に準備');
        const correctionCsv = '利用年月日,利用ＩＣ（自）,利用ＩＣ（至）,通行料金\n2026/10/08,千葉,東京,1100';
        const corrected = ExpenseImport.parseEtcCsv(correctionCsv)[0];
        const openEtcFixture = text => new Promise((resolve,reject)=>{
            const observer=new MutationObserver(()=>{
                const select=document.querySelector('#expEtcModal .etc-review-choice');
                if(select){observer.disconnect();clearTimeout(timeout);resolve(select);}
            });
            const timeout=setTimeout(()=>{observer.disconnect();reject(Error('ETC確認画面が開きません'));},3000);
            observer.observe(document.body,{childList:true,subtree:true});
            ExpenseEtc.handleFile({target:{files:[new File([text],'fixture-etc.csv',{type:'text/csv'})],value:''}});
        });
        const choice=await openEtcFixture(correctionCsv);
        assert(choice.value===''&&choice.options[0].textContent==='今回反映しない', 'ETC候補は未承認のまま表示する');
        ExpenseEtc.toggleAll();
        ExpenseEtc.applyToExpense();
        assert(ExpenseManager.getRowsData()[0].highway==='1700', '全選択でも確認待ちのETC候補を反映しない');
        const old = ExpenseManager.reviewEtcRecords([corrected])[0].candidates[0];
        assert(old.amount===1200&&old.entry==='千葉'&&old.exit==='東京', 'ETCの差し替え候補は元の金額と区間を示す');
        choice.value='0';
        ExpenseEtc.applyToExpense();
        assert(document.getElementById('expEtcModal').style.display==='none', 'ETCの確認操作から差し替えを実行');
        assert(ExpenseManager.getRowsData()[0].highway==='1600'&&ExpenseManager.getRowsData()[0].highwayCount==='2', 'ETCの差し替えで件数と他の通行を維持');
        const revisedDraftId=await ExpenseManager.saveDraft();
        assert(revisedDraftId===testDraftId && (await ExpenseDraftStore.list()).length===1, '修正して保存しても同じ下書き1件だけ');
        const revised = await ExpenseDraftStore.get(revisedDraftId);
        assert(revised.parkingReceipts.items[0]?.purpose==='架空の点検' && revised.etcEvidence.records[0]?.amount===1200 && revised.rows[0].highway==='1600', '更新した金額と領収書・ETCの記録が一緒に残る');
        const next = {...revised, updatedAt:revised.updatedAt + 1};
        await ExpenseDraftStore.save(next, revised);
        let rejected = false;
        try { await ExpenseDraftStore.save({...revised, destCompany:'古い入力'}, revised); } catch (_) { rejected = true; }
        assert(rejected && (await ExpenseDraftStore.get(revisedDraftId)).updatedAt===next.updatedAt, '別タブで先に更新された下書きを黙って上書きしない');
        await ExpenseManager.deleteDraft(revisedDraftId);
        assert((await ExpenseDraftStore.get(revisedDraftId)).updatedAt===next.updatedAt, '編集中に別タブで更新された下書きは古い画面から削除しない');
        await ExpenseManager.loadDraft(revisedDraftId);
        assert(document.getElementById('expDraftSave').textContent==='この下書きを更新', '開いている下書きの保存先を表示');
        const copyId = await ExpenseManager.saveDraft({asCopy:true});
        assert(copyId!==revisedDraftId && (await ExpenseDraftStore.list()).length===2, '明示して別保存したときだけ件数が増える');
        await ExpenseManager.deleteDraft(revisedDraftId, revised);
        assert((await ExpenseDraftStore.get(revisedDraftId)).updatedAt===next.updatedAt, '表示が古い一覧から別の下書きを削除しない');
        await ExpenseManager.deleteDraft(copyId);
        assert(document.getElementById('expDraftSave').textContent==='下書きを新規保存', '編集中の下書きを削除したら更新先が解除される');
        assert(document.getElementById('expDestCompany').value==='' && document.getElementById('draftReceiptSource').value==='none'
            && document.getElementById('loadedDraftReceipts').hidden, '削除後、前の行先・領収書を新規下書きに引き継がない');
        await ExpenseManager.loadDraft(revisedDraftId);
        assert(ExpenseManager.applyEtcRecords(records).count===0, 'ETCの旧版は差し替え後に下書きを開き直しても再追加しない');
        const locked = ExpenseManager.getOrCreateDateRow('2026-10-08');
        const editDate = (row,value) => {
            const input=row.querySelector('.exp-date');
            input.value=value;
            input.dispatchEvent(new Event('change',{bubbles:true}));
            return input.value;
        };
        assert(editDate(locked,'2026-11-01')==='2026-10-08', '下書き復元後も取込済み行の日付を元に戻す');
        assert(locked.querySelector('.exp-date-review').hidden===false && locked.querySelector('.exp-date-review-text').textContent.includes('2026-11-01'), '訂正先とETCの確認先を画面に表示');
        assert(ExpenseManager.getRowsData()[0].highway==='1600' && ExpenseManager.applyEtcRecords(records).count===0, '元の金額と取込履歴を変更せずに保持する');
        const manual=ExpenseManager.addRow();
        manual.querySelector('.exp-other').value='100';
        assert(editDate(manual,'2026-11-02')==='2026-11-02' && manual.querySelector('.exp-date-review').hidden, '手入力だけの明細は日付を変えられる');
        const legacy=ExpenseManager.getOrCreateDateRow('2026-10-14');
        const legacyCsv='利用年月日,利用時刻,入口,出口,通行料金,割引前料金\n2026/10/14,09:30,千葉,東京,1000,1500';
        const legacyRevision='利用年月日,利用時刻,入口,出口,割引前料金,確定料金\n2026/10/14,09:30,千葉,東京,1500,800';
        legacy.dataset.etcKeys=JSON.stringify(ExpenseImport.parseEtcCsv(legacyCsv).map(r=>r.key));
        legacy.querySelector('.exp-highway').value='1600';
        legacy.querySelector('.exp-highway-count').value='1';
        const legacyChoice=await openEtcFixture(legacyRevision);
        assert(legacyChoice.value==='' && legacyChoice.options[1].disabled && !legacyChoice.textContent.includes('1,500'), '元料金の記録がない旧データは推測額を出さず差し替え不可');
        assert(document.getElementById('expEtcModal').textContent.includes('元のETC料金が記録されていない'), '差し替え不可の理由を画面に表示');
        ExpenseEtc.toggleAll();
        ExpenseEtc.applyToExpense();
        assert(legacy.querySelector('.exp-highway').value==='1600' && legacy.querySelector('.exp-highway-count').value==='1', '旧データの高速代と件数は全選択でも維持');
        ExpenseEtc.closeModal();
        window.confirm = () => false;
        AppStorage.setItem('travelExpenseDrafts', JSON.stringify([{id:123456, destination:'旧形式の架空会社', rows:[]}]));
        await ExpenseManager.loadDraft(123456);
        assert(await ExpenseManager.saveDraft()===revisedDraftId, '別の下書きを開く操作をキャンセルすると更新先は変わらない');
        window.confirm = () => true;
        await ExpenseManager.loadDraft(123456);
        assert(await ExpenseManager.saveDraft()===123456 && (await ExpenseDraftStore.list()).filter(d=>d.id===123456).length===1 && (await ExpenseDraftStore.get(123456)).version===2, '旧下書きも増やさず写真に対応する方式で更新する');
        await ExpenseManager.loadDraft(revisedDraftId);
        const snapshot = await ExpenseDraftStore.get(revisedDraftId);
        ExpenseManager.clearAll();
        document.getElementById('expDestCompany').value='新規の架空会社';
        document.getElementById('draftReceiptSource').value='none';
        const freshId = await ExpenseManager.saveDraft();
        assert(freshId!==revisedDraftId && (await ExpenseDraftStore.get(revisedDraftId)).destCompany===snapshot.destCompany, '入力クリア後の保存で以前の下書きを上書きしない');
        await ExpenseManager.deleteDraft(freshId);
        output.textContent = checks.join('\n') + '\n完了: ' + checks.length + '項目 PASS（PDFはボタンで別途出力）';
        output.dataset.result = 'pass';
    } catch (error) { output.textContent = checks.join('\n') + '\nFAIL ' + error.stack; output.dataset.result = 'fail'; }
    finally {
        window.alert = originalAlert; window.confirm = originalConfirm;
        if (testDraftId) await ExpenseDraftStore.remove(testDraftId);
    }
}
ExpenseManager.init();
