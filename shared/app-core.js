// ==========================================
// CULOchan業務Pro — アプリコア v1.3
// このファイルはタブ切替、共通初期化、ローディング制御、設定管理を担当する
// v1.1追加: 設定モーダル（Gemini APIキー入力）
// v1.2改修: 設定モーダルにGoogle Maps APIキー+自宅住所を統合（2箇所バラバラ問題解消）
// v1.3追加: GCal埋め込みURL設定（スワイプパネル用）
//
// 依存: なし
// ==========================================

const AppCore = (() => {
    // v1.0 - 現在のアクティブタブ
    let activeTab = 'receipt';

    // v1.0 - アプリ初期化
    function init() {
        console.log('[AppCore] CULOchan業務Pro 起動');
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('sw.js')
                .then(() => console.log('[AppCore] SW登録完了'))
                .catch(err => console.warn('[AppCore] SW登録失敗:', err));
        }
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

    // ==========================================
    // v1.2改修: 統合設定モーダル
    // Gemini APIキー + Google Maps APIキー + 自宅住所 を1箇所で管理
    // ==========================================

    // v1.2 - 設定モーダルを開く
    function openSettings() {
        var modal = document.getElementById('settingsModal');
        if (modal) modal.style.display = 'flex';

        // Gemini APIキー読み込み
        var geminiInput = document.getElementById('settingGeminiKey');
        if (geminiInput) {
            var saved = localStorage.getItem('gyomupro_gemini_key') || '';
            if (!saved) {
                var s = JSON.parse(localStorage.getItem('reform_app_settings') || '{}');
                saved = s.geminiApiKey || '';
            }
            geminiInput.value = saved;
        }

        // v1.2追加 - Google Maps APIキー読み込み
        var mapsInput = document.getElementById('settingMapsKey');
        if (mapsInput) {
            var mapSettings = _getMapSettings();
            mapsInput.value = mapSettings.apiKey || '';
        }

        // v1.2追加 - 自宅住所読み込み
        var homeInput = document.getElementById('settingHomeAddr');
        if (homeInput) {
            var mapSettings2 = _getMapSettings();
            homeInput.value = mapSettings2.homeAddress || '';
        }

        // v1.3追加 - GCal埋め込みURL読み込み
        var gcalInput = document.getElementById('settingGcalUrl');
        if (gcalInput) {
            gcalInput.value = localStorage.getItem('gyomupro_gcal_embed_url') || '';
        }
    }

    // v1.2 - 設定モーダルを閉じる
    function closeSettings(event) {
        if (event && event.target !== event.currentTarget) return;
        var modal = document.getElementById('settingsModal');
        if (modal) modal.style.display = 'none';
    }

    // v1.2改修 - 設定を保存（Gemini + Maps + 自宅住所）
    function saveSettings() {
        var needReload = false;

        // ① Gemini APIキー
        var geminiInput = document.getElementById('settingGeminiKey');
        if (geminiInput) {
            var geminiKey = geminiInput.value.trim();
            if (geminiKey) {
                localStorage.setItem('gyomupro_gemini_key', geminiKey);
                var s = JSON.parse(localStorage.getItem('reform_app_settings') || '{}');
                s.geminiApiKey = geminiKey;
                localStorage.setItem('reform_app_settings', JSON.stringify(s));
            }
        }

        // ② Google Maps APIキー + 自宅住所
        var mapsInput = document.getElementById('settingMapsKey');
        var homeInput = document.getElementById('settingHomeAddr');
        if (mapsInput || homeInput) {
            var mapSettings = _getMapSettings();
            var oldApiKey = mapSettings.apiKey || '';

            if (mapsInput) mapSettings.apiKey = mapsInput.value.trim();
            if (homeInput) mapSettings.homeAddress = homeInput.value.trim();
            _saveMapSettings(mapSettings);

            // Maps APIキーが変わった場合はリロード必要
            if (mapsInput && mapsInput.value.trim() !== oldApiKey) {
                needReload = true;
            }
        }

        // ③ GCal埋め込みURL
        var gcalInput = document.getElementById('settingGcalUrl');
        if (gcalInput) {
            var gcalUrl = gcalInput.value.trim();
            localStorage.setItem('gyomupro_gcal_embed_url', gcalUrl);
            // カレンダーパネルのiframeを再読み込み
            if (typeof GcalPanel !== 'undefined' && GcalPanel.reloadCalendar) {
                GcalPanel.reloadCalendar();
            }
        }

        closeSettings();

        if (needReload) {
            alert('✅ 設定を保存しました！\nMaps APIキーが変更されたためリロードします。');
            location.reload();
        } else {
            alert('✅ 設定を保存しました！');
        }
    }

    // v1.2追加 - マップ設定の読み書き（DataStorageと互換）
    function _getMapSettings() {
        try {
            var data = localStorage.getItem('mm_settings');
            return data ? JSON.parse(data) : {};
        } catch (e) { return {}; }
    }
    function _saveMapSettings(settings) {
        localStorage.setItem('mm_settings', JSON.stringify(settings));
    }

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
