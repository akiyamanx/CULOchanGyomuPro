// 精算書と領収書のスナップショットを1トランザクションで保存する。
// 一覧では画像を読まない。旧localStorage下書きは更新したものだけIndexedDBへ移す。
const ExpenseDraftStore = (() => {
    const DB_NAME = (typeof AppProfile !== 'undefined' ? AppProfile.dbName('CULOchanExpenseDrafts') : 'CULOchanExpenseDrafts');
    const LEGACY_KEY = 'travelExpenseDrafts';
    let opening;
    function open() {
        if (!opening) opening = new Promise((resolve,reject) => {
            const request = indexedDB.open(DB_NAME,1);
            request.onupgradeneeded = () => {
                const db = request.result;
                for (const name of ['drafts','summaries']) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'});
            };
            request.onsuccess = () => { const db=request.result; db.onversionchange=()=>{db.close();opening=null;}; db.onclose=()=>{opening=null;}; resolve(db); };
            request.onerror = () => { opening=null; reject(request.error || new Error('下書きの保存領域を開けません')); };
        });
        return opening;
    }
    function legacy() {
        const records=JSON.parse(AppStorage.getItem(LEGACY_KEY) || '[]');
        if (!Array.isArray(records)) throw new Error('以前の下書きを読み込めません');
        return records;
    }
    function summary(draft) {
        return {id:draft.id,date:draft.date,createdAt:draft.createdAt || Number(draft.id) || 0,
            updatedAt:draft.updatedAt || 0,
            destCompany:draft.destCompany || draft.destination || '',
            receiptCount:draft.parkingReceipts?.items?.length || 0,etcCount:draft.etcEvidence?.records?.length || 0,hasReceiptSnapshot:Boolean(draft.parkingReceipts)};
    }
    async function read(store,id) {
        const db=await open();
        return new Promise((resolve,reject) => {
            const tx=db.transaction(store,'readonly'),request=id === undefined ? tx.objectStore(store).getAll() : tx.objectStore(store).get(id);
            tx.oncomplete=()=>resolve(request.result);
            tx.onerror=tx.onabort=()=>reject(tx.error || new Error('下書きを読み込めません'));
        });
    }
    async function list() {
        const saved = await read('summaries'), ids = new Set(saved.map(d=>d.id));
        return [...saved,...legacy().filter(d=>!ids.has(d.id)).map(summary)]
            .sort((a,b)=>(b.updatedAt || b.createdAt)-(a.updatedAt || a.createdAt));
    }
    async function get(id) {
        return await read('drafts',id) || (typeof id === 'number' ? legacy().find(d=>d.id===id) : undefined);
    }
    async function write(action) {
        const db=await open();
        return new Promise((resolve,reject) => {
            const tx=db.transaction(['drafts','summaries'],'readwrite');
            let reason;
            const abort = error => { reason = error; tx.abort(); };
            tx.oncomplete=()=>resolve();
            tx.onerror=tx.onabort=()=>reject(reason || tx.error || new Error('下書きの保存を完了できません'));
            try { action(tx, abort); } catch(error) { abort(error); }
        });
    }
    function removeLegacy(id) {
        const rows = legacy(), other = rows.filter(d=>d.id!==id);
        if (other.length !== rows.length) AppStorage.setItem(LEGACY_KEY, JSON.stringify(other));
    }
    async function save(draft, previous) {
        await write((tx, abort)=>{
            const records = tx.objectStore('drafts');
            const put = () => { records.put(draft); tx.objectStore('summaries').put(summary(draft)); };
            if (!previous) { put(); return; }
            const request = records.get(draft.id);
            request.onsuccess = () => {
                try {
                    const current = request.result || (typeof draft.id === 'number' ? legacy().find(d=>d.id===draft.id) : null);
                    if (!current || (current.updatedAt || 0) !== previous.updatedAt) {
                        abort(new Error('この下書きは別の画面で更新または削除されました。最新の下書きを開くか、入力を別の下書きとして保存してください。'));
                        return;
                    }
                    put();
                } catch (error) { abort(error); }
            };
        });
        if (typeof draft.id === 'number') {
            // 写真も含めた更新が完了してから旧控えだけ外す。失敗しても一覧・読み込みは更新版を優先。
            try { removeLegacy(draft.id); } catch (_) { /* 旧控えは残す */ }
        }
    }
    async function remove(id, expected) {
        await write((tx, abort)=>{
            const records = tx.objectStore('drafts');
            const request = records.get(id);
            request.onsuccess = () => {
                try {
                    const current = request.result || (typeof id === 'number' ? legacy().find(d=>d.id===id) : null);
                    if (expected && (!current || (current.updatedAt || 0) !== (expected.updatedAt || 0))) {
                        abort(new Error('この下書きは別の画面で更新または削除されました。最新の内容を確認してから削除してください。'));
                        return;
                    }
                    // 旧控えの削除が失敗しても、IndexedDB側の下書きは残しておく。
                    if (typeof id === 'number') removeLegacy(id);
                    if (request.result) {
                        records.delete(id);
                        tx.objectStore('summaries').delete(id);
                    }
                } catch (error) { abort(error); }
            };
        });
    }
    async function replaceAll(drafts) {
        await write(tx => {
            tx.objectStore('drafts').clear(); tx.objectStore('summaries').clear();
            drafts.forEach(draft => { tx.objectStore('drafts').put(draft); tx.objectStore('summaries').put(summary(draft)); });
        });
    }
    return {list,get,save,remove,exportAll:()=>read('drafts'),replaceAll};
})();
