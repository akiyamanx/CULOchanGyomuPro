// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.2 - etc-reader.js
// ETC利用明細CSV読込・精算書自動反映モジュール
// v2.2新規作成
// ============================================

const EtcReader = (() => {

    // v2.2 - ETC明細CSVを読み込む
    function handleFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const records = parseEtcCsv(text);

            if (records.length === 0) {
                alert('❌ ETC明細データが見つかりませんでした。\nCSVの形式を確認してください。');
                return;
            }

            showEtcRecords(records);
        };
        // ETC利用照会はShift-JISの場合が多い
        reader.readAsText(file, 'Shift_JIS');
        event.target.value = '';
    }

    // v2.2 - ETC明細CSVをパースする
    // 複数のCSVフォーマットに対応（ヘッダー自動検出）
    function parseEtcCsv(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) return [];

        const records = [];
        let dateCol = -1, entryCol = -1, exitCol = -1, amountCol = -1;

        // ヘッダー行を探す
        for (let i = 0; i < Math.min(5, lines.length); i++) {
            const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
            for (let j = 0; j < cols.length; j++) {
                const c = cols[j];
                if (c.includes('年月日') || c.includes('利用日') || c.includes('日付')) dateCol = j;
                if (c.includes('入口') || c.includes('入口IC')) entryCol = j;
                if (c.includes('出口') || c.includes('出口IC')) exitCol = j;
                if (c.includes('利用額') || c.includes('金額') || c.includes('最終額') || c.includes('通行料金')) {
                    amountCol = j;
                }
            }
            // ヘッダーが見つかったらその次の行からデータ
            if (dateCol >= 0 && amountCol >= 0) {
                for (let k = i + 1; k < lines.length; k++) {
                    const cols = lines[k].split(',').map(c => c.replace(/"/g, '').trim());
                    if (cols.length <= Math.max(dateCol, amountCol)) continue;

                    const dateStr = cols[dateCol] || '';
                    const amount = parseInt(cols[amountCol].replace(/[^0-9]/g, '')) || 0;

                    if (amount > 0) {
                        records.push({
                            date: dateStr,
                            entry: entryCol >= 0 ? cols[entryCol] : '',
                            exit: exitCol >= 0 ? cols[exitCol] : '',
                            amount: amount
                        });
                    }
                }
                break;
            }
        }

        // ヘッダーが見つからない場合、位置ベースで推定
        if (records.length === 0 && lines.length >= 2) {
            for (let i = 0; i < lines.length; i++) {
                const cols = lines[i].split(',').map(c => c.replace(/"/g, '').trim());
                // 日付っぽい列を探す
                const dateIdx = cols.findIndex(c => /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/.test(c));
                if (dateIdx >= 0) {
                    // 数値っぽい列を金額として使う
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

    // v2.2 - 読み込んだETC明細を表示して選択させる
    function showEtcRecords(records) {
        const total = records.reduce((s, r) => s + r.amount, 0);

        let html = '<div class="ro-modal-overlay" id="etcModal">';
        html += '<div class="ro-modal">';
        html += '<h3>🛣️ ETC利用明細</h3>';
        html += `<p class="ro-hint">${records.length}件 合計 ¥${total.toLocaleString()}</p>`;
        html += '<div class="etc-list">';

        records.forEach((r, i) => {
            html += `<div class="etc-item">`;
            html += `<label>`;
            html += `<input type="checkbox" class="etc-check" data-idx="${i}" checked>`;
            html += `<span class="etc-info">`;
            html += `<span class="etc-date">${r.date}</span>`;
            html += `<span class="etc-route">${r.entry} → ${r.exit}</span>`;
            html += `</span>`;
            html += `<span class="etc-amount">¥${r.amount.toLocaleString()}</span>`;
            html += `</label>`;
            html += `</div>`;
        });

        html += '</div>';
        html += '<div class="ro-actions">';
        html += '<button class="ro-btn ro-btn-cancel" onclick="EtcReader.closeModal()">キャンセル</button>';
        html += '<button class="ro-btn ro-btn-save" onclick="EtcReader.applySelected()">✅ 精算書に反映</button>';
        html += '</div>';
        html += '</div></div>';

        // データを保持
        EtcReader._records = records;

        const existing = document.getElementById('etcModal');
        if (existing) existing.remove();
        document.body.insertAdjacentHTML('beforeend', html);
    }

    // v2.2 - 選択されたETC明細を精算書に反映する
    function applySelected() {
        const checks = document.querySelectorAll('.etc-check:checked');
        const records = EtcReader._records || [];
        let totalAmount = 0;
        const amounts = [];
        let count = 0;

        checks.forEach(chk => {
            const idx = parseInt(chk.dataset.idx);
            if (records[idx]) {
                totalAmount += records[idx].amount;
                amounts.push(records[idx].amount);
                count++;
            }
        });

        if (count === 0) {
            alert('反映するデータを選択してください');
            return;
        }

        closeModal();

        // 精算書タブに切り替えて反映
        mapSwitchTab('expense');
        MapExpenseForm.init();

        setTimeout(() => {
            const firstRow = document.querySelector('.exp-row');
            if (firstRow) {
                // 高速代欄にカンマ区切りで入力
                const hwInput = firstRow.querySelector('.exp-highway');
                if (hwInput) {
                    hwInput.value = amounts.join(',');
                }
                // 枚数欄に件数を入力
                const countInput = firstRow.querySelector('.exp-hw-count');
                if (countInput) {
                    countInput.value = count;
                }
                // 交通機関欄に「高速道路」を設定
                const transportInput = firstRow.querySelector('.exp-transport');
                if (transportInput && !transportInput.value) {
                    transportInput.value = '高速道路';
                }
                MapExpenseForm.calcTotals();
            }
            alert(`✅ ETC明細 ${count}件（¥${totalAmount.toLocaleString()}）を精算書に反映しました！`);
        }, 200);
    }

    // v2.2 - モーダルを閉じる
    function closeModal() {
        const modal = document.getElementById('etcModal');
        if (modal) modal.remove();
    }

    return { handleFile, applySelected, closeModal };
})();
