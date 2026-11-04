// 区間の 下道／高速／途中から高速／途中まで高速 を扱う純粋関数（docs/highway-segments.md）
(function (root) {
    'use strict';
    var TYPES = ['general', 'highway', 'hwFrom', 'hwUntil'];
    var NAMES = { general: '下道', highway: '高速', hwFrom: '途中から高速', hwUntil: '途中まで高速' };
    var ICONS = { general: '🚗', highway: '🛣️', hwFrom: '↗️', hwUntil: '↘️' };

    function validIc(ic) {
        return !!(ic && typeof ic.name === 'string' && ic.name && isFinite(ic.lat) && isFinite(ic.lng));
    }
    // 保存値を {type, ic} にそろえる。古い文字列もそのまま読める。
    function normalize(v) {
        if (v === 'highway' || v === 'general') return { type: v, ic: null };
        if (v && typeof v === 'object' && TYPES.indexOf(v.type) >= 0) {
            var split = v.type === 'hwFrom' || v.type === 'hwUntil';
            return { type: v.type, ic: split && validIc(v.ic) ? { name: v.ic.name, lat: +v.ic.lat, lng: +v.ic.lng } : null };
        }
        return { type: 'general', ic: null };
    }
    // 保存用：下道・高速は従来の文字列のまま
    function toStored(c) {
        c = normalize(c);
        if (c.type === 'general' || c.type === 'highway') return c.type;
        return c.ic ? { type: c.type, ic: c.ic } : { type: c.type };
    }
    function isSplit(c) { var t = normalize(c).type; return t === 'hwFrom' || t === 'hwUntil'; }
    function nextType(t) { return TYPES[(TYPES.indexOf(t) + 1) % TYPES.length]; }

    // ICの点（Wikidata）は高速の本線上にあることが多く、下道だけでそこへ行こうとすると
    // 大回りになる（例: 浮島ICは首都高川崎線の上）。一般道側の出入口の点を使う。
    // 位置は OpenStreetMap の道路で確認（浮島町線・国道409号の接続部）。
    var IC_ACCESS = {
        '浮島IC': { lat: 35.51951, lng: 139.78666 },
        '木更津金田IC': { lat: 35.43002, lng: 139.92702 }
    };
    function accessPoint(ic) {
        var a = ic && IC_ACCESS[ic.name];
        return a ? { lat: a.lat, lng: a.lng } : { lat: ic.lat, lng: ic.lng };
    }
    // 下道部分が直線距離に比べて長すぎる（ICへの行き方がおかしい）かどうか
    function generalDetour(from, to, choice, generalM) {
        var c = normalize(choice);
        if (!c.ic || (c.type !== 'hwFrom' && c.type !== 'hwUntil')) return null;
        var p = c.type === 'hwFrom' ? from : to;
        if (!p || p.lat == null || p.lng == null || !isFinite(p.lat) || !isFinite(p.lng)) return null;
        var straight = haversine(p, accessPoint(c.ic)), km = generalM / 1000;
        return { straightKm: straight, generalKm: km, warn: km > Math.max(straight * 2.5, straight + 15) };
    }
    // 呼び出す区間（脚）を決める
    function planLegs(origin, dest, choice) {
        var c = normalize(choice);
        if (c.type === 'general') return [{ origin: origin, destination: dest, avoidHighways: true, part: 'general' }];
        if (c.type === 'highway' || !c.ic) return [{ origin: origin, destination: dest, avoidHighways: false, part: 'highway', fallback: c.type !== 'highway' }];
        var ic = accessPoint(c.ic);
        if (c.type === 'hwFrom') return [
            { origin: origin, destination: ic, avoidHighways: true, part: 'general' },
            { origin: ic, destination: dest, avoidHighways: false, part: 'highway' }];
        return [
            { origin: origin, destination: ic, avoidHighways: false, part: 'highway' },
            { origin: ic, destination: dest, avoidHighways: true, part: 'general' }];
    }
    // 脚ごとのメートルから区間kmを作る（合計は整数km・精算は従来どおり）
    function compose(legs) {
        var g = 0, h = 0;
        legs.forEach(function (l) { if (l.part === 'general') g += l.meters; else h += l.meters; });
        var km = Math.round((g + h) / 1000), gk = Math.min(km, Math.round(g / 1000));
        return { km: km, generalKm: gk, highwayKm: km - gk, generalM: g, highwayM: h };
    }
    function km1(m) { return (Math.round(m / 100) / 10).toFixed(1); }
    function breakdown(seg) {
        var c = normalize(seg.choice || seg.type);
        if (c.type === 'general' || c.type === 'highway' || !c.ic) return '';
        return '下道 ' + km1(seg.generalM) + 'km ＋ 高速 ' + km1(seg.highwayM) + 'km（' + c.ic.name + (c.type === 'hwFrom' ? 'から乗車' : 'で降車') + '）';
    }
    function label(choice) {
        var c = normalize(choice);
        var s = ICONS[c.type] + ' ' + NAMES[c.type];
        if (c.type === 'hwFrom' || c.type === 'hwUntil') s += c.ic ? '（' + c.ic.name + (c.type === 'hwFrom' ? 'から）' : 'まで）') : '（IC未選択）';
        return s;
    }

    // --- 距離（km） ---
    function haversine(a, b) {
        var R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
        var s = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
    }
    function toIc(row) { return Array.isArray(row) ? { name: row[0], lat: row[1], lng: row[2], roads: row[3] || '' } : row; }
    function nearestIC(pt, list) {
        var best = null, bd = Infinity;
        (list || []).forEach(function (row) { var ic = toIc(row), d = haversine(pt, ic); if (d < bd) { bd = d; best = ic; } });
        return best ? Object.assign({ distKm: bd }, best) : null;
    }
    // 点から線分への距離（km、平面近似）
    function distToSegment(p, a, b) {
        var kx = 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180), ky = 110.57;
        var ax = a.lng * kx, ay = a.lat * ky, bx = b.lng * kx, by = b.lat * ky, px = p.lng * kx, py = p.lat * ky;
        var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }
    function icsNearSegment(a, b, list, opts) {
        opts = opts || {};
        var max = opts.maxKm || 15, limit = opts.limit || 8;
        if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) return [];
        return (list || []).map(toIc).map(function (ic) { return Object.assign({ distKm: distToSegment(ic, a, b) }, ic); })
            .filter(function (ic) { return ic.distKm <= max; })
            .sort(function (x, y) { return x.distKm - y.distKm; }).slice(0, limit);
    }
    function searchICs(q, list, limit) {
        q = String(q || '').trim();
        if (!q) return [];
        return (list || []).map(toIc).filter(function (ic) { return ic.name.indexOf(q) >= 0 || (ic.roads || '').indexOf(q) >= 0; }).slice(0, limit || 12);
    }

    // --- 同じ場所・遠回りのチェック ---
    function addrKey(a) { return String(a || '').normalize('NFKC').replace(/[\s　]+/g, '').replace(/[‐－―−]/g, '-'); }
    // 同じ住所（または50m以内）なら同じ場所。距離は0kmで道路の選択は使わない
    function samePlace(a, b) {
        if (a && b && a.address && addrKey(a.address) === addrKey(b.address)) return true;
        if (a && b && isFinite(a.lat) && isFinite(b.lat) && a.lat !== null && b.lat !== null && a.lng !== null && b.lng !== null) return haversine(a, b) < 0.05;
        return false;
    }
    // ICを通ると直線よりどれだけ遠回りか（直線距離ベース）。1.5倍以上かつ5km以上増えると遠回り
    function detour(a, b, ic) {
        if (!a || !b || !validIc(ic) || !isFinite(a.lat) || !isFinite(b.lat) || a.lat === null || b.lat === null) return null;
        var direct = haversine(a, b), via = haversine(a, ic) + haversine(ic, b);
        return { directKm: direct, viaKm: via, extraKm: via - direct, warn: via > Math.max(direct, 0.5) * 1.5 && via - direct > 5 };
    }

    // --- よく使うIC ---
    function bumpFavorite(favs, ic, now) {
        var out = Object.assign({}, favs || {});
        if (!validIc(ic)) return out;
        var old = out[ic.name] || { count: 0 };
        out[ic.name] = { count: (old.count || 0) + 1, last: now || Date.now(), lat: +ic.lat, lng: +ic.lng };
        return out;
    }
    function favoriteList(favs, limit) {
        return Object.keys(favs || {}).map(function (n) { var f = favs[n]; return { name: n, lat: f.lat, lng: f.lng, count: f.count || 0, last: f.last || 0 }; })
            .filter(validIc).sort(function (a, b) { return (b.count - a.count) || (b.last - a.last); }).slice(0, limit || 8);
    }

    var api = { TYPES: TYPES, NAMES: NAMES, ICONS: ICONS, normalize: normalize, toStored: toStored, isSplit: isSplit, nextType: nextType,
        planLegs: planLegs, accessPoint: accessPoint, generalDetour: generalDetour, IC_ACCESS: IC_ACCESS, compose: compose, breakdown: breakdown, label: label, haversine: haversine,
        nearestIC: nearestIC, samePlace: samePlace, detour: detour, icsNearSegment: icsNearSegment, searchICs: searchICs, bumpFavorite: bumpFavorite, favoriteList: favoriteList };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.HighwaySegments = api;
})(typeof window !== 'undefined' ? window : this);
