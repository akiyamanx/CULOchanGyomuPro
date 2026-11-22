// 下書きに付ける写真の選択と、読み込んだ時点の領収書の編集。
// 通常の駐車場明細を上書きせず、編集中の精算書の下書きに反映する。
const ExpenseDraftReceipts = (() => {
    let loaded=null, renderedReview=null;
    const clone=value=>JSON.parse(JSON.stringify(value));
    const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const decisions=new Map();
    const getSource=()=>document.getElementById('draftReceiptSource')?.value || 'current';
    const relevantDates=()=>[...new Set(ExpenseManager.getRowsData().map(row=>row.date).filter(Boolean))].sort();
    function reviewItems(items,source,dates) {
        return items.map((item,index)=>{
            const date=ExpenseImport.normalizeDate(item.date);
            const key=JSON.stringify([item.id ?? index,date,item.amount ?? null,dates]);
            const mismatch=!date || !dates.includes(date);
            const choice=mismatch
                ? (decisions.get(source+key) || (source==='loaded' && loaded?.approvedMismatches?.includes(key) ? 'include' : ''))
                : 'include';
            return {item,date,key,choice,mismatch};
        });
    }
    async function capture() {
        const source=getSource();
        if(source==='none')return {pageSize:6,items:[]};
        if(source==='loaded' && !loaded)throw new Error('読み込んだ下書きの領収書がありません');
        const bundle=source==='loaded' ? clone(loaded)
            : {pageSize:Number(document.getElementById('parkingPageSize')?.value)===4?4:6,items:await ParkingManager.snapshotSelected()};
        if(source!==getSource())throw new Error('領収書の選択元が変わりました。内容を確認してから保存し直してください。');
        if(!bundle.items.length)return {pageSize:bundle.pageSize,items:[]};
        const checked=reviewItems(bundle.items,source,relevantDates());
        if(checked.some(row=>!row.choice)) {
            updateHint(bundle.items);
            const first=document.getElementById('draftReceiptReview')?.querySelector('[data-receipt-review]:invalid');
            first?.focus();
            throw new Error('日付が合わない領収書は、付けるか外すか選んでください。');
        }
        return {pageSize:bundle.pageSize,items:checked.filter(row=>row.choice==='include').map(row=>row.item),
            approvedMismatches:checked.filter(row=>row.mismatch && row.choice==='include').map(row=>row.key)};
    }
    function load(bundle) {
        decisions.clear();
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
    function updateHint(snapshot) {
        const hint=document.getElementById('draftReceiptHint'), panel=document.getElementById('draftReceiptReview');
        if(!hint && !panel)return;
        const source=getSource();
        const items=snapshot || (source==='loaded' ? loaded?.items || [] : source==='none' ? [] : ParkingManager.getSelectedItems());
        if(!panel) {
            if(hint)hint.textContent='精算書と領収書 '+items.length+'枚を一緒に保存します。';
            return;
        }
        const dates=items.length ? relevantDates() : [];
        const checked=reviewItems(items,source,dates);
        const pending=checked.filter(row=>!row.choice).length;
        const count=checked.filter(row=>row.choice==='include').length;
        if(hint)hint.textContent='下書きに付ける領収書 '+count+'枚。'+(pending?' 未確認 '+pending+'枚。付けるか外すか選んでください。':'');
        panel.hidden=!checked.length;
        const html=checked.length ? '<ul class="draft-review-list">'+checked.map(({item,date,mismatch,choice},index)=>{
            const amount=item.amount==null || item.amount==='' || !Number.isFinite(Number(item.amount))
                ? '金額不明' : Number(item.amount).toLocaleString('ja-JP')+'円';
            const position='領収書 '+(index+1)+'：'+(date || '日付不明')+' ／ '+amount;
            if(!mismatch)return '<li><span>'+esc(position)+'</span><small>精算日と一致</small></li>';
            const option=(value,label)=>'<option value="'+value+'"'+(choice===value?' selected':'')+'>'+label+'</option>';
            return '<li class="draft-review-warning"><label><span>'+esc(position)+'</span><small>'
                +(date ? 'この日付は精算書の明細にありません' : '領収書の利用日を確認してください')
                +'</small><select required data-receipt-review="'+index+'">'
                +option('','選んでください')+option('include','この下書きに付ける')+option('exclude','この下書きから外す')
                +'</select></label></li>';
        }).join('')+'</ul>' : '';
        if(renderedReview!==html) {
            panel.innerHTML=html;
            renderedReview=html;
        }
        panel.onchange=event=>{
            if(event.target.dataset.receiptReview===undefined)return;
            const index=Number(event.target.dataset.receiptReview), row=checked[index], choice=event.target.value;
            if(!row?.mismatch || !['','include','exclude'].includes(choice))return;
            if(choice)decisions.set(source+row.key,choice);
            else decisions.delete(source+row.key);
            updateHint();
            panel.querySelector('[data-receipt-review="'+index+'"]')?.focus();
        };
    }
    function refreshCaption(card,before,item) {
        if (!card) return;
        for (const field of ['machineName','purpose']) {
            if (before && before[field] !== item[field]) card.querySelector('[data-draft-field="'+field+'"]').value = item[field] || '';
        }
        card.querySelector('[data-draft-caption-status]').textContent = item.visitCaptionReview ? '利用日または会社名が変わりました。機種名・作業内容を見直してください。' : '';
        const button=card.querySelector('[data-draft-review]');
        button.hidden=!item.visitCaptionReview;
        button.disabled=!ParkingDocument.captionReady(item);
    }
    function edited() { document.getElementById('draftReceiptEditStatus').textContent='変更はまだ下書きに保存されていません。「この下書きを更新」または「別の下書きとして保存」を押してください。'; }
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
                +field('date','利用日','date')+field('visitCompany','訪問先の会社名')+field('machineName','訪問先の機種名')+field('purpose','作業内容')
                +'<p data-draft-caption-status aria-live="polite"></p><button type="button" class="btn btn-secondary" data-draft-review>この内容で確認済みにする</button></div>';
            refreshCaption(card,null,item);
            container.appendChild(card);
        });
        if(!loaded.items.length)container.textContent='この下書きには領収書がありません。';
        const edit=event=>{
            const key=event.target.dataset.draftField,index=Number(event.target.closest('[data-index]')?.dataset.index);
            if(['date','visitCompany','machineName','purpose'].includes(key)&&loaded.items[index]) {
                const previous=loaded.items[index];
                if (String(previous[key] ?? '') === String(event.target.value)) return;
                const next=loaded.items[index]=ParkingDocument.applyEdit(previous,{[key]:event.target.value});
                refreshCaption(event.target.closest('[data-index]'),previous,next);
                edited();
                updateHint();
            }
        };
        container.oninput=edit;container.onchange=edit;
        container.onclick=event=>{
            const button=event.target.closest('[data-draft-review]');
            if (!button) return;
            const card=button.closest('[data-index]'), index=Number(card.dataset.index), previous=loaded?.items[index];
            if (!previous?.visitCaptionReview || !ParkingDocument.captionReady(previous)) return;
            const next=loaded.items[index]=ParkingDocument.applyEdit(previous,{visitCaptionReview:false});
            refreshCaption(card,previous,next);
            edited();
        };
        document.getElementById('draftReceiptEditStatus').textContent='保存時の写真・説明です。修正したら「この下書きを更新」で保存できます。';
    }
    function setPageSize(value) { if(loaded)loaded.pageSize=Number(value)===4?4:6; }
    async function preview() { if(loaded)await ParkingPdf.generate(clone(loaded)); }
    return {capture,load,reset,updateHint,preview,setPageSize};
})();
