// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.2.2 - route-order.js
// ルート訪問順管理（ドラッグ&ドロップ＋区間道路種別）
// v2.2新規作成 → v2.2.1ドロップダウン化 → v2.2.2ドラッグ&ドロップ復活
// ポップアップの「並べ替え」ボタンからモーダルを開く方式
// ============================================

const RouteOrder = (() => {
    let editingRouteId = null;

    function startEdit(routeId) {
        editingRouteId = routeId;
        renderSortableList(routeId);
    }

    function renderSortableList(routeId) {
        const routes = DataStorage.getRoutes();
        const route = routes.find(r => r.id === routeId);
        const customers = DataStorage.getCustomers();
        const members = customers.filter(c => c.routeId === routeId);
        if (members.length === 0) return;
        const ordered = [];
        if (route.order && route.order.length > 0) {
            for (const cid of route.order) {
                const found = members.find(m => m.id === cid);
                if (found) ordered.push(found);
            }
            for (const m of members) {
                if (!ordered.find(o => o.id === m.id)) ordered.push(m);
            }
        } else { ordered.push(...members); }

        let html = '<div class="ro-modal-overlay" id="routeOrderModal"><div class="ro-modal">';
        html += `<h3>🔢 ${route.name} の訪問順</h3>`;
        html += '<p class="ro-hint">長押しでドラッグして順番を変更</p>';
        html += '<div class="ro-list" id="roSortList">';
        ordered.forEach((m, idx) => {
            html += `<div class="ro-item" data-id="${m.id}" draggable="true">`;
            html += `<span class="ro-num">${idx + 1}</span><span class="ro-grip">☰</span>`;
            html += `<span class="ro-name">${m.company || '不明'}${m.unitCount > 1 ? ` (${m.unitCount}台)` : ''}</span></div>`;
        });
        html += '</div><div class="ro-actions">';
        html += '<button class="ro-btn ro-btn-cancel" onclick="RouteOrder.cancelEdit()">キャンセル</button>';
        html += '<button class="ro-btn ro-btn-save" onclick="RouteOrder.saveOrder()">✅ 保存</button>';
        html += '</div></div></div>';

        const existing = document.getElementById('routeOrderModal');
        if (existing) existing.remove();
        document.body.insertAdjacentHTML('beforeend', html);
        initDragAndDrop();
    }

    function initDragAndDrop() {
        const list = document.getElementById('roSortList');
        if (!list) return;
        let dragItem = null;
        list.addEventListener('dragstart', (e) => {
            dragItem = e.target.closest('.ro-item');
            if (!dragItem) return;
            dragItem.classList.add('ro-dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            const target = e.target.closest('.ro-item');
            if (target && target !== dragItem) {
                const rect = target.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) list.insertBefore(dragItem, target);
                else list.insertBefore(dragItem, target.nextSibling);
            }
        });
        list.addEventListener('dragend', () => {
            if (dragItem) dragItem.classList.remove('ro-dragging');
            dragItem = null; updateNumbers();
        });
        let touchItem = null;
        list.addEventListener('touchstart', (e) => {
            const item = e.target.closest('.ro-item');
            if (!item) return;
            touchItem = item; touchItem.classList.add('ro-dragging');
        }, { passive: true });
        list.addEventListener('touchmove', (e) => {
            if (!touchItem) return;
            e.preventDefault();
            const touchY = e.touches[0].clientY;
            const items = [...list.querySelectorAll('.ro-item:not(.ro-dragging)')];
            for (const item of items) {
                const rect = item.getBoundingClientRect();
                const mid = rect.top + rect.height / 2;
                if (touchY < mid) { list.insertBefore(touchItem, item); break; }
                if (item === items[items.length - 1] && touchY >= mid) list.appendChild(touchItem);
            }
        }, { passive: false });
        list.addEventListener('touchend', () => {
            if (touchItem) touchItem.classList.remove('ro-dragging');
            touchItem = null; updateNumbers();
        });
    }

    function updateNumbers() {
        const items = document.querySelectorAll('#roSortList .ro-item');
        items.forEach((item, idx) => { item.querySelector('.ro-num').textContent = idx + 1; });
    }

    function saveOrder() {
        if (!editingRouteId) return;
        const items = document.querySelectorAll('#roSortList .ro-item');
        const order = [...items].map(item => item.dataset.id);
        DataStorage.updateRouteOrder(editingRouteId, order);
        cancelEdit(); RouteManager.updateRoutePanel();
        alert('✅ 訪問順を保存しました！');
    }

    function cancelEdit() {
        editingRouteId = null;
        const modal = document.getElementById('routeOrderModal');
        if (modal) modal.remove();
    }

    function showSegmentEditor(routeId, order) {
        if (!routeId || !order || order.length < 2) return;
        const customers = DataStorage.getCustomers();
        const segments = DataStorage.getSegments();
        const routeSegments = segments[routeId] || {};
        let html = '<div class="ro-modal-overlay" id="segmentEditorModal"><div class="ro-modal">';
        html += '<h3>🛣️ 区間の道路種別</h3><p class="ro-hint">各区間で「高速」「下道」を選択</p>';
        html += '<div class="seg-list">';
        for (let i = 0; i < order.length - 1; i++) {
            const fromC = customers.find(c => c.id === order[i]);
            const toC = customers.find(c => c.id === order[i + 1]);
            if (!fromC || !toC) continue;
            const segKey = `${order[i]}_${order[i + 1]}`;
            const currentType = routeSegments[segKey] || 'general';
            const fromName = (fromC.company || '不明').substring(0, 10);
            const toName = (toC.company || '不明').substring(0, 10);
            html += `<div class="seg-item"><div class="seg-label">${i + 1}. ${fromName} → ${toName}</div>`;
            html += `<div class="seg-toggle">`;
            html += `<button class="seg-btn ${currentType === 'general' ? 'seg-btn-active' : ''}" onclick="RouteOrder.setSegType('${segKey}','general',this)">🚗 下道</button>`;
            html += `<button class="seg-btn ${currentType === 'highway' ? 'seg-btn-active' : ''}" onclick="RouteOrder.setSegType('${segKey}','highway',this)">🛣️ 高速</button>`;
            html += `</div></div>`;
        }
        html += '</div><div class="ro-actions">';
        html += '<button class="ro-btn ro-btn-cancel" onclick="RouteOrder.closeSegmentEditor()">閉じる</button>';
        html += '<button class="ro-btn ro-btn-save" onclick="RouteOrder.saveSegments()">✅ 保存</button>';
        html += '</div></div></div>';
        RouteOrder._segRouteId = routeId;
        RouteOrder._segData = { ...routeSegments };
        const existing = document.getElementById('segmentEditorModal');
        if (existing) existing.remove();
        document.body.insertAdjacentHTML('beforeend', html);
    }

    function setSegType(segKey, type, btn) {
        RouteOrder._segData[segKey] = type;
        const parent = btn.parentElement;
        parent.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('seg-btn-active'));
        btn.classList.add('seg-btn-active');
    }

    function saveSegments() {
        const routeId = RouteOrder._segRouteId;
        if (!routeId) return;
        const allSegments = DataStorage.getSegments();
        allSegments[routeId] = RouteOrder._segData;
        DataStorage.saveSegments(allSegments);
        closeSegmentEditor();
        alert('✅ 区間の道路種別を保存しました！');
    }

    function closeSegmentEditor() {
        const modal = document.getElementById('segmentEditorModal');
        if (modal) modal.remove();
    }

    return {
        startEdit, saveOrder, cancelEdit,
        showSegmentEditor, setSegType, saveSegments, closeSegmentEditor
    };
})();
