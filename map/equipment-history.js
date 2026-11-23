// 機番は完全一致。依頼内容、アプリ上の完了、手入力の実績は別物として表示する。
const EquipmentHistory = (() => {
    const string = value => typeof value === 'string' ? value.trim() : '';
    const monthId = /^(?:\d{4}-(?:0[1-9]|1[0-2])|unscheduled)$/;
    function serial(value) {
        const m = string(value).normalize('NFKC').toUpperCase().match(/^(?:MF\s*-?\s*)?(\d{4,20})$/);
        return m ? 'MF' + m[1] : '';
    }
    function dayOk(day) {
        if (!/^\d{4}-\d\d-\d\d$/.test(day)) return false;
        const d = new Date(day + 'T00:00:00Z');
        return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === day;
    }
    const timeOk = time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
    function actual(input) {
        if (!input || typeof input !== 'object') return null;
        const day = string(input.day), start = string(input.start), end = string(input.end), summary = string(input.summary);
        if (!dayOk(day) || (start && !timeOk(start)) || (end && (!start || !timeOk(end) || end <= start)) || summary.length > 1000) return null;
        return { day, start, end, summary };
    }
    function lookup(storage, value) {
        const key = serial(value);
        const result = { key, requests: [], past: [], incomplete: false };
        if (!key) return result;
        let months = [];
        try {
            const w = storage.getWorkspaces();
            if (!Array.isArray(w)) throw Error('workspace list');
            months = w.map(x => x?.id);
            if (storage.getCurrentWorkspaceId) months.push(storage.getCurrentWorkspaceId());
            if (storage.historyWorkspaceIds) months.push(...storage.historyWorkspaceIds());
        } catch { result.incomplete = true; }
        months = [...new Set(months)].filter(x => monthId.test(x)).sort().reverse();
        const seen = new Map();
        for (const ws of months) {
            try {
                const rows = storage.getCustomersForWorkspace(ws);
                if (!Array.isArray(rows)) throw Error('visit list');
                for (const c of rows) {
                    if (!c || serial(c.managementNo) !== key) continue;
                    const r = { id: c.id, ws, company: string(c.company), address: string(c.address),
                        purpose: string(c.purpose), filter: string(c.filter), scheduled: string(c.appoDate),
                        actual: actual(c.workActual), completed: c.status === 'completed' };
                    const signature = JSON.stringify({ ...r, ws: null });
                    if (c.id && seen.get(c.id) === signature) continue;
                    if (c.id && !seen.has(c.id)) seen.set(c.id, signature);
                    (r.completed ? result.past : result.requests).push(r);
                }
            } catch { result.incomplete = true; }
        }
        const rank = row => row.actual?.day || row.scheduled || (row.ws === 'unscheduled' ? '' : row.ws);
        for (const list of [result.requests, result.past]) list.sort((a,b) => rank(b).localeCompare(rank(a)));
        return result;
    }
    function compare(current, result) {
        const scheduled = string(current?.appoDate).replace(' ', 'T'), day = scheduled.slice(0,10), at = scheduled.slice(11,16);
        const past = (result?.past || []).filter(row => {
            const a = actual(row.actual);
            return a && row.id != null && String(row.id) !== String(current?.id) && dayOk(day)
                && (a.day < day || (a.day === day && timeOk(at) && a.end && a.end <= at));
        });
        past.sort((a,b) => (b.actual.day+'T'+(b.actual.end||b.actual.start||'')).localeCompare(a.actual.day+'T'+(a.actual.end||a.actual.start||'')));
        return { current:[current?.purpose,current?.filter].map(string).filter(Boolean).join(' ／ '), previous:past[0]||null };
    }
    return { serial, actual, lookup, compare };
})();
if (typeof module !== 'undefined') module.exports = EquipmentHistory;
