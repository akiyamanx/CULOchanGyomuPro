// Review -> append. Existing visits, routes and appointment state are never replaced.
const RequestImport = (() => {
    let candidates = [], controller = null, generation = 0, busy = false;
    const esc = value => ExpenseImport.escapeHtml(value);
    const panel = () => document.getElementById('requestImportPanel');
    const status = value => { document.getElementById('requestImportStatus').textContent = value; };
    const targetMonth = () => document.getElementById('requestImportMonth').value;
    const existing = () => DataStorage.getCustomersForWorkspace(targetMonth());

    function setBusy(value) {
        busy = value;
        document.getElementById('requestImportSave').disabled = value;
        document.getElementById('fileInput').disabled = value;
        document.getElementById('requestImportMonth').disabled = value;
    }
    async function handleFile(event) {
        const files = Array.from(event.target.files || []);
        event.target.value = '';
        if (!files.length || busy) return;
        if (candidates.length && !confirm('確認中の取込候補を閉じ、新しいファイルを読み込みますか？登録済みデータは残ります。')) return;
        if (files.length > 20) { alert('一度に選べるファイルは20個までです。'); return; }
        const token = ++generation;
        candidates = [];
        controller = new AbortController();
        const signal = controller.signal;
        panel().hidden = false;
        document.getElementById('requestImportMonth').value = DataStorage.getCurrentWorkspaceId() || new Date().toLocaleDateString('sv-SE').slice(0,7);
        document.getElementById('requestImportResults').replaceChildren();
        document.getElementById('requestImportErrors').textContent = '';
        panel().scrollIntoView({block:'start'});
        document.getElementById('requestImportTitle').focus();
        setBusy(true);
        const errors = [];
        try {
            for (let i=0; i<files.length; i++) {
                if (signal.aborted) return;
                const progress = message => { if (token === generation) status(`${i+1}/${files.length}ファイル · ${message}`); };
                progress(`${files[i].name} を読み込み中…`);
                try {
                    const items = await RequestReader.read(files[i], progress, signal);
                    if (signal.aborted) return;
                    candidates.push(...items.map(item => ({...item,selected:true,
                        sourceKey:JSON.stringify([item.source,item.company,item.address,item.purpose,item.equipType,item.managementNo,item.appoDate])
                    })));
                } catch (error) { if (!signal.aborted) errors.push(`${files[i].name}: ${error.message}`); }
            }
            if (token !== generation) return;
            document.getElementById('requestImportErrors').textContent = errors.join('\n');
            reviewDuplicates();
        } catch (error) {
            if (token === generation) status('登録先の保存済みデータを確認できませんでした。バックアップを確認してください。');
        } finally { if (token === generation) { setBusy(false); controller = null; } }
    }
    function reviewDuplicates() {
        let known;
        try { known = existing(); }
        catch (error) { status('登録先の保存済みデータを読み込めません。月またはバックアップを確認してください。'); return; }
        candidates.forEach(item => {
            item.possibleDuplicate = known.some(other => RequestParser.duplicate(item,other));
            item.selected = !item.possibleDuplicate;
            known.push(item);
        });
        render();
    }
    function input(item, index, key, label, type='text') {
        return `<label class="request-field">${label}<input type="${type}" data-index="${index}" data-field="${key}" value="${esc(item[key] || '')}" ${['company','address'].includes(key) ? 'required' : ''}></label>`;
    }
    function render() {
        document.getElementById('requestImportResults').innerHTML = candidates.map((item,index) =>
            `<article class="request-card"><label class="request-select"><input type="checkbox" data-index="${index}" data-field="selected" ${item.selected?'checked':''}>${index+1}. ${esc(item.company || '会社名を確認してください')}</label>
            <p class="request-source">${esc(item.kind)} · ${esc(item.source)}</p>
            ${item.possibleDuplicate?'<p class="request-warning">登録済み、または今回の候補と重複の可能性があります。追加したい別作業の場合だけチェックしてください。</p>':''}
            ${(item.warnings || []).map(w=>`<p class="request-warning">${esc(w)}</p>`).join('')}
            <div class="request-grid">${input(item,index,'company','会社名 *')}${input(item,index,'address','住所 *')}
            <label class="request-field">作業内容<select data-index="${index}" data-field="purpose">${['','メンテナンス','修理','本体設置','その他'].map(p=>`<option value="${p}" ${item.purpose===p?'selected':''}>${p||'未設定'}</option>`).join('')}</select></label>
            ${input(item,index,'appoDate','訪問予定日時（希望日も含む）','datetime-local')}</div>
            <details><summary>電話・機種・備考などを確認</summary><div class="request-grid">
            ${input(item,index,'phone','電話番号','tel')}${input(item,index,'contact','担当者')}${input(item,index,'equipType','機種')}${input(item,index,'unitCount','台数','number')}${input(item,index,'managementNo','管理番号・シリアル')}${input(item,index,'branch','営業所・SS')}${input(item,index,'filter','交換フィルター')}
            <label class="request-field request-wide">備考<textarea data-index="${index}" data-field="note" rows="4">${esc(item.note)}</textarea></label></div></details>
            ${item.previewUrl?`<details><summary>PDF原本・読取文字を確認</summary><img class="request-original" src="${item.previewUrl}" alt="依頼書の原本 ${index+1}"><pre>${esc(item.originalText)}</pre></details>`:''}</article>`
        ).join('');
        status(`${candidates.length}件を読み取りました。登録先の月と内容を確認してください。`);
        updateCount();
    }
    function updateCount() {
        const count = candidates.filter(item=>item.selected).length;
        document.getElementById('requestImportSave').textContent = `選択した${count}件を追加登録`;
    }
    function edit(event) {
        const {index,field} = event.target.dataset;
        if (!field || !candidates[index]) return;
        candidates[index][field] = field === 'selected' ? event.target.checked : event.target.value;
        updateCount();
    }
    function cancel() {
        generation++;
        if (controller) controller.abort();
        controller = null; candidates = [];
        setBusy(false);
        panel().hidden = true;
        document.getElementById('requestImportResults').replaceChildren();
    }
    async function save() {
        if (busy) return;
        const month = targetMonth();
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { status('登録先の月を選択してください。'); return; }
        const selected = candidates.filter(item=>item.selected);
        if (!selected.length) { status('登録する訪問先にチェックしてください。'); return; }
        for (const item of selected) {
            if (!item.company.trim() || !item.address.trim()) { status('選択した訪問先の会社名と住所を入力してください。'); return; }
            if (!Number.isInteger(Number(item.unitCount)) || Number(item.unitCount) < 1) { status('台数は1以上の整数で入力してください。'); return; }
        }
        setBusy(true);
        let saved = false;
        try {
            const known = existing();
            const added = selected.map((item,index) => {
                const {selected,possibleDuplicate,warnings,previewUrl,originalText,kind,workDateText,titleText,...customer} = item;
                return {...customer,unitCount:Number(item.unitCount),id:'c_'+crypto.randomUUID(),routeId:null,status:'pending',createdAt:new Date().toISOString()};
            });
            if (!DataStorage.getWorkspaces().some(ws=>ws.id===month)) DataStorage.createWorkspace(month);
            // One write: storage failure cannot leave a partially registered batch.
            DataStorage.saveCustomersForWorkspace(month,[...known,...added]);
            saved = true;
            DataStorage.switchWorkspace(month);
            if (typeof updateWsButton === 'function') updateWsButton();
            candidates = [];
            document.getElementById('requestImportResults').replaceChildren();
            status(`${month}に${added.length}件を追加登録しました。既存の訪問先・ルートは保持しています。`);
            document.getElementById('requestImportErrors').textContent = '';
            updateCount();
            MapCore.refreshAllMarkers();
            RouteManager.updateRoutePanel();
            // New records are plotted only after their IDs and data have been saved.
            await MapCore.geocodeAndPlot(added);
        } catch (error) {
            status(saved ? '追加登録は完了しました。地図・一覧の表示更新ができなかったため、画面を再読み込みしてください。' : '追加登録できませんでした。内容を残しています。保存容量や登録先の月を確認してください。');
        } finally { setBusy(false); }
    }
    function init() {
        document.getElementById('requestImportResults').addEventListener('input',edit);
        document.getElementById('requestImportMonth').addEventListener('change',reviewDuplicates);
        document.getElementById('requestImportSave').addEventListener('click',save);
        document.getElementById('requestImportCancel').addEventListener('click',cancel);
    }
    return {init,handleFile};
})();
