// Pure parsers. Source documents stay on the device; nothing here writes storage.
const RequestParser = (() => {
    const text = value => String(value ?? '').trim();
    const norm = value => text(value).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    const clean = value => text(value).replace(/[ \u3000]+/g, ' ');
    const unique = values => [...new Set(values.filter(Boolean))];
    const fieldNames = {
        company: ['会社名','顧客名','設置先会社名','設置先名','客先名(工事先)','客先名','設置先','company','名称'],
        address: ['住所','設置先住所','所在地','address'],
        prefecture: ['都道府県','prefecture'],
        phone: ['固定電話','携帯電話','設置先tel','電話番号','電話','tel','phone'],
        contact: ['設置先担当者','担当者','ご担当者','受付担当者','contact'],
        managementNo: ['管理番号','管理no.','管理no','u管理no','シリアル№','シリアルno.'],
        branch: ['営業所','支店','依頼ss名','担当部署名','branch'],
        equipType: ['機種','型式','機種(型式)','浄水器名','本体種類'],
        filter: ['交換フィルター','フィルター','交換フィルタ','filter'],
        purpose: ['目的','作業内容','依頼業務内容','依頼内容','purpose'],
        appointment: ['工事予定日時','アポ日時','作業希望日','工事日','訪問日'],
        note: ['備考','備考(設置先情報)','特記事項','履歴','設置先情報','note','memo']
    };
    function field(label) {
        const key = norm(label).replace(/[.:：]+$/g, '');
        return Object.keys(fieldNames).find(name => fieldNames[name].some(value => norm(value).replace(/[.:：]+$/g, '') === key));
    }
    function purpose(value, fallback = '') {
        const n = norm(value);
        if (/修理/.test(n)) return '修理';
        if (/設置/.test(n)) return '本体設置';
        if (/メンテ|フィルタ|点検|定期/.test(n)) return 'メンテナンス';
        return n ? 'その他' : fallback;
    }
    function appointment(value, time = '') {
        const s = text(value).normalize('NFKC');
        const d = s.match(/(20\d{2}|\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})/);
        const t = (time || s).normalize('NFKC').match(/(?:^|\s|[)）日T])([01]?\d|2[0-3])[:：]([0-5]\d)/);
        if (!d || !t) return ''; // 時刻のない日付や複数日は備考で保持し、時刻を推測しない。
        const year = d[1].length === 2 ? 2000 + Number(d[1]) : Number(d[1]);
        const month = Number(d[2]), day = Number(d[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return '';
        return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T${t[1].padStart(2,'0')}:${t[2]}`;
    }
    function base(source, kind) {
        return {company:'',address:'',phone:'',contact:'',managementNo:'',branch:'',equipType:'',filter:'',purpose:'',note:'',appoDate:'',unitCount:1,source,kind,warnings:[]};
    }
    function parseTable(rows, source) {
        let headerIndex = -1, columns;
        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            const c = {};
            (rows[i] || []).forEach((value, col) => { const f = field(value); if (f && c[f] === undefined) c[f] = col; });
            if (c.company !== undefined && c.address !== undefined) { headerIndex = i; columns = c; break; }
        }
        if (headerIndex < 0) return [];
        const title = rows.slice(0, headerIndex).flat().join(' ');
        const fallback = /メンテ|フィルター交換/.test(title) ? 'メンテナンス' : '';
        const result = [];
        rows.slice(headerIndex + 1).forEach((row, offset) => {
            const address = clean(row[columns.address]);
            const company = clean(row[columns.company]);
            // フッターの挨拶・注記は住所を持たないため候補にしない。
            if (!address || (!company && !/[都道府県市区町村]/.test(address))) return;
            if (field(company) === 'company' && field(address) === 'address') return;
            const item = base(`${source} · ${headerIndex + offset + 2}行`, '一覧表');
            Object.entries(columns).forEach(([key, col]) => { if (!['appointment','prefecture'].includes(key)) item[key] = clean(row[col]); });
            const pref = columns.prefecture !== undefined ? clean(row[columns.prefecture]) : '';
            item.address = pref && !address.startsWith(pref) ? pref + address : address;
            item.purpose = purpose(item.purpose, fallback);
            const details = [];
            (rows[headerIndex] || []).forEach((label, col) => {
                if (!Object.values(columns).includes(col) && text(label) && text(row[col])) details.push(`${clean(label)}: ${clean(row[col])}`);
            });
            if (columns.appointment !== undefined && text(row[columns.appointment])) {
                const raw = text(row[columns.appointment]);
                item.appoDate = appointment(raw);
                details.push(`工事・訪問日（原文）: ${raw}`);
            }
            item.note = unique([item.note, ...details]).join('\n');
            result.push(item);
        });
        return result;
    }
    function parseForm(rows, source) {
        const get = labels => {
            for (const row of rows) for (let c = 0; c < row.length; c++) {
                if (labels.some(label => norm(row[c]) === norm(label))) return {row, col:c, value:clean(row[c+1])};
            }
            return {row:[],col:-1,value:''};
        };
        const company = get(fieldNames.company), addr = get(fieldNames.address);
        // Monthly visit books may also contain a parts order. Its supplier is not a visit.
        if (get(['注文日','発注日']).col >= 0 && get(['商品コード','品番','品名']).col >= 0) return [];
        if (!company.value || field(company.value) || addr.col < 0 || company.row === addr.row) return [];
        const item = base(source, '業務依頼書');
        item.company = company.value;
        const addressParts = [];
        for (let c = addr.col+1; c < addr.row.length; c++) {
            const value = clean(addr.row[c]);
            if (/^(搬入|担当|受付|TEL|電話)/i.test(value)) break;
            if (value) addressParts.push(value);
        }
        item.address = addressParts.join('');
        item.equipType = get(fieldNames.equipType).value;
        item.branch = get(['依頼SS名']).value || get(['担当部署名','営業所']).value;
        item.contact = get(['設置先担当者','ご担当者']).value || get(['受付担当者']).value;
        item.unitCount = Number((get(['台数','数量']).value.match(/\d+/) || [1])[0]) || 1;
        const phones = [];
        rows.forEach(row => row.forEach((value,col) => {
            const v = text(value).normalize('NFKC');
            if (/^(TEL|携帯|電話)/i.test(v)) {
                const combined = v + ' ' + text(row[col+1]);
                const phone = combined.match(/0[\d() -]{8,18}\d/);
                if (phone) phones.push(phone[0].trim());
            }
        }));
        item.phone = unique(phones).join(' / ');
        const work = get(['依頼業務内容','依頼内容']);
        const workIndex = rows.indexOf(work.row);
        const workText = rows.slice(workIndex, workIndex+2).flat().map(text).join(' ');
        const checked = [...workText.matchAll(/[■☑✓]([^□■☑✓]+)/g)].map(m => m[1].trim());
        item.purpose = purpose(checked.length ? checked.join(' ') : work.value);
        const workDate = get(['工事予定日時']);
        const preferred = get(['作業希望日']);
        const dateText = /\d/.test(workDate.value) ? workDate.value : preferred.value;
        item.appoDate = appointment(dateText, get(['時間指定']).value);
        const notes = [];
        rows.forEach(row => row.forEach((value, col) => {
            if (/^(特記事項|備考)/.test(norm(value)) && text(row[col+1])) notes.push(clean(row[col+1]));
        }));
        if (dateText && /\d/.test(dateText)) notes.push(`工事予定・希望日（原文）: ${dateText} ${get(['時間指定']).value}`.trim());
        if (work.col >= 0) {
            const reference = work.row.map(text).find(value => /^MF\d+$/i.test(value));
            if (reference) item.managementNo = reference;
        }
        item.note = unique(notes).join('\n');
        return [item];
    }
    function parseRows(rows, source = '') {
        const table = parseTable(rows, source);
        return table.length ? table : parseForm(rows, source);
    }
    function parsePdfText(raw, source = '') {
        const lines = text(raw).normalize('NFKC').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        // OCRが日本語の間へ入れた空白だけ除去し、英語名の単語区切りは残す。
        const joined = lines.map(line => line.replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])/gu,'')).join('\n');
        const value = (labels, stop = '') => {
            for (const label of labels) {
                const flexible = [...label].join('\\s*');
                const match = joined.match(new RegExp(flexible + '[ :：.]*([^\\n]+)'));
                if (match) return clean(stop ? match[1].split(new RegExp(stop,'i'))[0] : match[1]);
            }
            return '';
        };
        const item = base(source, 'PDF依頼書');
        item.company = value(['設置先名','客先名','会社名'], '設置先担当者|担当者');
        item.address = value(['設置先住所','所在地','住所'], 'TEL|電話|携帯').replace(/^〒?\s*\d{3}[- ]?\d{4}\s*/, '');
        item.contact = value(['設置先担当者','ご担当者']);
        item.phone = (value(['TEL','電話']).match(/0[\d() -]{8,18}\d/) || [''])[0];
        item.equipType = value(['本体種類','機種','浄水器名'], '数量');
        item.managementNo = value(['管理No','管理NO','管理番号']).replace(/^[. :]+/,'');
        if (item.managementNo && !/^[A-Z0-9][A-Z0-9-]{0,30}$/i.test(item.managementNo)) {
            item.managementNo = '';
            item.warnings.push('管理番号を正しく読み取れませんでした。必要に応じて原本から入力してください。');
        }
        item.purpose = purpose(value(['依頼内容','依頼業務内容']));
        if (!item.purpose && /設置業務依頼書/.test(norm(joined))) item.purpose = '本体設置';
        const dateText = value(['設置日','工事予定日時','作業希望日']);
        item.appoDate = appointment(dateText);
        const noteIndex = joined.search(/備\s*考|【\s*(?:物置|本体|電気)/);
        item.note = unique([dateText && `設置・予定日（原文）: ${dateText}`, noteIndex >= 0 ? joined.slice(noteIndex).trim() : '']).join('\n');
        item.warnings.push('PDFの読取結果です。会社名・住所・電話・日程を原本と照合してください。');
        return [item]; // 読めない項目も空欄で表示し、確認画面で補える。
    }
    function duplicate(candidate, existing) {
        if (candidate.sourceKey && existing.sourceKey === candidate.sourceKey) return true;
        if (candidate.managementNo && existing.managementNo && norm(candidate.managementNo) !== norm(existing.managementNo)) return false;
        if (candidate.equipType && existing.equipType && norm(candidate.equipType) !== norm(existing.equipType)) return false;
        return Boolean(norm(candidate.company) && norm(candidate.address)
            && norm(candidate.company) === norm(existing.company)
            && norm(candidate.address) === norm(existing.address)
            && norm(candidate.purpose) === norm(existing.purpose)
            && (candidate.appoDate || '') === (existing.appoDate || ''));
    }
    return {parseRows, parsePdfText, appointment, duplicate, norm};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RequestParser;
