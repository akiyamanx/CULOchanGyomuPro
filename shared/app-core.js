// ==========================================
// CULOchan業務Pro — アプリコア v1.0
// このファイルはタブ切替、共通初期化、ローディング制御を担当する
// ==========================================

const AppCore = (() => {
    // v1.0 - 現在のアクティブタブ
    let activeTab = 'receipt';

    // v1.0 - アプリ初期化
    function init() {
        console.log('[AppCore] CULOchan業務Pro 起動');
        // Service Worker登録
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(() => console.log('[AppCore] SW登録完了'))
                .catch(err => console.warn('[AppCore] SW登録失敗:', err));
        }
        // 初期タブ表示
        switchTab('receipt');
    }

    // v1.0 - タブ切替
    function switchTab(tabName) {
        activeTab = tabName;

        // タブボタンのactive切替
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // タブパネルのactive切替
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === 'tab-' + tabName);
        });

        console.log('[AppCore] タブ切替:', tabName);
    }

    // v1.0 - ローディング表示
    function showLoading(message) {
        var el = document.getElementById('loading');
        var textEl = document.getElementById('loadingText');
        if (el) el.style.display = 'flex';
        if (textEl) textEl.textContent = message || '処理中...';
    }

    // v1.0 - ローディング非表示
    function hideLoading() {
        var el = document.getElementById('loading');
        if (el) el.style.display = 'none';
    }

    // v1.0 - 現在のタブ取得
    function getActiveTab() {
        return activeTab;
    }

    // DOM読み込み完了時に初期化
    document.addEventListener('DOMContentLoaded', init);

    return { switchTab, showLoading, hideLoading, getActiveTab };
})();
