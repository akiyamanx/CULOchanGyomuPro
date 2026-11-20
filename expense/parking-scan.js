// コピー機PDFをブラウザ内でページ表示し、確認した枠だけ駐車場明細に渡す。
const ParkingScan = (() => {
    const BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/';
    const el = id => document.getElementById(id);
    let library, task, doc, from, opener, page = 1, angle = 0, image, cards = [], busy = false, editor;
    function pageScale(width,height) {
        if (![width,height].every(n=>Number.isFinite(n)&&n>0)) throw new Error('PDFページの大きさを確認できません。');
        return Math.min(300/72,3600/Math.max(width,height));
    }
    function records(hash,index,crops) {
        if (!/^[a-f0-9]{64}$/.test(hash)||!Number.isSafeInteger(index)||index<1||!Array.isArray(crops)||!crops.length||crops.length>6) throw new Error('追加する領収書を選んでください。');
        const sourcePageKey = hash+':'+index, seenImages=new Set(), seenSlots=new Set();
        return crops.map(({image,slot})=>{
            if(!Number.isInteger(slot)||slot<0||slot>5||seenSlots.has(slot)||!/^data:image\/jpeg;base64,[a-z0-9+/]+=*$/i.test(image)||seenImages.has(image)){
                throw new Error('同じ画像か無効な枠が含まれています。切り出し枠を確認してください。');
            }
            seenSlots.add(slot);seenImages.add(image);
            return {imageDataUrl:image,originalImageDataUrl:image,sourceHash:'pdfscan:'+sourcePageKey+':'+slot,sourcePageKey,pdfSelected:false};
        });
    }
    function say(msg) {el('parkingScanStatus').textContent=msg;}
    async function act(fn) {
        if(busy)return;
        busy=true;syncControls();
        try {await fn();}catch(e){say(e.message||'PDFを取り込めませんでした。');}
        finally{busy=false;syncControls();}
    }
    function syncControls() {
        ['parkingScanPrev','parkingScanNext','parkingScanRotate','parkingScanLayout','parkingScanSave','parkingScanClose'].forEach(id=>{
            const control=el(id);if(control)control.disabled=busy;
        });
        if(!busy){
            el('parkingScanPrev').disabled=!doc||page<=1;el('parkingScanNext').disabled=!doc||page>=doc.numPages;
            el('parkingScanSave').disabled=!image||!!savedPage();
            el('parkingScanLayout').disabled=!image;
            el('parkingScanRotate').disabled=!doc;
        }
    }
    function savedPage() {return from&&ParkingManager.getItems().some(i=>i.sourcePageKey===from.hash+':'+page);}
    function dropCanvas() {if(image){image.width=image.height=1;image=null;}cards=[];el('parkingScanCards').replaceChildren();el('parkingScanSource').replaceChildren();}
    async function dispose() {dropCanvas();const old=task;task=doc=from=null;if(old)await old.destroy().catch(()=>{});}
    async function renderPage(next,rotation) {
        say('PDFページを読み込み中…');
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
    function draw() {
        const [columns,rows]=el('parkingScanLayout').value.split(',').map(Number);
        const result=GyomuScanner.detectImage(image,{columns,rows});
        const host=el('parkingScanCards');host.replaceChildren();
        cards=result.boxes.map((box,i)=>{
            const card=make('section'), label=make('label'), tick=make('input');tick.type='checkbox';tick.disabled=!!savedPage();
            label.append(tick,document.createTextNode(' '+(i+1)+'枚目を追加'));
            const info=make('p',box.method==='detected'?'用紙の縁を検出。欠けがないか確認。':'均等分割の枠です。空欄は選ばない。');
            info.className='parking-caption';
            const preview=make('div'), adjust=make('button','指でトリミング');
            adjust.type='button';adjust.className='btn';
            adjust.setAttribute('aria-label',(i+1)+'枚目を指でトリミング');
            adjust.disabled=!!savedPage();
            const initial=ReceiptCrop.fromBox(GyomuScanner.sanitizeBox(box));
            let quad=initial;
            const redraw=()=>preview.replaceChildren(ReceiptCrop.image(image,quad,550));
            adjust.onclick=()=>editor.open({source:image,initial,quad,invoker:adjust,label:(i+1)+'枚目',
                onApply:next=>{quad=next;redraw();}});
            card.append(label,info,preview,adjust);host.append(card);redraw();
            return {tick,adjust,slot:i,current:()=>quad,edited:()=>quad!==initial};
        });
        say(savedPage()?'このページは追加済みです。取り込んだ画像は明細で確認できます。':'領収書が全部入っている枠だけ選んでください。注記入りの提出済みPDFではなく、スキャンした元のPDFを使ってください。');
    }
    function confirmDiscard(){return !!savedPage()||!cards.some(c=>c.tick.checked||c.edited())||confirm('このページの未追加の選択・枠調整を破棄しますか？');}
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
            await ParkingManager.settled();
            if(savedPage())throw new Error('すでに取り込んだページです。明細画面から確認してください。');
            const chosen=cards.filter(c=>c.tick.checked);
            const boxes=chosen.map(c=>c.current());
            if(boxes.some((box,i)=>boxes.slice(0,i).some(b=>ReceiptCrop.overlapRatio(box,b)>.15)))throw new Error('選んだ枠が重なっています。同じ領収書を2回追加しないよう、枠を確認してください。');
            const batch=records(from.hash,page,chosen.map(({slot,current})=>{
                const crop=ReceiptCrop.image(image,current(),2400);
                try {return {slot,image:crop.toDataURL('image/jpeg',.94)};}
                finally {crop.width=crop.height=1;}
            }));
            const count=await ParkingManager.appendScanPage(batch);
            if(count===-2)throw new Error('取り込み済みの画像が含まれています。このページは追加していません。別の枠を選んでください。');
            if(count<0)throw new Error('領収書を保存できませんでした。端末の空き容量を確認してください。');
            cards.forEach(c=>{c.tick.checked=false;c.tick.disabled=true;c.adjust.disabled=true;});
            const msg=count?count+'枚追加しました。駐車場明細で日付・金額・訪問先を確認してください。':'このページは追加済みです。';
            say(msg);el('parkingPhotoStatus').textContent=msg;
        });
    }
    async function open(input) {
        const file=input.files?.[0];input.value='';if(!file||busy)return;
        const dialog=el('parkingScanDialog');
        if(!dialog.dataset.initialized){setup();dialog.dataset.initialized='1';}
        if(!dialog.open){opener=input instanceof HTMLElement ? input : document.activeElement;dialog.showModal();}
        await act(async()=>{
            await dispose();
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
    return {open,openSample,pageScale,records};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ParkingScan;
