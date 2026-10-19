const TransferUI = (() => {
    const $=id=>document.getElementById(id);
    let busy=false, remote={heads:[]}, reloadRequired=false;
    function message(text) { $('transferStatus').textContent=text; }
    function render() {
        const state=DriveTransfer.state();
        $('driveAccount').textContent=state.connected ? '接続中：'+state.email : '共有先は未接続です。';
        $('driveDisconnect').hidden=!state.connected;
        $('driveControls').hidden=!state.connected;
        const select=$('driveRevision');select.replaceChildren();
        for(const file of remote.heads) {
            const option=document.createElement('option');option.value=file.id;
            option.textContent=new Date(file.appProperties.savedAt).toLocaleString('ja-JP')+' · '+file.appProperties.revision.slice(0,8);select.appendChild(option);
        }
        $('driveRemoteStatus').textContent=!state.connected ? '' : !remote.heads.length ? '共有先にはまだ保存されていません。' : remote.heads.length>1 ? '別々の端末から更新された版が'+remote.heads.length+'個あります。選んだ版を取り込んで内容を確認してください。' : '共有先の保存版を1件確認しました。';
        $('driveReceive').disabled=!remote.heads.length || !SettingsPanel.canTransfer();
        $('driveRevision').hidden=!remote.heads.length;
    }
    async function flush() {
        document.activeElement?.blur();
        await ParkingManager.settled();await EtcWorkflow.settled();
    }
    async function run(label,action,local=true) {
        if(busy || !SettingsPanel.canTransfer())return;
        if(getComputedStyle($('loading')).display!=='none' || ExpenseManager.isBusy()) {message('処理中の作業が終わってから操作してください。');return;}
        busy=true;$('transferBusyText').textContent=label;$('transferBusy').showModal();
        try {
            if(local) await BackupStore.exclusive(async()=>{await flush();await action();});
            else await action();
        } catch(error) {message(error.message || '操作を完了できませんでした。');}
        finally {
            busy=false;$('transferBusy').close();render();
            if(reloadRequired) {
                // No old in-memory editor may write after a restore attempt.
                alert($('transferStatus').textContent+'\n保存データを読み直すため、画面を再読み込みします。');location.reload();
            }
        }
    }
    function download(bundle,name) {
        const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'});
        if(blob.size>BackupFormat.limit)throw new Error('写真入りバックアップは64MBまでです。');
        const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    function describe(bundle) {return new Date(bundle.createdAt).toLocaleString('ja-JP')+'\n'+BackupFormat.summary(bundle);}
    async function restore(bundle,revision) {
        if(!confirm(describe(bundle)+'\n\nこの内容で、この端末の保存済み記録をすべて置き換えます。未保存の入力は再読み込みで失われます。続けますか？')) {message('取り込みを取り消しました。');return;}
        reloadRequired=true;
        await BackupStore.restore(bundle);
        if(revision) {
            try {DriveTransfer.acknowledge(revision);} catch(_) {message('取り込みは完了しました。共有先への送信前には再接続して版を確認してください。');return;}
        }
        message('写真を含む保存データを取り込みました。');
    }
    function init() {
        $('transferBusy').addEventListener('cancel',event=>event.preventDefault());
        $('fullBackupSave').onclick=()=>run('写真入りバックアップを準備しています…',async()=>{
            const bundle=await BackupStore.capture();download(bundle,'CULOchan-backup-'+bundle.createdAt.slice(0,10)+'.json');
            message('バックアップの保存を開始しました。ダウンロード先でファイルを確認してください。\n'+BackupFormat.summary(bundle));
        });
        $('fullBackupRestore').onclick=()=>{if(SettingsPanel.canTransfer()){$('fullBackupInput').value='';$('fullBackupInput').click();}};
        $('fullBackupInput').onchange=event=>{
            const file=event.target.files[0];if(!file)return;
            run('バックアップを確認しています…',async()=>{
                if(file.size>BackupFormat.limit)throw new Error('ファイルは64MBまでです。');
                await restore(await BackupFormat.parse(await file.text()));
            });
        };
        $('fullBackupPrevious').onclick=()=>run('取り込み前の記録を確認しています…',async()=>{
            const bundle=await BackupStore.previous();if(!bundle)throw new Error('この端末には、取り込み前に退避した記録がまだありません。');
            await BackupFormat.verify(bundle);download(bundle,'CULOchan-before-restore.json');message('直前の取り込み前の記録を保存しました。戻す場合は「ファイルから取り込む」で選んでください。');
        });
        $('driveConnect').onclick=()=>run('Googleの接続画面で許可してください…',async()=>{
            await DriveTransfer.connect();remote=await DriveTransfer.list();message('共有先を確認しました。接続だけでは記録は送信しません。');
        },false);
        $('driveDisconnect').onclick=()=>{
            if(busy || !confirm('この画面の共有接続を終了しますか？共有先の記録は残ります。'))return;
            DriveTransfer.disconnect();remote={heads:[]};render();message('この画面の共有接続を終了しました。');
        };
        $('driveRefresh').onclick=()=>run('共有先を確認しています…',async()=>{remote=await DriveTransfer.list();message('共有先を確認しました。');},false);
        const send=override=>run('共有する内容を確認しています…',async()=>{
            const bundle=await BackupStore.capture();remote=await DriveTransfer.list();
            if(!confirm(describe(bundle)+'\n\n'+(override?'この端末の内容を共有先の新しい版として優先します。別端末の変更は統合されません。':'この端末に保存済みの記録を、接続中のGoogleアカウントの専用領域へ送ります。')+'\n送信しますか？'))return;
            remote=await DriveTransfer.send(bundle,DriveGraph.versions(remote.heads),override);
            message(remote.heads.length>1?'送信しましたが、別端末から同時に更新されています。取り込む版を確認してください。':'共有先へ保存しました。別の端末で「共有先を再確認」→「選んだ版を取り込む」を押してください。');
        });
        $('driveSend').onclick=()=>send(false);$('driveForceSend').onclick=()=>send(true);
        $('driveReceive').onclick=()=>run('共有先の記録を読み込んでいます…',async()=>{
            const id=$('driveRevision').value;remote=await DriveTransfer.list();
            const file=remote.heads.find(f=>f.id===id);if(!file)throw new Error('共有先が更新されました。版を選び直してください。');
            const bundle=await DriveTransfer.receive(file);await restore(bundle,file.appProperties.revision);
        });
        render();
    }
    function opened() {render();if(PreviewStorage.getItem('culo_google_calendar_client_id'))DriveTransfer.prepare().catch(error=>message(error.message));}
    return {init,opened,isBusy:()=>busy};
})();
