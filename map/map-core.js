// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.5 - map-core.js
// Google Maps初期化・ピン管理・ジオコーディング
// v2.0新規作成 - 分割ファイル構成対応
// v2.2.1変更 - ポップアップに営業所・型式・フィルター表示＋訪問順ドロップダウン追加
// v2.5追加 - 編集モーダルで目的(purpose)フィールド対応
// v2.2.2変更 - 訪問順ドロップダウンを「並べ替え」ボタンに変更
// ============================================

const MapCore = (() => {
    // v2.0 - 内部変数
    let map = null;
    let markers = [];
    let infoWindow = null;
    let geocoder = null;
    let currentEditId = null;

    // v2.0 - ピン色定義（ステータス別）
    const PIN_COLORS = {
        pending: '#ea4335',     // 未アポ: 赤
        appointed: '#34a853',   // アポ済み: 緑
        completed: '#9e9e9e'    // 完了: グレー
    };

    // v2.0 - 地図初期化（Google Maps API callback）
    function initMap() {
        const settings = DataStorage.getSettings();

        // v2.0 - デフォルト中心は千代田区
        const defaultCenter = { lat: 35.6939, lng: 139.7535 };

        map = new google.maps.Map(document.getElementById('map'), {
            zoom: 11,
            center: defaultCenter,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControl: true,
            styles: [
                { featureType: 'poi', stylers: [{ visibility: 'off' }] }
            ]
        });

        geocoder = new google.maps.Geocoder();
        infoWindow = new google.maps.InfoWindow();

        // v2.0 - 保存済みデータがあれば地図に反映
        const customers = DataStorage.getCustomers();
        if (customers.length > 0) {
            plotAllMarkers(customers);
        }

        // v2.0 - UIを更新
        updateCountBadge();
        updateCustomerList();
        RouteManager.updateRoutePanel();

        // v2.0 - スプラッシュを閉じる
        closeSplash();

        // v2.0 - 自宅住所があればジオコーディングして中心に
        if (settings.homeAddress) {
            geocodeAddress(settings.homeAddress, (latLng) => {
                if (latLng) map.setCenter(latLng);
            });
        }
    }

    // v2.0.1更新 - 全マーカーを地図にプロット（v1.0座標対応）
    function plotAllMarkers(customers) {
        // v2.0 - 既存マーカーをクリア
        clearMarkers();

        const cache = DataStorage.getGeoCache();
        const bounds = new google.maps.LatLngBounds();
        let hasValidMarker = false;
        const uncached = [];

        for (const customer of customers) {
            // v2.0.1 - 座標の優先順位: キャッシュ → 顧客データ直接 → ジオコーディング必要
            const cached = cache[customer.address];
            if (cached) {
                const latLng = new google.maps.LatLng(cached.lat, cached.lng);
                createMarker(customer, latLng);
                bounds.extend(latLng);
                hasValidMarker = true;
            } else if (customer.lat && customer.lng) {
                // v2.0.1追加 - v1.0バックアップの座標を直接使用
                const latLng = new google.maps.LatLng(customer.lat, customer.lng);
                createMarker(customer, latLng);
                bounds.extend(latLng);
                hasValidMarker = true;
                // v2.0.1 - キャッシュにも保存
                if (customer.address) {
                    DataStorage.setGeoCache(customer.address, { lat: customer.lat, lng: customer.lng });
                }
            } else if (customer.address) {
                uncached.push(customer);
            }
        }

        // v2.0 - キャッシュにない顧客をジオコーディング
        if (uncached.length > 0) {
            geocodeAndPlot(uncached);
        }

        if (hasValidMarker) {
            map.fitBounds(bounds, { padding: 50 });
        }
    }

    // v2.0 - ジオコーディング＋マーカー配置（バッチ処理）
    async function geocodeAndPlot(customers) {
        const loading = document.getElementById('mapLoading');
        const progress = document.getElementById('mapLoadingProgress');
        loading.style.display = 'flex';

        const bounds = new google.maps.LatLngBounds();
        // v2.0 - 既存マーカーのboundsも含める
        markers.forEach(m => bounds.extend(m.getPosition()));

        let completed = 0;
        const total = customers.length;

        for (const customer of customers) {
            if (!customer.address) {
                completed++;
                continue;
            }

            progress.textContent = `${completed + 1} / ${total}`;

            // v2.0 - キャッシュチェック
            const cache = DataStorage.getGeoCache();
            if (cache[customer.address]) {
                const latLng = new google.maps.LatLng(cache[customer.address].lat, cache[customer.address].lng);
                createMarker(customer, latLng);
                bounds.extend(latLng);
                completed++;
                continue;
            }

            // v2.0 - Geocoding API呼び出し（200ms間隔）
            try {
                const latLng = await geocodeAddressAsync(customer.address);
                if (latLng) {
                    DataStorage.setGeoCache(customer.address, { lat: latLng.lat(), lng: latLng.lng() });
                    createMarker(customer, latLng);
                    bounds.extend(latLng);

                    // v2.0 - 顧客データに座標を保存
                    DataStorage.updateCustomer(customer.id, {
                        lat: latLng.lat(),
                        lng: latLng.lng()
                    });
                }
            } catch (err) {
                console.warn(`ジオコーディング失敗: ${customer.company} (${customer.address})`, err);
            }

            completed++;
            await sleep(200);
        }

        loading.style.display = 'none';

        if (markers.length > 0) {
            map.fitBounds(bounds, { padding: 50 });
        }

        // v2.0 - UI更新
        updateCountBadge();
        updateCustomerList();
    }

    // v2.0 - ジオコーディング（Promise版）
    function geocodeAddressAsync(address) {
        return new Promise((resolve, reject) => {
            geocoder.geocode({ address: address }, (results, status) => {
                if (status === 'OK' && results[0]) {
                    resolve(results[0].geometry.location);
                } else {
                    reject(status);
                }
            });
        });
    }

    // v2.0 - ジオコーディング（コールバック版）
    function geocodeAddress(address, callback) {
        const cache = DataStorage.getGeoCache();
        if (cache[address]) {
            callback(new google.maps.LatLng(cache[address].lat, cache[address].lng));
            return;
        }
        geocoder.geocode({ address: address }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const latLng = results[0].geometry.location;
                DataStorage.setGeoCache(address, { lat: latLng.lat(), lng: latLng.lng() });
                callback(latLng);
            } else {
                callback(null);
            }
        });
    }

    // v2.0 - マーカー作成
    function createMarker(customer, latLng) {
        const routes = DataStorage.getRoutes();
        const route = routes.find(r => r.id === customer.routeId);
        const pinColor = route ? route.color : PIN_COLORS[customer.status] || PIN_COLORS.pending;

        // v2.0 - ラベル（会社名＋台数）
        let label = customer.company || '不明';
        if (customer.unitCount && customer.unitCount > 1) {
            label += `（${customer.unitCount}台）`;
        }

        // v2.0 - SVGアイコン生成
        const icon = {
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            fillColor: pinColor,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            scale: 6,
            anchor: new google.maps.Point(0, 0)
        };

        const marker = new google.maps.Marker({
            position: latLng,
            map: map,
            icon: icon,
            label: {
                text: label,
                color: '#1e293b',
                fontSize: '11px',
                fontWeight: '600',
                fontFamily: 'Noto Sans JP, sans-serif',
                className: 'marker-label'
            },
            customData: customer
        });

        // v2.0 - クリックイベント
        marker.addListener('click', () => {
            showInfoWindow(marker, customer);
        });

        markers.push(marker);
        return marker;
    }

    // v2.0.1更新 - 吹き出し表示（v1.0フィールド対応）
    function showInfoWindow(marker, customer) {
        const statusText = { pending: '🔴 未アポ', appointed: '🟢 アポ済み', completed: '⚪ 完了' };
        const routes = DataStorage.getRoutes();
        const route = routes.find(r => r.id === customer.routeId);

        let html = `<div class="info-window">`;
        html += `<h3>${customer.company || '不明'}`;
        if (customer.unitCount > 1) html += ` <small>(${customer.unitCount}台)</small>`;
        html += `</h3>`;
        // v2.0.1追加 - 管理番号
        if (customer.managementNo) html += `<p>🔖 ${customer.managementNo}</p>`;
        html += `<p>📍 ${customer.address || ''}</p>`;
        if (customer.phone) html += `<p>📞 ${customer.phone}</p>`;
        if (customer.contact) html += `<p>👤 ${customer.contact}</p>`;
        // v2.0.1追加 - 階数
        if (customer.floors && customer.floors.length > 0) {
            html += `<p>🏢 ${customer.floors.join(', ')}</p>`;
        }
        // v2.0.1追加 - 機種名
        if (customer.model) html += `<p>💧 ${customer.model}</p>`;
        // v2.2.1追加 - 営業所
        if (customer.branch) html += `<p>🏢 営業所: ${customer.branch}</p>`;
        // v2.2.1追加 - 型式
        if (customer.equipType) html += `<p>⚙️ 型式: ${customer.equipType}</p>`;
        // v2.2.1追加 - 交換フィルター
        if (customer.filter) html += `<p>🔧 フィルター: ${customer.filter}</p>`;
        if (route) html += `<p>🗺️ ${route.name}</p>`;
        html += `<p>${statusText[customer.status] || statusText.pending}</p>`;
        if (customer.appoDate) {
            const d = new Date(customer.appoDate);
            const dateStr = isNaN(d.getTime()) ? customer.appoDate : d.toLocaleString('ja-JP');
            html += `<p>📅 ${dateStr}</p>`;
        }
        if (customer.note) html += `<p style="font-size:11px;color:#64748b;white-space:pre-wrap;">📝 ${customer.note}</p>`;
        // v2.0.1追加 - 追加情報
        if (customer.info) html += `<p style="font-size:11px;color:#64748b;">ℹ️ ${customer.info}</p>`;
        // v2.2.2変更 - 訪問順編集ボタン（ドラッグ&ドロップモーダルを開く）
        if (customer.routeId) {
            const currentRoute = routes.find(r => r.id === customer.routeId);
            const currentOrder = currentRoute && currentRoute.order ? currentRoute.order : [];
            const currentIdx = currentOrder.indexOf(customer.id);
            const orderText = currentIdx >= 0 ? `${currentIdx + 1}番目` : '未設定';

            html += `<div class="info-visit-order">`;
            html += `<span>🔢 訪問順: ${orderText}</span>`;
            html += `<button class="info-btn info-btn-order" onclick="RouteOrder.startEdit('${customer.routeId}')">並べ替え</button>`;
            html += `</div>`;
        }
        html += `<div class="info-actions">`;
        html += `<button class="info-btn info-btn-edit" onclick="MapCore.openEdit('${customer.id}')">✏️ 編集</button>`;
        if (customer.phone) {
            const phoneNum = customer.phone.split('/')[0].replace(/[^0-9\-]/g, '');
            html += `<button class="info-btn info-btn-call" onclick="window.open('tel:${phoneNum}')">📞 電話</button>`;
        }
        html += `</div></div>`;

        infoWindow.setContent(html);
        infoWindow.open(map, marker);
    }

    // v2.0 - マーカー全削除
    function clearMarkers() {
        markers.forEach(m => m.setMap(null));
        markers = [];
    }

    // v2.0 - 特定マーカーの色を更新
    function updateMarkerColor(customerId) {
        const customer = DataStorage.getCustomers().find(c => c.id === customerId);
        if (!customer) return;

        const marker = markers.find(m => m.customData && m.customData.id === customerId);
        if (!marker) return;

        const routes = DataStorage.getRoutes();
        const route = routes.find(r => r.id === customer.routeId);
        const pinColor = route ? route.color : PIN_COLORS[customer.status] || PIN_COLORS.pending;

        marker.setIcon({
            path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
            fillColor: pinColor,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2,
            scale: 6,
            anchor: new google.maps.Point(0, 0)
        });
    }

    // v2.0 - 件数バッジ更新
    function updateCountBadge() {
        const customers = DataStorage.getCustomers();
        document.getElementById('countBadge').textContent = `${customers.length}件`;
    }

    // v2.0 - 顧客リスト更新
    function updateCustomerList() {
        const customers = DataStorage.getCustomers();
        const routes = DataStorage.getRoutes();
        const listEl = document.getElementById('customerList');

        if (customers.length === 0) {
            listEl.innerHTML = '<p class="empty-msg">📁 CSVファイルを読み込むか、➕ボタンで追加してください</p>';
            return;
        }

        let html = '';
        for (const c of customers) {
            const route = routes.find(r => r.id === c.routeId);
            const statusClass = `status-${c.status || 'pending'}`;

            html += `<div class="customer-item" onclick="MapCore.focusMarker('${c.id}')">`;
            html += `<div class="customer-status ${statusClass}"></div>`;
            html += `<div class="customer-info">`;
            html += `<div class="customer-name">${c.company || '不明'}`;
            if (c.managementNo) html += ` <small style="color:#94a3b8;font-weight:400;">${c.managementNo}</small>`;
            html += `</div>`;
            html += `<div class="customer-address">${c.address || ''}`;
            if (c.floors && c.floors.length > 0) html += ` 🏢${c.floors.join(',')}`;
            html += `</div>`;
            html += `</div>`;
            if (c.unitCount > 1) {
                html += `<span class="customer-count">${c.unitCount}台</span>`;
            }
            if (route) {
                html += `<span class="customer-route" style="background:${route.color}">${route.name}</span>`;
            }
            html += `</div>`;
        }
        listEl.innerHTML = html;
    }

    // v2.0 - マーカーにフォーカス
    function focusMarker(customerId) {
        const marker = markers.find(m => m.customData && m.customData.id === customerId);
        if (marker) {
            map.setCenter(marker.getPosition());
            map.setZoom(16);
            google.maps.event.trigger(marker, 'click');
            // v2.0 - 下部パネルを閉じる
            document.getElementById('bottomPanel').classList.add('collapsed');
        }
    }

    // v2.0 - 編集モーダルを開く
    function openEdit(customerId) {
        const customer = DataStorage.getCustomers().find(c => c.id === customerId);
        if (!customer) return;

        currentEditId = customerId;
        document.getElementById('editCompany').value = customer.company || '';
        document.getElementById('editAddress').value = customer.address || '';
        document.getElementById('editPhone').value = customer.phone || '';
        document.getElementById('editContact').value = customer.contact || '';
        document.getElementById('editNote').value = customer.note || '';
        document.getElementById('editStatus').value = customer.status || 'pending';
        document.getElementById('editAppoDate').value = customer.appoDate || '';
        // v2.5追加 - 目的フィールド
        document.getElementById('editPurpose').value = customer.purpose || '';

        // v2.0 - ルート選択肢を設定
        const routes = DataStorage.getRoutes();
        const routeSelect = document.getElementById('editRoute');
        routeSelect.innerHTML = '<option value="">未割当</option>';
        routes.forEach(r => {
            routeSelect.innerHTML += `<option value="${r.id}" ${customer.routeId === r.id ? 'selected' : ''}>${r.name}</option>`;
        });

        document.getElementById('editModal').style.display = 'flex';
        infoWindow.close();
    }

    // v2.0 - 全マーカー再描画
    function refreshAllMarkers() {
        const customers = DataStorage.getCustomers();
        clearMarkers();
        const cache = DataStorage.getGeoCache();
        for (const c of customers) {
            const cached = cache[c.address];
            if (cached) {
                createMarker(c, new google.maps.LatLng(cached.lat, cached.lng));
            } else if (c.lat && c.lng) {
                createMarker(c, new google.maps.LatLng(c.lat, c.lng));
            }
        }
        updateCountBadge();
        updateCustomerList();
    }

    // v2.0 - 待機関数
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // v2.0 - 公開API
    return {
        initMap, geocodeAndPlot, plotAllMarkers, clearMarkers,
        createMarker, updateMarkerColor, focusMarker,
        openEdit, refreshAllMarkers,
        updateCountBadge, updateCustomerList,
        getCurrentEditId: () => currentEditId,
        getMap: () => map, getMarkers: () => markers
    };
})();

// v2.0 - Google Maps APIコールバック
function initMap() {
    MapCore.initMap();
}