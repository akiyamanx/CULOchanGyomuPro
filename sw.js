// ==========================================
// CULOchan業務Pro — Service Worker v5.1
// CACHE_NAMEはデプロイごとにインクリメントすること！
// v4.3 2026-04-02 - 駐車場PDF日本語対応+レシート90度回転
// v4.4 2026-04-02 - 保存済みレシート削除機能+重複防止
// v4.5 2026-04-02 - レシート回転調整UI（🔄ボタン・任意角度回転対応）
// v4.6 2026-04-02 - チェックボックス式削除UI（誤削除防止）
// v4.7 2026-04-03 - Phase G: 駐車場×顧客自動マッチング
// v4.8 2026-04-04 - Phase H: Googleカレンダー連携
// v4.9 2026-04-04 - Phase H: GCal直接起動ボタン追加
// v5.0 2026-04-04 - Phase H: GCalスワイプパネル追加
// v5.1 2026-04-04 - Phase H: GCal iframe→アプリ直接起動方式に変更
// ==========================================

const CACHE_NAME = 'gyomupro-v42';
const ASSETS = [
    './',
    './index.html',
    './styles/common.css',
    './styles/receipt.css',
    './styles/expense.css',
    './styles/parking.css',
    './styles/map/map-styles.css',
    './styles/map/map-expense-styles.css',
    './styles/map/route-order-styles.css',
    './styles/map/workspace-styles.css',
    './shared/app-core.js',
    './receipt/receipt-scanner.js',
    './receipt/receipt-image-utils.js',
    './expense/expense-manager.js',
    './expense/expense-pdf.js',
    './expense/expense-etc.js',
    './expense/parking-manager.js',
    './expense/parking-matcher.js',
    './expense/parking-pdf.js',
    './map/map-data-storage.js',
    './map/v1-converter.js',
    './map/csv-handler.js',
    './map/map-core.js',
    './map/route-manager.js',
    './map/map-expense-form.js',
    './map/route-order.js',
    './map/segment-dialog.js',
    './map/distance-calc.js',
    './map/ui-actions.js',
    './map/gcal-panel.js',
    './manifest.json'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
            .then(() => self.skipWaiting())
    );
});

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

self.addEventListener('fetch', event => {
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
