// ==========================================
// CULOchan業務Pro — Service Worker v1.0
// このファイルはPWAのキャッシュ管理を担当する
// CACHE_NAMEはデプロイごとにインクリメントすること！
// ==========================================

const CACHE_NAME = 'gyomupro-v1';
const ASSETS = [
    './',
    './index.html',
    './styles/common.css',
    './styles/receipt.css',
    './styles/expense.css',
    './shared/app-core.js',
    './receipt/receipt-scanner.js',
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
