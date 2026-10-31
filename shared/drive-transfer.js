// Drive tokens stay in memory; each send creates a new, immutable app-private file.
const DriveTransfer = (() => {
    const scope='https://www.googleapis.com/auth/drive.appdata', api='https://www.googleapis.com/drive/v3/';
    let token='', expiry=0, account=null, clientId='', generation=0, preparing;
    const requests=new Set();
    const configured=()=>AppStorage.getItem('culo_google_calendar_client_id')||'';
    function disconnect() { generation++;token='';expiry=0;account=null;requests.forEach(c=>c.abort());requests.clear(); }
    function state() {
        if (token && (Date.now()>=expiry || clientId!==configured())) disconnect();
        return {connected:Boolean(token && account),email:account?.emailAddress||''};
    }
    function prepare() {
        if (window.google?.accounts?.oauth2) return Promise.resolve();
        if (!preparing) preparing=new Promise((resolve,reject)=>{
            const script=document.createElement('script');script.src='https://accounts.google.com/gsi/client';script.async=true;
            const timer=setTimeout(()=>{preparing=null;reject(new Error('Googleへの接続準備ができません。通信状態を確認してください。'));},15000);
            script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);preparing=null;reject(new Error('Googleの接続画面を読み込めません。'));};
            document.head.appendChild(script);
        });
        return preparing;
    }
    // Errors carry an additive machine-readable .code (messages are unchanged) so callers such as the mail ledger can show a precise status.
    const coded=(message,code)=>Object.assign(new Error(message),{code});
    async function request(url, options={}, consume=async response=>response) {
        if (!token || Date.now()>=expiry || clientId!==configured()) {disconnect();throw coded('共有先への接続が切れました。もう一度接続してください。','not_connected');}
        const own=generation, controller=new AbortController();requests.add(controller);
        let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},60000);
        try {
            const response=await fetch(url,{...options,signal:controller.signal,cache:'no-store',credentials:'omit',headers:{...options.headers,Authorization:'Bearer '+token}});
            if (own!==generation) throw coded('接続が変更されたため操作を中止しました。','aborted');
            if (response.status===401) {disconnect();throw coded('Googleの許可が切れました。もう一度接続してください。','auth_expired');}
            if (!response.ok) throw coded(response.status===403 ? 'Google Driveを利用できません。Drive APIの有効化、追加のアクセス許可、保存容量を確認してください。' : '共有先との通信に失敗しました（'+response.status+'）。端末の保存データは変更していません。',response.status===403?'forbidden':'http_error');
            const result=await consume(response);
            if (own!==generation || clientId!==configured()) throw coded('接続が変更されたため操作を中止しました。','aborted');
            return result;
        } catch(error) {
            if(error.name==='AbortError') throw coded('通信が中断しました。接続を確認して共有先を再確認してください。',timedOut?'timeout':'aborted');
            throw error;
        } finally {clearTimeout(timer);requests.delete(controller);}
    }
    // Narrow door for the mail ledger (map/mail-ledger-drive.js): only Drive v3 files calls on googleapis.com, GET/POST/PATCH only.
    // It reuses the same in-memory token, 60s timeout and error mapping; it never reads or exposes the token.
    const appdataUrl=/^https:\/\/www\.googleapis\.com\/(upload\/)?drive\/v3\/files(\/[\w-]+)?(\?[^#\s]*)?$/;
    function appdataRequest(url, options={}, consume) {
        const method=String(options.method||'GET').toUpperCase();
        if (typeof url!=='string' || !appdataUrl.test(url) || ['GET','POST','PATCH'].indexOf(method)<0) return Promise.reject(coded('許可されていない通信先です。','bad_url'));
        return request(url,options,consume);
    }
    function connect() {
        const id=configured();
        if (!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(id)) return Promise.reject(new Error('先に「Googleカレンダー」の初回設定で、この端末にも同じOAuthクライアントIDを保存してください。'));
        if (!window.google?.accounts?.oauth2) {prepare().catch(()=>{});return Promise.reject(new Error('接続を準備しています。少し待ってからもう一度押してください。'));}
        disconnect();clientId=id;const own=generation;
        return new Promise((resolve,reject)=>{
            let finished=false;
            const end=(error)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(state());};
            const timer=setTimeout(()=>{if(own===generation)disconnect();end(new Error('接続を完了できませんでした。もう一度お試しください。'));},60000);
            const client=google.accounts.oauth2.initTokenClient({client_id:id,scope,include_granted_scopes:false,
                callback:async response=>{
                    if(finished)return;
                    if(own!==generation)return end(new Error('接続操作を中止しました。'));
                    if(response.error || !response.access_token)return end(new Error('共有の許可が完了していません。データは送っていません。'));
                    if(!google.accounts.oauth2.hasGrantedAllScopes(response,scope))return end(new Error('アプリ専用領域へのアクセスを許可してください。'));
                    token=response.access_token;expiry=Date.now()+Math.max(0,Number(response.expires_in||0)-60)*1000;
                    try {
                        const about=await request(api+'about?fields=user(permissionId,emailAddress)',{},response=>response.json());
                        if(own!==generation)throw new Error('接続操作を中止しました。');
                        if(!about.user?.permissionId || !about.user?.emailAddress)throw new Error('Googleアカウントを確認できません。');
                        account=about.user;end();
                    } catch(error) {if(own===generation)disconnect();end(error);}
                },error_callback:()=>end(new Error('接続画面を閉じました。必要なときに再接続してください。'))});
            try {client.requestAccessToken({prompt:'select_account'});} catch(error) {end(error);}
        });
    }
    const baseKey=()=> 'culo_drive_base:'+BackupStore.channel+':'+clientId+':'+account.permissionId;
    function baseline() {try{const value=JSON.parse(AppStorage.getItem(baseKey())||'[]');return Array.isArray(value)?value:[];}catch(_){return [];}}
    function acknowledge(revision) {if(!state().connected)throw new Error('接続を確認してください。');AppStorage.setItem(baseKey(),JSON.stringify([revision]));}
    async function list() {
        if(!state().connected)throw new Error('共有先に接続してください。');
        const files=[];let pageToken='';const tokens=new Set();
        do {
            const query=new URLSearchParams({spaces:'appDataFolder',pageSize:'100',q:"trashed = false and appProperties has { key='app' and value='CULOchanTransfer1' } and appProperties has { key='channel' and value='"+BackupStore.channel+"' }",fields:'files(id,name,size,appProperties),nextPageToken,incompleteSearch'});
            if(pageToken)query.set('pageToken',pageToken);
            const data=await request(api+'files?'+query,{},response=>response.json());
            if(data.incompleteSearch || !Array.isArray(data.files))throw new Error('共有先の全履歴を取得できません。もう一度確認してください。');
            files.push(...data.files);pageToken=data.nextPageToken||'';
            if(files.length>1000 || (pageToken && tokens.has(pageToken)))throw new Error('共有履歴が多すぎるか、一覧を最後まで取得できません。');
            tokens.add(pageToken);
        }while(pageToken);
        return {files,heads:DriveGraph.heads(files)};
    }
    async function send(bundle, expected, override=false) {
        await BackupFormat.verify(bundle);
        const before=await list();
        if(!DriveGraph.equal(DriveGraph.versions(before.heads),expected))throw new Error('確認中に共有先が更新されました。もう一度内容を確認してください。');
        DriveGraph.assertSend(before.heads,baseline(),override);
        const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'});
        if(blob.size>BackupFormat.limit)throw new Error('共有ファイルは64MBまでです。');
        const revision=crypto.randomUUID(), properties={app:'CULOchanTransfer1',channel:BackupStore.channel,revision,sha256:bundle.sha256,savedAt:bundle.createdAt};
        DriveGraph.versions(before.heads).forEach((parent,i)=>properties['parent'+i]=parent);
        const response=await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',{
            method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(blob.size)},
            body:JSON.stringify({name:'CULOchan-'+revision+'.json',mimeType:'application/json',parents:['appDataFolder'],appProperties:properties})});
        const location=response.headers.get('Location');
        const url=new URL(location||'',api);
        if(!location || url.origin!=='https://www.googleapis.com' || url.pathname!=='/upload/drive/v3/files')throw new Error('Googleの送信先を確認できません。');
        let sent=false;
        try {await request(url.href,{method:'PUT',headers:{'Content-Type':'application/json'},body:blob});sent=true;}
        catch(error) {
            // A lost response may still have created the file; never blindly repeat an upload.
            const check=await list().catch(()=>null);
            if(!check?.files.some(f=>f.appProperties.revision===revision && f.appProperties.sha256===bundle.sha256))throw error;
            sent=true;
        }
        const after=await list();
        if(!after.files.some(f=>f.appProperties.revision===revision))throw new Error('送信後の履歴を確認できません。再送せず「共有先を再確認」を押してください。');
        if(sent)acknowledge(revision);
        return after;
    }
    async function receive(file) {
        if(!file || !/^[\w-]+$/.test(file.id))throw new Error('取り込む版を選んでください。');
        if(!Number.isFinite(Number(file.size)) || Number(file.size)>BackupFormat.limit)throw new Error('共有ファイルの容量を確認できないか、64MBを超えています。');
        return request(api+'files/'+file.id+'?alt=media',{},async response=>{
            const reader=response.body.getReader(),chunks=[];let size=0;
            try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>BackupFormat.limit)throw new Error('共有ファイルは64MBまでです。');chunks.push(value);}}
            finally {await reader.cancel();}
            const bundle=await BackupFormat.parse(await new Blob(chunks).text());
            if(bundle.sha256!==file.appProperties.sha256)throw new Error('共有先のファイルと履歴が一致しません。');
            return bundle;
        });
    }
    window.addEventListener('pagehide',disconnect);
    return {prepare,connect,disconnect,state,list,send,receive,acknowledge,appdataRequest};
})();
