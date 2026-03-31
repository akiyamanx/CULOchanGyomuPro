// [CULOchanGyomuPro統合] v1.5 2026-04-01 - mapSwitchTabスコープ化修正
// ============================================
// メンテナンスマップ v2.5 - ui-actions.js
// グローバルUI関数（モーダル・メニュー・パネル制御）
// v2.0新規作成 - map-core.jsから分離
// v2.3追加 - ワークスペース切り替えUI
// v2.5追加 - 目的(purpose)フィールド対応
// v1.4追加 - ドロップダウン式ツールバー（toggleMapToolbar）
// v1.5修正 - mapSwitchTab/reloadAllUIのセレクタを#bottomPanelスコープに限定
// ============================================

// =============================================
// v1.4追加 - ドロップダウン式ツールバー
// =============================================

// v1.4 ドロップダウンの開閉トグル
function toggleMapToolbar() {
    const dropdown = document.getElementById('mapToolbarDropdown');
    const toggleBtn = document.getElementById('compactToggleBtn');
    if (!dropdown || !toggleBtn) return;
    const isExpanded = dropdown.classList.contains('expanded');
    if (isExpanded) {
        // 閉じる
        dropdown.classList.remove('expanded');
        toggleBtn.classList.remove('expanded');
    } else {
        // 開く
        dropdown.classList.add('expanded');
        toggleBtn.classList.add('expanded');
        // メニューパネルが開いていたら閉じる
        const menuPanel = document.getElementById('menuPanel');
        if (menuPanel && menuPanel.style.display === 'block') {
            menuPanel.style.display = 'none';
        }
    }
}

// v1.4 ドロップダウン外をタップしたら閉じる
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('mapToolbarDropdown');
    const toggleBtn = document.getElementById('compactToggleBtn');
    if (!dropdown || !toggleBtn) return;
    if (!dropdown.classList.contains('expanded')) return;
    // ドロップダウン内またはトグルボタンのクリックは無視
    if (dropdown.contains(e.target) || toggleBtn.contains(e.target)) return;
    // コンパクトバー内のクリックも無視（WSボタン等）
    const compactBar = document.querySelector('.map-compact-bar');
    if (compactBar && compactBar.contains(e.target)) return;
    // それ以外は閉じる
    dropdown.classList.remove('expanded');
    toggleBtn.classList.remove('expanded');
});

// =============================================
// v2.3 - ワークスペース切り替えUI
// =============================================

// v2.3 - ワークスペースボタンのラベルを更新
// v1.4修正: コンパクトバーのWSボタンも更新
function updateWsButton() {
    const btn = document.getElementById('wsSwitchBtn');
    const compactBtn = document.getElementById('compactWsBtn');
    const wsId = DataStorage.getCurrentWorkspaceId();
    const workspaces = DataStorage.getWorkspaces();
    const current = workspaces.find(ws => ws.id === wsId);
    const shortName = (() => {
        if (!current) return '--';
        const match = current.id.match(/^\d{4}-(\d{2})$/);
        return match ? parseInt(match[1]) + '月' : current.name;
    })();
    // 旧ヘッダーのWSボタン（互換性のため残す）
    if (btn) btn.textContent = '📅 ' + shortName;
    // v1.4 コンパクトバーのWSボタンを更新
    if (compactBtn) compactBtn.textContent = '📅 ' + shortName;
    // v1.4 件数バッジも更新
    updateCompactCount();
}

// v1.4追加 - コンパクトバーの件数を更新
function updateCompactCount() {
    const compactCount = document.getElementById('compactCount');
    if (!compactCount) return;
    try {
        const customers = DataStorage.getCustomers();
        compactCount.textContent = customers.length + '件';
    } catch (e) {
        compactCount.textContent = '0件';
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
            if (!isActive) {
                html += `<button class="ws-menu-delete" onclick="event.stopPropagation(); confirmDeleteWorkspace('${ws.id}', '${ws.name}')">🗑️</button>`;
            }
            html += `</div>`;
        });
    }
    list.innerHTML = html;
    overlay.style.display = 'flex';

    // メニューパネルが開いてたら閉じる
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
    // v1.4 ドロップダウンが開いてたら閉じる
    const dropdown = document.getElementById('mapToolbarDropdown');
    const toggleBtn = document.getElementById('compactToggleBtn');
    if (dropdown && dropdown.classList.contains('expanded')) {
        dropdown.classList.remove('expanded');
        if (toggleBtn) toggleBtn.classList.remove('expanded');
    }
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
        reloadAllUI();
        updateWsButton();
    }
}

// v2.3 - 全UIを再描画（ワークスペース切り替え後）
// v1.5修正: セレクタを#bottomPanelスコープに限定
function reloadAllUI() {
    MapCore.refreshAllMarkers();
    RouteManager.updateRoutePanel();
    if (typeof MapExpenseForm !== 'undefined' && MapExpenseForm.resetInitFlag) {
        MapExpenseForm.resetInitFlag();
    }
    // v1.5修正: #bottomPanel内のactiveタブを検索（グローバル検索を回避）
    const panel = document.getElementById('bottomPanel');
    const activeTab = panel ? panel.querySelector('.tab.active') : null;
    if (activeTab && activeTab.dataset.tab === 'expense') {
        MapExpenseForm.init();
    }
    if (activeTab && activeTab.dataset.tab === 'summary') {
        RouteManager.updateSummary();
    }
    // v1.4 件数バッジも更新
    updateCompactCount();
}

// v2.3 - ワークスペース追加ダイアログを表示
function showAddWorkspaceDialog() {
    hideWorkspaceMenu();
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
    showWorkspaceMenu();
    updateWsButton();
    reloadAllUI();
}

// =============================================
// v2.0 - 既存のUI関数
// =============================================

// v2.0 - メニュートグル
function toggleMenu() {
    const panel = document.getElementById('menuPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

// v2.0 - メニュー以外をクリックしたら閉じる（メニューパネル用）
document.addEventListener('click', (e) => {
    const panel = document.getElementById('menuPanel');
    if (panel && panel.style.display === 'block' && !e.target.closest('.menu-panel') && !e.target.closest('.btn-menu') && !e.target.closest('.toolbar-item')) {
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
    // v1.4 件数を更新
    updateCompactCount();
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
    // v1.4 件数を更新
    updateCompactCount();
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
    // v1.4 件数を更新
    updateCompactCount();
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

// v2.0 - タブ切替（マップ底部パネル内のサブタブ）
// v1.5修正: セレクタを#bottomPanelスコープに限定（他タブとの衝突防止）
function mapSwitchTab(tabName) {
    const panel = document.getElementById('bottomPanel');
    if (!panel) return;
    // v1.5 #bottomPanel内のみ検索してactive切替
    panel.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    panel.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    const targetTab = panel.querySelector(`.tab[data-tab="${tabName}"]`);
    if (targetTab) targetTab.classList.add('active');
    const tabId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
    const targetContent = document.getElementById(tabId);
    if (targetContent) targetContent.classList.add('active');

    if (tabName === 'summary') {
        RouteManager.updateSummary();
    }
    if (tabName === 'expense') {
        MapExpenseForm.init();
        panel.classList.remove('collapsed');
        panel.style.maxHeight = '85vh';
    } else {
        panel.style.maxHeight = '55vh';
    }
}

// v2.0 - 凡例トグル
function toggleLegend() {
    const legend = document.getElementById('legend');
    legend.style.display = legend.style.display === 'none' ? 'block' : 'none';
}
