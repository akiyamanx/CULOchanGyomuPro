// ==========================================
// CULOchan業務Pro — Service Worker v6.0
// CACHE_NAMEはデプロイごとにインクリメントすること！
// v4.3〜v5.2 (2026-04) 旧本番の履歴は git log を参照
// v6.0 2026-10-28 - お試し版(写真入りバックアップ・Drive共有・ETC・依頼書取込)を本番へ統合
//   - 認証付きGoogle通信(accounts.google.com / *.googleapis.com など)と非GETは一切キャッシュしない
//   - キャッシュ対象は自サイトの静的ファイルと、既知のCDN(cdnjs・Googleフォント)のみ
//   - お試し版の置き場所(/preview/)は触らない
//   - ASSETSは実在するファイルだけ(tests/sw-assets.test.cjs が検査する)
// ==========================================

// 本番とお試し版(/CULOchanGyomuPro-staging/)は同じオリジンでCache Storageを共有するため、名前で分ける
const IS_STAGING = /^\/CULOchanGyomuPro-staging\//.test((self.location && self.location.pathname) || '');
const CACHE_PREFIX = IS_STAGING ? 'gyomupro-stg-' : 'gyomupro-';
const CACHE_NAME = CACHE_PREFIX + 'v56';
// 自分(本番/お試し版)のキャッシュだけを古い版の掃除対象にする。相手側のキャッシュは消さない
function ownCache(name) {
    if (IS_STAGING) return name.startsWith('gyomupro-stg-');
    return name.startsWith('gyomupro-') && !name.startsWith('gyomupro-stg-');
}
const ASSETS = [
    './',
    './index.html',
    './manifest.json',
    './shared/app-profile.js',
    './shared/app-storage.js',
    './icons/icon-192.png',
    './styles/common.css',
    './styles/receipt.css',
    './styles/expense.css',
    './styles/parking.css',
    './styles/parking-workflow.css',
    './styles/map/map-styles.css',
    './styles/map/map-expense-styles.css',
    './styles/map/route-order-styles.css',
    './styles/map/workspace-styles.css',
    './styles/workflow.css',
    './styles/map-workspace.css',
    './styles/settings.css',
    './styles/request-import.css',
    './styles/mail-box.css',
    './styles/etc-workflow.css',
    './shared/settings-panel.js',
    './shared/app-core.js',
    './receipt/receipt-image-utils.js',
    './receipt/receipt-scanner.js',
    './receipt/receipt-photo-geometry.js',
    './receipt/receipt-photo.js',
    './expense/expense-import.js',
    './shared/pdf-renderer.js',
    './expense/expense-draft-store.js',
    './expense/expense-draft-receipts.js',
    './expense/expense-manager.js',
    './expense/expense-pdf.js',
    './expense/expense-etc.js',
    './expense/parking-idb.js',
    './expense/parking-document.js',
    './expense/parking-manager.js',
    './expense/parking-pdf.js',
    './map/map-data-storage.js',
    './map/v1-converter.js',
    './map/request-parser.js',
    './map/request-reader.js',
    './map/request-month.js',
    './map/request-classifier.js',
    './map/mf-dedupe.js',
    './map/mail-box.js',
    './map/mail-ledger-sync.js',
    './map/mail-ledger-drive.js',
    './map/data-sync.js',
    './map/data-sync-ui.js',
    './map/gmail-transport.js',
    './map/gmail-source.js',
    './map/gmail-import.js',
    './map/mail-box-demo.js',
    './map/mail-gmail-links.js',
    './map/mail-box-ui.js',
    './map/request-import.js',
    './map/geocode-guard.js',
    './map/map-core.js',
    './map/google-calendar-data.js',
    './map/google-visit-calendar.js',
    './map/visit-planner.js',
    './map/map-workspace.js',
    './map/route-list-pdf.js',
    './map/route-manager.js',
    './map/map-expense-form.js',
    './map/route-order.js',
    './map/segment-dialog.js',
    './map/distance-calc.js',
    './map/ui-actions.js',
    './map/gcal-panel.js',
    './expense/parking-matcher.js',
    './expense/etc-document.js',
    './expense/etc-journey.js',
    './expense/etc-store.js',
    './expense/etc-reader.js',
    './expense/etc-view.js',
    './expense/etc-workflow.js',
    './shared/workflow-ui.js',
    './shared/backup-format.js',
    './shared/backup-store.js',
    './shared/drive-graph.js',
    './shared/drive-transfer.js',
    './shared/transfer-ui.js'
];

// ネットワークを通さずSWを素通りさせるホスト(認証情報や個人データが乗る通信)
const BYPASS_HOSTS = [
    'accounts.google.com',
    'apis.google.com',
    'oauth2.googleapis.com',
    'www.googleapis.com',
    'content.googleapis.com',
    'generativelanguage.googleapis.com',
    'maps.googleapis.com',
    'calendar.google.com'
];
// キャッシュしてよい外部ホスト(認証なしの静的配信のみ)
const CACHEABLE_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

function shouldHandle(request) {
    if (request.method !== 'GET') return false;
    if (request.headers && request.headers.has && (request.headers.has('Authorization') || request.headers.has('Range'))) return false;
    let url;
    try { url = new URL(request.url); } catch (e) { return false; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (BYPASS_HOSTS.includes(url.hostname)) return false;
    if (url.hostname.endsWith('.googleapis.com') && url.hostname !== 'fonts.googleapis.com') return false;
    if (url.origin === self.location.origin) return !url.pathname.includes('/preview/');
    return CACHEABLE_HOSTS.includes(url.hostname);
}

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            // 1件の取得失敗でインストール全体が止まらないように個別に追加する
            .then(cache => Promise.allSettled(ASSETS.map(path => cache.add(new Request(path, { cache: 'reload' })))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(k => ownCache(k) && k !== CACHE_NAME)
                    .map(k => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (!shouldHandle(request)) return;
    const sameOrigin = new URL(request.url).origin === self.location.origin;

    event.respondWith(
        // 自サイトのファイルはブラウザのHTTPキャッシュに頼らず、毎回サーバーに確認する(古い画面が残らないように)
        fetch(sameOrigin ? new Request(request, { cache: 'no-cache' }) : request)
            .then(response => {
                if (response.ok && response.type !== 'opaque') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, clone)).catch(() => {});
                }
                return response;
            })
            .catch(async () => {
                // オフライン時: 同じURL、?v=の違いは無視、画面の移動は index.html
                const cached = await caches.open(CACHE_NAME).then(c => c.match(request, { ignoreSearch: true }));
                if (cached) return cached;
                if (request.mode === 'navigate') {
                    const page = await caches.open(CACHE_NAME).then(c => c.match('./index.html'));
                    if (page) return page;
                }
                return Response.error();
            })
    );
});
