// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.5 - ui-actions.js
// グローバルUI関数（モーダル・メニュー・パネル制御）
// v2.0新規作成 - map-core.jsから分離
// v2.3追加 - ワークスペース切り替えUI
// v2.5追加 - 目的(purpose)フィールド対応
// ============================================

// =============================================
// v2.3 - ワークスペース切り替えUI
// =============================================

// v2.3 - ワークスペースボタンのラベルを更新
function updateWsButton() {
    const btn = document.getElementById('wsSwitchBtn');
    if (!btn) return;
    const wsId = DataStorage.getCurrentWorkspaceId();
    const workspaces = DataStorage.getWorkspaces();
    const current = workspaces.find(ws => ws.id === wsId);
    if (current) {
        // v2.3 - 短い表示名（例: "2月"）
        const match = current.id.match(/^\d{4}-(\d{2})$/);
        const shortName = match ? parseInt(match[1]) + '月' : current.name;
        btn.textContent = '📅 ' + shortName;
    } else {
        btn.textContent = '📅 --';
    }
}

// v2.3 - ワークスペースメニューを表示
function showWorkspaceMenu() {
    const overlay = document.getElementById('wsMenuOverlay');
    const list = document.getElementById('wsMenuList');
    const workspaces = DataStorage.getWorkspaces();
    const currentId = DataStorage.getCurrentWorkspaceId();

    let html = '';
    if (workspaces.length === 0) {
        html = '<div class="ws-menu-empty">ワークスペースがありません</div>';
    } else {
        workspaces.forEach(ws => {
            const isActive = ws.id === currentId;
            const match = ws.id.match(/^\d{4}-(\d{2})$/);
            const displayMonth = match ? parseInt(match[1]) + '月' : ws.id;
            const displayYear = match ? ws.id.substring(0, 4) + '年' : '';
            const customers = (() => {
                // v2.3 - 各ワークスペースの件数を取得（直接LocalStorageから）
                try {
                    const data = localStorage.getItem('mm_customers_' + ws.id);
                    return data ? JSON.parse(data).length : 0;
                } catch (e) { return 0; }
            })();

            html += `<div class="ws-menu-item ${isActive ? 'ws-active' : ''}" onclick="selectWorkspace('${ws.id}')">`;
            html += `<div class="ws-menu-item-main">`;
            html += `<span class="ws-menu-check">${isActive ? '✅' : '　'}</span>`;
            html += `<span class="ws-menu-name">${displayYear}${displayMonth}</span>`;
            html += `<span class="ws-menu-sub">${ws.name}</span>`;
            html += `</div>`;
            html += `<span class="ws-menu-count">${customers}件</span>`;
            // v2.3 - 現在のワークスペース以外に削除ボタン
            if (!isActive) {
                html += `<button class="ws-menu-delete" onclick="event.stopPropagation(); confirmDeleteWorkspace('${ws.id}', '${ws.name}')">🗑️</button>`;
            }
            html += `</div>`;
        });
    }
    list.innerHTML = html;
    overlay.style.display = 'flex';

    // v2.3 - メニューパネルが開いてたら閉じる
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
}

// v2.3 - ワークスペースメニューを閉じる
function hideWorkspaceMenu() {
    document.getElementById('wsMenuOverlay').style.display = 'none';
}

// v2.3 - ワークスペースを選択して切り替え
function selectWorkspace(wsId) {
    const currentId = DataStorage.getCurrentWorkspaceId();
    if (wsId === currentId) {
        hideWorkspaceMenu();
        return;
    }

    if (DataStorage.switchWorkspace(wsId)) {
        hideWorkspaceMenu();
        // v2.3 - 全UIを再描画
        reloadAllUI();
        updateWsButton();
        const workspaces = DataStorage.getWorkspaces();
        const ws = workspaces.find(w => w.id === wsId);
    }
}

