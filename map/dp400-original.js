// DP-400月次リストの原本(添付ファイル)を端末内の IndexedDB に残す。
// 判定はメール件名(「○月 DP-400定期メンテナンスリスト」)。ファイルの中身・会社名はログに出さない。
// 保存先は AppProfile.dbName で本番とお試し版を分ける。同期・バックアップには載せない。
const Dp400Original = (() => {
    const LIST_RE = /DP-?400\s*定期メンテナンスリスト/u;
    const MONTH_RE = /(\d{1,2})月\s*DP-?400\s*定期メンテナンスリスト/u;
    const EXTRA_RE = /追加/;
    const KIND_OK = { xls: 1, xlsx: 1, csv: 1, pdf: 1 };
    const MAX_FILE = 8 * 1024 * 1024;
    const MAX_FILES = 40;
    const DB_VERSION = 1;
    const STORE = 'files';
    const LIST_QUERY_PHRASE = 'DP-400定期メンテナンスリスト';

    const norm = s => String(s == null ? '' : s).normalize('NFKC');
    const cleanName = s => norm(s).replace(/[\u0000-\u001f\u007f-\u009f\\/]/g, '').replace(/^-+/, '').slice(0, 200) || 'list.xls';
    function isListMail(subject, fileName) {
        const sub = norm(subject);
        if (LIST_RE.test(sub)) return true;
        const fn = norm(fileName || '');
        return LIST_RE.test(fn);
    }
    function isExtra(subject, fileName) {
        return EXTRA_RE.test(norm(subject)) || EXTRA_RE.test(norm(fileName || ''));
    }
    function tokyoYearMonth(ms) {
        const d = Number.isFinite(ms) ? new Date(ms) : new Date();
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).formatToParts(d);
        const year = Number(parts.find(p => p.type === 'year').value);
        const month = Number(parts.find(p => p.type === 'month').value);
        return { year, month };
    }
    function monthOf(subject, receivedMs) {
        const m = norm(subject).match(MONTH_RE);
        if (!m) return null;
        const listMonth = Number(m[1]);
        if (listMonth < 1 || listMonth > 12) return null;
        const rec = tokyoYearMonth(receivedMs);
        let year = rec.year;
        if (rec.month === 12 && listMonth <= 2) year = rec.year + 1;
        return year + '-' + String(listMonth).padStart(2, '0');
    }
    function kindOf(fileName, mime) {
        const ext = (String(fileName || '').match(/\.([A-Za-z0-9]{1,5})$/) || [])[1];
        const k = ext ? ext.toLowerCase() : '';
        if (KIND_OK[k]) return k;
        const mi = String(mime || '').toLowerCase();
        if (/spreadsheetml|officedocument/.test(mi)) return 'xlsx';
        if (mi === 'application/vnd.ms-excel' || /ms-excel/.test(mi)) return 'xls';
        if (mi === 'application/pdf') return 'pdf';
        if (mi === 'text/csv') return 'csv';
        return '';
    }
    function buildListQuery({ days } = {}) {
        const d = days == null ? 366 : days;
        if (!Number.isInteger(d) || d < 1 || d > 366) {
            const e = Object.assign(new Error('bad_days'), { code: 'bad_days' });
            throw e;
        }
        return 'has:attachment newer_than:' + d + 'd subject:"' + LIST_QUERY_PHRASE + '"';
    }
    function recId(messageId, partKey) {
        return String(messageId || '') + '/' + String(partKey || '');
    }
    function metaOf(rec) {
        if (!rec) return null;
        return { id: rec.id, monthId: rec.monthId, receivedAt: rec.receivedAt, fileName: rec.fileName, mime: rec.mime, kind: rec.kind, extra: !!rec.extra, size: rec.size };
    }

    function memoryStore(init) {
        const m = new Map(init || []);
        return {
            put: async rec => { m.set(rec.id, rec); },
            get: async id => m.get(id) || null,
            all: async () => [...m.values()],
            remove: async id => { m.delete(id); }
        };
    }
    function dbName() {
        const base = 'culo-dp400-originals';
        return (typeof AppProfile !== 'undefined' && AppProfile.dbName) ? AppProfile.dbName(base) : base;
    }
    function idbStore() {
        let opening = null;
        function open() {
            if (opening) return opening;
            opening = new Promise((resolve, reject) => {
                if (typeof indexedDB === 'undefined') return reject(new Error('no_idb'));
                const req = indexedDB.open(dbName(), DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE)) {
                        const st = db.createObjectStore(STORE, { keyPath: 'id' });
                        st.createIndex('monthId', 'monthId', { unique: false });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('idb_open'));
            });
            return opening;
        }
        function withStore(mode, fn) {
            return open().then(db => new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, mode);
                const st = tx.objectStore(STORE);
                let result;
                tx.oncomplete = () => resolve(result);
                tx.onerror = () => reject(tx.error || new Error('idb_tx'));
                Promise.resolve(fn(st)).then(v => { result = v; }).catch(reject);
            }));
        }
        return {
            put: rec => withStore('readwrite', st => st.put(rec)),
            get: id => withStore('readonly', st => new Promise((resolve, reject) => {
                const r = st.get(id); r.onsuccess = () => resolve(r.result || null); r.onerror = () => reject(r.error);
            })),
            all: () => withStore('readonly', st => new Promise((resolve, reject) => {
                const r = st.getAll(); r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error);
            })),
            remove: id => withStore('readwrite', st => st.delete(id))
        };
    }

    function create(opts = {}) {
        const backend = opts.store || (opts.memory ? memoryStore() : idbStore());
        const now = opts.now || (() => Date.now());
        async function evictIfNeeded() {
            const all = await backend.all();
            if (all.length < MAX_FILES) return;
            all.sort((a, b) => (a.receivedAt || 0) - (b.receivedAt || 0));
            const excess = all.length - MAX_FILES + 1;
            for (let i = 0; i < excess; i++) await backend.remove(all[i].id);
        }
        async function save(input) {
            const subject = String(input && input.subject || '');
            const fileName = cleanName(input && input.fileName);
            if (!isListMail(subject, fileName)) return { ok: false, code: 'not_list' };
            const kind = input.kind || kindOf(fileName, input.mime);
            if (!KIND_OK[kind]) return { ok: false, code: 'bad_kind' };
            const raw = input.bytes;
            const bytes = raw instanceof Uint8Array ? raw.slice() : (raw instanceof ArrayBuffer ? new Uint8Array(raw.slice(0)) : null);
            if (!bytes || !bytes.length) return { ok: false, code: 'empty' };
            if (bytes.length > MAX_FILE) return { ok: false, code: 'too_large' };
            const monthId = input.monthId || monthOf(subject, input.receivedMs);
            if (!monthId) return { ok: false, code: 'no_month' };
            const id = recId(input.messageId, input.partKey || 'p1');
            if (!id || id.length < 3) return { ok: false, code: 'bad_id' };
            const rec = {
                id, monthId,
                receivedAt: Number.isFinite(input.receivedMs) ? input.receivedMs : now(),
                subject: subject.slice(0, 200),
                fileName, mime: String(input.mime || '').slice(0, 120), kind,
                extra: isExtra(subject, fileName),
                size: bytes.length,
                bytes
            };
            await evictIfNeeded();
            await backend.put(rec);
            return { ok: true, id, monthId, extra: rec.extra };
        }
        async function has(messageId, partKey) {
            const rec = await backend.get(recId(messageId, partKey));
            return !!rec;
        }
        async function listMonths() {
            const all = await backend.all();
            const set = new Set(all.map(r => r.monthId).filter(Boolean));
            return [...set].sort().reverse();
        }
        async function listForMonth(monthId) {
            const all = await backend.all();
            return all.filter(r => r.monthId === monthId).sort((a, b) => {
                if (!!a.extra !== !!b.extra) return a.extra ? 1 : -1;
                return (a.receivedAt || 0) - (b.receivedAt || 0);
            }).map(metaOf);
        }
        async function get(id) { return backend.get(id); }
        return { save, has, listMonths, listForMonth, get };
    }

    let _default = null;
    const def = () => (_default || (_default = create()));
    const COL_PX = 8;
    const COL_PAD = 12;
    const COL_MIN = 36;
    const COL_MAX = 480;
    const COL_EST_CAP = 36;
    function charWidth(s) {
        let w = 0;
        const t = String(s == null ? '' : s);
        for (let i = 0; i < t.length; i++) w += t.charCodeAt(i) > 255 ? 2 : 1;
        return w;
    }
    function metaColPx(col) {
        if (!col || typeof col !== 'object') return 0;
        if (Number.isFinite(col.wpx) && col.wpx > 0) return col.wpx;
        if (Number.isFinite(col.wch) && col.wch > 0) return col.wch * COL_PX;
        if (Number.isFinite(col.width) && col.width > 0) return col.width * COL_PX;
        return 0;
    }
    function columnWidths(rows, colsMeta) {
        const list = Array.isArray(rows) ? rows : [];
        const meta = Array.isArray(colsMeta) ? colsMeta : [];
        const maxCols = Math.max(1, meta.length, ...list.map(r => Array.isArray(r) ? r.length : 0));
        const out = [];
        for (let i = 0; i < maxCols; i++) {
            let px = metaColPx(meta[i]);
            if (!(px > 0)) {
                let max = 4;
                for (let r = 0; r < list.length; r++) {
                    const cell = list[r] && list[r][i];
                    max = Math.max(max, Math.min(COL_EST_CAP, charWidth(cell)));
                }
                px = max * COL_PX + COL_PAD;
            }
            out.push(Math.max(COL_MIN, Math.min(COL_MAX, Math.round(px))));
        }
        return out;
    }
    const Viewport = {
        MAX_SCALE: 8,
        MIN_FLOOR: 0.1,
        STEP: 1.25,
        fitScale(contentW, contentH, viewW, viewH) {
            if (!(contentW > 0 && contentH > 0 && viewW > 0 && viewH > 0)) return 1;
            return Math.max(this.MIN_FLOOR, Math.min(viewW / contentW, viewH / contentH, 1));
        },
        clampScale(scale, fit) {
            const min = Number.isFinite(fit) && fit > 0 ? Math.max(this.MIN_FLOOR, fit) : this.MIN_FLOOR;
            const s = Number(scale);
            if (!Number.isFinite(s)) return min;
            return Math.min(this.MAX_SCALE, Math.max(min, s));
        },
        clampPan(tx, ty, scale, contentW, contentH, viewW, viewH) {
            const s = Number(scale) > 0 ? Number(scale) : 1;
            const w = contentW * s;
            const h = contentH * s;
            let x = Number(tx);
            let y = Number(ty);
            if (!Number.isFinite(x)) x = 0;
            if (!Number.isFinite(y)) y = 0;
            if (w <= viewW) x = (viewW - w) / 2;
            else x = Math.min(0, Math.max(viewW - w, x));
            if (h <= viewH) y = 0;
            else y = Math.min(0, Math.max(viewH - h, y));
            return { x, y };
        },
        zoomAt(tx, ty, scale, nextScale, cx, cy) {
            const s = Number(scale) > 0 ? Number(scale) : 1;
            const n = Number(nextScale) > 0 ? Number(nextScale) : s;
            return {
                tx: cx - (cx - tx) * (n / s),
                ty: cy - (cy - ty) * (n / s),
                scale: n
            };
        },
        stepScale(scale, direction, fit) {
            const factor = direction > 0 ? this.STEP : (1 / this.STEP);
            return this.clampScale((Number(scale) > 0 ? Number(scale) : 1) * factor, fit);
        },
        pinchScale(startScale, startDist, dist, fit) {
            if (!(startDist > 0) || !Number.isFinite(dist)) return this.clampScale(startScale, fit);
            return this.clampScale((Number(startScale) > 0 ? Number(startScale) : 1) * (dist / startDist), fit);
        },
        distance(a, b) {
            return Math.hypot(((a && a.x) || 0) - ((b && b.x) || 0), ((a && a.y) || 0) - ((b && b.y) || 0));
        },
        midpoint(a, b) {
            return { x: (((a && a.x) || 0) + ((b && b.x) || 0)) / 2, y: (((a && a.y) || 0) + ((b && b.y) || 0)) / 2 };
        }
    };
    function sheetMerges(raw) {
        const out = [];
        if (!Array.isArray(raw)) return out;
        raw.forEach(m => {
            const r = m && (m.r != null ? m.r : m.s && m.s.r);
            const c = m && (m.c != null ? m.c : m.s && m.s.c);
            if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0) return;
            const rowspan = Math.max(1, Number(m.rowspan) || (m.e && Number.isInteger(m.e.r) ? m.e.r - r + 1 : 1));
            const colspan = Math.max(1, Number(m.colspan) || (m.e && Number.isInteger(m.e.c) ? m.e.c - c + 1 : 1));
            out.push({ r, c, rowspan, colspan });
        });
        return out;
    }
    function withTitleSpan(rows, colCount, merges) {
        const list = Array.isArray(merges) ? merges.slice() : [];
        const first = Array.isArray(rows) && rows[0] ? rows[0] : [];
        const filled = [];
        for (let i = 0; i < Math.max(first.length, colCount); i++) {
            if (first[i] != null && String(first[i]) !== '') filled.push(i);
        }
        if (colCount >= 3 && filled.length === 1 && filled[0] === 0 && !list.some(m => m.r === 0 && m.c === 0)) {
            list.push({ r: 0, c: 0, rowspan: 1, colspan: colCount });
        }
        return list;
    }
    function mergeLookup(merges) {
        const skip = Object.create(null);
        const start = Object.create(null);
        (merges || []).forEach(m => {
            const key = m.r + ':' + m.c;
            start[key] = { rowspan: m.rowspan, colspan: m.colspan };
            for (let rr = m.r; rr < m.r + m.rowspan; rr++) {
                for (let cc = m.c; cc < m.c + m.colspan; cc++) {
                    if (rr === m.r && cc === m.c) continue;
                    skip[rr + ':' + cc] = 1;
                }
            }
        });
        return { skip, start };
    }
    function trimTrailingRows(rows) {
        const list = Array.isArray(rows) ? rows.slice() : [];
        while (list.length && (!Array.isArray(list[list.length - 1]) || list[list.length - 1].every(c => c == null || String(c) === ''))) list.pop();
        return list;
    }
    function rowsFromBytes(bytes, kind, fileName) {
        if (typeof XLSX === 'undefined' || !XLSX.read) return { ok: false, code: 'no_xlsx', sheets: [] };
        if (kind === 'pdf') return { ok: false, code: 'pdf', sheets: [] };
        try {
            const book = XLSX.read(bytes, { type: 'array', cellDates: true, raw: false });
            const names = book.SheetNames || [];
            const sheets = names.map(name => {
                const sh = book.Sheets[name];
                const rows = trimTrailingRows(XLSX.utils.sheet_to_json(sh, { header: 1, raw: false, defval: '', blankrows: true }));
                const list = Array.isArray(rows) ? rows : [];
                const colWidths = columnWidths(list, sh && sh['!cols']);
                const merges = withTitleSpan(list, colWidths.length, sheetMerges(sh && sh['!merges']));
                return { name: String(name || '').slice(0, 80), rows: list, colWidths, merges };
            }).filter(s => s.rows.length);
            return { ok: true, sheets, fileName };
        } catch (e) {
            return { ok: false, code: 'read_failed', sheets: [] };
        }
    }
    function fillTable(container, sheets) {
        if (!container) return;
        container.replaceChildren();
        if (!sheets || !sheets.length) {
            container.appendChild(Object.assign(document.createElement('p'), { className: 'dp400-empty', textContent: '表を表示できませんでした。下の「このファイルを保存」から原本を開けます。' }));
            return;
        }
        sheets.forEach((sheet, i) => {
            if (sheets.length > 1) {
                const h = document.createElement('h3');
                h.className = 'dp400-sheet-name';
                h.textContent = sheet.name || ('表' + (i + 1));
                container.appendChild(h);
            }
            const wrap = document.createElement('div');
            wrap.className = 'dp400-table-wrap';
            const table = document.createElement('table');
            table.className = 'dp400-table';
            const rows = Array.isArray(sheet.rows) ? sheet.rows : [];
            const widths = Array.isArray(sheet.colWidths) && sheet.colWidths.length
                ? sheet.colWidths
                : columnWidths(rows, sheet.cols);
            const colCount = Math.max(1, widths.length, ...rows.map(r => Array.isArray(r) ? r.length : 0));
            const merges = withTitleSpan(rows, colCount, sheetMerges(sheet.merges));
            const look = mergeLookup(merges);
            const colgroup = document.createElement('colgroup');
            let total = 0;
            for (let c = 0; c < colCount; c++) {
                const col = document.createElement('col');
                const w = Number(widths[c]) > 0 ? Math.round(widths[c]) : columnWidths([[]], [])[0];
                col.style.width = w + 'px';
                colgroup.appendChild(col);
                total += w;
            }
            table.appendChild(colgroup);
            table.style.width = total + 'px';
            table.style.tableLayout = 'fixed';
            let headerRi = 0;
            for (let i = 0; i < rows.length; i++) {
                const filled = (Array.isArray(rows[i]) ? rows[i] : []).filter(c => c != null && String(c) !== '').length;
                if (filled >= 3) { headerRi = i; break; }
            }
            rows.forEach((row, ri) => {
                const tr = document.createElement('tr');
                const cells = Array.isArray(row) ? row : [];
                const tag = ri === headerRi ? 'th' : 'td';
                for (let c = 0; c < colCount; c++) {
                    if (look.skip[ri + ':' + c]) continue;
                    const cell = document.createElement(tag);
                    const sp = look.start[ri + ':' + c];
                    if (sp) {
                        if (sp.rowspan > 1) cell.rowSpan = sp.rowspan;
                        if (sp.colspan > 1) cell.colSpan = sp.colspan;
                    }
                    cell.textContent = cells[c] == null || cells[c] === '' ? '' : String(cells[c]);
                    tr.appendChild(cell);
                }
                table.appendChild(tr);
            });
            wrap.appendChild(table);
            container.appendChild(wrap);
        });
    }

    async function fetchFromGmail({ source, signal, onProgress, store } = {}) {
        const st = store || def();
        if (!source || typeof source.listMessageIds !== 'function') return { ok: false, code: 'not_connected', saved: 0 };
        const query = buildListQuery({ days: 366 });
        let listed;
        try { listed = await source.listMessageIds({ query, maxMessages: 40, signal }); }
        catch (e) { return { ok: false, code: (e && e.code) || 'network', saved: 0 }; }
        const ids = (listed && listed.ids) || [];
        let saved = 0, skipped = 0, failed = 0;
        for (let i = 0; i < ids.length; i++) {
            if (signal && signal.aborted) return { ok: false, code: 'aborted', saved, skipped, failed };
            if (typeof onProgress === 'function') onProgress({ done: i, total: ids.length });
            let msg;
            try { msg = await source.getMessage(ids[i], { signal }); }
            catch (e) { failed++; continue; }
            if (!isListMail(msg.subject, '')) { skipped++; continue; }
            const atts = (msg.attachments || []).filter(a => KIND_OK[kindOf(a.fileName, a.mimeType)]);
            if (!atts.length) { skipped++; continue; }
            for (const a of atts) {
                if (await st.has(msg.id, a.partKey)) { skipped++; continue; }
                if (!a.attachmentId) { failed++; continue; }
                let bytes;
                try { bytes = await source.downloadAttachment(msg.id, a.attachmentId, { maxBytes: MAX_FILE, signal }); }
                catch (e) { failed++; continue; }
                const r = await st.save({ subject: msg.subject, fileName: a.fileName, mime: a.mimeType, bytes, messageId: msg.id, partKey: a.partKey, receivedMs: msg.internalDateMs, kind: kindOf(a.fileName, a.mimeType) });
                if (r.ok) saved++; else failed++;
            }
        }
        return { ok: true, saved, skipped, failed, truncated: !!(listed && listed.truncated) };
    }

    return {
        LIST_RE, monthOf, isListMail, isExtra, kindOf, buildListQuery, recId, create,
        columnWidths, sheetMerges, withTitleSpan, viewport: Viewport, rowsFromBytes, fillTable, fetchFromGmail,
        save: (...a) => def().save(...a),
        has: (...a) => def().has(...a),
        listMonths: (...a) => def().listMonths(...a),
        listForMonth: (...a) => def().listForMonth(...a),
        get: (...a) => def().get(...a),
        _resetForTest: () => { _default = null; }
    };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Dp400Original;
