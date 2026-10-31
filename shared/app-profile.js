// 本番リリース版(release-20261031): 本番専用の固定設定。お試し版の接頭辞・バナー・本番設定の借用は含めない。
// 保存先は旧本番と同じ名前(接頭辞なし)、Drive共有先は旧本番と同じ 'gyomupro-main'。
const AppProfile = Object.freeze({
    staging: false,
    storagePrefix: '',
    channel: 'gyomupro-main',
    dbName: name => name,
    readThroughKeys: Object.freeze([])
});
if (typeof module !== 'undefined' && module.exports) module.exports = AppProfile;
