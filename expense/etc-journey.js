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
    function candidates(record,day) {
        if(!day)return [];
        const time=minutes(record.time);
        return day.legs.map((leg,index)=>{
            const from=day.stops[index],to=day.stops[index+1],start=minutes(from.departure),end=minutes(to.arrival);
            let score=0;const reasons=[];
            if(leg.road==='highway'){score+=1;reasons.push('高速の設定');}
            if(time!==null && start!==null && end!==null && start<=end) {
                if(time>=start && time<=end){score+=5;reasons.push('区間の時刻内');}else{score-=6;}
            }
            const road=clean(leg.roadText);
            for(const [key,label] of [['entry','入口'],['exit','出口']]) {
                const value=clean(record[key]);
                if(value.length>=2 && ((leg[key] && clean(leg[key])===value)||road.includes(value))) {score+=4;reasons.push(label+'料金所が一致');}
            }
            if(from.job==='other'||to.job==='other')reasons.push('別の仕事の前後');
            return {id:leg.id,label:leg.label,score,reasons};
        }).filter(c=>c.score>0).sort((a,b)=>b.score-a.score);
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
    return {clone,minutes,rebuild,signature,invalidate,candidates,validDecision,confirm,totals,distance,fingerprint};
})();
if(typeof module!=='undefined')module.exports=EtcJourney;
