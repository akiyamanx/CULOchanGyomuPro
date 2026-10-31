// [端末間の処理済み台帳の同期] スマホとタブレットで同じメール・添付を二重に登録しないための仕組み。
//
// ■ 方針(仕様書 §11 / §19)
//   ・端末ごとに台帳ファイル1つ(CULOchan-mail-ledger-<端末ID>.json)を Drive の appDataFolder に置く。書くのはその端末だけ
//     (1ファイル=書き手1人なので、同時書き込みで壊れない)。読むときに全端末分を合わせる。
//   ・中身は「メッセージID/添付ID・結果の種別・処理日時」と、メールBOXの行(rows: 件名・差出人の表示名・理由・読めた項目・状態・★)。
//     2026-10-30 本人の要望で、スマホとタブレットのBOXの中身を揃えるため rows を追加(Drive の appDataFolder=このアプリ専用の非公開領域)。
//     メールアドレス・本文・添付ファイルそのものは入れない。台帳は180日で期限切れ。
//   ・rows を持たない古いファイル・rows を知らない古いアプリとも互換(v は 1 のまま。古いアプリは rows を読み飛ばす)。
//   ・同期は「補助」: 通信の失敗・壊れたファイル・時間切れでも、取り込みは止めずローカルの判定で続け、画面に警告を出す。
//   ・両端末が同時に取り込んで二重登録になった場合は、次の同期で検出して警告する(自動では消さない)。
//
// ■ 契約
//   台帳ファイル: {app:'CULOchanMailLedger1', v:1, deviceId, savedAt, entries:{ "<messageId>/<attachmentId>": {r, at} }, rows?:[BOXの行] }
//     r ∈ registered|applied|unreadable|reference|dismissed|cancelled|excluded / at は ISO 8601 / 1ファイル512KB・5000件まで。
//   アダプタ(差し替え可能。実Driveは map/mail-ledger-drive.js、テストはモック):
//     available() → {connected:boolean}
//     list()  → Promise<[{id, deviceId, savedAt, size}]>
//     read({id,...}) → Promise<string>
//     write({fileId|null, deviceId, text, savedAt}) → Promise<{id}>
//     失敗は Error に .code(not_connected|auth_expired|forbidden|network|timeout|too_large|bad_response)を付けて投げる。
//   認証: 資格情報はこのモジュールに一切渡らない(アダプタ側の接続が持つ)。ログ・状態に出るのはコードと件数だけ。
//   他の端末のファイルは「信用しない入力」: サイズ・JSON・形式・端末ID・キーの文字・件数・日時・結果の種類を検証し、不正な部分は捨てる。
const MailLedgerSync = (() => {
    const APP = 'CULOchanMailLedger1';
    const KEY_SYNC = 'gyomupro_mail_sync';
    const MAX_FILE_BYTES = 512 * 1024, MAX_DEVICES = 20, DEFAULT_TIMEOUT_MS = 45000;
    const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const CODE_RE = /^[a-z_]{1,40}$/;
    const ADAPTER_CODES = ['not_connected', 'auth_expired', 'forbidden', 'network', 'timeout', 'too_large', 'bad_response', 'aborted', 'http_error', 'bad_url'];
    const MESSAGES = {
        off: 'Googleドライブに未接続です。この端末の記録だけで重複を防いでいます(接続すると、スマホとタブレットで同じメールの二重登録を防げます)。',
        idle: 'まだ同期していません。',
        ok: '同期できています。',
        auth_expired: '共有先の許可が切れました。もう一度接続してください。取り込みはこの端末の記録だけで続けています。',
        forbidden: 'Google Driveを利用できません(許可・保存容量を確認してください)。取り込みはこの端末の記録だけで続けています。',
        timeout: '共有先の応答がありません。取り込みはこの端末の記録だけで続けています。',
        ledger_corrupt: 'この端末の台帳を読めません。取り込みと同期を止めています(データは上書きしていません)。',
        network: '共有先と通信できませんでした。取り込みはこの端末の記録だけで続けています。',
        warn_files: '一部の台帳ファイルを読めませんでした。読めた分だけで重複を防いでいます。',
        warn_conflicts: '同じ依頼書が2台で登録された可能性があります。確認してください。'
    };
    const clean = c => (typeof c === 'string' && CODE_RE.test(c)) ? c : 'unexpected';
    const errCode = e => (e && ADAPTER_CODES.indexOf(e.code) >= 0) ? e.code : 'network';
    const fail = code => Object.assign(new Error(code), { code });
    const hashOf = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + '.' + s.length.toString(36); };
    const newId = uuid => {
        let v = ''; try { v = uuid ? uuid() : ''; } catch (e) { v = ''; }
        if (ID_RE.test(v)) return v;
        if (typeof crypto !== 'undefined' && crypto.randomUUID) { const r = crypto.randomUUID(); if (ID_RE.test(r)) return r; }
        const hex = n => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
    };

    // 台帳ファイルの検証(信用しない入力)。戻り値 {ok, entries, expired, dropped} または {ok:false, code}
    function parseLedgerDoc(text, expectedDeviceId, validate, validateRows) {
        if (typeof text !== 'string') return { ok: false, code: 'bad_format' };
        if (text.length > MAX_FILE_BYTES) return { ok: false, code: 'file_too_large' };
        let doc; try { doc = JSON.parse(text); } catch (e) { return { ok: false, code: 'bad_json' }; }
        if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.app !== APP) return { ok: false, code: 'bad_format' };
        if (doc.v !== 1) return { ok: false, code: 'bad_version' };
        if (typeof doc.deviceId !== 'string' || doc.deviceId !== expectedDeviceId) return { ok: false, code: 'device_mismatch' };
        const v = validate(doc.entries);
        if (v.invalid) return { ok: false, code: 'bad_format' };
        if (v.tooMany) return { ok: false, code: 'too_many' };
        // rows は任意。形が不正なら rows だけ捨てる(台帳は使う)。
        let rows = [], rowsDropped = 0;
        if (doc.rows !== undefined && validateRows) { const rv = validateRows(doc.rows); rows = rv.rows; rowsDropped = rv.dropped; }
        return { ok: true, entries: v.entries, expired: v.expired, dropped: v.dropped, rows, rowsDropped };
    }

    function create(opts) {
        const { mailBox, adapter } = opts;
        const storage = () => opts.storage || (typeof AppStorage !== 'undefined' ? AppStorage : localStorage);
        const nowDate = () => (opts.now ? opts.now() : new Date());
        const nowIso = () => nowDate().toISOString();
        const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
        let busy = false;

        // ---- この端末だけの状態(端末ID・最後の結果)。バックアップには入れない ----
        function loadState(warn) {
            let st = null;
            try {
                const raw = storage().getItem(KEY_SYNC);
                if (raw) { const p = JSON.parse(raw); if (p && typeof p === 'object' && p.v === 1 && ID_RE.test(p.deviceId)) st = p; else warn('state_reset'); }
            } catch (e) { warn('state_reset'); }
            return st || { v: 1, deviceId: newId(opts.uuid) };
        }
        function saveState(st, warn) { try { storage().setItem(KEY_SYNC, JSON.stringify(st)); } catch (e) { if (warn) warn('state_save_failed'); } }
        const peekState = () => { try { const raw = storage().getItem(KEY_SYNC); const p = raw ? JSON.parse(raw) : null; return p && p.v === 1 ? p : null; } catch (e) { return null; } };
        const deviceId = () => { const st = loadState(() => {}); return st.deviceId; };
        const isConnected = () => { try { const a = adapter && adapter.available && adapter.available(); return !!(a && a.connected); } catch (e) { return false; } };

        // ---- 本体(読む → 合わせる → 出す) ----
        async function core(run, warn, state) {
            const guard = () => { if (run.aborted) throw fail('timeout'); };
            const own = mailBox.ownLedger();
            if (!own.ok) return { ok: false, code: own.code || 'ledger_corrupt', stage: 'local' };
            if (!isConnected()) return { ok: false, code: 'not_connected', stage: 'connect' };

            // 1) 読む
            let listed;
            try { listed = await adapter.list(); } catch (e) { return { ok: false, code: errCode(e), stage: 'pull' }; }
            guard();
            if (!Array.isArray(listed)) return { ok: false, code: 'bad_response', stage: 'pull' };
            const files = [];
            for (const f of listed) {
                if (f && typeof f === 'object' && typeof f.id === 'string' && f.id && ID_RE.test(String(f.deviceId)) && Number.isFinite(Number(f.size))) files.push({ ...f, size: Number(f.size), savedAt: typeof f.savedAt === 'string' ? f.savedAt : '' });
                else warn('file_invalid');
            }
            files.sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
            const kept = []; const seen = new Set();
            for (const f of files) {
                if (!seen.has(f.deviceId) && seen.size >= MAX_DEVICES) { warn('too_many_files'); continue; }
                seen.add(f.deviceId); kept.push(f);
            }
            const byDevice = new Map(), rowsByDevice = new Map(); let ownReadOk = true, expired = 0;
            for (const f of kept) {
                const isOwn = f.deviceId === state.deviceId;
                if (f.size > MAX_FILE_BYTES) { warn('file_too_large'); continue; }
                let text;
                try { text = await adapter.read(f); } catch (e) { warn(errCode(e)); if (isOwn) ownReadOk = false; continue; }
                guard();
                const doc = parseLedgerDoc(text, f.deviceId, mailBox.validateEntries, mailBox.validateRows);
                if (!doc.ok) { warn(doc.code); continue; }
                if (doc.dropped) warn('entries_invalid');
                if (doc.rowsDropped) warn('rows_invalid');
                if (doc.rows.length) { const prev = rowsByDevice.get(f.deviceId); if (!prev || (f.savedAt || '') >= prev.savedAt) rowsByDevice.set(f.deviceId, { savedAt: f.savedAt || '', rows: doc.rows }); }
                expired += doc.expired;
                const cur = byDevice.get(f.deviceId) || {};
                for (const [k, e] of Object.entries(doc.entries)) if (!cur[k] || cur[k].at < e.at) cur[k] = e;   // 同じ端末の重複ファイルは新しい記録を採用
                byDevice.set(f.deviceId, cur);
            }

            // 2) 合わせる(自分の記録は優先・他の記録は「他端末由来」印つきで)
            guard();
            const devices = [...byDevice.entries()].map(([id, entries]) => ({ deviceId: id, entries }));
            const merged = mailBox.mergeRemoteLedger(devices, state.deviceId);
            if (!merged.ok) return { ok: false, code: merged.code || 'ledger_corrupt', stage: 'merge' };
            let rowsMerged = { added: 0, updated: 0 };
            if (mailBox.mergeRemoteRows) {
                const mr = mailBox.mergeRemoteRows([...rowsByDevice.entries()].map(([id, v]) => ({ deviceId: id, rows: v.rows })), state.deviceId);
                if (mr && mr.ok) rowsMerged = mr; else warn('rows_merge_failed');
            }
            const rec = mailBox.reconcile();
            if (!rec.ok) warn('reconcile_failed');
            const pulled = { files: kept.length, devices: byDevice.size, added: merged.added + merged.updated, recovered: merged.recovered, expired: expired + (merged.expired || 0), elsewhere: merged.elsewhere, rowsAdded: rowsMerged.added || 0, rowsUpdated: rowsMerged.updated || 0 };

            // 3) 出す(自分のファイルを読めなかった回は上書きしない=記録を縮めない)
            guard();
            const out = { ok: true, code: 'ok', pulled, pushed: false, conflicts: merged.conflicts, stage: 'done' };
            if (!ownReadOk) { warn('push_skipped'); return out; }
            const mine = mailBox.ownLedger();
            if (!mine.ok) return { ...out, ok: false, code: mine.code, stage: 'push' };
            const myRows = mailBox.syncRows ? mailBox.syncRows() : { ok: true, rows: [] };
            if (!myRows.ok) return { ...out, ok: false, code: myRows.code || 'mailbox_corrupt', stage: 'push' };
            const canonical = JSON.stringify([Object.keys(mine.entries).sort().map(k => [k, mine.entries[k].r, mine.entries[k].at]), myRows.rows]);
            const h = hashOf(canonical);
            const ownFile = kept.find(f => f.deviceId === state.deviceId) || null;
            if (ownFile && state.lastPush && state.lastPush.ok && state.lastPush.hash === h) return out;
            const savedAt = nowIso();
            let rowsOut = myRows.rows;
            let text = JSON.stringify({ app: APP, v: 1, deviceId: state.deviceId, savedAt, entries: mine.entries, rows: rowsOut });
            if (text.length > MAX_FILE_BYTES) {   // 大きすぎるとき: まず処理済み行の「読めた項目」を外し、次に古い処理済み行から減らす(★と未確認は残す)
                const keep = r => r.starred === true || (r.bucket === 'unreadable' && r.state === 'new');
                rowsOut = rowsOut.map(r => keep(r) ? r : { ...r, items: undefined });
                text = JSON.stringify({ app: APP, v: 1, deviceId: state.deviceId, savedAt, entries: mine.entries, rows: rowsOut });
                while (text.length > MAX_FILE_BYTES && rowsOut.some(r => !keep(r))) {
                    const i = rowsOut.map((r, j) => ({ r, j })).filter(x => !keep(x.r)).sort((a, b) => a.r.createdAt < b.r.createdAt ? -1 : 1)[0].j;
                    rowsOut = rowsOut.filter((_, j) => j !== i);
                    text = JSON.stringify({ app: APP, v: 1, deviceId: state.deviceId, savedAt, entries: mine.entries, rows: rowsOut });
                }
                warn('rows_trimmed');
            }
            if (text.length > MAX_FILE_BYTES) { warn('too_large'); return { ...out, ok: false, code: 'too_large', stage: 'push', push: { ok: false, code: 'too_large' } }; }
            try {
                const res = await adapter.write({ fileId: ownFile ? ownFile.id : null, deviceId: state.deviceId, text, savedAt });
                guard();
                if (!res || typeof res.id !== 'string' || !res.id) return { ...out, ok: false, code: 'bad_response', stage: 'push', push: { ok: false, code: 'bad_response' } };
                out.pushed = true; out.push = { ok: true, hash: h };
            } catch (e) {
                if (e && e.code === 'timeout' && run.aborted) throw e;
                const code = errCode(e);
                return { ...out, ok: false, code, stage: 'push', push: { ok: false, code } };
            }
            return out;
        }

        async function sync(carry) {
            if (busy) return { ok: false, code: 'busy', pushed: false, conflicts: 0, warnings: [] };
            busy = true;
            const warnings = new Set(Array.isArray(carry) ? carry : []);
            const warn = c => warnings.add(clean(c));
            const run = { aborted: false };
            let result;
            try {
                const state = loadState(warn);
                let timer;
                const outcome = await new Promise(resolve => {
                    timer = setTimeout(() => { run.aborted = true; resolve({ ok: false, code: 'timeout', stage: 'pull' }); }, timeoutMs);
                    core(run, warn, state).then(resolve, e => resolve({ ok: false, code: errCode(e), stage: 'pull' }));
                });
                clearTimeout(timer);
                const at = nowIso();
                const code = clean(outcome.code);
                if (outcome.stage === 'push') { state.lastPull = { at, ok: true }; state.lastPush = { at, ok: false, code }; }
                else if (outcome.ok) {
                    state.lastPull = { at, ok: true, files: outcome.pulled.files, devices: outcome.pulled.devices };
                    if (outcome.pushed) state.lastPush = { at, ok: true, hash: outcome.push.hash };
                    state.lastOkAt = at;
                } else { state.lastPull = { at, ok: false, code }; }
                state.warnings = [...warnings].slice(0, 12);
                saveState(state, warn);
                if (outcome.ok) mailBox.recordEvent('sync_done', { files: outcome.pulled.files, added: outcome.pulled.added, conflicts: outcome.conflicts, pushed: outcome.pushed ? 1 : 0, warnings: warnings.size });
                else if (outcome.code !== 'not_connected') mailBox.recordEvent('sync_failed', { code });
                result = { ok: !!outcome.ok, code, connected: isConnected(), pulled: outcome.pulled || null, pushed: !!outcome.pushed, conflicts: outcome.conflicts || 0, warnings: [...warnings], at };
            } catch (e) {
                result = { ok: false, code: 'unexpected', connected: isConnected(), pulled: null, pushed: false, conflicts: 0, warnings: [...warnings] };
            } finally { busy = false; }
            return result;
        }

        // 取り込み: 先に台帳を読み(失敗しても続行)、取り込み、結果を台帳に出す。同期の失敗は取り込みを止めない。
        async function ingestMails(mails) {
            const pre = await sync();
            let r;
            try { r = mailBox.ingest(mails); } catch (e) { r = { ok: false, code: 'unexpected', mails: 0, registered: 0, skipped: 0, errors: [] }; }
            let post = pre;   // 通信に失敗した回は取り込み後に再試行しない(待たせない)。次の同期で出す
            if (pre.ok && r.ok !== false) post = await sync(pre.warnings);
            return { ...r, sync: post };
        }

        function status() {
            const st = peekState() || {};
            const connected = isConnected();
            const conflicts = mailBox.conflicts().length;
            const info = mailBox.syncInfo();
            const warnings = Array.isArray(st.warnings) ? st.warnings.filter(c => CODE_RE.test(c)) : [];
            const pullFail = st.lastPull && !st.lastPull.ok && st.lastPull.code !== 'not_connected' ? st.lastPull.code : '';
            const pushFail = st.lastPush && !st.lastPush.ok ? st.lastPush.code : '';
            let level = 'ok', message = MESSAGES.ok;
            if (!connected) { level = 'off'; message = MESSAGES.off; }
            else if (pullFail || pushFail) { level = 'error'; message = MESSAGES[pullFail || pushFail] || MESSAGES.network; }
            else if (conflicts) { level = 'warn'; message = MESSAGES.warn_conflicts; }
            else if (warnings.length) { level = 'warn'; message = MESSAGES.warn_files; }
            else if (!st.lastPull) { level = 'idle'; message = MESSAGES.idle; }
            return {
                level, message, connected, deviceId: st.deviceId || '', lastOkAt: st.lastOkAt || '', lastPull: st.lastPull || null, lastPush: st.lastPush ? { at: st.lastPush.at, ok: st.lastPush.ok, code: st.lastPush.code } : null,
                warnings, conflicts, busy,
                remote: { registeredNotHere: info.remoteRegisteredNotHere || 0, unreadableElsewhere: info.remoteUnreadable || 0 }
            };
        }

        return { sync: () => sync(), ingestMails, status, deviceId, isBusy: () => busy };
    }
    return { create, parseLedgerDoc, APP, KEY_SYNC, MAX_FILE_BYTES, MAX_DEVICES, MESSAGES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MailLedgerSync;
