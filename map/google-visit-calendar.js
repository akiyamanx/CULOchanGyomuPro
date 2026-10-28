// Google authorization and the read-only appointment panel. Tokens/events stay in memory.
const GoogleVisitCalendar = (() => {
    const $=id=>document.getElementById(id), esc=value=>ExpenseImport.escapeHtml(String(value??''));
    const clientKey='culo_google_calendar_client_id';
    let clientId='', token='', expires=0, expiryTimer, sdkPromise, reader, notify=()=>{};
    let status='disconnected', message='', calendars=[], selected=new Set(), events=[], updated='';
    let range=[], sequence=0, authSequence=0, controller, selectingAccount=false;
    const validClient=value=>/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
    const connected=()=>!!token && Date.now()<expires;
    const snapshot=()=>({status,message,calendars:calendars.map(c=>({...c,checked:selected.has(c.id)})),events:[...events],updated,first:range[0],last:range[1],connected:connected()});
    function publish() { render();notify(snapshot()); }
    function cancelRead() {sequence++;controller?.abort();controller=null;}
    function clearSession(next='disconnected',detail='Googleカレンダーは未接続です。') {
        cancelRead();authSequence++;clearTimeout(expiryTimer);token='';expires=0;calendars=[];selected.clear();events=[];updated='';status=next;message=detail;selectingAccount=false;publish();
    }
    function loadSDK() {
        if(window.google?.accounts?.oauth2)return Promise.resolve();
        if(sdkPromise)return sdkPromise;
        sdkPromise=new Promise((resolve,reject)=>{
            const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
            const timer=setTimeout(()=>fail(),15000);
            function fail(){clearTimeout(timer);script.remove();sdkPromise=null;reject(Error('Google接続の準備ができません。通信を確認してもう一度押してください。'));}
            script.onload=()=>{clearTimeout(timer);if(window.google?.accounts?.oauth2)resolve();else fail();};script.onerror=fail;
            document.head.appendChild(script);
        });return sdkPromise;
    }
    function prepareSDK() {
        if(!clientId)return;
        loadSDK().then(()=>{if(!connected()&&status==='disconnected'){message='準備できました。「Googleカレンダーに接続」を押してください。';publish();}})
            .catch(error=>{if(!connected()){status='error';message=error.message;publish();}});
    }
    function connect() {
        if(connected()&&!confirm('Googleカレンダーのアカウントを変更しますか？現在の予定表示をいったん消し、Googleの画面で接続し直します。'))return;
        if(!clientId){$('googleCalendarSetup').open=true;$('googleCalendarClientId').focus();message='初回設定を開きました。連携用IDを設定してください。';publish();return;}
        // Popup authorization must run directly from a user gesture, not after an async load.
        if(!window.google?.accounts?.oauth2){message='Google接続を準備しています。準備できたらもう一度接続を押してください。';status='disconnected';publish();prepareSDK();return;}
        clearSession('authorizing','Googleの画面でアカウントと閲覧の許可を確認してください。');
        selectingAccount=true;publish();const attempt=authSequence;
        const oauth=window.google.accounts.oauth2;
        const fail=detail=>{if(attempt!==authSequence)return;clearSession('error',detail);};
        try {
            const client=oauth.initTokenClient({client_id:clientId,scope:GoogleCalendarData.scopes.join(' '),include_granted_scopes:false,
                callback:response=>{
                    if(attempt!==authSequence)return;
                    if(response?.error||!response?.access_token){fail('接続を完了できませんでした。必要な閲覧権限を確認して、もう一度接続してください。');return;}
                    if(!oauth.hasGrantedAllScopes(response,...GoogleCalendarData.scopes)) {fail('予定とカレンダー一覧の閲覧を両方許可すると表示できます。');return;}
                    const seconds=Number(response.expires_in);
                    if(!Number.isFinite(seconds)||seconds<=0){fail('接続期限を確認できませんでした。もう一度接続してください。');return;}
                    token=response.access_token;expires=Date.now()+seconds*1000;selectingAccount=false;
                    expiryTimer=setTimeout(()=>clearSession('expired','接続期限が切れました。Googleカレンダーに接続し直してください。'),Math.max(0,seconds*1000-5000));
                    refresh(true);
                },error_callback:error=>fail(error?.type==='popup_closed'?'Googleの接続画面が閉じられました。もう一度接続できます。':'Googleの接続画面を開けません。ChromeやEdgeで開き、ポップアップを許可してください。')});
            client.requestAccessToken({prompt:'select_account'});
        } catch(error) {fail('Googleとの接続を開始できません。初回設定と通信を確認してください。');}
    }
    async function refresh(reloadCalendars=false) {
        if(!connected()){if(token)clearSession('expired','接続期限が切れました。接続し直してください。');return;}
        cancelRead();const request=sequence;controller=new AbortController();const signal=controller.signal, access=token;
        status='loading';events=[];updated='';message='Googleの予定を読み込み中です…';publish();
        try {
            if(reloadCalendars||!calendars.length) {
                const list=await reader.calendars(access,signal);if(request!==sequence)return;
                const old=selected;calendars=list;
                selected=new Set(list.filter(c=>c.readable&&(old.size?old.has(c.id):c.selected||c.primary)).map(c=>c.id));
                if(!selected.size){const first=list.find(c=>c.readable);if(first)selected.add(first.id);}
                publish();
            }
            if(!range.length){status='idle';message='確認する月を選んでください。';publish();return;}
            const chosen=calendars.filter(c=>selected.has(c.id)&&c.readable);
            if(!chosen.length){status='unselected';message='連携設定の「表示するカレンダー」で確認するものを選んでください。';publish();return;}
            const result=await reader.events(chosen,range[0],range[1],access,signal);
            if(request!==sequence)return;
            if(!connected()){clearSession('expired','接続期限が切れました。接続し直してください。');return;}
            events=result;status='ready';updated=new Intl.DateTimeFormat('ja-JP',{timeZone:GoogleCalendarData.zone,hour:'2-digit',minute:'2-digit'}).format(new Date());
            message='Googleの予定を表示中 · '+updated+'取得 · 日本時間';publish();
        } catch(error) {
            if(request!==sequence||error.name==='AbortError')return;
            if(error.status===401){clearSession('expired',error.message);return;}
            status='error';events=[];message=error.message||'Googleの予定を読み込めませんでした。';publish();
        }
    }
    function setRange(first,last) {
        if(range[0]===first&&range[1]===last)return;
        range=[first,last];events=[];updated='';
        if(connected())refresh();else if(token)clearSession('expired','接続期限が切れました。接続し直してください。');
    }
    function render() {
        if(!$('googleCalendarStatus'))return;
        $('googleCalendarStatus').textContent=message||'Googleカレンダーは未接続です。';
        $('googleCalendarStatus').dataset.state=status;
        const settingsStatus=$('googleCalendarSettingsStatus');
        if(settingsStatus){settingsStatus.textContent=$('googleCalendarStatus').textContent;settingsStatus.dataset.state=status;}
        const settingsLink=$('googleCalendarSettings');
        if(settingsLink)settingsLink.textContent=connected()?'連携設定':'接続設定を開く';
        $('googleCalendarConnect').textContent=connected()?'アカウント変更':'Googleカレンダーに接続';
        $('googleCalendarConnect').disabled=selectingAccount||status==='authorizing';
        $('googleCalendarRefresh').hidden=!connected();$('googleCalendarRefresh').disabled=status==='loading';
        $('googleCalendarDisconnect').hidden=!connected()&&!selectingAccount;
        const list=$('googleCalendarChoices');
        const html=calendars.map((calendar,index)=>`<label><input type="checkbox" data-google-calendar="${index}" ${selected.has(calendar.id)?'checked':''} ${calendar.readable?'':'disabled'}><span>${esc(calendar.name)}${calendar.primary?'（メイン）':''}${calendar.readable?'':'（詳細の閲覧権限なし）'}</span></label>`).join('');
        if(list.innerHTML!==html){
            const focused=document.activeElement?.dataset?.googleCalendar;
            list.innerHTML=html;
            if(focused!==undefined)list.querySelector(`[data-google-calendar="${Number(focused)}"]`)?.focus({preventScroll:true});
        }
        $('googleCalendarSelection').hidden=!calendars.length;
        $('googleCalendarSelectionCount').textContent=`表示するカレンダー（${selected.size}/${calendars.length}）`;
    }
    function saveClient() {
        const value=$('googleCalendarClientId').value.trim();
        if(!validClient(value)){message='「数字-文字列.apps.googleusercontent.com」のOAuthクライアントIDを入力してください。APIキーやシークレットではありません。';status=connected()?status:'error';publish();$('googleCalendarClientId').focus();return;}
        if(value===clientId){message='この連携用IDは保存済みです。';publish();return;}
        if((connected()||selectingAccount)&&!confirm('連携用IDを変更すると、現在のGoogle接続が終了します。変更して保存しますか？'))return;
        try {AppStorage.setItem(clientKey,value);} catch(error){message='設定を保存できませんでした。ブラウザの保存容量・設定を確認してください。';publish();return;}
        clientId=value;clearSession('disconnected','連携用IDを保存しました。Googleとの接続を準備しています。');$('googleCalendarSetup').open=false;prepareSDK();
    }
    function disconnect() {
        if(!confirm('Googleカレンダーの接続を解除しますか？予定を再表示するには接続し直す必要があります。Googleの予定自体は削除されません。'))return;
        const access=token;clearSession('disconnected','この画面のGoogle接続を解除しました。');
        const attempt=authSequence;
        if(access)try {window.google.accounts.oauth2.revoke(access,response=>{
            if(attempt===authSequence&&!response?.successful && !connected()){message='この画面の接続は解除しました。Google側の許可は「Googleアカウントの接続管理」で確認してください。';publish();}
        });}catch(error){message='この画面の接続は解除しました。Google側の許可は接続管理で確認してください。';publish();}
    }
    function init(onChange) {
        notify=onChange;reader=GoogleCalendarData.createReader((...args)=>fetch(...args));
        try{const value=AppStorage.getItem(clientKey)||'';clientId=validClient(value)?value:'';}catch(error){clientId='';}
        $('googleCalendarClientId').value=clientId;
        $('googleCalendarConnect').addEventListener('click',connect);
        $('googleCalendarRefresh').addEventListener('click',()=>refresh());
        $('googleCalendarDisconnect').addEventListener('click',disconnect);
        $('googleCalendarSaveClient').addEventListener('click',saveClient);
        $('googleCalendarChoices').addEventListener('change',event=>{
            const index=event.target.dataset.googleCalendar;if(index===undefined)return;
            const calendar=calendars[Number(index)];if(!calendar?.readable)return;
            if(event.target.checked)selected.add(calendar.id);else selected.delete(calendar.id);refresh();
        });
        window.addEventListener('pagehide',()=>clearSession());
        publish();prepareSDK();
    }
    return {init,setRange,snapshot,refresh,validClient};
})();
