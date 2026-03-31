// ==========================================
// CULOchan業務Pro — アプリコア v1.1
// このファイルはタブ切替、共通初期化、ローディング制御、設定管理を担当する
// v1.1追加: 設定モーダル（Gemini APIキー入力）
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
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
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

    // ==========================================
    // v1.1追加: 設定モーダル
    // ==========================================

    // v1.1 - 設定モーダルを開く
    function openSettings() {
        var modal = document.getElementById('settingsModal');
        if (modal) modal.style.display = 'flex';
        // 保存済みのAPIキーがあれば表示
        var keyInput = document.getElementById('settingGeminiKey');
        if (keyInput) {
            var saved = localStorage.getItem('gyomupro_gemini_key') || '';
            // CULOchanKAIKEIproの設定からもチェック
            if (!saved) {
                var s = JSON.parse(localStorage.getItem('reform_app_settings') || '{}');
                saved = s.geminiApiKey || '';
            }
            keyInput.value = saved;
        }
    }

    // v1.1 - 設定モーダルを閉じる（背景クリックでも閉じる）
    function closeSettings(event) {
        if (event && event.target !== event.currentTarget) return;
        var modal = document.getElementById('settingsModal');
        if (modal) modal.style.display = 'none';
    }

    // v1.1 - 設定を保存
    function saveSettings() {
        var keyInput = document.getElementById('settingGeminiKey');
        if (keyInput && keyInput.value.trim()) {
            var key = keyInput.value.trim();
            // 業務Pro用に保存
            localStorage.setItem('gyomupro_gemini_key', key);
            // CULOchanKAIKEIpro互換でも保存
            var s = JSON.parse(localStorage.getItem('reform_app_settings') || '{}');
            s.geminiApiKey = key;
            localStorage.setItem('reform_app_settings', JSON.stringify(s));
            alert('✅ APIキーを保存しました！');
            closeSettings();
        } else {
            alert('APIキーを入力してください');
        }
    }

    // DOM読み込み完了時に初期化
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
