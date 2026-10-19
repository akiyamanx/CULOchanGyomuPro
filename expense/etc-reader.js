// PDFは端末内で分割。枠全体を描画して保存し、証明書の印字は変更しない。
const EtcPdfReader = (() => {
    const BASE='https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/';let library;
    async function read(file,progress,signal) {
        if(file.size>20*1024*1024)throw new Error('PDFは20MBまでです。');
        library ||= import(BASE+'build/pdf.min.mjs').catch(e=>{library=null;throw e;});
        const lib=await library;lib.GlobalWorkerOptions.workerSrc=BASE+'build/pdf.worker.min.mjs';
        const task=lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,cMapUrl:BASE+'cmaps/',cMapPacked:true,standardFontDataUrl:BASE+'standard_fonts/'});
        const abort=()=>task.destroy().catch(()=>{});signal.addEventListener('abort',abort,{once:true});
        const records=[];
        try {
            const pdf=await task.promise;
            if(pdf.numPages>30)throw new Error('1ファイル30ページまでです。月ごとに分けてください。');
            for(let n=1;n<=pdf.numPages;n++) {
                if(signal.aborted)throw new Error('取込を中止しました。');
                progress(n+' / '+pdf.numPages+'ページを読み取り中…');
                const page=await pdf.getPage(n),base=page.getViewport({scale:1}),content=await page.getTextContent();
                const parts=content.items.filter(i=>i.str).map(i=>{const m=lib.Util.transform(base.transform,i.transform);return {x:m[4],y:m[5],text:i.str};});
                const cells=EtcDocument.pageCells(parts,base.width,base.height);
                const scale=3,viewport=page.getViewport({scale}),canvas=document.createElement('canvas');
                canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
                await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
                for(const cell of cells) {
                    const crop=document.createElement('canvas'),r=cell.rect;crop.width=Math.ceil(r.w*scale);crop.height=Math.ceil(r.h*scale);
                    const ctx=crop.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,crop.width,crop.height);ctx.drawImage(canvas,r.x*scale,r.y*scale,r.w*scale,r.h*scale,0,0,crop.width,crop.height);
                    records.push({...cell,imageDataUrl:crop.toDataURL('image/png'),sourceName:file.name,sourcePage:n,owner:'hold',confirmed:false,legId:'',claimAmount:cell.amount,visitCompany:'',machineName:'',purpose:'',note:''});
                    crop.width=crop.height=1;
                }
                canvas.width=canvas.height=1;page.cleanup();
            }
            if(signal.aborted)throw new Error('取込を中止しました。');
            return records;
        } finally {signal.removeEventListener('abort',abort);await task.destroy().catch(()=>{});}
    }
    return {read};
})();
