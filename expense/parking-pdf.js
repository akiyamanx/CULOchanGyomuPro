// 提出前に全ページを確認。A4横・6枚（3列×2段）を標準に、4枚にも切替。
const ParkingPdf = (() => {
    let dialog, pdfUrl='', pdfBlob=null, fileName='';
    function image(url) {return new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('読み込めない写真があります。該当の写真を確認してください。'));img.src=url;});}
    function wrap(ctx,text,width) {
        const lines=[];let line='';
        for(const char of String(text).replace(/\r/g,'')) {
            if(char==='\n'){lines.push(line);line='';continue;}
            if(line && ctx.measureText(line+char).width>width){lines.push(line);line=char;} else line+=char;
        }
        lines.push(line);return lines;
    }
    async function drawPhoto(ctx,item,x,y,w,h) {
        let img=await image(item.imageDataUrl);
        if(item.rotation) {
            const rad=item.rotation*Math.PI/180,c=Math.abs(Math.cos(rad)),s=Math.abs(Math.sin(rad));
            const rotated=document.createElement('canvas');rotated.width=Math.ceil(img.width*c+img.height*s);rotated.height=Math.ceil(img.width*s+img.height*c);
            const rc=rotated.getContext('2d');rc.fillStyle='white';rc.fillRect(0,0,rotated.width,rotated.height);rc.translate(rotated.width/2,rotated.height/2);rc.rotate(rad);rc.drawImage(img,-img.width/2,-img.height/2);img=rotated;
        }
        const scale=Math.min(w/img.width,h/img.height)*Math.max(.5,Math.min(1,(Number(item.pdfScale)||100)/100));
        const width=img.width*scale,height=img.height*scale;
        ctx.drawImage(img,x+(w-width)/2,y+(h-height)/2,width,height);
    }
    async function pageCanvas(items,count,pageNumber,totalPages,title) {
        const canvas=document.createElement('canvas');canvas.width=2970;canvas.height=2100;
        const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle='#111';ctx.textAlign='center';ctx.textBaseline='top';ctx.font='600 44px "Noto Sans JP", sans-serif';
        ctx.fillText(title,1485,30);
        const cols=count===4?2:3,margin=65,top=115,gap=22,cw=(canvas.width-margin*2-gap*(cols-1))/cols,ch=(canvas.height-top-70-gap)/2;
        for(let i=0;i<items.length;i++) {
            const item=items[i],x=margin+(i%cols)*(cw+gap),y=top+Math.floor(i/cols)*(ch+gap),pad=22;
            ctx.strokeStyle='#c4c9cf';ctx.lineWidth=2;ctx.strokeRect(x,y,cw,ch);
            const paragraphs=item.captionLines || ['日付：'+item.date.replace(/-/g,'/'),'訪問先：'+item.visitCompany,'目的：'+item.machineName+'・'+item.purpose];
            let size=34,lines;
            do {ctx.font=size+'px "Noto Sans JP", sans-serif';lines=paragraphs.flatMap(text=>wrap(ctx,text,cw-pad*2));if(lines.length*size*1.4<ch*.42)break;size-=2;} while(size>=26);
            if(size<26) throw new Error('訪問先または目的が長すぎます。略称にするか、4枚配置で確認してください。');
            const lineH=size*1.4,textH=lines.length*lineH+20,textY=y+ch-textH;
            await drawPhoto(ctx,item,x+pad,y+pad,cw-pad*2,ch-textH-pad*2);
            ctx.strokeStyle='#d8dce0';ctx.beginPath();ctx.moveTo(x+pad,textY-9);ctx.lineTo(x+cw-pad,textY-9);ctx.stroke();
            ctx.fillStyle='#111';ctx.textAlign='left';ctx.textBaseline='top';ctx.font=size+'px "Noto Sans JP", sans-serif';
            lines.forEach((line,j)=>ctx.fillText(line,x+pad,textY+j*lineH));
        }
        ctx.textAlign='right';ctx.font='25px "Noto Sans JP", sans-serif';ctx.fillText(pageNumber+' / '+totalPages,canvas.width-margin,canvas.height-40);
        return canvas;
    }
    function ensureDialog() {
        if(dialog)return;
        dialog=document.createElement('dialog');dialog.id='parkingPdfDialog';dialog.className='parking-dialog pdf-preview-dialog';
        dialog.innerHTML='<h2>提出用PDFを確認</h2><p id="parkingPdfSummary"></p><p>領収書の文字・日付・訪問先・目的を確認し、PDFを保存してメールに添付できます。</p><div class="parking-dialog-footer"><a id="parkingPdfDownload" class="btn btn-primary">PDFを保存</a><button id="parkingPdfShare" class="btn btn-secondary" hidden>PDFを共有</button><button id="parkingPdfZoom" class="btn btn-secondary" aria-pressed="false">拡大して読む</button><button id="parkingPdfClose" class="btn btn-secondary">閉じて修正</button></div><div id="parkingPdfPages"></div>';
        document.body.appendChild(dialog);document.getElementById('parkingPdfClose').onclick=()=>dialog.close();
        document.getElementById('parkingPdfZoom').onclick=()=>{const large=dialog.classList.toggle('pdf-large');const button=document.getElementById('parkingPdfZoom');button.textContent=large?'全体を表示':'拡大して読む';button.setAttribute('aria-pressed',String(large));};
        document.getElementById('parkingPdfShare').onclick=async()=>{try {await navigator.share({files:[new File([pdfBlob],fileName,{type:'application/pdf'})],title:'駐車場利用明細'});}catch(error){if(error.name!=='AbortError')alert('共有できませんでした。「PDFを保存」から添付できます。');}};
        dialog.addEventListener('close',()=>{if(pdfUrl)URL.revokeObjectURL(pdfUrl);pdfUrl='';pdfBlob=null;document.getElementById('parkingPdfPages').replaceChildren();});
    }
    async function generate(snapshot) {
        if (!snapshot) await ParkingManager.settled();
        const items=snapshot ? snapshot.items : ParkingManager.getSelectedItems(),problem=ParkingDocument.validate(items);
        if(problem){alert(problem);return;}
        const count=Number(snapshot ? snapshot.pageSize : document.getElementById('parkingPageSize')?.value)===4?4:6,pages=ParkingDocument.pages(items,count);
        const title=snapshot?.title || '駐車場利用明細';
        AppCore.showLoading('提出用PDFを準備中…');
        try {
            if(document.fonts){await document.fonts.load('34px "Noto Sans JP"',items.map(i=>i.visitCompany+i.machineName+i.purpose).join('')+'日付訪問先目的');await document.fonts.load('600 44px "Noto Sans JP"','駐車場利用明細');await document.fonts.ready;}
            const pdf=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4',compress:true});
            ensureDialog();dialog.classList.remove('pdf-large');document.getElementById('parkingPdfZoom').textContent='拡大して読む';document.getElementById('parkingPdfZoom').setAttribute('aria-pressed','false');const previews=document.getElementById('parkingPdfPages');previews.replaceChildren();
            for(let i=0;i<pages.length;i++) {
                AppCore.showLoading('PDF '+(i+1)+' / '+pages.length+'ページを作成中…');
                const canvas=await pageCanvas(pages[i],count,i+1,pages.length,title),url=canvas.toDataURL('image/jpeg',.95);
                if(i)pdf.addPage('a4','landscape');pdf.addImage(url,'JPEG',0,0,297,210);
                const img=document.createElement('img');img.src=url;img.alt=title+' '+(i+1)+'ページ（'+pages[i].length+'枚）';previews.appendChild(img);
                canvas.width=canvas.height=1;
            }
            if(pdfUrl)URL.revokeObjectURL(pdfUrl);
            pdfBlob=pdf.output('blob');pdfUrl=URL.createObjectURL(pdfBlob);
            const first=items[0].date,last=items[items.length-1].date;fileName=title+'_'+first+(first!==last?'_'+last:'')+'.pdf';
            const link=document.getElementById('parkingPdfDownload');link.href=pdfUrl;link.download=fileName;
            document.getElementById('parkingPdfSummary').textContent=(snapshot ? (snapshot.sourceLabel || '下書きの領収書')+' ／ ' : '')+'A4横向き・1ページ'+count+'枚配置 ／ 領収書'+items.length+'枚・全'+pages.length+'ページ';
            document.getElementById('parkingPdfShare').hidden=!(navigator.canShare && navigator.canShare({files:[new File([pdfBlob],fileName,{type:'application/pdf'})]}));
            dialog.showModal();
        }catch(error){alert('PDFを作成できませんでした。\n'+error.message);}
        finally{AppCore.hideLoading();}
    }
    return {generate};
})();
