// 依頼書の「登録先の月」を決める純関数。保存・画面・通信には触れない。
// 決め方(アキヤさんの運用: 依頼書は受信後に作業日を自分で決めるので、作業日入りはごく少数):
//   ①作業予定日・作業希望日が読めれば、その日付の月(今月でも来月でも)。 scheduleUnset=false
//   ②月次一覧の表題の月(titleText)。月次一覧は表題の月に紐づく。 scheduleUnset=false
//   ③どちらも無ければ month=null・scheduleUnset=true(月に紐づけず「日程未定」リストへ。要確認にはしない)。
//   作業日が複数の月にまたがる・食い違うときだけ needsReview=true(候補月を返す)。
// 受信日(receivedDate)は参考情報として receivedMonth に返すだけで、月の決定には使わない。
// 依頼日・受付日・最終訪問日など「作業予定ではない日付」は呼び出し側で渡さないこと。
// titleText は月次一覧(kind=一覧表)の表題・メール件名だけを渡す。ファイル名(発行日が入りやすい)や、
// 単件の依頼書の件名は渡さない。
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
    function receivedInfo(receivedDate) {
        if (receivedDate === undefined || receivedDate === null || receivedDate === '') return null;
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(receivedDate));
        if (!match) throw new Error('receivedDate は YYYY-MM-DD で指定してください。');
        return {date:String(receivedDate), month:`${match[1]}-${match[2]}`};
    }

    // 作業予定日(文字列または文字列の配列)・表題の月・受信日から、登録先の月を決める。
    // 戻り値: {month, basis, scheduleUnset, needsReview, reason, candidates, receivedMonth}
    function resolveRegistrationMonth({workDateText, titleText, receivedDate, today} = {}) {
        parseToday(today);
        const received = receivedInfo(receivedDate);
        // 年の無い日付は、受信日があれば受信日に、無ければ今日に最も近い年で読む。
        const options = {today: received ? received.date : today};
        const receivedMonth = received ? received.month : null;
        for (const [basis, values] of [['作業予定日', workDateText], ['件名・タイトル', titleText]]) {
            const candidates = monthsOf(values, options);
            if (candidates.length === 1) return {month:candidates[0], basis, scheduleUnset:false, needsReview:false, reason:`${basis}の${label(candidates[0])}に登録します。`, candidates, receivedMonth};
            if (candidates.length > 1) {
                return {month:null, basis, scheduleUnset:false, needsReview:true, reason:`${basis}が複数の月(${candidates.map(label).join('・')})にまたがります。登録先の月を選んでください。`, candidates, receivedMonth};
            }
        }
        return {month:null, basis:null, scheduleUnset:true, needsReview:false, reason:'作業日が決まっていないため、月に紐づけず「日程未定」に登録します。', candidates:[], receivedMonth};
    }
    // 取り込み時の登録先。作業日あり→その月 / 作業日なし→日程未定 / 複数月など→自動では決めない。
    // 'unscheduled' は DataStorage.UNSCHEDULED_ID と同じ値(テストで一致を確認)。
    const UNSCHEDULED_ID = 'unscheduled';
    function registrationTarget(resolution) {
        if (!resolution || resolution.needsReview) return {workspaceId:null, reviewNeeded:true, reason:(resolution && resolution.reason) || '登録先を判定できません。'};
        if (resolution.month) return {workspaceId:resolution.month, reviewNeeded:false, reason:resolution.reason};
        if (resolution.scheduleUnset) return {workspaceId:UNSCHEDULED_ID, reviewNeeded:false, reason:resolution.reason};
        return {workspaceId:null, reviewNeeded:true, reason:resolution.reason || '登録先を判定できません。'};
    }
    // 取り込み項目を登録先ごとに振り分ける(元の項目は書き換えない)。受信月は参考情報 receivedMonth として残す。
    function routeItems(items, {today, receivedDate} = {}) {
        const plan = {workspaces:{}, review:[], total:0};
        for (const item of items || []) {
            const resolution = resolveRegistrationMonth({workDateText:item.workDateText, titleText:item.titleText, receivedDate:item.receivedDate || receivedDate, today});
            const target = registrationTarget(resolution);
            const copy = {...item};
            if (resolution.receivedMonth) copy.receivedMonth = resolution.receivedMonth;
            plan.total += 1;
            if (target.reviewNeeded) { copy.reviewReason = target.reason; plan.review.push(copy); continue; }
            (plan.workspaces[target.workspaceId] = plan.workspaces[target.workspaceId] || []).push(copy);
        }
        return plan;
    }
    return {parseDates, resolveRegistrationMonth, registrationTarget, routeItems, UNSCHEDULED_ID};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RequestMonth;
