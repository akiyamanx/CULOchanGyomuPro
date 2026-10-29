// アプリ本体の保存領域(localStorage)への唯一の入口。
// 本番のキー名(mm_*, gyomupro_*, reform_app_settings, travelExpenseDrafts など)をそのまま使う。
// お試し版(/CULOchanGyomuPro-staging/)では AppProfile の接頭辞(stg:)を付け、本番のキーには書かない。
// お試し版(preview/ 配下)が使っていた接頭辞つきキーには触れない。
const AppStorage = (() => {
    const profile = typeof AppProfile !== 'undefined' ? AppProfile : { storagePrefix: '', readThroughKeys: [] };
    const P = profile.storagePrefix;
    const ls = () => window.localStorage;
    if (!P) return Object.freeze({
        keys() { return Object.keys(ls()); },
        getItem(key) { return ls().getItem(key); },
        setItem(key, value) { ls().setItem(key, value); },
        removeItem(key) { ls().removeItem(key); },
        readProduction() { return null; }
    });
    return Object.freeze({
        keys() { return Object.keys(ls()).filter(k => k.startsWith(P)).map(k => k.slice(P.length)); },
        getItem(key) {
            const own = ls().getItem(P + key);
            if (own !== null) return own;
            return profile.readThroughKeys.includes(key) ? ls().getItem(key) : null;
        },
        setItem(key, value) { ls().setItem(P + key, value); },
        removeItem(key) { ls().removeItem(P + key); },
        // 本番の値を読むだけ(お試し版で地図キーを借りるため。中身の取り出しは呼び出し側で apiKey だけに絞る)。書く口は無い。
        readProduction(key) { return key === 'mm_settings' ? ls().getItem(key) : null; }
    });
})();
