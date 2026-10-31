// 訪問順・料金候補・提出判断。推測した候補を確定金額に混ぜない。
const EtcJourney = (() => {
    const clean=s=>String(s||'').normalize('NFKC').replace(/<[^>]*>|\s|[（）()]/g,'');
    const clone=value=>JSON.parse(JSON.stringify(value));
    const minutes=time=>/^\d{2}:\d{2}$/.test(time||'')?Number(time.slice(0,2))*60+Number(time.slice(3)):null;
    function rebuild(day) {
        const old=new Map((day.legs||[]).map(l=>[l.id,l]));
        day.legs=day.stops.slice(0,-1).map((from,i)=>{
            const to=day.stops[i+1],id=from.id+'>'+to.id,context=JSON.stringify([from.address,to.address,from.job,to.job]);
            const saved=old.get(id),previous=saved?.context===context?saved:null;
            return {...(previous||{}),id,context,fromId:from.id,toId:to.id,label:from.name+' → '+to.name,
                road:previous?.road||'unknown',km:previous?.km??'',distanceOwner:previous?.distanceOwner||(from.job==='other'||to.job==='other'?'hold':'hq'),
                roadText:previous?.roadText||'',entry:previous?.entry||'',exit:previous?.exit||''};
        });
        return day;
    }
    function signature(day) {return JSON.stringify([day.stops,day.legs]);}
    function invalidate(records,date) {records.filter(r=>r.date===date).forEach(r=>{r.confirmed=false;});}
    // 照合用の仮の時刻。保存せず、入力済みの時刻は上書きしない。明細の時刻は「出口料金所を出た時刻」。
    // onSiteMinutes: 到着から出発までの作業時間 / leadMinutes: 最初の訪問の何分前に会社を出るか
    // returnMinutes: 最後の訪問から会社へ戻るまでの最大時間 / graceMinutes: 到着時刻を少し過ぎた出口時刻の許容
    const TIMING={onSiteMinutes:60,leadMinutes:120,returnMinutes:240,graceMinutes:15};
    const clock=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
    function effectiveTimes(day,options={}) {
        const t={...TIMING,...options},stops=day?.stops||[];
        return stops.map((stop,i)=>{
            let departure=minutes(stop.departure),depProv=false,arrival=minutes(stop.arrival),arrProv=false;
            if(departure===null && i<stops.length-1) {
                const own=minutes(stop.arrival),next=minutes(stops[i+1]?.arrival);
                if(i===0){if(next!==null){departure=Math.max(0,next-t.leadMinutes);depProv=true;}}
                else if(own!==null){departure=own+t.onSiteMinutes;if(next!==null&&next>own)departure=Math.min(departure,next);departure=Math.min(departure,1439);depProv=true;}
            }
            return {departure,departureProvisional:depProv,arrival,arrivalProvisional:arrProv};
        }).map((x,i,all)=>{
            // 帰社の到着が空なら、直前の出発から returnMinutes までを帰り道の範囲にする。
            if(i===all.length-1 && i>0 && x.arrival===null && all[i-1].departure!==null){x.arrival=Math.min(all[i-1].departure+t.returnMinutes,1439);x.arrivalProvisional=true;}
            return x;
        });
    }
    function provisionalLabel(day,index,key) {
        const x=effectiveTimes(day)[index];
        return x&&x[key+'Provisional']?clock(x[key]):'';
    }
    function candidates(record,day,options={}) {
        if(!day)return [];
        const time=minutes(record.time),times=effectiveTimes(day,options),grace={...TIMING,...options}.graceMinutes;
        return day.legs.map((leg,index)=>{
            const from=day.stops[index],to=day.stops[index+1],a=times[index]||{},b=times[index+1]||{};
            const start=a.departure??null,end=b.arrival??null;
            let score=0,timeMatch=false;const reasons=[];
            if(leg.road==='highway'){score+=1;reasons.push('高速の設定');}
            if(time!==null && start!==null && end!==null && start<=end) {
                // 出口時刻なので、出発より後・到着(＋少し)より前なら区間内。
                const prov=a.departureProvisional||b.arrivalProvisional;
                if(time>=start && time<=end+grace){score+=5;timeMatch=true;reasons.push(prov?'区間の時刻内（仮の時刻で判定）':'区間の時刻内');}else{score-=6;}
            }
            const road=clean(leg.roadText);
            for(const [key,label] of [['entry','入口'],['exit','出口']]) {
                const value=clean(record[key]);
                if(value.length>=2 && ((leg[key] && clean(leg[key])===value)||road.includes(value))) {score+=4;reasons.push(label+'料金所が一致');}
            }
            if(from.job==='other'||to.job==='other')reasons.push('別の仕事の前後');
            return {id:leg.id,label:leg.label,score,reasons,timeMatch};
        }).filter(c=>c.score>0).sort((a,b)=>b.score-a.score);
    }
    // 提案する区間：時刻で当てはまる区間が1つだけ、または1位が2位より4点以上高く時刻も合う場合だけ。確定はしない。
    function suggestion(record,day,options={}) {
        const list=candidates(record,day,options),timed=list.filter(c=>c.timeMatch);
        if(timed.length===1)return timed[0].id;
        if(list[0]?.timeMatch && list[0].score-(list[1]?.score??0)>=4)return list[0].id;
        return '';
    }
    function validDecision(record,day) {
        if(!record.confirmed || !day || record.routeSignature!==signature(day))return false;
        if(record.owner==='other')return true;
        if(record.owner!=='hq')return false;
        if(record.legId!=='shared' && !day.legs.some(l=>l.id===record.legId))return false;
        return Number.isSafeInteger(record.claimAmount) && record.claimAmount>=0 && record.claimAmount<=record.amount &&
            Boolean(record.visitCompany?.trim() && record.machineName?.trim() && record.purpose?.trim() && (record.legId!=='shared'||record.note?.trim()));
    }
    function confirm(record,day) {
        if(!day)throw new Error('先にこの日の訪問順を登録してください。');
        if(record.owner==='hold'){record.confirmed=false;return;}
        const candidate={...record,confirmed:true,routeSignature:signature(day)};
        if(!validDecision(candidate,day))throw new Error('移動区間・提出額（元の金額以下）・訪問先・機種・目的を確認してください。共通区間はメモも必要です。');
        Object.assign(record,candidate);
    }
    function totals(records,day) {
        const selected=records.filter(r=>r.date===day?.date);
        const accepted=selected.filter(r=>validDecision(r,day)&&r.owner==='hq');
        return {accepted,amount:accepted.reduce((s,r)=>s+r.claimAmount,0),pending:selected.filter(r=>!validDecision(r,day)).length,
            other:selected.filter(r=>validDecision(r,day)&&r.owner==='other').length};
    }
    function distance(day) {
        if(!day || day.legs.some(l=>l.distanceOwner==='hold'))throw new Error('寄り道前後の距離を本部・別の仕事のどちらに含めるか確認してください。');
        const legs=day.legs.filter(l=>l.distanceOwner==='hq');
        if(legs.some(l=>l.km==='' || !Number.isFinite(Number(l.km)) || Number(l.km)<0))throw new Error('本部へ提出する区間の距離を計算または入力してください。');
        return Math.round(legs.reduce((s,l)=>s+Number(l.km),0)*10)/10;
    }
    function fingerprint(records,day) {
        return JSON.stringify([signature(day),records.filter(r=>r.date===day.date).map(({id,owner,confirmed,routeSignature,legId,claimAmount,visitCompany,machineName,purpose,note})=>({id,owner,confirmed,routeSignature,legId,claimAmount,visitCompany,machineName,purpose,note}))]);
    }
    return {TIMING,effectiveTimes,provisionalLabel,suggestion,clone,minutes,rebuild,signature,invalidate,candidates,validDecision,confirm,totals,distance,fingerprint};
})();
if(typeof module!=='undefined')module.exports=EtcJourney;
