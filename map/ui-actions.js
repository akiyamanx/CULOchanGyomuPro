// [CULOchanGyomuPro統合] v1.9 2026-04-04 - Phase H: GCal直接起動ボタン追加
// ============================================
// メンテナンスマップ v2.5 - ui-actions.js
// グローバルUI関数（モーダル・メニュー・パネル制御）
// v2.0新規作成 - map-core.jsから分離
// v2.3追加 - ワークスペース切り替えUI
// v2.5追加 - 目的(purpose)フィールド対応
// v1.4追加 - ドロップダウン式ツールバー（toggleMapToolbar）
// v1.5修正 - mapSwitchTab/reloadAllUIのセレクタを#bottomPanelスコープに限定
// v1.7修正 - mapSwitchTabデバッグ強化＋eruda対応
// v1.8追加 - Phase H: Googleカレンダー連携（URLリンク方式）
// v1.9追加 - ツールバーからGCal直接起動ボタン
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
        dropdown.classList.remove('expanded');
        toggleBtn.classList.remove('expanded');
    } else {
        dropdown.classList.add('expanded');
        toggleBtn.classList.add('expanded');
        var menuPanel = document.getElementById('menuPanel');
        if (menuPanel && menuPanel.style.display === 'block') {
            menuPanel.style.display = 'none';
        }
    }
}

// v1.4 ドロップダウン外をタップしたら閉じる
document.addEventListener('click', function(e) {
    var dropdown = document.getElementById('mapToolbarDropdown');
    var toggleBtn = document.getElementById('compactToggleBtn');
    if (!dropdown || !toggleBtn) return;
    if (!dropdown.classList.contains('expanded')) return;
    if (dropdown.contains(e.target) || toggleBtn.contains(e.target)) return;
    var compactBar = document.querySelector('.map-compact-bar');
    if (compactBar && compactBar.contains(e.target)) return;
    dropdown.classList.remove('expanded');
    toggleBtn.classList.remove('expanded');
});

// =============================================
// v2.3 - ワークスペース切り替えUI
// =============================================

// v1.4修正: コンパクトバーのWSボタンも更新
function updateWsButton() {
    var btn = document.getElementById('wsSwitchBtn');
    var compactBtn = document.getElementById('compactWsBtn');
    var wsId = DataStorage.getCurrentWorkspaceId();
    var workspaces = DataStorage.getWorkspaces();
    var current = workspaces.find(function(ws) { return ws.id === wsId; });
    var shortName = '--';
    if (current) {
        var match = current.id.match(/^\d{4}-(\d{2})$/);
        shortName = match ? parseInt(match[1]) + '月' : current.name;
    }
    if (btn) btn.textContent = '📅 ' + shortName;
    if (compactBtn) compactBtn.textContent = '📅 ' + shortName;
    updateCompactCount();
}

// v1.4追加 - コンパクトバーの件数を更新
function updateCompactCount() {
    var compactCount = document.getElementById('compactCount');
    if (!compactCount) return;
    try {
        var customers = DataStorage.getCustomers();
        compactCount.textContent = customers.length + '件';
    } catch (e) {
        compactCount.textContent = '0件';
    }
}

// v2.3 - ワークスペースメニューを表示
function showWorkspaceMenu() {
    var overlay = document.getElementById('wsMenuOverlay');
    var list = document.getElementById('wsMenuList');
    var workspaces = DataStorage.getWorkspaces();
    var currentId = DataStorage.getCurrentWorkspaceId();

    var html = '';
    if (workspaces.length === 0) {
        html = '<div class="ws-menu-empty">ワークスペースがありません</div>';
    } else {
        workspaces.forEach(function(ws) {
            var isActive = ws.id === currentId;
            var match = ws.id.match(/^\d{4}-(\d{2})$/);
            var displayMonth = match ? parseInt(match[1]) + '月' : ws.id;
            var displayYear = match ? ws.id.substring(0, 4) + '年' : '';
            var customers = 0;
            try {
                var data = localStorage.getItem('mm_customers_' + ws.id);
                customers = data ? JSON.parse(data).length : 0;
            } catch (e) {}

            html += '<div class="ws-menu-item ' + (isActive ? 'ws-active' : '') + '" onclick="selectWorkspace(\'' + ws.id + '\')">';
            html += '<div class="ws-menu-item-main">';
            html += '<span class="ws-menu-check">' + (isActive ? '✅' : '　') + '</span>';
            html += '<span class="ws-menu-name">' + displayYear + displayMonth + '</span>';
            html += '<span class="ws-menu-sub">' + ws.name + '</span>';
            html += '</div>';
            html += '<span class="ws-menu-count">' + customers + '件</span>';
            if (!isActive) {
                html += '<button class="ws-menu-delete" onclick="event.stopPropagation(); confirmDeleteWorkspace(\'' + ws.id + '\', \'' + ws.name + '\')">🗑️</button>';
            }
            html += '</div>';
        });
    }
    list.innerHTML = html;
    overlay.style.display = 'flex';

    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
    var dropdown = document.getElementById('mapToolbarDropdown');
    var toggleBtn = document.getElementById('compactToggleBtn');
    if (dropdown && dropdown.classList.contains('expanded')) {
        dropdown.classList.remove('expanded');
        if (toggleBtn) toggleBtn.classList.remove('expanded');
    }
}

