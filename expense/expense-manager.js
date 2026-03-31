// ==========================================
// CULOchan業務Pro — 精算書マネージャー v1.1
// このファイルは交通費精算書の入力・計算・下書き保存/読込/削除を担当する
// 元CULOchanSEISANshoから移植し、業務Pro用に分割・リファクタリング
// v1.1追加 - Step2マップ顧客データ連携（日付変更→アポ済み顧客→行先自動入力）
//
// 依存: app-core.js
// ==========================================

const ExpenseManager = (() => {
    // v1.0 - 行カウンター
    let _rowCount = 0;

    // ==========================================
    // 初期化
    // ==========================================
    function init() {
        console.log('[Expense] 精算書マネージャー初期化');
        // v1.0 - 提出日を今日に設定
        const dateInput = document.getElementById('expSubmitDate');
        if (dateInput) {
            dateInput.value = new Date().toISOString().split('T')[0];
            // v1.1追加 - 提出日変更時にマップ顧客データ連携
            dateInput.addEventListener('change', _onSubmitDateChange);
        }
        // v1.0 - 初期行を1行追加
        addRow();
        // v1.0 - 下書き一覧を表示
        renderDraftList();
    }

    // ==========================================
    // 行の追加・削除
    // ==========================================

    // v1.0 - 経費行を追加
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
            + '<button class="exp-row-del" onclick="ExpenseManager.deleteRow(' + _rowCount + ')">×</button>'
            + '</div>'
            // 月・日・交通機関
            + '<div class="exp-form-row">'
            + '<div class="exp-fg exp-fg-sm"><label>月</label>'
            + '<input type="number" class="exp-input exp-month" placeholder="4" min="1" max="12"></div>'
            + '<div class="exp-fg exp-fg-sm"><label>日</label>'
            + '<input type="number" class="exp-input exp-day" placeholder="15" min="1" max="31"></div>'
            + '<div class="exp-fg"><label>利用交通機関</label>'
            + '<input type="text" class="exp-input exp-transport" placeholder="高速道路"></div>'
            + '</div>'
            // 走行距離・ガソリン代
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>走行距離（km）</label>'
            + '<input type="number" class="exp-input exp-distance" placeholder="186" '
            + 'onchange="ExpenseManager.onDistanceChange(this)">'
            + '<div class="exp-hint-green">※100km以上で自動計算</div></div>'
            + '<div class="exp-fg"><label>ガソリン代（自動）</label>'
            + '<input type="number" class="exp-input exp-gas" placeholder="0" readonly></div>'
            + '</div>'
            // 高速代・枚数
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>高速代（カンマ区切りで複数可）</label>'
            + '<input type="text" class="exp-input exp-highway" placeholder="5110" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '<div class="exp-fg exp-fg-sm"><label>枚数</label>'
            + '<input type="number" class="exp-input exp-highway-count" placeholder="8"></div>'
            + '</div>'
            // その他・船賃
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>その他（タクシー等）</label>'
            + '<input type="number" class="exp-input exp-other" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '<div class="exp-fg"><label>船賃</label>'
            + '<input type="number" class="exp-input exp-ship" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '</div>'
            // 電車賃・航空賃
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>電車賃</label>'
            + '<input type="number" class="exp-input exp-train" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '<div class="exp-fg"><label>航空賃</label>'
            + '<input type="number" class="exp-input exp-air" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '</div>'
            // 宿泊料・宿泊先
            + '<div class="exp-form-row">'
            + '<div class="exp-fg"><label>宿泊料</label>'
            + '<input type="number" class="exp-input exp-hotel" placeholder="0" '
            + 'onchange="ExpenseManager.recalculate()"></div>'
            + '<div class="exp-fg"><label>宿泊先</label>'
            + '<input type="text" class="exp-input exp-hotel-name" placeholder=""></div>'
            + '</div>'
            // 行合計
            + '<div class="exp-row-total">行合計: <span class="exp-row-total-val">¥0</span></div>';

        container.appendChild(row);
        _updateRowNumbers();
    }

    // v1.0 - 行を削除
    function deleteRow(id) {
        const row = document.getElementById('expRow-' + id);
        if (row && document.querySelectorAll('.exp-row').length > 1) {
            row.remove();
            _updateRowNumbers();
            recalculate();
        }
    }

    // v1.0 - 行番号を振り直す
    function _updateRowNumbers() {
        document.querySelectorAll('.exp-row').forEach((row, i) => {
            const num = row.querySelector('.exp-row-num');
            if (num) num.textContent = i + 1;
        });
    }

    // ==========================================
    // 計算ロジック
    // ==========================================

    // v1.0 - ガソリン代自動計算（100km超で (km-100)×30円）
    function calcGasCost(distance) {
        const km = parseInt(distance) || 0;
        return km >= 100 ? (km - 100) * 30 : 0;
    }

    // v1.0 - 走行距離変更時のハンドラ
    function onDistanceChange(input) {
        const row = input.closest('.exp-row');
        if (!row) return;
        const gas = calcGasCost(input.value);
        row.querySelector('.exp-gas').value = gas || '';
        recalculate();
    }

    // v1.0 - 高速代パース（カンマ区切り対応）
    function _parseHighway(value) {
        if (!value) return 0;
        return value.split(/[,、，]/).reduce((sum, v) => {
            return sum + (parseInt(v.trim()) || 0);
        }, 0);
    }

    // v1.0 - 全行の合計を再計算
    function recalculate() {
        let grandTotal = 0;
        document.querySelectorAll('.exp-row').forEach(row => {
            const gas = parseInt(row.querySelector('.exp-gas').value) || 0;
            const highway = _parseHighway(row.querySelector('.exp-highway').value);
            const other = parseInt(row.querySelector('.exp-other').value) || 0;
            const ship = parseInt(row.querySelector('.exp-ship').value) || 0;
            const train = parseInt(row.querySelector('.exp-train').value) || 0;
            const air = parseInt(row.querySelector('.exp-air').value) || 0;
            const hotel = parseInt(row.querySelector('.exp-hotel').value) || 0;
            const rowTotal = gas + highway + other + ship + train + air + hotel;
            const totalEl = row.querySelector('.exp-row-total-val');
            if (totalEl) totalEl.textContent = '¥' + rowTotal.toLocaleString();
            grandTotal += rowTotal;
        });
        const grandEl = document.getElementById('expGrandTotal');
        if (grandEl) grandEl.textContent = '¥' + grandTotal.toLocaleString();
    }

    // ==========================================
    // データ収集（PDF出力や保存で使う）
    // ==========================================

    // v1.0 - 基本情報を取得
    function getHeaderData() {
        return {
            submitDate: (document.getElementById('expSubmitDate') || {}).value || '',
            ssName: (document.getElementById('expSSName') || {}).value || '千葉西SS',
            destination: (document.getElementById('expDestination') || {}).value || '',
            employeeName: (document.getElementById('expEmployeeName') || {}).value || '小出晃也'
        };
    }

    // v1.0 - 全行データを取得
    function getRowsData() {
        const rows = [];
        document.querySelectorAll('.exp-row').forEach(row => {
            rows.push({
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

    // v1.0 - 高速代パース（外部公開用）
    function parseHighway(value) {
        return _parseHighway(value);
    }

    // ==========================================
    // 下書き保存・読込・削除
    // ==========================================

    // v1.0 - localStorageキー（SEISANsho互換）
    const DRAFT_KEY = 'travelExpenseDrafts';

    // v1.0 - 下書き保存
    function saveDraft() {
        const header = getHeaderData();
        const rowsData = getRowsData();

        const draft = {
            id: Date.now(),
            date: new Date().toLocaleString('ja-JP'),
            submitDate: header.submitDate,
            ssName: header.ssName,
            destination: header.destination,
            employeeName: header.employeeName,
            rows: rowsData
        };

        let drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
        drafts.unshift(draft);
        // v1.0 - 最大20件
        if (drafts.length > 20) drafts = drafts.slice(0, 20);
        localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));

        alert('✅ 下書きを保存しました！');
        renderDraftList();
    }

    // v1.0 - 下書き一覧を描画
    function renderDraftList() {
        const container = document.getElementById('expDraftList');
        if (!container) return;
        const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');

        if (drafts.length === 0) {
            container.innerHTML = '<p class="empty-msg">下書きはありません</p>';
            return;
        }

        let html = '';
        drafts.forEach(d => {
            html += '<div class="exp-draft-item">'
                + '<div class="exp-draft-info" onclick="ExpenseManager.loadDraft(' + d.id + ')">'
                + '<div class="exp-draft-title">' + (d.destination || '（行先未入力）') + '</div>'
                + '<div class="exp-draft-date">' + d.date + '</div>'
                + '</div>'
                + '<button class="exp-draft-del" onclick="ExpenseManager.deleteDraft(' + d.id + ')">🗑️</button>'
                + '</div>';
        });
        container.innerHTML = html;
    }

    // v1.0 - 下書きを読み込み
    function loadDraft(id) {
        const drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
        const draft = drafts.find(d => d.id === id);
        if (!draft) { alert('下書きが見つかりません'); return; }
        if (!confirm('現在の入力を破棄して下書きを読み込みますか？')) return;

        // 基本情報を復元
        _setVal('expSubmitDate', draft.submitDate || new Date().toISOString().split('T')[0]);
        _setVal('expSSName', draft.ssName || '千葉西SS');
        _setVal('expDestination', draft.destination || '');
        _setVal('expEmployeeName', draft.employeeName || '小出晃也');

        // 行データを復元
        const container = document.getElementById('expenseRows');
        if (container) container.innerHTML = '';
        _rowCount = 0;

        if (draft.rows && draft.rows.length > 0) {
            draft.rows.forEach(rd => {
                addRow();
                const row = document.getElementById('expRow-' + _rowCount);
                if (!row) return;
                row.querySelector('.exp-month').value = rd.month || '';
                row.querySelector('.exp-day').value = rd.day || '';
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
            });
        } else {
            addRow();
        }
        recalculate();
        alert('✅ 下書きを読み込みました！');
    }

    // v1.0 - 下書きを削除
    function deleteDraft(id) {
        if (!confirm('この下書きを削除しますか？')) return;
        let drafts = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
        drafts = drafts.filter(d => d.id !== id);
        localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
        renderDraftList();
    }

    // ==========================================
    // クリア
    // ==========================================
    function clearAll() {
        if (!confirm('すべての入力をクリアしますか？')) return;
        _setVal('expDestination', '');
        const container = document.getElementById('expenseRows');
        if (container) container.innerHTML = '';
        _rowCount = 0;
        addRow();
        recalculate();
    }

    // ==========================================
    // v1.1追加 - マップ顧客データ連携（Step2: 日付連携）
    // ==========================================

    // v1.1 - 提出日変更→その月のアポ済み顧客を検索→選択モーダル表示
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

    // v1.1 - localStorageから直接マップ顧客データを読む（ワークスペース非依存で安全）
    function _getMapCustomers(yearMonth) {
        try {
            const data = localStorage.getItem('mm_customers_' + yearMonth);
            if (data) return JSON.parse(data);
            const oldData = localStorage.getItem('mm_customers');
            return oldData ? JSON.parse(oldData) : [];
        } catch (e) { return []; }
    }

    // v1.1 - 顧客選択モーダル表示
    function _showCustomerPicker(customers, yearMonth) {
        const byDate = {};
        customers.forEach(c => {
            const d = c.appoDate || '日付なし';
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(c);
        });
        const sortedDates = Object.keys(byDate).sort();
        let html = '<div class="exp-picker-header">'
            + '<h3>📍 ' + yearMonth + ' のアポ済みお客様</h3>'
            + '<p>チェックしたお客様を行先に反映します</p>'
            + '<button class="exp-picker-select-all" onclick="ExpenseManager.togglePickerAll()">全選択/解除</button>'
            + '</div><div class="exp-picker-list">';
        sortedDates.forEach(date => {
            html += '<div class="exp-picker-date-group">'
                + '<div class="exp-picker-date-label">📅 ' + date + '</div>';
            byDate[date].forEach(c => {
                const label = (c.company || '') + ' ' + (c.address || '');
                const purpose = c.purpose ? '（' + c.purpose + '）' : '';
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

    // v1.1 - 全選択/解除トグル
    function togglePickerAll() {
        const cbs = document.querySelectorAll('.exp-picker-cb');
        const allChecked = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => { cb.checked = !allChecked; });
    }

    // v1.1 - 選択した顧客を行先フィールドに反映
    function applyPicker() {
        const cbs = document.querySelectorAll('.exp-picker-cb:checked');
        if (cbs.length === 0) { alert('お客様を1件以上選択してください'); return; }
        const lines = [];
        cbs.forEach(cb => { lines.push(cb.dataset.company || cb.dataset.address); });
        const dest = document.getElementById('expDestination');
        if (dest) {
            if (dest.value.trim()) {
                if (confirm('既存の行先に追記しますか？\n（キャンセルで上書き）')) {
                    dest.value = dest.value.trim() + '\n' + lines.join('\n');
                } else { dest.value = lines.join('\n'); }
            } else { dest.value = lines.join('\n'); }
        }
        closePicker();
    }

    // v1.1 - モーダルを閉じる
    function closePicker() {
        const modal = document.getElementById('expCustomerPicker');
        if (modal) modal.style.display = 'none';
    }

    function _escHtml(str) { return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function _escAttr(str) { return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

    // ==========================================
    // ユーティリティ
    // ==========================================
    function _setVal(id, val) {
        const el = document.getElementById(id);
        if (el) el.value = val;
    }

    return {
        init: init,
        addRow: addRow,
        deleteRow: deleteRow,
        onDistanceChange: onDistanceChange,
        recalculate: recalculate,
        getHeaderData: getHeaderData,
        getRowsData: getRowsData,
        parseHighway: parseHighway,
        saveDraft: saveDraft,
        loadDraft: loadDraft,
        deleteDraft: deleteDraft,
        renderDraftList: renderDraftList,
        clearAll: clearAll,
        calcGasCost: calcGasCost,
        // v1.1追加 - マップ顧客連携
        togglePickerAll: togglePickerAll,
        applyPicker: applyPicker,
        closePicker: closePicker
    };
})();
