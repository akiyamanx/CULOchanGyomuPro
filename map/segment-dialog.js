// [CULOchanGyomuPro統合] v2.0 2026-11-04 - 途中から高速／途中まで高速（IC指定）に対応
// ============================================
// 区間別 道路選択ダイアログ（docs/highway-segments.md）
// points: [{ id, address, label, lat?, lng? }, ...]
// savedSegments: { "fromId_toId": 'general'|'highway'|{type,ic}, ... }
// 戻り値: 同じ形（下道・高速は従来の文字列）または null（キャンセル）
// ============================================

const SegmentDialog = (() => {
    const HS = () => window.HighwaySegments;
    const ICS = () => (window.IC_KANTO || []);
    const esc = s => ExpenseImport.escapeHtml(String(s == null ? '' : s));
    const SHORT = { general: '🚗 下道', highway: '🛣️ 高速', hwFrom: '↗️ 途中から', hwUntil: '↘️ 途中まで' };
    let state = null;

    function pt(p) { return p && isFinite(p.lat) && isFinite(p.lng) ? { lat: +p.lat, lng: +p.lng } : null; }

    function show(points, savedSegments) {
        return new Promise((resolve) => {
            const old = document.getElementById('segmentDialog');
            if (old) old.remove();
            const segs = [];
            for (let i = 0; i < points.length - 1; i++) {
                const key = `${points[i].id}_${points[i + 1].id}`;
                const same = !!(HS().samePlace && HS().samePlace(points[i], points[i + 1]));
                segs.push({ key, same, fromLabel: points[i].label, toLabel: points[i + 1].label,
                    a: pt(points[i]), b: pt(points[i + 1]), choice: same ? HS().normalize('general') : HS().normalize((savedSegments || {})[key]) });
            }
            const overlay = document.createElement('div');
            overlay.id = 'segmentDialog';
            overlay.className = 'seg-overlay';
            overlay.innerHTML = '<div class="seg-dialog" role="dialog" aria-label="区間別 道路選択"><div id="segBody" class="seg-body"></div></div>';
            document.body.appendChild(overlay);
            state = { segs, overlay, resolve, picking: -1 };
            overlay.onclick = (e) => { if (e.target === overlay) finish(null); };
            renderList();
        });
    }

    function finish(result) {
        if (!state) return;
        stopMapPick();
        state.overlay.remove();
        const r = state.resolve; state = null; r(result);
    }

    function renderList() {
        const body = document.getElementById('segBody');
        let html = '<div class="seg-title">📏 区間別 道路選択</div><div class="seg-hint">区間ごとに選んでください。途中から／途中まで は IC も選びます</div><div class="seg-list">';
        state.segs.forEach((s, i) => {
            const t = s.choice.type;
            if (s.same) {
                html += `<div class="seg-row seg-same" id="seg_${i}" data-type="same"><div class="seg-route"><b>${esc(s.fromLabel)}</b><span>↓</span><b>${esc(s.toLabel)}</b></div><div class="seg-same-note">📍 同じ場所なので 0km（道路の選択はありません）</div></div>`;
                return;
            }
            html += `<div class="seg-row seg-${t}" id="seg_${i}" data-type="${t}">
                <div class="seg-route"><b>${esc(s.fromLabel)}</b><span>↓</span><b>${esc(s.toLabel)}</b></div>
                <div class="seg-types" role="radiogroup">${HS().TYPES.map(k =>
                    `<button type="button" role="radio" aria-checked="${k === t}" class="seg-type${k === t ? ' on' : ''}" onclick="SegmentDialog.setType(${i},'${k}')">${SHORT[k]}</button>`).join('')}</div>`;
            if (HS().isSplit(s.choice)) {
                const word = t === 'hwFrom' ? '乗ったIC' : '降りたIC';
                html += `<div class="seg-ic">${s.choice.ic ? `🛣️ ${word}：<b>${esc(s.choice.ic.name)}</b>` : `<span class="seg-warn">⚠️ ${word}を選んでください</span>`}
                    <button type="button" class="seg-ic-btn" onclick="SegmentDialog.openPicker(${i})">${s.choice.ic ? '変更' : 'ICを選ぶ'}</button></div>`;
                const dt = s.choice.ic && HS().detour ? HS().detour(s.a, s.b, s.choice.ic) : null;
                if (dt && dt.warn) html += `<div class="seg-warn seg-detour">⚠️ このICを通るとかなり遠回りです（直線で約${Math.round(dt.directKm)}km → 約${Math.round(dt.viaKm)}km）。区間やICが合っているか確認してください</div>`;
            }
            html += '</div>';
        });
        html += '</div><div class="seg-actions"><button type="button" id="segCancel" class="seg-cancel">キャンセル</button><button type="button" id="segCalc" class="seg-calc">📏 計算する</button></div>';
        body.innerHTML = html;
        document.getElementById('segCancel').onclick = () => finish(null);
        document.getElementById('segCalc').onclick = calc;
    }

    function calc() {
        const missing = state.segs.findIndex(s => HS().isSplit(s.choice) && !s.choice.ic);
        if (missing >= 0) { alert(`${missing + 1}番目の区間のICを選んでください`); openPicker(missing); return; }
        const result = {};
        let favs = getFavs();
        const used = {};
        state.segs.forEach(s => {
            result[s.key] = HS().toStored(s.choice);
            if (s.choice.ic && !used[s.choice.ic.name]) { used[s.choice.ic.name] = 1; favs = HS().bumpFavorite(favs, s.choice.ic); }
        });
        saveFavs(favs);
        finish(result);
    }

    function setType(i, type) {
        const s = state.segs[i];
        const keepIc = s.choice.ic;
        s.choice = { type, ic: (type === 'hwFrom' || type === 'hwUntil') ? keepIc : null };
        if (type !== 'hwFrom' && type !== 'hwUntil') s.lastIc = keepIc || s.lastIc;
        else if (!s.choice.ic && s.lastIc) s.choice.ic = s.lastIc;
        renderList();
        if (HS().isSplit(s.choice) && !s.choice.ic) openPicker(i);
    }
    // 互換：タップで種類を順に切替
    function toggleType(i) { setType(i, HS().nextType(state.segs[i].choice.type)); }

    function getFavs() { try { return (DataStorage.getSettings().icFavorites) || {}; } catch (e) { return {}; } }
    function saveFavs(f) { try { const st = DataStorage.getSettings(); st.icFavorites = f; DataStorage.saveSettings(st); } catch (e) { /* 保存できなくても計算は続ける */ } }
    function hasMap() { return typeof google !== 'undefined' && google.maps && typeof MapCore !== 'undefined' && MapCore.getMap && MapCore.getMap(); }

    function chip(ic, extra) {
        state.cands.push(ic);
        return `<button type="button" class="ic-chip" onclick="SegmentDialog.pickIc(${state.cands.length - 1})"><b>${esc(ic.name)}</b>${extra ? `<small>${esc(extra)}</small>` : ''}</button>`;
    }

    function openPicker(i, query) {
        state.picking = i; state.cands = [];
        const s = state.segs[i];
        const word = s.choice.type === 'hwFrom' ? '乗ったIC' : '降りたIC';
        const favs = HS().favoriteList(getFavs(), 6);
        const near = HS().icsNearSegment(s.a, s.b, ICS());
        const q = query || '';
        const found = HS().searchICs(q, ICS());
        const map = hasMap();
        let html = `<div class="seg-title">🛣️ ${word}を選ぶ</div><div class="seg-hint">${esc(s.fromLabel)} → ${esc(s.toLabel)}</div><div class="seg-list">`;
        html += `<input id="icSearch" class="ic-search" type="search" placeholder="🔍 IC名・路線名で探す（例：浮島）" value="${esc(q)}">`;
        if (q) html += `<div class="ic-sec">🔍 「${esc(q)}」</div><div class="ic-chips">${found.length ? found.map(ic => chip(ic, ic.roads)).join('') : '<span class="ic-none">見つかりません</span>'}</div>`;
        html += `<div class="ic-sec">⭐ よく使うIC</div><div class="ic-chips">${favs.length ? favs.map(ic => chip(ic, ic.count + '回')).join('') : '<span class="ic-none">まだありません（使うと増えます）</span>'}</div>`;
        html += `<div class="ic-sec">📍 この区間の近く</div><div class="ic-chips">${near.length ? near.map(ic => chip(ic, '線から' + ic.distKm.toFixed(1) + 'km')).join('') : `<span class="ic-none">${s.a && s.b ? '近くにICがありません' : '位置がわからないため出せません'}</span>`}</div>`;
        html += `<div class="ic-sec">🗺️ 地図で選ぶ</div><button type="button" id="icMapPick" class="ic-map"${map ? '' : ' disabled'}>🗺️ 地図をタップして一番近いICを選ぶ</button>`;
        if (!map) html += '<div class="ic-none">地図を表示できないため使えません（上の一覧から選んでください）</div>';
        html += '</div><div class="seg-actions"><button type="button" id="icBack" class="seg-cancel">← 戻る</button></div>';
        document.getElementById('segBody').innerHTML = html;
        document.getElementById('icBack').onclick = renderList;
        const input = document.getElementById('icSearch');
        input.oninput = () => { clearTimeout(state.t); state.t = setTimeout(() => { openPicker(i, input.value); const n = document.getElementById('icSearch'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
        if (map) document.getElementById('icMapPick').onclick = startMapPick;
    }

    function pickIc(n) {
        const ic = state.cands[n];
        const s = state.segs[state.picking];
        s.choice = { type: s.choice.type, ic: { name: ic.name, lat: +ic.lat, lng: +ic.lng } };
        renderList();
    }

    function startMapPick() {
        const map = MapCore.getMap();
        state.overlay.style.display = 'none';
        const bar = document.createElement('div');
        bar.id = 'icMapBar'; bar.className = 'ic-map-bar';
        bar.innerHTML = '<span>🗺️ 地図をタップすると一番近いICを選びます</span><button type="button">やめる</button>';
        document.body.appendChild(bar);
        bar.querySelector('button').onclick = () => { stopMapPick(); openPicker(state.picking); };
        state.listener = map.addListener('click', (e) => {
            const p = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            const ic = HS().nearestIC(p, ICS());
            stopMapPick();
            if (!ic) { openPicker(state.picking); return; }
            if (confirm(`${ic.name}（タップした所から${ic.distKm.toFixed(1)}km）を選びますか？`)) {
                state.cands = [ic]; pickIc(0);
            } else openPicker(state.picking);
        });
    }
    function stopMapPick() {
        const bar = document.getElementById('icMapBar'); if (bar) bar.remove();
        if (state && state.listener) { state.listener.remove(); state.listener = null; }
        if (state) state.overlay.style.display = '';
    }

    return { show, toggleType, setType, openPicker, pickIc };
})();
