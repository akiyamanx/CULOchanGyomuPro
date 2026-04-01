// ==========================================
// CULOchan業務Pro — 精算書ETC取り込み v1.2
// このファイルは精算書タブでのETC利用照会CSV取り込み→高速代自動反映を担当する
// v1.1修正: 高速代を合計金額で反映
// v1.2強化: map/etc-reader.jsのパーサーを統合（全角ヘッダー対応＋位置ベースfallback）
//           map/etc-reader.jsの代わりにこちらを一本化して使う
//
// 依存: expense-manager.js
// ==========================================

const ExpenseEtc = (() => {
    let _records = [];

    // ==========================================
    // ファイル選択ハンドラ
    // ==========================================
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
        // ETC利用照会サービスはShift_JIS
        reader.readAsText(file, 'Shift_JIS');
        event.target.value = '';
    }

    // ==========================================
    // ETC明細CSVパーサー（v1.2強化版）
    // 複数フォーマット対応: ヘッダー自動検出 + 位置ベースfallback
    // 列: 利用年月日 / 利用ＩＣ（自）/ 利用ＩＣ（至）/ 通行料金
    // ==========================================
    function _parseEtcCsv(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return [];

        const records = [];
        let dateCol = -1, entryCol = -1, exitCol = -1, amountCol = -1;
        let headerFound = false;

        // ヘッダー行を自動検出（先頭5行を走査）
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
            for (let j = 0; j < cols.length; j++) {
                const c = cols[j];
                if (c.includes('年月日') || c.includes('利用日') || c.includes('日付')) dateCol = j;
                // v1.2: 全角ヘッダー「利用ＩＣ（自）」「利用ＩＣ（至）」に対応
                if (c.includes('入口') || c.includes('入口IC') ||
                    (c.includes('ＩＣ') && c.includes('自')) ||
                    (c.includes('IC') && c.includes('自'))) entryCol = j;
                if (c.includes('出口') || c.includes('出口IC') ||
                    (c.includes('ＩＣ') && c.includes('至')) ||
                    (c.includes('IC') && c.includes('至'))) exitCol = j;
                if (c.includes('通行料金') || c.includes('利用額') ||
                    c.includes('最終額') || c.includes('金額')) amountCol = j;
            }
            if (dateCol >= 0 && amountCol >= 0) {
                // データ行を読み込み
                for (let k = i + 1; k < lines.length; k++) {
                    const dc = lines[k].split(',').map(c => c.replace(/"/g, '').trim());
                    if (dc.length <= Math.max(dateCol, amountCol)) continue;
                    const amount = parseInt(dc[amountCol].replace(/[^0-9]/g, '')) || 0;
                    if (amount > 0) {
                        records.push({
                            date: dc[dateCol] || '',
                            entry: entryCol >= 0 ? (dc[entryCol] || '') : '',
                            exit: exitCol >= 0 ? (dc[exitCol] || '') : '',
                            amount: amount
                        });
                    }
                }
                headerFound = true;
                break;
            }
        }

        // v1.2: ヘッダー未検出時は位置ベースfallback（日付パターンで行を検索）
        if (!headerFound || records.length === 0) {
            for (let i = 0; i < lines.length; i++) {
                const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
                const dateIdx = cols.findIndex(c => /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(c));
                if (dateIdx >= 0) {
                    for (let j = cols.length - 1; j > dateIdx; j--) {
                        const val = parseInt(cols[j].replace(/[^0-9]/g, ''));
                        if (val > 0) {
                            records.push({
                                date: cols[dateIdx],
                                entry: cols[dateIdx + 1] || '',
                                exit: cols[dateIdx + 2] || '',
                                amount: val
                            });
                            break;
                        }
                    }
                }
            }
        }

        return records;
    }

    // ==========================================
    // ETC明細モーダル表示（日付グループ別UI）
    // ==========================================
    function _showEtcModal(records) {
        _records = records;
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

    // ==========================================
    // 全選択/解除トグル
    // ==========================================
    function toggleAll() {
        const cbs = document.querySelectorAll('.etc-exp-cb');
        const allChecked = Array.from(cbs).every(cb => cb.checked);
        cbs.forEach(cb => { cb.checked = !allChecked; });
    }

    // ==========================================
    // 選択したETC明細を精算書の最初の行に反映
    // ==========================================
    function applyToExpense() {
        const cbs = document.querySelectorAll('.etc-exp-cb:checked');
        if (cbs.length === 0) { alert('反映するデータを選択してください'); return; }

        let totalAmount = 0;
        let count = 0;
        cbs.forEach(chk => {
            const idx = parseInt(chk.dataset.idx);
            if (_records[idx]) {
                totalAmount += _records[idx].amount;
                count++;
            }
        });

        closeModal();

        const firstRow = document.querySelector('#tab-expense .exp-row');
        if (firstRow) {
            const hwInput = firstRow.querySelector('.exp-highway');
            if (hwInput) {
                const prev = parseInt(hwInput.value.replace(/[^0-9]/g, '')) || 0;
                hwInput.value = prev ? prev + totalAmount : totalAmount;
            }
            const countInput = firstRow.querySelector('.exp-highway-count');
            if (countInput) countInput.value = count;
            const transport = firstRow.querySelector('.exp-transport');
            if (transport && !transport.value) transport.value = '高速道路';
            ExpenseManager.recalculate();
        }
        alert('✅ ETC明細 ' + count + '件（¥' + totalAmount.toLocaleString() + '）を精算書に反映しました！');
    }

    // ==========================================
    // モーダルを閉じる
    // ==========================================
    function closeModal() {
        const modal = document.getElementById('expEtcModal');
        if (modal) modal.style.display = 'none';
    }

    // v1.2公開: parseEtcCsvは外部からも使えるように公開（将来の連携用）
    return { handleFile, toggleAll, applyToExpense, closeModal, parseEtcCsv: _parseEtcCsv };
})();
