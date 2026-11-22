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
    const acceptedDates = new WeakMap();
    let _draftBusy = false, _draftRenderVersion = 0, _parkingBusy = false;
    let _activeDraft = null;

    // ==========================================
    // 初期化
    // ==========================================
    function init() {
        console.log('[Expense] 精算書マネージャー初期化');
        const dateInput = document.getElementById('expSubmitDate');
        if (dateInput) {
            dateInput.value = new Date().toLocaleDateString('sv-SE');
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
            + '<div class="exp-fg"><label>利用日</label><input type="date" class="exp-input exp-date" aria-describedby="' + row.id + '-date-review" onchange="ExpenseManager.onRowDateChange(this)"></div>'
            + '<div class="exp-date-review" hidden><p class="exp-date-review-text" role="status" id="' + row.id + '-date-review"></p>'
            + '<div class="exp-date-review-links"><button type="button" class="btn btn-secondary exp-date-review-parking" onclick="ExpenseManager.reviewRowImports(this,\'parking\')">駐車場明細を確認</button>'
            + '<button type="button" class="btn btn-secondary exp-date-review-etc" onclick="ExpenseManager.reviewRowImports(this,\'etc\')">ETC CSV・Excelを確認</button>'
            + '<button type="button" class="btn btn-secondary exp-date-review-pdf" onclick="ExpenseManager.reviewRowImports(this,\'pdf\')">ETC PDFを確認</button>'
            + '<button type="button" class="btn btn-secondary" onclick="this.closest(\'.exp-date-review\').hidden=true">閉じる</button></div></div>'
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
            + '<div class="exp-hint-green">※1日の距離で自動計算: 100kmまで0円・101〜200kmは1kmごと30円・201km以上は1kmごと38円(1km未満は切り捨て)</div></div>'
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
        // 1日の走行距離で計算: 0〜100kmは0円、101〜200kmは1kmごと30円、201km以上は1kmごと38円。1km未満は切り捨て。
        const km = Math.max(0, parseInt(distance, 10) || 0);
        return Math.min(Math.max(km - 100, 0), 100) * 30 + Math.max(km - 200, 0) * 38;
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
        if (typeof ExpenseDraftReceipts !== 'undefined') ExpenseDraftReceipts.updateHint?.();
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
                etcEntries: _metadata(row, 'etcEntries', []),
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
        if (acceptedDates.has(row)) return acceptedDates.get(row);
        const fullDate = row.querySelector('.exp-date').value;
        if (fullDate) return ExpenseImport.normalizeDate(fullDate);
        return legacyRowDate(row);
    }

    function legacyRowDate(row) {
        // 旧下書きの月・日は提出年を使用する。
        const year = getHeaderData().submitDate.slice(0, 4);
        return ExpenseImport.normalizeDate(year + '-' + row.querySelector('.exp-month').value + '-' + row.querySelector('.exp-day').value);
    }

    function setRowDate(row, date) {
        acceptedDates.set(row,date);
        row.querySelector('.exp-date').value = date;
        row.querySelector('.exp-month').value = date ? Number(date.slice(5, 7)) : '';
        row.querySelector('.exp-day').value = date ? Number(date.slice(8, 10)) : '';
    }

    function importedSources(row) {
        try {
            const parking = _metadata(row,'parkingImports',{});
            const keys = _metadata(row,'etcKeys',[]), entries = _metadata(row,'etcEntries',[]);
            if (!parking || typeof parking !== 'object' || Array.isArray(parking) || !Array.isArray(keys) || !Array.isArray(entries))
                return {unknown:true};
            return {parking:Object.keys(parking).length > 0, etc:keys.length > 0 || entries.length > 0, pdf:Boolean(row.dataset.etcPdfFingerprint)};
        } catch { return {unknown:true}; }
    }

    function onRowDateChange(input) {
        const row = input.closest('.exp-row');
        if (!row) return;
        const date = ExpenseImport.normalizeDate(input.value);
        const before = acceptedDates.has(row) ? acceptedDates.get(row) : legacyRowDate(row);
        const sources = importedSources(row);
        const panel = row.querySelector('.exp-date-review');
        if (date !== before && Object.values(sources).some(Boolean)) {
            setRowDate(row,before);
            if (panel) {
                const names = [sources.parking && '駐車場',sources.etc && 'ETC（CSV・Excel）',sources.pdf && 'ETC PDF'].filter(Boolean).join('・');
                row.querySelector('.exp-date-review-text').textContent = sources.unknown
                    ? '取込履歴を確認できないため、利用日と金額は変えていません。下書きと元の明細を確認してください。'
                    : (before || '日付未設定') + ' → ' + (date || '日付なし') + '：' + names + 'を取り込んだ行なので、利用日と金額は元のままです。日付を直す場合は、元の明細を確認してから正しい日に反映してください。';
                for (const key of ['parking','etc','pdf']) row.querySelector('.exp-date-review-'+key).hidden = !sources[key];
                panel.hidden = false;
            }
            return;
        }
        setRowDate(row,date);
        if (panel) panel.hidden = true;
        if (typeof ExpenseDraftReceipts !== 'undefined') ExpenseDraftReceipts.updateHint?.();
    }

    function reviewRowImports(button, source) {
        const row = button.closest('.exp-row');
        if (!row) return;
        const day = _rowDate(row);
        if (source === 'parking') {
            const monthField = document.getElementById('parkingFilterMonth');
            const dayField = document.getElementById('parkingFilterDay');
            if (day && monthField && dayField) {
                monthField.value = day.slice(0,7);
                dayField.value = day;
                const status = document.getElementById('parkingReflectStatus');
                if (status) status.textContent = '';
            }
            WorkflowUI.openParking();
            ParkingManager.renderParkingList();
        } else if (source === 'etc') {
            WorkflowUI.jumpExpense('importTitle');
        } else if (source === 'pdf') {
            const section = document.getElementById('etcSection');
            if (!section) return;
            section.open = true;
            section.querySelector('summary')?.focus({preventScroll:true});
            section.scrollIntoView({block:'start',behavior:'instant'});
        }
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
        if (!row) row = rows.find(item => !Object.values(importedSources(item)).some(Boolean) && Array.from(item.querySelectorAll('input')).every(input => !input.value));
        if (!row) row = addRow();
        setRowDate(row,date);
        return row;
    }

    function _etcRowState() {
        return Array.from(document.querySelectorAll('#expenseRows .exp-row')).map(row => {
            const dates = _rowDate(row), keys = _metadata(row, 'etcKeys', []), records=_metadata(row,'etcEntries',[]);
            if(!Array.isArray(keys)||!Array.isArray(records)||records.some(r=>!r||!keys.includes(r.key)||!Array.isArray(r.aliases||[])))
                throw new Error('保存済みETCの情報を確認してください。');
            return {row, date:dates, entries:keys.map(key=>records.find(r=>r.key===key)||{key}), changed:false};
        });
    }

    function reviewEtcRecords(records) {
        const prior = _etcRowState().flatMap(s=>s.entries);
        return records.map((record, i)=>{
            const known=prior.concat(records.slice(0,i));
            const duplicate=known.some(r=>r.key===record.key||r.aliases?.includes(record.key));
            const candidates=duplicate ? [] : known.filter(r=>ExpenseImport.etcCandidate(r,record))
                .map(r=>{
                    const old=ExpenseImport.etcStoredDetails(r);
                    return {key:r.key,date:old.date,time:old.time,entry:old.entry,exit:old.exit,amount:old.amount,
                        reference:old.reference};
                });
            return {duplicate,candidates};
        });
    }

    function applyEtcRecords(records) {
        _assertUniqueDates(records.map(record => record.date));
        const rows=_etcRowState();
        if (rows.some(s => s.row.dataset.etcPdfFingerprint && records.some(r => r.date === s.date)))
            throw new Error('同じ日のETC PDFが反映済みです。二重計上を防ぐため、その日は「ETC PDF・寄り道」で確認してください。');
        let count=0, amount=0, replaced=0;
        for (const record of records) {
            const all=rows.flatMap(s=>s.entries.map(r=>({s,r})));
            if (all.some(({r})=>r.key===record.key||r.aliases?.includes(record.key))) continue;
            const candidates=all.filter(({r})=>ExpenseImport.etcCandidate(r,record));
            const decision=record.review;
            const old=decision?.replace ? candidates.find(({r})=>r.key===decision.replace) : null;
            if (decision?.replace && !old || candidates.length && !old && decision?.distinct!==true)
                throw new Error('同じ通行の候補を確認し、差し替えか別の通行かを選び直してください。');
            if (!Number.isSafeInteger(record.amount)||record.amount<=0) throw new Error('通行料金を確認してください。');
            let s=rows.find(x=>x.date===record.date);
            if(!s){s={row:null,date:record.date,entries:[],changed:false};rows.push(s);}
            if (s.total == null) {
                s.total=s.row ? _parseHighway(String(s.row.querySelector('.exp-highway').value || '')) : 0;
                s.count=s.row ? parseInt(s.row.querySelector('.exp-highway-count').value)||0 : 0;
            }
            const clean={...record};delete clean.review;
            if(old) {
                const previous=ExpenseImport.etcStoredDetails(old.r).amount;
                if (previous == null)
                    throw new Error('元のETC料金が記録されていないため差し替えできません。元の明細を確認してください。');
                const minimum=s.entries.reduce((sum,r)=>sum+(r===old.r?previous:Number.isSafeInteger(r.amount)?r.amount:0),0);
                if (old.s!==s || s.total<minimum || s.count<s.entries.length)
                    throw new Error('元の通行が別の日付にあるか、手修正された高速代です。精算行を確認してください。');
                s.entries.splice(s.entries.indexOf(old.r),1,{...clean,aliases:[...(old.r.aliases||[]),old.r.key]});
                s.total+=record.amount-previous;amount+=record.amount-previous;replaced++;
            } else {
                s.entries.push(clean);s.total+=record.amount;s.count++;amount+=record.amount;
            }
            s.changed=true;count++;
        }
        for (const s of rows.filter(r=>r.changed)) {
            const row=s.row || getOrCreateDateRow(s.date);
            row.querySelector('.exp-highway').value=String(s.total);
            row.querySelector('.exp-highway-count').value=String(s.count);
            row.dataset.etcKeys=JSON.stringify(s.entries.map(r=>r.key));
            row.dataset.etcEntries=JSON.stringify(s.entries.filter(r=>Number.isSafeInteger(r.amount)));
            const transport=row.querySelector('.exp-transport');
            if(!transport.value)transport.value='自家用車';
        }
        recalculate();
        return {count,amount,replaced,skipped:records.length-count};
    }

    // Preview and application use the same eligible records, independent of PDF photo selection.
    function collectParking(period) {
        if (!/^(?:\d{4}-(?:0[1-9]|1[0-2]))(?:-\d{2})?$/.test(period || '')
            || (period.length === 10 && ExpenseImport.normalizeDate(period) !== period)) {
            throw new Error('明細の上で、反映する月または利用日を選んでください。');
        }
        const byDate = new Map();
        let count = 0, invalid = 0, amountTotal = 0;
        for (const item of ParkingManager.getItems()) {
            const date = ExpenseImport.normalizeDate(item.date);
            const amount = Number(item.amount);
            if (!date) { invalid++; continue; }
            if (!date.startsWith(period)) continue;
            if (!Number.isSafeInteger(amount) || amount <= 0) { invalid++; continue; }
            if (!byDate.has(date)) byDate.set(date, Object.create(null));
            byDate.get(date)[item.id] = amount;
            count++; amountTotal += amount;
        }
        return {byDate,count,invalid,amountTotal};
    }

    // 選んだ期間は再集計し、移動した同じ領収書だけを期間外の旧行から除く。
    function planParking(period) {
        const {byDate,count,invalid,amountTotal} = collectParking(period);
        const existing = Array.from(document.querySelectorAll('#expenseRows .exp-row'));
        const selectedIds = new Map();
        for (const [date, imports] of byDate)
            for (const id of Object.keys(imports)) selectedIds.set(id, date);

        const plans = [], missing = new Set(byDate.keys()), updated = new Set(byDate.keys());
        for (const row of existing) {
            const date = _rowDate(row);
            const previous = _metadata(row, 'parkingImports', {});
            if (!previous || typeof previous !== 'object' || Array.isArray(previous) ||
                Object.values(previous).some(value => !Number.isSafeInteger(Number(value)) || Number(value) < 0))
                throw new Error('駐車場の取込情報を確認してください。');
            let next;
            if (date.startsWith(period)) {
                next = byDate.get(date) || {};
                missing.delete(date);
                if (Object.keys(previous).length) updated.add(date);
            } else {
                const entries = Object.entries(previous);
                const kept = entries.filter(([id]) => !selectedIds.has(id) || selectedIds.get(id) === date);
                if (kept.length === entries.length) continue;
                next = Object.fromEntries(kept);
            }
            plans.push({row, date, previous, next});
        }
        _assertUniqueDates(new Set([...byDate.keys(), ...plans.filter(p=>p.date).map(p=>p.date)]));
        for (const date of missing) plans.push({date, previous:{}, next:byDate.get(date)});
        const sum = imports => Object.values(imports).reduce((total,value)=>total+Number(value),0);
        const updates = plans.map(({row,date,previous,next}) => {
            const manual = Math.max(0, (parseInt(row?.querySelector('.exp-parking').value) || 0) - sum(previous));
            return {row,date,value:(manual + sum(next)) || '',metadata:JSON.stringify(next)};
        });
        return {updates,result:{count, invalid, amountTotal, dates:[...updated].sort()}};
    }

    function commitParking(plan) {
        for (const {row:existing,date,value,metadata} of plan.updates) {
            const row = existing || getOrCreateDateRow(date);
            row.querySelector('.exp-parking').value = value;
            row.dataset.parkingImports = metadata;
        }
        return plan.result;
    }

    function syncParking(period) {
        const result = commitParking(planParking(period));
        recalculate();
        return result;
    }

    let lastParkingReflection = null;
    function updateParkingJump() {
        const jump = document.getElementById('parkingReflectJump');
        if (!jump) return;
        const result = lastParkingReflection;
        if (result && result.period !== parkingPeriod()) lastParkingReflection = null;
        jump.hidden = !lastParkingReflection?.dates.length;
        if (!jump.hidden) (jump.querySelector?.("button") || jump).textContent = lastParkingReflection.dates.length === 1
            ? lastParkingReflection.dates[0].slice(5).replace('-', '/') + ' の精算明細を見る'
            : '反映した精算明細を見る（' + lastParkingReflection.dates.length + '日分）';
    }
    function showReflectedParking() {
        const result = lastParkingReflection;
        if (!result?.dates.length || result.period !== parkingPeriod()) return;
        AppCore.switchTab('expense');
        const rows = Array.from(document.querySelectorAll('#expenseRows .exp-row'));
        const row = rows.find(item => result.dates.includes(_rowDate(item)));
        if (!row) { WorkflowUI.jumpExpense('expenseDetailsTitle'); return; }
        row.querySelector('.exp-parking').focus({preventScroll:true});
        row.scrollIntoView({block:'start', behavior:'instant'});
    }

    function parkingPeriod() {
        return document.getElementById('parkingFilterDay')?.value || document.getElementById('parkingFilterMonth')?.value || '';
    }
    function parkingSummary(period, data) {
        const photos = ParkingManager.getSelectedItems().length;
        return period + '｜金額 ' + data.count + '件・' + data.amountTotal.toLocaleString() + '円｜PDF用の選択写真 ' + photos + '枚'
            + (data.invalid ? '。日付または金額が未確認の ' + data.invalid + '件は対象外。' : '。');
    }
    function previewParkingReflection() {
        updateParkingJump();
        const preview = document.getElementById('parkingReflectPreview'), button = document.getElementById('parkingReflectButton');
        if (!preview || !button) return;
        const period = parkingPeriod();
        button.disabled = !period || _parkingBusy;
        try { preview.textContent = parkingSummary(period, collectParking(period)); }
        catch (error) { preview.textContent = error.message; }
    }
    async function reflectParkingMonth() {
        if (_parkingBusy) return;
        const period = parkingPeriod(), status = document.getElementById('parkingReflectStatus');
        if (!period || !status) return;
        _parkingBusy = true;
        lastParkingReflection = null;
        previewParkingReflection();
        status.textContent = '駐車場の編集内容を保存しています…';
        try {
            await ParkingManager.settled();
            if (period !== parkingPeriod()) {
                status.textContent = '対象期間が変わりました。確認してから、もう一度反映してください。';
                return;
            }
            const result = syncParking(period);
            lastParkingReflection = {period, dates:result.dates};
            status.textContent = '精算書に反映しました。' + parkingSummary(period, result);
        } catch (error) { status.textContent = '反映できませんでした。' + error.message; }
        finally { _parkingBusy = false; previewParkingReflection(); }
    }

    function validateRoute(date, options = {}) {
        if (!options.fromEtc && typeof EtcWorkflow !== 'undefined' && EtcWorkflow.isManaged(date))
            throw new Error('この日はETC・寄り道の訪問順を確認中です。「ETC PDF・寄り道」の区間距離を確認して、そこから精算書へ反映してください。');
        _assertUniqueDates([date]);
    }

    function commitRoute(date, totalKm, destination) {
        const row = getOrCreateDateRow(date);
        row.querySelector('.exp-dest-company').value = destination.company || '';
        row.querySelector('.exp-dest-address').value = destination.address || '';
        if (Number.isFinite(totalKm)) {
            const input = row.querySelector('.exp-distance');
            input.value = totalKm;
            row.querySelector('.exp-gas').value = calcGasCost(totalKm) || '';
        }
        if (!row.querySelector('.exp-transport').value) row.querySelector('.exp-transport').value = '自家用車';
    }

    function applyRoute(date, totalKm, destination, options = {}) {
        validateRoute(date, options);
        commitRoute(date, totalKm, destination);
        _refreshHeaderDestinations();
        recalculate();
    }

    function reflectRouteAndParking(date, totalKm, destination) {
        // Validate both sides before touching any rows, including parking's original date.
        validateRoute(date);
        const parking = planParking(date);
        commitRoute(date, totalKm, destination);
        const result = commitParking(parking);
        _refreshHeaderDestinations();
        recalculate();
        return result;
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
        row.dataset.etcEntries = '[]';
        row.dataset.etcPdfFingerprint = fingerprint;
        recalculate();
        alert(day.date + ' の本部提出分 ' + totals.accepted.length + '件・' + totals.amount.toLocaleString() + '円、距離 ' + km + 'kmを反映しました。下書きを保存してください。');
        return true;
    }

    // ==========================================
    // 下書き保存・読込・削除
    // ==========================================
    function selectDraftForEditing(draft) {
        _activeDraft = draft && {id:draft.id, createdAt:draft.createdAt || Number(draft.id) || 0, updatedAt:draft.updatedAt || 0};
        const save = document.getElementById('expDraftSave');
        const copy = document.getElementById('expDraftCopy');
        const hint = document.getElementById('expDraftSaveHint');
        if (save) save.textContent = _activeDraft ? 'この下書きを更新' : '下書きを新規保存';
        if (copy) copy.hidden = !_activeDraft;
        if (hint) hint.textContent = _activeDraft
            ? '「この下書きを更新」では件数は増えません。元の内容も残したいときだけ、別の下書きとして保存できます。'
            : '精算書と選んだ領収書・ETCの確認内容をまとめて保存します。';
    }
    async function saveDraft(options = {}) {
        if (_draftBusy) return;
        _draftBusy = true;
        try {
            const etcEvidence = typeof EtcWorkflow !== 'undefined' ? await EtcWorkflow.captureForDraft() : null;
            const parkingReceipts = await ExpenseDraftReceipts.capture();
            const header = getHeaderData();
            const previous = options.asCopy ? null : _activeDraft;
            const now = Math.max(Date.now(), (previous?.updatedAt || 0) + 1);
            const draft = {
                id: previous?.id ?? ('draft_' + now + '_' + Math.random().toString(36).slice(2,9)),
                createdAt: previous?.createdAt || now, updatedAt: now, version: 2, date: new Date(now).toLocaleString('ja-JP'),
                ...header, destination: header.destCompany || header.destAddress,
                rows: getRowsData(), parkingReceipts, etcEvidence
            };
            await ExpenseDraftStore.save(draft, previous);
            selectDraftForEditing(draft);
            if (typeof EtcWorkflow !== 'undefined') EtcWorkflow.markDraftSaved(etcEvidence);
            ExpenseDraftReceipts.load(parkingReceipts);
            await renderDraftList();
            alert('✅ 精算書と領収書 ' + parkingReceipts.items.length + '枚' + (etcEvidence?.records?.length ? '・ETC ' + etcEvidence.records.length + '件' : '') + (previous ? 'で、この下書きを更新しました。' : 'を下書きに保存しました。'));
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
                const draft = drafts[Number(button.dataset.index)];
                if (!draft) return;
                const action = button.dataset.draftAction;
                if (action === 'delete') deleteDraft(draft.id, draft);
                else ({open:loadDraft,pdf:previewDraftReceipts})[action]?.(draft.id);
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
        selectDraftForEditing(null);
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
                const date = ExpenseImport.normalizeDate(rd.date || (draft.submitDate || '').slice(0, 4) + '-' + rd.month + '-' + rd.day);
                setRowDate(row,date);
                row.querySelector('.exp-parking').value = rd.parking || '';
                row.querySelector('.exp-dest-company').value = rd.destCompany || '';
                row.querySelector('.exp-dest-address').value = rd.destAddress || '';
                row.dataset.etcKeys = JSON.stringify(rd.etcKeys || []);
                row.dataset.etcEntries = JSON.stringify(rd.etcEntries || []);
                row.dataset.etcPdfFingerprint = rd.etcPdfFingerprint || '';
                row.dataset.parkingImports = JSON.stringify(rd.parkingImports || {});
                if (!date) {
                    row.querySelector('.exp-month').value = rd.month || '';
                    row.querySelector('.exp-day').value = rd.day || '';
                }
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
        selectDraftForEditing(draft);
        alert(draft.etcEvidence?.records?.length ? '✅ 精算書とETC ' + draft.etcEvidence.records.length + '件を読み込みました。「ETC PDF・寄り道」で日付を選び、確認・修正・PDF出力ができます。' : (draft.parkingReceipts ? '✅ 精算書と領収書 ' + draft.parkingReceipts.items.length + '枚を読み込みました。下の「この下書きの領収書」で確認・修正できます。' : '✅ 精算書を読み込みました。この旧下書きには領収書が保存されていません。必要な写真は駐車場欄で選び直してから保存してください。'));
        if (draft.etcEvidence?.records?.length) { document.getElementById('etcSection').open = true; document.getElementById('etcSection').scrollIntoView({block:'start'}); }
        else document.getElementById('loadedDraftReceipts')?.scrollIntoView({block:'start'});
        } catch(error) { alert('下書きを読み込めませんでした。' + error.message); }
        finally { _draftBusy = false; }
    }

    async function deleteDraft(id, listed) {
        if (_draftBusy) return;
        const active = _activeDraft?.id === id;
        if (!confirm('この下書きと、下書きに保存した領収書・ETCを削除しますか？'
            + (active ? '\n編集中の入力もクリアします。' : '')
            + '\n通常の駐車場・ETC明細は残ります。')) return;
        _draftBusy = true;
        try {
            await ExpenseDraftStore.remove(id, active ? _activeDraft : listed);
            if (active) resetForm({afterDelete:true});
        } catch(error) { alert('下書きを削除できませんでした。' + error.message); }
        finally {
            await renderDraftList();
            _draftBusy = false;
        }
    }

    // ==========================================
    // クリア
    // ==========================================
    function clearAll() {
        if (_draftBusy || !confirm('すべての入力をクリアしますか？ 保存した下書きは残ります。')) return;
        resetForm();
    }
    function resetForm({afterDelete = false} = {}) {
        selectDraftForEditing(null);
        if (afterDelete) {
            ExpenseDraftReceipts.load(null);
            _setVal('expSubmitDate', new Date().toLocaleDateString('sv-SE'));
            for (const id of ['expSSName', 'expEmployeeName']) {
                const field = document.getElementById(id);
                if (field && typeof field.defaultValue === 'string') field.value = field.defaultValue;
            }
        } else ExpenseDraftReceipts.reset();
        if (typeof EtcWorkflow !== 'undefined') EtcWorkflow.leaveDraft();
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
    // v78: 提出日では訪問を選ばない。作業日を選んで「完了」の訪問から行先を入れる。
    let _pickerDay = '';
    function openVisitPicker(day) {
        const dates = Array.from(document.querySelectorAll('#expenseRows .exp-row')).map(row => { try { return _rowDate(row); } catch (e) { return ''; } });
        _pickerDay = ExpenseImport.normalizeDate(day) || VisitPicker.defaultDay(dates, new Date().toLocaleDateString('sv-SE'));
        _showCustomerPicker(_getMapCustomers(_pickerDay.slice(0, 7)), _pickerDay);
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

    function _pickerItem(c, checked, date) {
        const purpose = c.purpose ? '（' + _escHtml(c.purpose) + '）' : '';
        return '<label class="exp-picker-item"><input type="checkbox" class="exp-picker-cb" '
            + 'data-company="' + _escAttr(c.company || '') + '" data-address="' + _escAttr(c.address || '') + '" data-date="' + _escAttr(date) + '"' + (checked ? ' checked' : '') + '>'
            + '<span class="exp-picker-label">' + _escHtml(((c.company || '') + ' ' + _trimToCity(c.address || '')).trim()) + purpose + '</span></label>';
    }

    function _showCustomerPicker(customers, day) {
        const g = VisitPicker.groupForDay(customers, day);
        let html = '<div class="exp-picker-header"><h3>📍 完了した訪問から行先を入れる</h3>'
            + '<div class="exp-fg"><label for="expPickerDay">作業日（アポ日）</label><input type="date" class="exp-input" id="expPickerDay" value="' + _escAttr(day) + '" onchange="ExpenseManager.openVisitPicker(this.value)"></div>'
            + '<p>この日に「完了」にした訪問を、この日の明細の行先に入れます（提出日とは別です）。</p></div><div class="exp-picker-list">';
        html += '<div class="exp-picker-date-group" id="expPickerDone"><div class="exp-picker-date-label">✅ ' + _escHtml(day) + ' に完了（' + g.done.length + '件）</div>'
            + (g.done.length ? g.done.map(c => _pickerItem(c, true, day)).join('') : '<p class="summary-note">この日に完了の訪問はありません。マップの編集画面で「完了」にしてください。</p>') + '</div>';
        if (g.forgot.length) html += '<div class="exp-picker-date-group" id="expPickerForgot"><div class="exp-picker-date-label">🤔 完了にし忘れ？（アポ済み・この日）</div>' + g.forgot.map(c => _pickerItem(c, false, day)).join('') + '</div>';
        if (g.others.length) {
            html += '<details class="exp-picker-date-group" id="expPickerOthers"><summary>ほかの日を表示（' + g.others.length + '件）</summary>';
            let last = '';
            g.others.forEach(c => { if (c._day !== last) { last = c._day; html += '<div class="exp-picker-date-label">📅 ' + _escHtml(last) + '</div>'; } html += _pickerItem(c, false, c._day); });
            html += '</details>';
        }
        html += '</div><div class="exp-picker-actions">'
            + '<button class="btn btn-primary" onclick="ExpenseManager.applyPicker()">✅ この日の行先にする</button>'
            + '<button class="btn btn-secondary" onclick="ExpenseManager.closePicker()">キャンセル</button></div>';
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

    // v78: 選んだ訪問で作業日の明細の行先を置き換え、上の行先欄も明細から作り直す（追記しない）
    function applyPicker() {
        const cbs = Array.from(document.querySelectorAll('.exp-picker-cb:checked'));
        if (cbs.length === 0) { alert('訪問を1件以上選択してください'); return; }
        const day = _pickerDay;
        const row = getOrCreateDateRow(day);
        row.querySelector('.exp-dest-company').value = cbs.map(cb => cb.dataset.company).filter(Boolean).join(' → ');
        row.querySelector('.exp-dest-address').value = cbs.map(cb => _trimToCity(cb.dataset.address)).filter(Boolean).join(' → ');
        _refreshHeaderDestinations();
        recalculate();
        closePicker();
    }

    function _refreshHeaderDestinations() {
        const data = getRowsData().filter(item => item.destCompany || item.destAddress);
        _setVal('expDestCompany', data.map(item => item.month + '/' + item.day + ' ' + item.destCompany).join('\n'));
        _setVal('expDestAddress', data.map(item => item.month + '/' + item.day + ' ' + item.destAddress).join('\n'));
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
        onRowDateChange, reviewRowImports, getOrCreateDateRow, reviewEtcRecords, applyEtcRecords, syncParking, reflectParkingMonth, previewParkingReflection, showReflectedParking, applyRoute, reflectRouteAndParking, applyEtcDay,
        getHeaderData, getRowsData, parseHighway, calcGasCost,
        saveDraft, loadDraft, deleteDraft, renderDraftList, previewDraftReceipts, clearAll,
        trimToCity: _trimToCity,
        togglePickerAll, applyPicker, closePicker, openVisitPicker
    };
})();


