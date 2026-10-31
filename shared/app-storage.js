// アプリ本体の保存領域(localStorage)への唯一の入口。
// 本番のキー名(mm_*, gyomupro_*, reform_app_settings, travelExpenseDrafts など)をそのまま使う。
// お試し版(preview/ 配下)が使っていた接頭辞つきキーには触れない。
const AppStorage = (() => {
    const ls = () => window.localStorage;
    return Object.freeze({
        keys() { return Object.keys(ls()); },
        getItem(key) { return ls().getItem(key); },
        setItem(key, value) { ls().setItem(key, value); },
        removeItem(key) { ls().removeItem(key); },
        readProduction() { return null; }
    });
})();