function hideWorkspaceMenu() {
    document.getElementById('wsMenuOverlay').style.display = 'none';
}

function selectWorkspace(wsId) {
    var currentId = DataStorage.getCurrentWorkspaceId();
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

function reloadAllUI() {
    MapCore.refreshAllMarkers();
    RouteManager.updateRoutePanel();
    if (typeof MapExpenseForm !== 'undefined' && MapExpenseForm.resetInitFlag) {
        MapExpenseForm.resetInitFlag();
    }
    var panel = document.getElementById('bottomPanel');
    var activeTab = panel ? panel.querySelector('.tab.active') : null;
    if (activeTab && activeTab.dataset.tab === 'expense') {
        MapExpenseForm.init();
    }
    if (activeTab && activeTab.dataset.tab === 'summary') {
        RouteManager.updateSummary();
    }
    updateCompactCount();
}

function showAddWorkspaceDialog() {
    hideWorkspaceMenu();
    var now = new Date();
    var nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    var defaultVal = nextMonth.getFullYear() + '-' + String(nextMonth.getMonth() + 1).padStart(2, '0');
    document.getElementById('addWsMonth').value = defaultVal;
    document.getElementById('addWsName').value = '';
    document.getElementById('addWsModal').style.display = 'flex';
}

function hideAddWorkspaceDialog() {
    document.getElementById('addWsModal').style.display = 'none';
}

function addWorkspace() {
    var monthInput = document.getElementById('addWsMonth').value;
    if (!monthInput) {
        alert('年月を選択してください。');
        return;
    }
    var name = document.getElementById('addWsName').value.trim();
    var ws = DataStorage.createWorkspace(monthInput, name || '');
    if (!ws) {
        alert('このワークスペースは既に存在します。');
        return;
    }
    hideAddWorkspaceDialog();
    if (confirm('📅 ' + ws.name + ' を作成しました！\nこのワークスペースに切り替えますか？')) {
        DataStorage.switchWorkspace(ws.id);
        reloadAllUI();
        updateWsButton();
    }
}

function confirmDeleteWorkspace(wsId, wsName) {
    if (!confirm('⚠️ 「' + wsName + '」を削除しますか？\nこのワークスペースの顧客・ルート・精算書データがすべて削除されます。\nこの操作は取り消せません。')) {
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

function toggleMenu() {
    var panel = document.getElementById('menuPanel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

document.addEventListener('click', function(e) {
    var panel = document.getElementById('menuPanel');
    if (panel && panel.style.display === 'block' && !e.target.closest('.menu-panel') && !e.target.closest('.btn-menu') && !e.target.closest('.toolbar-item')) {
        panel.style.display = 'none';
    }
});

function showAddModal() {
    document.getElementById('addModal').style.display = 'flex';
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
}
function hideAddModal() {
    document.getElementById('addModal').style.display = 'none';
    ['addCompany','addAddress','addPhone','addContact','addNote'].forEach(function(id) {
        document.getElementById(id).value = '';
    });
    document.getElementById('addPurpose').value = '';
}

function addNewLocation() {
    var company = document.getElementById('addCompany').value.trim();
    var address = document.getElementById('addAddress').value.trim();
    if (!company || !address) {
        alert('会社名と住所は必須です。');
        return;
    }
    var customer = DataStorage.addCustomer({
        company: company, address: address,
        phone: document.getElementById('addPhone').value.trim(),
        contact: document.getElementById('addContact').value.trim(),
        note: document.getElementById('addNote').value.trim(),
        purpose: document.getElementById('addPurpose').value,
        unitCount: 1
    });
    hideAddModal();
    MapCore.geocodeAndPlot([customer]);
    updateCompactCount();
}

// v1.8移動: hideEditModalは末尾のGCal連携セクションで定義（restoreEditButtons込み）

function saveEdit() {
    var id = MapCore.getCurrentEditId();
    if (!id) return;
    var appoDate = document.getElementById('editAppoDate').value || null;
    DataStorage.updateCustomer(id, {
        company: document.getElementById('editCompany').value.trim(),
        address: document.getElementById('editAddress').value.trim(),
        phone: document.getElementById('editPhone').value.trim(),
        contact: document.getElementById('editContact').value.trim(),
        note: document.getElementById('editNote').value.trim(),
        status: document.getElementById('editStatus').value,
        routeId: document.getElementById('editRoute').value || null,
        appoDate: appoDate,
        purpose: document.getElementById('editPurpose').value
    });
    // v1.8追加: アポ日時があればGCalボタン表示
    if (appoDate) {
        var company = document.getElementById('editCompany').value.trim();
        var address = document.getElementById('editAddress').value.trim();
        var contact = document.getElementById('editContact').value.trim();
        var purpose = document.getElementById('editPurpose').value;
        var note = document.getElementById('editNote').value.trim();
        showGcalConfirm(company, address, appoDate, contact, purpose, note);
    } else {
        hideEditModal();
    }
    MapCore.refreshAllMarkers();
    RouteManager.updateRoutePanel();
}

function deleteLocation() {
    var id = MapCore.getCurrentEditId();
    if (!id) return;
    if (!confirm('この場所を削除しますか？')) return;
    DataStorage.deleteCustomer(id);
    hideEditModal();
    MapCore.refreshAllMarkers();
    RouteManager.updateRoutePanel();
    updateCompactCount();
}

function showMapSettingsModal_old() {
    var settings = DataStorage.getSettings();
    document.getElementById('settingHomeAddress').value = settings.homeAddress || '';
    document.getElementById('settingApiKey').value = settings.apiKey || '';
    document.getElementById('mapSettingsModal').style.display = 'flex';
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
}
function hideMapSettingsModal_old() {
    document.getElementById('mapSettingsModal').style.display = 'none';
}
function saveMapSettings_old() {
    var apiKey = document.getElementById('settingApiKey').value.trim();
    var homeAddress = document.getElementById('settingHomeAddress').value.trim();
    DataStorage.saveSettings({ apiKey: apiKey, homeAddress: homeAddress });
    hideSettingsModal();
    if (apiKey) {
        alert('設定を保存しました。ページをリロードします。');
        location.reload();
    }
}

function showResetConfirm() {
    var customers = DataStorage.getCustomers();
    document.getElementById('resetCount').textContent = customers.length + '件';
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
    updateCompactCount();
    alert('🗑️ 現在のワークスペースの全データを削除しました。');
}

function exportBackup() {
    DataStorage.exportBackup();
    toggleMenu();
}
function importBackup() {
    document.getElementById('backupInput').click();
    toggleMenu();
}

function exportPDF() {
    if (document.getElementById('menuPanel').style.display === 'block') toggleMenu();
    RouteManager.exportPDF();
}

function togglePanel() {
    document.getElementById('bottomPanel').classList.toggle('collapsed');
}

// v1.7修正: デバッグログ強化＋nullガード
function mapSwitchTab(tabName) {
    console.log('[mapSwitchTab] 呼ばれた tabName=' + tabName);
    // v1.7 デバッグ強化: 各ステップの結果を確認
    var allTabs = document.querySelectorAll('#bottomPanel .tab');
    var allContents = document.querySelectorAll('#bottomPanel .tab-content');
    console.log('[mapSwitchTab] tabs=' + allTabs.length + ' contents=' + allContents.length);
    
    allTabs.forEach(function(t) { t.classList.remove('active'); });
    allContents.forEach(function(t) { t.classList.remove('active'); });
    
    var targetTab = document.querySelector('#bottomPanel .tab[data-tab="' + tabName + '"]');
    console.log('[mapSwitchTab] targetTab=', targetTab);
    if (targetTab) targetTab.classList.add('active');
    
    var tabId = 'tab' + tabName.charAt(0).toUpperCase() + tabName.slice(1);
    var targetContent = document.getElementById(tabId);
    console.log('[mapSwitchTab] tabId=' + tabId + ' targetContent=', targetContent);
    if (targetContent) {
        targetContent.classList.add('active');
        console.log('[mapSwitchTab] activeクラス追加完了');
    } else {
        console.error('[mapSwitchTab] ❌ targetContentが見つからない! tabId=' + tabId);
    }

    if (tabName === 'summary') {
        RouteManager.updateSummary();
    }
    if (tabName === 'expense') {
        MapExpenseForm.init();
        document.getElementById('bottomPanel').classList.remove('collapsed');
        document.getElementById('bottomPanel').style.maxHeight = '85vh';
    } else {
        document.getElementById('bottomPanel').style.maxHeight = '55vh';
    }
}

function toggleLegend() {
    var legend = document.getElementById('legend');
    legend.style.display = legend.style.display === 'none' ? 'block' : 'none';
}

// =============================================
// v1.8追加 - Phase H: Googleカレンダー連携（URLリンク方式）
// v1.9追加 - ツールバーからGCal直接起動
// =============================================

// v1.9 ツールバーからGoogleカレンダーを直接開く
function openGoogleCalendar() {
    window.open('https://calendar.google.com', '_blank', 'noopener');
}

// v1.8 GCal用の日時フォーマット（YYYYMMDDTHHmmSS）
function formatGcalDate(datetimeLocal) {
    // datetime-local形式 "2026-04-01T09:00" → "20260401T090000"
    return datetimeLocal.replace(/[-:]/g, '').replace('T', 'T') + '00';
}

// v1.8 Googleカレンダー追加URLを生成
function buildGcalUrl(company, address, appoDate, contact, purpose, note) {
    var startDate = formatGcalDate(appoDate);
    // デフォルト1時間の予定
    var dtObj = new Date(appoDate);
    dtObj.setHours(dtObj.getHours() + 1);
    var endStr = dtObj.getFullYear()
        + String(dtObj.getMonth() + 1).padStart(2, '0')
        + String(dtObj.getDate()).padStart(2, '0')
        + 'T' + String(dtObj.getHours()).padStart(2, '0')
        + String(dtObj.getMinutes()).padStart(2, '0') + '00';

    var title = company;
    if (purpose) title += '（' + purpose + '）';

    var details = '';
    if (contact) details += '担当者: ' + contact + '\n';
    if (purpose) details += '目的: ' + purpose + '\n';
    if (note) details += '備考: ' + note;
    details = details.trim();

    var params = [
        'action=TEMPLATE',
        'text=' + encodeURIComponent(title),
        'dates=' + startDate + '/' + endStr,
        'location=' + encodeURIComponent(address)
    ];
    if (details) params.push('details=' + encodeURIComponent(details));

    return 'https://calendar.google.com/calendar/render?' + params.join('&');
}

// v1.8 保存後にGCal追加を提案するUI
function showGcalConfirm(company, address, appoDate, contact, purpose, note) {
    var url = buildGcalUrl(company, address, appoDate, contact, purpose, note);
    // editModalのボタンエリアをGCal確認UIに差し替え
    var modal = document.getElementById('editModal');
    var btnArea = modal.querySelector('.modal-buttons');
    if (!btnArea) { hideEditModal(); return; }

    // 元のボタンHTML退避
    if (!btnArea.dataset.originalHtml) {
        btnArea.dataset.originalHtml = btnArea.innerHTML;
    }

    var dtObj = new Date(appoDate);
    var dateStr = (dtObj.getMonth() + 1) + '/' + dtObj.getDate()
        + ' ' + String(dtObj.getHours()).padStart(2, '0')
        + ':' + String(dtObj.getMinutes()).padStart(2, '0');

    btnArea.innerHTML =
        '<div style="text-align:center;width:100%;">'
        + '<p style="margin:0 0 8px;font-size:14px;">✅ 保存しました</p>'
        + '<p style="margin:0 0 12px;font-size:13px;color:#888;">'
        + company + ' ' + dateStr + '</p>'
        + '<a href="' + url + '" target="_blank" rel="noopener" '
        + 'class="gcal-add-btn" '
        + 'onclick="setTimeout(function(){restoreEditButtons();hideEditModal();},300)">'
        + '📅 Googleカレンダーに追加</a>'
        + '<button class="modal-cancel" style="margin-top:8px;width:100%;" '
        + 'onclick="restoreEditButtons();hideEditModal()">閉じる</button>'
        + '</div>';
}

// v1.8 editModalのボタンを元に戻す
function restoreEditButtons() {
    var modal = document.getElementById('editModal');
    var btnArea = modal.querySelector('.modal-buttons');
    if (btnArea && btnArea.dataset.originalHtml) {
        btnArea.innerHTML = btnArea.dataset.originalHtml;
        delete btnArea.dataset.originalHtml;
    }
}

// v1.8 editModal閉じる時にボタンも復元
function hideEditModal() {
    restoreEditButtons();
    document.getElementById('editModal').style.display = 'none';
}
