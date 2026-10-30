// [端末間の自動同期] 訪問先・月の一覧・日程未定・ルート・区間・精算書・会社住所を、スマホとタブレットで揃える。
// 仕組み(メールBOXの台帳と同じ): Googleドライブのアプリ専用領域(appDataFolder)に「端末ごとに1ファイル」を置き、読むときに全部を合わせる。
//   ・1件ごとに固定のキー(訪問先は内部ID。MF番号は端末をまたいだ重複の見分けに使う)。
//   ・項目ごとに「最後に変えた方が勝つ」(変えた時刻を項目ごとに持つ)。訪問先の月・日程未定は _ws という項目として扱う(移動も1項目の変更)。
//   ・削除は「削除の印(時刻)」として残し、他端末へ伝える。削除より後の編集がない限り、他端末のファイルから復活しない。
//   ・この端末で何をどう変えたかは、前回同期時の各項目の要約(ハッシュ)と見比べて見つける(保存の場所ごとに手を入れない)。
//   ・初回(両端末ともデータあり)は置き換えずに合わせる。初回の時刻は「不明(1)」とし、以後の本当の編集が必ず勝つ。
//   ・同じMF番号が別IDで両端末にある(各端末で取り込んだ)場合は、利用者の入力が無い方だけをまとめる(mf-dedupe と同じ基準)。
// 同期しないもの(端末ごと): APIキー・接続設定、表示中の月、地図の座標キャッシュ、メール取り込みの差出人設定、
//   写真を含むもの(レシート・駐車場・下書き・ETC)。写真入りは「送る/受け取る」で。
// トークンは扱わない(通信は差し替え可能な adapter に任せる)。ログに中身は出さない(コードだけ)。
const DataSync = (() => {
    const APP = 'CULOchanDataSync1', V = 1, STATE_KEY = 'gyomupro_data_sync';
    const MAX_FILE_BYTES = 4 * 1024 * 1024, MAX_FILES = 20;
    const TOMB_KEEP_MS = 180 * 24 * 3600 * 1000, FUTURE_MS = 7 * 24 * 3600 * 1000;
    const BASE_T = 1;   // 初回の「いつ変えたか分からない」値
    const DEVICE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const WS_RE = /^(\d{4}-(0[1-9]|1[0-2])|unscheduled)$/;
    const KEY_RE = /^[\w.@:|-]{1,160}$/;
    const FIELD_RE = /^[A-Za-z_$][\w$-]{0,60}$/;
    const BAD_FIELD = /^(?:__proto__|prototype|constructor|apiKey|geminiApiKey|access_token|refresh_token|client_secret|password|token)$|imageDataUrl$/i;
    const COLLS = ['ws', 'cust', 'route', 'seg', 'exp', 'set'];
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    const hashOf = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + s.length.toString(36); };
    const enc = v => v === undefined ? '~' : JSON.stringify(v);
    const hv = v => hashOf(enc(v));
    const empty = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    const fail = code => Object.assign(new Error(code), { code });

    // 値の検証(他端末のファイルは信用しない)
    function cleanValue(v, depth) {
        if (v === null || typeof v === 'boolean') return v;
        if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
        if (typeof v === 'string') return v.length <= 20000 ? v : undefined;
        if (depth > 8) return undefined;
        if (Array.isArray(v)) { if (v.length > 3000) return undefined; const out = []; for (const x of v) { const c = cleanValue(x, depth + 1); if (c === undefined) return undefined; out.push(c); } return out; }
        if (isObj(v)) {
            const out = {}; const ks = Object.keys(v); if (ks.length > 300) return undefined;
            for (const k of ks) { if (BAD_FIELD.test(k) || k.length > 200) return undefined; const c = cleanValue(v[k], depth + 1); if (c === undefined) return undefined; out[k] = c; }
            return out;
        }
        return undefined;
    }
    const tsOk = (t, now) => Number.isInteger(t) && t >= 0 && t <= now + FUTURE_MS;
    const keyOk = (coll, key) => typeof key === 'string' && KEY_RE.test(key) && !BAD_FIELD.test(key)
        && (coll === 'ws' || coll === 'seg' ? WS_RE.test(key) : coll === 'route' || coll === 'exp' ? WS_RE.test(key.split('|')[0]) && key.indexOf('|') > 0 : coll === 'set' ? key === 'homeAddress' : true);

    // ファイル → {ok, deviceId, recs, dropped} / {ok:false, code}
    function parseDoc(text, expectedDeviceId, now) {
        if (typeof text !== 'string') return { ok: false, code: 'bad_format' };
        if (text.length > MAX_FILE_BYTES) return { ok: false, code: 'file_too_large' };
        let doc; try { doc = JSON.parse(text); } catch (e) { return { ok: false, code: 'bad_json' }; }
        if (!isObj(doc) || doc.app !== APP) return { ok: false, code: 'bad_format' };
        if (doc.v !== V) return { ok: false, code: 'newer_version' };
        if (!DEVICE_RE.test(String(doc.deviceId)) || (expectedDeviceId && doc.deviceId !== expectedDeviceId)) return { ok: false, code: 'bad_device' };
        if (!isObj(doc.recs)) return { ok: false, code: 'bad_format' };
        const recs = {}; let dropped = 0;
        for (const coll of COLLS) {
            recs[coll] = new Map();
            const src = doc.recs[coll]; if (src === undefined) continue;
            if (!isObj(src)) { dropped++; continue; }
            for (const key of Object.keys(src)) {
                const r = src[key];
                if (!keyOk(coll, key) || !isObj(r) || !tsOk(r.a, now) || (r.d !== undefined && !tsOk(r.d, now)) || (r.f !== undefined && !isObj(r.f))) { dropped++; continue; }
                const f = {}; let bad = false;
                for (const name of Object.keys(r.f || {})) {
                    const e = r.f[name];
                    if (!FIELD_RE.test(name) || BAD_FIELD.test(name) || !Array.isArray(e) || e.length < 1 || e.length > 2 || !tsOk(e[0], now)) { bad = true; break; }
                    const v = e.length === 2 ? cleanValue(e[1], 0) : undefined;
                    if (e.length === 2 && v === undefined) { bad = true; break; }
                    f[name] = { t: e[0], v, h: hv(v) };
                }
                if (bad) { dropped++; continue; }
                if (coll === 'cust' && f._ws && f._ws.v !== undefined && !WS_RE.test(String(f._ws.v))) { dropped++; continue; }
                recs[coll].set(key, { a: r.a, d: r.d || 0, f });
            }
        }
        return { ok: true, deviceId: doc.deviceId, recs, dropped };
    }

    function create(opts) {
        const o = opts || {};
        const S = o.storage, adapter = o.adapter;
        if (!S || typeof S.getItem !== 'function') throw new Error('storage required');
        const nowMs = () => (o.now ? o.now() : new Date()).getTime();
        const uuid = () => { try { const v = o.uuid ? o.uuid() : (crypto.randomUUID ? crypto.randomUUID() : ''); if (DEVICE_RE.test(v)) return v; } catch (e) { /* 下で作る */ }
            const hex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join(''); return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`; };
        const timeoutMs = o.timeoutMs || 30000;
        let running = null, last = { ok: null, code: '', at: 0, stats: null };

        function loadState() {
            const raw = S.getItem(STATE_KEY);
            if (!raw) return { v: 1, deviceId: uuid(), clocks: null, fileId: null, pushHash: '' };
            const st = JSON.parse(raw);   // 壊れていたら例外(上で止める)
            if (!isObj(st) || !DEVICE_RE.test(String(st.deviceId))) throw fail('state_corrupt');
            return st;
        }
        const saveState = st => S.setItem(STATE_KEY, JSON.stringify(st));
        const readJson = (key, fallback) => { const raw = S.getItem(key); if (raw === null || raw === undefined) return fallback; return JSON.parse(raw); };
        const keys = () => typeof S.keys === 'function' ? S.keys() : [];

        // この端末の今のデータ → {coll: Map(key → 項目の値)}。読めないデータがあれば例外(上書きしない)。
        function readLocal() {
            const out = {}; COLLS.forEach(c => { out[c] = new Map(); });
            const order = { cust: {}, route: {}, exp: {} };
            const wsList = readJson('mm_workspaces', []);
            if (!Array.isArray(wsList)) throw fail('local_corrupt');
            const wsIds = new Set();
            for (const w of wsList) if (isObj(w) && WS_RE.test(String(w.id))) { wsIds.add(w.id); const { id, ...rest } = w; out.ws.set(w.id, rest); }
            for (const k of keys()) { const m = /^mm_(customers|routes|segments|expenses)_(.+)$/.exec(k); if (m && WS_RE.test(m[2])) wsIds.add(m[2]); }
            const fixIds = [];
            for (const ws of [...wsIds].sort()) {
                const cs = readJson('mm_customers_' + ws, []);
                if (!Array.isArray(cs)) throw fail('local_corrupt');
                order.cust[ws] = [];
                cs.forEach((c, i) => {
                    if (!isObj(c)) return;
                    let id = typeof c.id === 'string' || typeof c.id === 'number' ? String(c.id) : '';
                    if (!id || !KEY_RE.test(id) || out.cust.has(id)) { fixIds.push({ ws, i }); return; }
                    out.cust.set(id, { ...c, _ws: ws }); order.cust[ws].push(id);
                });
                const rs = readJson('mm_routes_' + ws, null);
                if (rs !== null) {
                    if (!Array.isArray(rs)) throw fail('local_corrupt');
                    order.route[ws] = [];
                    for (const r of rs) if (isObj(r) && r.id != null && KEY_RE.test(String(r.id))) { const k = ws + '|' + r.id; out.route.set(k, { ...r, _ws: ws }); order.route[ws].push(k); }
                }
                const sg = readJson('mm_segments_' + ws, null);
                if (sg !== null) out.seg.set(ws, { v: sg });
                const ex = readJson('mm_expenses_' + ws, null);
                if (ex !== null) {
                    if (!Array.isArray(ex)) throw fail('local_corrupt');
                    order.exp[ws] = [];
                    for (const e of ex) if (isObj(e) && e.id != null && KEY_RE.test(String(e.id))) { const k = ws + '|' + e.id; out.exp.set(k, { ...e, _ws: ws }); order.exp[ws].push(k); }
                }
            }
            const settings = readJson('mm_settings', {});
            if (isObj(settings) && typeof settings.homeAddress === 'string') out.set.set('homeAddress', { v: settings.homeAddress });
            return { out, order, fixIds, wsIds };
        }
        // IDの無い・重複した訪問先にIDを付ける(1回だけ。以後はそのIDで追う)
        function fixMissingIds(fixIds) {
            const byWs = {};
            fixIds.forEach(x => { (byWs[x.ws] = byWs[x.ws] || []).push(x.i); });
            for (const ws of Object.keys(byWs)) {
                const cs = readJson('mm_customers_' + ws, []);
                byWs[ws].forEach(i => { cs[i] = { ...cs[i], id: 'c_' + uuid() }; });
                S.setItem('mm_customers_' + ws, JSON.stringify(cs));
            }
        }
        const sanitize = rec => { const r = {}; for (const k of Object.keys(rec)) { if (!FIELD_RE.test(k) || BAD_FIELD.test(k)) continue; const v = cleanValue(rec[k], 0); if (v !== undefined) r[k] = v; } return r; };

        // 前回の要約と見比べて、変わった項目に今の時刻を付ける。消えた記録には削除の印。
        function stamp(local, clocks, now, first) {
            const view = {}; const deleted = { cust: [] };
            COLLS.forEach(c => { view[c] = new Map(); });
            for (const coll of COLLS) {
                const cl = clocks[coll] || {};
                for (const [key, raw] of local.out[coll]) {
                    const rec = sanitize(raw);
                    const prev = has(cl, key) ? cl[key] : null;
                    const f = {};
                    const t0 = first || !prev ? (first ? BASE_T : now) : now;
                    for (const name of Object.keys(rec)) {
                        const h = hv(rec[name]); const p = prev && prev.f && prev.f[name];
                        f[name] = { t: p && p[1] === h ? p[0] : t0, v: rec[name], h };
                    }
                    if (prev && prev.f) for (const name of Object.keys(prev.f)) if (!has(rec, name)) {
                        const p = prev.f[name]; f[name] = { t: p[1] === '~' ? p[0] : now, v: undefined, h: '~' };
                    }
                    let a = prev ? prev.a : (first ? BASE_T : now), d = prev ? (prev.d || 0) : 0;
                    if (d && d >= a && Math.max(a, ...Object.values(f).map(x => x.t)) <= d) a = now;   // 削除済みのはずが手元にある(戻した・作り直した)
                    view[coll].set(key, { a, d, f });
                }
                for (const key of Object.keys(cl)) {
                    if (local.out[coll].has(key)) continue;
                    const p = cl[key]; const f = {};
                    for (const name of Object.keys(p.f || {})) f[name] = { t: p.f[name][0], v: undefined, h: p.f[name][1], unknown: true };
                    const alive = Math.max(p.a, ...Object.values(f).map(x => x.t)) > (p.d || 0);
                    const d = alive ? now : p.d;
                    if (alive && coll === 'cust') deleted.cust.push(key);
                    view[coll].set(key, { a: p.a, d, f, gone: true });
                }
            }
            return { view, deleted };
        }

        const winField = (x, y) => {   // 新しい方。同時刻なら空でない方、それでも同じならハッシュの大きい方(どの端末でも同じ答え)
            if (!x) return y; if (!y) return x;
            if (x.unknown && !y.unknown && x.t <= y.t) return y;
            if (y.unknown && !x.unknown && y.t <= x.t) return x;
            if (x.t !== y.t) return x.t > y.t ? x : y;
            if (empty(x.v) !== empty(y.v)) return empty(x.v) ? y : x;
            return x.h >= y.h ? x : y;
        };
        const maxT = r => Math.max(r.a, ...Object.values(r.f).map(x => x.t));
        const alive = r => maxT(r) > (r.d || 0);
        function mergeRec(x, y, conflicts) {
            if (!x) return y; if (!y) return x;
            const f = {};
            for (const name of new Set([...Object.keys(x.f), ...Object.keys(y.f)])) {
                const a = x.f[name], b = y.f[name];
                if (a && b && a.t === BASE_T && b.t === BASE_T && a.h !== b.h && conflicts) conflicts.n++;
                f[name] = winField(a, b);
            }
            return { a: Math.min(x.a, y.a) || Math.max(x.a, y.a), d: Math.max(x.d || 0, y.d || 0), f };
        }

        // MF番号が同じで別IDの訪問先(両端末でそれぞれ取り込んだもの)。利用者の入力が無い方だけをまとめる。
        const UNSCH = 'unscheduled';
        const val = (r, n) => r.f[n] ? r.f[n].v : undefined;
        const day = v => String(v || '').slice(0, 10);
        const score = r => (val(r, '_ws') !== UNSCH && val(r, 'appoDate') ? 4 : 0) + (val(r, 'routeId') ? 2 : 0) + ((val(r, 'status') || 'pending') !== 'pending' ? 2 : 0) + (val(r, 'appoDate') ? 1 : 0);
        const removable = (d, keep) => !val(d, 'routeId') && (val(d, 'status') || 'pending') === 'pending' && (!val(d, 'appoDate') || day(val(d, 'appoDate')) === day(val(keep, 'appoDate')));
        const FILL = ['phone', 'contact', 'branch', 'equipType', 'filter', 'purpose', 'address', 'note'];
        function mfMerge(view, fromRemote, now) {
            if (typeof MfDedupe === 'undefined' || !MfDedupe.mfOf) return 0;
            const groups = new Map();
            for (const [key, r] of view.cust) {
                if (!alive(r)) continue;
                const mf = MfDedupe.mfOf({ managementNo: val(r, 'managementNo') });
                if (!mf) continue;
                if (!groups.has(mf)) groups.set(mf, []);
                groups.get(mf).push({ key, r });
            }
            let merged = 0;
            for (const list of groups.values()) {
                if (list.length < 2 || !list.some(x => fromRemote.has(x.key)) || !list.some(x => !fromRemote.has(x.key))) continue;
                list.sort((p, q) => score(q.r) - score(p.r) || String(val(p.r, 'createdAt') || '').localeCompare(String(val(q.r, 'createdAt') || '')) || (p.key < q.key ? -1 : 1));
                const keep = list[0];
                for (const d of list.slice(1)) {
                    if (!removable(d.r, keep.r)) continue;
                    for (const n of FILL) if (empty(val(keep.r, n)) && !empty(val(d.r, n))) keep.r.f[n] = { ...d.r.f[n] };
                    d.r.d = Math.max(now, maxT(d.r) + 1); merged++;
                }
            }
            return merged;
        }

        // 合わせた結果を保存領域へ書く(変わったキーだけ)
        function applyView(view, local) {
            const write = (key, value) => { const s = JSON.stringify(value); if (S.getItem(key) !== s) { S.setItem(key, s); return 1; } return 0; };
            const plain = r => { const o2 = {}; for (const n of Object.keys(r.f)) if (r.f[n].v !== undefined) o2[n] = r.f[n].v; return o2; };
            let writes = 0;
            const aliveWs = new Map();
            for (const [id, r] of view.ws) if (alive(r)) aliveWs.set(id, plain(r));
            const custBy = {};
            for (const [key, r] of view.cust) {
                if (!alive(r)) continue;
                const c = plain(r); const ws = WS_RE.test(String(c._ws)) ? c._ws : UNSCH; delete c._ws;
                if (c.id === undefined) c.id = key;
                (custBy[ws] = custBy[ws] || []).push({ key, c });
                if (!aliveWs.has(ws)) aliveWs.set(ws, { name: ws === UNSCH ? '日程未定' : ws.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}年${parseInt(m, 10)}月`), createdAt: new Date(nowMs()).toISOString() });
            }
            const ordered = (list, ord) => { const pos = new Map((ord || []).map((k, i) => [k, i])); return list.sort((p, q) => (pos.has(p.key) ? pos.get(p.key) : 1e9) - (pos.has(q.key) ? pos.get(q.key) : 1e9) || String(p.c.createdAt || '').localeCompare(String(q.c.createdAt || '')) || (p.key < q.key ? -1 : 1)); };
            const group = coll => { const by = {}; for (const [key, r] of view[coll]) { if (!alive(r)) continue; const c = plain(r); const ws = key.split('|')[0]; delete c._ws; (by[ws] = by[ws] || []).push({ key, c }); } return by; };
            const routeBy = group('route'), expBy = group('exp');
            for (const ws of Object.keys(routeBy).concat(Object.keys(expBy))) if (!aliveWs.has(ws) && (custBy[ws] || []).length) aliveWs.set(ws, { name: ws });
            const wsIds = [...aliveWs.keys()].sort();
            writes += write('mm_workspaces', wsIds.map(id => ({ id, ...aliveWs.get(id) })));
            const allWs = new Set([...wsIds, ...local.wsIds]);
            for (const ws of allWs) {
                const live = aliveWs.has(ws);
                if (!live) {   // 他の端末で月ごと消した
                    for (const b of ['customers', 'routes', 'segments', 'expenses']) if (S.getItem('mm_' + b + '_' + ws) !== null) { S.removeItem('mm_' + b + '_' + ws); writes++; }
                    continue;
                }
                const cs = ordered(custBy[ws] || [], local.order.cust[ws]).map(x => x.c);
                if (cs.length || S.getItem('mm_customers_' + ws) !== null) writes += write('mm_customers_' + ws, cs);
                if (routeBy[ws]) writes += write('mm_routes_' + ws, ordered(routeBy[ws], local.order.route[ws]).map(x => x.c));
                if (expBy[ws]) writes += write('mm_expenses_' + ws, expBy[ws].sort((p, q) => String(q.c.createdAt || '').localeCompare(String(p.c.createdAt || '')) || (p.key < q.key ? -1 : 1)).map(x => x.c));
                const sg = view.seg.get(ws);
                if (sg && alive(sg) && sg.f.v && sg.f.v.v !== undefined) writes += write('mm_segments_' + ws, sg.f.v.v);
            }
            const cur = S.getItem('mm_workspace_current');
            if (cur && !aliveWs.has(cur) && wsIds.length) { S.setItem('mm_workspace_current', wsIds.find(id => id !== UNSCH) || wsIds[0]); writes++; }
            const ha = view.set.get('homeAddress');
            if (ha && alive(ha) && ha.f.v && typeof ha.f.v.v === 'string') {
                let st = {}; try { st = JSON.parse(S.getItem('mm_settings') || '{}'); } catch (e) { st = null; }
                if (isObj(st) && st.homeAddress !== ha.f.v.v) { st.homeAddress = ha.f.v.v; S.setItem('mm_settings', JSON.stringify(st)); writes++; }
            }
            return writes;
        }
        function clocksOf(view, now) {
            const cl = {};
            for (const coll of COLLS) {
                cl[coll] = {};
                for (const [key, r] of view[coll]) {
                    if (!alive(r) && now - r.d > TOMB_KEEP_MS) continue;
                    const f = {}; if (alive(r)) for (const n of Object.keys(r.f)) f[n] = [r.f[n].t, r.f[n].h];
                    cl[coll][key] = alive(r) ? { a: r.a, f } : { a: r.a, d: r.d, f };
                }
            }
            return cl;
        }
        function docOf(view, deviceId, savedAt, now) {
            const recs = {};
            for (const coll of COLLS) {
                recs[coll] = {};
                for (const [key, r] of view[coll]) {
                    if (alive(r)) { const f = {}; for (const n of Object.keys(r.f)) f[n] = r.f[n].v === undefined ? [r.f[n].t] : [r.f[n].t, r.f[n].v]; recs[coll][key] = { a: r.a, f }; }
                    else if (now - r.d <= TOMB_KEEP_MS) recs[coll][key] = { a: r.a, d: r.d };   // 削除の印だけ(中身は送らない)
                }
            }
            return { app: APP, v: V, deviceId, savedAt, recs };
        }

        const withTimeout = (p) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(fail('timeout')), timeoutMs); p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });
        const errCode = e => e && typeof e.code === 'string' && /^[a-z_]{1,40}$/.test(e.code) ? e.code : 'unexpected';

        // massDelete: 'ask'(既定。多くの削除は止めて確認) / 'allow'(伝える) / 'restore'(消えた分を他端末から戻す)
        async function syncOnce(opt) {
            const op = opt || {};
            if (!adapter || !adapter.available || !adapter.available().connected) return { ok: false, code: 'not_connected' };
            const now = nowMs();
            let st, local;
            try { st = loadState(); local = readLocal(); } catch (e) { return { ok: false, code: e.code === 'state_corrupt' ? 'state_corrupt' : 'local_corrupt' }; }
            if (local.fixIds.length) { fixMissingIds(local.fixIds); local = readLocal(); }
            const first = !st.clocks;
            if (first || op.massDelete === 'restore') {
                if (typeof o.backup === 'function' && !st.backupAt) {
                    try { await o.backup(); } catch (e) { return { ok: false, code: 'backup_failed' }; }
                    st.backupAt = new Date(now).toISOString(); saveState(st);
                }
            }
            const clocks = st.clocks || {};
            if (op.massDelete === 'restore') for (const coll of COLLS) for (const k of Object.keys(clocks[coll] || {})) if (!local.out[coll].has(k)) delete clocks[coll][k];
            const { view, deleted } = stamp(local, clocks, now, first);
            const aliveBefore = Object.values(clocks.cust || {}).filter(r => !r.d).length;
            if (!first && op.massDelete !== 'allow' && deleted.cust.length >= 5 && deleted.cust.length > aliveBefore * 0.3) return { ok: false, code: 'mass_delete', count: deleted.cust.length };
            // 他の端末のファイル
            let files;
            try { files = await withTimeout(adapter.list()); } catch (e) { return { ok: false, code: errCode(e) }; }
            const mine = files.filter(f => f.deviceId === st.deviceId);
            const others = files.filter(f => f.deviceId !== st.deviceId && DEVICE_RE.test(String(f.deviceId))).slice(0, MAX_FILES);
            const warnings = []; let dropped = 0;
            const conflicts = { n: 0 }; const fromRemote = new Set();
            let added = 0, changed = 0;
            for (const f of others) {
                let doc;
                try { doc = parseDoc(await withTimeout(adapter.read(f)), f.deviceId, now); } catch (e) { warnings.push('file_unreadable'); continue; }
                if (!doc.ok) { warnings.push(doc.code === 'newer_version' ? 'newer_version' : 'file_invalid'); continue; }
                dropped += doc.dropped;
                for (const coll of COLLS) for (const [key, r] of doc.recs[coll]) {
                    const cur = view[coll].get(key);
                    if (!cur) { if (alive(r)) { fromRemote.add(key); if (coll === 'cust') added++; } view[coll].set(key, r); continue; }
                    const m = mergeRec(cur, r, first ? conflicts : null);
                    if (coll === 'cust' && hashOf(JSON.stringify(m)) !== hashOf(JSON.stringify(cur))) changed++;
                    view[coll].set(key, m);
                }
            }
            if (dropped) warnings.push('records_dropped');
            const mfMerged = mfMerge(view, fromRemote, now);
            // 書く前にもう一度、手元が変わっていないか(同期中の編集を消さない)
            let again; try { again = readLocal(); } catch (e) { return { ok: false, code: 'local_corrupt' }; }
            for (const coll of COLLS) {
                if (again.out[coll].size !== local.out[coll].size) return { ok: false, code: 'busy_local' };
                for (const [k, v] of again.out[coll]) if (!local.out[coll].has(k) || enc(sanitize(v)) !== enc(sanitize(local.out[coll].get(k)))) return { ok: false, code: 'busy_local' };
            }
            let writes;
            try { writes = applyView(view, local); } catch (e) { return { ok: false, code: 'write_failed' }; }
            st.clocks = clocksOf(view, now);
            // 保存領域に書いた結果で要約を作り直す(書いた値=要約、のずれを無くす)
            try { const after = readLocal(); const re = stamp(after, st.clocks, now, false); st.clocks = clocksOf(re.view, now); } catch (e) { /* 次回やり直す */ }
            saveState(st);
            // 自分のファイルを出す
            let pushed = false;
            const docText = JSON.stringify(docOf(view, st.deviceId, new Date(now).toISOString(), now));
            const ph = hashOf(docText.replace(/"savedAt":"[^"]*"/, ''));
            if (docText.length > MAX_FILE_BYTES) warnings.push('too_large');
            else if (ph !== st.pushHash || !mine.length) {
                try {
                    const fileId = (mine.find(f => f.id === st.fileId) || mine[0] || {}).id || null;
                    const res = await withTimeout(adapter.write({ fileId, deviceId: st.deviceId, savedAt: new Date(now).toISOString(), text: docText }));
                    const st2 = loadState(); st2.fileId = res && res.id || fileId; st2.pushHash = ph; saveState(st2); pushed = true;
                } catch (e) { warnings.push('push_failed'); }
            }
            const stats = { added, changed, deletedHere: deleted.cust.length, mfMerged, writes, pushed, devices: others.length, conflicts: conflicts.n, first };
            return { ok: true, stats, warnings: [...new Set(warnings)] };
        }
        async function sync(opt) {
            if (running) return { ok: false, code: 'busy' };
            running = syncOnce(opt).catch(() => ({ ok: false, code: 'unexpected' }));
            try { const r = await running; last = { ok: r.ok, code: r.code || '', at: nowMs(), stats: r.stats || null, warnings: r.warnings || [], count: r.count }; return r; }
            finally { running = null; }
        }
        // 変更の検知用(対象のキーの中身の要約)
        function fingerprint() {
            const ks = keys().filter(k => /^mm_(workspaces|settings|(customers|routes|segments|expenses)_.+)$/.test(k)).sort();
            let s = ''; for (const k of ks) { const v = S.getItem(k); s += k + '=' + hashOf(String(v)) + ';'; }
            return hashOf(s);
        }
        // 通信なしで「いつ変えたか」だけ記録する(数秒ごとに呼ぶ)。オフラインで編集しても、編集した頃の時刻で比べられる。
        function checkpoint() {
            if (running) return { ok: false, code: 'busy' };
            try {
                const st = loadState(); if (!st.clocks) return { ok: false, code: 'not_started' };
                const local = readLocal(); if (local.fixIds.length) return { ok: false, code: 'needs_sync' };
                const now = nowMs();
                const { view, deleted } = stamp(local, st.clocks, now, false);
                const aliveBefore = Object.values(st.clocks.cust || {}).filter(r => !r.d).length;
                if (deleted.cust.length >= 5 && deleted.cust.length > aliveBefore * 0.3) return { ok: false, code: 'mass_delete', count: deleted.cust.length };
                const next = clocksOf(view, now);
                if (JSON.stringify(next) !== JSON.stringify(st.clocks)) { st.clocks = next; saveState(st); return { ok: true, changed: true }; }
                return { ok: true, changed: false };
            } catch (e) { return { ok: false, code: 'local_corrupt' }; }
        }
        // 「受け取る」で丸ごと入れ替えた後: 次の同期を初回扱いにする(消えた分を削除として伝えない)
        function rebase() { try { const st = loadState(); st.clocks = null; saveState(st); return true; } catch (e) { return false; } }
        function status() { let st = null; try { st = JSON.parse(S.getItem(STATE_KEY) || 'null'); } catch (e) { st = null; } return { ...last, running: !!running, everSynced: !!(st && st.clocks), backupAt: st && st.backupAt || '' }; }
        return { sync, status, fingerprint, rebase, checkpoint };
    }
    return { create, parseDoc, APP, STATE_KEY, MAX_FILE_BYTES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DataSync;
