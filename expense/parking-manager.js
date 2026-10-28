// 駐車場明細。保存完了後に画面へ反映し、写真・編集元・訪問情報を一緒に保持する。
const ParkingManager = (() => {
    let items = [], queue = Promise.resolve(), ready = false, pickerId = '', pickerChoices = [], pickerVersion = 0;
    let editTimer, saveError = false;
    const pendingEdits=new Map();
    const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const uid = () => 'park_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    function serial(action) {
        const result = queue.then(action);
        queue = result.catch(() => {});
        return result;
    }
    async function save(next) {
        try {
            if (!ready || !await ParkingIDB.putAll(next)) throw new Error('保存未完了');
            items = next;
            saveError = false;
            return true;
        } catch (error) {
            saveError = true;
            alert('駐車場明細を保存できませんでした。空き容量やブラウザの保存設定を確認してください。');
            return false;
        }
    }
    async function init() {
        try {
            const migration = await ParkingIDB.migrateFromLocalStorage();
            if (migration.conflicts) alert('旧保存と内容の異なる駐車場明細があります。両方の原データを保持しています。');
            items = await ParkingIDB.getAll();
            ready = true;
        } catch (error) { alert('駐車場明細を読み込めません。再読み込みしてから操作してください。'); }
        const list = document.getElementById('parkingItemList');
        if (list) {
            const captureEdit=event=>{
                const field=event.target.dataset.field;
                if(!field)return;
                const id=event.target.closest('[data-id]').dataset.id;
                const value=event.target.type==='checkbox'?event.target.checked:event.target.value;
                const previous=pendingEdits.get(id)?.[field] ?? getItemById(id)?.[field] ?? '';
                if(String(previous)===String(value))return;
                pendingEdits.set(id,{...pendingEdits.get(id),...fieldPatch(field,value)});
                clearTimeout(editTimer);
                editTimer=setTimeout(flushEdits,300);
            };
            list.addEventListener('input',captureEdit);
            list.addEventListener('change',event=>{captureEdit(event);flushEdits();});
            list.addEventListener('focusout',event=>{if(event.target.dataset.field){captureEdit(event);flushEdits();}});
            list.addEventListener('click', event => {
                const button = event.target.closest('button[data-action]');
                if (!button) return;
                flushEdits();
                const id = button.closest('[data-id]').dataset.id;
                ({visit:showCustomerPicker,edit:id=>ReceiptPhoto.open(id),read:readReceipt,remove:removeItem})[button.dataset.action]?.(id);
            });
        }
        renderParkingList();
    }
    function blank() { return {id:uid(), date:'', visitCompany:'', machineName:'', purpose:'', amount:0,
        imageDataUrl:'', rotation:0, pdfSelected:true, createdAt:new Date().toISOString()}; }
    async function append(records) {
        return serial(async () => {
            const added = [];
            records.forEach(record => {
                if (items.concat(added).some(i => (record.sourceHash && i.sourceHash === record.sourceHash)
                    || (record.imageDataUrl && (i.originalImageDataUrl || i.imageDataUrl) === (record.originalImageDataUrl || record.imageDataUrl)))) return;
                added.push({...blank(), ...record});
            });
            if (!added.length) return 0;
            if (!await save(items.concat(added))) return -1;
            renderParkingList();
            return added.length;
        });
    }
    async function importFromScanner() {
        const receipts = ReceiptScanner.getRecognizedReceipts?.() || [];
        const selected = receipts.filter(r=>r.checked && r.data?.type === 'parking');
        if (!selected.length) { alert('レシートの種類を「駐車場」にして、取り込む写真にチェックしてください。'); return; }
        if (ReceiptScanner.validateSelection && !ReceiptScanner.validateSelection(selected)) return;
        const count = await append(selected.map(r=>({imageDataUrl:r.imageDataUrl, originalImageDataUrl:r.imageDataUrl,
            ...ocrPatch(r.data)})));
        if (count >= 0) alert(count ? count + '件の駐車場レシートを取り込みました。訪問先を確認してください。' : '同じ写真は取り込み済みです。変更がある場合は駐車場明細で修正してください。');
        return count;
    }
    function ocrPatch(data) {
        return {date:/^\d{4}-\d{2}-\d{2}$/.test(data.date || '') ? data.date : '', amount:Math.max(0,Number(data.total)||0),
            ocrStore:data.store || '', ocrAddress:data.address || '', ocrEnterTime:data.enterTime || '', ocrRead:true};
    }
    async function readReceipt(id) {
        const item = getItemById(id);
        if (!item?.imageDataUrl) return;
        if (!ReceiptScanner.hasApiKey()) { alert('AI読取を使う場合は、設定でGemini APIキーを登録してください。日付・金額は手入力でも保存できます。'); return; }
        AppCore.showLoading('領収書の日付・金額を読み取り中…');
        try {
            const data = await ReceiptScanner.readParkingImage(item.imageDataUrl);
            if (data.type !== 'parking') { alert('駐車場の領収書か確認してください。読取結果は反映せず、写真を保持しています。'); return; }
            const patch = ocrPatch(data);
            // 入力済み情報の再読取は、確認してから反映する。
            if ((item.date || item.amount) && !confirm('読取結果に変更しますか？\n日付: ' + (patch.date || '不明') + '\n金額: ¥' + patch.amount.toLocaleString())) return;
            if (await patchItem(id, patch)) renderParkingList();
        } catch (error) { alert('読み取れませんでした。写真は保存されています。日付・金額を入力できます。\n' + error.message); }
        finally { AppCore.hideLoading(); }
    }
    async function addItem() { await append([{date:new Date().toLocaleDateString('sv-SE')}]); }
    function patchItem(id, patch) {
        return serial(async () => {
            if (!items.some(i=>i.id === id)) return false;
            return save(items.map(i=>i.id === id ? {...i,...patch} : i));
        });
    }
    function fieldPatch(field,value) {
        const allowed=['date','amount','visitCompany','machineName','purpose','pdfSelected','pdfScale'];
        if(!allowed.includes(field))return {};
        if(field==='amount')value=Math.max(0,parseInt(value)||0);
        if(field==='pdfScale')value=Math.min(100,Math.max(50,Number(value)||100));
        const patch={[field]:value};
        if(field==='date'||field==='visitCompany')Object.assign(patch,{customerId:'',visitConfirmed:false});
        return patch;
    }
    function flushEdits() {
        clearTimeout(editTimer);
        if(!pendingEdits.size)return queue;
        const edits=new Map(pendingEdits);pendingEdits.clear();
        return serial(async()=>{
            if(!await save(items.map(i=>edits.has(i.id)?{...i,...edits.get(i.id)}:i)))renderParkingList();
            updateSummary();
        });
    }
    async function updateField(id,field,value) {
        flushEdits();
        if(!await patchItem(id,fieldPatch(field,value)))renderParkingList();
        updateSummary();
    }
    async function removeItem(id) {
        if (!confirm('この駐車場明細と写真を削除しますか？')) return;
        await serial(async()=>{
            try { if (!await ParkingIDB.remove(id)) throw new Error(); items = items.filter(i=>i.id!==id); }
            catch (error) { alert('駐車場明細を削除できませんでした。明細は保持しています。'); }
            renderParkingList();
        });
    }
    async function clearAll() {
        if (!confirm('すべての月の駐車場明細と写真を削除しますか？')) return;
        await serial(async()=>{
            try { if (!await ParkingIDB.clearAll()) throw new Error(); items=[]; }
            catch (error) { alert('駐車場明細を削除できませんでした。明細は保持しています。'); }
            renderParkingList();
        });
    }
    function filters() { return {month:document.getElementById('parkingFilterMonth')?.value || '', day:document.getElementById('parkingFilterDay')?.value || ''}; }
    function visibleItems() {
        const {month,day} = filters();
        return items.filter(i=>(!month || !i.date || i.date.startsWith(month)) && (!day || !i.date || i.date===day));
    }
    function field(item, name, label, type = 'text', placeholder = '') {
        return '<label>' + label + '<input class="parking-input" data-field="' + name + '" type="' + type + '" value="' + esc(item[name]) + '" placeholder="' + esc(placeholder) + '"' + (type==='number'?' min="0" step="1"':'') + '></label>';
    }
    function renderParkingList() {
        const list = document.getElementById('parkingItemList');
        if (!list) return;
        list.innerHTML = visibleItems().map((item,index)=>'<article class="parking-record" data-id="' + esc(item.id) + '">' +
            '<div class="parking-photo-col">' + (item.imageDataUrl ? '<label class="parking-pdf-check"><input type="checkbox" data-field="pdfSelected" ' + (item.pdfSelected!==false?'checked':'') + '> PDFに載せる</label><button class="parking-photo-button" data-action="edit" aria-label="写真' + (index+1) + 'を調整"><img alt="領収書' + (index+1) + '" src="' + esc(item.imageDataUrl) + '" style="transform:rotate(' + (Number(item.rotation)||0) + 'deg)"></button><button class="btn btn-secondary" data-action="edit">写真を調整</button>' : '<p>写真なし・精算用の手入力</p>') + '</div>' +
            '<div class="parking-record-fields"><div class="parking-field-grid">' + field(item,'date','利用日','date') + field(item,'amount','駐車場代（円）','number') + '</div>' +
            '<button class="btn btn-secondary" data-action="visit">その日の訪問先から選ぶ</button>' +
            '<div class="parking-field-grid">' + field(item,'visitCompany','訪問先の会社名','text','○○株式会社') + field(item,'machineName','訪問先の機種名','text','DP400') + '</div>' +
            '<label>作業内容<input class="parking-input" data-field="purpose" list="parkingPurposes" value="' + esc(item.purpose) + '" placeholder="メンテナンス・修理・本体設置"></label>' +
            '<p class="parking-caption">' + (item.customerId?'訪問情報を反映済み。領収書と内容を確認してください。':'日付・会社名・機種名・作業内容を確認してからPDFにします。') + '</p>' +
            (item.ocrStore?'<p class="parking-caption">駐車場：' + esc(item.ocrStore) + '</p>':'') +
            '<div class="parking-actions">' + (item.imageDataUrl?'<button class="btn btn-secondary" data-action="read">日付・金額をAI読取</button>':'') + '<button class="btn btn-danger-quiet" data-action="remove">この明細を削除</button></div></div></article>').join('') || '<p class="empty-msg">領収書の写真を追加してください。日付不明の写真もここで確認できます。</p>';
        updateSummary();
    }
    function updateSummary() {
        const total = document.getElementById('parkingTotal');
        if (total) total.textContent = '¥' + visibleItems().reduce((s,i)=>s+(Number(i.amount)||0),0).toLocaleString();
        if (typeof ExpenseDraftReceipts !== 'undefined') ExpenseDraftReceipts.updateHint();
        const counter = document.getElementById('parkingPdfCount');
        if (counter) counter.textContent = getSelectedItems().length + '枚をPDFに出力';
    }
    function getSelectedItems() {
        // 日付不明を黙って除外せず、PDFの入力チェックへ渡す。
        return visibleItems().filter(i=>i.imageDataUrl && i.pdfSelected!==false)
            .sort((a,b)=>(a.date||'').localeCompare(b.date||'') || (a.createdAt||a.id).localeCompare(b.createdAt||b.id));
    }
    function selectVisible(checked) {
        return serial(async()=>{
            const ids = new Set(visibleItems().map(i=>i.id));
            if (await save(items.map(i=>ids.has(i.id)?{...i,pdfSelected:checked}:i))) renderParkingList();
        });
    }
    async function showCustomerPicker(id) {
        await flushEdits();
        pickerId = id;
        let dialog = document.getElementById('parkingVisitDialog');
        if (!dialog) {
            dialog = document.createElement('dialog'); dialog.id='parkingVisitDialog'; dialog.className='parking-dialog';
            dialog.innerHTML='<h2>訪問先を選ぶ</h2><p id="parkingVisitDate"></p><label><input id="parkingOtherDays" type="checkbox"> この月の他の日・日付未定の訪問先も表示</label><p id="parkingVisitHint" class="parking-caption" role="status"></p><div id="parkingVisitChoices"></div><button class="btn btn-secondary" id="parkingVisitClose">閉じる</button>';
            document.body.appendChild(dialog);
            dialog.querySelector('#parkingOtherDays').onchange=renderChoices;
            dialog.querySelector('#parkingVisitClose').onclick=()=>dialog.close();
            dialog.querySelector('#parkingVisitChoices').onclick=async event=>{
                const button=event.target.closest('[data-choice]');
                if (!button) return;
                const choice=pickerChoices[Number(button.dataset.choice)];
                if (await patchItem(pickerId,ParkingDocument.visitPatch(choice.customer,choice.workspaceId))) {dialog.close();renderParkingList();}
            };
        }
        dialog.querySelector('#parkingOtherDays').checked=false;
        renderChoices(); dialog.showModal();
    }
    function renderChoices() {
        const version=++pickerVersion;
        const item=getItemById(pickerId);
        const workspaceId=item.date?.slice(0,7) || DataStorage.getCurrentWorkspaceId();
        const includeOther=document.getElementById('parkingOtherDays').checked;
        document.getElementById('parkingVisitDate').textContent=item.date ? item.date + ' の訪問先（必要な会社だけ選択）' : '先に領収書の利用日を入力すると、その日の訪問先を表示できます。';
        try {
            const customers=workspaceId ? DataStorage.getCustomersForWorkspace(workspaceId) : DataStorage.getCustomers();
            pickerChoices=ParkingDocument.candidates(customers,item.date,includeOther).map(customer=>({customer,workspaceId}));
            paintChoices();
            if (!includeOther && pickerChoices.length && typeof ParkingMatcher !== 'undefined' && (item.ocrAddress || item.ocrStore)) rankChoices(item,version);
        } catch (error) { document.getElementById('parkingVisitChoices').textContent='訪問先を読み込めませんでした。明細への手入力もできます。'; }
    }
    function paintChoices() {
            document.getElementById('parkingVisitHint').textContent='訪問先を選ぶと、会社名・機種名・作業内容を反映します。';
            document.getElementById('parkingVisitChoices').innerHTML=pickerChoices.map(({customer:c},i)=>'<button class="parking-visit-choice" data-choice="'+i+'"><strong>'+esc(c.company)+'</strong><span>'+esc([c.appoDate?.replace('T',' '), c.equipType,c.purpose].filter(Boolean).join(' ／ '))+'</span><small>'+esc(c.address)+'</small></button>').join('') || '<p>候補がありません。利用日や訪問予定を確認するか、この月の他の訪問先を表示してください。会社名などを直接入力することもできます。</p>';
    }
    async function rankChoices(item,version) {
        try {
            const scores=await ParkingMatcher.findCandidates({date:item.date,address:item.ocrAddress,store:item.ocrStore,enterTime:item.ocrEnterTime},pickerChoices.map(c=>c.customer));
            if(version!==pickerVersion || !document.getElementById('parkingVisitDialog').open || !scores.length)return;
            const rank=new Map(scores.filter(s=>s.score>=.3).map((s,i)=>[s.customer.id,i]));
            if(!rank.size)return;
            pickerChoices.sort((a,b)=>(rank.get(a.customer.id)??99)-(rank.get(b.customer.id)??99));paintChoices();
            document.getElementById('parkingVisitHint').textContent='住所・入庫時刻から近い候補を上に並べました。確定ではありません。会社名と作業内容を確認して選んでください。';
        } catch(error) { /* 候補検索が使えなくても同日の訪問先を選べる。 */ }
    }
    async function snapshotSelected() {
        const saved = await flushEdits();
        if (!ready || saved === false) throw new Error('駐車場明細の保存を確認できません。入力内容を確認してから下書きを保存してください。');
        return JSON.parse(JSON.stringify(getSelectedItems()));
    }
    function getItemById(id) { const item=items.find(i=>i.id===id); return item ? {...item} : null; }
    function getItems() { return items.map(i=>({...i})); }
    return {init,importFromScanner,addItem,append,patchItem,readReceipt,removeItem,clearAll,renderParkingList,updateField,
        showCustomerPicker,getItemById,getItems,getSelectedItems,selectVisible,snapshotSelected,settled:async()=>{await flushEdits();if(saveError || !ready)throw new Error('駐車場明細を保存できていません。保存状態を確認してください。');}};
})();
