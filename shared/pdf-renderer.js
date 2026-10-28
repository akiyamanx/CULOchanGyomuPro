// 日本語はブラウザのフォントで描画し、画像としてPDFへ入れる。
const PdfRenderer = (() => {
    async function addPage(pdf, dom) {
        if (document.fonts) await document.fonts.ready;
        const canvas = await html2canvas(dom, {
            scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
            windowWidth: 1200, scrollX: 0, scrollY: 0,
            onclone: cloned => {
                const target = cloned.getElementById(dom.id);
                if (target) { target.style.left = '0'; target.style.top = '0'; }
            }
        });
        const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight();
        const ratio = Math.min((width - 10) / canvas.width, (height - 10) / canvas.height);
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', (width - canvas.width * ratio) / 2, 5,
            canvas.width * ratio, canvas.height * ratio);
    }
    return { addPage };
})();

