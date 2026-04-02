// ==========================================
// CULOchan業務Pro — 駐車場利用明細PDF出力 v1.0
// このファイルは駐車場利用明細のPDF出力を担当する
// A4横向きにレシート画像を上段4枚+下段4枚で配置
// 各レシートの下に日付・訪問先・機械名・目的のテキスト情報
// 9枚以上の場合は次ページに続く
//
// 依存: app-core.js, parking-manager.js, receipt-image-utils.js, jsPDF
// ==========================================

const ParkingPdf = (() => {

    // v1.0 - PDF生成メイン
    async function generate() {
        var items = ParkingManager.getItems();
        if (!items || items.length === 0) {
            alert('駐車場利用データがありません');
            return;
        }

        // 画像があるアイテムだけ対象
        var withImage = items.filter(function(item) { return item.imageDataUrl; });
        var withoutImage = items.filter(function(item) { return !item.imageDataUrl; });

        if (withImage.length === 0 && withoutImage.length === 0) {
            alert('出力するデータがありません');
            return;
        }

        AppCore.showLoading('駐車場利用明細PDF生成中...');

        try {
            var jsPDF = window.jspdf.jsPDF;
            // A4横向き
            var pdf = new jsPDF('landscape', 'mm', 'a4');
            var pageW = pdf.internal.pageSize.getWidth(); // 297mm
            var pageH = pdf.internal.pageSize.getHeight(); // 210mm

            // レイアウト定数
            var marginX = 8;
            var marginTop = 15; // タイトル分の余白
            var cols = 4;       // 1行4枚
            var rowsPerPage = 2; // 上段・下段
            var maxPerPage = cols * rowsPerPage; // 8枚/ページ

            var cellW = (pageW - marginX * 2) / cols; // 各セルの横幅
            var availH = pageH - marginTop - 5;       // 使える縦幅
            var cellH = availH / rowsPerPage;          // 各セルの縦幅
            var textAreaH = 20; // テキスト情報エリアの高さ(mm)
            var imgMaxH = cellH - textAreaH - 4; // 画像に使える最大高さ
            var imgMaxW = cellW - 6;  // 画像に使える最大横幅
            var pad = 3; // セル内パディング

            // ページ数計算
            var totalPages = Math.ceil(withImage.length / maxPerPage);
            if (totalPages === 0) totalPages = 1;

            // 画像ありレシートをページ分割して配置
            for (var page = 0; page < totalPages; page++) {
                if (page > 0) pdf.addPage();

                // タイトル
                pdf.setFontSize(14);
                pdf.setFont('helvetica', 'bold');
                pdf.text('駐車場利用明細', pageW / 2, 10, { align: 'center' });

                var startIdx = page * maxPerPage;
                var endIdx = Math.min(startIdx + maxPerPage, withImage.length);

                for (var i = startIdx; i < endIdx; i++) {
                    var item = withImage[i];
                    var pi = i - startIdx; // ページ内インデックス
                    var col = pi % cols;
                    var row = Math.floor(pi / cols);

                    var cellX = marginX + col * cellW;
                    var cellY = marginTop + row * cellH;

                    // セル枠線（薄いグレー）
                    pdf.setDrawColor(200, 200, 200);
                    pdf.setLineWidth(0.3);
                    pdf.rect(cellX, cellY, cellW, cellH);

                    // レシート画像を配置（縦向き、上側に配置）
                    if (item.imageDataUrl) {
                        try {
                            var img = await ImageUtils.loadImage(item.imageDataUrl);
                            var ratio = Math.min(imgMaxW / img.width, imgMaxH / img.height);
                            var dw = img.width * ratio;
                            var dh = img.height * ratio;
                            // 画像はセル上部に中央配置
                            var imgX = cellX + pad + (imgMaxW - dw) / 2;
                            var imgY = cellY + pad;
                            pdf.addImage(item.imageDataUrl, 'JPEG', imgX, imgY, dw, dh);
                        } catch (imgErr) {
                            console.warn('[ParkingPdf] 画像読込エラー:', imgErr.message);
                        }
                    }

                    // テキスト情報（画像の下、セル下部に配置）
                    var textY = cellY + cellH - textAreaH;
                    pdf.setDrawColor(220, 220, 220);
                    pdf.setLineWidth(0.2);
                    pdf.line(cellX + pad, textY, cellX + cellW - pad, textY);

                    pdf.setFontSize(7);
                    pdf.setFont('helvetica', 'normal');
                    pdf.setTextColor(0, 0, 0);

                    var lineH = 4; // テキスト行間
                    var tx = cellX + pad + 1;
                    var ty = textY + lineH;

                    // 日付
                    pdf.text(_formatDate(item.date), tx, ty);
                    ty += lineH;

                    // 訪問先名
                    var visitText = item.visitCompany || '-';
                    pdf.text(visitText.substring(0, 20), tx, ty);
                    ty += lineH;

                    // 機械名
                    var machText = item.machineName || '-';
                    pdf.text(machText.substring(0, 20), tx, ty);
                    ty += lineH;

                    // 目的 + 金額
                    var purposeText = (item.purpose || '') + '  ¥' + (item.amount || 0).toLocaleString();
                    pdf.text(purposeText, tx, ty);
                }

                // ページ番号（右下）
                if (totalPages > 1) {
                    pdf.setFontSize(8);
                    pdf.setTextColor(150, 150, 150);
                    pdf.text((page + 1) + '/' + totalPages, pageW - 15, pageH - 5);
                }
            }

            // ファイル名
            var today = new Date().toISOString().split('T')[0].replace(/-/g, '');
            pdf.save('駐車場利用明細_' + today + '.pdf');

            AppCore.hideLoading();
            alert('✅ 駐車場利用明細PDF出力完了！（' + withImage.length + '枚）');
        } catch (err) {
            AppCore.hideLoading();
            console.error('[ParkingPdf] PDF生成エラー:', err);
            alert('PDF生成に失敗しました:\n' + err.message);
        }
    }

    // v1.0 - 日付フォーマット
    function _formatDate(dateStr) {
        if (!dateStr || dateStr === 'unknown') return '日付不明';
        try {
            var parts = dateStr.split('-');
            if (parts.length === 3) {
                return parts[1] + '/' + parts[2];
            }
            return dateStr;
        } catch (e) {
            return dateStr;
        }
    }

    return { generate: generate };
})();
