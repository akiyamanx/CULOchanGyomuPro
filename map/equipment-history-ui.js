// 表示は読み取り専用。実績の入力は既存の訪問先編集・保存を使う。
const EquipmentHistoryUI = (() => {
    const byId = id => document.getElementById(id);
    const locationFields = ['buildingName','receptionFloor','equipmentFloor'];
    let selectedVisit = null;
    const fields = ['workActualDay', 'workActualStart', 'workActualEnd', 'workActualSummary'];
    const element = (tag, text, cls) => {
        const el = document.createElement(tag);
        if (text) el.textContent = text;
        if (cls) el.className = cls;
        return el;
    };
    function input() {
        const [day,start,end,summary] = fields.map(id => byId(id)?.value.trim() || '');
        return {day,start,end,summary};
    }
    function begin(customer) {
        if (!byId('equipmentHistoryFromVisit')) return;
        const v = EquipmentHistory.actual(customer.workActual);
        ['day','start','end','summary'].forEach((key,i) => { byId(fields[i]).value = v?.[key] || ''; });
        byId('workActualDetails').open = Boolean(v);
        byId('editManagementNo').value = customer.managementNo || '';
        for (const key of locationFields) {
            const input = byId('visitSite-'+key);
            if (input) input.value = customer[key] || '';
        }
        const button = byId('equipmentHistoryFromVisit');
        button.hidden = !EquipmentHistory.serial(customer.managementNo);
        button.onclick = () => openForVisit(customer);
    }
    function drawList(out, title, rows) {
        const section = element('section', '', 'equipment-history-section');
        section.append(element('h3', title));
        if (!rows.length) section.append(element('p', '該当する保存済みの訪問はありません。'));
        for (const row of rows) {
            const card = element('article', '', 'equipment-history-card');
            card.append(element('strong', row.company || '訪問先名なし'));
            if (row.address) card.append(element('p', row.address));
            card.append(element('p', '依頼内容: ' + ([row.purpose,row.filter].filter(Boolean).join(' ／ ') || '記載なし')));
            card.append(element('p', '予定: ' + (row.scheduled.replace('T', ' ') || '未定')));
            if (row.actual) {
                const a = row.actual;
                card.append(element('p', '手入力の実績: ' + [a.day,a.start && (a.end ? a.start + '〜' + a.end : a.start)].filter(Boolean).join(' ')));
                if (a.summary) card.append(element('p', a.summary));
            } else if (row.completed) card.append(element('p', 'アプリ上は完了。実際の日時・作業内容は未記録。'));
            section.append(card);
        }
        out.append(section);
    }
    function drawComparison(out, visit, result) {
        const comparison = EquipmentHistory.compare(visit,result);
        const section = element('section', '', 'equipment-history-section');
        section.append(element('h3', '今回の依頼と前回の作業実績'));
        section.append(element('p', '今回の依頼: ' + (comparison.current || '記載なし')));
        const a = comparison.previous?.actual;
        section.append(element('p', a ? '前回の作業実績（端末の記録）: ' + a.day + (a.start ? ' ' + a.start + (a.end ? '〜' + a.end : '') : '') : '前回の作業実績: ' + (result.incomplete ? '読み込みが一部未完了のため未確認' : '未記録')));
        if (a) section.append(element('p', a.summary || '作業内容は未記録'));
        out.append(section);
    }
    function search() {
        const out = byId('equipmentHistoryResults'), status = byId('equipmentHistoryStatus');
        out.replaceChildren();
        const result = EquipmentHistory.lookup({
            getWorkspaces() {
                const raw = AppStorage.getItem('mm_workspaces');
                return raw ? JSON.parse(raw) : [];
            },
            getCurrentWorkspaceId: () => DataStorage.getCurrentWorkspaceId(),
            getCustomersForWorkspace: ws => DataStorage.getCustomersForWorkspace(ws),
            historyWorkspaceIds: () => AppStorage.keys().filter(k => k.startsWith('mm_customers_')).map(k => k.slice(13))
        }, byId('equipmentHistorySerial').value);
        if (!result.key) { status.textContent = '機番を入力してください（例: MF123456）。'; return; }
        status.textContent = result.key + '・保存済み ' + (result.requests.length + result.past.length) + '件'
            + (result.incomplete ? '。一部の訪問データが読み込めませんでした。' : '');
        if (selectedVisit && EquipmentHistory.serial(selectedVisit.managementNo) === result.key) drawComparison(out,selectedVisit,result);
        drawList(out,'今回・未完了の依頼',result.requests);
        drawList(out,'過去の完了記録',result.past);
    }
    function open(value, visit=null) {
        const dialog = byId('equipmentHistoryDialog');
        if (!dialog || dialog.open) return;
        selectedVisit = visit;
        const field = byId('equipmentHistorySerial');
        field.value = EquipmentHistory.serial(value) || '';
        byId('equipmentHistoryResults').replaceChildren();
        byId('equipmentHistoryStatus').textContent = '';
        dialog.showModal();
        if (field.value) search();
    }
    function openForVisit(visit) { open(visit?.managementNo,visit); }
    function init() {
        byId('equipmentHistoryOpen')?.addEventListener('click', () => open());
        byId('equipmentHistoryClose')?.addEventListener('click', () => byId('equipmentHistoryDialog').close());
        byId('equipmentHistoryForm')?.addEventListener('submit', e => { e.preventDefault(); search(); });
    }
    if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init);
    return { begin, input, open, openForVisit };
})();
