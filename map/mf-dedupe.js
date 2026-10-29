// 本体番号(MF+数字)で同じ機械の二重登録を防ぐ。MF番号は機械ごとに一意(会社名・住所は同じものが何件もあり得るので使わない)。
// ・取り込み: 同じMF番号がどの月・日程未定にあっても新しく足さない。日程未定にあって、今回の依頼に作業日があれば月へ移す。
// ・掃除(一度だけ): すでにできた重複を、利用者の入力(ルート・状態・日時)を消さない範囲でまとめる。消した分は控えに残す。
const MfDedupe = (() => {
    const UNSCHEDULED = 'unscheduled';
    const MONTH = /^\d{4}-\d{2}$/;
    const FILL = ['phone', 'contact', 'branch', 'equipType', 'filter', 'purpose', 'address'];
    function mfOf(c) {
        const m = String((c && c.managementNo) || '').normalize('NFKC').toUpperCase().match(/MF\s*-?\s*(\d{4,})/);
        return m ? 'MF' + m[1] : '';
    }
    const day = v => String(v || '').slice(0, 10);
    const validMonthDate = (v, ws) => MONTH.test(ws) && /^\d{4}-\d{2}-\d{2}/.test(String(v || '')) && String(v).slice(0, 7) === ws;
    // lists: [{ws, customers}] → Map(MF → {ws, c})。最初に見つかったものを代表にする。
    function index(lists) {
        const idx = new Map();
        for (const { ws, customers } of lists) for (const c of customers || []) {
            const k = mfOf(c); if (k && !idx.has(k)) idx.set(k, { ws, c });
        }
        return idx;
    }
    // 取り込む1件の扱い。add=今まで通り(MF無しも含む) / skip=登録済み / move=日程未定の分を作業日の月へ
    function decide(item, ws, idx) {
        const k = mfOf(item);
        if (!k) return { action: 'add', mf: '' };
        const hit = idx.get(k);
        if (!hit) return { action: 'add', mf: k };
        if (hit.ws === UNSCHEDULED && ws !== UNSCHEDULED && validMonthDate(item.appoDate, ws)) return { action: 'move', mf: k, hit };
        return { action: 'skip', mf: k, hit };
    }
    // 空欄だけを今回の値で埋める(利用者が入れた値は上書きしない)
    function fillBlanks(target, from) {
        const patch = {};
        for (const f of FILL) if (!String(target[f] || '').trim() && String(from[f] || '').trim()) patch[f] = from[f];
        return patch;
    }
    const userScore = (c, ws) => (ws !== UNSCHEDULED && c.appoDate ? 4 : 0) + (c.routeId ? 2 : 0) + ((c.status || 'pending') !== 'pending' ? 2 : 0) + (c.appoDate ? 1 : 0);
    // 消してよい重複か: ルート・状態・別の日時など、利用者が入れたかもしれない情報を持っていないこと。
    const removable = (d, keep) => !d.routeId && (d.status || 'pending') === 'pending' && (!d.appoDate || day(d.appoDate) === day(keep.appoDate));
    const noteLines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
    // 掃除の計画(書き込みはしない)。戻り値 {groups, remove:[{ws,id}], patch:[{ws,id,changes}], kept: 消さずに残した件数}
    function plan(lists) {
        const groups = new Map();
        lists.forEach(({ ws, customers }) => (customers || []).forEach((c, order) => {
            const k = c && mfOf(c); if (!k) return;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push({ ws, c, order });
        }));
        const remove = [], patch = []; let kept = 0, dupGroups = 0;
        for (const members of groups.values()) {
            if (members.length < 2) continue;
            dupGroups++;
            const sorted = [...members].sort((a, b) => userScore(b.c, b.ws) - userScore(a.c, a.ws)
                || String(a.c.createdAt || '').localeCompare(String(b.c.createdAt || '')) || a.order - b.order);
            const keep = sorted[0];
            const changes = {}; const lines = noteLines(keep.c.note);
            for (const d of sorted.slice(1)) {
                if (!removable(d.c, keep.c)) { kept++; continue; }
                remove.push({ ws: d.ws, id: d.c.id });
                Object.assign(changes, fillBlanks({ ...keep.c, ...changes }, d.c));
                for (const l of noteLines(d.c.note)) if (!lines.includes(l)) lines.push(l);
            }
            const note = lines.join('\n');
            if (note !== String(keep.c.note || '').split('\n').map(x => x.trim()).filter(Boolean).join('\n')) changes.note = note.slice(0, 4000);
            if (Object.keys(changes).length) patch.push({ ws: keep.ws, id: keep.c.id, changes });
        }
        return { groups: dupGroups, remove, patch, kept };
    }
    // 一度だけ実行。控え(消した訪問先そのもの)を残してから書く。data は DataStorage、storage は AppStorage。
    const FLAG = 'mm_mf_dedupe_done_v1', BACKUP = 'mm_mf_dedupe_backup';
    function runOnce(data, storage, nowIso) {
        if (storage.getItem(FLAG)) return { ran: false };
        const ids = [...new Set(data.getWorkspaces().map(w => w.id))];
        const lists = ids.map(ws => ({ ws, customers: data.getCustomersForWorkspace(ws) }));
        const p = plan(lists);
        if (p.remove.length || p.patch.length) {
            const removedSet = new Set(p.remove.map(r => r.ws + '\u0000' + r.id));
            const backup = lists.flatMap(l => l.customers.filter(c => removedSet.has(l.ws + '\u0000' + c.id)).map(c => ({ ws: l.ws, c })));
            storage.setItem(BACKUP, JSON.stringify({ at: nowIso || new Date().toISOString(), removed: backup }));
            for (const l of lists) {
                const next = l.customers.filter(c => !removedSet.has(l.ws + '\u0000' + c.id)).map(c => {
                    const pt = p.patch.find(x => x.ws === l.ws && x.id === c.id);
                    return pt ? { ...c, ...pt.changes } : c;
                });
                if (next.length !== l.customers.length || p.patch.some(x => x.ws === l.ws)) data.saveCustomersForWorkspace(l.ws, next);
            }
        }
        storage.setItem(FLAG, nowIso || new Date().toISOString());
        return { ran: true, removed: p.remove.length, merged: p.patch.length, kept: p.kept, groups: p.groups };
    }
    return Object.freeze({ mfOf, index, decide, fillBlanks, plan, runOnce, FLAG, BACKUP });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MfDedupe;
