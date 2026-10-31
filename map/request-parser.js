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
        return {company:'',address:'',phone:'',contact:'',managementNo:'',branch:'',equipType:'',filter:'',purpose:'',note:'',appoDate:'',workDateText:'',titleText:'',unitCount:1,source,kind,warnings:[]};
    }
    function parseTable(rows, source) {
        let headerIndex = -1, columns;
        for (let i = 0; i < Math.min(rows.length, 30); i++) {
            const c = {};
            (rows[i] || []).forEach((value, col) => { const f = field(value); if (f && c[f] === undefined) c[f] = col; });
            if (c.company !== undefined && c.address !== undefined) { headerIndex = i; columns = c; break; }
        }
        if (headerIndex < 0) return [];
        // 作成日・発行日だけのセルは表題に含めない(その月を、一覧の対象月と取り違えないため)。
        const title = rows.slice(0, headerIndex).flat().filter(value => !/^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(\s+\d{1,2}:\d{2})?\s*$/.test(String(value ?? ''))).join(' ');
        const fallback = /メンテ|フィルター交換/.test(title) ? 'メンテナンス' : '';
        const result = [];
        rows.slice(headerIndex + 1).forEach((row, offset) => {
            const address = clean(row[columns.address]);
            const company = clean(row[columns.company]);
            // フッターの挨拶・注記は住所を持たないため候補にしない。
            if (!address || (!company && !/[都道府県市区町村]/.test(address))) return;
            if (field(company) === 'company' && field(address) === 'address') return;
            const item = base(`${source} · ${headerIndex + offset + 2}行`, '一覧表');
            item.titleText = clean(title);
            // 登録月の判定用: 日付の列が「工事予定日」等の別名でも原文だけは残す(表示・appoDateの扱いは変えない)。
            const dateCol = (rows[headerIndex] || []).findIndex(label => /^(作業予定日|工事予定日(時)?|訪問予定日|作業希望日|アポ日時|工事日|訪問日)$/.test(norm(label).replace(/[.:：]+$/g,'')));
            if (dateCol >= 0) item.workDateText = clean(row[dateCol]);
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
        item.workDateText = /\d/.test(dateText) ? clean(dateText) : '';
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
    // 作業内容として扱う■の語彙。ここに無い■(ポンプ有無・住居形態・代金回収など)は読まない。
    const WORK_ITEM = /設置工事|取外し?工事|クレーム|フィルター交換|移設|取付|修理|現地(?:調査|確認)|点検|メンテ|入替|交換/;
    // 所在地の値は見出し行の隣の「〒」付きの行に来る。見出し(または顧客名)に最も近い行を使う。
    function formAddress(joined) {
        const lines = joined.split('\n');
        const zip = /〒\s*\d{3}[-ー]?\d{4}/;
        const anchorOf = re => lines.findIndex(line => re.test(line));
        let anchor = anchorOf(/所\s*在\s*地/);
        if (anchor < 0) anchor = anchorOf(/顧\s*客\s*名/);
        let best = -1;
        lines.forEach((line, index) => {
            if (zip.test(line) && (best < 0 || Math.abs(index - anchor) < Math.abs(best - anchor))) best = index;
        });
        if (best < 0 || (anchor >= 0 && Math.abs(best - anchor) > 3)) return '';
        return clean(lines[best].replace(/^.*?〒\s*\d{3}[-ー]?\d{4}\s*/, '').split(/TEL|電話|携帯/i)[0]);
    }
    // PDFのページが「業務依頼書」かを判定する。精算書・納品書・調査票・コスト試算などの参考資料は取り込まない。
    // 通す条件(上から順に判定):
    //   1. 先頭付近の見出しに「業務依頼書」がある。
    //   2. 先頭付近の見出しが参考資料(精算書・納品書・請求書・見積書・調査票・コスト試算・報告書・領収書)なら通さない。
    //   3. 本文に「業務依頼書」がある。
    //   4. 「顧客名」と「所在地」、または「設置先名」と「設置先住所」の組がある(見出しが崩れた画像PDF向け)。
    //   5. ファイル名に「業務依頼」があり、1ページ目(OCRで文字が崩れた依頼書を、空欄のまま手入力できるよう残す)。
    const REFERENCE_DOCUMENT = /精算書|納品書|請求書|見積書|コスト試算|調査票|報告書|領収書/;
    function requestDocumentCheck(raw, source = '') {
        const compact = text(raw).normalize('NFKC').split(/\r?\n/).map(line => line.replace(/\s+/g,'')).filter(Boolean);
        const head = compact.slice(0,6).join('\n');
        const body = compact.join('\n');
        const [fileName, page] = String(source).normalize('NFKC').split(' · ');
        const firstPage = !page || /^1ページ/.test(page);
        if (/業務依頼書/.test(head)) return {ok:true, reason:'見出しに業務依頼書があります。'};
        if (REFERENCE_DOCUMENT.test(head) || REFERENCE_DOCUMENT.test(fileName)) return {ok:false, reason:'精算書・納品書・調査票などの参考資料のため、依頼書として取り込みません。'};
        if (/業務依頼書/.test(body)) return {ok:true, reason:'本文に業務依頼書があります。'};
        if ((/顧客名/.test(body) && /所在地/.test(body)) || (/設置先名/.test(body) && /設置先住所/.test(body))) return {ok:true, reason:'顧客名と所在地の項目があります。'};
        if (/業務依頼/.test(fileName) && firstPage) return {ok:true, reason:'ファイル名が業務依頼書で、文字が読み取れなかった1ページ目です。'};
        return {ok:false, reason:'業務依頼書の見出しも、顧客名と所在地の項目もないため、依頼書として取り込みません。'};
    }
    function parsePdfText(raw, source = '') {
        if (!requestDocumentCheck(raw, source).ok) return [];
        const lines = text(raw).normalize('NFKC').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
        // OCRが日本語の間へ入れた空白だけ除去し、英語名の単語区切りは残す。
        const joined = lines.map(line => line.replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])/gu,'')).join('\n');
        const value = (labels, stop = '') => {
            for (const label of labels) {
                const flexible = [...label].join('\\s*');
                // 「初回設置日」「最終訪問日」などの過去の日付を、予定日の見出しと取り違えない。
                const match = joined.match(new RegExp('(?<!(?:初回|前回|最終)\\s*)' + flexible + '[ :：.]*([^\\n]+)'));
                if (match) return clean(stop ? match[1].split(new RegExp(stop,'i'))[0] : match[1]);
            }
            return '';
        };
        const item = base(source, 'PDF依頼書');
        // 「顧客名」「所在地」「■チェック欄」の業務依頼書(マーフィード書式)。設置先名などの別書式とは別に扱う。
        const customerForm = /顧\s*客\s*名/.test(joined);
        item.company = value(['設置先名','客先名','会社名'], '設置先担当者|担当者') || value(['顧客名'], '\\s*様(?:\\s.*)?$');
        item.address = value(['設置先住所','所在地','住所'], 'TEL|電話|携帯').replace(/^〒?\s*\d{3}[- ]?\d{4}\s*/, '');
        if (!item.address && customerForm) item.address = formAddress(joined);
        item.contact = value(['設置先担当者','ご担当者']);
        item.phone = (value(['TEL','電話']).match(/0[\d() -]{8,18}\d/) || [''])[0];
        item.equipType = value(['本体種類','機種','浄水器名','型式'], '数量|台数');
        if (customerForm) {
            item.branch = value(['依頼SS名'], '\\s{2,}|受付');
            item.unitCount = Number((value(['台数','数量']).match(/\d+/) || [1])[0]) || 1;
        }
        item.managementNo = value(['管理No','管理NO','管理番号']).replace(/^[. :]+/,'');
        if (item.managementNo && !/^[A-Z0-9][A-Z0-9-]{0,30}$/i.test(item.managementNo)) {
            item.managementNo = '';
            item.warnings.push('管理番号を正しく読み取れませんでした。必要に応じて原本から入力してください。');
        }
        item.purpose = customerForm ? '' : purpose(value(['依頼内容','依頼業務内容']));
        if (customerForm) {
            // ■の付いた作業だけを読む。ポンプ有無・住居形態・代金回収など、同じ用紙の別の■は作業内容ではない。
            const checkedWork = [...joined.matchAll(/■\s*([^□■\n]+)/g)].map(m => m[1].trim()).filter(v => WORK_ITEM.test(v));
            if (checkedWork.length) item.purpose = purpose(checkedWork.join(' '));
            else {
                const hint = String(source).match(/[（(]([^）)]*(?:修理|設置|メンテ|フィルタ|点検|定期)[^）)]*)[）)]/);
                if (hint) {
                    item.purpose = purpose(hint[1]);
                    item.warnings.push(`作業内容のチェック欄を読み取れなかったため、ファイル名の「${hint[1]}」から推定しました。原本で確認してください。`);
                } else item.warnings.push('作業内容のチェック欄を読み取れませんでした。原本を見て作業内容を選んでください。');
            }
        }
        if (!item.purpose && /設置業務依頼書/.test(norm(joined))) item.purpose = '本体設置';
        const dateText = value(['設置日','工事予定日時','作業予定日','工事予定日','訪問予定日','作業希望日']);
        item.appoDate = appointment(dateText);
        item.workDateText = dateText;
        const noteIndex = joined.search(/備\s*考|【\s*(?:物置|本体|電気)/);
        const special = customerForm ? (joined.match(/特\s*記\s*事\s*項\s*([\s\S]*?)(?=受付年月日|受付者名|依頼SS名|備\s*考|$)/) || ['',''])[1].replace(/\n?（[^）\n]*）\s*$/,'').trim() : '';
        item.note = unique([dateText && `設置・予定日（原文）: ${dateText}`, special, noteIndex >= 0 ? joined.slice(noteIndex).trim() : '']).join('\n');
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
    return {parseRows, parsePdfText, requestDocumentCheck, appointment, duplicate, norm};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RequestParser;
