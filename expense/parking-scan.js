// コピー機PDFをブラウザ内でページ表示し、確認した枠だけ駐車場明細に渡す。
const ParkingScan = (() => {
    const BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/';
    const el = id => document.getElementById(id);
    let library, task, doc, from, opener, page = 1, angle = 0, image, cards = [], busy = false, editor;
    function pageScale(width,height) {
        if (![width,height].every(n=>Number.isFinite(n)&&n>0)) throw new Error('PDFページの大きさを確認できません。');
        return Math.min(300/72,3600/Math.max(width,height));
    }
    const layouts = ['3,2','2,3','2,2','4,1','2,1','1,2','1,1'];
    function validGeometry(r) {
        const q = r.scanQuad;
        return layouts.includes(r.scanLayout) && [0,90,180,270].includes(r.scanAngle) && Array.isArray(q) && q.length === 4
            && q.every(p=>p && [p.x,p.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))
            && q.every((p,i)=>{const v=q[(i+1)%4], n=q[(i+2)%4]; return (v.x-p.x)*(n.y-v.y)-(v.y-p.y)*(n.x-v.x)>0.00001;});
    }
    function records(hash,index,crops,geometry) {
        if (!/^[a-f0-9]{64}$/.test(hash)||!Number.isSafeInteger(index)||index<1||!Array.isArray(crops)||!crops.length||crops.length>6) throw new Error('追加する領収書を選んでください。');
        const sourcePageKey = hash+':'+index, seenImages=new Set(), seenSlots=new Set();
        return crops.map(({image,slot,quad})=>{
            if(!Number.isInteger(slot)||slot<0||slot>5||seenSlots.has(slot)||!/^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i.test(image)||seenImages.has(image)){
                throw new Error('同じ画像か無効な枠が含まれています。切り出し枠を確認してください。');
            }
            seenSlots.add(slot);seenImages.add(image);
            const record = {imageDataUrl:image,originalImageDataUrl:image,sourceHash:'pdfscan:'+sourcePageKey+':'+slot,sourcePageKey,pdfSelected:false};
            if (geometry) {
                Object.assign(record,{scanLayout:geometry.layout,scanAngle:geometry.angle,scanQuad:quad});
                if(!validGeometry(record)||slot>=geometry.layout.split(',').reduce((a,n)=>a*Number(n),1))throw new Error('切り出し位置を確認してください。');
            }
            return record;
        });
    }
    function say(msg) {el('parkingScanStatus').textContent=msg;}
    function feedback(msg, state='') {
        const node=el('parkingScanFeedback');node.dataset.state=state;node.textContent=msg;
    }
    async function act(fn,adding=false) {
        if(busy)return;
        busy=true;syncControls();
        try {await fn();}catch(e){
            const msg=e.message||'PDFを取り込めませんでした。';
            if(adding)feedback('追加できませんでした。'+msg,'error');else say(msg);
        }
        finally{busy=false;syncControls();}
    }
    function syncControls() {
        ['parkingScanPrev','parkingScanNext','parkingScanRotate','parkingScanLayout','parkingScanSave','parkingScanClose'].forEach(id=>{
            const control=el(id);if(control)control.disabled=busy;
        });
        if(!busy){
            el('parkingScanPrev').disabled=!doc||page<=1;el('parkingScanNext').disabled=!doc||page>=doc.numPages;
            el('parkingScanSave').disabled=!image||!cards.some(c=>!c.tick.disabled&&c.tick.checked);
            el('parkingScanLayout').disabled=!image||savedRecords().length>0;
            el('parkingScanRotate').disabled=!doc||savedRecords().length>0;
        }
    }
    function savedRecords(index=page) {return from ? ParkingManager.getItems().filter(i=>i.sourcePageKey===from.hash+':'+index) : [];}
    function legacy(saved) {return saved.some(r=>!validGeometry(r));}
    function isSaved(saved,slot) {return saved.some(r=>r.sourceHash==='pdfscan:'+r.sourcePageKey+':'+slot);}
    function markSaved(saved) {
        const old = legacy(saved);
        for(const c of cards){
            const used=isSaved(saved,c.slot);
            c.tick.disabled=c.adjust.disabled=old||used;
            if(c.tick.disabled)c.tick.checked=false;
            c.label.textContent=used?' 取り込み済み':old?' 旧版で取り込み済みのページ':' '+(c.slot+1)+'枚目を追加';
        }
    }
    function dropCanvas() {if(image){image.width=image.height=1;image=null;}cards=[];el('parkingScanCards').replaceChildren();el('parkingScanSource').replaceChildren();}
    async function dispose() {dropCanvas();const old=task;task=doc=from=null;if(old)await old.destroy().catch(()=>{});}
    async function renderPage(next,rotation) {
        feedback('');say('PDFページを読み込み中…');
        const saved=savedRecords(next), layout=el('parkingScanLayout');
        if(saved.length&&!legacy(saved)){
            layout.value=layout.dataset.previous=saved[0].scanLayout;
            rotation=saved[0].scanAngle;
        }
        rotation=((rotation%360)+360)%360;
        const p=await doc.getPage(next),rot=((p.rotate+rotation)%360+360)%360;
        const base=p.getViewport({scale:1,rotation:rot});
        const viewport=p.getViewport({scale:pageScale(base.width,base.height),rotation:rot});
        const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        try {await p.render({canvasContext:canvas.getContext('2d'),viewport,annotationMode:0}).promise;}
        catch(e){canvas.width=canvas.height=1;throw e;}
        finally {p.cleanup();}
        dropCanvas();image=canvas;page=next;angle=rotation;
        el('parkingScanPage').textContent=page+' / '+doc.numPages+' ページ';
        const thumb=document.createElement('canvas'),s=Math.min(1,900/Math.max(canvas.width,canvas.height));
        thumb.width=Math.max(1,Math.round(canvas.width*s));thumb.height=Math.max(1,Math.round(canvas.height*s));
        thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);el('parkingScanSource').append(thumb);
        draw();
    }
    function make(tag,value) {const n=document.createElement(tag);if(value!=null)n.textContent=value;return n;}
    function cropImage(quad,turn,limit){
        const crop=ReceiptCrop.image(image,quad,limit);
        if(!turn)return crop;
        try{return ReceiptCrop.turnImage(crop,turn);}
        finally{crop.width=crop.height=1;}
    }
    function draw() {
        const [columns,rows]=el('parkingScanLayout').value.split(',').map(Number);
        const result=GyomuScanner.detectImage(image,{columns,rows});
        const host=el('parkingScanCards');host.replaceChildren();
        cards=result.boxes.map((box,i)=>{
            const card=make('section'), tag=make('label'), tick=make('input'), label=make('span');tick.type='checkbox';
            tick.onchange=syncControls;
            tag.append(tick,label);
            const info=make('p',box.method==='detected'?'用紙の縁を検出。欠けがないか確認。':'均等分割の枠です。空欄は選ばない。');
            info.className='parking-caption';
            const preview=make('div'), adjust=make('button','指でトリミング');
            adjust.type='button';adjust.className='btn';
            adjust.setAttribute('aria-label',(i+1)+'枚目を指でトリミング');
            const initial=ReceiptCrop.fromBox(GyomuScanner.sanitizeBox(box));
            let quad=initial, turn=0;
            const redraw=()=>preview.replaceChildren(cropImage(quad,turn,550));
            adjust.onclick=()=>editor.open({source:image,initial,quad,turn,allowRotation:true,invoker:adjust,label:(i+1)+'枚目',
                onApply:(next,steps)=>{quad=next;turn=steps;redraw();}});
            card.append(tag,info,preview,adjust);host.append(card);redraw();
            return {tick,label,adjust,slot:i,current:()=>quad,turn:()=>turn,edited:()=>quad!==initial||turn!==0};
        });
        const saved=savedRecords();
        markSaved(saved);
        say(legacy(saved)?'旧版で追加したページは、枠の位置を記録していないため追加できません。残りは写真で追加できます。'
            :saved.length?'取り込み済みの枠は選べません。このページの残りは選んで追加できます。'
            :'領収書が全部入っている枠だけ選んでください。注記入りの提出済みPDFではなく、スキャンした元のPDFを使ってください。');
    }
    function confirmDiscard(){return !cards.some(c=>!c.tick.disabled&&(c.tick.checked||c.edited()))||confirm('このページの未追加の選択・枠調整を破棄しますか？');}
    function setup() {
        const d=el('parkingScanDialog');
        editor=ReceiptCropEditor.setup(el('cropEditor'));
        d.addEventListener('cancel',e=>{
            if(editor.isOpen()){e.preventDefault();editor.cancel();return;}
            if(busy||!confirmDiscard())e.preventDefault();
        });
        d.addEventListener('close',()=>{if(!d.open){void dispose();opener?.focus();}});
        el('parkingScanClose').onclick=()=>{if(confirmDiscard())d.close();};
        for(const [id,delta] of [['parkingScanPrev',-1],['parkingScanNext',1]])el(id).onclick=()=>{if(confirmDiscard())void act(()=>renderPage(page+delta,0));};
        el('parkingScanRotate').onclick=()=>{if(confirmDiscard())void act(()=>renderPage(page,angle+90));};
        const layout=el('parkingScanLayout');layout.dataset.previous=layout.value;
        layout.onchange=()=>{if(!confirmDiscard()){layout.value=layout.dataset.previous;return;}layout.dataset.previous=layout.value;draw();};
        el('parkingScanSave').onclick=()=>act(async()=>{
            feedback('領収書を保存しています…','pending');
            await ParkingManager.settled();
            const saved=savedRecords();
            if(legacy(saved))throw new Error('旧版で取り込んだページです。残りは写真として追加してください。');
            const chosen=cards.filter(c=>c.tick.checked&&!c.tick.disabled);
            const boxes=chosen.map(c=>c.current());
            if(boxes.some((box,i)=>boxes.slice(0,i).some(b=>ReceiptCrop.overlapRatio(box,b)>.15)))throw new Error('選んだ枠が重なっています。同じ領収書を2回追加しないよう、枠を確認してください。');
            const batch=records(from.hash,page,chosen.map(({slot,current,turn})=>{
                const quad=current();
                const crop=cropImage(quad,turn(),2400);
                try {return {slot,quad,image:crop.toDataURL('image/jpeg',.94)};}
                finally {crop.width=crop.height=1;}
            }),{layout:layout.value,angle});
            const count=await ParkingManager.appendScanPage(batch);
            if(count===-2)throw new Error('追加済みの画像・枠と重なるか、向きや並び方が一致しません。今回は追加していません。未追加の枠を確認してください。');
            if(count<0)throw new Error('領収書を保存できませんでした。端末の空き容量を確認してください。');
            markSaved(savedRecords());
            const msg=count?count+'枚追加しました。未追加の枠はそのまま選べます。駐車場明細で日付・金額・訪問先を確認してください。':'このページは追加済みです。';
            feedback(count?count+'枚追加しました。':'選んだ領収書は追加済みです。','success');
            say(msg);el('parkingPhotoStatus').textContent=msg;
        },true);
    }
    async function open(input) {
        const file=input.files?.[0];input.value='';if(!file||busy)return;
        const dialog=el('parkingScanDialog');
        if(!dialog.dataset.initialized){setup();dialog.dataset.initialized='1';}
        if(!dialog.open){opener=input instanceof HTMLElement ? input : document.activeElement;dialog.showModal();}
        await act(async()=>{
            feedback('');await dispose();
            try {
                if(file.size>20*1024*1024)throw new Error('PDFは20MBまでです。分割して取り込んでください。');
                say('PDFを開いています。初回はPDF表示機能の読み込みに通信が必要です。');
                library ||= import(BASE+'build/pdf.min.mjs').catch(error=>{library=null;throw error;});
                let lib;try {lib=await library;}catch{throw new Error('PDF表示機能を読み込めません。通信状態を確認して開き直してください。');}
                const buffer=await file.arrayBuffer();
                const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),n=>n.toString(16).padStart(2,'0')).join('');
                lib.GlobalWorkerOptions.workerSrc=BASE+'build/pdf.worker.min.mjs';
                from={hash};
                task=lib.getDocument({data:new Uint8Array(buffer),isEvalSupported:false,enableXfa:false,cMapUrl:BASE+'cmaps/',cMapPacked:true,standardFontDataUrl:BASE+'standard_fonts/',wasmUrl:BASE+'wasm/'});
                doc=await task.promise;
                if(doc.numPages>20)throw new Error('PDFは20ページまでです。分割して取り込んでください。');
                await renderPage(1,0);
            }catch(e){await dispose();el('parkingScanPage').textContent='';throw e;}
        });
    }
    function openSample() {
        const JsPdf=window.jspdf?.jsPDF;
        if(!JsPdf){el('parkingPhotoStatus').textContent='見本を読み込めません。ページを開き直してください。';return;}
        const pdf=new JsPdf({orientation:'landscape',unit:'mm',format:'a4'});
        pdf.setCreationDate("D:20261120000000+00'00'");
        pdf.setFileId('9E9AAB45D79847879DEA0075016293B8');
        pdf.setFontSize(13);
        for(let j=0;j<6;j++){
            const x=12+99*(j%3),y=9+105*Math.floor(j/3);
            pdf.setFillColor(240,242,243);pdf.rect(x,y,71,82,'F');
            pdf.text(['SAMPLE RECEIPT '+(j+1),'2026/11/20','JPY '+(500+100*j)],x+6,y+12);
        }
        const f=new File([pdf.output('arraybuffer')],'gyomu-scan-sample.pdf',{type:'application/pdf'});
        return open({files:[f],value:''});
    }
    return {open,openSample,pageScale,records,validGeometry};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ParkingScan;
