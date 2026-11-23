// 今日の一覧は保存済みの訪問を読むだけ。現在の対象月、アポ状態、ルートは変えない。
const TodayVisits = (() => {
    const jst = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',
        hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
    function clock(date = new Date()) {
        const p=Object.fromEntries(jst.formatToParts(date).map(x=>[x.type,x.value]));
        return {day:p.year+'-'+p.month+'-'+p.day,time:p.hour+':'+p.minute};
    }
    const rawStart = c => typeof c?.appoDate==='string' ? c.appoDate : '';
    const dayOf = c => rawStart(c).slice(0,10);
    function startTime(c,planner) {
        const raw=rawStart(c), time=raw.slice(11,16);
        return /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d)?$/.test(raw) && planner.combine(dayOf(c),time) ? time : '';
    }
    const validStart = (c,planner) => Boolean(planner.combine(dayOf(c),'12:00'))
        && (rawStart(c).length===10 || !!startTime(c,planner));
    const orderKey = (c,day,planner) => dayOf(c)<day ? '00:00' : (startTime(c,planner)||'99:99');
    function read(storage,day,planner) {
        const month=day.slice(0,7), current=storage.getCurrentWorkspaceId?.();
        let incomplete=false, workspaces=[];
        try {
            const registered=storage.getWorkspaces?.() || [];
            if(!Array.isArray(registered))throw Error('workspace list');
            workspaces=registered;
        } catch { incomplete=true; }
        const ids=new Set([current,month,...workspaces.map(w=>w?.id)]);
        const inScope=[...ids].filter(id=>/^\d{4}-(?:0[1-9]|1[0-2])$/.test(id) && id<=month)
            .sort((a,b)=>b.localeCompare(a)); // 同じIDが複数月にある場合は新しい月を優先。
        const rows=[], seen=new Set();
        function add(list,ws) {
            if(!Array.isArray(list))throw Error('visit list');
            for(const c of list) {
                if(c?.id && !seen.has(c.id) && validStart(c,planner) && planner.onDay(c,day)) {
                    seen.add(c.id);
                    rows.push({...c,workspaceId:ws});
                }
            }
        }
        for(const ws of inScope) {
            try { add(storage.getCustomersForWorkspace(ws),ws); }
            catch { incomplete=true; }
        }
        if(!current && storage.getCustomers) {
            try { add(storage.getCustomers(),null); }
            catch { incomplete=true; }
        }
        rows.sort((a,b)=>orderKey(a,day,planner).localeCompare(orderKey(b,day,planner))
            || rawStart(a).localeCompare(rawStart(b)) || String(a.id).localeCompare(String(b.id)));
        return {rows,incomplete};
    }
    function next(rows,when,planner) {
        return rows.filter(c=>c?.status==='appointed' && !c.dateNeedsReview && !['preferred','undated'].includes(c.scheduleKind)
            && dayOf(c)===when.day && startTime(c,planner) && startTime(c,planner)>=when.time)
            .sort((a,b)=>startTime(a,planner).localeCompare(startTime(b,planner)))[0] || null;
    }
    const timeText = (c,day,planner) => startTime(c,planner) ? (planner.timeLabel(c,day)||'時刻未定') : '時刻未定';
    function locationDetails(visit) {
        const str = v => typeof v === 'string' ? v.trim() : '';
        const norm = v => str(v).normalize('NFKC').toUpperCase();
        const address = str(visit?.address), rawBuilding = str(visit?.buildingName), normalized = norm(address);
        const floor = '(?:(?:地下|B)\\s*\\d{1,3}(?:\\s*[F階])?|\\d{1,3}\\s*[F階])';
        const roles = {reception:'受付',equipment:'(?:機器|機械)(?:の)?設置|設置|機器|機械'};
        const suffix={}, prefix={};
        for (const [key,role] of Object.entries(roles)) {
            suffix[key] = new Set([...normalized.matchAll(new RegExp('('+floor+')\\s*(?:に\\s*)?(?:'+role+')','g'))].map(m=>m[1]));
            prefix[key] = new Set([...normalized.matchAll(new RegExp('(?:'+role+')\\s*[:：は]?\\s*('+floor+')','g'))].map(m=>m[1]));
        }
        const matched = side => Object.values(side).filter(values=>values.size>0).length;
        const direction = Math.sign(matched(suffix)-matched(prefix));
        const pick = (value,key) => {
            if (str(value)) return str(value);
            const found = direction>0 ? suffix[key] : direction<0 ? prefix[key] : new Set([...suffix[key],...prefix[key]]);
            return found.size === 1 ? [...found][0] : '';
        };
        const reception = pick(visit?.receptionFloor,'reception');
        const equipment = pick(visit?.equipmentFloor,'equipment');
        const standard = v => norm(v).replace(/\s/g,'').replace(/F$/,'階');
        const other = [...new Set((Array.isArray(visit?.floors) ? visit.floors : []).map(str).filter(f=>f && ![reception,equipment].some(x=>standard(x)===standard(f))))].join('・');
        return { address, building:rawBuilding && !normalized.includes(norm(rawBuilding)) ? rawBuilding : '', reception, equipment, other };
    }
    function directions(value) {
        const address=String(value??'').trim();
        if(!address)return '';
        const q=new URLSearchParams({api:'1',destination:address,travelmode:'driving'});
        const url='https://www.google.com/maps/dir/?'+q;
        return url.length<=2048 ? url : '';
    }
    return {clock,read,next,timeText,locationDetails,directions};
})();
if(typeof module!=='undefined')module.exports=TodayVisits;
