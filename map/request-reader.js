// File decoding only. OCR runs in a browser worker, without sending documents to an API.
const RequestReader = (() => {
    const PDF_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.6.205/';
    let pdfLibrary, ocrScript;
    function excelDate(value) {
        // SheetJS represents an Excel calendar date in local time. UTC conversion
        // moves Japanese midnight to the previous calendar day.
        const pad = number => String(number).padStart(2,'0');
        const date = `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}`;
        return value.getHours() || value.getMinutes() ? `${date} ${pad(value.getHours())}:${pad(value.getMinutes())}` : date;
    }
    // Excelのシリアル値(1900年系)を YYYY-MM-DD にする。2000〜2099年だけを日付とみなす。
    function serialDate(serial) {
        if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 36526 || serial >= 73051) return '';
        const date = new Date(Math.floor(serial - 25569) * 86400000);
        return date.toISOString().slice(0,10);
    }
    // 日付セルの表示文字(w)を、年つきの YYYY-MM-DD に揃える。
    // 実サンプルの「作業希望日」は書式情報の無い数値で、表示だけが 10/15/26 のような月/日/2桁年になり、
    // 日付として読めなかった。数値でも、表示が日付の形(区切りの数字3つ)でシリアル値が日付の範囲なら、値から直す。
    function normalizeDateCells(sheet) {
        for (const [ref,cell] of Object.entries(sheet)) {
            if (ref.startsWith('!') || !cell) continue;
            if (cell.t === 'd' && cell.v instanceof Date) {
                // A time-only cell has no calendar date. Keep its displayed time.
                const format = String(cell.z || '').replace(/"[^"]*"|\\./g,'');
                if (!(/[hs]/i.test(format) && !/[dy]/i.test(format))) cell.w = excelDate(cell.v);
            } else if (cell.t === 'n' && /^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}$/.test(String(cell.w ?? ''))) {
                const date = serialDate(cell.v);
                if (date) cell.w = date;
            }
        }
    }
    function loadOcr() {
        if (!ocrScript) ocrScript = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
            script.onload = resolve;
            script.onerror = () => { script.remove(); ocrScript = null; reject(new Error('文字読取ツールを読み込めません。通信状態を確認してください。')); };
            document.head.appendChild(script);
        });
        return ocrScript;
    }
    async function pdf(file, progress, signal) {
        // PDF.js documented display API: https://mozilla.github.io/pdf.js/examples/
        pdfLibrary ||= import(PDF_BASE + 'build/pdf.min.mjs').catch(error => { pdfLibrary = null; throw error; });
        const lib = await pdfLibrary;
        lib.GlobalWorkerOptions.workerSrc = PDF_BASE + 'build/pdf.worker.min.mjs';
        const task = lib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
        const abort = () => { task.destroy().catch(()=>{}); if (worker) worker.terminate().catch(()=>{}); };
        let doc, worker;
        signal.addEventListener('abort', abort, {once:true});
        const result = [];
        try {
            if (signal.aborted) throw new Error('読取を中止しました。');
            doc = await task.promise;
            if (doc.numPages > 10) throw new Error('PDFは1ファイル10ページまでです。分割して取り込んでください。');
            for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
                if (signal.aborted) throw new Error('読取を中止しました。');
                progress(`PDF ${pageNumber}/${doc.numPages}ページを読取中…`);
                const page = await doc.getPage(pageNumber);
                const content = await page.getTextContent();
                const lines = [];
                for (const item of content.items) {
                    if (!item.str) continue;
                    const y = item.transform[5];
                    let line = lines.find(row => Math.abs(row.y-y) < 3);
                    if (!line) { line={y,parts:[]}; lines.push(line); }
                    line.parts.push({x:item.transform[4],text:item.str});
                }
                let text = lines.sort((a,b)=>b.y-a.y).map(row=>row.parts.sort((a,b)=>a.x-b.x).map(part=>part.text).join(' ')).join('\n');
                const viewport = page.getViewport({scale:Math.min(3,2000 / page.getViewport({scale:1}).width)});
                const canvas = document.createElement('canvas');
                canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
                await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
                if (text.replace(/\s/g,'').length < 30) {
                    progress('画像PDFの文字読取を準備中… 初回は通信が必要です。');
                    await loadOcr();
                    // Tesseract worker API: https://github.com/naptha/tesseract.js/blob/master/docs/api.md
                    worker ||= await Tesseract.createWorker(['jpn','eng'],1,{
                        workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
                        corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
                        logger:message => { if (message.status === 'recognizing text') progress(`PDF ${pageNumber}/${doc.numPages}ページの文字読取 ${Math.round(message.progress*100)}%`); }
                    });
                    if (signal.aborted) throw new Error('読取を中止しました。');
                    await worker.setParameters({tessedit_pageseg_mode:'6'});
                    text = (await worker.recognize(canvas)).data.text;
                }
                if (signal.aborted) throw new Error('読取を中止しました。');
                const items = RequestParser.parsePdfText(text, `${file.name} · ${pageNumber}ページ`);
                items.forEach(item => { item.originalText = text; item.previewUrl = canvas.toDataURL('image/jpeg',0.8); });
                result.push(...items);
                canvas.width = canvas.height = 0;
                page.cleanup();
            }
            if (!result.length) throw Object.assign(new Error('業務依頼書として読めるページがありませんでした。精算書・納品書・調査票などの参考資料は取り込みません。'),{code:'no_items'});
            return result;
        } finally {
            signal.removeEventListener('abort',abort);
            if (worker) await worker.terminate().catch(()=>{});
            await task.destroy().catch(()=>{});
        }
    }
    async function read(file, progress, signal) {
        if (file.size > 20*1024*1024) throw new Error('1ファイル20MBまでです。');
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'pdf') return pdf(file,progress,signal);
        let result = [];
        if (ext === 'csv') {
            const bytes = await file.arrayBuffer();
            let csv = new TextDecoder('utf-8').decode(bytes);
            if (csv.includes('\ufffd')) csv = new TextDecoder('shift-jis').decode(bytes);
            result = RequestParser.parseRows(ExpenseImport.parseCsv(csv),file.name);
        } else if (['xls','xlsx'].includes(ext)) {
            if (typeof XLSX === 'undefined') throw new Error('Excel読取ツールを読み込めません。通信状態を確認して再読込してください。');
            const book = XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,cellNF:true});
            for (const name of book.SheetNames) {
                if (book.Workbook?.Sheets?.find(sheet=>sheet.name===name)?.Hidden) continue;
                const sheet = book.Sheets[name];
                normalizeDateCells(sheet);
                const rows = XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
                result.push(...RequestParser.parseRows(rows,`${file.name} · ${name}`));
            }
        } else throw new Error('CSV・Excel（xlsx/xls）・PDFを選択してください。');
        if (!result.length) throw Object.assign(new Error('会社名と住所を含む一覧表、または対応する業務依頼書が見つかりません。'),{code:'no_items'});
        return result;
    }
    // --- メール取り込み用(メールBOX) ---
    // read は「0件」を例外にするが、メールBOXは「開けた・0件」と「開けなかった」を区別して仕分けに渡す。
    // 戻り値に個人情報は含めない(errorCode は固定の英小文字コードだけ)。
    function kindOf(fileName) {
        const ext = String(fileName || '').split('.').pop().toLowerCase();
        if (ext === 'pdf') return 'pdf';
        if (ext === 'xls' || ext === 'xlsx' || ext === 'csv') return ext;
        if (['jpg','jpeg','png','heic','gif','webp'].includes(ext)) return 'image';
        return 'other';
    }
    async function readForMail(file, progress, signal) {
        const kind = kindOf(file && file.name);
        const out = {kind, opened:false, items:[], errorCode:''};
        if (kind === 'other') { out.errorCode = 'unsupported_kind'; return out; }
        if (kind === 'image') { out.opened = true; return out; } // 画像は読まず、判別不可で本人に確認してもらう。
        if (file.size > 20*1024*1024) { out.errorCode = 'too_large'; return out; }
        try {
            out.items = await read(file,progress,signal);
            out.opened = true;
        } catch (error) {
            if (error && error.code === 'no_items') out.opened = true;
            else out.errorCode = signal && signal.aborted ? 'aborted' : 'read_failed';
        }
        return out;
    }
    return {read,readForMail,kindOf,excelDate,normalizeDateCells};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RequestReader;
