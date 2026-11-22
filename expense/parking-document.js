// 提出用の選択・訪問情報・改ページ。画像処理や保存とは独立させる。
const ParkingDocument = (() => {
    const captionFields = ['machineName','purpose'];
    const has = (obj,key) => Object.hasOwn(obj || {},key);
    const text = value => String(value ?? '').trim();
    const linked = item => Boolean(item.customerId || item.visitConfirmed || item.visitAddress || item.routeId || item.workspaceId);
    function unknownCaption(item) {
        if (Array.isArray(item.visitCaptionUnknown)) return item.visitCaptionUnknown;
        return linked(item) && !has(item,'visitCaptionAuto') ? captionFields.filter(field => text(item[field])) : [];
    }
    function visitPatch(customer, workspaceId, item = {}) {
        const automatic = {}, values = {};
        const uncertain = unknownCaption(item);
        for (const field of captionFields) {
            const existing = item[field] || '';
            const fromVisit = field === 'machineName' ? customer.equipType : customer.purpose;
            const wasCopied = has(item.visitCaptionAuto,field) && existing === item.visitCaptionAuto[field];
            if (text(existing) && !wasCopied && !uncertain.includes(field)) values[field] = existing;
            else {
                values[field] = fromVisit || '';
                if (values[field]) automatic[field] = values[field];
            }
        }
        return {visitCompany: customer.company || '', ...values, customerId: customer.id || '', workspaceId,
            visitAddress: customer.address || '', routeId: customer.routeId || '', visitConfirmed: true,
            visitCaptionAuto: automatic, visitCaptionUnknown: [], visitCaptionReview: false};
    }
    function applyEdit(item, patch) {
        const next = {...item,...patch};
        if (has(patch,'visitCaptionAuto')) return next;
        const changedIdentity = ['date','visitCompany'].some(field => has(patch,field) && text(item[field]) !== text(next[field]));
        const modifiedFields = captionFields.filter(field => has(patch,field) && text(item[field]) !== text(next[field]));
        const uncertain = unknownCaption(item).filter(field => !modifiedFields.includes(field));
        const auto = {...item.visitCaptionAuto};
        for (const field of modifiedFields) delete auto[field];
        if (changedIdentity && (linked(item) || item.visitCaptionReview)) {
            for (const field of captionFields) {
                if (has(auto,field) && next[field] === auto[field]) next[field] = '';
            }
            Object.assign(next,{customerId:'',workspaceId:'',visitAddress:'',routeId:'',visitConfirmed:false,
                visitCaptionAuto:{},visitCaptionUnknown:uncertain,visitCaptionReview:true});
        } else if (modifiedFields.length && (linked(item) || item.visitCaptionReview)) {
            next.visitCaptionAuto = auto;
            next.visitCaptionUnknown = uncertain;
        }
        if (patch.visitCaptionReview === false && !changedIdentity && captionReady(next)) next.visitCaptionUnknown = [];
        else if (patch.visitCaptionReview === false && item.visitCaptionReview) next.visitCaptionReview = true;
        return next;
    }
    function captionReady(item) {
        return /^\d{4}-\d{2}-\d{2}$/.test(item.date || '') && ['visitCompany',...captionFields].every(f => text(item[f]));
    }
    function candidates(customers, date, includeOtherDays = false) {
        return customers.filter(c => includeOtherDays || (c.appoDate || '').slice(0, 10) === date)
            .sort((a, b) => (a.appoDate || '').localeCompare(b.appoDate || '') || (a.company || '').localeCompare(b.company || '', 'ja'));
    }
    // A visit is stored in its start workspace, even when it spans other months.
    function workspaceCandidates(storage, date, includeOtherDays, onDay) {
        const workspaceId = date?.slice(0, 7) || storage.getCurrentWorkspaceId();
        const load = id => id ? storage.getCustomersForWorkspace(id) : storage.getCustomers();
        const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '');
        const inMonth = customer => includeOtherDays || (hasDate && onDay(customer, date));
        const choices = load(workspaceId).filter(inMonth).map(customer => ({customer, workspaceId}));
        if (hasDate) {
            const otherIds = new Set(storage.getWorkspaces().map(ws => ws.id));
            otherIds.delete(workspaceId);
            for (const id of otherIds) {
                if (!id || (/^\d{4}-\d{2}$/.test(id) && id > workspaceId)) continue;
                for (const customer of load(id)) {
                    if (customer.appoEndDate && (customer.appoDate || '').slice(0, 10) < date && onDay(customer, date)) {
                        choices.push({customer, workspaceId:id});
                    }
                }
            }
        }
        return choices.sort(({customer:a},{customer:b}) => (a.appoDate || '').localeCompare(b.appoDate || '') || (a.company || '').localeCompare(b.company || '', 'ja'));
    }
    function selected(items, month = '', day = '') {
        return items.filter(i => i.imageDataUrl && i.pdfSelected !== false && (!month || (i.date || '').startsWith(month)) && (!day || i.date === day))
            .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || a.id).localeCompare(b.createdAt || b.id));
    }
    function validate(items) {
        if (!items.length) return 'PDFに載せる写真を選んでください。';
        if (items.some(i => i.ocrStore && i.machineName === i.ocrStore)) return '機種名に駐車場名が入っている明細があります。訪問先の機種名へ直してください。';
        if (items.some(i => i.visitCaptionReview)) return '利用日や会社名を変更した領収書があります。機種名・作業内容を見直し、確認してからPDFにしてください。';
        const missing = items.find(i => !captionReady(i));
        return missing ? '選んだ領収書の日付・訪問先・機種名・作業内容を確認してください。機種がない場合は「該当なし」と入力できます。' : '';
    }
    function pages(items, count = 6) {
        count = Number(count) === 4 ? 4 : 6;
        const result = [];
        for (let i = 0; i < items.length; i += count) result.push(items.slice(i, i + count));
        return result;
    }
    return {visitPatch, applyEdit, captionReady, candidates, workspaceCandidates, selected, validate, pages};
})();
if (typeof module !== 'undefined') module.exports = ParkingDocument;
