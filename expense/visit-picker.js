// 精算する作業日の訪問を選ぶための振り分け（画面なし・テスト可能）。
// 既定で選ぶのは「アポ日がその作業日」かつ「完了」の訪問だけ。提出日は使わない。
const VisitPicker = (() => {
    const norm = v => (typeof ExpenseImport !== 'undefined' ? ExpenseImport : require('./expense-import.js')).normalizeDate(v);
    function groupForDay(customers, day) {
        const out = { done: [], forgot: [], others: [] };
        for (const c of customers || []) {
            if (!c || (c.status !== 'completed' && c.status !== 'appointed')) continue;
            const d = norm(c.appoDate);
            if (!d) continue;
            if (d === day) (c.status === 'completed' ? out.done : out.forgot).push(c);
            else out.others.push({ ...c, _day: d });
        }
        out.others.sort((a, b) => a._day < b._day ? -1 : a._day > b._day ? 1 : 0);
        return out;
    }
    // 作業日の初期値: 明細の最後の日付 → なければ今日（提出日ではない）
    function defaultDay(rowDates, today) {
        const dates = (rowDates || []).filter(Boolean).sort();
        return dates.length ? dates[dates.length - 1] : today;
    }
    // 距離計算から精算書へ反映した訪問のうち、まだ「完了」でないもの
    function notDone(ordered) {
        return (ordered || []).filter(c => c && c.id && c.status !== 'completed');
    }
    return { groupForDay, defaultDay, notDone };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = VisitPicker;
