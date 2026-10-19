// ==========================================
// CULOchan業務Pro — アプリコア v1.4
// このファイルはタブ切替、共通初期化、ローディング制御、設定管理を担当する
// v1.1追加: 設定モーダル（Gemini APIキー入力）
// v1.2改修: 設定モーダルにGoogle Maps APIキー+自宅住所を統合（2箇所バラバラ問題解消）
// v1.3追加: GCal埋め込みURL設定（スワイプパネル用）→ v1.4で削除（未使用）
// v1.4整理: GCal埋め込みURL設定を削除（アプリ直接起動方式に変更のため不要）
//
// 依存: なし
// ==========================================

const AppCore = (() => {
    // v1.0 - 現在のアクティブタブ
    let activeTab = 'map';

    // v1.0 - アプリ初期化
    function init() {
        console.log('[AppCore] CULOchan業務Pro 起動');
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(() => console.log('[AppCore] SW登録完了'))
                .catch(err => console.warn('[AppCore] SW登録失敗:', err));
        }
        switchTab('map');
    }

    // v1.0 - タブ切替
    function switchTab(tabName) {
        if (!['map', 'receipt', 'expense'].includes(tabName)) return;
        activeTab = tabName;
        document.querySelectorAll('.tab-nav .tab-btn').forEach(btn => {
            const selected = btn.dataset.tab === tabName;
            btn.classList.toggle('active', selected);
            if (selected) btn.setAttribute('aria-current', 'page');
            else btn.removeAttribute('aria-current');
        });
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === 'tab-' + tabName);
        });
        document.dispatchEvent(new CustomEvent('app:tabchange', { detail: tabName }));
        console.log('[AppCore] タブ切替:', tabName);
    }

    // v1.0 - ローディング表示/非表示
    function showLoading(message) {
        var el = document.getElementById('loading');
        var textEl = document.getElementById('loadingText');
        if (el) el.style.display = 'flex';
        if (textEl) textEl.textContent = message || '処理中...';
    }
    function hideLoading() {
        var el = document.getElementById('loading');
        if (el) el.style.display = 'none';
    }

    // v1.0 - 現在のタブ取得
    function getActiveTab() {
        return activeTab;
    }

    // Categories and draft-preserving navigation live in SettingsPanel.
    function openSettings(category) { return SettingsPanel.open(category); }
    function closeSettings(event) { return SettingsPanel.close(event); }
    function saveSettings(category) { return SettingsPanel.save(category); }

    document.addEventListener('DOMContentLoaded', init);

    return {
        switchTab: switchTab,
        showLoading: showLoading,
        hideLoading: hideLoading,
        getActiveTab: getActiveTab,
        openSettings: openSettings,
        closeSettings: closeSettings,
        saveSettings: saveSettings
    };
})();

