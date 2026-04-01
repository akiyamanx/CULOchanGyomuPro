// ==========================================
// CULOchan業務Pro — マップ内精算書サブタブ v2.0
// このファイルはマップの💰精算書タブを担当する
// Phase E Step3: フォーム機能をメイン精算書タブに一本化
//   → このタブはルート集計表示＋「精算書タブで開く」ボタンのみ
// v1.3 旧バージョン: MapExpenseForm内に独自フォームあり（廃止）
// v2.0 新バージョン: 集計表示＋メイン精算書タブへの誘導に変更
//
// 依存: app-core.js, route-manager.js, expense-manager.js
// ==========================================

const MapExpenseForm = (() => {
    let initialized = false;

    // ==========================================
    // 初期化（ui-actions.jsから呼ばれる）
    // ==========================================
    function init() {
        if (!initialized) {
            _render();
            initialized = true;
        } else {
            _updateSummary();
        }
    }

    // ==========================================
    // サブタブのHTML生成（初回のみ）
    // ==========================================
    function _render() {
        const container = document.getElementById('tabExpense');
        if (!container) return;
        container.innerHTML = ''
            + '<div class="map-exp-bridge">'
            + '<div class="map-exp-bridge-icon">🧾</div>'
            + '<div class="map-exp-bridge-title">精算書はメインタブで作成できます</div>'
            + '<div class="map-exp-bridge-hint">ルート情報（行先・走行距離）を<br>精算書タブに自動反映します</div>'
            + '<button class="btn btn-primary map-exp-bridge-btn"'
            + ' onclick="MapExpenseForm.openExpenseTab()">📋 精算書タブを開く</button>'
            + '<div class="map-exp-summary" id="mapExpSummary"></div>'
            + '</div>';
        _updateSummary();
    }

    // ==========================================
    // ルート集計をサブタブに表示
    // ==========================================
    function _updateSummary() {
        const el = document.getElementById('mapExpSummary');
        if (!el) return;
        const summary = _getRouteSummary();
        if (!summary) {
            el.innerHTML = '<p class="empty-msg" style="margin-top:12px;">ルートを計画すると集計が表示されます</p>';
            return;
        }
        const gasCost = summary.totalKm >= 100 ? (summary.totalKm - 100) * 30 : 0;
        el.innerHTML = ''
            + '<div class="map-exp-summary-title">📊 現在のルート集計</div>'
            + '<div class="map-exp-summary-row"><span>総走行距離</span><span>' + summary.totalKm + ' km</span></div>'
            + (gasCost > 0
                ? '<div class="map-exp-summary-row"><span>ガソリン代（試算）</span><span>¥' + gasCost.toLocaleString() + '</span></div>'
                : '<div class="map-exp-summary-row exp-summary-note"><span>走行距離100km未満</span><span>精算対象外</span></div>'
              )
            + (summary.customerCount > 0
                ? '<div class="map-exp-summary-row"><span>訪問先</span><span>' + summary.customerCount + '件</span></div>'
                : '')
            + '<button class="btn btn-secondary map-exp-reflect-btn"'
            + ' onclick="MapExpenseForm.reflectToExpense()">⬆️ 精算書に反映して開く</button>';
    }

    // ==========================================
    // RouteManagerからルート集計を取得
    // ==========================================
    function _getRouteSummary() {
        try {
            if (typeof RouteManager === 'undefined') return null;
            const routes = RouteManager.getRoutes ? RouteManager.getRoutes() : null;
            if (!routes || routes.length === 0) return null;
            let totalKm = 0;
            let customerCount = 0;
            routes.forEach(r => {
                if (r.totalDistance) totalKm += Math.round(r.totalDistance / 1000);
                if (r.customers) customerCount += r.customers.length;
            });
            return { totalKm, customerCount };
        } catch (e) { return null; }
    }

    // ==========================================
    // 精算書タブを開く（メインタブに切り替え）
    // ==========================================
    function openExpenseTab() {
        if (typeof AppCore !== 'undefined' && AppCore.switchTab) {
            AppCore.switchTab('expense');
        }
    }

    // ==========================================
    // ルート集計を精算書タブに反映してから開く
    // ==========================================
    function reflectToExpense() {
        const summary = _getRouteSummary();
        if (summary && summary.totalKm > 0) {
            const firstRow = document.querySelector('#tab-expense .exp-row');
            if (firstRow) {
                const distInput = firstRow.querySelector('.exp-distance');
                if (distInput) {
                    distInput.value = summary.totalKm;
                    if (typeof ExpenseManager !== 'undefined') {
                        ExpenseManager.onDistanceChange(distInput);
                    }
                }
                const transport = firstRow.querySelector('.exp-transport');
                if (transport && !transport.value) transport.value = '高速道路';
            }
            alert('✅ 走行距離 ' + summary.totalKm + ' km を精算書に反映しました！');
        }
        openExpenseTab();
    }

    // ==========================================
    // resetInitFlag — ui-actions.jsからワークスペース切替時に呼ばれる
    // ==========================================
    function resetInitFlag() {
        initialized = false;
        _updateSummary();
    }

    // setDestination — 後方互換（呼ばれても何もしない）
    function setDestination() {}

    return { init, resetInitFlag, setDestination, openExpenseTab, reflectToExpense };
})();
