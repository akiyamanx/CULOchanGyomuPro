// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.1 - expense-pdf.js
// 交通費精算書PDF生成モジュール（11列テーブル）
// v2.1新規作成 - expense-form.jsから分離
// html2canvas + jsPDF で精算書テーブルを再現
// ============================================

const MapExpensePdf = (() => {

    // v2.1 - 高速代カンマ区切りパース
    function parseHighway(value) {
        if (!value) return 0;
        return value.split(/[,、，]/).reduce(
            (sum, v) => sum + (parseInt(v.trim()) || 0), 0
        );
    }

    // v2.1 - 合計文字列フォーマット
    function fmt(v) {
        return v ? v + '円' : '';
    }

    // v2.1 - PDF生成メイン
    async function generate(formData, rowsData) {
        const loading = document.getElementById('mapLoading');
        loading.style.display = 'flex';
        document.getElementById('mapLoadingProgress').textContent = 'PDF生成中...';

        try {
            const pdfDiv = buildPdfHtml(formData, rowsData);
            document.body.appendChild(pdfDiv);
            await new Promise(r => setTimeout(r, 150));

            const canvas = await html2canvas(pdfDiv, {
                scale: 2, useCORS: true,
                logging: false, backgroundColor: '#ffffff'
            });
            document.body.removeChild(pdfDiv);

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('landscape', 'mm', 'a4');
            const imgData = canvas.toDataURL('image/png');
            const pdfW = pdf.internal.pageSize.getWidth();
            const pdfH = pdf.internal.pageSize.getHeight();
            const ratio = Math.min(
                (pdfW - 10) / canvas.width,
                (pdfH - 10) / canvas.height
            );
            const imgX = (pdfW - canvas.width * ratio) / 2;
            pdf.addImage(
                imgData, 'PNG', imgX, 5,
                canvas.width * ratio, canvas.height * ratio
            );

            const d = new Date(formData.submitDate);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const dy = String(d.getDate()).padStart(2, '0');
            pdf.save(`交通費精算_${y}${m}${dy}.pdf`);
        } catch (err) {
            console.error('PDF生成エラー:', err);
            alert('PDF生成に失敗しました: ' + err.message);
        } finally {
            loading.style.display = 'none';
        }
    }

    // v2.1 - PDF用HTML構築（11列テーブル完全再現）
    function buildPdfHtml(formData, rowsData) {
        const dateObj = new Date(formData.submitDate);
        const year = dateObj.getFullYear();
        const month = dateObj.getMonth() + 1;
        const day = dateObj.getDate();
        const dest = formData.destination.replace(/\n/g, '<br>');

        const totals = {
            gasCost: 0, highway: 0, other: 0,
            ship: 0, train: 0, air: 0, hotel: 0, all: 0
        };

        let dataRowsHtml = '';
        rowsData.forEach(rd => {
            const gas = parseInt(rd.gasCost) || 0;
            const hw = parseHighway(rd.highway);
            const other = parseInt(rd.other) || 0;
            const ship = parseInt(rd.ship) || 0;
            const train = parseInt(rd.train) || 0;
            const air = parseInt(rd.air) || 0;
            const hotel = parseInt(rd.hotel) || 0;
            const rowTotal = gas + hw + other + ship + train + air + hotel;

            totals.gasCost += gas;
            totals.highway += hw;
            totals.other += other;
            totals.ship += ship;
            totals.train += train;
            totals.air += air;
            totals.hotel += hotel;
            totals.all += rowTotal;

            let distDisp = '';
            if (rd.distance) distDisp = rd.distance + 'キロ';
            if (gas) distDisp += '\n' + gas + '円';

            let hwDisp = '';
            if (rd.highway) {
                const amounts = rd.highway.split(/[,、，]/)
                    .map(v => v.trim()).filter(v => v);
                hwDisp = amounts.map(a => parseInt(a) + '円').join('\n');
                if (rd.highwayCount) hwDisp += '\n' + rd.highwayCount + '枚';
            }

            let hotelDisp = '';
            if (hotel) {
                hotelDisp = hotel + '円';
                if (rd.hotelName) hotelDisp += '\n' + rd.hotelName;
            }

            const s = 'border:1px solid black;padding:3px 5px;'
                + 'text-align:center;vertical-align:middle;'
                + 'font-size:10px;height:50px;';

            dataRowsHtml += `<tr>
                <td style="${s}">${rd.month}</td>
                <td style="${s}">${rd.day}</td>
                <td style="${s}">${rd.transport}</td>
                <td style="${s}"><span class="cc">${distDisp}</span></td>
                <td style="${s}"><span class="cc">${hwDisp}</span></td>
                <td style="${s}">${other ? other + '円' : ''}</td>
                <td style="${s}">${ship ? ship + '円' : ''}</td>
                <td style="${s}">${train ? train + '円' : ''}</td>
                <td style="${s}">${air ? air + '円' : ''}</td>
                <td style="${s}"><span class="cc">${hotelDisp}</span></td>
                <td style="${s}">${rowTotal ? rowTotal + '円' : ''}</td>
            </tr>`;
        });

        const es = 'border:1px solid black;height:50px;';
        for (let i = rowsData.length; i < 6; i++) {
            dataRowsHtml += '<tr>' +
                `<td style="${es}"></td>`.repeat(11) + '</tr>';
        }

        const cs = 'border:1px solid black;padding:3px 5px;';
        const ch = cs + 'text-align:center;font-size:10px;';

        const div = document.createElement('div');
        div.style.cssText = `position:absolute;left:0;top:0;width:1050px;
            background:white;padding:20px 25px;z-index:9999;
            font-family:'MS Gothic','ＭＳ ゴシック',
            'Hiragino Kaku Gothic ProN',sans-serif;font-size:11px;`;

        div.innerHTML = `
            <style>.cc{white-space:pre-line;line-height:1.3;}</style>
            <div style="font-size:13px;margin-bottom:10px;">
                日本ROメンテナンスサービス株式会社　御中</div>
            <div style="text-align:center;font-size:20px;font-weight:bold;
                letter-spacing:8px;margin-bottom:12px;">
                出張費精算請求書</div>
            <table style="width:100%;border-collapse:collapse;border:1px solid black;">
                <tr style="height:20px;">
                    <td style="${cs}">提出日</td>
                    <td colspan="5" style="${cs}text-align:left;padding-left:10px;">
                        ${year}年　　${month}月　　${day}日</td>
                    <td style="${cs}">SS名</td>
                    <td colspan="2" style="${cs}">${formData.ssName}</td>
                    <td style="${cs}padding:0;height:20px;">
                        <table style="width:100%;height:100%;border-collapse:collapse;">
                        <tr><td style="border-right:1px solid black;width:50%;"></td>
                        <td style="width:50%;text-align:center;font-size:10px;">経理</td>
                        </tr></table></td>
                    <td style="${ch}">本部</td>
                </tr>
                <tr>
                    <td colspan="2" style="${cs}height:40px;text-align:center;">
                        行先<br><span style="font-size:8px;">（お客様名）</span></td>
                    <td colspan="4" style="${cs}text-align:left;padding-left:10px;">
                        ${dest}</td>
                    <td style="${cs}text-align:center;">氏名</td>
                    <td colspan="2" style="${cs}text-align:left;">
                        ${formData.employeeName}　印</td>
                    <td style="${cs}padding:0;height:40px;">
                        <table style="width:100%;height:100%;border-collapse:collapse;">
                        <tr><td style="border-right:1px solid black;width:50%;"></td>
                        <td style="width:50%;"></td></tr></table></td>
                    <td style="${cs}height:40px;"></td>
                </tr>
                <tr style="height:45px;">
                    <td style="${ch}width:40px;">月</td>
                    <td style="${ch}width:40px;">日</td>
                    <td style="${ch}width:90px;">利用交通機関</td>
                    <td style="${ch}width:70px;">走行距離</td>
                    <td style="${ch}width:60px;">高速代<br>
                        <span style="font-size:8px;">（枚数）</span></td>
                    <td style="${ch}width:70px;">その他<br>
                        <span style="font-size:8px;">（タクシー・<br>バス等）</span></td>
                    <td style="${ch}width:55px;">船賃</td>
                    <td style="${ch}width:55px;">電車賃</td>
                    <td style="${ch}width:55px;">航空賃</td>
                    <td style="${ch}width:70px;">宿泊料<br>
                        <span style="font-size:8px;">（宿泊先）</span></td>
                    <td style="${ch}width:60px;">合計</td>
                </tr>
                ${dataRowsHtml}
                <tr style="height:40px;">
                    <td colspan="2" style="${cs}text-align:center;font-weight:bold;">
                        合　　計</td>
                    <td style="${cs}"></td>
                    <td style="${ch}">${fmt(totals.gasCost)}</td>
                    <td style="${ch}">${fmt(totals.highway)}</td>
                    <td style="${ch}">${fmt(totals.other)}</td>
                    <td style="${ch}">${fmt(totals.ship)}</td>
                    <td style="${ch}">${fmt(totals.train)}</td>
                    <td style="${ch}">${fmt(totals.air)}</td>
                    <td style="${ch}">${fmt(totals.hotel)}</td>
                    <td style="${ch}font-weight:bold;">${fmt(totals.all)}</td>
                </tr>
                <tr>
                    <td colspan="11" style="${cs}height:60px;text-align:left;
                        vertical-align:top;padding:6px;">
                        <span style="font-weight:bold;">【備考欄】</span></td>
                </tr>
            </table>`;

        return div;
    }

    return { generate };
})();
