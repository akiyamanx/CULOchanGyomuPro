// 写真の取り込み・非破壊編集。処理は端末内。AI読取だけ既存のGemini設定を使用する。
const ReceiptPhoto = (() => {
    const full = () => [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
    let itemId='', original=null, base=null, points=full(), angle=0, quarter=0, corner=0, dialog=null;
    const el = id => document.getElementById(id);
    function canvas(w,h) {const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
    function load(url) {return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('画像を開けません。JPEG・PNGで保存して選び直してください。'));i.src=url;});}
    async function normalize(file) {
        if (!file.type.startsWith('image/')) throw new Error('JPEG・PNGなどの画像を選んでください。');
        if (file.size>20*1024*1024) throw new Error('1枚20MB以下の画像を選んでください。');
        const url=URL.createObjectURL(file);
        try {
            const image=await load(url), scale=Math.min(1,2400/Math.max(image.width,image.height));
            const out=canvas(Math.round(image.width*scale),Math.round(image.height*scale));
            const ctx=out.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(image,0,0,out.width,out.height);
            return out.toDataURL('image/jpeg',.94);
        } finally {URL.revokeObjectURL(url);}
    }
    async function addFiles(event) {
        const files=Array.from(event.target.files||[]);event.target.value='';
        if (!files.length) return;
        if (files.length>20) {alert('一度に20枚まで選択できます。残りは続けて追加してください。');return;}
        const status=el('parkingPhotoStatus');let count=0,duplicates=0;const errors=[];
        const controls=Array.from(document.querySelectorAll('[data-parking-upload]'));controls.forEach(input=>input.disabled=true);
        try {
            for (let i=0;i<files.length;i++) {
                status.textContent=(i+1)+' / '+files.length+'枚を保存中…';
                try {
                    const file=files[i],imageDataUrl=await normalize(file);
                    const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
                    const sourceHash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
                    const result=await ParkingManager.append([{imageDataUrl,originalImageDataUrl:imageDataUrl,sourceHash,sourceName:file.name}]);
                    if (result<0) throw new Error('写真を保存できませんでした');
                    if (!result) {duplicates++;continue;} count+=result;
                    if (ReceiptScanner.hasApiKey()) {
                        status.textContent=(i+1)+' / '+files.length+'枚の日付・金額を読取中…';
                        const item=ParkingManager.getItems().find(r=>r.sourceHash===sourceHash);
                        // 写真は先に保存。AIの失敗・通信切断でも追加済み画像を失わない。
                        await ParkingManager.readReceipt(item.id);
                    }
                } catch(error) {errors.push(files[i].name+'：'+error.message);}
            }
        } finally {
            controls.forEach(input=>input.disabled=false);
            status.textContent=count+'枚を追加しました。'+(duplicates?' 同じ写真'+duplicates+'枚は追加済みです。':'')+
                (ReceiptScanner.hasApiKey()?'':' 日付・金額を入力するか、設定後にAI読取できます。')+(errors.length?'\n'+errors.join('\n'):'');
            ParkingManager.renderParkingList();
        }
    }
    function ensureDialog() {
        if (dialog) return;
        dialog=document.createElement('dialog');dialog.id='receiptPhotoDialog';dialog.className='parking-dialog photo-dialog';
        dialog.innerHTML='<h2>領収書の写真を調整</h2><p>四隅を領収書に合わせます。数字を動かすか、下の位置入力でも調整できます。</p>'+
            '<div class="photo-editor-grid"><div><canvas id="receiptEditCanvas" aria-label="四隅調整用の領収書写真"></canvas></div><div class="photo-editor-controls">'+
            '<div class="parking-actions"><button id="receiptTurnLeft" class="btn btn-secondary">左へ90°</button><button id="receiptTurnRight" class="btn btn-secondary">右へ90°</button></div>'+
            '<label>傾きを微調整（−15〜15°）<input id="receiptAngle" type="range" min="-15" max="15" step="0.1" value="0"><output id="receiptAngleValue">0°</output></label>'+
            '<button id="receiptAutoTrim" class="btn btn-secondary">白い紙の余白を自動検出</button><p class="parking-caption">検出後も、印字がすべて四隅の内側にあるか確認してください。</p>'+
            '<label>調整する角<select id="receiptCorner"><option value="0">1 左上</option><option value="1">2 右上</option><option value="2">3 右下</option><option value="3">4 左下</option></select></label>'+
            '<div class="parking-field-grid"><label>横の位置（%）<input id="receiptCornerX" type="number" min="0" max="100" step="0.1"></label><label>縦の位置（%）<input id="receiptCornerY" type="number" min="0" max="100" step="0.1"></label></div>'+
            '<label>PDFの枠に対する大きさ<input id="receiptPdfScale" type="range" min="50" max="100" value="100"><output id="receiptScaleValue">100%</output></label><p class="parking-caption">100%で領収書全体が入る最大サイズ。縦横比は変えません。</p>'+
            '<button id="receiptReset" class="btn btn-secondary">取込時の画像に戻す</button></div></div>'+
            '<p id="receiptEditStatus" role="status" aria-live="polite"></p><details id="receiptResult"><summary>補正後の写真</summary><img id="receiptResultImage" alt="補正後の領収書"></details>'+
            '<div class="parking-dialog-footer"><button id="receiptPreview" class="btn btn-secondary">仕上がりを確認</button><button id="receiptSave" class="btn btn-primary">調整を保存</button><button id="receiptCancel" class="btn btn-secondary">キャンセル</button></div>';
        document.body.appendChild(dialog);
        el('receiptTurnLeft').onclick=()=>{quarter=(quarter+270)%360;rebuild(true);};
        el('receiptTurnRight').onclick=()=>{quarter=(quarter+90)%360;rebuild(true);};
        el('receiptAngle').oninput=event=>{angle=Number(event.target.value);rebuild(true);};
        el('receiptCorner').onchange=event=>{corner=Number(event.target.value);draw();};
        for(const axis of ['X','Y']) el('receiptCorner'+axis).oninput=event=>{points[corner][axis.toLowerCase()]=Math.max(0,Math.min(1,Number(event.target.value)/100));changed();draw(false);};
        el('receiptPdfScale').oninput=()=>{el('receiptScaleValue').value=el('receiptPdfScale').value+'%';};
        el('receiptAutoTrim').onclick=autoTrim;
        el('receiptReset').onclick=()=>{quarter=0;angle=0;el('receiptPdfScale').value=100;el('receiptScaleValue').value='100%';rebuild(true);};
        el('receiptPreview').onclick=()=>process(false);el('receiptSave').onclick=()=>process(true);
        el('receiptCancel').onclick=()=>dialog.close();
        const edit=el('receiptEditCanvas');let dragging=false;
        const position=event=>{const r=edit.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(event.clientY-r.top)/r.height))};};
        edit.onpointerdown=event=>{const p=position(event);corner=points.reduce((best,q,i)=>Math.hypot(q.x-p.x,q.y-p.y)<Math.hypot(points[best].x-p.x,points[best].y-p.y)?i:best,0);points[corner]=p;dragging=true;edit.setPointerCapture(event.pointerId);changed();draw();};
        edit.onpointermove=event=>{if(dragging){points[corner]=position(event);changed();draw();}};
        edit.onpointerup=edit.onpointercancel=()=>{dragging=false;};
    }
    async function open(id) {
        const item=ParkingManager.getItemById(id);if(!item?.imageDataUrl)return;
        try {
            original=await load(item.originalImageDataUrl||item.imageDataUrl);itemId=id;ensureDialog();
            quarter=item.photoEdit?.quarter ?? (item.rotation||0);angle=item.photoEdit?.angle||0;
            points=item.photoEdit?.points?.map(p=>({...p}))||full();corner=0;
            el('receiptPdfScale').value=item.pdfScale||100;el('receiptScaleValue').value=(item.pdfScale||100)+'%';
            el('receiptResult').open=false;el('receiptResultImage').removeAttribute('src');el('receiptEditStatus').textContent='';
            rebuild(false);dialog.showModal();
        } catch(error){alert(error.message);}
    }
    function changed() {el('receiptResult').open=false;el('receiptEditStatus').textContent='変更を保存するまで、元の明細は変わりません。';}
    function rebuild(reset) {
        const rad=(quarter+angle)*Math.PI/180,c=Math.abs(Math.cos(rad)),s=Math.abs(Math.sin(rad));
        base=canvas(Math.ceil(original.width*c+original.height*s),Math.ceil(original.width*s+original.height*c));
        const ctx=base.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,base.width,base.height);ctx.translate(base.width/2,base.height/2);ctx.rotate(rad);ctx.drawImage(original,-original.width/2,-original.height/2);
        if(reset){points=full();changed();}
        el('receiptAngle').value=angle;el('receiptAngleValue').value=angle+'°';draw();
    }
    function draw(sync=true) {
        const edit=el('receiptEditCanvas');const scale=Math.min(1,820/base.width,900/base.height);
        edit.width=Math.round(base.width*scale);edit.height=Math.round(base.height*scale);
        const ctx=edit.getContext('2d');ctx.drawImage(base,0,0,edit.width,edit.height);
        ctx.strokeStyle='#0066cc';ctx.lineWidth=3;ctx.beginPath();points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x*edit.width,p.y*edit.height));ctx.closePath();ctx.stroke();
        points.forEach((p,i)=>{const x=Math.max(15,Math.min(edit.width-15,p.x*edit.width)),y=Math.max(15,Math.min(edit.height-15,p.y*edit.height));ctx.fillStyle=i===corner?'#b05c00':'#0066cc';ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();ctx.fillStyle='white';ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i+1),x,y);});
        el('receiptCorner').value=corner;
        if(sync){el('receiptCornerX').value=(points[corner].x*100).toFixed(1);el('receiptCornerY').value=(points[corner].y*100).toFixed(1);}
    }
    function autoTrim() {
        const small=canvas(200,Math.max(1,Math.round(base.height/base.width*200))),ctx=small.getContext('2d');ctx.drawImage(base,0,0,small.width,small.height);
        const data=ctx.getImageData(0,0,small.width,small.height).data;let left=small.width,top=small.height,right=0,bottom=0;
        for(let y=0;y<small.height;y++)for(let x=0;x<small.width;x++){const k=(y*small.width+x)*4;if(Math.min(data[k],data[k+1],data[k+2])>205 && Math.max(data[k],data[k+1],data[k+2])-Math.min(data[k],data[k+1],data[k+2])<35){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
        if((right-left)*(bottom-top)<small.width*small.height*.1){el('receiptEditStatus').textContent='紙の輪郭を判別できません。四隅を手動で合わせてください。';return;}
        const x1=Math.max(0,left/small.width-.015),x2=Math.min(1,(right+1)/small.width+.015),y1=Math.max(0,top/small.height-.015),y2=Math.min(1,(bottom+1)/small.height+.015);
        points=[{x:x1,y:y1},{x:x2,y:y1},{x:x2,y:y2},{x:x1,y:y2}];changed();draw();
        el('receiptEditStatus').textContent='白い範囲を目安にしました。印字が欠けていないか確認し、必要なら四隅を直してください。';
    }
    function warp() {
        const h=ReceiptGeometry.transform(points),size=ReceiptGeometry.dimensions(points,base.width,base.height);
        const out=canvas(size.width,size.height),dst=out.getContext('2d').createImageData(size.width,size.height),src=base.getContext('2d').getImageData(0,0,base.width,base.height).data;
        for(let y=0;y<size.height;y++)for(let x=0;x<size.width;x++){
            const p=ReceiptGeometry.map(h,x/Math.max(1,size.width-1),y/Math.max(1,size.height-1));
            const sx=Math.max(0,Math.min(base.width-1,p.x*(base.width-1))),sy=Math.max(0,Math.min(base.height-1,p.y*(base.height-1)));
            const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy,k=(y*size.width+x)*4;
            for(let c=0;c<3;c++){const a=(iy*base.width+ix)*4+c,b=(iy*base.width+Math.min(ix+1,base.width-1))*4+c,d=(Math.min(iy+1,base.height-1)*base.width+ix)*4+c,e=(Math.min(iy+1,base.height-1)*base.width+Math.min(ix+1,base.width-1))*4+c;dst.data[k+c]=src[a]*(1-fx)*(1-fy)+src[b]*fx*(1-fy)+src[d]*(1-fx)*fy+src[e]*fx*fy;}dst.data[k+3]=255;
        }
        out.getContext('2d').putImageData(dst,0,0);return out.toDataURL('image/jpeg',.94);
    }
    async function process(save) {
        const buttons=Array.from(dialog.querySelectorAll('button'));buttons.forEach(b=>b.disabled=true);el('receiptEditStatus').textContent='写真を補正しています…';
        try {
            await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
            const imageDataUrl=warp();el('receiptResultImage').src=imageDataUrl;el('receiptResult').open=true;
            if(save){const item=ParkingManager.getItemById(itemId);const ok=await ParkingManager.patchItem(itemId,{imageDataUrl,originalImageDataUrl:item.originalImageDataUrl||item.imageDataUrl,rotation:0,photoEdit:{quarter,angle,points:points.map(p=>({...p}))},pdfScale:Number(el('receiptPdfScale').value)});if(ok){dialog.close();ParkingManager.renderParkingList();}}
            else el('receiptEditStatus').textContent='日付や金額など、印字がすべて写っているか確認してください。';
        } catch(error){el('receiptEditStatus').textContent=error.message;}
        finally{buttons.forEach(b=>b.disabled=false);}
    }
    return {addFiles,open};
})();
