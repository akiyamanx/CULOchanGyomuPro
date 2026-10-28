// アプリ本体の保存領域(localStorage)への唯一の入口。
// 本番のキー名(mm_*, gyomupro_*, reform_app_settings, travelExpenseDrafts など)をそのまま使う。
// お試し版(preview/ 配下)が使っていた接頭辞つきキーには触れない。
const AppStorage = Object.freeze({
    keys() { return Object.keys(window.localStorage); },
    getItem(key) { return window.localStorage.getItem(key); },
    setItem(key, value) { window.localStorage.setItem(key, value); },
    removeItem(key) { window.localStorage.removeItem(key); }
});
