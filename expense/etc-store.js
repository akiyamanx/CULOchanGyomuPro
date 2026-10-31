const EtcStore = (() => {
    const DB_NAME=(typeof AppProfile!=='undefined'?AppProfile.dbName('CULOchanEtcEvidence'):'CULOchanEtcEvidence');let connection;
    function open() {
        if(connection)return Promise.resolve(connection);
        return new Promise((resolve,reject)=>{
            const request=indexedDB.open(DB_NAME,1);
            request.onupgradeneeded=()=>request.result.createObjectStore('state');
            request.onerror=()=>reject(request.error);
            request.onblocked=()=>reject(new Error('別のタブを閉じて開き直してください。'));
            request.onsuccess=()=>{connection=request.result;connection.onversionchange=()=>{connection.close();connection=null;};resolve(connection);};
        });
    }
    async function read() {
        const db=await open();return new Promise((resolve,reject)=>{
            const tx=db.transaction('state','readonly'),req=tx.objectStore('state').get('current');
            tx.oncomplete=()=>resolve(req.result||{records:[],days:{},selectedDate:''});
            tx.onerror=tx.onabort=()=>reject(tx.error||new Error('ETC保存データを読み込めません。'));
        });
    }
    async function save(value) {
        const db=await open();return new Promise((resolve,reject)=>{
            const tx=db.transaction('state','readwrite');
            tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error('ETC明細を保存できません。'));
            tx.objectStore('state').put(value,'current');
        });
    }
    return {read,save};
})();
