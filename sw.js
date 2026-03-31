// ==========================================
// CULOchan業務Pro — Service Worker v1.8
// このファイルはPWAのキャッシュ管理を担当する
// CACHE_NAMEはデプロイごとにインクリメントすること！
// v1.1 2026-03-31 - キャッシュv2 + receipt-image-utils.js追加
// v1.2 2026-03-31 - キャッシュv3 + 精算書JS追加（Phase B-1）
// v1.3 2026-03-31 - キャッシュv4 + マップモジュール16ファイル追加（Step 1）
// v1.4 2026-03-31 - キャッシュv5 + Step2日付連携＋Step3 ETC CSV取り込み
// v1.5 2026-03-31 - キャッシュv6 + segment-dialog.jsダークテーマ修正
// v1.6 2026-03-31 - キャッシュv7 + Phase D workspace/route-orderダーク化
// v1.7 2026-03-31 - キャッシュv8 + .btnスコープ化（精算書ボタン表示修正）
// v1.8 2026-03-31 - キャッシュv9 + ETC IC名表示修正＋マップ精算書入力欄背景修正
// ==========================================

const CACHE_NAME = 'gyomupro-v9';
const ASSETS = [
    './',
    './index.html',
    './styles/common.css',
    './styles/receipt.css',
    './styles/expense.css',
    // v1.3追加: マップCSS
    './styles/map/map-styles.css',
    './styles/map/map-expense-styles.css',
    './styles/map/route-order-styles.css',
    './styles/map/workspace-styles.css',
    './shared/app-core.js',
    './receipt/receipt-scanner.js',
    './receipt/receipt-image-utils.js',
    './expense/expense-manager.js',
    './expense/expense-pdf.js',
    // v1.4追加: 精算書ETC取り込み
    './expense/expense-etc.js',
    // v1.3追加: マップJS（12ファイル）
    './map/map-data-storage.js',
    './map/v1-converter.js',
    './map/csv-handler.js',
    './map/map-core.js',
    './map/route-manager.js',
    './map/map-expense-form.js',
    './map/map-expense-pdf.js',
    './map/route-order.js',
    './map/segment-dialog.js',
    './map/distance-calc.js',
    './map/etc-reader.js',
    './map/ui-actions.js',
    './manifest.json'
];

// インストール時にキャッシュ
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

// 古いキャッシュ削除
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

// ネットワーク優先、失敗したらキャッシュ
self.addEventListener('fetch', event => {
    // APIリクエストはキャッシュしない
    if (event.request.url.includes('generativelanguage.googleapis.com')) return;
    if (event.request.url.includes('maps.googleapis.com')) return;
    
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
