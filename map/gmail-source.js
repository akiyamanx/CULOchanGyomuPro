// [Gmail 取得アダプタ] Gmail API v1 の messages.list / messages.get / attachments.get を、取り込み用の形に直す薄い層。仕様書 §20。
//   ・通信と認証は GmailTransport(読み取り専用・メモリ内トークン)に任せる。ここはURLの組み立て・応答の検証・再試行・上限だけ。
//   ・メール本文は取り出さない。ほしいのは「差出人・件名・受信日時・添付のパート情報」だけ。
//   ・添付の識別は partId 由来のキー(例 p1.2)。attachmentId は取得のたびに変わる(実Gmailで確認済み)ので台帳のキーには使えない。
//   ・失敗は Error に .code だけを付けて投げる(Googleの文言・URL・トークン・件名は持ち越さない)。
//   ※ 実際のGoogleに対する動作は未確認(テストは偽のtransportで、形だけ確認)。
const GmailSource = (() => {
    const API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
    const TERM_RE = /^[\p{L}\p{N}@._+-]{1,80}$/u;
    const ID_RE = /^[0-9a-f]{6,32}$/;
    const ATT_RE = /^[A-Za-z0-9_-]{1,4096}$/;
    const PART_RE = /^[0-9.]{1,40}$/;
    const B64_RE = /^[A-Za-z0-9_-]*={0,2}$/;
    const CODES = ['not_connected', 'auth_expired', 'forbidden', 'scope_missing', 'api_disabled', 'rate_limited', 'server_error', 'not_found', 'http_error', 'timeout', 'aborted', 'bad_url', 'network', 'too_large', 'bad_response'];
    const DEFAULTS = { pageSize: 50, maxPages: 10, maxParts: 100, maxDepth: 8, maxRetries: 12, maxFileName: 200 };
    const err = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
    const mapErr = e => err(e && CODES.indexOf(e.code) >= 0 ? e.code : 'network', { status: e && Number.isFinite(e.status) ? e.status : 0, retryAfterMs: e && Number.isFinite(e.retryAfterMs) ? e.retryAfterMs : 0 });
    const defaultSleep = (ms, signal) => new Promise((resolve, reject) => {
        if (signal && signal.aborted) return reject(err('aborted'));
        const t = setTimeout(resolve, ms); if (t.unref) t.unref();
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(err('aborted')); }, { once: true });
    });
    const cleanName = (s, max) => String(s == null ? '' : s).normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim().slice(0, max);
    // RFC 2047 の符号化語(=?UTF-8?B?...?= など)を元の文字に戻す。戻せないものはそのまま(推測しない)。
    function decodeWords(str) {
        const s = String(str == null ? '' : str);
        if (s.indexOf('=?') < 0) return s;
        return s.replace(/\?=\s+=\?/g, '?==?').replace(/=\?([\w-]{1,40})\?([bBqQ])\?([^?\s]{0,500})\?=/g, (all, cs, enc, text) => {
            try {
                let bytes;
                if (/^b$/i.test(enc)) { if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return all; const bin = atob(text); bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); }
                else { const raw = text.replace(/_/g, ' '); if (/=(?![0-9A-Fa-f]{2})/.test(raw)) return all; const out = []; for (let i = 0; i < raw.length; i++) { if (raw[i] === '=') { out.push(parseInt(raw.slice(i + 1, i + 3), 16)); i += 2; } else out.push(raw.charCodeAt(i) & 0xff); } bytes = Uint8Array.from(out); }
                return new TextDecoder(cs, { fatal: true }).decode(bytes);
            } catch (e) { return all; }
        });
    }
    const headerOf = (headers, name) => { const h = (Array.isArray(headers) ? headers : []).find(x => x && String(x.name).toLowerCase() === name); return h && typeof h.value === 'string' ? h.value : ''; };

    function create(opts = {}) {
        const transport = opts.transport;
        if (!transport || typeof transport.request !== 'function') throw new Error('transport required');
        const L = { ...DEFAULTS, ...(opts.limits || {}) };
        const sleep = opts.sleep || defaultSleep;
        let retriesUsed = 0, requests = 0;

        // 429(Retry-After 優先+指数バックオフ)は最大3回、5xx は2回、通信失敗は1回だけ再試行。実行全体にも上限がある。
        const RETRY = { rate_limited: 3, server_error: 2, network: 1 };
        async function call(url, signal, consume) {
            let attempt = 0;
            for (;;) {
                try { requests++; return await transport.request(url, { signal }, consume); }
                catch (raw) {
                    const e = mapErr(raw);
                    const max = RETRY[e.code] || 0;
                    if (attempt >= max || retriesUsed >= L.maxRetries) throw e;
                    const wait = Math.min(30000, Math.max(e.retryAfterMs || 0, 1000 * Math.pow(2, attempt)));
                    attempt++; retriesUsed++;
                    await sleep(wait, signal);
                }
            }
        }

        function buildQuery({ terms, days } = {}) {
            if (!Array.isArray(terms) || !terms.length || terms.length > 10 || !terms.every(t => typeof t === 'string' && TERM_RE.test(t) && !/^[-+.]/.test(t))) throw err('bad_terms');
            if (!Number.isInteger(days) || days < 1 || days > 366) throw err('bad_days');
            return `has:attachment newer_than:${days}d from:(${terms.join(' OR ')})`;
        }

        async function listMessageIds({ query, maxMessages, signal } = {}) {
            const cap = Math.max(1, Math.min(Number(maxMessages) || 1, 500));
            const ids = [], seenTokens = new Set(); let token = '', pages = 0, truncated = false;
            for (;;) {
                if (pages >= L.maxPages) { truncated = true; break; }
                const params = new URLSearchParams({ q: String(query || ''), maxResults: String(Math.min(L.pageSize, 500)), fields: 'messages(id),nextPageToken' });
                if (token) params.set('pageToken', token);
                const data = await call(API + '?' + params.toString(), signal, r => r.json());
                pages++;
                if (!data || typeof data !== 'object' || Array.isArray(data) || (data.messages !== undefined && !Array.isArray(data.messages))) throw err('bad_response');
                for (const m of data.messages || []) {
                    if (!m || typeof m.id !== 'string' || !ID_RE.test(m.id)) throw err('bad_response');
                    if (ids.length >= cap) { truncated = true; break; }
                    ids.push(m.id);
                }
                if (truncated) break;
                const next = typeof data.nextPageToken === 'string' ? data.nextPageToken : '';
                if (!next) break;
                if (seenTokens.has(next) || next.length > 2000) throw err('bad_response');
                seenTokens.add(next); token = next;
                if (ids.length >= cap) { truncated = true; break; }
            }
            return { ids, truncated, pages };
        }

        async function getMessage(id, { signal } = {}) {
            if (typeof id !== 'string' || !ID_RE.test(id)) throw err('bad_response');
            const data = await call(`${API}/${id}?format=full`, signal, r => r.json());
            if (!data || typeof data !== 'object' || data.id !== id || !data.payload || typeof data.payload !== 'object') throw err('bad_response');
            const attachments = []; let seen = 0, truncated = false;
            const walk = (p, depth) => {
                if (!p || typeof p !== 'object') return;
                if (seen >= L.maxParts) { truncated = true; return; }
                seen++;
                const name = cleanName(decodeWords(p.filename), L.maxFileName);
                const pid = typeof p.partId === 'string' && PART_RE.test(p.partId) ? p.partId : '';
                if (name && pid) {
                    const body = p.body && typeof p.body === 'object' ? p.body : {};
                    attachments.push({ partKey: 'p' + pid, partId: pid, fileName: name, mimeType: String(p.mimeType || '').toLowerCase().slice(0, 120), size: Number.isFinite(body.size) ? body.size : 0, attachmentId: typeof body.attachmentId === 'string' && ATT_RE.test(body.attachmentId) ? body.attachmentId : '' });
                }
                if (Array.isArray(p.parts) && p.parts.length) {
                    if (depth >= L.maxDepth) { truncated = true; return; }
                    for (const c of p.parts) walk(c, depth + 1);
                }
            };
            walk(data.payload, 0);
            const ms = Number(data.internalDate);
            return { id, internalDateMs: Number.isFinite(ms) ? ms : 0, from: cleanName(decodeWords(headerOf(data.payload.headers, 'from')), 300), subject: cleanName(decodeWords(headerOf(data.payload.headers, 'subject')), 300), attachments, partsTruncated: truncated };
        }

        function decode(b64) {
            if (typeof b64 !== 'string' || !B64_RE.test(b64)) throw err('bad_response');
            const std = b64.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
            const bin = (opts.atob || globalThis.atob)(std + '==='.slice((std.length + 3) % 4));
            const out = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
            return out;
        }
        async function downloadAttachment(messageId, attachmentId, { maxBytes, signal } = {}) {
            if (typeof messageId !== 'string' || !ID_RE.test(messageId) || typeof attachmentId !== 'string' || !ATT_RE.test(attachmentId) || !Number.isFinite(maxBytes) || maxBytes < 1) throw err('bad_args');
            return call(`${API}/${messageId}/attachments/${attachmentId}`, signal, async r => {
                const declared = Number(r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-length') : NaN);
                if (Number.isFinite(declared) && declared > Math.ceil(maxBytes * 4 / 3) + 4096) throw err('too_large');
                const data = await r.json();
                if (!data || typeof data !== 'object' || typeof data.data !== 'string') throw err('bad_response');
                if (data.data.length > Math.ceil(maxBytes * 4 / 3) + 8) throw err('too_large');
                const bytes = decode(data.data);
                if (bytes.length > maxBytes) throw err('too_large');
                return bytes;
            });
        }
        // 接続中アカウントのアドレス(「Gmailで開く」の authuser 用)。保存・記録はしない。取れなければ ''。
        async function getProfile({ signal } = {}) {
            try {
                const data = await call(API.replace(/\/messages$/, '/profile'), signal, r => r.json());
                const e = data && typeof data.emailAddress === 'string' ? data.emailAddress : '';
                return /^[^\s@"<>()\\,;:]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(e) ? e : '';
            } catch (e) { return ''; }
        }
        return { buildQuery, listMessageIds, getMessage, getProfile, downloadAttachment, stats: () => ({ requests, retries: retriesUsed }) };
    }
    return { create, DEFAULTS, decodeWords };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = GmailSource;