// v2.3 - 全UIを再描画（ワークスペース切り替え後）
function reloadAllUI() {
    // v2.3 - 地図マーカー再描画
    MapCore.refreshAllMarkers();
    // v2.3 - ルートパネル再描画
    RouteManager.updateRoutePanel();
    // v2.3 - 精算書を再初期化（次にタブ開いた時にinit()が走るようにフラグリセット）
    if (typeof MapExpenseForm !== 'undefined' && MapExpenseForm.resetInitFlag) {
        MapExpenseForm.resetInitFlag();
    }
    // v2.3 - 現在のタブが精算書なら即再初期化
    const activeTab = document.querySelector('.tab.active');
    if (activeTab && activeTab.dataset.tab === 'expense') {
        MapExpenseForm.init();
    }
    // v2.3 - 集計タブが開いてれば更新
    if (activeTab && activeTab.dataset.tab === 'summary') {
        RouteManager.updateSummary();
    }
}

// v2.3 - ワークスペース追加ダイアログを表示
function showAddWorkspaceDialog() {
    hideWorkspaceMenu();
    // v2.3 - 来月をデフォルト値に
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const defaultVal = nextMonth.getFullYear() + '-' + String(nextMonth.getMonth() + 1).padStart(2, '0');
    document.getElementById('addWsMonth').value = defaultVal;
    document.getElementById('addWsName').value = '';
    document.getElementById('addWsModal').style.display = 'flex';
}

// v2.3 - ワークスペース追加ダイアログを閉じる
function hideAddWorkspaceDialog() {
    document.getElementById('addWsModal').style.display = 'none';
}

// v2.3 - ワークスペースを作成
function addWorkspace() {
    const monthInput = document.getElementById('addWsMonth').value;
    if (!monthInput) {
        alert('年月を選択してください。');
        return;
    }
    const name = document.getElementById('addWsName').value.trim();
    const ws = DataStorage.createWorkspace(monthInput, name || '');
    if (!ws) {
        alert('このワークスペースは既に存在します。');
        return;
    }
    hideAddWorkspaceDialog();

    // v2.3 - 作成後すぐに切り替えるか確認
    if (confirm(`📅 ${ws.name} を作成しました！\nこのワークスペースに切り替えますか？`)) {
        DataStorage.switchWorkspace(ws.id);
        reloadAllUI();
        updateWsButton();
    }
}

// v2.3 - ワークスペース削除確認
function confirmDeleteWorkspace(wsId, wsName) {
    if (!confirm(`⚠️ 「${wsName}」を削除しますか？\nこのワークスペースの顧客・ルート・精算書データがすべて削除されます。\nこの操作は取り消せません。`)) {
        return;
    }
    DataStorage.deleteWorkspace(wsId);
    // v2.3 - メニューを更新
    showWorkspaceMenu();
    updateWsButton();
    // v2.3 - もし現在のワークスペースが変わったらUI再描画
    reloadAllUI();
}

// =============================================
// v2.0 - 既存のUI関数（変更なし）
// =============================================

