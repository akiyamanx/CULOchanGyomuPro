// Settings are separate from the visit form. Opening them never restarts the visit editor.
const SettingsPanel = (() => {
    const $ = id => document.getElementById(id);
    let suspended = [], opener = null;
    const fields = ['settingMapsKey', 'settingHomeAddr', 'settingGeminiKey', 'googleCalendarClientId'];
    function readObject(key) {
        try { return JSON.parse(AppStorage.getItem(key) || '{}') || {}; }
        catch (_) { return {}; }
    }
    function savedValues() {
        const maps = readObject('mm_settings');
        return {
            settingMapsKey: maps.apiKey || '', settingHomeAddr: maps.homeAddress || '',
            settingGeminiKey: AppStorage.getItem('gyomupro_gemini_key') || readObject('reform_app_settings').geminiApiKey || '',
            googleCalendarClientId: AppStorage.getItem('culo_google_calendar_client_id') || ''
        };
    }
    function message(group, text) { $('settings' + group + 'Status').textContent = text; }
    function open(category) {
        const modal = $('settingsModal');
        if (modal.style.display !== 'none') return;
        $('settingsStatus').textContent = '';
        opener = document.activeElement;
        suspended = Array.from(document.querySelectorAll('.modal-overlay:not(.loading-overlay)'))
            .filter(el => el !== modal && getComputedStyle(el).display !== 'none')
            .map(el => {
                const scroller = el.querySelector('.modal, .modal-content');
                const item = { el, display: el.style.display, scroller, scrollTop: scroller?.scrollTop || 0 };
                el.style.display = 'none';
                return item;
            });
        try {
            const values = savedValues();
            fields.forEach(id => { $(id).value = values[id]; });
        } catch (_) { $('settingsStatus').textContent = '保存済み設定を読み込めませんでした。ブラウザの保存設定を確認してください。'; }
        modal.querySelectorAll('[data-settings-category]').forEach(el => { el.open = el.dataset.settingsCategory === category; });
        modal.querySelectorAll('[data-requires-idle]').forEach(el => { el.disabled = suspended.length > 0; });
        $('settingsDataHint').textContent = suspended.length
            ? '復元・削除・再読み込みは、入力中の画面を保存して閉じてから行ってください。'
            : '訪問先・ルートなど、対象月ごとのデータを管理します。';
        $('settingsReturn').textContent = suspended.length ? '入力中の画面に戻る' : '設定を閉じる';
        modal.style.display = 'flex';
        if (typeof TransferUI !== 'undefined') TransferUI.opened();
        modal.querySelector('.modal-content').scrollTop = 0;
        requestAnimationFrame(() => {
            const summary = modal.querySelector('details[open] > summary');
            (summary || modal.querySelector('.btn-clear')).focus({ preventScroll: true });
        });
    }
    function close(event, restoreFocus = true) {
        if (typeof TransferUI !== 'undefined' && TransferUI.isBusy()) return false;
        if (event && event.target !== event.currentTarget) return false;
        try {
            const values = savedValues();
            if (fields.some(id => $(id).value.trim() !== values[id]) &&
                !confirm('保存していない設定があります。変更を破棄して戻りますか？')) return false;
        } catch (_) {
            if (!confirm('保存状態を確認できません。設定を保存せずに戻りますか？')) return false;
        }
        $('settingsModal').style.display = 'none';
        const previous = suspended, target = opener;
        suspended = []; opener = null;
        previous.forEach(item => { item.el.style.display = item.display; });
        if (restoreFocus) requestAnimationFrame(() => {
            previous.forEach(item => { if (item.scroller) item.scroller.scrollTop = item.scrollTop; });
            const focus = target?.isConnected && target.getClientRects().length ? target : document.querySelector('.settings-btn');
            focus?.focus({ preventScroll: true });
        });
        return true;
    }
    function save(group) {
        try {
            if (group === 'Maps') {
                const maps = readObject('mm_settings'), key = $('settingMapsKey').value.trim();
                const changed = key !== (maps.apiKey || '');
                maps.apiKey = key; maps.homeAddress = $('settingHomeAddr').value.trim();
                AppStorage.setItem('mm_settings', JSON.stringify(maps));
                if (changed) $('settingsReload').hidden = false;
                message(group, changed ? '保存しました。地図のAPIキーは再読み込み後に反映されます。入力中の内容を保存してから再読み込みしてください。' : '地図・会社住所の設定を保存しました。');
            } else if (group === 'AI') {
                const key = $('settingGeminiKey').value.trim(), settings = readObject('reform_app_settings');
                settings.geminiApiKey = key;
                AppStorage.setItem('reform_app_settings', JSON.stringify(settings));
                AppStorage.setItem('gyomupro_gemini_key', key);
                message(group, 'レシートのAI読取設定を保存しました。');
            }
        } catch (_) { message(group, '保存できませんでした。入力は残しています。ブラウザの保存容量・設定を確認してください。'); }
    }
    function dataAction(action) {
        if (suspended.length) return;
        if (action === 'restore') {
            if (!confirm('バックアップの内容で訪問先・ルートなどのデータを復元します。現在のデータを先にバックアップしましたか？') || !close(null, false)) return;
            $('backupInput').value = '';
            $('backupInput').click();
        } else if (action === 'reset') {
            if (close(null, false)) showResetConfirm();
        } else if (action === 'reload') {
            if (confirm('アプリを再読み込みします。未保存の入力は失われます。続けますか？') && close(null, false)) location.reload();
        }
    }
    return { open, close, save, dataAction, canTransfer:()=>suspended.length===0 };
})();
