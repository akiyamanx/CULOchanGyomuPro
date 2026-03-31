// ==========================================
// CULOchan業務Pro — 精算書ETC取り込み v1.0
// このファイルは精算書タブでのETC利用照会CSV取り込み→高速代自動反映を担当する
// map/etc-reader.jsのパーサーを流用し、ExpenseManagerへの反映に特化
//
// 依存: expense-manager.js
// ==========================================

const ExpenseEtc = (() => {
    // v1.0 - 保持用レコード
    let _records = [];

    // v1.0 - ファイル選択ハンドラ
    function handleFile(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const records = _parseEtcCsv(e.target.result);
            if (records.length === 0) {
                alert('❌ ETC明細データが見つかりませんでした。\nCSVの形式を確認してください。');
                return;
            }
            _showEtcModal(records);
        };
        // v1.0 - ETC利用照会はShift_JIS
        reader.readAsText(file, 'Shift_JIS');
        event.target.value = '';
    }

    // v1.0 - ETC明細CSVパーサー（map/etc-reader.jsのロジック流用）
    // ETC利用照会サービスCSV: Shift_JIS, 15列
    // 列0:利用年月日(自), 列4:利用IC(自), 列5:利用IC(至), 列8:通行料金
    function _parseEtcCsv(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return [];
        const records = [];
        let dateCol = -1, entryCol = -1, exitCol = -1, amountCol = -1;
        let headerIdx = -1;

        // ヘッダー行を自動検出
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
            for (let j = 0; j < cols.length; j++) {
                const c = cols[j];
                if (c.includes('年月日') || c.includes('利用日')) dateCol = j;
                if (c.includes('ＩＣ（自）') || c.includes('入口')) entryCol = j;
                if (c.includes('ＩＣ（至）') || c.includes('出口')) exitCol = j;
                if (c.includes('通行料金') || c.includes('利用額') || c.includes('金額')) amountCol = j;
            }
            if (dateCol >= 0 && amountCol >= 0) { headerIdx = i; break; }
        }

        if (headerIdx < 0) return [];

        // データ行をパース
        for (let k = headerIdx + 1; k < lines.length; k++) {
            const cols = lines[k].split(',').map(c => c.replace(/"/g, '').trim());
            if (cols.length <= Math.max(dateCol, amountCol)) continue;
            const dateStr = cols[dateCol] || '';
            const amount = parseInt(cols[amountCol].replace(/[^0-9]/g, '')) || 0;
            if (amount > 0) {
                records.push({
                    date: dateStr,
                    entry: entryCol >= 0 ? (cols[entryCol] || '') : '',
                    exit: exitCol >= 0 ? (cols[exitCol] || '') : '',
                    amount: amount
                });
            }
        }
        return records;
    }

    // v1.0 - ETC明細モーダル表示
    function _showEtcModal(records) {
        _records = records;
        // v1.0 - 日付ごとにグルーピング
        const byDate = {};
        records.forEach((r, i) => {
            const d = r.date || '日付不明';
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push({ ...r, idx: i });
        });
        const sortedDates = Object.keys(byDate).sort();
        const total = records.reduce((s, r) => s + r.amount, 0);

        let html = '<div class="exp-picker-header">'
            + '<h3>🛣️ ETC利用明細</h3>'
            + '<p>' + records.length + '件 合計 ¥' + total.toLocaleString() + '</p>'
            + '<button class="exp-picker-select-all" onclick="ExpenseEtc.toggleAll()">全選択/解除</button>'
            + '</div><div class="exp-picker-list">';

        sortedDates.forEach(date => {
            const dayTotal = byDate[date].reduce((s, r) => s + r.amount, 0);
            html += '<div class="exp-picker-date-group">'
                + '<div class="exp-picker-date-label">📅 ' + date
                + ' <span style="font-weight:normal;font-size:0.75rem;">（¥' + dayTotal.toLocaleString() + '）</span></div>';
            byDate[date].forEach(r => {
                const route = (r.entry || '—') + ' → ' + (r.exit || '—');
                html += '<label class="exp-picker-item">'
                    + '<input type="checkbox" class="etc-exp-cb" data-idx="' + r.idx + '" checked>'
                    + '<span class="exp-picker-label">' + route + '</span>'
                    + '<span style="margin-left:auto;font-weight:bold;color:var(--accent-light);">'
                    + '¥' + r.amount.toLocaleString() + '</span>'
                    + '</label>';
            });
            html += '</div>';
        });

        html += '</div><div class="exp-picker-actions">'
            + '<button class="btn btn-primary" onclick="ExpenseEtc.applyToExpense()">✅ 精算書に反映</button>'
            + '<button class="btn btn-secondary" onclick="ExpenseEtc.closeModal()">キャンセル</button>'
            + '</div>';

        let modal = document.getElementById('expEtcModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'expEtcModal';
            modal.className = 'exp-picker-overlay';
            document.body.appendChild(modal);
        }
        modal.innerHTML = '<div class="exp-picker-modal">' + html + '</div>';
        modal.style.display = 'flex';
    }

    // v1.0 - 全選択/解除
    function toggleAll() {
        const cbs = document.querySelectorAll('.etc-exp-cb');
        const allChecked = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => { cb.checked = !allChecked; });
    }

    // v1.0 - 選択したETC明細を精算書の最初の行に反映
    function applyToExpense() {
        const cbs = document.querySelectorAll('.etc-exp-cb:checked');
        if (cbs.length === 0) { alert('反映するデータを選択してください'); return; }

        const amounts = [];
        let count = 0;
        cbs.forEach(chk => {
            const idx = parseInt(chk.dataset.idx);
            if (_records[idx]) {
                amounts.push(_records[idx].amount);
                count++;
            }
        });
        const totalAmount = amounts.reduce((s, a) => s + a, 0);

        closeModal();

        // v1.0 - 精算書の最初の行に反映
        const firstRow = document.querySelector('#tab-expense .exp-row');
        if (firstRow) {
            // v1.0 - 高速代にカンマ区切りで入力
            const hwInput = firstRow.querySelector('.exp-highway');
            if (hwInput) {
                if (hwInput.value.trim()) {
                    // v1.0 - 既存値がある場合は追記
                    hwInput.value = hwInput.value.trim() + ',' + amounts.join(',');
                } else {
                    hwInput.value = amounts.join(',');
                }
            }
            // v1.0 - 枚数にETC通行回数を反映
            const countInput = firstRow.querySelector('.exp-highway-count');
            if (countInput) countInput.value = count;
            // v1.0 - 交通機関が空なら「高速道路」を設定
            const transport = firstRow.querySelector('.exp-transport');
            if (transport && !transport.value) transport.value = '高速道路';
            // v1.0 - 合計再計算
            ExpenseManager.recalculate();
        }

        alert('✅ ETC明細 ' + count + '件（¥' + totalAmount.toLocaleString() + '）を精算書に反映しました！');
    }

    // v1.0 - モーダルを閉じる
    function closeModal() {
        const modal = document.getElementById('expEtcModal');
        if (modal) modal.style.display = 'none';
    }

    return { handleFile, toggleAll, applyToExpense, closeModal };
})();
