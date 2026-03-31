// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.2.3 - segment-dialog.js
// 区間別 高速/下道 選択ダイアログ
// v2.2.3新規作成 - route-manager.jsから分離
// ============================================

const SegmentDialog = (() => {

    // v2.2.3 - 区間別の高速/下道選択ダイアログを表示
    // points: [{ id, address, label }, ...]
    // savedSegments: { "fromId_toId": "general"|"highway", ... }
    // 戻り値: { "fromId_toId": "general"|"highway", ... } または null（キャンセル）
    function show(points, savedSegments) {
        return new Promise((resolve) => {
            // 既存ダイアログがあれば削除
            const old = document.getElementById('segmentDialog');
            if (old) old.remove();

            // 区間リストを構築
            const segList = [];
            for (let i = 0; i < points.length - 1; i++) {
                const segKey = `${points[i].id}_${points[i + 1].id}`;
                const saved = savedSegments[segKey] || 'general';
                segList.push({
                    key: segKey,
                    fromLabel: points[i].label,
                    toLabel: points[i + 1].label,
                    type: saved
                });
            }

            const overlay = document.createElement('div');
            overlay.id = 'segmentDialog';
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000;';

            const dialog = document.createElement('div');
            dialog.style.cssText = 'background:#fff;border-radius:12px;padding:20px;max-width:380px;width:92%;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 4px 20px rgba(0,0,0,0.3);';

            // ヘッダー
            let headerHtml = `
                <div style="font-size:18px;font-weight:bold;margin-bottom:4px;">📏 区間別 道路選択</div>
                <div style="font-size:13px;color:#666;margin-bottom:12px;">各区間をタップで 🚗下道 ⇔ 🛣️高速 切替</div>
            `;

            // 区間リスト（スクロール可能）
            let listHtml = `<div style="overflow-y:auto;flex:1;margin-bottom:12px;">`;
            segList.forEach((seg, idx) => {
                const isHw = seg.type === 'highway';
                const bg = isHw ? '#E3F2FD' : '#E8F5E9';
                const border = isHw ? '#2196F3' : '#4CAF50';
                const icon = isHw ? '🛣️' : '🚗';
                const label = isHw ? '高速' : '下道';

                listHtml += `
                    <div id="seg_${idx}" data-key="${seg.key}" data-type="${seg.type}"
                         onclick="SegmentDialog.toggleType(${idx})"
                         style="display:flex;align-items:center;padding:10px 12px;margin-bottom:6px;
                                border:2px solid ${border};border-radius:8px;background:${bg};
                                cursor:pointer;user-select:none;transition:all 0.2s;">
                        <span style="font-size:20px;margin-right:10px;" id="segIcon_${idx}">${icon}</span>
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:13px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                ${seg.fromLabel}
                            </div>
                            <div style="font-size:11px;color:#888;">↓</div>
                            <div style="font-size:13px;font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                ${seg.toLabel}
                            </div>
                        </div>
                        <span style="font-size:14px;font-weight:bold;margin-left:8px;" id="segLabel_${idx}">${label}</span>
                    </div>
                `;
            });
            listHtml += `</div>`;

            // ボタン
            let btnHtml = `
                <div style="display:flex;gap:8px;">
                    <button id="segCancel" style="flex:1;padding:12px;border:1px solid #ccc;border-radius:8px;background:#f5f5f5;font-size:14px;cursor:pointer;color:#666;">
                        キャンセル
                    </button>
                    <button id="segCalc" style="flex:2;padding:12px;border:none;border-radius:8px;background:#1976D2;color:#fff;font-size:16px;font-weight:bold;cursor:pointer;">
                        📏 計算する
                    </button>
                </div>
            `;

            dialog.innerHTML = headerHtml + listHtml + btnHtml;
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            // イベント設定
            document.getElementById('segCancel').onclick = () => { overlay.remove(); resolve(null); };
            document.getElementById('segCalc').onclick = () => {
                const result = {};
                segList.forEach((seg, idx) => {
                    const el = document.getElementById(`seg_${idx}`);
                    result[seg.key] = el.dataset.type;
                });
                overlay.remove();
                resolve(result);
            };
            overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } };
        });
    }

    // v2.2.3 - 区間の道路種別をトグル切替
    function toggleType(idx) {
        const el = document.getElementById(`seg_${idx}`);
        const icon = document.getElementById(`segIcon_${idx}`);
        const label = document.getElementById(`segLabel_${idx}`);

        if (el.dataset.type === 'general') {
            el.dataset.type = 'highway';
            el.style.background = '#E3F2FD';
            el.style.borderColor = '#2196F3';
            icon.textContent = '🛣️';
            label.textContent = '高速';
        } else {
            el.dataset.type = 'general';
            el.style.background = '#E8F5E9';
            el.style.borderColor = '#4CAF50';
            icon.textContent = '🚗';
            label.textContent = '下道';
        }
    }

    return { show, toggleType };
})();
