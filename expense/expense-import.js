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
        return parseEtcRows(parseCsv(text));
    }

    // 行の配列（CSVでもExcelでも同じ形: 文字列の配列の配列）からETC明細を作る
    function parseEtcRows(input) {
        const rows = (input || []).map(r => (r || []).map(c => c == null ? '' : String(c).trim())).filter(r => r.some(v => v));
        let start = -1, dateCol = -1, amountCol = -1, entryCol = -1, exitCol = -1, timeCol = -1, refCol = -1, vehicleCol = -1;
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
            timeCol = headers.findIndex(c => /(?:利用|入口|通行).*時刻|^時刻|^時分/.test(c) && !/至|出口/.test(c));
            refCol = headers.findIndex(c => /取扱番号|明細番号|利用番号/.test(c));
            vehicleCol = headers.findIndex(c => /車両番号|車載器番号|カード番号/.test(c));
            break;
        }
        if (start < 0) throw new Error('利用日と料金の列を確認できません。ETC利用照会のCSVを選択してください');
        const occurrences = new Map();
        const result = [];
        for (const row of rows.slice(start)) {
            // 「26/11/05」のような2桁の年も読む
            const rawDate = String(row[dateCol] || '').normalize('NFKC').replace(/^(\d{2})([\/-]\d{1,2}[\/-]\d{1,2})/, '20$1$2');
            const date = normalizeDate(rawDate);
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
            const columns = [dateCol, amountCol, entryCol, exitCol, timeCol, refCol, vehicleCol];
            result.push({ date, entry, exit, amount, key: 'etc:' + identity + ':' + occurrence, columns, ...etcDetails(fields, columns, date, rawDate) });
        }
        return result;
    }

    const etcText = value => String(value || '').normalize('NFKC').trim().replace(/\s/g, '');
    function etcDetails(fields, columns, date, originalDate) {
        const [,,a,b,t,r,v] = columns;
        const raw = String(fields[t] || originalDate || '').normalize('NFKC');
        const time = raw.match(/(\d{1,2})[:時]\s*(\d{2})/);
        return {date, entry:etcText(fields[a]), exit:etcText(fields[b]),
            time:time && +time[1]<24 && +time[2]<60 ? time[1].padStart(2,'0')+':'+time[2] : '',
            reference:etcText(fields[r]), vehicle:etcText(fields[v])};
    }
    function decodeEtcKey(key) {
        const m = typeof key === 'string' && key.match(/^etc:(\[.*\]):[1-9]\d*$/);
        if (!m) return null;
        try { const fields=JSON.parse(m[1]); return Array.isArray(fields) && fields.every(x=>typeof x==='string') ? fields : null; }
        catch {return null;}
    }
    function etcCandidate(old, next) {
        if (old.key.replace(/:\d+$/, '') === next.key.replace(/:\d+$/, '')) return false;
        if (old.columns && next.columns && old.reference && next.reference && old.reference===next.reference &&
            old.date===next.date && (!old.vehicle || !next.vehicle || old.vehicle===next.vehicle)) return true;
        if (old.columns && next.columns) {
            if (old.reference && next.reference && old.reference!==next.reference || old.vehicle && next.vehicle && old.vehicle!==next.vehicle ||
                old.time && next.time && old.time!==next.time) return false;
            return old.date===next.date && !!old.exit && old.entry===next.entry && old.exit===next.exit &&
                (!!old.entry || !!old.time && old.time===next.time);
        }
        const columns=next.columns, f=decodeEtcKey(old.key);
        if (!columns || !f) return false;
        const [d,a,e,x] = columns;
        const sameLayout=normalizeDate(f[d])===next.date && Number.isSafeInteger(etcAmount(f[a])) && e>=0 && x>=0 &&
            etcText(f[e])===next.entry && !!next.exit && etcText(f[x])===next.exit;
        const matchesRoute=e>=0 && x>=0 && !!next.entry && !!next.exit &&
            f.map(etcText).includes(next.entry) && f.map(etcText).includes(next.exit);
        return sameLayout && (!!next.entry || next.time && etcDetails(f,columns,next.date).time===next.time)
            || f.some(value=>normalizeDate(value)===next.date) && (matchesRoute || !!next.reference && f.map(etcText).includes(next.reference));
    }
    function etcAmount(value) {
        const raw=String(value||'').normalize('NFKC').replace(/[¥￥円,\s]/g,'');
        const n=/^\d+$/.test(raw) ? Number(raw) : null;
        return Number.isSafeInteger(n) && n>0 ? n : null;
    }
    function etcStoredDetails(old) {
        // 旧キーには列名がない。新しい明細の列順から元料金は復元できない。
        return Number.isSafeInteger(old.amount) && old.amount > 0 ? old : {};
    }

    function escapeHtml(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    return { normalizeDate, parseCsv, parseEtcCsv, parseEtcRows, etcCandidate, etcStoredDetails, escapeHtml };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ExpenseImport;

