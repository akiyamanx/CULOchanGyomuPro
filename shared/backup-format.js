// Versioned, JSON-only transfer format. Never includes credentials or live Google data.
const BackupFormat = (() => {
    const limit = 64 * 1024 * 1024;
    const allowedKey = key => /^(mm_(workspaces|workspace_current|geocache|settings)|mm_(customers|routes|segments|expenses)(_[\w-]+)?|gyomupro_(receipts|parking)|travelExpenseDrafts)$/.test(key);
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const bad = text => { throw new Error(text || 'バックアップの形式が正しくありません。'); };
    function canonical(value) {
        if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
        if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
        return JSON.stringify(value);
    }
    function inspect(value, depth = 0) {
        if (depth > 55) bad('データの階層が深すぎます。');
        if (value === null || ['string', 'boolean'].includes(typeof value)) return;
        if (typeof value === 'number') { if (!Number.isFinite(value)) bad(); return; }
        if (!object(value) && !Array.isArray(value)) bad();
        for (const [key, item] of Object.entries(value)) {
            if (/^(?:__proto__|prototype|constructor|apiKey|geminiApiKey|access_token|refresh_token|client_secret)$/i.test(key)) bad('接続情報や不正な項目を含むファイルは取り込めません。');
            if (/imageDataUrl$/i.test(key) && item && (typeof item !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=\s]+$/.test(item))) bad('写真データの形式を確認してください。');
            inspect(item, depth + 1);
        }
    }
    function rows(value, label) {
        if (!Array.isArray(value) || value.some(row => !object(row) || !['string', 'number'].includes(typeof row.id))) bad(label + 'の形式を確認してください。');
        if (new Set(value.map(row => String(row.id))).size !== value.length) bad(label + 'のIDが重複しています。');
    }
    function validate(payload) {
        if (!object(payload) || Object.keys(payload).sort().join() !== 'drafts,etc,local,parking') bad();
        inspect(payload);
        if (!object(payload.local)) bad();
        for (const [key, raw] of Object.entries(payload.local)) {
            if (!allowedKey(key) || typeof raw !== 'string') bad('対象外の保存データが含まれています。');
            if (key === 'mm_workspace_current') continue;
            let value; try { value = JSON.parse(raw); } catch (_) { bad(key + 'を読み込めません。'); }
            inspect(value);
            if (key === 'mm_settings') {
                if (!object(value) || Object.keys(value).some(k => k !== 'homeAddress') || typeof value.homeAddress !== 'string') bad();
            } else if (/^mm_(segments|geocache)/.test(key)) {
                if (!object(value) && !Array.isArray(value)) bad();
            } else if (!Array.isArray(value)) bad(key + 'が一覧形式ではありません。');
        }
        rows(payload.parking, '駐車場明細'); rows(payload.drafts, '下書き');
        if (!object(payload.etc) || !Array.isArray(payload.etc.records) || !object(payload.etc.days) || typeof payload.etc.selectedDate !== 'string') bad('ETCの形式を確認してください。');
        rows(payload.etc.records, 'ETC明細');
        for (const draft of payload.drafts) {
            if (draft.parkingReceipts && !Array.isArray(draft.parkingReceipts.items)) bad('下書きの写真一覧を確認してください。');
            if (draft.rows !== undefined && !Array.isArray(draft.rows)) bad('下書きの精算行を確認してください。');
        }
        return payload;
    }
    async function hash(value) {
        const bytes = new TextEncoder().encode(canonical(value));
        if (bytes.length > limit) bad('写真を含むバックアップは64MBまでです。');
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    async function create(payload) {
        validate(payload);
        return { format: 'CULOchanBackup', version: 1, createdAt: new Date().toISOString(), sha256: await hash(payload), payload };
    }
    async function verify(bundle) {
        if (!object(bundle) || bundle.format !== 'CULOchanBackup' || bundle.version !== 1 || !/^\d{4}-\d{2}-\d{2}T/.test(bundle.createdAt || '') || !/^[a-f0-9]{64}$/.test(bundle.sha256 || '')) bad('このアプリの写真入りバックアップを選んでください。');
        validate(bundle.payload);
        if (await hash(bundle.payload) !== bundle.sha256) bad('バックアップの内容が変化・破損しています。元のファイルを選び直してください。');
        return bundle;
    }
    async function parse(text) {
        if (new TextEncoder().encode(text).length > limit) bad('ファイルは64MBまでです。');
        let bundle; try { bundle = JSON.parse(text); } catch (_) { bad('JSONファイルを読み込めません。'); }
        return verify(bundle);
    }
    function summary(bundle) {
        const p = bundle.payload, parse = key => JSON.parse(p.local[key] || '[]');
        const visits = Object.keys(p.local).filter(k => /^mm_customers(?:_|$)/.test(k)).reduce((n, key) => n + parse(key).length, 0);
        return `訪問先 ${visits}件・レシート ${parse('gyomupro_receipts').length}件・駐車場 ${p.parking.length}件・下書き ${p.drafts.length + parse('travelExpenseDrafts').length}件・ETC ${p.etc.records.length}件`;
    }
    return { limit, allowedKey, canonical, validate, hash, create, verify, parse, summary };
})();
if (typeof module !== 'undefined') module.exports = BackupFormat;
