// ==========================================
// CULOchan業務Pro — Service Worker v1.2
// このファイルはPWAのキャッシュ管理を担当する
// CACHE_NAMEはデプロイごとにインクリメントすること！
// v1.1 2026-03-31 - キャッシュv2 + receipt-image-utils.js追加
// v1.2 2026-03-31 - キャッシュv3 + 精算書JS追加（Phase B-1）
// ==========================================

const CACHE_NAME = 'gyomupro-v3';
const ASSETS = [
    './',
    './index.html',
    './styles/common.css',
    './styles/receipt.css',
    './styles/expense.css',
    './shared/app-core.js',
    './receipt/receipt-scanner.js',
    './receipt/receipt-image-utils.js',
    './expense/expense-manager.js',
    './expense/expense-pdf.js',
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
    
    event.respondWith(
        fetch(event.request)
            .then(response => {
                // 正常なレスポンスをキャッシュに保存
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
