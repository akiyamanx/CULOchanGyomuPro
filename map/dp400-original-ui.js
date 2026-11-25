// マップ画面の「原本を見る」。DP-400月次リストの原本を端末内から表示する。
// 表のセルは textContent で入れる(ファイルの値をHTMLとして解釈しない)。ログに中身は出さない。
// 開いたときは表全体が画面に収まる縮小表示。ピンチと＋−で拡大縮小、拡大時はドラッグで移動できる。
const Dp400OriginalUI = (() => {
    let overlay, monthSel, filesEl, viewEl, statusEl, downloadBtn, fetchBtn, closeBtn, objectUrl = '', abort = null, currentId = '';
    let zoomInBtn, zoomOutBtn, zoomFitBtn;
    let vpEl = null, surfaceEl = null, ro = null;
    let zoom = { scale: 1, tx: 0, ty: 0, fit: 1, cw: 0, ch: 0, vw: 0, vh: 0 };
    const pointers = new Map();
    let pinch = null, pan = null;

    const vpMath = () => (typeof Dp400Original !== 'undefined' && Dp400Original.viewport) ? Dp400Original.viewport : null;

    const say = (text, kind) => {
        if (!statusEl) return;
        statusEl.textContent = text || '';
        statusEl.dataset.kind = kind || '';
    };
    function currentWorkspaceMonth() {
        try {
            if (typeof DataStorage !== 'undefined' && DataStorage.getCurrentWorkspaceId) {
                const id = DataStorage.getCurrentWorkspaceId();
                if (/^\d{4}-(0[1-9]|1[0-2])$/.test(id)) return id;
            }
        } catch (e) { /* 月が取れなくても選択できる */ }
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
        return parts.find(p => p.type === 'year').value + '-' + parts.find(p => p.type === 'month').value;
    }
    function labelMonth(id) {
        const m = String(id || '').match(/^(\d{4})-(\d{2})$/);
        return m ? m[1] + '年' + Number(m[2]) + '月' : String(id || '');
    }
    function revoke() {
        if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch (e) { /* 無視 */ } objectUrl = ''; }
    }
    function gmailSource() {
        if (typeof MailBoxUI !== 'undefined' && typeof MailBoxUI.gmailIfConnected === 'function') return MailBoxUI.gmailIfConnected();
        return null;
    }
    function setZoomEnabled(on) {
        [zoomInBtn, zoomOutBtn, zoomFitBtn].forEach(btn => { if (btn) btn.disabled = !on; });
    }
    function clearViewport() {
        if (ro) { try { ro.disconnect(); } catch (e) { /* 無視 */ } ro = null; }
        pointers.clear();
        pinch = null;
        pan = null;
        vpEl = null;
        surfaceEl = null;
        setZoomEnabled(false);
    }
    function applyTransform() {
        if (!surfaceEl) return;
        surfaceEl.style.transform = 'translate(' + zoom.tx + 'px, ' + zoom.ty + 'px) scale(' + zoom.scale + ')';
    }
    function localPoint(clientX, clientY) {
        const r = vpEl.getBoundingClientRect();
        return { x: clientX - r.left, y: clientY - r.top };
    }
    function measureAndFit(reset) {
        const math = vpMath();
        if (!vpEl || !surfaceEl || !math) return;
        const r = vpEl.getBoundingClientRect();
        zoom.vw = r.width;
        zoom.vh = r.height;
        zoom.cw = Math.max(surfaceEl.scrollWidth, surfaceEl.offsetWidth, 1);
        zoom.ch = Math.max(surfaceEl.scrollHeight, surfaceEl.offsetHeight, 1);
        const fit = math.fitScale(zoom.cw, zoom.ch, zoom.vw, zoom.vh);
        const wasFit = Math.abs(zoom.scale - zoom.fit) < 0.02;
        zoom.fit = fit;
        if (reset || wasFit) {
            zoom.scale = fit;
            const p = math.clampPan(0, 0, fit, zoom.cw, zoom.ch, zoom.vw, zoom.vh);
            zoom.tx = p.x;
            zoom.ty = p.y;
        } else {
            zoom.scale = math.clampScale(zoom.scale, fit);
            const p = math.clampPan(zoom.tx, zoom.ty, zoom.scale, zoom.cw, zoom.ch, zoom.vw, zoom.vh);
            zoom.tx = p.x;
            zoom.ty = p.y;
        }
        applyTransform();
    }
    function afterLayout(fn) {
        requestAnimationFrame(() => requestAnimationFrame(fn));
    }
    function watchViewport() {
        if (ro) { try { ro.disconnect(); } catch (e) { /* 無視 */ } ro = null; }
        if (typeof ResizeObserver === 'undefined' || !vpEl) return;
        ro = new ResizeObserver(() => { if (vpEl) measureAndFit(false); });
        ro.observe(vpEl);
    }
    function mountViewport() {
        clearViewport();
        viewEl.replaceChildren();
        const vp = document.createElement('div');
        vp.className = 'dp400-viewport';
        vp.id = 'dp400Viewport';
        const surface = document.createElement('div');
        surface.className = 'dp400-viewport-surface';
        vp.appendChild(surface);
        viewEl.appendChild(vp);
        vpEl = vp;
        surfaceEl = surface;
        zoom = { scale: 1, tx: 0, ty: 0, fit: 1, cw: 0, ch: 0, vw: 0, vh: 0 };
        setZoomEnabled(true);
        watchViewport();
        return surface;
    }
    function setScaleAt(next, cx, cy) {
        const math = vpMath();
        if (!math || !vpEl) return;
        const clamped = math.clampScale(next, zoom.fit);
        const z = math.zoomAt(zoom.tx, zoom.ty, zoom.scale, clamped, cx, cy);
        const p = math.clampPan(z.tx, z.ty, z.scale, zoom.cw, zoom.ch, zoom.vw, zoom.vh);
        zoom.scale = z.scale;
        zoom.tx = p.x;
        zoom.ty = p.y;
        applyTransform();
    }
    function zoomBy(dir) {
        const math = vpMath();
        if (!math || !vpEl) return;
        setScaleAt(math.stepScale(zoom.scale, dir, zoom.fit), zoom.vw / 2, zoom.vh / 2);
    }
    function fitAll() {
        measureAndFit(true);
    }
    function onPointerDown(ev) {
        if (!vpEl || !vpEl.contains(ev.target)) return;
        ev.preventDefault();
        try { vpEl.setPointerCapture(ev.pointerId); } catch (e) { /* 無視 */ }
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        if (pointers.size >= 2) {
            const pts = [...pointers.values()];
            const math = vpMath();
            pinch = {
                startScale: zoom.scale,
                startDist: math.distance(pts[0], pts[1]),
                startTx: zoom.tx,
                startTy: zoom.ty,
                origin: localPoint(((pts[0].x + pts[1].x) / 2), ((pts[0].y + pts[1].y) / 2))
            };
            pan = null;
            vpEl.classList.add('is-panning');
        } else {
            pan = { x: ev.clientX, y: ev.clientY, tx: zoom.tx, ty: zoom.ty };
            pinch = null;
            vpEl.classList.add('is-panning');
        }
    }
    function onPointerMove(ev) {
        if (!pointers.has(ev.pointerId) || !vpEl) return;
        ev.preventDefault();
        pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        const math = vpMath();
        if (!math) return;
        if (pinch && pointers.size >= 2) {
            const pts = [...pointers.values()];
            const dist = math.distance(pts[0], pts[1]);
            const mid = localPoint((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2);
            const next = math.pinchScale(pinch.startScale, pinch.startDist, dist, zoom.fit);
            const z = math.zoomAt(pinch.startTx, pinch.startTy, pinch.startScale, next, pinch.origin.x, pinch.origin.y);
            z.tx += mid.x - pinch.origin.x;
            z.ty += mid.y - pinch.origin.y;
            const p = math.clampPan(z.tx, z.ty, z.scale, zoom.cw, zoom.ch, zoom.vw, zoom.vh);
            zoom.scale = z.scale;
            zoom.tx = p.x;
            zoom.ty = p.y;
            applyTransform();
        } else if (pan && pointers.size === 1) {
            const p = math.clampPan(pan.tx + (ev.clientX - pan.x), pan.ty + (ev.clientY - pan.y), zoom.scale, zoom.cw, zoom.ch, zoom.vw, zoom.vh);
            zoom.tx = p.x;
            zoom.ty = p.y;
            applyTransform();
        }
    }
    function onPointerUp(ev) {
        if (!pointers.has(ev.pointerId)) return;
        pointers.delete(ev.pointerId);
        if (pointers.size < 2) pinch = null;
        if (pointers.size === 1) {
            const pt = [...pointers.values()][0];
            pan = { x: pt.x, y: pt.y, tx: zoom.tx, ty: zoom.ty };
        } else {
            pan = null;
            if (vpEl) vpEl.classList.remove('is-panning');
        }
    }
    function onWheel(ev) {
        if (!vpEl || !vpEl.contains(ev.target)) return;
        ev.preventDefault();
        const math = vpMath();
        if (!math) return;
        const factor = ev.deltaY < 0 ? 1.08 : (1 / 1.08);
        const loc = localPoint(ev.clientX, ev.clientY);
        setScaleAt(zoom.scale * factor, loc.x, loc.y);
    }
    async function refreshMonths(prefer) {
        const months = await Dp400Original.listMonths();
        const pick = prefer || currentWorkspaceMonth();
        const ids = months.slice();
        if (pick && !ids.includes(pick)) ids.unshift(pick);
        if (!ids.length) ids.push(pick);
        monthSel.replaceChildren();
        ids.forEach(id => {
            const opt = document.createElement('option');
            opt.value = id;
            opt.textContent = labelMonth(id);
            monthSel.appendChild(opt);
        });
        monthSel.value = ids.includes(pick) ? pick : ids[0];
        await showMonth(monthSel.value);
    }
    async function showMonth(monthId) {
        revoke();
        currentId = '';
        filesEl.replaceChildren();
        clearViewport();
        viewEl.replaceChildren();
        downloadBtn.disabled = true;
        const list = await Dp400Original.listForMonth(monthId);
        if (!list.length) {
            const p = document.createElement('p');
            p.className = 'dp400-empty';
            p.textContent = 'この月の原本は、まだこの端末にありません。メールBOXでGoogleにつないだあと、「メールから原本を取り込む」を押すと、リストの添付だけを保存します（訪問先の再登録はしません）。これからメールを「読み込む」分は、自動で残ります。';
            viewEl.appendChild(p);
            say('', '');
            return;
        }
        list.forEach((item, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary dp400-file-tab' + (i === 0 ? ' is-active' : '');
            btn.textContent = item.extra ? (labelMonth(monthId) + 'の追加リスト') : (labelMonth(monthId) + 'のリスト');
            if (list.length > 1 && item.extra) btn.textContent += list.length > 2 ? ' (' + (i + 1) + ')' : '';
            btn.addEventListener('click', () => {
                filesEl.querySelectorAll('.dp400-file-tab').forEach(b => b.classList.remove('is-active'));
                btn.classList.add('is-active');
                openFile(item.id);
            });
            filesEl.appendChild(btn);
        });
        await openFile(list[0].id);
    }
    async function openFile(id) {
        revoke();
        currentId = id;
        const rec = await Dp400Original.get(id);
        clearViewport();
        viewEl.replaceChildren();
        if (!rec || !rec.bytes) { say('原本を開けませんでした。', 'warn'); downloadBtn.disabled = true; return; }
        downloadBtn.disabled = false;
        say('', '');
        const bytes = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes);
        if (rec.kind === 'pdf') {
            const blob = new Blob([bytes], { type: 'application/pdf' });
            objectUrl = URL.createObjectURL(blob);
            const frame = document.createElement('iframe');
            frame.className = 'dp400-pdf';
            frame.title = '原本のプレビュー';
            frame.src = objectUrl;
            viewEl.appendChild(frame);
            return;
        }
        const parsed = Dp400Original.rowsFromBytes(bytes, rec.kind, rec.fileName);
        if (!parsed.ok) {
            const p = document.createElement('p');
            p.className = 'dp400-empty';
            p.textContent = 'このファイルは表として表示できません。「このファイルを保存」から原本を開けます。';
            viewEl.appendChild(p);
            return;
        }
        const surface = mountViewport();
        Dp400Original.fillTable(surface, parsed.sheets);
        afterLayout(() => measureAndFit(true));
    }
    function downloadCurrent() {
        if (!currentId) return;
        Dp400Original.get(currentId).then(rec => {
            if (!rec || !rec.bytes) return;
            const bytes = rec.bytes instanceof Uint8Array ? rec.bytes : new Uint8Array(rec.bytes);
            const blob = new Blob([bytes], { type: rec.mime || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = rec.fileName || 'dp400-list.xls';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        }).catch(() => say('保存できませんでした。', 'warn'));
    }
    async function fetchNow() {
        const g = gmailSource();
        if (!g || !g.source) { say('先にメールBOXの「Googleにつなぐ」を押してください。', 'warn'); return; }
        if (abort) return;
        abort = new AbortController();
        fetchBtn.disabled = true;
        say('メールから原本を探しています…', '');
        let r;
        try { r = await Dp400Original.fetchFromGmail({ source: g.source, signal: abort.signal, onProgress: p => { say('メールを確認中 ' + p.done + '/' + p.total, ''); } }); }
        catch (e) { r = { ok: false, code: (e && e.code) || 'network', saved: 0 }; }
        abort = null;
        fetchBtn.disabled = false;
        if (!r.ok && r.code === 'not_connected') say('先にメールBOXの「Googleにつなぐ」を押してください。', 'warn');
        else if (!r.ok && r.code === 'aborted') say('取り込みを中止しました。', '');
        else if (!r.ok) say('原本を取得できませんでした。通信状態を確認して、もう一度お試しください。', 'error');
        else if (r.saved) say(r.saved + '件の原本を保存しました。', 'ok');
        else say('新しい原本はありませんでした（すでに保存済みか、条件に合う添付がありません）。', '');
        await refreshMonths(monthSel && monthSel.value);
    }
    function open() {
        if (!overlay) return;
        overlay.hidden = false;
        overlay.style.display = 'flex';
        document.body.classList.add('dp400-original-open');
        refreshMonths(currentWorkspaceMonth()).catch(() => say('原本の一覧を読めませんでした。', 'error'));
        const title = document.getElementById('dp400OriginalTitle');
        if (title) title.focus();
    }
    function close() {
        if (abort) { try { abort.abort(); } catch (e) { /* 無視 */ } abort = null; }
        revoke();
        clearViewport();
        if (overlay) { overlay.hidden = true; overlay.style.display = 'none'; }
        document.body.classList.remove('dp400-original-open');
    }
    function init() {
        overlay = document.getElementById('dp400OriginalOverlay');
        monthSel = document.getElementById('dp400OriginalMonth');
        filesEl = document.getElementById('dp400OriginalFiles');
        viewEl = document.getElementById('dp400OriginalView');
        statusEl = document.getElementById('dp400OriginalStatus');
        downloadBtn = document.getElementById('dp400OriginalDownload');
        fetchBtn = document.getElementById('dp400OriginalFetch');
        closeBtn = document.getElementById('dp400OriginalClose');
        zoomInBtn = document.getElementById('dp400ZoomIn');
        zoomOutBtn = document.getElementById('dp400ZoomOut');
        zoomFitBtn = document.getElementById('dp400ZoomFit');
        const openBtn = document.getElementById('dp400OriginalBtn');
        if (!overlay || !monthSel || !openBtn) return;
        openBtn.addEventListener('click', open);
        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', ev => { if (ev.target === overlay) close(); });
        monthSel.addEventListener('change', () => { showMonth(monthSel.value).catch(() => say('表示できませんでした。', 'warn')); });
        downloadBtn.addEventListener('click', downloadCurrent);
        fetchBtn.addEventListener('click', fetchNow);
        if (zoomInBtn) zoomInBtn.addEventListener('click', () => zoomBy(1));
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => zoomBy(-1));
        if (zoomFitBtn) zoomFitBtn.addEventListener('click', () => fitAll());
        setZoomEnabled(false);
        if (viewEl) {
            viewEl.addEventListener('pointerdown', onPointerDown);
            viewEl.addEventListener('pointermove', onPointerMove);
            viewEl.addEventListener('pointerup', onPointerUp);
            viewEl.addEventListener('pointercancel', onPointerUp);
            viewEl.addEventListener('wheel', onWheel, { passive: false });
        }
        document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && overlay && !overlay.hidden) close(); });
    }
    return { init, open, close };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Dp400OriginalUI;