// v2.0 - メニュートグル
function toggleMenu() {
    const panel = document.getElementById('menuPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// v2.0 - メニュー以外をクリックしたら閉じる
document.addEventListener('click', (e) => {
    const panel = document.getElementById('menuPanel');
    if (panel && panel.style.display === 'block' && !e.target.closest('.menu-panel') && !e.target.closest('.btn-menu')) {
        panel.style.display = 'none';
    }
});

// v2.0 - 手動追加モーダル
function showAddModal() {
    document.getElementById('addModal').style.display = 'flex';
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
}
function hideAddModal() {
    document.getElementById('addModal').style.display = 'none';
    ['addCompany','addAddress','addPhone','addContact','addNote'].forEach(id => {
        document.getElementById(id).value = '';
    });
    // v2.5追加 - 目的もリセット
    document.getElementById('addPurpose').value = '';
}

// v2.0 - 新規追加実行
function addNewLocation() {
    const company = document.getElementById('addCompany').value.trim();
    const address = document.getElementById('addAddress').value.trim();
    if (!company || !address) {
        alert('会社名と住所は必須です。');
        return;
    }
    const customer = DataStorage.addCustomer({
        company, address,
        phone: document.getElementById('addPhone').value.trim(),
        contact: document.getElementById('addContact').value.trim(),
        note: document.getElementById('addNote').value.trim(),
        purpose: document.getElementById('addPurpose').value,
        unitCount: 1
    });
    hideAddModal();
    MapCore.geocodeAndPlot([customer]);
}

// v2.0 - 編集モーダル
function hideEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

// v2.0 - 編集保存
function saveEdit() {
    const id = MapCore.getCurrentEditId();
    if (!id) return;
    DataStorage.updateCustomer(id, {
        company: document.getElementById('editCompany').value.trim(),
        address: document.getElementById('editAddress').value.trim(),
        phone: document.getElementById('editPhone').value.trim(),
        contact: document.getElementById('editContact').value.trim(),
        note: document.getElementById('editNote').value.trim(),
        status: document.getElementById('editStatus').value,
        routeId: document.getElementById('editRoute').value || null,
        appoDate: document.getElementById('editAppoDate').value || null,
        purpose: document.getElementById('editPurpose').value
    });
    hideEditModal();
    MapCore.refreshAllMarkers();
    RouteManager.updateRoutePanel();
}

// v2.0 - 削除
function deleteLocation() {
    const id = MapCore.getCurrentEditId();
    if (!id) return;
    if (!confirm('この場所を削除しますか？')) return;
    DataStorage.deleteCustomer(id);
    hideEditModal();
    MapCore.refreshAllMarkers();
    RouteManager.updateRoutePanel();
}

// v2.0 - 設定モーダル
function showMapSettingsModal_old() {
    const settings = DataStorage.getSettings();
    document.getElementById('settingHomeAddress').value = settings.homeAddress || '';
    document.getElementById('settingApiKey').value = settings.apiKey || '';
    document.getElementById('mapSettingsModal').style.display = 'flex';
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
}
function hideMapSettingsModal_old() {
    document.getElementById('mapSettingsModal').style.display = 'none';
}
function saveMapSettings_old() {
    const apiKey = document.getElementById('settingApiKey').value.trim();
    const homeAddress = document.getElementById('settingHomeAddress').value.trim();
    DataStorage.saveSettings({ apiKey, homeAddress });
    hideSettingsModal();
    if (apiKey) {
        alert('設定を保存しました。ページをリロードします。');
        location.reload();
    }
}

// v2.3更新 - リセット確認（現在のワークスペース名を表示）
function showResetConfirm() {
    const customers = DataStorage.getCustomers();
    document.getElementById('resetCount').textContent = `${customers.length}件`;
    document.getElementById('resetModal').style.display = 'flex';
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
}
function hideResetConfirm() {
    document.getElementById('resetModal').style.display = 'none';
}
function resetAllData() {
    DataStorage.resetAll();
    hideResetConfirm();
    MapCore.clearMarkers();
    MapCore.updateCountBadge();
    MapCore.updateCustomerList();
    RouteManager.updateRoutePanel();
    alert('🗑️ 現在のワークスペースの全データを削除しました。');
}

// v2.0 - バックアップ
function exportBackup() {
    DataStorage.exportBackup();
    toggleMenu();
}
function importBackup() {
    document.getElementById('backupInput').click();
    toggleMenu();
}

// v2.0 - PDF出力
function exportPDF() {
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
    RouteManager.exportPDF();
}

// v2.0 - 下部パネル制御
function togglePanel() {
    document.getElementById('bottomPanel').classList.toggle('collapsed');
}

// v2.0 - タブ切替
function mapSwitchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelector(`.tab[data-tab="${tabName}"]`).classList.add('active');
    const tabId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
    document.getElementById(tabId).classList.add('active');

    // v2.0 - 集計タブを開いたら更新
    if (tabName === 'summary') {
        RouteManager.updateSummary();
    }

    // v2.1追加 - 精算書タブを開いたら初期化
    if (tabName === 'expense') {
        MapExpenseForm.init();
    }

    // v2.1追加 - 精算書タブ選択時はパネルを広げる
    if (tabName === 'expense') {
        document.getElementById('bottomPanel').classList.remove('collapsed');
        document.getElementById('bottomPanel').style.maxHeight = '85vh';
    } else {
        document.getElementById('bottomPanel').style.maxHeight = '55vh';
    }
}

// v2.0 - 凡例トグル
function toggleLegend() {
    const legend = document.getElementById('legend');
    legend.style.display = legend.style.display === 'none' ? 'block' : 'none';
}