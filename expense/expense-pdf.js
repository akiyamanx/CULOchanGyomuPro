// ==========================================
// CULOchan業務Pro — 精算書PDF出力 v1.2
// このファイルは交通費精算書のPDF生成を担当する
// html2canvas + jsPDF で横向きA4に11列テーブルを描画
// 日本ROメンテナンスサービス向けの書式
// v1.1改修 - 行先セルを会社名行＋住所行の2段表示に対応
// v1.2修正 - 行先セルの高さを拡大(50→60px)、会社名と住所の間のmarginを縮小(4px→1px)
//
// 依存: app-core.js, expense-manager.js, html2canvas, jsPDF
// ==========================================

const ExpensePdf = (() => {

    function _buildPdfDom(header, rows) {
        const old = document.getElementById('expPdfContent');
        if (old) old.remove();

        const dateObj = new Date(header.submitDate);
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth() + 1;
        const day = dateObj.getDate();
        const dateStr = year + '年　　' + month + '月　　' + day + '日';

        const totals = { gas: 0, highway: 0, other: 0, ship: 0, train: 0, air: 0, hotel: 0, all: 0 };
        let dataRowsHtml = '';

        rows.forEach(r => {
            const gas = parseInt(r.gasCost) || 0;
            const highway = ExpenseManager.parseHighway(r.highway);
            const other = parseInt(r.other) || 0;
            const ship = parseInt(r.ship) || 0;
            const train = parseInt(r.train) || 0;
            const air = parseInt(r.air) || 0;
            const hotel = parseInt(r.hotel) || 0;
            const rowTotal = gas + highway + other + ship + train + air + hotel;

            totals.gas += gas; totals.highway += highway; totals.other += other;
            totals.ship += ship; totals.train += train; totals.air += air;
            totals.hotel += hotel; totals.all += rowTotal;

            let distDisp = '';
            if (r.distance) distDisp = r.distance + 'キロ';
            if (gas) distDisp += '\n' + gas + '円';

            let hwDisp = '';
            if (r.highway) {
                const amounts = r.highway.split(/[,、，]/).map(v => v.trim()).filter(v => v);
                hwDisp = amounts.map(a => parseInt(a) + '円').join('\n');
                if (r.highwayCount) hwDisp += '\n' + r.highwayCount + '枚';
            }

            let hotelDisp = '';
            if (hotel) {
                hotelDisp = hotel + '円';
                if (r.hotelName) hotelDisp += '\n' + r.hotelName;
            }

            dataRowsHtml += '<tr>'
                + '<td style="height:50px;">' + (r.month || '') + '</td>'
                + '<td style="height:50px;">' + (r.day || '') + '</td>'
                + '<td style="height:50px;">' + (r.transport || '') + '</td>'
                + '<td style="height:50px;"><span class="cell-content">' + distDisp + '</span></td>'
                + '<td style="height:50px;"><span class="cell-content">' + hwDisp + '</span></td>'
                + '<td style="height:50px;">' + (other ? other + '円' : '') + '</td>'
                + '<td style="height:50px;">' + (ship ? ship + '円' : '') + '</td>'
                + '<td style="height:50px;">' + (train ? train + '円' : '') + '</td>'
                + '<td style="height:50px;">' + (air ? air + '円' : '') + '</td>'
                + '<td style="height:50px;"><span class="cell-content">' + hotelDisp + '</span></td>'
                + '<td style="height:50px;">' + (rowTotal ? rowTotal + '円' : '') + '</td>'
                + '</tr>';
        });

        for (let i = rows.length; i < 6; i++) {
            dataRowsHtml += '<tr>' + '<td style="height:50px;"></td>'.repeat(11) + '</tr>';
        }

        const fmtCell = (v) => v ? v + '円' : '';

        const div = document.createElement('div');
        div.id = 'expPdfContent';
        div.style.cssText = 'position:absolute;left:-9999px;top:0;width:1050px;'
            + 'background:white;padding:20px 25px;'
            + 'font-family:"MS Gothic","ＭＳ ゴシック","Hiragino Kaku Gothic ProN",sans-serif;'
            + 'font-size:11px;color:#000;';

        div.innerHTML = ''
            + '<div style="font-size:13px;margin-bottom:10px;">日本ROメンテナンスサービス株式会社　御中</div>'
            + '<div style="text-align:center;font-size:20px;font-weight:bold;letter-spacing:8px;margin-bottom:12px;">出張費精算請求書</div>'
            + '<table style="width:100%;border-collapse:collapse;border:1px solid black;">'
            + '<tr style="height:20px;">'
            + '<td style="border:1px solid black;padding:3px 5px;text-align:center;">提出日</td>'
            + '<td colspan="5" style="border:1px solid black;text-align:left;padding-left:10px;">' + dateStr + '</td>'
            + '<td style="border:1px solid black;padding:3px 5px;text-align:center;">SS名</td>'
            + '<td colspan="2" style="border:1px solid black;text-align:center;">' + _esc(header.ssName) + '</td>'
            + '<td style="border:1px solid black;height:20px;padding:0;">'
            + '<table style="width:100%;height:100%;border-collapse:collapse;"><tr>'
            + '<td style="border-right:1px solid black;width:50%;"></td>'
            + '<td style="width:50%;text-align:center;font-size:10px;">経理</td></tr></table></td>'
            + '<td style="border:1px solid black;text-align:center;font-size:10px;">本部</td>'
            + '</tr>'
            // v1.2修正 - 行先セル: 高さ60px、会社名と住所のmarginを1pxに縮小してゆとり確保
            + '<tr>'
            + '<td colspan="2" style="border:1px solid black;padding:3px 5px;text-align:center;height:60px;">行先<br><span style="font-size:8px;">（お客様名）</span></td>'
            + '<td colspan="4" style="border:1px solid black;text-align:left;padding:4px 6px;height:60px;vertical-align:middle;">'
            + '<div style="font-size:11px;margin-bottom:1px;">' + _esc(header.destCompany || '') + '</div>'
            + '<div style="font-size:9px;color:#444;">' + _esc(header.destAddress || '') + '</div>'
            + '</td>'
            + '<td style="border:1px solid black;padding:3px 5px;text-align:center;">氏名</td>'
            + '<td colspan="2" style="border:1px solid black;text-align:left;padding-left:5px;">' + _esc(header.employeeName) + '　印</td>'
            + '<td style="border:1px solid black;height:60px;padding:0;">'
            + '<table style="width:100%;height:100%;border-collapse:collapse;"><tr>'
            + '<td style="border-right:1px solid black;width:50%;"></td>'
            + '<td style="width:50%;"></td></tr></table></td>'
            + '<td style="border:1px solid black;height:60px;"></td>'
            + '</tr>'
            + '<tr style="height:45px;">'
            + '<td style="border:1px solid black;width:40px;text-align:center;font-size:10px;">月</td>'
            + '<td style="border:1px solid black;width:40px;text-align:center;font-size:10px;">日</td>'
            + '<td style="border:1px solid black;width:90px;text-align:center;font-size:10px;">利用交通機関</td>'
            + '<td style="border:1px solid black;width:70px;text-align:center;font-size:10px;">走行距離</td>'
            + '<td style="border:1px solid black;width:60px;text-align:center;font-size:10px;">高速代<br><span style="font-size:8px;">（枚数）</span></td>'
            + '<td style="border:1px solid black;width:70px;text-align:center;font-size:10px;">その他<br><span style="font-size:8px;">（タクシー・<br>バス等）</span></td>'
            + '<td style="border:1px solid black;width:55px;text-align:center;font-size:10px;">船賃</td>'
            + '<td style="border:1px solid black;width:55px;text-align:center;font-size:10px;">電車賃</td>'
            + '<td style="border:1px solid black;width:55px;text-align:center;font-size:10px;">航空賃</td>'
            + '<td style="border:1px solid black;width:70px;text-align:center;font-size:10px;">宿泊料<br><span style="font-size:8px;">（宿泊先）</span></td>'
            + '<td style="border:1px solid black;width:60px;text-align:center;font-size:10px;">合計</td>'
            + '</tr>'
            + dataRowsHtml
            + '<tr style="height:40px;">'
            + '<td colspan="2" style="border:1px solid black;text-align:center;font-weight:bold;">合　　計</td>'
            + '<td style="border:1px solid black;"></td>'
            + '<td style="border:1px solid black;text-align:center;">' + fmtCell(totals.gas) + '</td>'
            + '<td style="border:1px solid black;text-align:center;">' + fmtCell(totals.highway) + '</td>'
            + '<td style="border:1px solid black;text-align:center;">' + fmtCell(totals.other) + '</td>'
            + '<td style="border:1px solid black;text-align:center;">' + fmtCell(totals.ship) + '</td>'
            + '<td style="border:1px solid black;text-align:center;">' + fmtCell(totals.train) + '</td>'
            + '<td style="border:1px solid black;text-align:center;">' + fmtCell(totals.air) + '</td>'
            + '<td style="border:1px solid black;text-align:center;">' + fmtCell(totals.hotel) + '</td>'
            + '<td style="border:1px solid black;text-align:center;font-weight:bold;">' + fmtCell(totals.all) + '</td>'
            + '</tr>'
            + '<tr><td colspan="11" style="border:1px solid black;height:60px;text-align:left;vertical-align:top;padding:6px;">'
            + '<span style="font-weight:bold;">【備考欄】</span></td></tr>'
            + '</table>';

        div.querySelectorAll('td').forEach(td => {
            if (!td.style.border) td.style.border = '1px solid black';
            if (!td.style.textAlign) td.style.textAlign = 'center';
            if (!td.style.fontSize) td.style.fontSize = '10px';
            td.style.verticalAlign = 'middle';
        });

        document.body.appendChild(div);
        return div;
    }

    async function generate() {
        const header = ExpenseManager.getHeaderData();
        const rows = ExpenseManager.getRowsData();

        if (!header.submitDate) { alert('提出日を入力してください'); return; }

        AppCore.showLoading('PDF生成中...');

        try {
            const pdfDom = _buildPdfDom(header, rows);
            pdfDom.style.left = '0';
            await new Promise(r => setTimeout(r, 150));

            const canvas = await html2canvas(pdfDom, {
                scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff'
            });
            pdfDom.style.left = '-9999px';

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('landscape', 'mm', 'a4');
            const imgData = canvas.toDataURL('image/png');
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = pdf.internal.pageSize.getHeight();
            const ratio = Math.min((pdfW - 10) / canvas.width, (pdfH - 10) / canvas.height);
            const imgX = (pdfW - canvas.width * ratio) / 2;
            pdf.addImage(imgData, 'PNG', imgX, 5, canvas.width * ratio, canvas.height * ratio);

            const dateObj = new Date(header.submitDate);
            const y = dateObj.getFullYear();
            const m = String(dateObj.getMonth() + 1).padStart(2, '0');
            const d = String(dateObj.getDate()).padStart(2, '0');
            pdf.save('交通費精算_' + y + m + d + '.pdf');

            AppCore.hideLoading();
            alert('✅ PDF出力完了！');
        } catch (err) {
            AppCore.hideLoading();
            console.error('[ExpensePdf] PDF生成エラー:', err);
            alert('PDF生成に失敗しました:\n' + err.message);
        } finally {
            const el = document.getElementById('expPdfContent');
            if (el) el.remove();
        }
    }

    function _esc(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return { generate };
})();
