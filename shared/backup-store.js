// A write-ahead recovery copy spans the existing stores; no success before all writes finish.
const BackupStore = (() => {
    const DB_NAME = (typeof AppProfile !== 'undefined' ? AppProfile.dbName('CULOchanTransfers') : 'CULOchanTransfers');
    const channel = (typeof AppProfile !== 'undefined' ? AppProfile.channel : 'gyomupro-main');
    const sessionName = 'culo-transfer-session-' + channel;
    let opening, releaseSession, sessionTask, running = false, initialized = false;
    function open() {
        if (!opening) opening = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore('recovery');
            request.onsuccess = () => { const db=request.result; db.onversionchange=()=>{db.close();opening=null;}; resolve(db); };
            request.onerror = () => { opening=null;reject(request.error); };
            request.onblocked = () => reject(new Error('このアプリを開いた別のタブを閉じてください。'));
        });
        return opening;
    }
    async function recovery(action) {
        const db = await open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('recovery', 'readwrite'); let request;
            tx.oncomplete = () => resolve(request?.result);
            tx.onerror = tx.onabort = () => reject(tx.error || new Error('復旧用データを保存できません。'));
            try { request = action(tx.objectStore('recovery')); } catch(error) { tx.abort();reject(error); }
        });
    }
    function keys() {
        const storage = AppStorage;
        return typeof storage.keys === 'function' ? storage.keys() : Array.from({ length:storage.length }, (_,i) => storage.key(i));
    }
    async function capture() {
        const local = {};
        for (const key of keys().filter(BackupFormat.allowedKey).sort()) {
            const value = AppStorage.getItem(key);
            if (value === null) continue;
            local[key] = key === 'mm_settings' ? JSON.stringify({homeAddress:JSON.parse(value).homeAddress || ''}) : value;
        }
        if (!local.mm_settings) local.mm_settings = JSON.stringify({homeAddress:''});
        const [parking,drafts,etc] = await Promise.all([ParkingIDB.getAll(),ExpenseDraftStore.exportAll(),EtcStore.read()]);
        return BackupFormat.create({local,parking,drafts,etc});
    }
    async function write(payload) {
        // Validate the whole snapshot before any store changes.
        BackupFormat.validate(payload);
        await ParkingIDB.replaceAll(payload.parking);
        await ExpenseDraftStore.replaceAll(payload.drafts);
        await EtcStore.save(payload.etc);
        for (const key of keys().filter(BackupFormat.allowedKey)) {
            if (key !== 'mm_settings' && !Object.hasOwn(payload.local, key)) AppStorage.removeItem(key);
        }
        const settings = JSON.parse(AppStorage.getItem('mm_settings') || '{}');
        settings.homeAddress = JSON.parse(payload.local.mm_settings || '{}').homeAddress || '';
        AppStorage.setItem('mm_settings', JSON.stringify(settings));
        for (const [key,value] of Object.entries(payload.local)) if (key !== 'mm_settings') AppStorage.setItem(key,value);
    }
    async function holdSession() {
        if (!navigator.locks) return;
        await new Promise((resolve,reject) => {
            sessionTask = navigator.locks.request(sessionName,{mode:'shared'},async()=>{
                await new Promise(release => { releaseSession=release;resolve(); });
            });
            sessionTask.catch(reject);
        });
    }
    async function exclusive(action) {
        if (running) throw new Error('ほかの保存・復元が終わるまでお待ちください。');
        if (!navigator.locks) throw new Error('このブラウザでは安全な復元を開始できません。最新版のChromeまたはEdgeで開いてください。');
        running=true;
        try {
            releaseSession?.(); await sessionTask; releaseSession=null;
            return await navigator.locks.request(sessionName,{mode:'exclusive',ifAvailable:true},lock=>{
                if (!lock) throw new Error('この端末でアプリを開いている別のタブを閉じてから、もう一度操作してください。');
                return action();
            });
        } finally { await holdSession();running=false; }
    }
    async function recover() {
        const journal = await recovery(store=>store.get('journal'));
        if (!journal) return false;
        await BackupFormat.verify(journal.before);
        await write(journal.before.payload);
        await recovery(store=>store.delete('journal'));
        return true;
    }
    async function start() {
        if (initialized) return;
        await holdSession();
        if (await recovery(store=>store.get('journal'))) await exclusive(recover);
        initialized=true;
    }
    async function restore(bundle) {
        await BackupFormat.verify(bundle);
        const before=await capture();
        // Persist both the rollback journal and a user-downloadable previous state atomically.
        await recovery(store=>{store.put(before,'previous');return store.put({before},'journal');});
        try {
            await write(bundle.payload);
            const written=await capture();
            // Missing optional map settings are normalized when restored.
            const expected={...bundle.payload,local:{...bundle.payload.local,mm_settings:JSON.stringify({homeAddress:JSON.parse(bundle.payload.local.mm_settings||'{}').homeAddress||''})}};
            if (written.sha256 !== await BackupFormat.hash(expected)) throw new Error('復元後の内容が一致しません。');
            await recovery(store=>store.delete('journal'));
        } catch (error) {
            try { await write(before.payload);await recovery(store=>store.delete('journal')); }
            catch (_) { throw new Error('復元を中断しました。復旧用データを保持しています。再読み込みして復旧するまで編集しないでください。'); }
            throw new Error('復元できなかったため、元の保存データに戻しました。' + error.message);
        }
    }
    // 端末間の自動同期(map/data-sync.js)の初回の前に取る控え。取り込み前の控え('previous')とは別に1つだけ持つ。
    async function keepBeforeSync(bundle) {await BackupFormat.verify(bundle);await recovery(store=>store.put(bundle,'before-sync'));}
    return {channel,start,exclusive,capture,restore,recover,previous:()=>recovery(store=>store.get('previous')),keepBeforeSync,beforeSync:()=>recovery(store=>store.get('before-sync'))};
})();
