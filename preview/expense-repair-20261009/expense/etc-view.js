const EtcView = (() => {
    const e=value=>ExpenseImport.escapeHtml(value??'');
    const options=(values,current)=>values.map(([value,label])=>'<option value="'+e(value)+'"'+(String(value)===String(current)?' selected':'')+'>'+e(label)+'</option>').join('');
    const field=(label,html)=>'<label>'+e(label)+html+'</label>';
    const input=(scope,index,key,value,type='text')=>'<input data-scope="'+scope+'" data-index="'+index+'" data-key="'+key+'" type="'+type+'" value="'+e(value)+'"'+(type==='number'?' min="0" step="0.1"':'')+'>';
    const select=(scope,index,key,value,values)=>'<select data-scope="'+scope+'" data-index="'+index+'" data-key="'+key+'">'+options(values,value)+'</select>';
    function mount() {
        document.getElementById('etcWorkflow').innerHTML='<p class="section-desc">月まとめPDFから1日ずつ確認。寄り道がある日も、提出する分を選べます。</p><p id="etcMode" role="status"></p><fieldset id="etcControls"><legend class="sr-only">ETCと寄り道の確認</legend>'+
            '<div class="etc-toolbar"><label class="btn btn-primary file-control">① 月まとめPDFを追加<input id="etcPdfInput" type="file" accept="application/pdf,.pdf" class="file-input"></label><button type="button" id="etcRestoreLive" class="btn btn-secondary" hidden>保存済みのETCに戻る</button></div><p class="parking-caption">ETC利用照会のA4横・5列×2段形式。初回は読み取り機能の準備に通信が必要です。PDFの内容は外部AIへ送信しません。</p>'+
            '<div class="etc-toolbar">'+field('② 確認する日','<input id="etcDate" type="date" list="etcDates"><datalist id="etcDates"></datalist>')+field('明細のある日','<select id="etcDateList"></select>')+'</div><p id="etcInventory"></p><div id="etcTrip"></div><div id="etcTotals" class="etc-totals" aria-live="polite"></div><div id="etcRecords"></div>'+
            '<div class="etc-submit"><button type="button" class="btn btn-save" id="etcReflect">③ 確定した分を精算書に反映</button><button type="button" class="btn btn-primary" id="etcPreview">本部提出用PDFを見る</button>'+field('1ページの枚数','<select id="etcPageSize"><option value="6">6枚</option><option value="4">4枚（大きく）</option></select>')+'</div><p class="parking-caption">保留分は提出に入りません。別の仕事は明細を残して除外します。PDFと同じ日のCSV料金は重ねて加算しません。下書きを保存するとETCの写真と確認内容も一緒に保存します。</p></fieldset><p id="etcSaveStatus" role="status" aria-live="polite"></p>';
    }
    function trip(day,plans) {
        let html='<div class="etc-plan"><strong>この日の訪問順</strong><div class="etc-toolbar">'+field('登録済みルート','<select id="etcPlan">'+options([['','ルートを選ぶ'],...plans.map(p=>[p.id,p.name])],day?.routeId||'')+'</select>')+'<button type="button" class="btn btn-secondary" data-etc-action="plan">予定から読み込む</button><button type="button" class="btn btn-secondary" data-etc-action="empty">訪問順を手入力する</button></div>';
        if(!day){document.getElementById('etcTrip').innerHTML=html+'<p>先に日付を選び、訪問ルートを読み込むか手入力してください。明細だけ先に保管しておけます。</p></div>';return;}
        html+='<p class="etc-route-line">'+day.stops.map(s=>e(s.name)+(s.job==='other'?'〈別の仕事〉':'')).join(' → ')+'</p><details id="etcStopsDetails"><summary>訪問順を確認・寄り道を追加</summary><p class="parking-caption">時刻は任意です。予定時刻が入る場合があります。実際の時刻に直すと照合候補が絞れます。</p><div class="etc-stops">';
        day.stops.forEach((stop,i)=>{
            const end=i===0||i===day.stops.length-1;
            html+='<div class="etc-stop"><strong>'+e(end?stop.name:i+'. '+stop.name)+'</strong><div class="etc-fields">'+(!end?field('訪問先',input('stop',i,'name',stop.name)):'')+field('住所',input('stop',i,'address',stop.address))+(!end?field('仕事',select('stop',i,'job',stop.job,[['hq','本部の仕事'],['other','別の仕事']]))+field('機種名',input('stop',i,'machineName',stop.machineName))+field('作業内容',input('stop',i,'purpose',stop.purpose)):'')+
                (i?field('到着',input('stop',i,'arrival',stop.arrival,'time')):'')+(i<day.stops.length-1?field('出発',input('stop',i,'departure',stop.departure,'time')):'')+'</div>';
            if(!end)html+='<div class="etc-toolbar"><button type="button" class="btn btn-secondary" data-etc-action="up" data-index="'+i+'"'+(i===1?' disabled':'')+'>前へ</button><button type="button" class="btn btn-secondary" data-etc-action="down" data-index="'+i+'"'+(i===day.stops.length-2?' disabled':'')+'>後へ</button><button type="button" class="btn btn-secondary" data-etc-action="remove-stop" data-index="'+i+'">この訪問を外す</button></div>';
            html+='</div>';
        });
        html+='</div><div class="etc-add-stop"><h5>訪問・寄り道を追加</h5><div class="etc-fields">'+field('入れる位置','<select id="etcAfter">'+options(day.stops.slice(0,-1).map((s,i)=>[i,s.name+'の後']),0)+'</select>')+field('訪問先名','<input id="etcStopName" placeholder="例：X社">')+field('住所','<input id="etcStopAddress">')+field('仕事','<select id="etcStopJob"><option value="other">別の仕事</option><option value="hq">本部の仕事</option></select>')+'</div><button type="button" class="btn btn-secondary" data-etc-action="add-stop">この位置に追加</button></div></details><details id="etcLegsDetails"><summary>区間の距離・高速利用を確認</summary><p class="parking-caption">本部に含める距離だけを合計します。寄り道前後は要確認です。距離は手入力もできます。</p><button type="button" class="btn btn-secondary" data-etc-action="calculate">住所から区間距離を計算</button><div id="etcLegs"></div></details></div>';
        document.getElementById('etcTrip').innerHTML=html;legs(day);
    }
    function legs(day) {
        const host=document.getElementById('etcLegs');if(!host)return;
        host.innerHTML=day.legs.map((leg,i)=>'<div class="etc-leg"><strong>'+e(leg.label)+'</strong><div class="etc-fields">'+field('道路',select('leg',i,'road',leg.road,[['unknown','道路は未確認'],['highway','高速を利用'],['general','一般道']]))+field('距離（km）',input('leg',i,'km',leg.km,'number'))+field('距離の提出先',select('leg',i,'distanceOwner',leg.distanceOwner,[['hq','本部に含める'],['other','別の仕事'],['hold','要確認']]))+'</div><details><summary>料金所の手がかり（任意）</summary><div class="etc-fields">'+field('入口料金所',input('leg',i,'entry',leg.entry))+field('出口料金所',input('leg',i,'exit',leg.exit))+'</div><p class="parking-caption">名称が明細と一致すると候補に使います。地図から取得できた道路名も照合します。</p></details></div>').join('');
    }
    function records(state,day) {
        const records=state.records.filter(r=>r.date===state.selectedDate);
        document.getElementById('etcRecords').innerHTML=records.length?records.map(r=>{
            const index=state.records.indexOf(r),valid=EtcJourney.validDecision(r,day),candidates=EtcJourney.candidates(r,day),top=candidates[0];
            const choices=[['','区間を選ぶ'],...(day?.legs||[]).map(l=>[l.id,l.label]),['shared','複数の区間にまたがる（共通）']];
            return '<article class="etc-record" data-record-index="'+index+'"><div class="etc-receipt-head"><img src="'+e(r.imageDataUrl)+'" alt="元のETC利用証明書" loading="lazy"><div><strong>'+e(r.time)+'　¥'+r.amount.toLocaleString()+'</strong><p>'+e(r.entry||'入口記載なし')+' → '+e(r.exit||'出口記載なし')+'</p><span class="etc-badge '+(valid?r.owner:'pending')+'">'+(valid?(r.owner==='hq'?'本部・確定':'別の仕事・確定'):'要確認')+'</span><p class="parking-caption">'+e(r.sourceName)+'・'+r.sourcePage+'ページ</p></div></div>'+
                '<p class="etc-candidate">'+(top?'候補：'+e(top.label)+'<br>'+e(top.reasons.join(' ／ '))+(candidates[1]?.score===top.score?' ／ 他にも同順位の候補あり':''):'区間を選んで確認してください。')+'</p>'+
                '<div class="etc-fields">'+field('移動区間',select('record',index,'legId',r.legId,choices))+field('提出先',select('record',index,'owner',r.owner,[['hold','あとで確認'],['hq','本部に提出'],['other','別の仕事']]))+'</div>'+
                '<details class="etc-caption"'+(r.owner==='hq'?' open':'')+'><summary>提出内容を確認・修正</summary><div class="etc-fields">'+field('本部への提出額（円）',input('record',index,'claimAmount',r.claimAmount,'number'))+field('訪問先',input('record',index,'visitCompany',r.visitCompany))+field('機種名',input('record',index,'machineName',r.machineName))+field('作業内容',input('record',index,'purpose',r.purpose))+field('メモ・共通区間の説明',input('record',index,'note',r.note))+'</div></details>'+
                '<div class="etc-toolbar">'+(top?'<button type="button" class="btn btn-secondary" data-etc-action="candidate" data-index="'+index+'">候補の区間を選ぶ</button>':'')+'<button type="button" class="btn btn-save" data-etc-action="confirm" data-index="'+index+'">確認して確定</button></div><details><summary>元の証明書を拡大</summary><img class="etc-proof-large" src="'+e(r.imageDataUrl)+'" alt="ETC証明書の全体"></details></article>';
        }).join(''):'<p class="empty-msg">この日のETC明細はありません。月まとめPDFを追加するか、明細のある日を選んでください。</p>';
    }
    function totals(state,day) {
        const total=EtcJourney.totals(state.records,day);
        document.getElementById('etcTotals').textContent='本部：'+total.accepted.length+'件 ¥'+total.amount.toLocaleString()+' ／ 別の仕事：'+total.other+'件 ／ 要確認：'+(day?total.pending:state.records.filter(r=>r.date===state.selectedDate).length)+'件';
        document.querySelectorAll('[data-record-index]').forEach(card=>{const r=state.records[Number(card.dataset.recordIndex)],valid=EtcJourney.validDecision(r,day),badge=card.querySelector('.etc-badge');badge.className='etc-badge '+(valid?r.owner:'pending');badge.textContent=valid?(r.owner==='hq'?'本部・確定':'別の仕事・確定'):'要確認';});
    }
    function routeLine(day) {
        const line=document.querySelector('#etcTrip .etc-route-line');
        if(line)line.textContent=day.stops.map(s=>s.name+(s.job==='other'?'〈別の仕事〉':'')).join(' → ');
    }
    return {mount,trip,legs,records,totals,options,routeLine};
})();
