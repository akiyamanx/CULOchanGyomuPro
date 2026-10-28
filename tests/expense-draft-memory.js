// テストページ専用。ユーザーの下書きを書き換えないメモリ保存先。
const ExpenseDraftStore = (()=>{
    const records=new Map(),copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
    return {save:async draft=>{records.set(draft.id,copy(draft));},get:async id=>copy(records.get(id)),
        list:async()=>[...records.values()].map(d=>({id:d.id,date:d.date,destCompany:d.destCompany,receiptCount:d.parkingReceipts?.items.length||0,hasReceiptSnapshot:!!d.parkingReceipts})),remove:async id=>{records.delete(id);}};
})();
