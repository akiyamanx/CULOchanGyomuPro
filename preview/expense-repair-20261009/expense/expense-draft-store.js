// 精算書と領収書のスナップショットを1トランザクションで保存する。
// 一覧には画像を読み込まない。旧localStorage下書きは元のまま読める。
const ExpenseDraftStore = (() => {
    const DB_NAME = 'CULOchanExpenseDrafts_Preview_Expense_20261009';
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
        const records=JSON.parse(PreviewStorage.getItem(LEGACY_KEY) || '[]');
        if (!Array.isArray(records)) throw new Error('以前の下書きを読み込めません');
        return records;
    }
    function summary(draft) {
        return {id:draft.id,date:draft.date,createdAt:draft.createdAt || Number(draft.id) || 0,
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
        return [...await read('summaries'),...legacy().map(summary)].sort((a,b)=>b.createdAt-a.createdAt);
    }
    async function get(id) {
        return typeof id === 'number' ? legacy().find(d=>d.id===id) : read('drafts',id);
    }
    async function write(action) {
        const db=await open();
        return new Promise((resolve,reject) => {
            const tx=db.transaction(['drafts','summaries'],'readwrite');
            tx.oncomplete=()=>resolve();
            tx.onerror=tx.onabort=()=>reject(tx.error || new Error('下書きの保存を完了できません'));
            try { action(tx); } catch(error) { tx.abort(); reject(error); }
        });
    }
    async function save(draft) {
        await write(tx=>{tx.objectStore('drafts').put(draft);tx.objectStore('summaries').put(summary(draft));});
    }
    async function remove(id) {
        if (typeof id === 'number') { PreviewStorage.setItem(LEGACY_KEY,JSON.stringify(legacy().filter(d=>d.id!==id))); return; }
        await write(tx=>{tx.objectStore('drafts').delete(id);tx.objectStore('summaries').delete(id);});
    }
    async function replaceAll(drafts) {
        await write(tx => {
            tx.objectStore('drafts').clear(); tx.objectStore('summaries').clear();
            drafts.forEach(draft => { tx.objectStore('drafts').put(draft); tx.objectStore('summaries').put(summary(draft)); });
        });
    }
    return {list,get,save,remove,exportAll:()=>read('drafts'),replaceAll};
})();
