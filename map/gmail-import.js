// [Gmail取り込み] 取得アダプタ(GmailSource)・リーダー(RequestReader)・メールBOX(MailBox)・台帳同期(MailLedgerSync)をつなぐ流れ。仕様書 §20。
//   一覧 → 1通ずつ取得 → 差出人・期間の再確認 → 添付の仕分け(開く前に弾けるものは弾く) → ダウンロード → 中身の確認 → 解析 → BOXへ(20通ずつ)。
//   ・既読/未読には頼らない。取り込み済みかどうかは台帳のキー(メールID/partId)だけで決める。
//   ・メールの本文・件名・ファイル名・差出人・トークンは、結果・進捗・記録のどれにも出さない(出すのは名前と件数だけ)。
//   ・止めるべき失敗(認証切れ・利用上限・権限など)は、そこまでの分を取り込んで止まる。一時的な失敗は1通だけ飛ばし、次回また取りに行く。
//   ・取得したものはすべて「信用しないデータ」として扱う(拡張子・MIME・先頭バイト・サイズを確認してから開く)。
const GmailImport = (() => {
    const DEFAULT_LIMITS = { maxMessages: 100, maxAttachmentBytes: 10 * 1024 * 1024, maxTotalBytes: 60 * 1024 * 1024, maxAttachmentsPerMail: 20, batchSize: 20, maxConsecutiveFailures: 3 };
    const STOP_CODES = ['auth_expired', 'rate_limited', 'forbidden', 'scope_missing', 'api_disabled', 'not_connected', 'aborted', 'bad_url'];
    const EXT_KIND = { pdf: 'pdf', xls: 'xls', xlsx: 'xlsx', csv: 'csv', jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image', heif: 'image', bmp: 'image', tif: 'image', tiff: 'image', tnef: 'tnef' };
    const MIME_OK = {
        pdf: /^application\/(x-)?pdf$/, xls: /^application\/(vnd\.ms-excel|excel|x-excel|x-msexcel)$/,
        xlsx: /^application\/(vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet|vnd\.ms-excel|x-zip-compressed|zip)$/,
        csv: /^(text\/(csv|plain|comma-separated-values)|application\/(csv|vnd\.ms-excel))$/, image: /^image\/[a-z0-9.+-]+$/
    };
    const GENERIC_MIME = /^(application\/octet-stream|binary\/octet-stream|)$/;
    const TNEF_MIME = /^application\/(ms-tnef|vnd\.ms-tnef)$/;
    const MAGIC = {
        pdf: b => find(b, [0x25, 0x50, 0x44, 0x46], 1024),
        xlsx: b => starts(b, [0x50, 0x4b, 0x03, 0x04]),
        xls: b => starts(b, [0xd0, 0xcf, 0x11, 0xe0]) || starts(b, [0x50, 0x4b, 0x03, 0x04]),
        csv: b => { for (let i = 0; i < Math.min(b.length, 4096); i++) if (b[i] === 0) return false; return true; }
    };
    function starts(b, sig) { return b.length >= sig.length && sig.every((x, i) => b[i] === x); }
    function find(b, sig, within) { for (let i = 0; i + sig.length <= Math.min(b.length, within); i++) if (sig.every((x, j) => b[i + j] === x)) return true; return false; }
    const norm = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase();
    const tokyoDate = ms => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const TERM_RE = /^[\p{L}\p{N}@._+-]{1,80}$/u;
    const rep = () => ({
        ok: true, code: '', stage: '', found: 0, truncated: false, stoppedBy: '', mails: 0, knownMails: 0, failedMails: 0, skippedSender: 0, skippedOld: 0, senderUnverified: 0, bytes: 0,
        attachments: { downloaded: 0, parsedOk: 0, parseFailed: 0, tnef: 0, tooLarge: 0, blocked: 0, noBody: 0, imageSkipped: 0, skippedKnown: 0 }, ingest: null
    });

    function create(opts = {}) {
        const { source, reader, mailBox } = opts;
        if (!source || !reader || !mailBox) throw new Error('source, reader and mailBox required');
        const L = { ...DEFAULT_LIMITS, ...(opts.limits || {}) };
        const now = opts.now || (() => Date.now());
        const makeFile = opts.makeFile || ((bytes, name, mime) => new File([bytes], name, { type: mime }));
        const getTerms = () => (typeof opts.getTerms === 'function' ? opts.getTerms() : opts.terms);
        const days = opts.days || 62;
        let running = false;

        async function run({ signal, onProgress } = {}) {
            const out = rep();
            if (running) return { ...out, ok: false, code: 'busy' };
            running = true;
            let ingestedAny = false;
            const progress = (stage, done, total) => { if (typeof onProgress === 'function') { try { onProgress({ stage, done: done | 0, total: total | 0 }); } catch (e) { /* 表示側の失敗は無視 */ } } };
            const fail = (code, stage) => { out.ok = false; out.code = code; out.stage = stage; };
            const aborted = () => !!(signal && signal.aborted);
            try {
                const terms = getTerms();
                if (!Array.isArray(terms) || !terms.length) { fail('no_senders', 'list'); return finish(out); }
                if (!terms.every(t => typeof t === 'string' && TERM_RE.test(t))) { fail('bad_terms', 'list'); return finish(out); }
                if (typeof opts.syncer?.sync === 'function') { try { await opts.syncer.sync(); } catch (e) { /* 台帳の同期は補助。失敗しても取り込みは続ける */ } }
                let query;
                try { query = source.buildQuery({ terms, days }); } catch (e) { fail(safe(e), 'list'); return finish(out); }
                progress('list', 0, 0);
                let listed;
                try { listed = await source.listMessageIds({ query, maxMessages: L.maxMessages, signal }); }
                catch (e) { fail(safe(e), 'list'); return finish(out); }
                out.found = listed.ids.length; out.truncated = !!listed.truncated;
                const termsN = terms.map(norm), oldest = now() - (days + 1) * 86400000;
                let batch = [], consecutive = 0, stop = false;
                const flush = async () => {
                    if (!batch.length) return;
                    const chunk = batch; batch = [];
                    const r = await ingest(chunk);
                    ingestedAny = true;
                    out.mails += chunk.length;
                    const s = out.ingest = out.ingest || {};
                    for (const [k, v] of Object.entries(r || {})) if (typeof v === 'number') s[k] = (s[k] || 0) + v;
                    if (r && r.ok === false && out.ok) { out.ok = false; out.code = typeof r.code === 'string' ? r.code : 'ingest_failed'; out.stage = 'ingest'; stop = true; }
                    else if (r && r.sync && r.sync.ok === false) out.syncOk = false;
                };
                const ingest = async mails => {
                    try { return opts.syncer ? await opts.syncer.ingestMails(mails) : mailBox.ingest(mails); }
                    catch (e) { return { ok: false, code: 'ingest_failed' }; }
                };
                for (let i = 0; i < listed.ids.length && !stop; i++) {
                    if (aborted()) { fail('aborted', 'fetch'); break; }
                    progress('fetch', i, listed.ids.length);
                    const id = listed.ids[i];
                    let msg;
                    try { msg = await source.getMessage(id, { signal }); }
                    catch (e) {
                        const c = safe(e);
                        if (c === 'not_found') continue;
                        if (STOP_CODES.includes(c)) { fail(c, 'fetch'); break; }
                        out.failedMails++; if (++consecutive >= L.maxConsecutiveFailures) { fail(c, 'fetch'); break; }
                        continue;
                    }
                    if (msg.internalDateMs && msg.internalDateMs < oldest) { out.skippedOld++; consecutive = 0; continue; }
                    const v = senderVerdict(msg.from, termsN);
                    if (v === 'no') { out.skippedSender++; consecutive = 0; continue; }
                    if (v === 'unverified') out.senderUnverified++;
                    const built = await buildMail(msg, out, signal);
                    if (built.stop) { if (built.code) fail(built.code, 'fetch'); else { out.truncated = true; out.stoppedBy = 'run_limit'; } break; }
                    if (built.failed) { out.failedMails++; if (++consecutive >= L.maxConsecutiveFailures) { fail(built.failed, 'fetch'); break; } continue; }
                    consecutive = 0;
                    if (built.mail) { batch.push(built.mail); if (batch.length >= L.batchSize) await flush(); }
                }
                if (batch.length) { progress('ingest', listed.ids.length, listed.ids.length); await flush(); }
                return finish(out);
            } finally { running = false; progress('done', out.found, out.found); }
        }

        function finish(out) {
            try {
                mailBox.recordEvent('gmail_import', { ok: out.ok ? 1 : 0, code: out.code && /^[a-z0-9_]{1,40}$/.test(out.code) ? out.code : '', stage: out.stage, found: out.found, mails: out.mails, failed: out.failedMails, truncated: out.truncated ? 1 : 0, skipped_sender: out.skippedSender, tnef: out.attachments.tnef, downloaded: out.attachments.downloaded, bytes: out.bytes });
            } catch (e) { /* 記録のみ */ }
            return out;
        }

        function senderVerdict(from, termsN) {
            const f = norm(from);
            if (termsN.some(t => f.includes(t))) return 'yes';
            if (f.includes('=?')) return 'unverified';      // 符号化されたまま(戻せなかった)。Gmailの検索結果を信じる
            return 'no';
        }

        // 1通ぶんの mail オブジェクトを組み立てる。ダウンロードに失敗したら通常は丸ごと見送る(一部だけ登録しない)。
        async function buildMail(msg, out, signal) {
            const A = out.attachments, atts = [];
            const todo = msg.attachments.slice(0, L.maxAttachmentsPerMail);
            const bases = todo.map(a => `${msg.id}/${a.partKey}`);
            const done = new Set(mailBox.processedBases ? mailBox.processedBases(bases) : []);
            const local = { bytes: 0, counts: rep().attachments };
            let anyNew = false;
            for (let i = 0; i < todo.length; i++) {
                const a = todo[i];
                if (done.has(bases[i])) { local.counts.skippedKnown++; continue; }
                anyNew = true;
                if (signal && signal.aborted) return { stop: true, code: 'aborted' };
                const r = await buildAttachment(a, msg.id, out, local, signal);
                if (r.stop || r.failed) { out.bytes += local.bytes; return r; }
                atts.push(r.att);
            }
            if (msg.attachments.length > todo.length || msg.partsTruncated) {
                if (!done.has(`${msg.id}/p-over`)) { anyNew = true; atts.push({ attachmentId: 'p-over', fileName: '(一部の添付を確認していません)', kind: 'other', parseError: 'over_limit' }); }
            }
            // 全部が取り込み済みなら何も渡さない。新しい添付があれば(取り込み済みの兄弟は省いて)渡す。
            for (const k of Object.keys(local.counts)) A[k] += local.counts[k];
            out.bytes += local.bytes;
            if (!anyNew) { out.knownMails++; return { mail: null }; }
            return { mail: { messageId: msg.id, threadId: typeof msg.threadId === 'string' ? msg.threadId : '', subject: msg.subject, receivedDate: msg.internalDateMs ? tokyoDate(msg.internalDateMs) : '', senderKind: 'registered', source: 'gmail', attachments: atts } };
        }

        async function buildAttachment(a, msgId, out, local, signal) {
            const C = local.counts, key = a.partKey, name = a.fileName;
            const ext = (name.match(/\.([A-Za-z0-9]{1,5})$/) || [])[1];
            const mime = String(a.mimeType || '').toLowerCase();
            const unread = (kind, code, counter) => { if (counter) C[counter]++; return { att: { attachmentId: key, fileName: name, kind, parseError: code } }; };
            // 1) 開く前に分かること
            if (TNEF_MIME.test(mime) || /^winmail\.dat$/i.test(name) || (ext && ext.toLowerCase() === 'tnef')) return unread('tnef', 'tnef_unsupported', 'tnef');
            const kind = ext ? EXT_KIND[ext.toLowerCase()] : '';
            if (!kind) return unread('other', 'type_blocked', 'blocked');
            if (!GENERIC_MIME.test(mime) && !MIME_OK[kind].test(mime)) return unread(kind, 'type_blocked', 'blocked');
            if (kind === 'image') { C.imageSkipped++; return { att: { attachmentId: key, fileName: name, kind, parse: { opened: true, items: [] } } }; }   // 画像は中身を見ない(ダウンロードもしない)
            if (!a.attachmentId) return unread(kind, 'no_body', 'noBody');
            if (a.size > L.maxAttachmentBytes) return unread(kind, 'too_large', 'tooLarge');
            // 2) 1回の取得上限(そのメールは見送り、残りは次回)
            if (out.bytes + local.bytes > 0 && out.bytes + local.bytes + Math.max(a.size, 0) > L.maxTotalBytes) return { stop: true };
            // 3) ダウンロード
            let bytes;
            try { bytes = await source.downloadAttachment(msgId, a.attachmentId, { maxBytes: L.maxAttachmentBytes, signal }); }
            catch (e) {
                const c = safe(e);
                if (c === 'too_large') return unread(kind, 'too_large', 'tooLarge');
                if (STOP_CODES.includes(c)) return { stop: true, code: c };
                return { failed: c };
            }
            C.downloaded++; local.bytes += Math.max(a.size, bytes.length);
            // 4) 中身の確認(拡張子だけを信じない)
            if (!MAGIC[kind](bytes)) return unread(kind, 'content_mismatch', 'blocked');
            // 5) 解析
            let res;
            try { res = await reader.readForMail(makeFile(bytes, name, mime), () => {}, signal); }
            catch (e) { res = null; }
            bytes = null;
            if (!res || res.opened === false) { C.parseFailed++; return { att: { attachmentId: key, fileName: name, kind, parseError: res && typeof res.errorCode === 'string' && /^[a-z_]{1,30}$/.test(res.errorCode) ? res.errorCode : 'read_failed' } }; }
            C.parsedOk++;
            return { att: { attachmentId: key, fileName: name, kind: res.kind && ['pdf', 'xls', 'xlsx', 'csv', 'image'].includes(res.kind) ? res.kind : kind, parse: { opened: true, items: Array.isArray(res.items) ? res.items : [], ocr: res.ocr, warnings: res.warnings, headingText: res.headingText } } };
        }
        return { run, limits: L };
    }
    function safe(e) { const c = e && typeof e.code === 'string' && /^[a-z0-9_]{1,40}$/.test(e.code) ? e.code : 'network'; return c; }
    return { create, DEFAULT_LIMITS, STOP_CODES };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GmailImport;
