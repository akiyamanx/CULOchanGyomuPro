const EtcWorkflow = (() => {
    let state={records:[],days:{},selectedDate:''},draftMode=false,ready=false,busy=false,queue=Promise.resolve(),saveError=null,saveTimer;
    const el=id=>document.getElementById(id),day=()=>state.days[state.selectedDate];
    const message=text=>{el('etcSaveStatus').textContent=text;};
    function plans(date=state.selectedDate) {
        if(!date)return [];
        const month=date.slice(0,7),customers=DataStorage.getCustomersForWorkspace(month);
        const routes=DataStorage.getRoutes(month);
        return routes.map(route=>{
            const order=route.order||[],members=customers.filter(c=>c.routeId===route.id&&(c.appoDate||'').slice(0,10)===date);
            members.sort((a,b)=>(order.includes(a.id)?order.indexOf(a.id):999)-(order.includes(b.id)?order.indexOf(b.id):999));
            return {...route,members};
        }).filter(r=>r.members.length);
    }
    function planSignature(plan,date=state.selectedDate) {return JSON.stringify([DataStorage.getSettings().homeAddress,plan?.members?.map(c=>[c.id,c.company,c.address,c.appoDate,c.equipType,c.purpose]),plan?DataStorage.getSegments(date.slice(0,7))[plan.id]:null,plan?.distanceResults?.[date]]);}
    function changedPlans() {
        if(draftMode)return false;
        let changed=false;
        for(const d of Object.values(state.days)) {
            if(d.routeId && d.sourceSignature!==planSignature(plans(d.date).find(p=>p.id===d.routeId),d.date)) {
                if(!d.planChanged){d.planChanged=true;EtcJourney.invalidate(state.records,d.date);changed=true;}
            }
        }
        return changed;
    }
    function persist() {
        if(draftMode){message('下書きを編集中です。変更を残すには「下書きを保存」を押してください。');return Promise.resolve();}
        const value=EtcJourney.clone(state);message('ETCの確認内容を保存中…');
        queue=queue.catch(()=>{}).then(()=>EtcStore.save(value)).then(()=>{saveError=null;message('ETCの確認内容を保存しました。精算書の金額は「反映」で更新します。');},error=>{saveError=error;message('保存できませんでした。画面を閉じず、下書き保存を試してください。'+error.message);});
        return queue;
    }
    function lock(value) {busy=value;el('etcControls').disabled=value;}
    function scheduleSave() {clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;persist();},250);}
    function render() {
        if(changedPlans())persist();
        const dates=[...new Set(state.records.map(r=>r.date))].sort();
        el('etcDate').value=state.selectedDate;
        el('etcDates').innerHTML=EtcView.options(dates.map(d=>[d,d]),state.selectedDate);
        el('etcDateList').innerHTML=EtcView.options([['','日付を選ぶ'],...dates.map(d=>[d,d+'（'+state.records.filter(r=>r.date===d).length+'件）'])],state.selectedDate);
        el('etcInventory').textContent='保管中：'+state.records.length+'件 ／ '+dates.length+'日分';
        el('etcMode').textContent=draftMode?'下書きのETCを編集中（通常の保管明細とは別です）':'';
        el('etcRestoreLive').hidden=!draftMode;
        EtcView.trip(day(),plans());EtcView.records(state,day());EtcView.totals(state,day());
        if(day()?.planChanged)message('元の訪問予定が変更されています。「予定から読み込む」で更新して、寄り道と明細を確認し直してください。');
    }
    async function init() {
        EtcView.mount();lock(true);
        try{state=await EtcStore.read();ready=true;state.selectedDate ||= new Date().toLocaleDateString('sv-SE');render();}
        catch(error){message('ETCデータを読み込めません。再読込してください。'+error.message);return;}
        finally{if(ready)lock(false);}
        el('etcPdfInput').onchange=importPdf;
        for(const id of ['etcDate','etcDateList'])el(id).onchange=()=>{const value=ExpenseImport.normalizeDate(el(id).value);if(value){state.selectedDate=value;render();persist();}};
        el('etcWorkflow').addEventListener('change',edit);
        el('etcWorkflow').addEventListener('input',edit);
        el('etcWorkflow').addEventListener('click',event=>{const button=event.target.closest('[data-etc-action]');if(button)act(button.dataset.etcAction,Number(button.dataset.index)).catch(e=>alert(e.message));});
        el('etcReflect').onclick=()=>reflect().catch(e=>alert(e.message));
        el('etcPreview').onclick=()=>preview().catch(e=>alert(e.message));
        el('etcRestoreLive').onclick=async()=>{if(confirm('編集中の下書きETCを閉じて、通常の保管明細に戻りますか？未保存の編集は戻りません。')){try{state=await EtcStore.read();draftMode=false;render();}catch(e){alert(e.message);}}};
    }
    async function importPdf(event) {
        const file=event.target.files[0];event.target.value='';if(!file||busy)return;
        lock(true);const controller=new AbortController();
        try {
            const incoming=await EtcPdfReader.read(file,message,controller.signal),merged=EtcDocument.merge(state.records,incoming);
            const next={...state,records:merged.records,selectedDate:incoming[0].date};
            if(!draftMode){await queue;await EtcStore.save(next);saveError=null;}
            state=next;render();message(merged.added+'件を追加しました。重複 '+(incoming.length-merged.added)+'件は追加していません。'+(draftMode?'下書きを保存してください。':''));
        }catch(e){message('取り込めませんでした。今回のPDFは追加していません。'+e.message);}
        finally{lock(false);}
    }
    function makeDay(plan) {
        const address=DataStorage.getSettings().homeAddress||'',d={date:state.selectedDate,routeId:plan?.id||'',sourceSignature:plan?planSignature(plan):'',stops:[{id:'home_start',name:'会社',address,job:'hq',departure:''}],legs:[]};
        for(const c of plan?.members||[])d.stops.push({id:String(c.id),name:c.company||'訪問先',address:c.address||'',job:'hq',arrival:(c.appoDate||'').match(/[ T](\d{2}:\d{2})/)?.[1]||'',departure:'',machineName:c.equipType||'',purpose:c.purpose||''});
        d.stops.push({id:'home_end',name:'会社',address,job:'hq',arrival:''});EtcJourney.rebuild(d);
        const choices=plan ? DataStorage.getSegments(d.date.slice(0,7))[plan.id] || {} : {};
        d.legs.forEach(leg=>{leg.road=choices[leg.fromId+'_'+leg.toId] || 'unknown';});
        const saved=plan?.distanceResults?.[d.date],signature=JSON.stringify([address,(plan?.members||[]).map(c=>[c.id,c.address])]);
        if(saved?.signature===signature && saved.segments?.length===d.legs.length)d.legs.forEach((l,i)=>{l.km=saved.segments[i].km;l.road=saved.segments[i].type;l.roadText=saved.segments[i].roadText||'';});
        return d;
    }
    function updateRoute() {
        const d=day();EtcJourney.rebuild(d);EtcJourney.invalidate(state.records,d.date);
        // 区間の距離は訪問編集後に確認し直す。
        d.legs.forEach(l=>{l.km='';l.roadText='';});
    }
    function chooseLeg(record,id) {
        record.legId=id;record.confirmed=false;
        const d=day(),leg=d?.legs.find(l=>l.id===id);if(!leg)return;
        const from=d.stops.find(s=>s.id===leg.fromId),to=d.stops.find(s=>s.id===leg.toId),visit=to.id==='home_end'?from:to;
        record.visitCompany=visit.name;record.machineName=visit.machineName||'';record.purpose=visit.purpose||'';
        if(from.job==='other'||to.job==='other')record.owner='hold';
    }
    function edit(event) {
        const input=event.target,scope=input.dataset.scope;if(!scope||busy)return;
        if(event.type==='change'&&input.tagName==='INPUT')return;
        const index=Number(input.dataset.index),key=input.dataset.key,d=day();
        if(scope==='record') {
            const r=state.records[index];if(key==='legId')chooseLeg(r,input.value);
            else {r[key]=key==='claimAmount'?(input.value===''?null:Number(input.value)):input.value;r.confirmed=false;}
            if(key==='legId'||key==='owner')EtcView.records(state,d);
        }else if(d) {
            if(scope==='stop'){d.stops[index][key]=input.value;updateRoute();EtcView.legs(d);EtcView.routeLine?.(d);}
            if(scope==='leg'){d.legs[index][key]=input.value;if(key==='road'){d.legs[index].km='';d.legs[index].roadText='';}EtcJourney.invalidate(state.records,d.date);}
            EtcView.records(state,d);
        }
        EtcView.totals(state,d);scheduleSave();
    }
    async function act(action,index) {
        if(busy)return;const d=day();
        if(action==='plan'||action==='empty') {
            const plan=action==='plan'?plans().find(p=>p.id===el('etcPlan').value):null;
            if(action==='plan'&&!plan)throw new Error('日付と登録済みルートを選んでください。');
            if(d&&!confirm('この日の訪問順を入れ直します。追加した寄り道と距離は置き換わり、ETC明細は再確認になります。よろしいですか？'))return;
            state.days[state.selectedDate]=makeDay(plan);EtcJourney.invalidate(state.records,state.selectedDate);
        }else if(action==='add-stop') {
            const name=el('etcStopName').value.trim();if(!name)throw new Error('訪問先名を入力してください。');
            d.stops.splice(Number(el('etcAfter').value)+1,0,{id:'stop_'+crypto.randomUUID(),name,address:el('etcStopAddress').value.trim(),job:el('etcStopJob').value,arrival:'',departure:'',machineName:'',purpose:''});updateRoute();
        }else if(action==='up'||action==='down') {
            const next=index+(action==='up'?-1:1);if(index<1||next<1||index>=d.stops.length-1||next>=d.stops.length-1)return;
            [d.stops[index],d.stops[next]]=[d.stops[next],d.stops[index]];updateRoute();
        }else if(action==='remove-stop') {if(!confirm(d.stops[index].name+'をこの日の訪問順から外しますか？'))return;d.stops.splice(index,1);updateRoute();}
        else if(action==='candidate') {const r=state.records[index],candidate=EtcJourney.candidates(r,d)[0];if(candidate)chooseLeg(r,candidate.id);}
        else if(action==='confirm') {if(d?.planChanged)throw new Error('変更された訪問予定を先に読み直してください。');EtcJourney.confirm(state.records[index],d);}
        else if(action==='calculate') {await calculate();return;}
        const openStops=el('etcStopsDetails')?.open,openLegs=el('etcLegsDetails')?.open;
        render();if(openStops||['add-stop','empty'].includes(action))el('etcStopsDetails').open=true;if(openLegs)el('etcLegsDetails').open=true;
        await persist();
    }
    async function calculate() {
        const d=day();if(!d||d.stops.some(s=>!s.address?.trim()))throw new Error('会社とすべての訪問先の住所を入力してください。');
        if(d.legs.some(l=>l.road==='unknown'))throw new Error('各区間で「高速を利用」または「一般道」を選んでください。');
        if(typeof google==='undefined'||!google.maps?.DirectionsService)throw new Error('地図の設定と接続を確認してください。距離は区間ごとに手入力もできます。');
        lock(true);
        try {
            // 失敗時は以前の距離・確定済み金額を有効扱いにしない。
            d.legs.forEach(l=>{l.km='';l.roadText='';});EtcJourney.invalidate(state.records,d.date);await persist();
            const values=[];
            for(let i=0;i<d.legs.length;i++){message((i+1)+' / '+d.legs.length+'区間の距離を計算中…');values.push(await DistanceCalc.getDistance(d.stops[i].address,d.stops[i+1].address,d.legs[i].road==='general'));}
            d.legs.forEach((l,i)=>{l.km=Math.round(values[i].distanceM/100)/10;l.roadText=values[i].roadText||'';});await persist();
        } finally {render();el('etcLegsDetails').open=true;lock(false);}
    }
    async function capture() {
        if(!ready||busy)throw new Error('ETCの読み込み・処理が終わってから保存してください。');
        document.activeElement?.blur();clearTimeout(saveTimer);saveTimer=null;changedPlans();await persist();await queue;
        // 下書きは独立した保存先なので通常の保存失敗時にも退避できる。
        return EtcJourney.clone(state);
    }
    async function beforeLoad() {
        if(!ready||busy)throw new Error('ETCの読み込み・処理が終わってから下書きを開いてください。');
        clearTimeout(saveTimer);saveTimer=null;await persist();await queue;
        if(saveError&&!draftMode)throw new Error('現在のETC編集を保存できません。先に下書きとして保存してください。');
    }
    async function settled() {
        if(!ready||busy)throw new Error('ETCの読み込み・処理が終わってから操作してください。');
        if(saveTimer){clearTimeout(saveTimer);saveTimer=null;await persist();}
        await queue;
        if(saveError&&!draftMode)throw new Error('現在のETC編集を保存できません。保存状態を確認してください。');
    }
    function load(value) {if(value){state=EtcJourney.clone(value);draftMode=true;render();}else if(draftMode){state={records:[],days:{},selectedDate:new Date().toLocaleDateString('sv-SE')};render();} }
    function isManaged(date) {return Boolean(ready&&state.days[date]);}
    function assertSynced() {
        if(!ready)throw new Error('ETCの保存データを確認中です。');
        if(changedPlans()){render();persist();}
        for(const row of ExpenseManager.getRowsData()) {
            if(!row.etcPdfFingerprint)continue;
            const d=state.days[row.date];
            if(!d||d.planChanged||row.etcPdfFingerprint!==EtcJourney.fingerprint(state.records,d))throw new Error(row.date+' のETC・訪問順が変更されています。明細を確認して精算書へ反映し直してください。');
            const total=EtcJourney.totals(state.records,d);
            if(ExpenseManager.parseHighway(row.highway)!==total.amount||Number(row.highwayCount)!==total.accepted.length||Number(row.distance)!==EtcJourney.distance(d))throw new Error(row.date+' の金額・距離がETC確認内容と違います。反映し直してください。');
        }
    }
    async function reflect() {
        await capture();const d=day();if(!d)throw new Error('この日の訪問順を先に登録してください。');
        if(d.planChanged)throw new Error('変更された予定を読み直して確認してください。');
        const totals=EtcJourney.totals(state.records,d),km=EtcJourney.distance(d);
        if(totals.pending&&!confirm('要確認 '+totals.pending+'件は除外します。確定した本部分 '+totals.accepted.length+'件だけ反映しますか？'))return;
        ExpenseManager.applyEtcDay(d,totals,km,EtcJourney.fingerprint(state.records,d));
    }
    async function preview() {
        await capture();const d=day();if(!d||d.planChanged)throw new Error('訪問順を確認してください。');
        const total=EtcJourney.totals(state.records,d);if(!total.accepted.length)throw new Error('本部に提出する明細を確認して確定してください。');
        if(total.pending&&!confirm('要確認 '+total.pending+'件を除き、本部の確定分だけPDFにしますか？'))return;
        const items=total.accepted.map(r=>({...r,captionLines:['日付：'+r.date+' '+r.time,'区間：'+(r.legId==='shared'?'共通区間':d.legs.find(l=>l.id===r.legId).label),'訪問先：'+r.visitCompany,'目的：'+r.machineName+'・'+r.purpose,...(r.claimAmount!==r.amount?['本部提出額：'+r.claimAmount+'円（証明書 '+r.amount+'円）']:[]),...(r.note?['メモ：'+r.note]:[])]}));
        await ParkingPdf.generate({items,pageSize:Number(el('etcPageSize').value),title:'高速道路利用明細',sourceLabel:'ETC・本部提出分'});
    }
    return {init,capture,beforeLoad,settled,load,isManaged,assertSynced,preview};
})();
