// [メールBOX 試験用] 架空データ(実在の会社・住所・電話は一切含まない)。URLに ?mailboxDev=1 を付けた時だけ使う。
const MailBoxDemo = (() => {
    const pad = n => String(n).padStart(2, '0');
    function monthAhead(offset) {
        const t = new Date(Date.now() + 9 * 3600 * 1000); // 日本時間の今日
        const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + offset, 1));
        return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
    }
    const item = (o = {}) => ({ company: '', address: '', phone: '', contact: '', managementNo: '', branch: '', equipType: '', filter: '', purpose: '', note: '', appoDate: '', workDateText: '', titleText: '', unitCount: 1, source: 'デモ', kind: '一覧表', warnings: [], ...o });
    function mails() {
        const next = monthAhead(1), next2 = monthAhead(2);
        const dNext = `${next.y}-${pad(next.m)}-10`;
        const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        const ok = (name, addr, extra) => item({ company: name, address: addr, purpose: '修理', ...extra });
        return [
            { messageId: 'demo-1', subject: '【デモ】業務依頼書のご送付', receivedDate: today, senderKind: 'registered', source: 'mock', attachments: [
                { attachmentId: 'a1', fileName: 'デモ_業務依頼書.xlsx', kind: 'xlsx', parse: { opened: true, items: [ok('架空商事株式会社', '東京都架空区サンプル1-2-3', { workDateText: dNext })] } }] },
            { messageId: 'demo-2', subject: '【デモ】作業日未定の依頼', receivedDate: today, senderKind: 'registered', source: 'mock', attachments: [
                { attachmentId: 'a1', fileName: 'デモ_依頼一覧.xlsx', kind: 'xlsx', parse: { opened: true, items: [ok('デモ工業株式会社', '大阪府架空市テスト2-4-6'), ok('サンプル食品株式会社', '愛知県架空町ダミー3-1-1', { purpose: 'メンテナンス' })] } }] },
            { messageId: 'demo-3', subject: '【デモ】依頼書(画像PDF)', receivedDate: today, senderKind: 'registered', source: 'mock', attachments: [
                { attachmentId: 'a1', fileName: 'デモ_業務依頼書_スキャン.pdf', kind: 'pdf', parse: { opened: true, items: [item({ company: '見本サービス', address: '', purpose: '', source: 'デモ.pdf', kind: 'PDF', warnings: ['PDFの読取結果です。原本と照合してください。'] })], ocr: true } }] },
            { messageId: 'demo-4', subject: '【デモ】依頼(一部欠け・月またぎ)', receivedDate: today, senderKind: 'registered', source: 'mock', attachments: [
                { attachmentId: 'a1', fileName: 'デモ_依頼一覧2.xlsx', kind: 'xlsx', parse: { opened: true, items: [
                    ok('テスト物産株式会社', '福岡県架空市ダミー5-5-5', { workDateText: `${next.y}-${pad(next.m)}-20` }),
                    item({ company: 'ダミー運輸', address: '北海道架空郡サンプル7', purpose: '', source: 'デモ.xlsx' }),
                    ok('試験設備株式会社', '宮城県架空市テスト8-8', { workDateText: `${next.m}月5日・${next2.m}月3日` })] } }] },
            { messageId: 'demo-5', subject: '【デモ】開けない添付', receivedDate: today, senderKind: 'registered', source: 'mock', attachments: [
                { attachmentId: 'a1', fileName: 'デモ_壊れたファイル.xls', kind: 'xls', parseError: 'read_failed' }] },
            { messageId: 'demo-6', subject: '【デモ】配置図送付', receivedDate: today, senderKind: 'registered', source: 'mock', attachments: [
                { attachmentId: 'a1', fileName: 'デモ_配置図.pdf', kind: 'pdf', parse: { opened: true, items: [], ocr: true } }] },
            { messageId: 'demo-7', subject: '【デモ】本日の連絡(本文のみ)', receivedDate: today, senderKind: 'registered', source: 'mock', attachments: [] }
        ];
    }
    // 試験用の「偽のドライブ」アダプタ(?mailboxDev=1&mockSync=1 のときだけ使う。Googleには接続しない)。
    // window.__mockLedgerDrive = { files: Map(id→{deviceId,savedAt,text}), connected, fail:'' } を画面確認用に外から操作できる。
    function ledgerAdapter() {
        const drive = window.__mockLedgerDrive = window.__mockLedgerDrive || { files: new Map(), connected: true, fail: '' };
        const fail = () => { if (drive.fail) throw Object.assign(new Error(drive.fail), { code: drive.fail }); };
        return {
            available: () => ({ connected: !!drive.connected }),
            list: async () => { fail(); return [...drive.files.entries()].map(([id, f]) => ({ id, deviceId: f.deviceId, savedAt: f.savedAt, size: f.text.length })); },
            read: async file => { fail(); const f = drive.files.get(file.id); if (!f) throw Object.assign(new Error('bad_response'), { code: 'bad_response' }); return f.text; },
            write: async a => { fail(); const id = a.fileId || ('mock-' + a.deviceId.slice(0, 8)); drive.files.set(id, { deviceId: a.deviceId, savedAt: a.savedAt, text: a.text }); return { id }; }
        };
    }

    // 試験用の「偽のGmail」(?mailboxDev=1&mockGmail=1 のときだけ使う。Googleにも本物のGmailにも接続しない)。
    // 本物の GmailSource・GmailImport は実コードのまま動き、通信(GmailTransport)と解析(リーダー)だけを偽物に替える。
    // window.__mockGmail = { configured, connected, fail:'', calls } を画面確認用に外から操作できる。fail にはエラーコード(auth_expired など)を入れる。
    const defaultTerms = ['試験'];
    function gmail() {
        const mg = window.__mockGmail = window.__mockGmail || { configured: true, connected: false, fail: '', calls: 0 };
        const SIG = { pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], xlsx: [0x50, 0x4b, 0x03, 0x04], xls: [0xd0, 0xcf, 0x11, 0xe0] };
        const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel' };
        const hex = n => 'a0b1c2d3e4f5' + String(n).padStart(4, '0');
        const results = new Map(), msgs = [];
        mails().filter(m => m.attachments.length).forEach((m, i) => {
            const parts = m.attachments.map((a, j) => {
                results.set(a.fileName, a.parseError ? { kind: a.kind, opened: false, items: [], errorCode: a.parseError } : { kind: a.kind, opened: true, items: a.parse.items, ocr: a.parse.ocr });
                return { partId: String(j + 1), fileName: a.fileName, mime: MIME[a.kind], kind: a.kind };
            });
            msgs.push({ id: hex(i + 1), subject: m.subject, parts });
        });
        msgs.push({ id: hex(90), subject: '【デモ】Outlook形式の添付', parts: [{ partId: '1', fileName: 'winmail.dat', mime: 'application/ms-tnef', kind: 'tnef' }] });
        msgs.push({ id: hex(91), subject: '【デモ】現場写真', parts: [{ partId: '1', fileName: 'デモ_現場写真.jpg', mime: 'image/jpeg', kind: 'image' }] });
        const bytesOf = new Map(); let seq = 0;
        const b64url = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const ok = body => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
        const err = (code, status) => Object.assign(new Error(code), { code, status: status || 0 });
        return {
            transport: {
                prepare: async () => {},
                connect: async () => { if (!mg.configured) throw err('not_configured'); if (mg.failConnect) throw err(mg.failConnect); mg.connected = true; return { connected: true }; },
                disconnect: () => { mg.connected = false; },
                state: () => ({ connected: !!mg.connected, configured: !!mg.configured }),
                request: async (url, options, consume) => {
                    mg.calls++;
                    if (!mg.connected) throw err('not_connected');
                    if (mg.fail) { if (mg.fail === 'auth_expired') mg.connected = false; throw err(mg.fail); }
                    const u = new URL(url), path = u.pathname.replace('/gmail/v1/users/me/messages', '');
                    if (path === '') {
                        const max = Math.min(Number(u.searchParams.get('maxResults')) || 50, 500), off = Number(u.searchParams.get('pageToken') || 0) || 0;
                        const slice = msgs.slice(off, off + max);
                        return consume(ok({ messages: slice.map(m => ({ id: m.id })), ...(off + max < msgs.length ? { nextPageToken: String(off + max) } : {}) }));
                    }
                    const am = path.match(/^\/([0-9a-f]+)\/attachments\/([\w-]+)$/);
                    if (am) { const b = bytesOf.get(am[2]); if (!b) throw err('not_found', 404); return consume(ok({ size: b.length, data: b64url(b) })); }
                    const mm = path.match(/^\/([0-9a-f]+)$/);
                    const m = mm && msgs.find(x => x.id === mm[1]);
                    if (!m) throw err('not_found', 404);
                    return consume(ok({ id: m.id, internalDate: String(Date.now() - 86400000), payload: { partId: '', mimeType: 'multipart/mixed', filename: '', headers: [{ name: 'From', value: '"架空 試験" <shiken@example.invalid>' }, { name: 'Subject', value: m.subject }],
                        parts: m.parts.map(p => { const id = 'MOCKATT' + (++seq); const sig = SIG[p.kind] || [0x00]; bytesOf.set(id, Uint8Array.from([...sig, 1, 2, 3, 4])); return { partId: p.partId, mimeType: p.mime, filename: p.fileName, body: { size: sig.length + 4, attachmentId: id } }; }) } }));
                }
            },
            reader: { readForMail: async file => results.get(file.name) || { kind: 'pdf', opened: false, items: [], errorCode: 'read_failed' } },
            makeFile: (bytes, name, mime) => ({ name, size: bytes.length, type: mime, arrayBuffer: async () => bytes.buffer })
        };
    }
    return { mails, ledgerAdapter, gmail, defaultTerms };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MailBoxDemo;
