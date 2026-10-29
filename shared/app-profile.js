// 本番(/CULOchanGyomuPro/)とお試し版(/CULOchanGyomuPro-staging/)は同じオリジン
// (akiyamanx.github.io)なので、localStorage・IndexedDB・Cache Storage・Drive共有先を共有してしまう。
// お試し版のときだけ、保存先の名前に接頭辞を付けて本番のデータと混ざらないようにする。本番は今までどおり。
const AppProfile = (() => {
    const STAGING_PATH = /^\/CULOchanGyomuPro-staging(\/|$)/;
    let pathname = '';
    try { pathname = String((typeof location !== 'undefined' && location.pathname) || ''); } catch (e) { pathname = ''; }
    const staging = STAGING_PATH.test(pathname);
    const profile = Object.freeze({
        staging,
        storagePrefix: staging ? 'stg:' : '',
        channel: staging ? 'gyomupro-staging' : 'gyomupro-main',
        dbName: name => (staging ? 'stg-' : '') + name,
        // 本番の値を「読むだけ」借りてよい設定(秘密ではない接続用ID)。書き込みは常にお試し版側。
        readThroughKeys: Object.freeze(staging ? ['culo_google_calendar_client_id'] : [])
    });
    if (staging && typeof document !== 'undefined' && document && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', () => {
            try {
                document.title = '【お試し版】' + document.title;
                const bar = document.createElement('div');
                bar.id = 'stagingBanner';
                bar.setAttribute('role', 'status');
                bar.textContent = 'お試し版です(本番とは別のデータ)';
                bar.style.cssText = 'position:sticky;top:0;z-index:2147483000;background:#b45309;color:#fff;font:bold 14px/1.4 sans-serif;text-align:center;padding:6px 8px;';
                document.body.insertBefore(bar, document.body.firstChild);
            } catch (e) { /* 表示できなくても保存先の分離は有効 */ }
        });
    }
    return profile;
})();
if (typeof module !== 'undefined' && module.exports) module.exports = AppProfile;
