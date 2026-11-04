// 距離計算の結果画面の「確認用ルートマップ」（計算時に取得済みの道筋だけを使い、追加の通信はしない）
(function (root) {
    'use strict';
    var COLORS = { general: '#1e88e5', highway: '#43a047', warn: '#ff6d00' };
    function colorFor(part, warn) { return warn ? COLORS.warn : (part === 'highway' ? COLORS.highway : COLORS.general); }
    // 地図に描く線の一覧（純粋関数）
    function plan(result) {
        var lines = [], pins = [], stops = [];
        (result && result.mapData || []).forEach(function (m) {
            m.legs.forEach(function (l) {
                if (l.path && l.path.length > 1) lines.push({ seg: m.seg, part: l.part, color: colorFor(l.part, m.warn), path: l.path, weight: m.warn ? 6 : 5 });
            });
            if (m.ic && isFinite(m.ic.lat)) pins.push({ seg: m.seg, name: m.ic.name, lat: m.ic.lat, lng: m.ic.lng });
            var first = m.legs[0] && m.legs[0].path, last = m.legs[m.legs.length - 1] && m.legs[m.legs.length - 1].path;
            if (first && first.length) stops[m.seg] = first[0];
            if (last && last.length) stops[m.seg + 1] = last[last.length - 1];
        });
        var labels = [];
        var n = result && result.segments ? result.segments.length : 0;
        for (var i = 0; i <= n; i++) {
            if (!stops[i]) continue;
            var lab = (i === 0 || i === n) ? '会' : String(i);
            var dup = labels.find(function (x) { return Math.abs(x.lat - stops[i].lat) < 1e-4 && Math.abs(x.lng - stops[i].lng) < 1e-4; });
            if (dup) { if (dup.label.split('・').indexOf(lab) < 0) dup.label += '・' + lab; continue; }
            labels.push({ label: lab, lat: stops[i].lat, lng: stops[i].lng });
        }
        return { lines: lines, pins: pins, stops: labels };
    }
    function draw(el, result, gm) {
        var p = plan(result);
        if (!p.lines.length) throw new Error('道筋がありません');
        var map = new gm.Map(el, { mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: 'greedy' });
        var all = new gm.LatLngBounds(), bySeg = {};
        p.lines.forEach(function (l) {
            new gm.Polyline({ map: map, path: l.path, strokeColor: l.color, strokeWeight: l.weight, strokeOpacity: 0.85 });
            l.path.forEach(function (pt) { all.extend(pt); (bySeg[l.seg] = bySeg[l.seg] || new gm.LatLngBounds()).extend(pt); });
        });
        p.pins.forEach(function (ic) { new gm.Marker({ map: map, position: { lat: ic.lat, lng: ic.lng }, title: ic.name, label: { text: 'IC', fontSize: '10px', color: '#fff' } }); });
        p.stops.forEach(function (s) { new gm.Marker({ map: map, position: { lat: s.lat, lng: s.lng }, title: s.label, label: { text: s.label, color: '#fff', fontWeight: 'bold' } }); });
        map.fitBounds(all, 24);
        return {
            map: map,
            showAll: function () { map.fitBounds(all, 24); },
            focus: function (i) { if (!bySeg[i]) return false; map.fitBounds(bySeg[i], 32); return true; }
        };
    }
    var api = { plan: plan, draw: draw, colorFor: colorFor, COLORS: COLORS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ResultMap = api;
})(typeof window !== 'undefined' ? window : this);
