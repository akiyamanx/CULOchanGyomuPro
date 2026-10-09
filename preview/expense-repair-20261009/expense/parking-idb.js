// ==========================================
// CULOchan業務Pro — 駐車場明細 IndexedDB管理 v1.0
// このファイルは駐車場利用明細データのIndexedDB保存・読込・マイグレーションを担当する
// Phase I: localStorageからIndexedDBへの移行で、画像データの安全な永続化を実現
//
// 設計思想:
//   - localStorageは5MB制限があり画像Base64で溢れやすい
//   - IndexedDBはブラウザの容量制限が緩く（数百MB〜）画像も安全に保存
//   - キャッシュクリアでもIndexedDBは消えない（手動削除しない限り）
//   - 初回起動時にlocalStorageの既存データを自動マイグレーション
//
// 依存: なし（単体動作）
// ==========================================

const ParkingIDB = (() => {
    const DB_NAME = 'CULOchanGyomuPro_Preview_Expense_20261009';
    const DB_VERSION = 1;
    const STORE_NAME = 'parking';
    const LS_KEY = 'gyomupro_parking'; // マイグレーション元のlocalStorageキー

    let _db = null; // DB接続キャッシュ

    // ==========================================
    // DB接続（初回のみopen、以降はキャッシュ返却）
    // ==========================================
    function _openDB() {
        if (_db) return Promise.resolve(_db);

        return new Promise(function(resolve, reject) {
            var request = indexedDB.open(DB_NAME, DB_VERSION);

            // v1.0 - DB作成/バージョンアップ時にストア作成
            request.onupgradeneeded = function(event) {
                var db = event.target.result;
                console.log('[ParkingIDB] DB作成/アップグレード v' + DB_VERSION);

                // parkingストア作成（存在しない場合のみ）
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    var store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    // v1.0 - 日付インデックス（月別検索用）
                    store.createIndex('date', 'date', { unique: false });
                    console.log('[ParkingIDB] parkingストア作成完了');
                }
            };

            request.onsuccess = function(event) {
                _db = event.target.result;

                // v1.0 - DB接続が切れた場合の再接続対応
                _db.onclose = function() {
                    console.warn('[ParkingIDB] DB接続が閉じられました');
                    _db = null;
                };

                console.log('[ParkingIDB] DB接続成功');
                resolve(_db);
            };

            request.onerror = function(event) {
                console.error('[ParkingIDB] DB接続エラー:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // ==========================================
    // 全件取得
    // ==========================================
    async function getAll() {
        try {
            var db = await _openDB();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.getAll();

                request.onsuccess = function() {
                    var items = request.result || [];
                    console.log('[ParkingIDB] 全件取得:', items.length + '件');
                    resolve(items);
                };
                request.onerror = function() {
                    console.error('[ParkingIDB] 全件取得エラー:', request.error);
                    reject(request.error);
                };
            });
        } catch (e) {
            console.error('[ParkingIDB] getAll失敗:', e);
            return [];
        }
    }

    // ==========================================
    // 1件保存（追加 or 更新）
    // ==========================================
    async function put(item) {
        try {
            var db = await _openDB();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var request = store.put(item);

                request.onsuccess = function() {
                    resolve(true);
                };
                request.onerror = function() {
                    console.error('[ParkingIDB] put エラー:', request.error);
                    reject(request.error);
                };
            });
        } catch (e) {
            console.error('[ParkingIDB] put失敗:', e);
            return false;
        }
    }

    // ==========================================
    // 複数件一括保存（マイグレーション・インポート用）
    // 1つのトランザクションで全件putするので高速
    // ==========================================
    async function putAll(items) {
        if (!items || items.length === 0) return true;
        try {
            var db = await _openDB();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);

                items.forEach(function(item) {
                    store.put(item);
                });

                tx.oncomplete = function() {
                    console.log('[ParkingIDB] 一括保存完了:', items.length + '件');
                    resolve(true);
                };
                tx.onerror = tx.onabort = function() {
                    console.error('[ParkingIDB] 一括保存エラー:', tx.error);
                    reject(tx.error || new Error('保存が中断されました'));
                };
            });
        } catch (e) {
            console.error('[ParkingIDB] putAll失敗:', e);
            return false;
        }
    }

    // ==========================================
    // 1件削除
    // ==========================================
    async function remove(id) {
        try {
            var db = await _openDB();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var request = store.delete(id);

                tx.oncomplete = function() {
                    console.log('[ParkingIDB] 削除:', id);
                    resolve(true);
                };
                tx.onerror = tx.onabort = function() { reject(tx.error || new Error('削除が中断されました')); };
                request.onerror = function() {
                    console.error('[ParkingIDB] 削除エラー:', request.error);
                    reject(request.error);
                };
            });
        } catch (e) {
            console.error('[ParkingIDB] remove失敗:', e);
            return false;
        }
    }

    // ==========================================
    // 全件削除
    // ==========================================
    async function clearAll() {
        try {
            var db = await _openDB();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var request = store.clear();

                tx.oncomplete = function() {
                    console.log('[ParkingIDB] 全件削除完了');
                    resolve(true);
                };
                tx.onerror = tx.onabort = function() { reject(tx.error || new Error('削除が中断されました')); };
                request.onerror = function() {
                    console.error('[ParkingIDB] 全件削除エラー:', request.error);
                    reject(request.error);
                };
            });
        } catch (e) {
            console.error('[ParkingIDB] clearAll失敗:', e);
            return false;
        }
    }

    // ==========================================
    // 日付で検索（月別取得用）
    // prefix: 'YYYY-MM' 形式で前方一致検索
    // ==========================================
    async function getByMonth(yearMonth) {
        try {
            var db = await _openDB();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var index = store.index('date');

                // IDBKeyRange で 'YYYY-MM' の範囲を作成
                // 例: '2026-04' → '2026-04' 〜 '2026-04\uffff'
                var range = IDBKeyRange.bound(
                    yearMonth,
                    yearMonth + '\uffff'
                );
                var request = index.getAll(range);

                request.onsuccess = function() {
                    var items = request.result || [];
                    console.log('[ParkingIDB] 月別取得(' + yearMonth + '):', items.length + '件');
                    resolve(items);
                };
                request.onerror = function() {
                    console.error('[ParkingIDB] 月別取得エラー:', request.error);
                    reject(request.error);
                };
            });
        } catch (e) {
            console.error('[ParkingIDB] getByMonth失敗:', e);
            return [];
        }
    }

    // ==========================================
    // 件数取得
    // ==========================================
    async function count() {
        try {
            var db = await _openDB();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.count();

                request.onsuccess = function() {
                    resolve(request.result);
                };
                request.onerror = function() {
                    reject(request.error);
                };
            });
        } catch (e) {
            console.error('[ParkingIDB] count失敗:', e);
            return 0;
        }
    }

    // ==========================================
    // localStorageからの自動マイグレーション
    // 既存IDBを上書きせず、不足する明細だけを移行する。
    // 内容の競合・保存失敗がある場合は移行元を保持する。
    // ==========================================
    async function migrateFromLocalStorage() {
        try {
            var lsData = PreviewStorage.getItem(LS_KEY);
            if (!lsData) {
                console.log('[ParkingIDB] PreviewStorage にデータなし、マイグレーション不要');
                return { migrated: false, count: 0 };
            }

            var items = JSON.parse(lsData);
            if (!Array.isArray(items) || items.length === 0) {
                console.log('[ParkingIDB] PreviewStorage データが空配列、マイグレーション不要');
                return { migrated: false, count: 0 };
            }

            if (items.some(item => !item || typeof item.id !== 'string' || !item.id)) {
                throw new Error('移行元の駐車場IDを確認できません');
            }
            var db = await _openDB();
            var result = await new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var request = store.getAll();
                var added = 0, conflicts = 0;
                request.onsuccess = function() {
                    var byId = new Map(request.result.map(item => [item.id, item]));
                    items.forEach(function(item) {
                        var existing = byId.get(item.id);
                        if (existing) {
                            var keys = new Set(Object.keys(existing).concat(Object.keys(item)));
                            if (Array.from(keys).some(key => JSON.stringify(existing[key]) !== JSON.stringify(item[key]))) conflicts++;
                        } else {
                            store.add(item);
                            byId.set(item.id, item);
                            added++;
                        }
                    });
                };
                request.onerror = function() { reject(request.error); };
                tx.oncomplete = function() { resolve({ migrated: added > 0, count: added, conflicts: conflicts }); };
                tx.onerror = tx.onabort = function() { reject(tx.error || new Error('駐車場の移行が中断されました')); };
            });
            // 移行中に旧側が編集された場合も、そのデータを消さない。
            if (!result.conflicts && PreviewStorage.getItem(LS_KEY) === lsData) PreviewStorage.removeItem(LS_KEY);
            return result;
        } catch (e) {
            console.error('[ParkingIDB] マイグレーションエラー:', e);
            return { migrated: false, count: 0 };
        }
    }

    // ==========================================
    // 月別データ削除（PDF出力済み月のクリーンアップ用）
    // ==========================================
    async function deleteByMonth(yearMonth) {
        try {
            var items = await getByMonth(yearMonth);
            if (items.length === 0) return { deleted: 0 };

            var db = await _openDB();
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);

                items.forEach(function(item) {
                    store.delete(item.id);
                });

                tx.oncomplete = function() {
                    console.log('[ParkingIDB] 月別削除(' + yearMonth + '):', items.length + '件');
                    resolve({ deleted: items.length });
                };
                tx.onerror = function() {
                    console.error('[ParkingIDB] 月別削除エラー:', tx.error);
                    reject(tx.error);
                };
            });
        } catch (e) {
            console.error('[ParkingIDB] deleteByMonth失敗:', e);
            return { deleted: 0 };
        }
    }

    return {
        getAll: getAll,
        put: put,
        putAll: putAll,
        remove: remove,
        clearAll: clearAll,
        getByMonth: getByMonth,
        count: count,
        migrateFromLocalStorage: migrateFromLocalStorage,
        deleteByMonth: deleteByMonth
    };
})();

