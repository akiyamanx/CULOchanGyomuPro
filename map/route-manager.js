// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.2.4 - route-manager.js
// ルート管理・色分け・PDF出力・凡例
// v2.0新規作成 - 分割ファイル構成対応
// v2.2.1変更 - 🔢ボタン削除（ルートタブは確認専用に）
// v2.2.3変更 - 区間別の高速/下道選択対応（UIはsegment-dialog.jsに分離）
// v2.2.4追加 - 精算書への行先自動反映（地区名＋会社名）
// ============================================

const RouteManager = (() => {
    // v2.0 - ルート線（Polyline）の参照
    let polylines = [];

    // v2.0 - ルートパネル更新
    function updateRoutePanel() {
        const routes = DataStorage.getRoutes();
        const customers = DataStorage.getCustomers();
        const routeEl = document.getElementById('routeManager');

        let html = '';

        for (const route of routes) {
            const members = customers.filter(c => c.routeId === route.id);

            // v2.2追加 - order配列がある場合は訪問順で並べ替え
            if (route.order && route.order.length > 0) {
                members.sort((a, b) => {
                    const ai = route.order.indexOf(a.id);
                    const bi = route.order.indexOf(b.id);
                    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                });
            }

            html += `<div class="route-section">`;
            html += `<div class="route-header" onclick="RouteManager.toggleRouteSection(this)">`;
            html += `<span class="route-color-dot" style="background:${route.color}"></span>`;
            html += `<span>${route.name}</span>`;
            html += `<span class="route-count">${members.length}件</span>`;
            // v2.2追加 - 距離計算ボタン（2件以上＋訪問順設定済みで表示）
            if (members.length >= 2 && route.order && route.order.length >= 2) {
                html += `<button class="route-dist-btn" onclick="event.stopPropagation();RouteManager.calcDistance('${route.id}')">📏</button>`;
            }
            html += `</div>`;

            if (members.length > 0) {
                html += `<div class="route-stops">`;
                members.forEach((m, idx) => {
                    html += `<div class="route-stop" onclick="MapCore.focusMarker('${m.id}')">`;
                    html += `<span class="stop-number">${idx + 1}</span>`;
                    html += `<span>${m.company || '不明'}`;
                    if (m.unitCount > 1) html += ` (${m.unitCount}台)`;
                    html += `</span>`;
                    html += `</div>`;
                });
                html += `</div>`;
            }

            html += `</div>`;
        }

        // v2.0 - 未割当顧客
        const unassigned = customers.filter(c => !c.routeId);
        if (unassigned.length > 0) {
            html += `<div class="route-section">`;
            html += `<div class="route-header">`;
            html += `<span class="route-color-dot" style="background:#9e9e9e"></span>`;
            html += `<span>未割当</span>`;
            html += `<span class="route-count">${unassigned.length}件</span>`;
            html += `</div>`;
            html += `<div class="route-stops">`;
            unassigned.forEach((m, idx) => {
                html += `<div class="route-stop" onclick="MapCore.focusMarker('${m.id}')">`;
                html += `<span class="stop-number">-</span>`;
                html += `<span>${m.company || '不明'}</span>`;
                html += `</div>`;
            });
            html += `</div></div>`;
        }

        routeEl.innerHTML = html || '<p class="empty-msg">まだルートが設定されていません</p>';

        // v2.0 - 凡例も更新
        updateLegend(routes, customers);
    }

    // v2.0 - ルートセクション開閉
    function toggleRouteSection(header) {
        const stops = header.nextElementSibling;
        if (stops) {
            stops.style.display = stops.style.display === 'none' ? 'block' : 'none';
        }
    }

    // v2.0 - 凡例更新
    function updateLegend(routes, customers) {
        const legendEl = document.getElementById('legend');
        const itemsEl = document.getElementById('legendItems');

        const activeRoutes = routes.filter(r => customers.some(c => c.routeId === r.id));

        if (activeRoutes.length === 0) {
            legendEl.style.display = 'none';
            return;
        }

        let html = '';
        activeRoutes.forEach(r => {
            const count = customers.filter(c => c.routeId === r.id).length;
            html += `<div class="legend-item">`;
            html += `<span class="legend-color" style="background:${r.color}"></span>`;
            html += `<span>${r.name}（${count}件）</span>`;
            html += `</div>`;
        });

        html += `<div style="border-top:1px solid #e2e8f0;margin:6px 0;"></div>`;
        html += `<div class="legend-item"><span class="legend-color" style="background:#ea4335"></span><span>未アポ</span></div>`;
        html += `<div class="legend-item"><span class="legend-color" style="background:#34a853"></span><span>アポ済み</span></div>`;
        html += `<div class="legend-item"><span class="legend-color" style="background:#9e9e9e"></span><span>完了</span></div>`;

        itemsEl.innerHTML = html;
        legendEl.style.display = 'block';
    }

    // v2.0 - ルート線を地図に描画
    function drawRouteLines() {
        polylines.forEach(p => p.setMap(null));
        polylines = [];

        const routes = DataStorage.getRoutes();
        const customers = DataStorage.getCustomers();
        const cache = DataStorage.getGeoCache();
        const map = MapCore.getMap();
        if (!map) return;

        for (const route of routes) {
            const members = customers.filter(c => c.routeId === route.id);
            if (members.length < 2) continue;

            const path = [];
            for (const m of members) {
                const cached = cache[m.address];
                if (cached) {
                    path.push(new google.maps.LatLng(cached.lat, cached.lng));
                } else if (m.lat && m.lng) {
                    path.push(new google.maps.LatLng(m.lat, m.lng));
                }
            }

            if (path.length >= 2) {
                const polyline = new google.maps.Polyline({
                    path: path,
                    strokeColor: route.color,
                    strokeOpacity: 0.7,
                    strokeWeight: 3,
                    map: map
                });
                polylines.push(polyline);
            }
        }
    }

    // v2.0 - PDF出力
    function exportPDF() {
        const customers = DataStorage.getCustomers();
        if (customers.length === 0) {
            alert('出力するデータがありません。');
            return;
        }

        const routes = DataStorage.getRoutes();
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');

        const today = new Date().toLocaleDateString('ja-JP');

        doc.setFontSize(16);
        doc.text('メンテナンスマップ - 一覧表', 14, 20);
        doc.setFontSize(10);
        doc.text(`出力日: ${today}`, 14, 28);

        let startY = 35;

        for (const route of routes) {
            const members = customers.filter(c => c.routeId === route.id);
            if (members.length === 0) continue;

            doc.setFontSize(12);
            doc.setTextColor(0, 0, 0);
            doc.text(`${route.name}（${members.length}件）`, 14, startY);
            startY += 3;

            const tableData = members.map((m, idx) => [
                idx + 1, m.company || '', m.address || '',
                m.phone || '', m.contact || '',
                m.unitCount > 1 ? `${m.unitCount}台` : '',
                m.status === 'appointed' ? 'アポ済' : m.status === 'completed' ? '完了' : '未アポ'
            ]);

            doc.autoTable({
                startY: startY,
                head: [['#', '会社名', '住所', '電話番号', '担当者', '台数', 'ステータス']],
                body: tableData,
                styles: { fontSize: 7, cellPadding: 2 },
                headStyles: { fillColor: hexToRgb(route.color) },
                margin: { left: 14, right: 14 },
                theme: 'grid'
            });

            startY = doc.lastAutoTable.finalY + 10;
            if (startY > 260) { doc.addPage(); startY = 20; }
        }

        const unassigned = customers.filter(c => !c.routeId);
        if (unassigned.length > 0) {
            doc.setFontSize(12);
            doc.text(`未割当（${unassigned.length}件）`, 14, startY);
            startY += 3;

            const tableData = unassigned.map((m, idx) => [
                idx + 1, m.company || '', m.address || '',
                m.phone || '', m.contact || '',
                m.unitCount > 1 ? `${m.unitCount}台` : '', '未アポ'
            ]);

            doc.autoTable({
                startY: startY,
                head: [['#', '会社名', '住所', '電話番号', '担当者', '台数', 'ステータス']],
                body: tableData,
                styles: { fontSize: 7, cellPadding: 2 },
                headStyles: { fillColor: [158, 158, 158] },
                margin: { left: 14, right: 14 },
                theme: 'grid'
            });
        }

        doc.save(`maintenance_map_${today.replace(/\//g, '-')}.pdf`);
    }

    // v2.0 - HEXカラーをRGBに変換
    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [66, 133, 244];
    }

    // v2.0 - 集計パネル更新
    function updateSummary() {
        const customers = DataStorage.getCustomers();
        const routes = DataStorage.getRoutes();
        const summaryEl = document.getElementById('summaryContent');

        if (customers.length === 0) {
            summaryEl.innerHTML = '<p class="empty-msg">データがありません</p>';
            return;
        }

        let html = '';
        const appointed = customers.filter(c => c.status === 'appointed').length;
        const completed = customers.filter(c => c.status === 'completed').length;
        const pending = customers.filter(c => c.status === 'pending' || !c.status).length;

        html += `<div class="summary-card">`;
        html += `<h3>📊 全体集計</h3>`;
        html += `<div class="summary-row"><span>総件数</span><span class="summary-value">${customers.length}件</span></div>`;
        html += `<div class="summary-row"><span>🔴 未アポ</span><span class="summary-value">${pending}件</span></div>`;
        html += `<div class="summary-row"><span>🟢 アポ済み</span><span class="summary-value">${appointed}件</span></div>`;
        html += `<div class="summary-row"><span>⚪ 完了</span><span class="summary-value">${completed}件</span></div>`;
        html += `</div>`;

        for (const route of routes) {
            const members = customers.filter(c => c.routeId === route.id);
            if (members.length === 0) continue;
            const rAppointed = members.filter(c => c.status === 'appointed').length;
            const rCompleted = members.filter(c => c.status === 'completed').length;

            html += `<div class="summary-card">`;
            html += `<h3><span style="color:${route.color}">●</span> ${route.name}</h3>`;
            html += `<div class="summary-row"><span>件数</span><span class="summary-value">${members.length}件</span></div>`;
            html += `<div class="summary-row"><span>アポ済み</span><span class="summary-value">${rAppointed}件</span></div>`;
            html += `<div class="summary-row"><span>完了</span><span class="summary-value">${rCompleted}件</span></div>`;
            html += `</div>`;
        }

        summaryEl.innerHTML = html;
    }

    // v2.2.4追加 - 住所から都道府県+市区町村を抽出
    function extractArea(address) {
        if (!address) return '';
        // 都道府県パターン: 東京都、北海道、大阪府、京都府、○○県
        // 市区町村パターン: ○○市、○○区、○○町、○○村、○○郡○○町
        const match = address.match(
            /^(東京都|北海道|(?:大阪|京都)府|.{2,3}県)((?:[^市区町村]+?郡)?(?:[^市区町村]+?[市区町村]))/
        );
        if (match) {
            const pref = match[1];
            const city = match[2];
            // 東京23区は「港区」のように区名だけだと分かりにくいので「東京都港区」にする
            return pref + city;
        }
        // マッチしない場合は先頭から適当に切り出す
        return address.substring(0, 10);
    }

    // v2.2.4追加 - ルート顧客から行先テキストを組み立て
    // フォーマット: 上段=地区名（重複除外・中黒区切り）、下段=会社名（ルート順・中黒区切り）
    function buildDestinationText(orderedCustomers) {
        // 地区名を抽出（重複除外、順序維持）
        const areas = [];
        const areaSet = new Set();
        for (const c of orderedCustomers) {
            const area = extractArea(c.address);
            if (area && !areaSet.has(area)) {
                areaSet.add(area);
                areas.push(area);
            }
        }

        // 会社名をルート順に列挙（重複除外）
        const companies = [];
        const compSet = new Set();
        for (const c of orderedCustomers) {
            const name = (c.company || '').trim();
            if (name && !compSet.has(name)) {
                compSet.add(name);
                companies.push(name);
            }
        }

        // 上段: 地区名、下段: 会社名（→で区切ってルート順を表現）
        const areaLine = areas.join('→');
        const companyLine = companies.join('→');
        return areaLine + '\n' + companyLine;
    }

    // v2.2.3変更 - 区間別選択→距離計算→結果表示
    async function calcDistance(routeId) {
        const routes = DataStorage.getRoutes();
        const route = routes.find(r => r.id === routeId);
        if (!route) { alert('ルートが見つかりません'); return; }

        const customers = DataStorage.getCustomers();
        const members = customers.filter(c => c.routeId === routeId);

        // 訪問順で並べ替え
        const ordered = [];
        if (route.order && route.order.length > 0) {
            for (const cid of route.order) {
                const found = members.find(m => m.id === cid);
                if (found) ordered.push(found);
            }
            for (const m of members) {
                if (!ordered.find(o => o.id === m.id)) ordered.push(m);
            }
        } else {
            ordered.push(...members);
        }

        // 自宅住所チェック
        const settings = DataStorage.getSettings();
        if (!settings.homeAddress) { alert('設定で自宅住所（出発点）を登録してください'); return; }

        // v2.2.3 - ポイントリスト（表示名付き）
        const points = [];
        points.push({ id: 'home_start', address: settings.homeAddress, label: '🏠 自宅（出発）' });
        ordered.forEach(m => {
            points.push({ id: m.id, address: m.address, label: (m.company || '不明').substring(0, 15) });
        });
        points.push({ id: 'home_end', address: settings.homeAddress, label: '🏠 自宅（帰着）' });

        // v2.2.3 - 保存済み区間設定を取得
        const allSegments = DataStorage.getSegments();
        const savedSegments = allSegments[routeId] || {};

        // v2.2.3 - 区間選択ダイアログ（segment-dialog.js）
        const segmentChoices = await SegmentDialog.show(points, savedSegments);
        if (!segmentChoices) return;

        // v2.2.3 - 選択結果を保存（次回用）
        allSegments[routeId] = segmentChoices;
        DataStorage.saveSegments(allSegments);

        // 計算実行
        const loading = document.getElementById('mapLoading');
        loading.style.display = 'flex';
        document.getElementById('mapLoadingProgress').textContent = '走行距離計算中...';

        try {
            const result = await DistanceCalc.calcRouteDistance(routeId, segmentChoices);
            loading.style.display = 'none';

            let msg = `📏 ${route.name} の走行距離\n\n`;
            msg += `総距離: ${result.totalKm}km\n`;
            msg += `  🚗 下道: ${result.generalKm}km\n`;
            msg += `  🛣️ 高速: ${result.highwayKm}km\n\n`;
            msg += `--- 区間詳細 ---\n`;
            result.segments.forEach((s, i) => {
                const icon = s.type === 'highway' ? '🛣️' : '🚗';
                msg += `${i + 1}. ${icon} ${s.km}km (${s.duration})\n`;
                msg += `   ${s.from} → ${s.to}\n`;
            });
            msg += `\n精算書に反映しますか？`;

            if (confirm(msg)) {
                // v2.2.4変更 - 行先テキストも一緒に渡す
                const destText = buildDestinationText(ordered);
                applyDistanceToExpense(result.totalKm, destText);
            }
        } catch (err) {
            loading.style.display = 'none';
            alert('❌ 距離計算に失敗しました\n' + err.message);
        }
    }

    // v2.2.4変更 - 距離＋行先を精算書フォームに反映
    function applyDistanceToExpense(totalKm, destText) {
        mapSwitchTab('expense');
        MapExpenseForm.init();
        setTimeout(() => {
            // v2.2.4追加 - 行先テキストを自動入力
            if (destText) {
                MapExpenseForm.setDestination(destText);
            }
            // 走行距離を1行目に反映
            const firstRow = document.querySelector('.exp-row');
            if (firstRow) {
                const distInput = firstRow.querySelector('.exp-distance');
                if (distInput) {
                    distInput.value = totalKm;
                    MapExpenseForm.updateGas(distInput);
                }
            }
        }, 200);
    }

    // v2.0 - 公開API
    return {
        updateRoutePanel, toggleRouteSection,
        drawRouteLines, exportPDF, updateSummary,
        calcDistance
    };
})();
