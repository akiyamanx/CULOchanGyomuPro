// ==========================================
// CULOchan業務Pro — 精算書マネージャー v1.2
// このファイルは交通費精算書の入力・計算・下書き保存/読込/削除を担当する
// 元CULOchanSEISANshoから移植し、業務Pro用に分割・リファクタリング
// v1.1追加 - Step2マップ顧客データ連携（日付変更→アポ済み顧客→行先自動入力）
// v1.2追加 - 行先を会社名行+住所行の2フィールドに分割、住所は市区町村切り詰め
//
// 依存: app-core.js
// ==========================================

const ExpenseManager = (() => {
    let _rowCount = 0;
    let _draftBusy = false, _draftRenderVersion = 0;

    // ==========================================
    // 初期化
    // ==========================================
    function init() {
        console.log('[Expense] 精算書マネージャー初期化');
        const dateInput = document.getElementById('expSubmitDate');
        if (dateInput) {
            dateInput.value = new Date().toLocaleDateString('sv-SE');
            dateInput.addEventListener('change', _onSubmitDateChange);
        }
        addRow();
        renderDraftList();
    }

    // ==========================================
    // 行の追加・削除
    // ==========================================
    function addRow() {
        _rowCount++;
        const container = document.getElementById('expenseRows');
        if (!container) return;
        const row = document.createElement('div');
        row.className = 'exp-row';
        row.id = 'expRow-' + _rowCount;
        row.innerHTML = ''
            + '<div class="exp-row-header">'
            + '<span class="exp-row-num">' + _rowCount + '</span>'
            + '<button class="exp-row-del" aria-label="この日の明細を削除" onclick="ExpenseManager.deleteRow(' + _rowCount + ')">削除</button>'
            + '</div>'
            + '<div class="exp-fg"><label>利用日</label><input type="date" class="exp-input exp-date" onchange="ExpenseManager.onRowDateChange(this)"></div>'
            + '<div class="exp-form-row">'
            + '<div class="exp-fg exp-fg-sm" hidden><label>月</label>'
            + '<input type="number" class="exp-input exp-month" placeholder="4" min="1" max="12"></div>'
            + '<div class="exp-fg exp-fg-sm" hidden><label>日</label>'
            + '<input type="number" class="exp-input exp-day" placeholder="15" min="1" max="31"></div>'
            + '<div class="exp-fg"><label>利用交通機関</label>'
            + '<input type="text" class="exp-input exp-transport" placeholder="高速道路"></div>'
            + '</div>'
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>走行距離（km）</label>'
            + '<input type="number" class="exp-input exp-distance" placeholder="186" '
            + 'onchange="ExpenseManager.onDistanceChange(this)">'
            + '<div class="exp-hint-green">※100km以上で自動計算</div></div>'
            + '<div class="exp-fg"><label>ガソリン代（自動）</label>'
            + '<input type="number" class="exp-input exp-gas" placeholder="0" readonly></div>'
            + '</div>'
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>高速代（カンマ区切りで複数可）</label>'
            + '<input type="text" class="exp-input exp-highway" placeholder="5110" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '<div class="exp-fg exp-fg-sm"><label>枚数</label>'
            + '<input type="number" class="exp-input exp-highway-count" placeholder="8"></div>'
            + '</div>'
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>駐車場代</label><input type="number" min="0" class="exp-input exp-parking" onchange="ExpenseManager.recalculate()"></div>'
            + '</div><details class="expense-extra"><summary>その他の交通費・宿泊費</summary><div class="exp-form-row">'
            + '<div class="exp-fg"><label>その他（タクシー等）</label>'
            + '<input type="number" class="exp-input exp-other" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '<div class="exp-fg"><label>船賃</label>'
            + '<input type="number" class="exp-input exp-ship" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '</div>'
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>電車賃</label>'
            + '<input type="number" class="exp-input exp-train" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '<div class="exp-fg"><label>航空賃</label>'
            + '<input type="number" class="exp-input exp-air" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '</div>'
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>宿泊料</label>'
            + '<input type="number" class="exp-input exp-hotel" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '<div class="exp-fg"><label>宿泊先</label>'
            + '<input type="text" class="exp-input exp-hotel-name" placeholder=""></div>'
            + '</div></details>'
            + '<div class="exp-fg"><label>この日の行先</label><input type="text" class="exp-input exp-dest-company"></div>'
            + '<div class="exp-fg"><label>この日の住所</label><input type="text" class="exp-input exp-dest-address"></div>'
            + '<div class="exp-row-total">行合計: <span class="exp-row-total-val">¥0</span></div>';
        container.appendChild(row);
        row.querySelectorAll('.exp-fg').forEach((group, index) => {
            const input = group.querySelector('input'), label = group.querySelector('label');
            if (input && label) {
                input.id = row.id + '-field-' + index;
                label.htmlFor = input.id;
            }
        });
        _updateRowNumbers();
        return row;
    }

    function deleteRow(id) {
        const row = document.getElementById('expRow-' + id);
        if (row && document.querySelectorAll('.exp-row').length > 1) {
            row.remove();
            _updateRowNumbers();
            recalculate();
        }
    }

    function _updateRowNumbers() {
        document.querySelectorAll('.exp-row').forEach((row, i) => {
            const num = row.querySelector('.exp-row-num');
            if (num) num.textContent = i + 1;
        });
    }

    // ==========================================
    // 計算ロジック
    // ==========================================
    function calcGasCost(distance) {
        const km = parseInt(distance) || 0;
        return km >= 100 ? (km - 100) * 30 : 0;
    }

    function onDistanceChange(input) {
        const row = input.closest('.exp-row');
        if (!row) return;
        const gas = calcGasCost(input.value);
        row.querySelector('.exp-gas').value = gas || '';
        recalculate();
    }

    function _parseHighway(value) {
        if (!value) return 0;
        return value.split(/[,、，]/).reduce((sum, v) => sum + (parseInt(v.trim()) || 0), 0);
    }

    function recalculate() {
        let grandTotal = 0;
        document.querySelectorAll('.exp-row').forEach(row => {
            const gas = parseInt(row.querySelector('.exp-gas').value) || 0;
            const highway = _parseHighway(row.querySelector('.exp-highway').value);
            const parking = parseInt(row.querySelector('.exp-parking').value) || 0;
            const other = parseInt(row.querySelector('.exp-other').value) || 0;
            const ship = parseInt(row.querySelector('.exp-ship').value) || 0;
            const train = parseInt(row.querySelector('.exp-train').value) || 0;
            const air = parseInt(row.querySelector('.exp-air').value) || 0;
            const hotel = parseInt(row.querySelector('.exp-hotel').value) || 0;
            const rowTotal = gas + highway + parking + other + ship + train + air + hotel;
            const totalEl = row.querySelector('.exp-row-total-val');
            if (totalEl) totalEl.textContent = '¥' + rowTotal.toLocaleString();
            grandTotal += rowTotal;
        });
        const grandEl = document.getElementById('expGrandTotal');
        if (grandEl) grandEl.textContent = '¥' + grandTotal.toLocaleString();
    }

    // ==========================================
    // データ収集
    // ==========================================
    // v1.2改修 - destCompany/destAddressの2フィールド対応
    function getHeaderData() {
        return {
            submitDate: (document.getElementById('expSubmitDate') || {}).value || '',
            ssName: (document.getElementById('expSSName') || {}).value || '千葉西SS',
            destCompany: (document.getElementById('expDestCompany') || {}).value || '',
            destAddress: (document.getElementById('expDestAddress') || {}).value || '',
            employeeName: (document.getElementById('expEmployeeName') || {}).value || '小出晃也'
        };
    }

    function getRowsData() {
        const rows = [];
        document.querySelectorAll('.exp-row').forEach(row => {
            rows.push({
                date: _rowDate(row),
                parking: row.querySelector('.exp-parking').value,
                destCompany: row.querySelector('.exp-dest-company').value,
                destAddress: row.querySelector('.exp-dest-address').value,
                etcKeys: _metadata(row, 'etcKeys', []),
                etcPdfFingerprint: row.dataset.etcPdfFingerprint || '',
                parkingImports: _metadata(row, 'parkingImports', {}),
                month: row.querySelector('.exp-month').value,
                day: row.querySelector('.exp-day').value,
                transport: row.querySelector('.exp-transport').value,
                distance: row.querySelector('.exp-distance').value,
                gasCost: row.querySelector('.exp-gas').value,
                highway: row.querySelector('.exp-highway').value,
                highwayCount: row.querySelector('.exp-highway-count').value,
                other: row.querySelector('.exp-other').value,
                ship: row.querySelector('.exp-ship').value,
                train: row.querySelector('.exp-train').value,
                air: row.querySelector('.exp-air').value,
                hotel: row.querySelector('.exp-hotel').value,
                hotelName: row.querySelector('.exp-hotel-name').value
            });
        });
        return rows;
    }

    function parseHighway(value) { return _parseHighway(value); }

    function _metadata(row, key, fallback) {
        try { return JSON.parse(row.dataset[key] || JSON.stringify(fallback)); }
        catch (error) { throw new Error('取込情報を読み込めません。下書きを保存し、入力を確認してください'); }
    }

    function _rowDate(row) {
        const fullDate = row.querySelector('.exp-date').value;
        if (fullDate) return ExpenseImport.normalizeDate(fullDate);
        // 旧下書きの月・日は提出年を使用する。
        const year = getHeaderData().submitDate.slice(0, 4);
        return ExpenseImport.normalizeDate(year + '-' + row.querySelector('.exp-month').value + '-' + row.querySelector('.exp-day').value);
    }

    function onRowDateChange(input) {
        const date = ExpenseImport.normalizeDate(input.value);
        const row = input.closest('.exp-row');
        row.querySelector('.exp-month').value = date ? Number(date.slice(5, 7)) : '';
        row.querySelector('.exp-day').value = date ? Number(date.slice(8, 10)) : '';
    }

    function _assertUniqueDates(dates) {
        const rows = Array.from(document.querySelectorAll('#expenseRows .exp-row'));
        for (const date of dates) {
            if (!ExpenseImport.normalizeDate(date)) throw new Error('利用日を確認してください');
            if (rows.filter(row => _rowDate(row) === date).length > 1) {
                throw new Error(date + ' の明細が複数あります。1行にまとめてから反映してください');
            }
        }
    }

    function getOrCreateDateRow(date) {
        _assertUniqueDates([date]);
        const rows = Array.from(document.querySelectorAll('#expenseRows .exp-row'));
        let row = rows.find(item => _rowDate(item) === date);
        if (!row) row = rows.find(item => Array.from(item.querySelectorAll('input')).every(input => !input.value));
        if (!row) row = addRow();
        row.querySelector('.exp-date').value = date;
        onRowDateChange(row.querySelector('.exp-date'));
        return row;
    }

    function applyEtcRecords(records) {
        _assertUniqueDates(records.map(record => record.date));
        const rows = Array.from(document.querySelectorAll('#expenseRows .exp-row'));
        if (rows.some(row => row.dataset.etcPdfFingerprint && records.some(r => r.date === _rowDate(row))))
            throw new Error('同じ日のETC PDFが反映済みです。二重計上を防ぐため、その日は「ETC PDF・寄り道」で確認してください。');
        const imported = new Set(rows.flatMap(row => _metadata(row, 'etcKeys', [])));
        let count = 0, amount = 0;
        for (const record of records) {
            if (imported.has(record.key)) continue;
            const row = getOrCreateDateRow(record.date);
            const highway = row.querySelector('.exp-highway');
            highway.value = _parseHighway(highway.value) + record.amount;
            const counter = row.querySelector('.exp-highway-count');
            counter.value = (parseInt(counter.value) || 0) + 1;
            const keys = _metadata(row, 'etcKeys', []);
            keys.push(record.key);
            row.dataset.etcKeys = JSON.stringify(keys);
            imported.add(record.key);
            const transport = row.querySelector('.exp-transport');
            if (!transport.value) transport.value = '自家用車';
            count++; amount += record.amount;
        }
        recalculate();
        return { count, amount, skipped: records.length - count };
    }

    // 再反映時は以前反映した分だけ差し引く。手入力分は残す。
    function syncParking(period) {
        if (!/^\d{4}-\d{2}(?:-\d{2})?$/.test(period || '')) throw new Error('反映する利用日または月を指定してください');
        const items = ParkingManager.getItems();
        const byDate = new Map();
        let count = 0, invalid = 0;
        for (const item of items) {
            const date = ExpenseImport.normalizeDate(item.date);
            const amount = Number(item.amount);
            if (!date || !Number.isSafeInteger(amount) || amount < 0) { invalid++; continue; }
            if (!date.startsWith(period)) continue;
            if (!byDate.has(date)) byDate.set(date, {});
            byDate.get(date)[item.id] = amount;
            count++;
        }
        const existing = Array.from(document.querySelectorAll('#expenseRows .exp-row'));
        const dates = new Set([...byDate.keys(), ...existing.map(_rowDate).filter(date => date.startsWith(period))]);
        _assertUniqueDates(dates);
        // メタデータ破損があるときは、金額を書き換える前に止める。
        existing.forEach(row => _metadata(row, 'parkingImports', {}));
        for (const date of dates) {
            const row = getOrCreateDateRow(date);
            const input = row.querySelector('.exp-parking');
            const previous = Object.values(_metadata(row, 'parkingImports', {})).reduce((sum, value) => sum + Number(value), 0);
            const next = byDate.get(date) || {};
            const manual = Math.max(0, (parseInt(input.value) || 0) - previous);
            const total = manual + Object.values(next).reduce((sum, value) => sum + value, 0);
            input.value = total || '';
            row.dataset.parkingImports = JSON.stringify(next);
        }
        recalculate();
        return { count, invalid };
    }

    function reflectParkingMonth() {
        const month = (document.getElementById('expParkingMonth') || {}).value;
        try {
            const result = syncParking(month);
            alert(month + ' の駐車場明細 ' + result.count + '件を反映しました。'
                + (result.invalid ? '\n日付・金額が未確認の明細が ' + result.invalid + '件あります。' : ''));
        } catch (error) { alert(error.message); }
    }

    function applyRoute(date, totalKm, destination, options = {}) {
        if (!options.fromEtc && typeof EtcWorkflow !== 'undefined' && EtcWorkflow.isManaged(date))
            throw new Error('この日はETC・寄り道の訪問順を確認中です。「ETC PDF・寄り道」の区間距離を確認して、そこから精算書へ反映してください。');
        const row = getOrCreateDateRow(date);
        row.querySelector('.exp-dest-company').value = destination.company || '';
        row.querySelector('.exp-dest-address').value = destination.address || '';
        if (Number.isFinite(totalKm)) {
            const input = row.querySelector('.exp-distance');
            input.value = totalKm;
            onDistanceChange(input);
        }
        if (!row.querySelector('.exp-transport').value) row.querySelector('.exp-transport').value = '自家用車';
        const data = getRowsData().filter(item => item.destCompany || item.destAddress);
        _setVal('expDestCompany', data.map(item => item.month + '/' + item.day + ' ' + item.destCompany).join('\n'));
        _setVal('expDestAddress', data.map(item => item.month + '/' + item.day + ' ' + item.destAddress).join('\n'));
        recalculate();
    }

    function applyEtcDay(day, totals, km, fingerprint) {
        const existing = Array.from(document.querySelectorAll('#expenseRows .exp-row')).find(row => _rowDate(row) === day.date);
        if (existing && (_parseHighway(existing.querySelector('.exp-highway').value) || Number(existing.querySelector('.exp-distance').value)) &&
            !confirm(day.date + ' の高速代と距離を、今回確認した高速代 ' + totals.amount.toLocaleString() + '円・' + km + 'kmへ置き換えます。CSVや手入力の同日分も含めて置き換えます。よろしいですか？')) return false;
        const members = day.stops.filter(s => s.job === 'hq' && !['home_start','home_end'].includes(s.id));
        applyRoute(day.date, km, {company:members.map(s=>s.name).join(' → '),address:members.map(s=>s.address).join(' → ')}, {fromEtc:true});
        const row = getOrCreateDateRow(day.date);
        row.querySelector('.exp-highway').value = totals.amount || '';
        row.querySelector('.exp-highway-count').value = totals.accepted.length || '';
        row.dataset.etcKeys = '[]';
        row.dataset.etcPdfFingerprint = fingerprint;
        recalculate();
        alert(day.date + ' の本部提出分 ' + totals.accepted.length + '件・' + totals.amount.toLocaleString() + '円、距離 ' + km + 'kmを反映しました。下書きを保存してください。');
        return true;
    }

    // ==========================================
    // 下書き保存・読込・削除
    // ==========================================
    async function saveDraft() {
        if (_draftBusy) return;
        _draftBusy = true;
        try {
            const parkingReceipts = await ExpenseDraftReceipts.capture();
            const etcEvidence = typeof EtcWorkflow !== 'undefined' ? await EtcWorkflow.capture() : null;
            const header = getHeaderData();
            const draft = {
                id: 'draft_' + Date.now() + '_' + Math.random().toString(36).slice(2,9),
                createdAt: Date.now(), version: 2, date: new Date().toLocaleString('ja-JP'),
                ...header, destination: header.destCompany || header.destAddress,
                rows: getRowsData(), parkingReceipts, etcEvidence
            };
            await ExpenseDraftStore.save(draft);
            ExpenseDraftReceipts.load(parkingReceipts);
            await renderDraftList();
            alert('✅ 精算書と領収書 ' + parkingReceipts.items.length + '枚' + (etcEvidence?.records?.length ? '・ETC ' + etcEvidence.records.length + '件' : '') + 'を下書きに保存しました。');
            return draft.id;
        } catch(error) { alert('下書きを保存できませんでした。入力内容は画面に残っています。\n' + error.message); }
        finally { _draftBusy = false; }
    }

    async function renderDraftList() {
        const container = document.getElementById('expDraftList');
        if (!container) return;
        const version = ++_draftRenderVersion;
        try {
            const drafts = await ExpenseDraftStore.list();
            if (version !== _draftRenderVersion) return;
            if (!drafts.length) { container.innerHTML = '<p class="empty-msg">下書きはありません</p>'; return; }
            container.innerHTML = drafts.map((d,i) => '<div class="exp-draft-item"><div class="exp-draft-copy">'
                + '<strong class="exp-draft-title">' + _escHtml(d.destCompany || '（行先未入力）') + '</strong>'
                + '<div class="exp-draft-date">' + _escHtml(d.date || '') + '</div><p class="draft-receipt-note">'
                + (d.hasReceiptSnapshot ? '領収書 ' + d.receiptCount + '枚付き' : '旧下書き・領収書の保存なし') + (d.etcCount ? ' ／ ETC ' + d.etcCount + '件付き' : '') + '</p></div>'
                + '<div class="draft-actions"><button class="btn btn-secondary" data-draft-action="open" data-index="' + i + '">開く・修正</button>'
                + (d.receiptCount ? '<button class="btn btn-secondary" data-draft-action="pdf" data-index="' + i + '">領収書PDFを見る</button>' : '')
                + '<button class="exp-draft-del" aria-label="この下書きを削除" data-draft-action="delete" data-index="' + i + '">削除</button></div></div>').join('');
            container.onclick = event => {
                const button = event.target.closest('[data-draft-action]');
                if (!button) return;
                const id = drafts[Number(button.dataset.index)]?.id;
                if (id !== undefined) ({open:loadDraft,pdf:previewDraftReceipts,delete:deleteDraft})[button.dataset.draftAction]?.(id);
            };
        } catch(error) { if (version === _draftRenderVersion) container.textContent = '下書きを読み込めませんでした。ブラウザの保存設定を確認してください。'; }
    }
    async function previewDraftReceipts(id) {
        try {
            const draft = await ExpenseDraftStore.get(id);
            if (!draft?.parkingReceipts?.items.length) { alert('この下書きには領収書が保存されていません。'); return; }
            await ParkingPdf.generate(draft.parkingReceipts);
        } catch(error) { alert('下書きの領収書を開けませんでした。' + error.message); }
    }

    // v1.2改修 - destCompany/destAddress + 旧destination後方互換
    async function loadDraft(id) {
        if (_draftBusy) return;
        _draftBusy = true;
        try {
        const draft = await ExpenseDraftStore.get(id);
        if (!draft) { alert('下書きが見つかりません'); return; }
        if (!confirm('現在の入力を破棄して下書きを読み込みますか？')) return;
        if (typeof EtcWorkflow !== 'undefined') await EtcWorkflow.beforeLoad();
        _setVal('expSubmitDate', draft.submitDate || new Date().toLocaleDateString('sv-SE'));
        _setVal('expSSName', draft.ssName || '千葉西SS');
        _setVal('expEmployeeName', draft.employeeName || '小出晃也');
        _setVal('expDestCompany', draft.destCompany || draft.destination || '');
        _setVal('expDestAddress', draft.destAddress || '');
        const container = document.getElementById('expenseRows');
        if (container) container.innerHTML = '';
        _rowCount = 0;
        if (draft.rows && draft.rows.length > 0) {
            draft.rows.forEach(rd => {
                addRow();
                const row = document.getElementById('expRow-' + _rowCount);
                if (!row) return;
                row.querySelector('.exp-date').value = ExpenseImport.normalizeDate(rd.date || (draft.submitDate || '').slice(0, 4) + '-' + rd.month + '-' + rd.day);
                row.querySelector('.exp-parking').value = rd.parking || '';
                row.querySelector('.exp-dest-company').value = rd.destCompany || '';
                row.querySelector('.exp-dest-address').value = rd.destAddress || '';
                row.dataset.etcKeys = JSON.stringify(rd.etcKeys || []);
                row.dataset.etcPdfFingerprint = rd.etcPdfFingerprint || '';
                row.dataset.parkingImports = JSON.stringify(rd.parkingImports || {});
                row.querySelector('.exp-month').value = rd.month || '';
                row.querySelector('.exp-day').value = rd.day || '';
                if (row.querySelector('.exp-date').value) onRowDateChange(row.querySelector('.exp-date'));
                row.querySelector('.exp-transport').value = rd.transport || '';
                row.querySelector('.exp-distance').value = rd.distance || '';
                row.querySelector('.exp-gas').value = rd.gasCost || '';
                row.querySelector('.exp-highway').value = rd.highway || '';
                row.querySelector('.exp-highway-count').value = rd.highwayCount || '';
                row.querySelector('.exp-other').value = rd.other || '';
                row.querySelector('.exp-ship').value = rd.ship || '';
                row.querySelector('.exp-train').value = rd.train || '';
                row.querySelector('.exp-air').value = rd.air || '';
                row.querySelector('.exp-hotel').value = rd.hotel || '';
                row.querySelector('.exp-hotel-name').value = rd.hotelName || '';
                if (rd.other || rd.ship || rd.train || rd.air || rd.hotel || rd.hotelName) {
                    row.querySelector('.expense-extra').open = true;
                }
            });
        } else { addRow(); }
        recalculate();
        ExpenseDraftReceipts.load(draft.parkingReceipts || null);
        if (typeof EtcWorkflow !== 'undefined') EtcWorkflow.load(draft.etcEvidence || null);
        alert(draft.etcEvidence?.records?.length ? '✅ 精算書とETC ' + draft.etcEvidence.records.length + '件を読み込みました。「ETC PDF・寄り道」で日付を選び、確認・修正・PDF出力ができます。' : (draft.parkingReceipts ? '✅ 精算書と領収書 ' + draft.parkingReceipts.items.length + '枚を読み込みました。下の「この下書きの領収書」で確認・修正できます。' : '✅ 精算書を読み込みました。この旧下書きには領収書が保存されていません。必要な写真は駐車場欄で選び直してから保存してください。'));
        if (draft.etcEvidence?.records?.length) { document.getElementById('etcSection').open = true; document.getElementById('etcSection').scrollIntoView({block:'start'}); }
        else document.getElementById('loadedDraftReceipts')?.scrollIntoView({block:'start'});
        } catch(error) { alert('下書きを読み込めませんでした。' + error.message); }
        finally { _draftBusy = false; }
    }

    async function deleteDraft(id) {
        if (_draftBusy || !confirm('この下書きと、下書きに保存した領収書を削除しますか？通常の駐車場明細は残ります。')) return;
        try { await ExpenseDraftStore.remove(id); await renderDraftList(); }
        catch(error) { alert('下書きを削除できませんでした。' + error.message); }
    }

    // ==========================================
    // クリア
    // ==========================================
    function clearAll() {
        if (!confirm('すべての入力をクリアしますか？')) return;
        ExpenseDraftReceipts.reset();
        _setVal('expDestCompany', '');
        _setVal('expDestAddress', '');
        const container = document.getElementById('expenseRows');
        if (container) container.innerHTML = '';
        _rowCount = 0;
        addRow();
        recalculate();
    }

    // ==========================================
    // v1.1 マップ顧客連携 / v1.2 2フィールド対応
    // ==========================================
    function _onSubmitDateChange() {
        const dateInput = document.getElementById('expSubmitDate');
        if (!dateInput || !dateInput.value) return;
        const ym = dateInput.value.substring(0, 7);
        const customers = _getMapCustomers(ym);
        if (customers.length === 0) return;
        const appointed = customers.filter(c => c.status === 'appointed' && c.appoDate);
        if (appointed.length === 0) return;
        _showCustomerPicker(appointed, ym);
    }

    function _getMapCustomers(yearMonth) {
        try {
            if (typeof DataStorage !== 'undefined' && DataStorage.getCurrentWorkspaceId() === yearMonth) return DataStorage.getCustomers();
            const data = AppStorage.getItem('mm_customers_' + yearMonth);
            if (data) return JSON.parse(data);
            const oldData = AppStorage.getItem('mm_customers');
            return oldData ? JSON.parse(oldData) : [];
        } catch (e) { return []; }
    }

    // v1.2追加 - 住所を市区町村レベルに切り詰め
    // 例: 「千葉県千葉市美浜区磯辺3-31-1」→「千葉県千葉市美浜区」
    function _trimToCity(address) {
        if (!address) return '';
        const match = address.match(/^(.+?(?:都|道|府|県).+?(?:市|郡|区)(?:.+?区)?)/);
        return match ? match[1] : address;
    }

    function _showCustomerPicker(customers, yearMonth) {
        const byDate = {};
        customers.forEach(c => {
            const d = ExpenseImport.normalizeDate(c.appoDate) || '日付なし';
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(c);
        });
        const sortedDates = Object.keys(byDate).sort();
        let html = '<div class="exp-picker-header">'
            + '<h3>📍 ' + _escHtml(yearMonth) + ' のアポ済みお客様</h3>'
            + '<p>チェックしたお客様を行先に反映します</p>'
            + '<button class="exp-picker-select-all" onclick="ExpenseManager.togglePickerAll()">全選択/解除</button>'
            + '</div><div class="exp-picker-list">';
        sortedDates.forEach(date => {
            html += '<div class="exp-picker-date-group">'
                + '<div class="exp-picker-date-label">📅 ' + _escHtml(date) + '</div>';
            byDate[date].forEach(c => {
                const label = (c.company || '') + ' ' + (c.address || '');
                const purpose = c.purpose ? '（' + _escHtml(c.purpose) + '）' : '';
                html += '<label class="exp-picker-item">'
                    + '<input type="checkbox" class="exp-picker-cb" '
                    + 'data-company="' + _escAttr(c.company || '') + '" '
                    + 'data-address="' + _escAttr(c.address || '') + '" '
                    + 'data-purpose="' + _escAttr(c.purpose || '') + '" '
                    + 'data-date="' + _escAttr(date) + '" checked>'
                    + '<span class="exp-picker-label">' + _escHtml(label.trim()) + purpose + '</span>'
                    + '</label>';
            });
            html += '</div>';
        });
        html += '</div><div class="exp-picker-actions">'
            + '<button class="btn btn-primary" onclick="ExpenseManager.applyPicker()">✅ 行先に反映</button>'
            + '<button class="btn btn-secondary" onclick="ExpenseManager.closePicker()">キャンセル</button>'
            + '</div>';
        let modal = document.getElementById('expCustomerPicker');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'expCustomerPicker';
            modal.className = 'exp-picker-overlay';
            document.body.appendChild(modal);
        }
        modal.innerHTML = '<div class="exp-picker-modal">' + html + '</div>';
        modal.style.display = 'flex';
    }

    function togglePickerAll() {
        const cbs = document.querySelectorAll('.exp-picker-cb');
        const allChecked = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => { cb.checked = !allChecked; });
    }

    // v1.2改修 - 会社名行と住所行を分けて反映（住所は市区町村切り詰め）
    function applyPicker() {
        const cbs = document.querySelectorAll('.exp-picker-cb:checked');
        if (cbs.length === 0) { alert('お客様を1件以上選択してください'); return; }
        const companies = [];
        const addresses = [];
        cbs.forEach(cb => {
            if (cb.dataset.company) companies.push(cb.dataset.company);
            if (cb.dataset.address) addresses.push(_trimToCity(cb.dataset.address));
        });
        const companyLine = companies.join(' → ');
        const addressLine = addresses.join(' → ');
        const destC = document.getElementById('expDestCompany');
        const destA = document.getElementById('expDestAddress');
        if (destC) {
            if (destC.value.trim()) {
                destC.value = confirm('既存の会社名に上書き？\nキャンセルで追記')
                    ? companyLine : destC.value.trim() + ' → ' + companyLine;
            } else { destC.value = companyLine; }
        }
        if (destA) {
            if (destA.value.trim()) {
                destA.value = confirm('既存の住所に上書き？\nキャンセルで追記')
                    ? addressLine : destA.value.trim() + ' → ' + addressLine;
            } else { destA.value = addressLine; }
        }
        closePicker();
    }

    function closePicker() {
        const modal = document.getElementById('expCustomerPicker');
        if (modal) modal.style.display = 'none';
    }

    function _escHtml(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function _escAttr(str) { return String(str ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

    function _setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    return {
        init, addRow, deleteRow, onDistanceChange, recalculate, isBusy:()=>_draftBusy,
        onRowDateChange, getOrCreateDateRow, applyEtcRecords, syncParking, reflectParkingMonth, applyRoute, applyEtcDay,
        getHeaderData, getRowsData, parseHighway, calcGasCost,
        saveDraft, loadDraft, deleteDraft, renderDraftList, previewDraftReceipts, clearAll,
        trimToCity: _trimToCity,
        togglePickerAll, applyPicker, closePicker
    };
})();


