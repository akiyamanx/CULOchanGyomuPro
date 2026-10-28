// [メールBOX] 取り込んだメールの仕分け・自動登録・判別不可/通達の保管(機器内のみ)。
// 流れ: 解析結果 → RequestClassifier(依頼書/判別不可/通達) → RequestMonth(登録先の月 or 日程未定) → 訪問先として登録。
// 方針: 取りこぼしゼロ(例外・保存失敗は判別不可に倒す)/二重登録しない/個人情報をログに出さない。
// 保存キー gyomupro_mailbox・gyomupro_mail_ledger はバックアップ許可リスト外(顧客名・件名がDriveに出ない)。
// 端末間の処理済み台帳: 台帳の各記録は {r:結果, at:時刻} 。他の端末から知った記録には x:1 を付け、自分の記録だけを共有する
// (ownLedger)。他の端末の記録の取り込みは mergeRemoteLedger(検証つき)。通信そのものは map/mail-ledger-sync.js が受け持つ。
const MailBox = (() => {
    const KEY_BOX = 'gyomupro_mailbox';
    const KEY_LEDGER = 'gyomupro_mail_ledger';
    const CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;   // 自動登録の取り消し猶予(保守的に24時間)
    const ROW_KEEP_MS = 90 * 24 * 60 * 60 * 1000;   // 通達・処理済み行の保持
    const LEDGER_KEEP_MS = 180 * 24 * 60 * 60 * 1000;
    const MAX_ROWS = 300, MAX_LOG = 40, MAX_CONFLICTS = 50, MAX_LEDGER_ENTRIES = 5000;
    const VALID_RESULTS = ['registered', 'applied', 'unreadable', 'reference', 'dismissed', 'cancelled', 'excluded'];
    // 結果の種別(BOXの区分): 登録 / 判別不可 / 通達 / 対象外 / 取消
    const RESULT_KIND = { registered: '登録', applied: '登録', unreadable: '判別不可', reference: '通達', dismissed: '対象外', excluded: '対象外', cancelled: '取消' };
    const isReg = r => r === 'registered' || r === 'applied';
    const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
    const KEY_RE = /^[^\s\u0000-\u001f\u007f<>"'\\]{1,200}$/u;
    const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const MSG = {
        save: '登録の保存に失敗しました。判別不可BOXから反映し直してください。',
        broken: 'このメールの処理中に問題が起きました。Gmailで直接確認してください。',
        multi: '作業日が複数の月にまたがるか、月を決められません。登録先の月を選んでください。',
        partial: '一部の項目に欠けがあります。確認して月を選んでください。'
    };

    const fail = code => Object.assign(new Error(code), { code });
    const safeCode = e => (e && typeof e.code === 'string' && /^[a-z_]{1,40}$/.test(e.code)) ? e.code : 'unexpected';
    const hash = value => {
        const s = String(value); let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
        return h.toString(36) + '.' + s.length.toString(36);
    };
    const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
    const plain = o => JSON.parse(JSON.stringify(o));
    const MONTH_ID = /^\d{4}-(0[1-9]|1[0-2])$/;
    const baseOf = key => String(key).replace(/\/\d+$/, '');
    const STRIP = ['selected', 'possibleDuplicate', 'warnings', 'previewUrl', 'originalText', 'kind', 'workDateText', 'titleText', 'receivedMonth', 'reviewReason', '_i', 'mailKey', 'mailNeedsReview'];

    // 他の端末から届いた記録(信用しない入力)の検証。通るのは {キー: {r, at}} だけ。余計な項目は捨てる。
    // 戻り値 {entries, dropped, expired, invalid, tooMany}。
    function validateEntries(obj, nowMs) {
        const out = { entries: {}, dropped: 0, expired: 0, invalid: false, tooMany: false };
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { out.invalid = true; return out; }
        const keys = Object.keys(obj);
        if (keys.length > MAX_LEDGER_ENTRIES) { out.tooMany = true; return out; }
        for (const k of keys.sort()) {
            const e = obj[k];
            if (BAD_KEYS.has(k) || !KEY_RE.test(k) || !e || typeof e !== 'object' || Array.isArray(e)
                || VALID_RESULTS.indexOf(e.r) < 0 || typeof e.at !== 'string' || !ISO_RE.test(e.at)) { out.dropped++; continue; }
            const t = Date.parse(e.at);
            if (!Number.isFinite(t) || t - nowMs > 24 * 3600 * 1000) { out.dropped++; continue; }
            if (nowMs - t > LEDGER_KEEP_MS) { out.expired++; continue; }
            out.entries[k] = { r: e.r, at: e.at };
        }
        return out;
    }

    function create(overrides = {}) {
        const deps = () => ({
            storage: overrides.storage || (typeof AppStorage !== 'undefined' ? AppStorage : localStorage),
            data: overrides.data || DataStorage,
            month: overrides.month || RequestMonth,
            classifier: overrides.classifier || RequestClassifier,
            parser: overrides.parser || RequestParser
        });
        const nowDate = () => (overrides.now ? overrides.now() : new Date());
        const nowMs = () => nowDate().getTime();
        const nowIso = () => nowDate().toISOString();
        const uuid = () => overrides.uuid ? overrides.uuid() : (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        const todayTokyo = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowDate());
        const memLog = [];

        // ---------- 保存(壊れたデータは上書きしない) ----------
        function loadBox() {
            const raw = deps().storage.getItem(KEY_BOX);
            if (!raw) return { v: 1, rows: [], log: [] };
            let p; try { p = JSON.parse(raw); } catch (e) { throw fail('mailbox_corrupt'); }
            if (!p || typeof p !== 'object' || !Array.isArray(p.rows) || (p.log !== undefined && !Array.isArray(p.log))) throw fail('mailbox_corrupt');
            p.log = p.log || [];
            return p;
        }
        function loadLedger() {
            const raw = deps().storage.getItem(KEY_LEDGER);
            if (!raw) return { v: 1, entries: {} };
            let p; try { p = JSON.parse(raw); } catch (e) { throw fail('ledger_corrupt'); }
            if (!p || typeof p !== 'object' || !p.entries || typeof p.entries !== 'object' || Array.isArray(p.entries)) throw fail('ledger_corrupt');
            return p;
        }
        function loadAll() { return { box: loadBox(), ledger: loadLedger() }; }
        function saveAll(st) {
            prune(st);
            const { storage } = deps();
            storage.setItem(KEY_BOX, JSON.stringify(st.box));
            try { storage.setItem(KEY_LEDGER, JSON.stringify(st.ledger)); }
            catch (e) { event(null, 'ledger_write_failed', {}); throw fail('ledger_save_failed'); }
        }
        // 記録は「イベント名・件数・コード」だけ(会社名・住所・件名・ファイル名・メッセージIDは入れない)。
        function event(st, name, data) {
            const entry = { at: nowIso(), event: String(name).replace(/[^a-z_]/g, '') };
            for (const [k, v] of Object.entries(data || {})) {
                if (typeof v === 'number' && Number.isFinite(v)) entry[k] = v;
                else if (typeof v === 'string' && /^[a-z0-9_]{1,40}$/.test(v)) entry[k] = v;
            }
            memLog.push(entry); if (memLog.length > MAX_LOG) memLog.shift();
            if (st && st.box) { st.box.log.push(entry); if (st.box.log.length > MAX_LOG) st.box.log.splice(0, st.box.log.length - MAX_LOG); }
            if (/error|failed|corrupt/.test(entry.event) && typeof console !== 'undefined') console.error('mailbox:', entry.event, entry.code || '');
        }
        const keepRow = r => r.bucket === 'unreadable' && r.state === 'new';
        function prune(st) {
            const now = nowMs();
            st.box.rows = st.box.rows.filter(r => keepRow(r) || now - Date.parse(r.createdAt) <= ROW_KEEP_MS);
            if (st.box.rows.length > MAX_ROWS) {
                const keep = st.box.rows.filter(keepRow);
                const rest = st.box.rows.filter(r => !keepRow(r)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, Math.max(0, MAX_ROWS - keep.length));
                const ids = new Set([...keep, ...rest].map(r => r.id));
                st.box.rows = st.box.rows.filter(r => ids.has(r.id));
            }
            if (Array.isArray(st.box.conflicts)) st.box.conflicts = st.box.conflicts.filter(c => now - Date.parse(c.at) <= LEDGER_KEEP_MS).slice(-MAX_CONFLICTS);
            const live = new Set(st.box.rows.map(r => baseOf(String(r.id).replace(/#partial$/, ''))));
            for (const [k, v] of Object.entries(st.ledger.entries)) {
                if (now - Date.parse(v.at) > LEDGER_KEEP_MS && !live.has(k)) delete st.ledger.entries[k];
            }
        }

        // ---------- 訪問先の読み書き ----------
        function monthWorkspaceIds() { return deps().data.getWorkspaces().map(w => w.id); }
        function knownBases() {
            const { data } = deps();
            const bases = new Set();
            for (const id of monthWorkspaceIds()) {
                for (const c of data.getCustomersForWorkspace(id)) if (c && typeof c.mailKey === 'string') bases.add(baseOf(c.mailKey));
            }
            return bases;
        }
        function ensureWorkspace(wsId, allowCreate) {
            const { data } = deps();
            if (monthWorkspaceIds().includes(wsId)) return;
            if (wsId === 'unscheduled') { data.ensureUnscheduledWorkspace(); return; }
            if (!allowCreate) throw fail('month_missing');
            data.createWorkspace(wsId);
        }
        // 複数ワークスペースへ書く。途中で失敗したら書いた分を元に戻す。
        function writeLists(writes) {
            const { data } = deps();
            const done = [];
            try {
                for (const w of writes) { data.saveCustomersForWorkspace(w.ws, w.next); done.push(w); }
            } catch (e) {
                for (const w of done) { try { data.saveCustomersForWorkspace(w.ws, w.prev); } catch (e2) { event(null, 'rollback_failed', {}); } }
                throw fail('write_failed');
            }
        }
        function buildCustomer(item, ws, base, review, noteLead) {
            const c = { ...item };
            STRIP.forEach(k => delete c[k]);
            c.unitCount = Number(item.unitCount) >= 1 ? Math.floor(Number(item.unitCount)) : 1;
            c.id = 'c_' + uuid();
            c.routeId = null; c.status = 'pending'; c.createdAt = nowIso();
            c.mailKey = `${base}/${item._i}`;
            c.appoDate = (typeof item.appoDate === 'string' && item.appoDate.slice(0, 7) === ws) ? item.appoDate : '';
            if (review) { c.mailNeedsReview = true; c.note = (noteLead + (c.note ? '\n' + c.note : '')).slice(0, 2000); }
            return c;
        }
        // groups: { wsId: [item...] } → 重複を除いて登録。戻り値 {added:[{ws,id,h}], duplicates}
        function registerGroups(groups, base, opts = {}) {
            const { data, parser } = deps();
            const writes = [], added = []; let duplicates = 0;
            for (const [ws, items] of Object.entries(groups)) {
                if (!items.length) continue;
                ensureWorkspace(ws, opts.allowCreateMonth || ws === 'unscheduled' || MONTH_ID.test(ws) && opts.autoCreate);
                const prev = data.getCustomersForWorkspace(ws);
                const next = [...prev];
                for (const item of items) {
                    const key = `${base}/${item._i}`;
                    const probe = { ...item, appoDate: (typeof item.appoDate === 'string' && item.appoDate.slice(0, 7) === ws) ? item.appoDate : '' };
                    if (next.some(c => c && (c.mailKey === key || parser.duplicate(probe, c)))) { duplicates++; continue; }
                    const c = buildCustomer(item, ws, base, opts.review, opts.noteLead || '');
                    next.push(c); added.push({ ws, id: c.id, h: hash(JSON.stringify(c)) });
                }
                if (next.length !== prev.length) writes.push({ ws, prev, next });
            }
            writeLists(writes);
            return { added, duplicates };
        }

        // ---------- 行 ----------
        const stripItem = (item, i) => { const c = plain(item); delete c.previewUrl; delete c.originalText; delete c.selected; delete c.possibleDuplicate; c._i = i; return c; };
        function suggest(items) {
            try {
                const { month } = deps();
                const first = items[0]; if (!first) return null;
                const t = month.registrationTarget(month.resolveRegistrationMonth({ workDateText: first.workDateText, titleText: first.titleText, today: todayTokyo() }));
                return t.reviewNeeded ? null : t.workspaceId;
            } catch (e) { return null; }
        }
        function makeRow(id, mail, att, bucket, reason, extra = {}) {
            const items = extra.items || [];
            return {
                id, mailKey: id, bucket, reason: clip(reason, 200), needsAttention: bucket === 'unreadable' || !!extra.attention,
                state: extra.state || (bucket === 'request' ? 'registered' : 'new'),
                receivedDate: /^\d{4}-\d{2}-\d{2}$/.test(String(mail.receivedDate)) ? mail.receivedDate : '',
                subject: clip(mail.subject, 80), fileName: att ? clip(att.fileName, 80) : '', kind: att ? clip(att.kind, 10) : 'none',
                source: mail.source === 'gmail' ? 'gmail' : 'mock', messageId: clip(mail.messageId, 80),
                itemCount: extra.itemCount != null ? extra.itemCount : items.length,
                items: bucket === 'unreadable' && items.length ? items : undefined,
                applicable: bucket === 'unreadable' && items.length > 0 && extra.opened !== false,
                suggested: bucket === 'unreadable' && items.length ? suggest(items) : undefined,
                result: extra.result, createdAt: nowIso()
            };
        }
        const setLedger = (st, base, r) => { st.ledger.entries[base] = { r, at: nowIso() }; };
        function addRow(st, row) {
            if (st.box.rows.some(r => r.id === row.id)) return false;
            st.box.rows.push(row); return true;
        }

        // ---------- 取り込み ----------
        function validateMail(mail) {
            if (!mail || typeof mail !== 'object' || typeof mail.messageId !== 'string' || !mail.messageId.trim()) throw fail('bad_mail');
            if (mail.attachments !== undefined && !Array.isArray(mail.attachments)) throw fail('bad_mail');
            for (const a of mail.attachments || []) if (!a || typeof a !== 'object' || typeof a.attachmentId !== 'string' || !a.attachmentId) throw fail('bad_mail');
        }
        const toClassifierAtt = a => ({ fileName: a.fileName, kind: a.kind, failure: typeof a.parseError === 'string' ? a.parseError : '', opened: !a.parseError && !!a.parse && a.parse.opened !== false, items: a.parse && Array.isArray(a.parse.items) ? a.parse.items : [], warnings: a.parse && a.parse.warnings, headingText: a.parse && a.parse.headingText });

        function processMail(st, known, mail, sum) {
            validateMail(mail);
            const { classifier, month } = deps();
            if (mail.excluded === true) {   // 登録しないと分かっている通知など: 行は作らず、台帳にだけ「対象外」を残す
                const key = `${mail.messageId}/excluded`;
                if (st.ledger.entries[key]) { sum.skipped++; return; }
                setLedger(st, key, 'excluded'); sum.excluded++; return;
            }
            const atts = mail.attachments || [];
            const cls = classifier.classifyMail({ subject: mail.subject, senderKind: mail.senderKind, attachments: atts.map(toClassifierAtt) });
            const units = atts.length ? atts.map((a, i) => ({ att: a, base: `${mail.messageId}/${a.attachmentId}`, cls: cls.results[i] })) : [{ att: null, base: `${mail.messageId}/body`, cls: cls.results[0] }];
            for (const u of units) {
                if (st.ledger.entries[u.base] || known.has(u.base) || st.box.rows.some(r => r.id === u.base || r.id === u.base + '#partial')) {
                    // 訪問先のmailKeyだけが残っている(台帳が無い)場合は、台帳へ「他端末由来(x)」で補う。共有はしない。
                    if (!st.ledger.entries[u.base] && known.has(u.base)) st.ledger.entries[u.base] = { r: 'registered', at: nowIso(), x: 1 };
                    sum.skipped++; continue;
                }
                const parse = u.att && !u.att.parseError && u.att.parse ? u.att.parse : null;
                const opened = !!(parse && parse.opened !== false);
                const items = opened && Array.isArray(parse.items) ? parse.items.map(stripItem) : [];
                if (u.cls.bucket === 'reference') { addRow(st, makeRow(u.base, mail, u.att, 'reference', u.cls.reason)); setLedger(st, u.base, 'reference'); sum.reference++; continue; }
                if (u.cls.bucket === 'unreadable') {
                    addRow(st, makeRow(u.base, mail, u.att, 'unreadable', u.cls.reason, { items, opened }));
                    setLedger(st, u.base, 'unreadable'); sum.unreadable++; continue;
                }
                // 依頼書: 揃った項目を登録。欠け・月が決まらない項目は判別不可の行へ。
                const complete = items.filter(i => !classifier.missingOf(i).length);
                const incomplete = items.filter(i => classifier.missingOf(i).length);
                const received = /^\d{4}-\d{2}-\d{2}$/.test(String(mail.receivedDate)) ? mail.receivedDate : undefined;
                let plan;
                try {
                    plan = month.routeItems(complete, { today: todayTokyo(), receivedDate: received });
                    const reg = registerGroups(plan.workspaces, u.base, { autoCreate: true });
                    const left = [...incomplete, ...plan.review];
                    if (reg.added.length || reg.duplicates) {
                        const result = { workspaces: {}, duplicates: reg.duplicates, customers: reg.added, at: nowIso() };
                        reg.added.forEach(a => { result.workspaces[a.ws] = (result.workspaces[a.ws] || 0) + 1; });
                        addRow(st, makeRow(u.base, mail, u.att, 'request', u.cls.reason, { attention: u.cls.needsAttention, itemCount: items.length, result }));
                        setLedger(st, u.base, 'registered');
                    } else setLedger(st, u.base, 'unreadable');
                    if (left.length) {
                        const why = plan.review.length ? (plan.review[0].reviewReason || MSG.multi) : MSG.partial;
                        addRow(st, makeRow(u.base + '#partial', mail, u.att, 'unreadable', why, { items: left, opened: true }));
                        sum.unreadable++;
                    }
                    sum.registered += reg.added.length; sum.duplicates += reg.duplicates;
                } catch (e) {
                    // 登録に失敗: 何も登録されていない(ロールバック済み)ので、全項目を判別不可へ回して反映できるようにする。
                    event(st, 'register_failed', { code: safeCode(e) });
                    sum.errors.push(safeCode(e));
                    addRow(st, makeRow(u.base, mail, u.att, 'unreadable', MSG.save, { items, opened: true }));
                    setLedger(st, u.base, 'unreadable'); sum.unreadable++;
                }
            }
        }

        function ingest(mails) {
            const sum = { ok: true, mails: 0, skipped: 0, registered: 0, duplicates: 0, unreadable: 0, reference: 0, excluded: 0, errors: [] };
            let st, known;
            try { st = loadAll(); known = knownBases(); }
            catch (e) { const code = safeCode(e) === 'unexpected' ? 'customers_unreadable' : safeCode(e); event(null, 'ingest_blocked', { code }); return { ...sum, ok: false, code }; }
            for (const mail of Array.isArray(mails) ? mails : []) {
                sum.mails++;
                try { processMail(st, known, mail, sum); }
                catch (e) {
                    const code = safeCode(e);
                    sum.errors.push(code); event(st, 'mail_error', { code });
                    const id = (mail && typeof mail.messageId === 'string' && mail.messageId) ? `${clip(mail.messageId, 80)}/mail` : `unknown/${uuid()}`;
                    const m = (mail && typeof mail === 'object') ? mail : {};
                    if (addRow(st, makeRow(id, m, null, 'unreadable', MSG.broken, { items: [], opened: false }))) { setLedger(st, id, 'unreadable'); sum.unreadable++; }
                }
            }
            event(st, 'ingest_done', { mails: sum.mails, registered: sum.registered, duplicates: sum.duplicates, unreadable: sum.unreadable, reference: sum.reference, skipped: sum.skipped });
            try { saveAll(st); }
            catch (e) { sum.ok = false; sum.code = safeCode(e); }
            return sum;
        }

        // ---------- 参照 ----------
        function rows() {
            let list; try { list = loadBox().rows; } catch (e) { return []; }
            return plain(list.map((r, i) => ({ r, i })).sort((a, b) => (Date.parse(b.r.createdAt) - Date.parse(a.r.createdAt)) || (b.i - a.i)).map(x => x.r));
        }
        function counts() {
            const c = { unreadable: 0, request: 0, reference: 0, total: 0 };
            for (const r of rows()) {
                if (r.bucket === 'request' && r.state === 'registered') c.request++;
                else if (r.bucket === 'unreadable' && r.state === 'new') c.unreadable++;
                else if (r.bucket === 'reference' && r.state === 'new') c.reference++;
            }
            c.total = c.unreadable + c.request + c.reference;
            return c;
        }
        function health() { try { loadAll(); return { ok: true }; } catch (e) { return { ok: false, code: safeCode(e) }; } }
        function log() { try { return plain(loadBox().log); } catch (e) { return plain(memLog); } }
        function ensureUnscheduled() { deps().data.ensureUnscheduledWorkspace(); }
        function monthOptions() {
            const ids = monthWorkspaceIds().filter(id => MONTH_ID.test(id)).sort().reverse();
            return [...ids.map(id => ({ id, label: id.replace(/^(\d{4})-(\d{2})$/, (_, y, m) => `${y}年${parseInt(m, 10)}月`) })), { id: 'unscheduled', label: '日程未定' }];
        }
        const nextMonth = ym => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
        function suggestNewMonth() {
            const ids = monthWorkspaceIds().filter(id => MONTH_ID.test(id)).sort();
            const cur = todayTokyo().slice(0, 7);
            const latest = ids.length && ids[ids.length - 1] > cur ? ids[ids.length - 1] : cur;
            return nextMonth(latest);
        }

        // ---------- 操作 ----------
        function findRow(st, id) { return st.box.rows.find(r => r.id === id); }
        function applyRows(entries, opts = {}) {
            const out = { ok: true, applied: 0, failed: 0, results: [] };
            let st; try { st = loadAll(); } catch (e) { return { ...out, ok: false, code: safeCode(e) }; }
            for (const ent of Array.isArray(entries) ? entries : []) {
                const res = { rowId: ent && ent.rowId, ok: false };
                try {
                    const row = findRow(st, res.rowId);
                    const ws = ent && ent.workspaceId;
                    if (!row) throw fail('no_row');
                    if (row.bucket !== 'unreadable' || row.state !== 'new') throw fail('not_pending');
                    if (!row.applicable || !Array.isArray(row.items) || !row.items.length) throw fail('not_applicable');
                    if (!(ws === 'unscheduled' || (typeof ws === 'string' && MONTH_ID.test(ws)))) throw fail('invalid_workspace');
                    const base = baseOf(String(row.id).replace(/#partial$/, ''));
                    const reg = registerGroups({ [ws]: row.items }, base, { review: true, noteLead: '【要確認】メールBOXから反映(内容を原本と照合してください)', allowCreateMonth: !!opts.allowCreateMonth });
                    row.state = 'applied'; row.resolvedAt = nowIso();
                    row.result = { workspaces: { [ws]: reg.added.length }, duplicates: reg.duplicates, customers: reg.added, at: nowIso() };
                    setLedger(st, base, 'applied');
                    res.ok = true; res.count = reg.added.length; res.duplicates = reg.duplicates; out.applied++;
                } catch (e) {
                    res.code = safeCode(e) === 'unexpected' ? 'write_failed' : safeCode(e); out.failed++;
                    event(st, 'apply_failed', { code: res.code });
                }
                out.results.push(res);
            }
            event(st, 'apply_done', { applied: out.applied, failed: out.failed });
            try { saveAll(st); } catch (e) { out.ok = false; out.code = safeCode(e); }
            return out;
        }
        function cancelCheck(row) {
            const { data } = deps();
            if (!row || row.bucket !== 'request' || row.state !== 'registered' || !row.result || !Array.isArray(row.result.customers)) return { ok: false, code: 'not_cancellable' };
            if (nowMs() - Date.parse(row.result.at) > CANCEL_WINDOW_MS) return { ok: false, code: 'too_late' };
            let present = 0; const byWs = {};
            for (const ref of row.result.customers) {
                const found = data.getCustomersForWorkspace(ref.ws).find(c => c && c.id === ref.id);
                if (!found) continue;
                if (found.status !== 'pending' || found.routeId || hash(JSON.stringify(found)) !== ref.h) return { ok: false, code: 'changed', present };
                present++; (byWs[ref.ws] = byWs[ref.ws] || new Set()).add(ref.id);
            }
            return { ok: true, present, byWs };
        }
        function registeredStatus(id) {
            const st = (() => { try { return loadAll(); } catch (e) { return null; } })();
            const row = st && findRow(st, id);
            const total = row && row.result && Array.isArray(row.result.customers) ? row.result.customers.length : 0;
            if (!row || row.bucket !== 'request') return { present: 0, total: 0, cancellable: false };
            try {
                const { data } = deps(); let present = 0;
                for (const ref of row.result.customers) if (data.getCustomersForWorkspace(ref.ws).some(c => c && c.id === ref.id)) present++;
                const chk = cancelCheck(row);
                return { present, total, cancellable: chk.ok && present > 0, code: chk.code };
            } catch (e) { return { present: 0, total, cancellable: false, code: 'unreadable' }; }
        }
        function cancelRegistration(id) {
            let st; try { st = loadAll(); } catch (e) { return { ok: false, code: safeCode(e) }; }
            const row = findRow(st, id);
            try {
                const chk = cancelCheck(row);
                if (!chk.ok) { event(st, 'cancel_refused', { code: chk.code }); try { saveAll(st); } catch (e) { /* 記録のみ */ } return chk; }
                const { data } = deps();
                const writes = Object.entries(chk.byWs).map(([ws, ids]) => { const prev = data.getCustomersForWorkspace(ws); return { ws, prev, next: prev.filter(c => !(c && ids.has(c.id))) }; });
                writeLists(writes);
                row.state = 'cancelled'; row.resolvedAt = nowIso();
                setLedger(st, baseOf(String(row.id)), 'cancelled');
                event(st, 'cancel_done', { removed: chk.present });
                saveAll(st);
                return { ok: true, removed: chk.present };
            } catch (e) { const code = safeCode(e) === 'unexpected' ? 'write_failed' : safeCode(e); event(null, 'cancel_failed', { code }); return { ok: false, code }; }
        }
        function mutateRow(id, fn) {
            let st; try { st = loadAll(); } catch (e) { return { ok: false, code: safeCode(e) }; }
            const row = findRow(st, id);
            if (!row) return { ok: false, code: 'no_row' };
            const r = fn(row, st);
            if (!r.ok) return r;
            try { saveAll(st); } catch (e) { return { ok: false, code: safeCode(e) }; }
            return r;
        }
        const dismissRow = id => mutateRow(id, (row, st) => {
            if (row.bucket === 'request' || row.state !== 'new') return { ok: false, code: 'not_pending' };
            row.state = 'dismissed'; row.resolvedAt = nowIso(); setLedger(st, baseOf(String(row.id).replace(/#partial$/, '')), 'dismissed'); return { ok: true };
        });
        const reclassify = id => mutateRow(id, (row, st) => {
            if (row.bucket !== 'reference' || row.state !== 'new') return { ok: false, code: 'not_pending' };
            row.bucket = 'unreadable'; row.needsAttention = true; row.applicable = false;
            row.reason = '通達から戻しました。原本を確認し、必要ならGmailから登録してください。';
            setLedger(st, baseOf(String(row.id)), 'unreadable'); return { ok: true };
        });

        // ---------- 端末間の処理済み台帳 ----------
        const stamp = (e, key) => Date.parse(e.at) || 0;
        // 自分の記録だけ(x印なし・180日以内)。共有ファイルに書くのはこれだけ。
        function ownLedger() {
            let st; try { st = loadLedger(); } catch (e) { return { ok: false, code: safeCode(e) }; }
            const v = validateEntries(Object.fromEntries(Object.entries(st.entries).filter(([, e]) => e && typeof e === 'object' && !e.x)), nowMs());
            return { ok: true, entries: v.entries, count: Object.keys(v.entries).length };
        }
        function addConflict(st, key, kind, keep) {
            const list = st.box.conflicts = Array.isArray(st.box.conflicts) ? st.box.conflicts : [];
            if (list.some(c => c.key === key && c.kind === kind)) return false;
            list.push({ key, kind, at: nowIso(), keep: !!keep, ack: false });
            if (list.length > MAX_CONFLICTS) list.splice(0, list.length - MAX_CONFLICTS);
            return true;
        }
        // devices: [{deviceId, entries}] (通信層で形式確認済みでも、ここで再検証する)。selfId: この端末のID。
        function mergeRemoteLedger(devices, selfId) {
            let st; try { st = loadAll(); } catch (e) { return { ok: false, code: safeCode(e) }; }
            const stats = { ok: true, added: 0, updated: 0, recovered: 0, conflicts: 0, elsewhere: 0, expired: 0, dropped: 0 };
            const now = nowMs();
            const list = (Array.isArray(devices) ? devices : []).filter(d => d && typeof d.deviceId === 'string').sort((a, b) => a.deviceId < b.deviceId ? -1 : 1);
            for (const dev of list) {
                const v = validateEntries(dev.entries, now);
                stats.expired += v.expired; stats.dropped += v.dropped;
                for (const key of Object.keys(v.entries)) {
                    const e = v.entries[key];
                    const loc = has(st.ledger.entries, key) ? st.ledger.entries[key] : null;
                    if (dev.deviceId === selfId) {   // 自分の過去の記録: 無ければ(または補った印だけなら)自分のものとして戻す
                        if (!loc || loc.x) { st.ledger.entries[key] = { r: e.r, at: e.at }; stats.recovered++; }
                        continue;
                    }
                    if (!loc) { st.ledger.entries[key] = { r: e.r, at: e.at, x: 1 }; stats.added++; continue; }
                    if (loc.x) { if (e.r !== loc.r && stamp(e) > stamp(loc)) { st.ledger.entries[key] = { r: e.r, at: e.at, x: 1 }; stats.updated++; } continue; }
                    // 自分の記録がある場合は自分を優先。ただし矛盾は見つけて知らせる。
                    if (isReg(loc.r) && isReg(e.r)) { if (addConflict(st, key, 'double_registered', selfId < dev.deviceId)) stats.conflicts++; }
                    else if (loc.r === 'unreadable' && isReg(e.r)) {
                        for (const row of st.box.rows) {
                            if (row.state === 'new' && row.bucket === 'unreadable' && (row.id === key || row.id === key + '#partial') && !row.elsewhere) { row.elsewhere = true; stats.elsewhere++; }
                        }
                    }
                }
            }
            event(st, 'ledger_merged', { devices: list.length, added: stats.added, updated: stats.updated, recovered: stats.recovered, conflicts: stats.conflicts, elsewhere: stats.elsewhere });
            try { saveAll(st); } catch (e) { return { ok: false, code: safeCode(e) }; }
            return stats;
        }
        // mailKeyのある訪問先のうち、台帳に記録が無いものを「他端末由来(x)」で補う。台帳が壊れていれば何もしない。
        function reconcile() {
            let st, known;
            try { st = loadAll(); known = knownBases(); } catch (e) { return { ok: false, code: safeCode(e) === 'unexpected' ? 'customers_unreadable' : safeCode(e) }; }
            let backfilled = 0;
            for (const base of known) {
                if (!has(st.ledger.entries, base) && KEY_RE.test(base) && !BAD_KEYS.has(base)) { st.ledger.entries[base] = { r: 'registered', at: nowIso(), x: 1 }; backfilled++; }
            }
            if (backfilled) { event(st, 'ledger_reconciled', { backfilled }); try { saveAll(st); } catch (e) { return { ok: false, code: safeCode(e) }; } }
            return { ok: true, backfilled };
        }
        // 他端末の記録のうち、この端末ではまだ反映されていない件数など(画面表示用)。
        function syncInfo() {
            const info = { ok: true, remoteRegisteredNotHere: 0, remoteUnreadable: 0, ownCount: 0, remoteCount: 0 };
            let st, known; try { st = loadLedger(); known = knownBases(); } catch (e) { return { ...info, ok: false }; }
            for (const [key, e] of Object.entries(st.entries)) {
                if (!e || typeof e !== 'object') continue;
                if (!e.x) { info.ownCount++; continue; }
                info.remoteCount++;
                if (isReg(e.r) && !known.has(key)) info.remoteRegisteredNotHere++;
                else if (e.r === 'unreadable') info.remoteUnreadable++;
            }
            return info;
        }
        function conflicts() { try { return plain((loadBox().conflicts || []).filter(c => c && !c.ack)); } catch (e) { return []; } }
        const ackConflict = (key, kind) => {
            let st; try { st = loadAll(); } catch (e) { return { ok: false, code: safeCode(e) }; }
            const c = (st.box.conflicts || []).find(x => x.key === key && x.kind === kind);
            if (!c) return { ok: false, code: 'no_conflict' };
            c.ack = true;
            try { saveAll(st); } catch (e) { return { ok: false, code: safeCode(e) }; }
            return { ok: true };
        };
        // 同期層から動作記録を残すための口(名前・数値・コードだけ。保存失敗でも例外にしない)。
        function recordEvent(name, data) {
            let st = null; try { st = loadAll(); } catch (e) { st = null; }
            event(st, name, data);
            if (st) { try { saveAll(st); } catch (e) { /* 記録のみ */ } }
        }

        // 取り込み済みのキー(台帳・登録済み訪問先・BOXの行)だけを返す。Gmail取り込みが「再ダウンロードしない」判断に使う。読み取りのみ。
        function processedBases(list) {
            if (!Array.isArray(list)) return [];
            let st, known; try { st = loadAll(); known = knownBases(); } catch (e) { return []; }
            return list.filter(b => typeof b === 'string' && b.length < 200 && (Object.prototype.hasOwnProperty.call(st.ledger.entries, b) || known.has(b) || st.box.rows.some(r => r.id === b || String(r.id).startsWith(b + '/') || r.id === b + '#partial')));
        }
        return { processedBases, ingest, rows, counts, health, log, ensureUnscheduled, monthOptions, suggestNewMonth, nextMonth, applyRows, cancelRegistration, registeredStatus, dismissRow, reclassify,
            ownLedger, mergeRemoteLedger, reconcile, syncInfo, conflicts, ackConflict, recordEvent, validateEntries: o => validateEntries(o, nowMs()) };
    }
    return { create, validateEntries, KEY_BOX, KEY_LEDGER, CANCEL_WINDOW_MS, LEDGER_KEEP_MS, MAX_LEDGER_ENTRIES, VALID_RESULTS, RESULT_KIND };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MailBox;
