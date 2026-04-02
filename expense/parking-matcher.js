// ==========================================
// CULOchan業務Pro — 駐車場×顧客 自動マッチング v1.0
// このファイルは駐車場レシートとマップ顧客データを照合し、
// 距離スコア+時間スコアで訪問先候補を自動提案する
//
// Phase G: 統合アプリの相乗効果 — バラバラでは不可能なデータ横断連携
// 設計思想: 80%自動+20%人間修正のフォールバック
//
// 依存: map/map-data-storage.js（DataStorage）
// ==========================================

const ParkingMatcher = (() => {

    // v1.0 - Geocoding API呼び出し回数制限（1セッション）
    var _geocodeCallCount = 0;
    var MAX_GEOCODE_CALLS = 10;

    // ==========================================
    // メイン: レシートデータから候補顧客をマッチング
    // receipt: { date, store, address, enterTime, total, type }
    // 戻り: [{ customer, score, distanceKm, timeDiffMin }]
    // ==========================================
    async function findCandidates(receipt) {
        console.log('[Matcher] マッチング開始:', receipt.store, receipt.date);

        // 1. 駐車場の座標を取得
        var parkingCoord = await _getParkingCoord(receipt);
        if (!parkingCoord) {
            console.warn('[Matcher] 駐車場座標を取得できず、マッチング中断');
            return [];
        }
        console.log('[Matcher] 駐車場座標:', parkingCoord.lat, parkingCoord.lng);

        // 2. 同日付のアポ顧客を抽出
        var candidates = _filterByDate(receipt.date);
        if (candidates.length === 0) {
            console.log('[Matcher] 同日付のアポ顧客なし');
            return [];
        }
        console.log('[Matcher] 同日付候補:', candidates.length + '件');

        // 3. 各候補の距離スコア＋時間スコアを計算
        var scored = [];
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            // 顧客座標がない場合はスキップ
            if (!c.lat || !c.lng) continue;

            var dist = _haversineDistance(parkingCoord, { lat: c.lat, lng: c.lng });
            var timeDiff = _calcTimeDiff(receipt.enterTime, c.appoDate);

            // v1.0 - 距離スコア: 5km以内で有効、近いほど高い
            var distScore = Math.max(0, 1 - dist / 5);
            // v1.0 - 時間スコア: 2時間以内で有効、近いほど高い
            var timeScore = (timeDiff !== null)
                ? Math.max(0, 1 - timeDiff / 120)
                : 0.5; // 時間不明なら中立スコア
            // v1.0 - 総合スコア: 距離70% + 時間30%
            var totalScore = distScore * 0.7 + timeScore * 0.3;

            scored.push({
                customer: c,
                score: totalScore,
                distanceKm: Math.round(dist * 100) / 100,
                timeDiffMin: timeDiff !== null ? Math.round(timeDiff) : null
            });
        }

        // 4. スコア順にソート、上位3件を返す
        scored.sort(function(a, b) { return b.score - a.score; });
        var top3 = scored.slice(0, 3);
        console.log('[Matcher] 上位候補:', top3.map(function(s) {
            return s.customer.company + ' (スコア:' + s.score.toFixed(2) + ')';
        }));
        return top3;
    }

    // ==========================================
    // 駐車場の座標を取得
    // 優先度: ①OCR住所→ジオキャッシュ→Geocoding
    //         ②駐車場名→Geocoding
    // ==========================================
    async function _getParkingCoord(receipt) {
        // 方法A: OCRで住所が取れた場合
        if (receipt.address && receipt.address !== 'unknown') {
            var cached = _checkGeoCache(receipt.address);
            if (cached) {
                console.log('[Matcher] ジオキャッシュヒット(住所):', receipt.address);
                return cached;
            }
            var coord = await _geocodeAddress(receipt.address);
            if (coord) return coord;
        }
        // 方法B: 住所なし → 駐車場名で検索
        if (receipt.store) {
            var storeQuery = receipt.store;
            // 「駐車場」「パーキング」が含まれてなければ追加
            if (storeQuery.indexOf('駐車場') === -1
                && storeQuery.indexOf('パーキング') === -1
                && storeQuery.indexOf('Parking') === -1) {
                storeQuery += ' 駐車場';
            }
            var cachedStore = _checkGeoCache(storeQuery);
            if (cachedStore) {
                console.log('[Matcher] ジオキャッシュヒット(店名):', storeQuery);
                return cachedStore;
            }
            return await _geocodeAddress(storeQuery);
        }
        return null;
    }

    // ==========================================
    // 同日付のアポ顧客を抽出
    // レシート日付と同じ日にアポがある顧客を返す
    // ==========================================
    function _filterByDate(receiptDate) {
        if (!receiptDate || receiptDate === 'unknown') return [];

        // レシート日付をYYYY-MM-DDに正規化
        var rd = _normalizeDate(receiptDate);
        if (!rd) return [];

        // DataStorageから全ワークスペースの顧客を取得
        var customers = _getAllCustomersWithCoords();

        return customers.filter(function(c) {
            // ステータスがアポ済みまたは完了のみ対象
            if (c.status !== 'appointed' && c.status !== 'completed') return false;
            // アポ日時がない場合はスキップ
            if (!c.appoDate) return false;
            // アポ日付の日付部分を抽出して比較
            var appoDateStr = _normalizeDate(c.appoDate);
            return appoDateStr === rd;
        });
    }

    // ==========================================
    // 全顧客データ＋ジオキャッシュ座標を結合して返す
    // ==========================================
    function _getAllCustomersWithCoords() {
        var customers = [];
        try {
            // DataStorageが利用可能か確認
            if (typeof DataStorage === 'undefined') {
                console.warn('[Matcher] DataStorageが未定義');
                return [];
            }
            customers = DataStorage.getCustomers();
        } catch (e) {
            console.warn('[Matcher] 顧客データ取得エラー:', e);
            return [];
        }

        // ジオキャッシュから座標を付与
        var geocache = {};
        try {
            geocache = DataStorage.getGeoCache();
        } catch (e) {
            console.warn('[Matcher] ジオキャッシュ取得エラー:', e);
        }

        return customers.map(function(c) {
            var coords = geocache[c.address] || null;
            return {
                id: c.id,
                company: c.company || '',
                address: c.address || '',
                appoDate: c.appoDate || null,
                status: c.status || 'pending',
                routeId: c.routeId || '',
                lat: coords ? coords.lat : (c.lat || null),
                lng: coords ? coords.lng : (c.lng || null)
            };
        });
    }

    // ==========================================
    // ジオキャッシュを確認（DataStorage.getGeoCache活用）
    // ==========================================
    function _checkGeoCache(address) {
        try {
            var cache = DataStorage.getGeoCache();
            if (cache[address]) {
                return { lat: cache[address].lat, lng: cache[address].lng };
            }
        } catch (e) {
            console.warn('[Matcher] ジオキャッシュ確認エラー:', e);
        }
        return null;
    }

    // ==========================================
    // Geocoding API呼び出し（住所→座標変換）
    // 課金節約: 1セッション最大10回制限 + キャッシュ保存
    // ==========================================
    async function _geocodeAddress(address) {
        if (_geocodeCallCount >= MAX_GEOCODE_CALLS) {
            console.warn('[Matcher] Geocoding API呼び出し上限到達(' + MAX_GEOCODE_CALLS + '回)');
            return null;
        }

        // Maps APIキーを取得
        var apiKey = _getMapsApiKey();
        if (!apiKey) {
            console.warn('[Matcher] Maps APIキーが未設定');
            return null;
        }

        try {
            _geocodeCallCount++;
            console.log('[Matcher] Geocoding API呼び出し #' + _geocodeCallCount + ':', address);
            var url = 'https://maps.googleapis.com/maps/api/geocode/json'
                + '?address=' + encodeURIComponent(address)
                + '&language=ja&region=jp'
                + '&key=' + apiKey;
            var res = await fetch(url);
            var data = await res.json();

            if (data.status === 'OK' && data.results && data.results.length > 0) {
                var loc = data.results[0].geometry.location;
                var coord = { lat: loc.lat, lng: loc.lng };
                // キャッシュに保存（次回からGeocoding不要）
                try {
                    DataStorage.setGeoCache(address, coord);
                    console.log('[Matcher] ジオキャッシュ保存:', address);
                } catch (e) {
                    console.warn('[Matcher] ジオキャッシュ保存失敗:', e);
                }
                return coord;
            } else {
                console.warn('[Matcher] Geocoding結果なし:', data.status);
                return null;
            }
        } catch (e) {
            console.error('[Matcher] Geocoding APIエラー:', e);
            return null;
        }
    }

    // ==========================================
    // Maps APIキーを取得（設定モーダルの値を参照）
    // ==========================================
    function _getMapsApiKey() {
        try {
            var settings = DataStorage.getSettings();
            return settings.apiKey || '';
        } catch (e) {
            return '';
        }
    }

    // ==========================================
    // Haversine距離計算（km）
    // 2点間の直線距離を地球の曲率を考慮して計算
    // ==========================================
    function _haversineDistance(coord1, coord2) {
        var R = 6371; // 地球の半径(km)
        var dLat = _toRad(coord2.lat - coord1.lat);
        var dLng = _toRad(coord2.lng - coord1.lng);
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(_toRad(coord1.lat))
            * Math.cos(_toRad(coord2.lat))
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function _toRad(deg) {
        return deg * Math.PI / 180;
    }

    // ==========================================
    // 時間差計算（分）
    // レシートの入庫時刻 vs アポ開始時刻の差を分で返す
    // 不明な場合はnullを返す
    // ==========================================
    function _calcTimeDiff(enterTime, appoDate) {
        if (!enterTime || enterTime === 'unknown') return null;
        if (!appoDate) return null;

        // enterTime: "HH:MM" 形式
        var enterParts = enterTime.split(':');
        if (enterParts.length < 2) return null;
        var enterMin = parseInt(enterParts[0], 10) * 60 + parseInt(enterParts[1], 10);
        if (isNaN(enterMin)) return null;

        // appoDate: "YYYY-MM-DDTHH:MM" or "YYYY/MM/DD HH:MM:SS" 等
        var appoTimeMin = _extractTimeMinutes(appoDate);
        if (appoTimeMin === null) return null;

        return Math.abs(enterMin - appoTimeMin);
    }

    // ==========================================
    // 日時文字列から時刻部分を分に変換
    // "2026-04-01T09:00" → 540
    // "2026/4/1 9:00:00" → 540
    // ==========================================
    function _extractTimeMinutes(dateTimeStr) {
        // Date()でパースを試みる
        var d = new Date(dateTimeStr);
        if (!isNaN(d.getTime())) {
            return d.getHours() * 60 + d.getMinutes();
        }
        // フォールバック: 正規表現で時刻部分を抽出
        var match = dateTimeStr.match(/(\d{1,2}):(\d{2})/);
        if (match) {
            return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
        }
        return null;
    }

    // ==========================================
    // 日付文字列をYYYY-MM-DD形式に正規化
    // "2026-04-01T09:00" → "2026-04-01"
    // "2026/4/1 9:00:00" → "2026-04-01"
    // "26/04/01" → "2026-04-01"
    // ==========================================
    function _normalizeDate(dateStr) {
        if (!dateStr || dateStr === 'unknown') return null;

        // ISO形式やDatetime-local形式: "YYYY-MM-DD..." → 先頭10文字
        var isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
            return isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3];
        }

        // スラッシュ形式: "YYYY/M/D ..." or "YY/MM/DD"
        var slashMatch = dateStr.match(/^(\d{2,4})\/(\d{1,2})\/(\d{1,2})/);
        if (slashMatch) {
            var year = slashMatch[1];
            if (year.length === 2) year = '20' + year;
            var month = slashMatch[2].padStart(2, '0');
            var day = slashMatch[3].padStart(2, '0');
            return year + '-' + month + '-' + day;
        }

        // Date()でパースを試みる
        var d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            var y = d.getFullYear();
            var m = String(d.getMonth() + 1).padStart(2, '0');
            var dd = String(d.getDate()).padStart(2, '0');
            return y + '-' + m + '-' + dd;
        }

        return null;
    }

    // ==========================================
    // Geocoding呼び出しカウントのリセット（デバッグ/テスト用）
    // ==========================================
    function resetGeocodeCount() {
        _geocodeCallCount = 0;
    }

    // ==========================================
    // v1.0 UI連携 — 🔍手動マッチング（1件ずつ）
    // ParkingManager.getItemById()でデータ取得し結果をモーダル表示
    // ==========================================
    async function autoMatch(id) {
        var item = ParkingManager.getItemById(id);
        if (!item) return;

        var receipt = {
            date: item.date,
            store: item.ocrStore || item.machineName || '',
            address: item.ocrAddress || 'unknown',
            enterTime: item.ocrEnterTime || 'unknown',
            total: item.amount || 0,
            type: 'parking'
        };

        // ローディング表示
        var btn = document.querySelector('[data-id="' + id + '"] .parking-match-btn');
        if (btn) { btn.textContent = '⏳'; btn.disabled = true; }

        try {
            var candidates = await findCandidates(receipt);
            if (candidates.length === 0) {
                alert('マッチする顧客が見つかりませんでした。\n同日のアポ顧客がいるか確認してください。');
            } else {
                _showMatchResult(id, candidates);
            }
        } catch (e) {
            console.error('[Matcher] マッチングエラー:', e);
            alert('マッチング処理でエラーが発生しました。');
        } finally {
            if (btn) { btn.textContent = '🔍'; btn.disabled = false; }
        }
    }

    // v1.0 UI — マッチング候補リストモーダル表示
    function _showMatchResult(id, candidates) {
        var html = '<div class="parking-picker-title">🔍 自動マッチング候補</div>'
            + '<div class="parking-match-list">';

        candidates.forEach(function(c, idx) {
            var scorePercent = Math.round(c.score * 100);
            var distLabel = c.distanceKm < 1
                ? Math.round(c.distanceKm * 1000) + 'm'
                : c.distanceKm.toFixed(1) + 'km';
            var timeLabel = c.timeDiffMin !== null
                ? c.timeDiffMin + '分差' : '時間不明';
            var rankIcon = idx === 0 ? '🥇' : (idx === 1 ? '🥈' : '🥉');
            var company = (c.customer.company || '').replace(/&/g, '&amp;')
                .replace(/</g, '&lt;').replace(/>/g, '&gt;');
            var safeId = id.replace(/'/g, '&#39;');
            var safeName = (c.customer.company || '').replace(/'/g, '&#39;');

            html += '<button class="parking-match-item" '
                + 'onclick="ParkingMatcher.applyMatchResult(\''
                + safeId + '\',\'' + safeName + '\')">'
                + '<span class="match-rank">' + rankIcon + '</span>'
                + '<span class="match-company">' + company + '</span>'
                + '<span class="match-info">'
                + '📏' + distLabel + ' ⏰' + timeLabel
                + ' (' + scorePercent + '点)</span>'
                + '</button>';
        });

        html += '</div>'
            + '<button class="parking-picker-cancel" '
            + 'onclick="ParkingMatcher.closeMatchModal()">キャンセル</button>';

        var overlay = document.getElementById('parkingMatchModal');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'parkingMatchModal';
            overlay.className = 'parking-picker-overlay';
            document.body.appendChild(overlay);
        }
        overlay.innerHTML = '<div class="parking-picker-modal">' + html + '</div>';
        overlay.style.display = 'flex';
    }

    // v1.0 UI — マッチング結果を適用してモーダルを閉じる
    function applyMatchResult(id, name) {
        ParkingManager.updateField(id, 'visitCompany', name);
        closeMatchModal();
        ParkingManager.renderParkingList();
    }

    // v1.0 UI — マッチングモーダルを閉じる
    function closeMatchModal() {
        var el = document.getElementById('parkingMatchModal');
        if (el) el.style.display = 'none';
    }

    return {
        findCandidates: findCandidates,
        resetGeocodeCount: resetGeocodeCount,
        autoMatch: autoMatch,
        applyMatchResult: applyMatchResult,
        closeMatchModal: closeMatchModal
    };
})();
