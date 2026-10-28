// 下書きに付ける写真の選択と、読み込んだ時点の領収書の編集。
// 通常の駐車場明細を上書きせず、次の下書き保存で新しい版を残す。
const ExpenseDraftReceipts = (() => {
    let loaded=null;
    const clone=value=>JSON.parse(JSON.stringify(value));
    const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function capture() {
        const source=document.getElementById('draftReceiptSource')?.value || 'current';
        if(source==='none')return {pageSize:6,items:[]};
        if(source==='loaded') {
            if(!loaded)throw new Error('読み込んだ下書きの領収書がありません');
            return clone(loaded);
        }
        return {pageSize:Number(document.getElementById('parkingPageSize')?.value)===4?4:6,items:await ParkingManager.snapshotSelected()};
    }
    function load(bundle) {
        loaded=bundle ? clone(bundle) : null;
        const option=document.getElementById('draftReceiptLoadedOption');
        if(option)option.disabled=!loaded;
        const source=document.getElementById('draftReceiptSource');
        if(source)source.value=loaded?'loaded':'none';
        const section=document.getElementById('loadedDraftReceipts');
        if(section)section.hidden=!loaded;
        render();updateHint();
    }
    function reset() {
        load(null);
        const source=document.getElementById('draftReceiptSource');if(source)source.value='current';updateHint();
    }
    function updateHint() {
        const el=document.getElementById('draftReceiptHint');if(!el)return;
        const source=document.getElementById('draftReceiptSource')?.value || 'current';
        const count=source==='loaded' ? loaded?.items.length || 0 : source==='none' ? 0 : ParkingManager.getSelectedItems().length;
        el.textContent='精算書と領収書 '+count+'枚を一緒に保存します。'+(source==='current'?'駐車場欄の表示月・日付と「PDFに載せる」の選択が対象です。':'');
    }
    function render() {
        const container=document.getElementById('draftReceiptCards');if(!container)return;
        container.innerHTML='';
        if(!loaded)return;
        const count=document.getElementById('loadedDraftReceiptCount');if(count)count.textContent='領収書 '+loaded.items.length+'枚';
        const size=document.getElementById('draftReceiptPageSize');if(size)size.value=String(loaded.pageSize===4?4:6);
        loaded.items.forEach((item,index)=>{
            const card=document.createElement('article');card.className='draft-receipt-card';card.dataset.index=index;
            const field=(key,label,type='text')=>'<label>'+label+'<input data-draft-field="'+key+'" type="'+type+'" value="'+esc(item[key])+'"></label>';
            card.innerHTML='<img src="'+esc(item.imageDataUrl)+'" alt="下書きの領収書 '+(index+1)+'"><div class="receipt-edit-fields">'
                +field('date','利用日','date')+field('visitCompany','訪問先の会社名')+field('machineName','訪問先の機種名')+field('purpose','作業内容')+'</div>';
            container.appendChild(card);
        });
        if(!loaded.items.length)container.textContent='この下書きには領収書がありません。';
        const edit=event=>{
            const key=event.target.dataset.draftField,index=Number(event.target.closest('[data-index]')?.dataset.index);
            if(['date','visitCompany','machineName','purpose'].includes(key)&&loaded.items[index]) {
                loaded.items[index][key]=event.target.value;
                document.getElementById('draftReceiptEditStatus').textContent='変更はまだ下書きに保存されていません。「下書きを保存」を押してください。';
            }
        };
        container.oninput=edit;container.onchange=edit;
        document.getElementById('draftReceiptEditStatus').textContent='保存時の写真・説明です。修正したら「下書きを保存」で新しい下書きとして残せます。';
    }
    function setPageSize(value) { if(loaded)loaded.pageSize=Number(value)===4?4:6; }
    async function preview() { if(loaded)await ParkingPdf.generate(clone(loaded)); }
    return {capture,load,reset,updateHint,preview,setPageSize};
})();
