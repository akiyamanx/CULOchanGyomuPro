// 提出用の選択・訪問情報・改ページ。画像処理や保存とは独立させる。
const ParkingDocument = (() => {
    function visitPatch(customer, workspaceId) {
        return {visitCompany: customer.company || '', machineName: customer.equipType || '',
            purpose: customer.purpose || '', customerId: customer.id || '', workspaceId,
            visitAddress: customer.address || '', routeId: customer.routeId || '', visitConfirmed: true};
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
        const missing = items.find(i => !/^\d{4}-\d{2}-\d{2}$/.test(i.date || '') || !i.visitCompany?.trim() || !i.machineName?.trim() || !i.purpose?.trim());
        return missing ? '選んだ領収書の日付・訪問先・機種名・作業内容を確認してください。機種がない場合は「該当なし」と入力できます。' : '';
    }
    function pages(items, count = 6) {
        count = Number(count) === 4 ? 4 : 6;
        const result = [];
        for (let i = 0; i < items.length; i += count) result.push(items.slice(i, i + count));
        return result;
    }
    return {visitPatch, candidates, workspaceCandidates, selected, validate, pages};
})();
if (typeof module !== 'undefined') module.exports = ParkingDocument;
