// 依頼書の「登録先の月」を決める純関数。保存・画面・通信には触れない。
// 優先順位: ①作業予定日 → ②件名・タイトルの月 → ③どちらも無ければ要確認(自動登録せず確認画面へ)。
// 依頼日・受付日・最終訪問日など「作業予定ではない日付」は呼び出し側で渡さないこと。
// タイトルにはファイル名(発行日が入りやすい)を渡さず、メール件名や一覧表の表題だけを渡す。
const RequestMonth = (() => {
    const UNKNOWN = '[○〇◯●◎□■×xX*＊丸々〃]';
    const DAY = `(\\d{1,2}(?![\\d:])|${UNKNOWN}+)`;
    const MAX_DAYS = [0,31,29,31,30,31,30,31,31,30,31,30,31]; // 年が不明な2月は29日まで許す
    const pad = value => String(value).padStart(2, '0');
    const daysIn = (year, month) => year ? new Date(year, month, 0).getDate() : MAX_DAYS[month];

    function normalize(value) {
        return String(value ?? '').normalize('NFKC');
    }
    function todayInTokyo() {
        const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
        return parts;
    }
    function parseToday(today) {
        const value = today ?? todayInTokyo();
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
        if (!match) throw new Error('today は YYYY-MM-DD で指定してください。');
        return {year:Number(match[1]), month:Number(match[2])};
    }
    // 年が書かれていない月日は、今日の月に最も近い年とみなす(同距離なら未来側。依頼書は先の予定が多い)。
    function nearestYear(month, now) {
        let best = null;
        for (const year of [now.year - 1, now.year, now.year + 1]) {
            const gap = year * 12 + month - (now.year * 12 + now.month);
            if (!best || Math.abs(gap) < Math.abs(best.gap) || (Math.abs(gap) === Math.abs(best.gap) && gap > best.gap)) best = {year, gap};
        }
        return best.year;
    }
    const validMonth = month => Number.isInteger(month) && month >= 1 && month <= 12;
    const dayValue = raw => (raw !== undefined && /^\d+$/.test(raw)) ? Number(raw) : null; // 伏せ字・未記入はnull

    const PATTERNS = [
        // 和暦: 令和8年11月5日 / R8.11.5 / H30.4.1 / 令和元年5月1日
        {name:'era', re:new RegExp(`(令和|平成|(?<![A-Za-z])[RH](?![A-Za-z]))\\s*(元|\\d{1,2})\\s*(?:年|[./-])\\s*(\\d{1,2})(?:\\s*月\\s*${DAY}?\\s*日?|[./-]${DAY})?`, 'g'),
            read:m => ({year:({'令和':2018,'R':2018,'平成':1988,'H':1988})[m[1]] + (m[2] === '元' ? 1 : Number(m[2])), month:Number(m[3]), day:m[4] ?? m[5]})},
        // 西暦4桁: 2026年11月5日 / 2026/11/5 / 2026-11-05 / 2026/11
        {name:'ymd-kanji', re:new RegExp(`(?<![\\d])(20\\d{2})\\s*年\\s*(\\d{1,2})\\s*月\\s*${DAY}?\\s*日?`, 'g'),
            read:m => ({year:Number(m[1]), month:Number(m[2]), day:m[3]})},
        {name:'ymd-sep', re:new RegExp(`(?<![\\d/.-])(20\\d{2})[/.-](\\d{1,2})(?:[/.-]${DAY}|(?![\\d]))`, 'g'),
            read:m => ({year:Number(m[1]), month:Number(m[2]), day:m[3]})},
        // 西暦2桁: 26/11/5 / 26年11月(電話番号の「00-0000-0000」と区別するため区切りは / と 年 だけ)
        {name:'yy', re:new RegExp(`(?<![\\d/.-])(\\d{2})(?:\\s*年\\s*(\\d{1,2})\\s*月\\s*${DAY}?\\s*日?|/(\\d{1,2})/${DAY})`, 'g'),
            read:m => m[2] !== undefined
                ? {year:2000 + Number(m[1]), month:Number(m[2]), day:m[3]}
                : {year:2000 + Number(m[1]), month:Number(m[4]), day:m[5]}},
        // 月日(年なし): 11月5日 / 11月○○日 / 11月 / 11月上旬
        {name:'m-kanji', re:new RegExp(`(?<![\\d/.-])(\\d{1,2})\\s*月\\s*${DAY}?\\s*日?`, 'g'),
            read:m => ({year:null, month:Number(m[1]), day:m[2]})},
        // 月/日(年なし): 11/5
        {name:'m-slash', re:/(?<![\d/.:-])(\d{1,2})\/(\d{1,2})(?![\d/:.])/g,
            read:m => ({year:null, month:Number(m[1]), day:m[2]})}
    ];

    // 文字列に含まれる日付(月まで分かるもの)を出現順に返す。月が判らないものは含めない。
    function parseDates(value, {today} = {}) {
        const now = parseToday(today);
        const source = normalize(value);
        const taken = [];
        const found = [];
        for (const pattern of PATTERNS) {
            for (const match of source.matchAll(pattern.re)) {
                const start = match.index, end = start + match[0].length;
                if (taken.some(([a, b]) => start < b && end > a)) continue;
                taken.push([start, end]);
                const read = pattern.read(match);
                // 西暦2桁は今年の前後2年だけ認める(「11/5/6」のような別の並びを年月日と誤読しないため)。
                if (pattern.name === 'yy' && Math.abs(read.year - now.year) > 2) continue;
                if (!validMonth(read.month)) continue;
                const year = read.year ?? nearestYear(read.month, now);
                const day = dayValue(read.day);
                if (day !== null && (day < 1 || day > daysIn(read.year, read.month))) continue;
                found.push({start, year, month:`${year}-${pad(read.month)}`, day, text:match[0].trim()});
            }
        }
        return found.sort((a, b) => a.start - b.start).map(({start, ...rest}) => rest);
    }

    const toList = value => (Array.isArray(value) ? value : [value]).filter(item => item !== null && item !== undefined);
    function monthsOf(values, options) {
        return [...new Set(toList(values).flatMap(value => parseDates(value, options).map(date => date.month)))].sort();
    }
    const label = month => month.replace(/^(\d{4})-0?(\d+)$/, '$1年$2月');

    // 作業予定日(文字列または文字列の配列)と件名・タイトルから登録月を決める。
    function resolveRegistrationMonth({workDateText, titleText, today} = {}) {
        const options = {today};
        parseToday(today);
        for (const [basis, values] of [['作業予定日', workDateText], ['件名・タイトル', titleText]]) {
            const candidates = monthsOf(values, options);
            if (candidates.length === 1) return {month:candidates[0], basis, needsReview:false, reason:`${basis}の${label(candidates[0])}に登録します。`, candidates};
            if (candidates.length > 1) {
                return {month:null, basis, needsReview:true, reason:`${basis}が複数の月(${candidates.map(label).join('・')})にまたがります。登録先の月を選んでください。`, candidates};
            }
        }
        return {month:null, basis:null, needsReview:true, reason:'作業予定日も件名・タイトルの月も読み取れませんでした。登録先の月を選んでください。', candidates:[]};
    }
    return {parseDates, resolveRegistrationMonth};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RequestMonth;
