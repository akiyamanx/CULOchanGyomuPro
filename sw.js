// ==========================================
// CULOchan業務Pro — Service Worker v3.5
// CACHE_NAMEはデプロイごとにインクリメントすること！
// v3.4 2026-04-02 - Phase E Step1: 行先2フィールド化
// v3.5 2026-04-02 - Phase E Step2-4: ETCパーサー統合、MapExpenseForm軽量化、不要ファイル削除
// ==========================================

const CACHE_NAME = 'gyomupro-v26';
const ASSETS = [
    './',
    './index.html',
    './styles/common.css',
    './styles/receipt.css',
    './styles/expense.css',
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
