const RouteListPdf = (() => {
    let busy = false;
    async function generate() {
        if (busy) return;
        const customers = DataStorage.getCustomers();
        if (!customers.length) { alert('出力するデータがありません'); return; }
        busy = true;
        AppCore.showLoading('訪問先一覧PDF生成中...');
        const routes = DataStorage.getRoutes();
        const esc = ExpenseImport.escapeHtml;
        const dom = document.createElement('div');
        dom.id = 'routeListPdfContent';
        dom.style.cssText = 'position:absolute;left:-9999px;top:0;width:1050px;padding:24px;background:white;color:black;font-family:sans-serif;';
        document.body.appendChild(dom);
        try {
            const pdf = new window.jspdf.jsPDF('landscape', 'mm', 'a4');
            for (let start = 0; start < customers.length; start += 12) {
                if (start) pdf.addPage();
                dom.innerHTML = '<h2>メンテナンスマップ ― 訪問先一覧</h2><p>出力日: ' + new Date().toLocaleDateString('ja-JP') + '</p>'
                    + '<table style="border-collapse:collapse;width:100%;font-size:13px;"><tr>'
                    + ['ルート', '会社名', '住所', '電話番号', '担当者', '台数', '状況'].map(value => '<th>' + value + '</th>').join('') + '</tr>'
                    + customers.slice(start, start + 12).map(item => '<tr>' + [
                        (routes.find(route => route.id === item.routeId) || {}).name || '未割当', item.company, item.address, item.phone, item.contact,
                        item.unitCount > 1 ? item.unitCount + '台' : '', item.status === 'appointed' ? 'アポ済' : item.status === 'completed' ? '完了' : '未アポ'
                    ].map(value => '<td>' + esc(value) + '</td>').join('') + '</tr>').join('') + '</table>'
                    + '<p style="text-align:right;">' + (Math.floor(start / 12) + 1) + ' / ' + Math.ceil(customers.length / 12) + '</p>';
                dom.querySelectorAll('th,td').forEach(cell => { cell.style.cssText = 'border:1px solid #777;padding:8px;overflow-wrap:anywhere;'; });
                await PdfRenderer.addPage(pdf, dom);
            }
            pdf.save('訪問先一覧_' + new Date().toLocaleDateString('sv-SE') + '.pdf');
        } catch (error) { alert('PDF生成に失敗しました\n' + error.message); }
        finally { dom.remove(); AppCore.hideLoading(); busy = false; }
    }
    return { generate };
})();
