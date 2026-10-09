// [CULOchanGyomuPro統合] v2.0 2026-04-02 - 行先住所を町名まで切り出すよう修正
// ============================================
// メンテナンスマップ v2.2.4 - route-manager.js
// v1.5修正 - updateLegendの自動display:block廃止
// v1.6改修 - applyDistanceToExpenseをExpenseManager直接呼び出しに変更
// v1.7改修 - buildDestinationTextを{company,address}の2フィールド対応に変更
// v1.8修正 - AppCore.switchTabとmapSwitchTabの競合を修正
// v1.9修正 - buildDestinationTextで住所の重複排除を廃止→会社名と1対1で並べる
// v2.0修正 - 住所切り出しを町名まで拡張（数字・スペース手前まで）
// ============================================

const RouteManager = (() => {
    let polylines = [];

    function updateRoutePanel() {
        const routes = DataStorage.getRoutes();
        const customers = DataStorage.getCustomers();
        const routeEl = document.getElementById('routeManager');
        let html = '';

        for (const route of routes) {
            const members = customers.filter(c => c.routeId === route.id);
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
            if (members.length >= 1) {
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
                    html += `</span></div>`;
                });
                html += `</div>`;
            }
            html += `</div>`;
        }

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
        updateLegend(routes, customers);
    }

    function toggleRouteSection(header) {
        const stops = header.nextElementSibling;
        if (stops) { stops.style.display = stops.style.display === 'none' ? 'block' : 'none'; }
    }

    function updateLegend(routes, customers) {
        const legendEl = document.getElementById('legend');
        const itemsEl = document.getElementById('legendItems');
        const activeRoutes = routes.filter(r => customers.some(c => c.routeId === r.id));
        if (activeRoutes.length === 0) { legendEl.style.display = 'none'; return; }

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
    }

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
                if (cached) { path.push(new google.maps.LatLng(cached.lat, cached.lng)); }
                else if (m.lat && m.lng) { path.push(new google.maps.LatLng(m.lat, m.lng)); }
            }
            if (path.length >= 2) {
                const polyline = new google.maps.Polyline({
                    path: path, strokeColor: route.color,
                    strokeOpacity: 0.7, strokeWeight: 3, map: map
                });
                polylines.push(polyline);
            }
        }
    }

    function exportPDF() { return RouteListPdf.generate(); }

    function hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [66, 133, 244];
    }

    function updateSummary() {
        const customers = DataStorage.getCustomers();
        const routes = DataStorage.getRoutes();
        const summaryEl = document.getElementById('summaryContent');
        if (customers.length === 0) { summaryEl.innerHTML = '<p class="empty-msg">データがありません</p>'; return; }

        let html = '';
        const appointed = customers.filter(c => c.status === 'appointed').length;
        const completed = customers.filter(c => c.status === 'completed').length;
        const pending = customers.filter(c => c.status === 'pending' || !c.status).length;
        html += `<div class="summary-card"><h3>📊 全体集計</h3>`;
        html += `<div class="summary-row"><span>総件数</span><span class="summary-value">${customers.length}件</span></div>`;
        html += `<div class="summary-row"><span>🔴 未アポ</span><span class="summary-value">${pending}件</span></div>`;
        html += `<div class="summary-row"><span>🟢 アポ済み</span><span class="summary-value">${appointed}件</span></div>`;
        html += `<div class="summary-row"><span>⚪ 完了</span><span class="summary-value">${completed}件</span></div></div>`;

        for (const route of routes) {
            const members = customers.filter(c => c.routeId === route.id);
            if (members.length === 0) continue;
            const rAppointed = members.filter(c => c.status === 'appointed').length;
            const rCompleted = members.filter(c => c.status === 'completed').length;
            html += `<div class="summary-card"><h3><span style="color:${route.color}">●</span> ${route.name}</h3>`;
            html += `<div class="summary-row"><span>件数</span><span class="summary-value">${members.length}件</span></div>`;
            html += `<div class="summary-row"><span>アポ済み</span><span class="summary-value">${rAppointed}件</span></div>`;
            html += `<div class="summary-row"><span>完了</span><span class="summary-value">${rCompleted}件</span></div></div>`;
        }
        summaryEl.innerHTML = html;
    }

    // v2.0修正 - 住所から番地を除いた町名レベルまで切り出す
    // 例: 「東京都中央区日本橋浜町3-21-1」→「東京都中央区日本橋浜町」
    // 例: 「東京都江東区夢の島3-3」→「東京都江東区夢の島」
    function trimToTownLevel(address) {
        if (!address) return '';
        // 数字・ハイフン・全角スペース・半角スペースが来る手前まで取る
        const match = address.match(/^(.*?)(?=\d|　| )/);
        if (match && match[1]) {
            // 末尾の不要な文字（ハイフン等）をトリム
            return match[1].replace(/[-\s]+$/, '');
        }
        return address;
    }

    function extractArea(address) {
        if (!address) return '';
        // v2.0: 町名レベルまで切り出す
        return trimToTownLevel(address) || address.substring(0, 10);
    }

    // v2.0修正 - 会社名と住所を1対1で並べる、住所は町名レベルまで
    function buildDestinationText(orderedCustomers) {
        const companies = [];
        const areas = [];
        for (const c of orderedCustomers) {
            const name = (c.company || '').trim();
            if (name) companies.push(name);
            // 住所は町名レベルに切り詰め（数字の手前まで）
            const area = trimToTownLevel((c.address || '').trim());
            areas.push(area || (c.address || '').substring(0, 10));
        }
        return { company: companies.join(' → '), address: areas.join(' → ') };
    }

    async function calcDistance(routeId, selectedDate) {
        const routes = DataStorage.getRoutes();
        const route = routes.find(r => r.id === routeId);
        if (!route) { alert('ルートが見つかりません'); return; }
        const customers = DataStorage.getCustomers();
        const allMembers = customers.filter(c => c.routeId === routeId);
        const dates = [...new Set(allMembers.map(c => ExpenseImport.normalizeDate(c.appoDate)).filter(Boolean))];
        const date = ExpenseImport.normalizeDate(selectedDate) || (dates.length === 1 ? dates[0] : '');
        if (!date) {
            mapSwitchTab('expense');
            const select = document.getElementById('mapExpenseRoute');
            if (select) select.value = routeId;
            MapExpenseForm.updateSummary();
            alert('精算する利用日を選び、走行距離を計算してください');
            return;
        }
        const members = allMembers.filter(c => ExpenseImport.normalizeDate(c.appoDate) === date);
        if (!members.length) { alert('この日の訪問先がありません'); return; }
        const ordered = [];
        if (route.order && route.order.length > 0) {
            for (const cid of route.order) {
                const found = members.find(m => m.id === cid);
                if (found) ordered.push(found);
            }
            for (const m of members) { if (!ordered.find(o => o.id === m.id)) ordered.push(m); }
        } else { ordered.push(...members); }

        const settings = DataStorage.getSettings();
        if (!settings.homeAddress) { alert('設定で自宅住所（出発点）を登録してください'); return; }

        const points = [];
        points.push({ id: 'home_start', address: settings.homeAddress, label: '🏠 自宅（出発）' });
        ordered.forEach(m => { points.push({ id: m.id, address: m.address, label: (m.company || '不明').substring(0, 15) }); });
        points.push({ id: 'home_end', address: settings.homeAddress, label: '🏠 自宅（帰着）' });

        const workspace = DataStorage.getCurrentWorkspaceId();
        const signature = distanceSignature(routeId, date);
        const allSegments = DataStorage.getSegments();
        const savedSegments = allSegments[routeId] || {};
        const segmentChoices = await SegmentDialog.show(points, savedSegments);
        if (!segmentChoices) return;
        if (DataStorage.getCurrentWorkspaceId() !== workspace || distanceSignature(routeId, date) !== signature) {
            alert('月または訪問先が変更されました。計算し直してください'); return;
        }
        allSegments[routeId] = segmentChoices;
        DataStorage.saveSegments(allSegments);

        // 道路設定を選び直した再計算が失敗しても、以前の距離を使わない。
        const recalculatingRoutes = DataStorage.getRoutes();
        const recalculatingRoute = recalculatingRoutes.find(item => item.id === routeId);
        if (!recalculatingRoute) { alert('ルートが変更されました。選び直してください'); return; }
        if (recalculatingRoute.distanceResults) delete recalculatingRoute.distanceResults[date];
        DataStorage.saveRoutes(recalculatingRoutes);
        MapExpenseForm.updateSummary();

        const loading = document.getElementById('mapLoading');
        loading.style.display = 'flex';
        document.getElementById('mapLoadingProgress').textContent = '走行距離計算中...';

        try {
            const result = await DistanceCalc.calcRouteDistance(routeId, segmentChoices, date);
            if (DataStorage.getCurrentWorkspaceId() !== workspace) throw new Error('月が切り替わりました。選択中の月で計算し直してください');
            if (distanceSignature(routeId, date) !== signature) throw new Error('訪問先が変更されました。計算し直してください');
            route.distanceResults = route.distanceResults || {};
            route.distanceResults[date] = { ...result, signature };
            // 計算待ちの間に行われた他ルートの編集を上書きしない。
            const currentRoutes = DataStorage.getRoutes();
            const currentRoute = currentRoutes.find(item => item.id === routeId);
            currentRoute.distanceResults = { ...(currentRoute.distanceResults || {}), [date]: route.distanceResults[date] };
            DataStorage.saveRoutes(currentRoutes);
            MapExpenseForm.updateSummary();
            loading.style.display = 'none';
            let msg = `📏 ${route.name} の走行距離\n\n`;
            msg += `総距離: ${result.totalKm}km\n  🚗 下道: ${result.generalKm}km\n  🛣️ 高速: ${result.highwayKm}km\n\n--- 区間詳細 ---\n`;
            result.segments.forEach((s, i) => {
                const icon = s.type === 'highway' ? '🛣️' : '🚗';
                msg += `${i + 1}. ${icon} ${s.km}km (${s.duration})\n   ${s.from} → ${s.to}\n`;
            });
            msg += `\n精算書に反映しますか？`;
            if (confirm(msg)) {
                const dest = buildDestinationText(ordered);
                ExpenseManager.applyRoute(date, result.totalKm, dest);
                ExpenseManager.syncParking(date);
                AppCore.switchTab('expense');
            }
        } catch (err) {
            loading.style.display = 'none';
            alert('❌ 距離計算に失敗しました\n' + err.message);
        }
    }

    function distanceSignature(routeId, date) {
        const route = DataStorage.getRoutes().find(item => item.id === routeId);
        const order = route && route.order || [];
        const members = DataStorage.getCustomers().filter(item => item.routeId === routeId && ExpenseImport.normalizeDate(item.appoDate) === date);
        members.sort((a, b) => {
            const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
            return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
        });
        return JSON.stringify([DataStorage.getSettings().homeAddress, members.map(item => [item.id, item.address])]);
    }

    function getDistance(routeId, date) {
        const route = DataStorage.getRoutes().find(item => item.id === routeId);
        const result = route && route.distanceResults && route.distanceResults[date];
        return result && result.signature === distanceSignature(routeId, date) ? result : null;
    }

    return {
        updateRoutePanel, toggleRouteSection,
        drawRouteLines, exportPDF, updateSummary,
        calcDistance, getDistance, distanceSignature, buildDestinationText
    };
})();


