// Expand the existing map; never recreate it or recalculate routes on a layout change.
const MapWorkspace = (() => {
    let expanded = false, listOpen = false, returnFocus;
    const byId = id => document.getElementById(id);
    function resizeMap() {
        const map = MapCore.getMap();
        const center = map?.getCenter();
        requestAnimationFrame(() => { if (center) map.setCenter(center); });
    }
    function toggle(force) {
        expanded = typeof force === 'boolean' ? force : !expanded;
        const layout = byId('visitLayout');
        if (expanded) returnFocus = document.activeElement;
        document.body.classList.toggle('map-focus', expanded);
        byId('mapExpandButton').setAttribute('aria-expanded', String(expanded));
        byId('mapExpandButton').textContent = expanded ? '通常表示に戻す' : '地図を大きく';
        byId('mapListButton').hidden = !expanded;
        layout.classList.toggle('map-list-open', expanded && listOpen);
        if (expanded) {
            layout.setAttribute('role','dialog'); layout.setAttribute('aria-modal','true');
            layout.setAttribute('aria-label','大きな地図で訪問ルートを決める');
            byId('mapExpandButton').focus({preventScroll:true});
        } else {
            ['role','aria-modal','aria-label'].forEach(key=>layout.removeAttribute(key));
            returnFocus?.focus({preventScroll:true});
        }
        resizeMap();
    }
    function toggleList() {
        listOpen = !listOpen;
        byId('visitLayout').classList.toggle('map-list-open', listOpen);
        byId('mapListButton').setAttribute('aria-expanded', String(listOpen));
        byId('mapListButton').textContent = listOpen ? '一覧を閉じる' : '訪問先・ルート';
        resizeMap();
    }
    function init() {
        byId('mapExpandButton').addEventListener('click',()=>toggle());
        byId('mapQuickExpand').addEventListener('click',()=>toggle(true));
        byId('mapListButton').addEventListener('click',toggleList);
        document.addEventListener('app:tabchange',event=> { if (event.detail !== 'map' && expanded) toggle(false); });
        document.addEventListener('keydown',event=> {
            if (!expanded || document.querySelector('.modal-overlay[style*="flex"], .ro-modal-overlay, #segmentDialog')) return;
            if (event.key === 'Escape') { event.preventDefault(); toggle(false); }
            if (event.key === 'Tab') {
                const items = [...byId('visitLayout').querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')]
                    .filter(el=>!el.disabled && el.getClientRects().length);
                const first=items[0], last=items[items.length-1];
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        });
    }
    return {init,toggle};
})();
