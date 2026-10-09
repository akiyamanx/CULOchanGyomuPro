// 日付・CSV・取込識別子を共通化する。外部APIや保存済みデータには触れない。
const ExpenseImport = (() => {
    function normalizeDate(value) {
        const match = String(value || '').normalize('NFKC').match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})(?:$|[ T])/);
        if (!match) return '';
        const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
        const date = new Date(Date.UTC(year, month - 1, day));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
        return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
    }

    // RFC4180の引用符、引用符内改行、二重引用符に対応。
    function parseCsv(text) {
        const rows = [], row = [];
        let cell = '', quoted = false;
        const source = String(text || '').replace(/^\uFEFF/, '');
        for (let i = 0; i < source.length; i++) {
            const ch = source[i];
            if (ch === '"') {
                if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
                else quoted = !quoted;
            } else if (ch === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
            else if ((ch === '\n' || ch === '\r') && !quoted) {
                if (ch === '\r' && source[i + 1] === '\n') i++;
                row.push(cell.trim());
                if (row.some(v => v)) rows.push(row.splice(0)); else row.length = 0;
                cell = '';
            } else cell += ch;
        }
        if (quoted) throw new Error('CSVの引用符が閉じられていません');
        row.push(cell.trim());
        if (row.some(v => v)) rows.push(row);
        return rows;
    }

    function parseEtcCsv(text) {
        const rows = parseCsv(text);
        let start = -1, dateCol = -1, amountCol = -1, entryCol = -1, exitCol = -1;
        for (let i = 0; i < rows.length; i++) {
            const headers = rows[i].map(c => c.normalize('NFKC').replace(/\s/g, ''));
            const date = headers.findIndex(c => /年月日|利用日|日付/.test(c));
            // 最終額があれば割引前料金より優先する。
            let amount = headers.findIndex(c => /最終額|確定料金/.test(c));
            if (amount < 0) amount = headers.findIndex(c => /通行料金|利用額|金額/.test(c));
            if (date < 0 || amount < 0) continue;
            start = i + 1; dateCol = date; amountCol = amount;
            entryCol = headers.findIndex(c => /入口|IC.*自/.test(c));
            exitCol = headers.findIndex(c => /出口|IC.*至/.test(c));
            break;
        }
        if (start < 0) throw new Error('利用日と料金の列を確認できません。ETC利用照会のCSVを選択してください');
        const occurrences = new Map();
        const result = [];
        for (const row of rows.slice(start)) {
            const date = normalizeDate(row[dateCol]);
            const value = String(row[amountCol] || '').normalize('NFKC').replace(/[¥￥円,\s]/g, '');
            if (!date || !/^\d+$/.test(value)) continue;
            const amount = Number(value);
            if (!Number.isSafeInteger(amount) || amount <= 0) continue;
            const entry = entryCol >= 0 ? row[entryCol] || '' : '';
            const exit = exitCol >= 0 ? row[exitCol] || '' : '';
            // 時刻、車両番号、明細番号も含む元の行で識別。同額の複数利用は残す。
            const fields = row.map((cell, col) => col === dateCol ? date : col === amountCol ? String(amount) : cell.normalize('NFKC'));
            const identity = JSON.stringify(fields);
            const occurrence = (occurrences.get(identity) || 0) + 1;
            occurrences.set(identity, occurrence);
            result.push({ date, entry, exit, amount, key: 'etc:' + identity + ':' + occurrence });
        }
        return result;
    }

    function escapeHtml(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    return { normalizeDate, parseCsv, parseEtcCsv, escapeHtml };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ExpenseImport;

