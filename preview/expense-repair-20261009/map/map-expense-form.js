// マップの利用日・ルートを選び、日別の精算書へ反映する。
const MapExpenseForm = (() => {
    function init() {
        const container = document.getElementById('tabExpense');
        if (!container) return;
        if (!document.getElementById('mapExpenseDate')) {
            const today = new Date().toLocaleDateString('sv-SE');
            const month = DataStorage.getCurrentWorkspaceId();
            const date = /^\d{4}-\d{2}$/.test(month || '') && !today.startsWith(month) ? month + '-01' : today;
            container.innerHTML = '<div class="map-exp-bridge">'
                + '<h3>この日の交通費を精算</h3><p>利用日とルートを選び、行先・距離・駐車場代を反映します。</p>'
                + '<label for="mapExpenseDate">利用日</label><input class="exp-input" type="date" id="mapExpenseDate" value="' + date + '" onchange="MapExpenseForm.updateSummary()">'
                + '<label for="mapExpenseRoute">ルート</label><select class="exp-input" id="mapExpenseRoute" onchange="MapExpenseForm.updateSummary()"></select>'
                + '<div id="mapExpSummary" role="status"></div>'
                + '<div class="exp-btn-row"><button class="btn btn-primary" onclick="MapExpenseForm.calcDistance()">① 走行距離を計算</button>'
                + '<button class="btn btn-save" onclick="MapExpenseForm.reflectToExpense()">② 精算書に反映して確認</button></div>'
                + '<label class="btn btn-primary map-etc-upload">ETC CSVを取り込む<input type="file" accept=".csv" onchange="ExpenseEtc.handleFile(event)" hidden></label>'
                + '<button class="btn btn-secondary" onclick="MapExpenseForm.openExpenseTab()">精算書を開く</button></div>';
        }
        updateSummary();
    }

    function _selection() {
        const date = ExpenseImport.normalizeDate(document.getElementById('mapExpenseDate').value);
        const routeId = document.getElementById('mapExpenseRoute').value;
        const route = DataStorage.getRoutes().find(item => item.id === routeId);
        const members = DataStorage.getCustomers().filter(item => item.routeId === routeId && ExpenseImport.normalizeDate(item.appoDate) === date);
        const order = route && route.order || [];
        members.sort((a, b) => {
            const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
            return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
        });
        return { date, routeId, route, members };
    }

    function updateSummary() {
        const select = document.getElementById('mapExpenseRoute');
        const summary = document.getElementById('mapExpSummary');
        if (!select || !summary) return;
        const previous = select.value;
        const routes = DataStorage.getRoutes();
        const esc = ExpenseImport.escapeHtml;
        select.innerHTML = routes.map(route => '<option value="' + esc(route.id) + '">' + esc(route.name) + '</option>').join('');
        if (routes.some(route => route.id === previous)) select.value = previous;
        const selected = _selection();
        if (!selected.date) { summary.textContent = '利用日を選択してください。'; return; }
        if (!selected.members.length) { summary.textContent = 'この日・ルートの訪問先がありません。マップで訪問先のアポ日時とルートを確認してください。'; return; }
        const result = RouteManager.getDistance(selected.routeId, selected.date);
        summary.innerHTML = '<p>訪問先: ' + selected.members.length + '件<br>'
            + selected.members.map(item => esc(item.company)).join(' → ') + '</p>'
            + '<p>走行距離: ' + (result ? result.totalKm + ' km' : '未計算（計算後に反映できます）') + '</p>'
            + '<p>反映すると、この日の行先・距離を選択中のルートで更新します。</p>';
    }

    function calcDistance() {
        const selected = _selection();
        if (!selected.date || !selected.members.length) { alert('利用日と訪問先のあるルートを選択してください'); return; }
        return RouteManager.calcDistance(selected.routeId, selected.date);
    }

    function reflectToExpense() {
        try {
            const selected = _selection();
            if (!selected.date || !selected.members.length) throw new Error('利用日と訪問先のあるルートを選択してください');
            const result = RouteManager.getDistance(selected.routeId, selected.date);
            if (!result) throw new Error('先にこの日の走行距離を計算してください');
            ExpenseManager.applyRoute(selected.date, result.totalKm, RouteManager.buildDestinationText(selected.members));
            const parking = ExpenseManager.syncParking(selected.date);
            openExpenseTab();
            alert('行先・距離・駐車場代を ' + selected.date + ' の明細へ反映しました。'
                + (parking.invalid ? '\n日付・金額が未確認の駐車場明細が ' + parking.invalid + '件あります。' : ''));
        } catch (error) { alert(error.message); }
    }

    function openExpenseTab() { AppCore.switchTab('expense'); }
    function resetInitFlag() {
        const container = document.getElementById('tabExpense');
        if (container) container.innerHTML = '';
    }
    function setDestination() {} // 旧呼び出しとの互換
    return { init, updateSummary, calcDistance, reflectToExpense, openExpenseTab, resetInitFlag, setDestination };
})();


