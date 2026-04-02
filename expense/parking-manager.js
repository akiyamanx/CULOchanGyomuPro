// ==========================================
// CULOchan業務Pro — 駐車場利用明細マネージャー v1.2
// 駐車場利用明細の入力・管理・レシート取り込みを担当
// v1.1: 回転UI（🔄ボタン・rotationフィールド・CSSプレビュー）
// v1.2: Phase G自動マッチング連携（🔍ボタン・OCRデータ保持）
// 依存: app-core.js, receipt-scanner.js, parking-matcher.js
// ==========================================

const ParkingManager = (() => {
    // 駐車場利用データ配列
    // 各要素: { id, imageDataUrl, date, visitCompany, machineName, purpose, amount, rotation, ocrAddress, ocrEnterTime, ocrStore }
    // rotation: 0/90/180/270 (PDF出力時の回転角度)
    // v1.2追加 - ocrAddress/ocrEnterTime/ocrStore: マッチング用OCRデータ
    let _parkingItems = [];
    const STORAGE_KEY = 'gyomupro_parking';

    // ==========================================
    // 初期化
    // ==========================================
    function init() {
        console.log('[Parking] 駐車場利用明細マネージャー初期化');
        _loadFromStorage();
        renderParkingList();
    }

    // ==========================================
    // レシートスキャナーからの取り込み
    // ==========================================
    // レシートスキャナーの認識済みデータから駐車場レシートを取り込む
    // receipt-scanner.jsの_recognizedReceiptsを参照
    function importFromScanner() {
        // ReceiptScannerの認識済みレシートを取得
        var receipts = ReceiptScanner.getRecognizedReceipts
            ? ReceiptScanner.getRecognizedReceipts() : [];
        if (!receipts || receipts.length === 0) {
            alert('先にレシートタブでスキャン→AI読取を行ってください');
            return;
        }

        // チェック済みレシートのみ取り込み
        var checked = receipts.filter(function(r) { return r.checked; });
        if (checked.length === 0) {
            alert('レシートタブでチェック済みのレシートがありません');
            return;
        }

        var importCount = 0;
        var newIds = []; // v1.2追加 - マッチング対象のID
        checked.forEach(function(r) {
            var d = r.data || {};
            var newId = 'park_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
            _parkingItems.push({
                id: newId,
                imageDataUrl: r.imageDataUrl || '',
                date: d.date || '',
                visitCompany: '',
                machineName: d.store || '',
                purpose: 'メンテナンス',
                amount: d.total || 0,
                rotation: 0,
                // v1.2追加 - マッチング用OCRデータ
                ocrAddress: d.address || 'unknown',
                ocrEnterTime: d.enterTime || 'unknown',
                ocrStore: d.store || ''
            });
            if (d.type === 'parking') newIds.push(newId);
            importCount++;
        });

        _saveToStorage();
        renderParkingList();
        alert('✅ ' + importCount + '件の駐車場レシートを取り込みました');

        // v1.2追加 - 駐車場タイプのレシートは自動マッチング実行
        if (newIds.length > 0 && typeof ParkingMatcher !== 'undefined') {
            _runAutoMatchBatch(newIds);
        }
    }

    // v1.2追加 - 複数レシートを順次自動マッチング
    async function _runAutoMatchBatch(ids) {
        var matchCount = 0;
        for (var i = 0; i < ids.length; i++) {
            var item = _parkingItems.find(function(it) { return it.id === ids[i]; });
            if (!item || item.visitCompany) continue;
            var result = await _runAutoMatchSingle(item);
            if (result) matchCount++;
        }
        if (matchCount > 0) {
            _saveToStorage();
            renderParkingList();
            console.log('[Parking] 自動マッチング完了: ' + matchCount + '件');
        }
    }

    // v1.2追加 - 1件の自動マッチング（最有力候補を自動入力）
    async function _runAutoMatchSingle(item) {
        try {
            var receipt = {
                date: item.date,
                store: item.ocrStore || item.machineName || '',
                address: item.ocrAddress || 'unknown',
                enterTime: item.ocrEnterTime || 'unknown',
                total: item.amount || 0,
                type: 'parking'
            };
            var candidates = await ParkingMatcher.findCandidates(receipt);
            if (candidates.length > 0 && candidates[0].score >= 0.3) {
                item.visitCompany = candidates[0].customer.company;
                return true;
            }
        } catch (e) {
            console.warn('[Parking] 自動マッチングエラー:', e);
        }
        return false;
    }

    // ==========================================
    // 手動で1件追加
    // ==========================================
    function addItem() {
        _parkingItems.push({
            id: 'park_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
            imageDataUrl: '',
            date: new Date().toISOString().split('T')[0],
            visitCompany: '',
            machineName: '',
            purpose: 'メンテナンス',
            amount: 0,
            rotation: 0 // v1.1追加 - 回転角度
        });
        _saveToStorage();
        renderParkingList();
    }

    // ==========================================
    // 削除
    // ==========================================
    function removeItem(id) {
        if (!confirm('この駐車場明細を削除しますか？')) return;
        _parkingItems = _parkingItems.filter(function(item) {
            return item.id !== id;
        });
        _saveToStorage();
        renderParkingList();
    }

    // ==========================================
    // 全削除
    // ==========================================
    function clearAll() {
        if (!confirm('駐車場利用明細をすべて削除しますか？')) return;
        _parkingItems = [];
        _saveToStorage();
        renderParkingList();
    }

    // ==========================================
    // v1.1追加 - レシート画像回転（90度ずつ）
    // タップごとに 0→90→180→270→0 と回転
    // PDF出力時にこの角度で回転して配置する
    // ==========================================
    function rotateImage(id) {
        var item = _parkingItems.find(function(i) { return i.id === id; });
        if (!item) return;
        var current = item.rotation || 0;
        item.rotation = (current + 90) % 360;
        _saveToStorage();
        renderParkingList();
    }

    // ==========================================
    // UI描画
    // ==========================================
    function renderParkingList() {
        var container = document.getElementById('parkingItemList');
        if (!container) return;

        if (_parkingItems.length === 0) {
            container.innerHTML = '<p class="empty-msg">駐車場利用データはありません</p>';
            _updateTotal();
            return;
        }

        // マップ顧客リストを取得（訪問先ドロップダウン用）
        var customers = _getMapCustomersForDropdown();

        var html = '';
        _parkingItems.forEach(function(item, idx) {
            html += '<div class="parking-item" data-id="' + item.id + '">';

            // レシート画像サムネイル（あれば表示）+ v1.1 回転ボタン
            if (item.imageDataUrl) {
                var rot = item.rotation || 0;
                html += '<div class="parking-thumb-wrap">'
                    + '<img class="parking-thumb" src="' + item.imageDataUrl + '" '
                    + 'alt="レシート" '
                    + 'style="transform:rotate(' + rot + 'deg)" '
                    + 'onclick="ParkingManager.previewImage(\'' + item.id + '\')">'
                    + '<button class="parking-rotate-btn" '
                    + 'onclick="ParkingManager.rotateImage(\'' + item.id + '\')" '
                    + 'title="90度回転">🔄</button>'
                    + '<span class="parking-rotate-label">' + rot + '°</span>'
                    + '</div>';
            }

            // 入力フォーム
            html += '<div class="parking-form">';

            // 1行目: 日付 + 金額
            html += '<div class="parking-row">'
                + '<div class="parking-fg parking-fg-date">'
                + '<label>日付</label>'
                + '<input type="date" class="parking-input" value="' + (item.date || '') + '" '
                + 'onchange="ParkingManager.updateField(\'' + item.id + '\',\'date\',this.value)">'
                + '</div>'
                + '<div class="parking-fg parking-fg-amount">'
                + '<label>金額</label>'
                + '<input type="number" class="parking-input" value="' + (item.amount || '') + '" '
                + 'placeholder="300" '
                + 'onchange="ParkingManager.updateField(\'' + item.id + '\',\'amount\',this.value)">'
                + '</div>'
                + '</div>';

            // 2行目: 訪問先（ドロップダウン付き）
            html += '<div class="parking-row">'
                + '<div class="parking-fg parking-fg-full">'
                + '<label>訪問先名</label>'
                + '<div class="parking-visit-wrap">'
                + '<input type="text" class="parking-input parking-visit-input" '
                + 'value="' + _escAttr(item.visitCompany || '') + '" '
                + 'placeholder="㈱マーフィード" '
                + 'onchange="ParkingManager.updateField(\'' + item.id + '\',\'visitCompany\',this.value)">';

            // 顧客データがあればドロップダウンボタン
            if (customers.length > 0) {
                html += '<button class="parking-pick-btn" '
                    + 'onclick="ParkingManager.showCustomerPicker(\'' + item.id + '\')">'
                    + '📍</button>';
            }

            // v1.2追加 - 🔍自動マッチングボタン（ParkingMatcher利用可能時）
            if (typeof ParkingMatcher !== 'undefined') {
                html += '<button class="parking-match-btn" '
                    + 'onclick="ParkingMatcher.autoMatch(\'' + item.id + '\')" '
                    + 'title="自動マッチング">🔍</button>';
            }

            html += '</div></div></div>';

            // 3行目: 機械名 + 目的
            html += '<div class="parking-row">'
                + '<div class="parking-fg">'
                + '<label>機械名</label>'
                + '<input type="text" class="parking-input" '
                + 'value="' + _escAttr(item.machineName || '') + '" '
                + 'placeholder="パーキングメーター" '
                + 'onchange="ParkingManager.updateField(\'' + item.id + '\',\'machineName\',this.value)">'
                + '</div>'
                + '<div class="parking-fg">'
                + '<label>目的</label>'
                + '<select class="parking-input parking-select" '
                + 'onchange="ParkingManager.updateField(\'' + item.id + '\',\'purpose\',this.value)">'
                + '<option value="メンテナンス"' + (item.purpose === 'メンテナンス' ? ' selected' : '') + '>メンテナンス</option>'
                + '<option value="修理"' + (item.purpose === '修理' ? ' selected' : '') + '>修理</option>'
                + '<option value="本体設置"' + (item.purpose === '本体設置' ? ' selected' : '') + '>本体設置</option>'
                + '<option value="営業"' + (item.purpose === '営業' ? ' selected' : '') + '>営業</option>'
                + '<option value="その他"' + (item.purpose === 'その他' ? ' selected' : '') + '>その他</option>'
                + '</select>'
                + '</div>'
                + '</div>';

            html += '</div>'; // .parking-form

            // 削除ボタン
            html += '<button class="parking-del-btn" '
                + 'onclick="ParkingManager.removeItem(\'' + item.id + '\')">✕</button>';

            html += '</div>'; // .parking-item
        });

        container.innerHTML = html;
        _updateTotal();
    }

    // ==========================================
    // フィールド更新
    // ==========================================
    function updateField(id, field, value) {
        var item = _parkingItems.find(function(i) { return i.id === id; });
        if (!item) return;
        if (field === 'amount') {
            item[field] = parseInt(value) || 0;
        } else {
            item[field] = value;
        }
        _saveToStorage();
        if (field === 'amount') _updateTotal();
    }

    // ==========================================
    // 合計金額更新
    // ==========================================
    function _updateTotal() {
        var total = _parkingItems.reduce(function(sum, item) {
            return sum + (item.amount || 0);
        }, 0);
        var el = document.getElementById('parkingTotal');
        if (el) el.textContent = '¥' + total.toLocaleString();
    }

    // ==========================================
    // レシート画像プレビュー
    // ==========================================
    function previewImage(id) {
        var item = _parkingItems.find(function(i) { return i.id === id; });
        if (!item || !item.imageDataUrl) return;

        var overlay = document.getElementById('parkingPreviewOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'parkingPreviewOverlay';
            overlay.className = 'parking-preview-overlay';
            overlay.onclick = function() { overlay.style.display = 'none'; };
            overlay.innerHTML = '<img class="parking-preview-img" alt="プレビュー">';
            document.body.appendChild(overlay);
        }
        var img = overlay.querySelector('img');
        if (img) img.src = item.imageDataUrl;
        overlay.style.display = 'flex';
    }

    // ==========================================
    // マップ顧客ドロップダウン
    // ==========================================
    function _getMapCustomersForDropdown() {
        try {
            // 現在の月のワークスペースを探す
            var now = new Date();
            var ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
            var data = localStorage.getItem('mm_customers_' + ym);
            if (data) return JSON.parse(data);
            // フォールバック: 旧形式
            var old = localStorage.getItem('mm_customers');
            return old ? JSON.parse(old) : [];
        } catch (e) {
            return [];
        }
    }

    function showCustomerPicker(id) {
        var customers = _getMapCustomersForDropdown();
        if (customers.length === 0) {
            alert('マップに顧客データがありません');
            return;
        }
        var names = customers.map(function(c) { return c.company || ''; }).filter(function(n) { return n; });
        var unique = [];
        names.forEach(function(n) {
            if (unique.indexOf(n) === -1) unique.push(n);
        });
        if (unique.length === 0) {
            alert('マップに会社名が設定された顧客がありません');
            return;
        }
        var html = '<div class="parking-picker-title">📍 訪問先を選択</div>'
            + '<div class="parking-picker-list">';
        unique.forEach(function(name) {
            html += '<button class="parking-picker-item" '
                + 'onclick="ParkingManager.applyCustomerPick(\'' + _escAttr(id) + '\',\'' + _escAttr(name) + '\')">'
                + _escHtml(name) + '</button>';
        });
        html += '</div>'
            + '<button class="parking-picker-cancel" onclick="ParkingManager.closeCustomerPicker()">キャンセル</button>';
        var overlay = document.getElementById('parkingCustomerPicker');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'parkingCustomerPicker';
            overlay.className = 'parking-picker-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = '<div class="parking-picker-modal">' + html + '</div>';
        overlay.style.display = 'flex';
    }

    function applyCustomerPick(id, name) {
        updateField(id, 'visitCompany', name);
        closeCustomerPicker();
        renderParkingList();
    }

    function closeCustomerPicker() {
        var el = document.getElementById('parkingCustomerPicker');
        if (el) el.style.display = 'none';
    }

    // ==========================================
    // v1.2追加 - アイテム取得（マッチング連携用）
    // ==========================================
    function getItemById(id) {
        return _parkingItems.find(function(it) { return it.id === id; }) || null;
    }

    // ==========================================
    // データの取得（PDF出力用）
    // ==========================================
    function getItems() {
        return _parkingItems.slice();
    }

    // ==========================================
    // localStorage 保存/読み込み
    // ==========================================
    function _saveToStorage() {
        var itemsForSave = _parkingItems.map(function(item) {
            return {
                id: item.id,
                imageDataUrl: item.imageDataUrl,
                date: item.date,
                visitCompany: item.visitCompany,
                machineName: item.machineName,
                purpose: item.purpose,
                amount: item.amount,
                rotation: item.rotation || 0, // v1.1追加 - 回転角度
                // v1.2追加 - マッチング用OCRデータ
                ocrAddress: item.ocrAddress || 'unknown',
                ocrEnterTime: item.ocrEnterTime || 'unknown',
                ocrStore: item.ocrStore || ''
            };
        });
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(itemsForSave));
        } catch (e) {
            console.warn('[Parking] localStorage保存エラー:', e.message);
            var noImg = itemsForSave.map(function(item) {
                var copy = Object.assign({}, item);
                copy.imageDataUrl = '';
                return copy;
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(noImg));
            console.warn('[Parking] 画像なしで保存しました');
        }
    }

    function _loadFromStorage() {
        try {
            var data = localStorage.getItem(STORAGE_KEY);
            if (data) _parkingItems = JSON.parse(data);
        } catch (e) {
            console.warn('[Parking] localStorage読み込みエラー:', e.message);
            _parkingItems = [];
        }
    }

    // ==========================================
    // ユーティリティ
    // ==========================================
    function _escHtml(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function _escAttr(str) {
        return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/'/g, '&#39;');
    }

    return {
        init: init,
        importFromScanner: importFromScanner,
        addItem: addItem,
        removeItem: removeItem,
        clearAll: clearAll,
        rotateImage: rotateImage, // v1.1追加
        renderParkingList: renderParkingList,
        updateField: updateField,
        previewImage: previewImage,
        showCustomerPicker: showCustomerPicker,
        applyCustomerPick: applyCustomerPick,
        closeCustomerPicker: closeCustomerPicker,
        getItemById: getItemById, // v1.2追加 - マッチング連携用
        getItems: getItems
    };
})();
