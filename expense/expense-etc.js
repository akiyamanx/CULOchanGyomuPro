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
        reader.onload = e => {
            try {
                let text;
                try { text = new TextDecoder('utf-8', { fatal: true }).decode(e.target.result); }
                catch (error) { text = new TextDecoder('shift_jis').decode(e.target.result); }
                const records = _parseEtcCsv(text);
                if (!records.length) throw new Error('ETC明細がありません。利用日と料金を確認してください');
                _showEtcModal(records);
            } catch (error) { alert('CSVを読み込めません\n' + error.message); }
        };
        reader.onerror = () => alert('CSVファイルを読み込めませんでした');
        reader.readAsArrayBuffer(file);
        event.target.value = '';
    }

    // ==========================================
    // ETC明細CSVパーサー（v1.2強化版）
    // 複数フォーマット対応: ヘッダー自動検出 + 位置ベースfallback
    // 列: 利用年月日 / 利用ＩＣ（自）/ 利用ＩＣ（至）/ 通行料金
    // ==========================================
    function _parseEtcCsv(text) {
        return ExpenseImport.parseEtcCsv(text);
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
                    + '<span class="exp-picker-label">' + ExpenseImport.escapeHtml(route) + '</span>'
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
    // 選択したETC明細を利用日ごとの行に反映
    // ==========================================
    function applyToExpense() {
        const selected = Array.from(document.querySelectorAll('.etc-exp-cb:checked'))
            .map(check => _records[Number(check.dataset.idx)]).filter(Boolean);
        if (!selected.length) { alert('反映するデータを選択してください'); return; }
        try {
            const result = ExpenseManager.applyEtcRecords(selected);
            closeModal();
            AppCore.switchTab('expense');
            alert('ETC ' + result.count + '件（¥' + result.amount.toLocaleString() + '）を利用日ごとに反映しました。'
                + (result.skipped ? '\n反映済み ' + result.skipped + '件は追加していません。' : ''));
        } catch (error) { alert('反映できません\n' + error.message); }
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

