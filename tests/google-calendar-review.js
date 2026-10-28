// Synthetic browser fixture only; does not authorize, fetch Google data, or save browser data.
const reviewStorage=new Map([['culo_google_calendar_client_id','123-review.apps.googleusercontent.com']]);
const AppStorage={getItem:key=>reviewStorage.get(key)||null,setItem:(key,value)=>reviewStorage.set(key,value)};
const reviewVisit={id:'review-visit',company:'A社（架空）',address:'東京都架空区1',phone:'000-0000-0000',purpose:'メンテナンス',note:'DP-400。電話で訪問時刻を相談。',appoDate:'2026-10-19T10:30',status:'pending'};
const DataStorage={getWorkspaces:()=>[{id:'2026-10'}],getCurrentWorkspaceId:()=> '2026-10',getCustomersForWorkspace:()=>[reviewVisit]};
const MapCore={getCurrentEditId:()=>reviewVisit.id};
const mode=()=>document.getElementById('reviewResponse').value;
window.google={accounts:{oauth2:{
    initTokenClient(options){return{requestAccessToken(){setTimeout(()=>options.callback(mode()==='denied'?{error:'access_denied'}:{access_token:'synthetic-only',expires_in:3600}),30);}};},
    hasGrantedAllScopes:()=>true,revoke:(token,done)=>done({successful:true})
}}};
window.fetch=async function(url) {
    if(!url.startsWith('https://www.googleapis.com/calendar/v3/'))throw Error('Fixture blocks other requests');
    await new Promise(resolve=>setTimeout(resolve,50));
    if(mode()==='error')return{ok:false,status:503};
    if(mode()==='expired')return{ok:false,status:401};
    if(url.includes('/calendarList?'))return{ok:true,json:async()=>({items:[
        {id:'work',summary:'仕事用（架空）',primary:true,accessRole:'owner',selected:true},
        {id:'personal',summary:'個人用（架空）',accessRole:'owner',selected:true}
    ]})};
    const event=(id,title,start,end,location)=>({id,summary:title,location,start:{dateTime:'2026-10-19T'+start+':00+09:00'},end:{dateTime:'2026-10-19T'+end+':00+09:00'}});
    const items=url.includes('/work/events?')?[
        event('work-1','B社 · メンテナンス（架空）','09:00','10:00','千葉県浦安市・テスト住所'),
        event('work-2','C社 · 修理（架空）','14:00','15:30','東京都江東区・テスト住所')
    ]:[event('personal-1','別の仕事 · 打ち合わせ（架空）','11:00','12:00','東京都中央区・テスト住所'),
        {id:'all-day',summary:'終日メモ（架空・時間は空き）',start:{date:'2026-10-19'},end:{date:'2026-10-20'},transparency:'transparent'}];
    const query=new URL(url).searchParams,min=Date.parse(query.get('timeMin')),max=Date.parse(query.get('timeMax'));
    return{ok:true,json:async()=>({items:items.filter(e=>Date.parse(e.start.dateTime||e.start.date+'T00:00:00+09:00')<max&&Date.parse(e.end.dateTime||e.end.date+'T00:00:00+09:00')>min)})};
};
function restoreEditButtons() {}
function hideEditModal(){if(VisitPlanner.allowClose())document.getElementById('visitEditError').textContent='確認用ページのため編集画面を表示したままにします。';}
function deleteLocation(){document.getElementById('visitEditError').textContent='確認用ページでは削除しません。';}
function saveEdit(){if(VisitPlanner.validate()){reviewVisit.appoDate=document.getElementById('editAppoDate').value;reviewVisit.note=document.getElementById('editNote').value;VisitPlanner.saved();document.getElementById('visitEditError').textContent='架空の予定をこのページ内だけに保存しました。';}}
function openReviewVisit(){
    const fields={editCompany:reviewVisit.company,editAddress:reviewVisit.address,editPhone:reviewVisit.phone,editNote:reviewVisit.note,editPurpose:reviewVisit.purpose};
    for(const [id,value] of Object.entries(fields))document.getElementById(id).value=value;
    document.getElementById('editRoute').innerHTML='<option>ルート1</option>';VisitPlanner.begin(reviewVisit);
}

// Production settings controller; the fixture skips AppCore initialization / service workers.
const AppCore={openSettings:category=>SettingsPanel.open(category),closeSettings:event=>SettingsPanel.close(event),saveSettings:category=>SettingsPanel.save(category)};
function exportBackup(){alert('確認用ページのためダウンロードはしません。');}
