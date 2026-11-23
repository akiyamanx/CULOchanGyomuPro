// [CULOchanGyomuPro統合] v1.4 2026-04-01 - closeSplash ReferenceError修正
// ============================================
// メンテナンスマップ v2.5 - map-core.js
// Google Maps初期化・ピン管理・ジオコーディング
// v2.0新規作成 - 分割ファイル構成対応
// v2.2.1変更 - ポップアップに営業所・型式・フィルター表示＋訪問順ドロップダウン追加
// v2.5追加 - 編集モーダルで目的(purpose)フィールド対応
// v2.2.2変更 - 訪問順ドロップダウンを「並べ替え」ボタンに変更
// ============================================

const MapCore = (() => {
    let map = null;
    let markers = [];
    let infoWindow = null;
    let geocoder = null;
    let currentEditId = null;
    let completedOnly = false;
    let displayWorkspace;
    let todayOnly = false, today = null, todayRows = [], todayIncomplete = false;
    let viewVersion = 0;
    function readToday() {
        if(!todayOnly)return;
        today=TodayVisits.clock();
        const result=TodayVisits.read(DataStorage,today.day,VisitPlanner);
        todayRows=result.rows;
        todayIncomplete=result.incomplete;
    }
    function renderTodayCard() {
        const card=document.getElementById('mapTodayCard');
        if(!card)return;
        card.hidden=!todayOnly;
        if(!todayOnly)return;
        const when=TodayVisits.clock(), esc=ExpenseImport.escapeHtml;
        const next=!completedOnly && !todayIncomplete ? TodayVisits.next(todayRows,when,VisitPlanner) : null;
        let html='';
        if(todayIncomplete)html+='<p class="today-warning" role="status">読み込めなかった月があります。確認できた訪問だけを表示しています。</p>';
        if(typeof navigator!=='undefined' && navigator.onLine===false)
            html+='<p class="today-warning" role="status">オフライン：この端末に保存された訪問を表示中。地図・ナビの読み込みには通信が必要な場合があります。</p>';
        if(next) {
            const phones=VisitPlanner.phoneNumbers(next.phone);
            const loc=TodayVisits.locationDetails(next);
            const nav=TodayVisits.directions(next.address);
            const location = [loc.building,loc.address].filter(Boolean).join(' ／ ');
            const levels = [loc.reception && '受付: ' + loc.reception, loc.equipment && '機械の設置階: ' + loc.equipment,loc.other && 'フロア情報: ' + loc.other].filter(Boolean).join(' ／ ');
            const serial=typeof EquipmentHistory!=='undefined' ? EquipmentHistory.serial(next.managementNo) : '';
            html+='<div class="today-next"><div><span class="today-kicker">次の訪問 · '+esc(TodayVisits.timeText(next,today.day,VisitPlanner))
                +'</span><strong>'+esc(next.company||'訪問先名なし')+'</strong><p class="today-location">'+esc(location || '住所未登録')+'</p>'
                +(levels ? '<p class="today-location">'+esc(levels)+'</p>' : '')+'</div><div class="today-quick">';
            html+=phones.map((p,i)=>'<a class="btn btn-secondary" href="tel:'+esc(p)+'">電話'+(phones.length>1?' '+(i+1):'')+'</a>').join('');
            if(nav)html+='<a class="btn btn-primary" href="'+esc(nav)+'" rel="noopener noreferrer" target="_blank" aria-label="Google マップで経路を開く">ナビ</a>';
            if(serial)html+='<button type="button" class="btn btn-secondary" data-today-history="true">前回の作業実績を見る</button>';
            if(!phones.length && !nav)html+='<span class="visit-help">電話番号・住所が未登録</span>';
            html+='</div></div>';
        } else if(!completedOnly && !todayIncomplete) {
            html+='<p class="today-empty">これからのアポ済みの訪問はありません。今日の訪問は一覧で確認できます。</p>';
        }
        if(viewCustomers().some(visible))html+='<a class="today-list-link" href="#customerList" onclick="if(typeof mapSwitchTab===&quot;function&quot;)mapSwitchTab(&quot;list&quot;)">今日の一覧へ ↓</a>';
        card.hidden=!html;
        if(card.dataset.renderKey!==html){card.dataset.renderKey=html;card.innerHTML=html;}
        const historyButton=card.querySelector?.('[data-today-history]');
        if(historyButton && next && typeof EquipmentHistoryUI!=='undefined') historyButton.onclick=()=>EquipmentHistoryUI.openForVisit(next);
    }
    function toggleToday() {
        syncMapWorkspace();
        todayOnly=!todayOnly;
        completedOnly=false;
        refreshAllMarkers({fit:true});
        if(todayOnly && typeof mapSwitchTab==='function')mapSwitchTab('list');
    }
    function refreshTodayClock() {
        if(!todayOnly)return;
        if(!today || TodayVisits.clock().day!==today.day)refreshAllMarkers({fit:true});
        else renderTodayCard();
    }
    const workspace = () => DataStorage.getCurrentWorkspaceId?.();
    const visible = c => RoutePinStyle.visible(c,completedOnly);
    const siteKey = c => typeof SitePins==='undefined' ? String(c.id) : SitePins.key(c);
    const siteRows = c => viewCustomers().filter(row=>siteKey(row)===siteKey(c));
    const findMarker = c => c && markers.find(m=>m.siteKey===siteKey(c));
    const visibleMembers = m => m.members.filter(visible);
    const firstByDate = rows => [...rows].sort((a,b)=>(a.appoDate||'9999').localeCompare(b.appoDate||'9999'))[0];
    function representative(rows) { return firstByDate(rows.filter(visible)) || firstByDate(rows); }
    function drawMarker(marker, rows, repaint=true) {
        if (!rows.length) { marker.setVisible(false); return; }
        marker.members=rows;
        const c=representative(rows);
        marker.customData=c;
        if (repaint) {
            const routes=markerRoutes(c);
            marker.setVisible(rows.some(visible));
            marker.setIcon?.(RoutePinStyle.icon(RoutePinStyle.visitStyle(c,routes,pinMonth()),google.maps));
            marker.setTitle?.(markerTitle(c,routes,rows.filter(visible).length));
        }
    }
    function navLink(c) {
        const url = typeof TodayVisits!=='undefined' ? TodayVisits.directions(c.address) : '';
        return url ? '<a class="info-btn info-btn-nav" href="'+ExpenseImport.escapeHtml(url)+'" target="_blank" rel="noopener noreferrer">ナビを開く</a>' : '';
    }
    function unitPanel(c) {
        const rows=siteRows(c).filter(visible);
        const esc=ExpenseImport.escapeHtml;
        let html='';
        if(rows.length>1) {
            html+='<details class="pin-site-units"><summary>このピンの訪問 '+rows.length+'件</summary><ul>';
            for(const row of rows) {
                html+='<li><span>'+esc(row.managementNo||'機番未登録')+' · '+esc(RoutePinStyle.statusLabel(row.status))+'</span> <button type="button" class="info-btn info-btn-edit" onclick="MapCore.openEdit('+esc(JSON.stringify(row.id))+')">日時・備考</button></li>';
            }
            html+='</ul></details>';
        }
        if(c.status!=='completed') html+='<button type="button" class="info-btn info-btn-complete" onclick="MapCore.openCompletion('+esc(JSON.stringify(c.id))+')">作業完了を記録</button>';
        return html;
    }
    let completion=null;
    function openCompletion(id) {
        const c=viewCustomers().find(row=>row.id===id);
        const d=document.getElementById('siteCompletionDialog');
        if(!c || !d || d.open || c.status==='completed') return;
        const wsOf=row=>row.workspaceId || DataStorage.workspaceOfCustomer?.(row.id) || workspace();
        const ws=wsOf(c), peers=siteRows(c).filter(row=>row.status!=='completed');
        const rows=peers.filter(row=>wsOf(row)===ws);
        completion={ws,rows};
        const list=document.getElementById('siteCompletionRows');
        list.replaceChildren();
        for(const row of rows) {
            const label=document.createElement('label'), check=document.createElement('input'), text=document.createElement('span');
            check.type='checkbox'; check.value=String(row.id); check.checked=Boolean(SitePins.keepByDefault(c,row));
            text.textContent=[row.managementNo||'機番未登録',row.purpose,row.appoDate?.replace('T',' '),row.unitCount>1 && row.unitCount+'台（同じ行）'].filter(Boolean).join(' · ');
            label.append(check,text); list.append(label);
        }
        document.getElementById('siteCompletionScope').textContent=(c.company||'訪問先')+' · 未完了 '+rows.length+'件'
            +(peers.length!==rows.length?'。別の月の訪問は今回の対象外です。':'');
        document.getElementById('siteCompletionError').textContent='';
        d.showModal();
    }
    function confirmCompletion() {
        const d=document.getElementById('siteCompletionDialog');
        if(!d?.open || !completion) return;
        const keep=[...d.querySelectorAll('#siteCompletionRows input:checked')].map(x=>x.value);
        const r=SitePins.apply(AppStorage,completion.ws,completion.rows,keep);
        if(!r.ok) {
            document.getElementById('siteCompletionError').textContent=r.reason==='stale'?'訪問の内容が変わりました。閉じて開き直してください。':'保存できませんでした。保存状況を確認してください。';
            return;
        }
        completion=null; d.close();
        const status=document.getElementById('siteCompletionNotice');
        if(status) { status.hidden=false; status.textContent=r.done+'件を完了、'+r.kept+'件を未完了のまま残しました。'; }
        refreshAllMarkers(); RouteManager.updateRoutePanel();
    }
    function syncMapWorkspace() {
        const id=workspace();
        if(displayWorkspace!==id) { displayWorkspace=id; todayOnly=false; completedOnly=false; }
    }
    function updateMapFilter(customers) {
        const count=customers.filter(c=>c.status==='completed').length;
        const button=document.getElementById('mapCompletedButton');
        if(button) {
            button.textContent='完了した訪問を見る（'+count+'）';
            button.setAttribute('aria-pressed',String(completedOnly));
        }
        const todayButton=document.getElementById('mapTodayButton');
        if(todayButton)todayButton.setAttribute('aria-pressed',String(todayOnly));
        const message=document.getElementById('mapVisitView');
        if(message) {
            const mode=todayOnly ? ('今日 '+today.day.slice(5).replace('-','/')+' · ') : '';
            const text=mode+(completedOnly ? '完了のみ · '+count+'件' : '未完了 · '+(customers.length-count)+'件');
            if(message.textContent!==text)message.textContent=text;
        }
        renderTodayCard();
    }
    function fitVisibleMarkers() {
        const shown=markers.filter(m=>visible(m.customData));
        if(!map || !shown.length)return;
        const bounds=new google.maps.LatLngBounds();
        shown.forEach(m=>bounds.extend(m.getPosition()));
        map.fitBounds(bounds,{padding:50});
    }
    function fitAfterLocation(fit,customers) {
        const version=++viewVersion;
        const shown=markers.some(m=>visible(m.customData));
        if(fit && shown)fitVisibleMarkers();
        const locating=locateMissing(customers.filter(visible));
        if(fit && !shown)locating.then(result=>{
            if(result.ok && version===viewVersion)fitVisibleMarkers();
        });
    }
    function setCompletedMode(next,{fit=true}={}) {
        if(completedOnly===next)return;
        completedOnly=next;
        infoWindow?.close();
        document.getElementById('listPickCard')?.remove();
        markers.forEach(m=>drawMarker(m,m.members));
        updateCustomerList();
        fitAfterLocation(fit,viewCustomers());
    }
    function toggleCompleted() { setCompletedMode(!completedOnly); }
    // 地図のキーが無効・未設定だと geocode の返事が来ず「処理中」が回り続けたため、見張り役を通す。
    const guard = GeocodeGuard.create({ timeoutMs: 8000 });
    const monthCustomers = () => (typeof DataStorage.getViewCustomers === "function" ? DataStorage.getViewCustomers() : DataStorage.getCustomers());
    const viewCustomers = () => todayOnly ? todayRows : monthCustomers();
    const findView = id => (DataStorage.findCustomer ? DataStorage.findCustomer(id) : null) || viewCustomers().find(c => c.id === id);
    function showMapNotice() {
        const setup = document.getElementById('mapSetup');
        const msg = document.getElementById('mapSetupMessage');
        if (msg) { msg.textContent = GeocodeGuard.NOTICE; msg.setAttribute('role', 'status'); }
        if (setup) setup.hidden = false;
        const loading = document.getElementById('mapLoading');
        if (loading) loading.style.display = 'none';
    }
    function mapFailed(why) { guard.markFailed(why); showMapNotice(); }

    function initMap() {
        syncMapWorkspace();
        const settings = DataStorage.getSettings();
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
        const setup = document.getElementById('mapSetup');
        if (setup) setup.hidden = true;

        readToday();
        const customers = viewCustomers();
        if (customers.length > 0) {
            plotAllMarkers(customers);
        }

        updateCountBadge();
        updateCustomerList();
        RouteManager.updateRoutePanel();

        // v1.4修正: closeSplash()削除（統合版ではスプラッシュ画面なし）

        if (settings.homeAddress) {
            geocodeAddress(settings.homeAddress, (latLng) => {
                if (latLng) map.setCenter(latLng);
            });
        }
    }

    function plotAllMarkers(customers) {
        clearMarkers();
        const cache = DataStorage.getGeoCache();
        const uncached = [];
        for (const c of customers) {
            const position = cache[c.address] || (c.lat && c.lng && c);
            if (position) {
                createMarker(c,new google.maps.LatLng(position.lat,position.lng));
                if (!cache[c.address] && c.address) {
                    DataStorage.setGeoCache(c.address,{lat:c.lat,lng:c.lng});
                }
            } else if (c.address && visible(c)) uncached.push(c);
        }
        const pending=uncached.filter(c=>!findMarker(c));
        if (pending.length) geocodeAndPlot([...new Map(pending.map(c=>[siteKey(c),c])).values()]);
        fitVisibleMarkers();
    }

    async function geocodeAndPlot(customers) {
        // Registration and list editing do not require a loaded Google map.
        if (!map || !geocoder) {
            updateCountBadge();
            updateCustomerList();
            RouteManager.updateRoutePanel();
            return;
        }
        if (guard.failed()) { showMapNotice(); updateCountBadge(); updateCustomerList(); RouteManager.updateRoutePanel(); return; }
        const loading = document.getElementById('mapLoading');
        const progress = document.getElementById('mapLoadingProgress');
        loading.style.display = 'flex';
        try {


        for (const m of markers) {
            const rows=siteRows(m.customData);
            drawMarker(m,rows);
        }
        let completed = 0;
        const total = customers.length;

        for (const customer of customers) {
            if (!customer.address || !visible(customer)) { completed++; continue; }
            progress.textContent = `${completed + 1} / ${total}`;

            const cache = DataStorage.getGeoCache();
            if (cache[customer.address]) {
                const latLng = new google.maps.LatLng(cache[customer.address].lat, cache[customer.address].lng);
                createCurrentMarker(customer,latLng);
                completed++;
                continue;
            }

            try {
                const latLng = await guard.run(() => geocodeAddressAsync(customer.address));
                if (latLng) {
                    DataStorage.setGeoCache(customer.address, { lat: latLng.lat(), lng: latLng.lng() });
                    createCurrentMarker(customer,latLng);
                    DataStorage.updateCustomer(customer.id, { lat: latLng.lat(), lng: latLng.lng() });
                }
            } catch (err) {
                console.warn(`ジオコーディング失敗: ${customer.company} (${customer.address})`, err);
            }
            completed++;
            if (guard.failed()) break;
            await sleep(200);
        }
        } finally {
            loading.style.display = 'none';
        }
        if (guard.failed()) showMapNotice();
        else fitVisibleMarkers();
        updateCountBadge();
        updateCustomerList();
        RouteManager.updateRoutePanel();
    }

    function geocodeOnce(address) {
        return new Promise((resolve, reject) => {
            geocoder.geocode({ address: address }, (results, status) => {
                if (status === 'OK' && results[0]) { resolve(results[0].geometry.location); }
                else {
                    if (status === 'REQUEST_DENIED' || status === 'OVER_QUERY_LIMIT') mapFailed(status);
                    reject(status);
                }
            });
        });
    }
    // 見つからない(ZERO_RESULTS)ときだけ、全角→半角・建物名を外した住所でも試す
    async function geocodeAddressAsync(address) {
        let last = 'ZERO_RESULTS';
        for (const v of GeocodeGuard.addressVariants(address)) {
            try { return await geocodeOnce(v); }
            catch (st) { last = st; if (st !== 'ZERO_RESULTS') break; }
        }
        throw last;
    }

    function geocodeAddress(address, callback) {
        const cache = DataStorage.getGeoCache();
        if (cache[address]) {
            callback(new google.maps.LatLng(cache[address].lat, cache[address].lng));
            return;
        }
        if (!geocoder) { callback(null); return; }
        guard.run(() => geocodeAddressAsync(address)).then(latLng => {
            if (latLng) DataStorage.setGeoCache(address, { lat: latLng.lat(), lng: latLng.lng() });
            callback(latLng || null);
        });
    }

    const markerRoutes = c => c?.workspaceId && c.workspaceId!==workspace() ? DataStorage.getRoutes(c.workspaceId)
        : DataStorage.isUndatedCombinedView?.() ? [] : DataStorage.getRoutes();
    const pinMonth = () => todayOnly ? today.day.slice(0,7) : workspace();
    function markerTitle(customer,routes,count=1) {
        const route=routes.find(r=>r.id===customer.routeId);
        return [customer.company || '不明',count>1 ? '同じ現場 '+count+'件' : RoutePinStyle.statusLabel(customer.status),RoutePinStyle.visitDay(customer)?.iso,route?.name].filter(Boolean).join(' · ');
    }
    function createMarker(customer, latLng) {
        const rows=siteRows(customer), key=siteKey(customer);
        const previous=findMarker(customer);
        if(previous) return previous;
        const members=rows.length ? rows : [customer];
        customer=representative(members);
        const routes = markerRoutes(customer);
        const marker = new google.maps.Marker({
            position:latLng,map,visible:visible(customer),
            icon:RoutePinStyle.icon(RoutePinStyle.visitStyle(customer,routes,pinMonth()),google.maps),
            title:markerTitle(customer,routes,members.filter(visible).length)
        });
        marker.siteKey=key;
        drawMarker(marker,members,false);
        marker.addListener('click', () => { if(visibleMembers(marker).length)showInfoWindow(marker,marker.customData); });
        markers.push(marker);
        return marker;
    }

    // 測位結果が戻る間に月やアポ状態が変わっても、古い表示を地図に混ぜない。
    function createCurrentMarker(customer, position) {
        const current=viewCustomers().find(c=>c.id===customer.id && c.address===customer.address);
        if(current && !findMarker(current))createMarker(current,position);
    }

    // 吹き出しと情報カードで共通の詳細行(customer は文字列をエスケープ済みのコピー)
    function detailLines(customer) {
        let html = '';
        if (customer.managementNo) html += `<p>🔖 ${customer.managementNo}</p>`;
        html += `<p>📍 ${customer.address || ''}</p>`;
        if (customer.phone) html += `<p>📞 ${customer.phone}</p>`;
        if (customer.contact) html += `<p>👤 ${customer.contact}</p>`;
        if (Array.isArray(customer.floors) && customer.floors.length > 0) html += `<p>🏢 ${customer.floors.join(', ')}</p>`;
        if (customer.model) html += `<p>💧 ${customer.model}</p>`;
        if (customer.branch) html += `<p>🏢 営業所: ${customer.branch}</p>`;
        if (customer.equipType) html += `<p>⚙️ 型式: ${customer.equipType}</p>`;
        if (customer.filter) html += `<p>🔧 フィルター: ${customer.filter}</p>`;
        return html;
    }

    function showInfoWindow(marker, customer) {
        const esc = ExpenseImport.escapeHtml;
        const statusText = { pending: '未アポ', appointed: 'アポ済み', completed: '完了' };
        const rawId = customer.id;
        const actions = navLink(customer)+unitPanel(customer);
        const phones = VisitPlanner.phoneNumbers(customer.phone);
        customer = {...customer};
        Object.keys(customer).forEach(key=> { if(typeof customer[key]==='string' && !['appoDate','appoEndDate','status','routeId'].includes(key))customer[key]=esc(customer[key]); });
        if(Array.isArray(customer.floors))customer.floors=customer.floors.map(esc);
        const routes = markerRoutes(customer);
        const route = routes.find(r => r.id === customer.routeId);

        let html = `<div class="info-window">`;
        html += `<h3>${customer.company || '不明'}`;
        if (customer.unitCount > 1) html += ` <small>(${customer.unitCount}台)</small>`;
        html += `</h3>`;
        html += detailLines(customer);
        if (route) html += `<p>🗺️ ${esc(route.name)}</p>`;
        html += `<p>${statusText[customer.status] || statusText.pending}</p>`;
        if (customer.appoDate) {
            const d = new Date(customer.appoDate);
            const dateStr = esc(isNaN(d.getTime()) ? customer.appoDate : d.toLocaleString('ja-JP'));
            const end = VisitPlanner.endOf(customer);
            html += `<p>📅 ${dateStr}${end ? ' 〜 '+esc(end.replace('T',' ')) : ''}</p>`;
        }
        if (customer.note) html += `<p style="font-size:11px;color:#64748b;white-space:pre-wrap;">📝 ${customer.note}</p>`;
        if (customer.info) html += `<p style="font-size:11px;color:#64748b;">ℹ️ ${customer.info}</p>`;
        if (route && workspace()=== (customer.workspaceId || workspace()) && !DataStorage.isUndatedCombinedView?.()) {
            const currentRoute = routes.find(r => r.id === customer.routeId);
            const currentOrder = currentRoute && currentRoute.order ? currentRoute.order : [];
            const currentIdx = currentOrder.indexOf(rawId);
            const orderText = currentIdx >= 0 ? `${currentIdx + 1}番目` : '未設定';
            html += `<div class="info-visit-order">`;
            html += `<span>🔢 訪問順: ${orderText}</span>`;
            html += `<button class="info-btn info-btn-order" onclick="RouteOrder.startEdit(${esc(JSON.stringify(customer.routeId))})">並べ替え</button>`;
            html += `</div>`;
        }
        html += `<div class="info-actions">`;
        html += `<button class="info-btn info-btn-edit" onclick="MapCore.openEdit(${esc(JSON.stringify(rawId))})">日時・備考を編集</button>`;
        phones.forEach((phone,index)=> {html += `<a class="info-btn info-btn-call" href="tel:${esc(phone)}">電話${phones.length>1?' '+(index+1):''}</a>`;});
        html += actions + `</div></div>`;
        infoWindow.setContent(html);
        infoWindow.open(map, marker);
    }

    function clearMarkers() { markers.forEach(m => m.setMap(null)); markers = []; }

    function updateMarkerColor() { refreshAllMarkers(); }

    function updateCountBadge() {
        const customers = monthCustomers();
        document.getElementById('countBadge').textContent = `${customers.length}件`;
    }

    function updateCustomerList() {
        const all = viewCustomers();
        updateMapFilter(all);
        const customers=all.filter(visible);
        const routes = DataStorage.getRoutes();
        const listEl = document.getElementById('customerList');
        const combined = !todayOnly && DataStorage.isUndatedCombinedView?.();
        if (customers.length === 0) {
            if(todayOnly) {
                listEl.innerHTML='<div class="empty-msg">'+(completedOnly?'今日の完了した訪問はありません。':'今日の未完了の訪問はありません。')+'</div>';
                return;
            }
            if(completedOnly || all.length) {
                listEl.innerHTML='<div class="empty-msg">'+(completedOnly?'この表示範囲に完了した訪問はありません。':'この表示範囲に未完了の訪問はありません。地図上の「完了した訪問を見る」で確認できます。')+'</div>';
                return;
            }
            listEl.innerHTML = combined
                ? '<div class="empty-msg"><strong>日付が決まっていない訪問はありません</strong><br>各月で訪問日が入っているものは、その月を開くと見られます。</div>'
                : '<div class="empty-msg"><strong>この月の訪問先はまだありません</strong><br>「訪問先を追加」か「Excel・依頼書を取り込む」で<br>準備を始めましょう。</div>';
            return;
        }
        const esc = ExpenseImport.escapeHtml;
        const statuses = { pending: '未アポ', appointed: 'アポ済み', completed: '訪問完了' };
        let html = combined ? '<p class="summary-note">日付が決まっていない訪問を、全部の月から表示しています（完了は除く）。元の月からは動かしていません。</p>' : '';
        for (const c of customers) {
            const rowRoutes = todayOnly ? markerRoutes(c) : combined ? [] : routes;
            const route = rowRoutes.find(r => r.id === c.routeId);
            const status = statuses[c.status] ? c.status : 'pending';
            const undated = typeof DataStorage.hasVisitDate === 'function' ? !DataStorage.hasVisitDate(c) : !c.appoDate;
            html += `<button type="button" class="customer-item" data-customer-id="${esc(c.id)}">`;
            html += `${RoutePinStyle.swatch(RoutePinStyle.visitStyle(c,rowRoutes,pinMonth()))}`;
            html += `<span class="customer-info">`;
            html += `<span class="customer-name">${esc(c.company || '不明')}`;
            html += `</span>`;
            if (c.managementNo) html += `<span class="customer-unit-no">${esc(c.managementNo)}</span>`;
            html += `<span class="customer-address">${esc(c.address || '')}`;
            if (Array.isArray(c.floors) && c.floors.length > 0) html += ` · ${esc(c.floors.join(','))}`;
            html += `</span><span class="customer-meta">${statuses[status]} · ${esc(route ? route.name : 'ルート未割当')}`;
            if (combined && c.workspaceId && DataStorage.workspaceTag) html += ` · <span class="visit-ws-tag">${esc(DataStorage.workspaceTag(c.workspaceId))}</span>`;
            if(todayOnly)html+=` · <strong class="today-row-time">${esc(TodayVisits.timeText(c,today.day,VisitPlanner))}</strong>`;
            const schedule = RequestParser.scheduleLabel(c);
            html += ` · <span class="${undated || c.dateNeedsReview ? 'visit-undated-tag':'visit-ws-tag'}">${esc(schedule)}</span>`;
            html += `</span></span>`;
            if (c.unitCount > 1) html += `<span class="customer-count">${c.unitCount}台</span>`;
            html += `</button>`;
        }
        listEl.innerHTML = html;
    }

    // 一覧で押した行を目立たせる(訪問先一覧・ルートの行)。
    function markSelected(customerId) {
        document.querySelectorAll('.list-selected').forEach(el => { el.classList.remove('list-selected'); el.removeAttribute('aria-current'); });
        document.querySelectorAll('[data-customer-id],[data-stop-id]').forEach(el => {
            if ((el.dataset.customerId || el.dataset.stopId) === customerId) { el.classList.add('list-selected'); el.setAttribute('aria-current', 'true'); }
        });
    }
    // 長い一覧の下の方で押しても、地図が見える位置まで戻す(動きを減らす設定なら一瞬で)。
    // 画面に固定されたヘッダー/下のナビを除いた「見える範囲」を求める
    function visibleBand() {
        let top = 0, bottom = innerHeight;
        document.querySelectorAll('body *').forEach(el => {
            const st = getComputedStyle(el);
            if (st.position !== 'fixed' && st.position !== 'sticky') return;
            if (st.display === 'none' || st.visibility === 'hidden') return;
            const b = el.getBoundingClientRect();
            if (!b.height || b.width < innerWidth / 2 || b.height > innerHeight / 3) return;
            if (b.top <= 1 && b.bottom > 0) top = Math.max(top, b.bottom);
            else if (b.bottom >= innerHeight - 1 && b.top < innerHeight) bottom = Math.min(bottom, b.top);
        });
        return { top, bottom };
    }
    function revealMap() {
        if (document.body.classList.contains('map-focus')) return;
        const canvas = document.querySelector('.map-canvas');
        if (!canvas || !canvas.getBoundingClientRect) return;
        const r = canvas.getBoundingClientRect();
        const { top, bottom } = visibleBand();
        const avail = bottom - top;
        // 入るなら見える範囲の真ん中に、入らないならヘッダーのすぐ下に上端を合わせる
        const want = r.height <= avail ? top + (avail - r.height) / 2 : top + 8;
        if (Math.abs(r.top - want) < 4) return;
        const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: Math.max(0, scrollY + r.top - want), behavior: reduce ? 'auto' : 'smooth' });
    }
    function focusMarker(customerId) {
        if(todayOnly && !viewCustomers().some(c=>c.id===customerId) && monthCustomers().some(c=>c.id===customerId)) {
            todayOnly=false; refreshAllMarkers();
        }
        const picked=viewCustomers().find(c=>c.id===customerId);
        if(picked && !visible(picked))setCompletedMode(picked.status==='completed',{fit:false});
        const marker = findMarker(picked || findView(customerId));
        markSelected(customerId);
        if (marker) {
            const old = document.getElementById('listPickCard'); if (old) old.remove();
            revealMap();
            map.setZoom(16);
            map.panTo(marker.getPosition());
            showInfoWindow(marker,picked || marker.customData);
        } else {
            // 地図が無い/位置が無いときは編集を開かず、地図の場所に簡単な情報カードを出す
            revealMap();
            const c = findView(customerId);
            if (map && geocoder && c && c.address && !hasPosition(c) && !guard.failed()) locateAndFocus(customerId);
            else showPickCard(customerId);
        }
    }

    function showPickCard(customerId, state) {
        const customer = findView(customerId);
        const host = document.querySelector('.map-canvas');
        if (!customer || !host) return;
        const esc = ExpenseImport.escapeHtml;
        const statusText = { pending: '未アポ', appointed: 'アポ済み', completed: '完了' };
        const route = markerRoutes(customer).find(r => r.id === customer.routeId);
        const noMap = typeof google === 'undefined' || !map || !geocoder;
        const msgs = {
            busy: '📍 住所から地図の位置を探しています…',
            none: '地図の位置が見つかりませんでした。通信が不安定なら「📍 地図の位置を取得」をもう一度、続くときは住所の書き方（番地・建物名）を編集で確かめてください。',
            nomap: '地図を表示できないため、位置は出せません。'
        };
        const why = noMap ? msgs.nomap : (msgs[state] || 'この訪問先はまだ地図の位置がありません。');
        const canLocate = !noMap && state !== 'busy' && !guard.failed() && customer.address;
        let card = document.getElementById('listPickCard');
        if (!card) { card = document.createElement('div'); card.id = 'listPickCard'; card.className = 'list-pick-card'; card.setAttribute('role', 'status'); host.appendChild(card); }
        card.innerHTML = `<button type="button" class="list-pick-close" aria-label="閉じる" onclick="this.parentNode.remove()">×</button>`
            + `<div class="list-pick-title">${esc(customer.company || '')}</div>`
            + (() => { const c = {...customer}; Object.keys(c).forEach(k => { if (typeof c[k] === 'string') c[k] = esc(c[k]); }); if (Array.isArray(c.floors)) c.floors = c.floors.map(esc); return detailLines(c); })()
            + (route ? `<div>🗺️ ${esc(route.name || '')}</div>` : '')
            + `<div>${esc(statusText[customer.status] || '')} · ${esc(RequestParser.scheduleLabel(customer))}</div>`
            + `<div class="list-pick-note">${why}</div>`
            + (canLocate ? `<button type="button" class="info-btn info-btn-locate" onclick="MapCore.locateAndFocus(${esc(JSON.stringify(customer.id))})">📍 地図の位置を取得</button>` : '')
            + `<button type="button" class="info-btn info-btn-edit" onclick="MapCore.openEdit(${esc(JSON.stringify(customer.id))})">日時・備考を編集</button>`
            + navLink(customer) + unitPanel(customer);
    }

    function openEdit(customerId) {
        const customer = findView(customerId);
        if (!customer) return;
        if (typeof restoreEditButtons === 'function') restoreEditButtons();
        currentEditId = customerId;
        document.getElementById('editCompany').value = customer.company || '';
        document.getElementById('editAddress').value = customer.address || '';
        document.getElementById('editPhone').value = customer.phone || '';
        document.getElementById('editContact').value = customer.contact || '';
        document.getElementById('editNote').value = customer.note || '';
        document.getElementById('editStatus').value = customer.status || 'pending';
        document.getElementById('editAppoDate').value = customer.appoDate || '';
        const schedule = document.getElementById('editScheduleKind');
        if (schedule) schedule.value = Object.hasOwn(RequestParser.scheduleLabels, customer.scheduleKind) ? customer.scheduleKind : customer.appoDate ? 'unknown' : 'undated';
        const dateWarning = document.getElementById('visitDateSourceWarning');
        if (dateWarning) dateWarning.hidden = !customer.dateNeedsReview;
        document.getElementById('editPurpose').value = customer.purpose || '';
        const routes = markerRoutes(customer);
        const routeSelect = document.getElementById('editRoute');
        const routeRow = routeSelect && routeSelect.closest('.modal-row');
        const combined = typeof DataStorage.isUndatedCombinedView === 'function' && DataStorage.isUndatedCombinedView();
        if (combined || (customer.workspaceId && customer.workspaceId!==workspace())) {
            routeSelect.innerHTML = '<option value="">（この一覧ではルートは変えられません）</option>';
            routeSelect.disabled = true;
            if (routeRow) routeRow.hidden = true;
        } else {
            routeSelect.disabled = false;
            if (routeRow) routeRow.hidden = false;
            routeSelect.innerHTML = '<option value="">未割当</option>';
            routes.forEach(r => {
                routeSelect.innerHTML += `<option value="${ExpenseImport.escapeHtml(r.id)}" ${customer.routeId === r.id ? 'selected' : ''}>${ExpenseImport.escapeHtml(r.name)}</option>`;
            });
        }
        if (typeof VisitPlanner !== 'undefined') VisitPlanner.begin(customer);
        document.getElementById('editModal').style.display = 'flex';
        if (infoWindow) infoWindow.close();
    }

    function refreshAllMarkers({fit=false}={}) {
        syncMapWorkspace();
        readToday();
        const customers = viewCustomers();
        infoWindow?.close();
        document.getElementById('listPickCard')?.remove?.();
        clearMarkers();
        if (!map) { updateCountBadge(); updateCustomerList(); return; }
        const cache = DataStorage.getGeoCache();
        for (const c of customers) {
            const cached = cache[c.address];
            if (cached) { createMarker(c, new google.maps.LatLng(cached.lat, cached.lng)); }
            else if (c.lat && c.lng) { createMarker(c, new google.maps.LatLng(c.lat, c.lng)); }
        }
        updateCountBadge();
        updateCustomerList();
        // Gmail取り込み・同期・月切替の後も、位置が無い訪問先は裏で位置を取る
        fitAfterLocation(fit,customers);
    }

    function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    // --- 位置が無い訪問先の位置取り（Gmail取り込み・同期・月切替の後でも付ける） ---
    const locateTried = new Set();   // この起動中に試して見つからなかった住所（何度も呼ばない）
    const locating = new Set();
    let locateRunning = null;
    function hasPosition(c) {
        const cache = DataStorage.getGeoCache();
        return !!(cache[c.address] || (c.lat && c.lng));
    }
    function missingPosition(customers) {
        return [...new Map((customers || []).filter(c => c && c.address && !findMarker(c) && !hasPosition(c)).map(c=>[siteKey(c),c])).values()];
    }
    // 1件の位置を取って保存する。戻り値: 'ok' | 'none'(見つからない・時間切れ) | 'nomap'
    async function locateOne(customer) {
        if (!map || !geocoder || guard.failed()) return 'nomap';
        if (hasPosition(customer)) return 'ok';
        const latLng = await guard.run(() => geocodeAddressAsync(customer.address));
        if (!latLng) { if (guard.failed()) return 'nomap'; locateTried.add(customer.address); return 'none'; }
        DataStorage.setGeoCache(customer.address, { lat: latLng.lat(), lng: latLng.lng() });
        DataStorage.updateCustomer(customer.id, { lat: latLng.lat(), lng: latLng.lng() });
        createCurrentMarker(customer,latLng);
        return 'ok';
    }
    // まとめて取る（画面は止めない）。試して見つからなかった住所はこの起動中は飛ばす
    function locateMissing(customers, { retry = false } = {}) {
        const list = missingPosition(customers || viewCustomers())
            .filter(c => (retry || !locateTried.has(c.address)) && !locating.has(c.id));
        if (!list.length || !map || !geocoder) return locateRunning || Promise.resolve({ ok: 0, none: 0 });
        list.forEach(c => locating.add(c.id));
        const prev = locateRunning || Promise.resolve();
        const run = prev.then(async () => {
            const res = { ok: 0, none: 0 };
            for (const c of list) {
                const r = await locateOne(c);
                locating.delete(c.id);
                if (r === 'ok') res.ok++; else res.none++;
                if (r === 'nomap') break;
                await sleep(200);
            }
            list.forEach(c => locating.delete(c.id));
            if (res.ok) { updateCountBadge(); updateCustomerList(); }
            return res;
        });
        locateRunning = run.finally(() => { if (locateRunning === run) locateRunning = null; });
        return run;
    }
    // 情報カードの「📍 地図の位置を取得」
    async function locateAndFocus(customerId) {
        const customer = findView(customerId);
        if (!customer) return;
        showPickCard(customerId, 'busy');
        const r = await locateOne(customer);
        const marker = findMarker(customer);
        if (r === 'ok' && marker) { updateCountBadge(); updateCustomerList(); focusMarker(customerId); }
        else showPickCard(customerId, r);
    }

    return {
        initMap, mapFailed, geocodeAndPlot, plotAllMarkers, clearMarkers,
        createMarker, updateMarkerColor, focusMarker,
        openEdit, openCompletion, confirmCompletion, refreshAllMarkers, locateMissing, locateAndFocus,
        updateCountBadge, updateCustomerList, toggleCompleted, toggleToday, refreshTodayClock,
        getCurrentEditId: () => currentEditId,
        getMap: () => map, getMarkers: () => markers
    };
})();

// Google Maps はキーが無効なとき window.gm_authFailure を呼ぶ。
if (typeof window !== 'undefined') {
    window.gm_authFailure = function () { MapCore.mapFailed('auth'); };
    if(window.addEventListener) {
        for(const name of ['online','offline','focus'])window.addEventListener(name,MapCore.refreshTodayClock);
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)MapCore.refreshTodayClock();});
        window.setInterval(()=>{if(!document.hidden)MapCore.refreshTodayClock();},30000);
    }
}
function initMap() {
    MapCore.initMap();
}

