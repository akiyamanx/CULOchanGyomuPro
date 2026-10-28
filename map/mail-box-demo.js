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
    return { mails };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MailBoxDemo;
