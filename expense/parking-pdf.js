// ==========================================
// CULOchan業務Pro — 駐車場利用明細PDF出力 v1.2
// このファイルは駐車場利用明細のPDF出力を担当する
// A4横向きにレシート画像を上段4枚+下段4枚で配置
// 各レシートの下に日付・訪問先・機械名・目的のテキスト情報
// 9枚以上の場合は次ページに続く
//
// v1.1修正:
//   - 日本語文字化け対策: テキストをCanvasで描画→画像としてPDF配置
//   - レシート画像を90度右回転して縦向きに配置
// v1.2修正:
//   - _rotateImage90を汎用化→_rotateImageByDeg(任意角度:0/90/180/270)
//   - item.rotationフィールドに応じた回転角度でPDF配置
//
// 依存: app-core.js, parking-manager.js, receipt-image-utils.js, jsPDF
// ==========================================

const ParkingPdf = (() => {

    // v1.2 - 画像を指定角度で回転するヘルパー（0/90/180/270度対応）
    // Canvasに描画して回転した画像のdataURLを返す
    // deg=0はそのまま返す（処理スキップ）
    async function _rotateImageByDeg(dataUrl, deg) {
        // 0度の場合は回転不要
        if (!deg || deg === 0) return dataUrl;
        // 正規化（0-359に収める）
        var d = ((deg % 360) + 360) % 360;
        if (d === 0) return dataUrl;

        return new Promise(function(resolve, reject) {
            var img = new Image();
            img.onload = function() {
                var canvas = document.createElement('canvas');
                // 90度/270度は幅と高さが入れ替わる
                if (d === 90 || d === 270) {
                    canvas.width = img.height;
                    canvas.height = img.width;
                } else {
                    canvas.width = img.width;
                    canvas.height = img.height;
                }
                var ctx = canvas.getContext('2d');
                // Canvas中心に移動→回転→描画位置補正
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.rotate(d * Math.PI / 180);
                ctx.drawImage(img, -img.width / 2, -img.height / 2);
                resolve(canvas.toDataURL('image/jpeg', 0.92));
            };
            img.onerror = function() { resolve(dataUrl); }; // 失敗時は元画像
            img.src = dataUrl;
        });
    }

    // v1.1 - テキストをCanvas画像として描画するヘルパー
    // jsPDFのデフォルトフォントは日本語非対応なのでCanvasで描画して画像化
    function _textToImage(lines, cellW_px) {
        var lineH = 18; // 1行の高さ(px)
        var padX = 6;
        var height = lines.length * lineH + 8;
        var canvas = document.createElement('canvas');
        canvas.width = cellW_px;
        canvas.height = height;
        var ctx = canvas.getContext('2d');
        // 背景は白
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // テキスト描画
        ctx.fillStyle = '#333333';
        ctx.font = '13px "Hiragino Kaku Gothic ProN", "MS Gothic", sans-serif';
        ctx.textBaseline = 'top';
        for (var i = 0; i < lines.length; i++) {
            ctx.fillText(lines[i], padX, 4 + i * lineH);
        }
        return canvas.toDataURL('image/png');
    }

    // v1.1 - タイトルをCanvas画像として描画
    function _titleToImage(text, width_px) {
        var canvas = document.createElement('canvas');
        canvas.width = width_px;
        canvas.height = 36;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 22px "Hiragino Kaku Gothic ProN", "MS Gothic", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, canvas.width / 2, canvas.height / 2);
        return canvas.toDataURL('image/png');
    }

    // v1.1 - PDF生成メイン（日本語対応＋回転対応版）
    async function generate() {
        var items = ParkingManager.getItems();
        if (!items || items.length === 0) {
            alert('駐車場利用データがありません');
            return;
        }

        // 画像があるアイテムだけ対象
        var withImage = items.filter(function(item) { return item.imageDataUrl; });
        if (withImage.length === 0) {
            alert('レシート画像があるデータがありません');
            return;
        }

        AppCore.showLoading('駐車場利用明細PDF生成中...');

        try {
            var jsPDF = window.jspdf.jsPDF;
            // A4横向き
            var pdf = new jsPDF('landscape', 'mm', 'a4');
            var pageW = pdf.internal.pageSize.getWidth();  // 297mm
            var pageH = pdf.internal.pageSize.getHeight(); // 210mm

            // レイアウト定数
            var marginX = 8;
            var marginTop = 18; // タイトル分の余白
            var cols = 4;
            var rowsPerPage = 2;
            var maxPerPage = cols * rowsPerPage; // 8枚/ページ

            var cellW = (pageW - marginX * 2) / cols;
            var availH = pageH - marginTop - 5;
            var cellH = availH / rowsPerPage;
            var textAreaH = 22; // テキスト情報エリア(mm)
            var imgMaxH = cellH - textAreaH - 4;
            var imgMaxW = cellW - 6;
            var pad = 3;

            // Canvas用のpx変換（300dpi想定、1mm≒3.78px → 簡易で×3）
            var cellW_px = Math.floor(cellW * 3);

            // ページ数計算
            var totalPages = Math.ceil(withImage.length / maxPerPage);

            for (var page = 0; page < totalPages; page++) {
                if (page > 0) pdf.addPage();

                // v1.1 - タイトルをCanvas画像で描画（日本語対応）
                var titleImg = _titleToImage('駐車場利用明細', Math.floor(pageW * 3));
                pdf.addImage(titleImg, 'PNG', 0, 2, pageW, 12);

                var startIdx = page * maxPerPage;
                var endIdx = Math.min(startIdx + maxPerPage, withImage.length);

                for (var i = startIdx; i < endIdx; i++) {
                    var item = withImage[i];
                    var pi = i - startIdx;
                    var col = pi % cols;
                    var row = Math.floor(pi / cols);

                    var cellX = marginX + col * cellW;
                    var cellY = marginTop + row * cellH;

                    // セル枠線
                    pdf.setDrawColor(200, 200, 200);
                    pdf.setLineWidth(0.3);
                    pdf.rect(cellX, cellY, cellW, cellH);

                    // v1.2 - レシート画像をitem.rotationの角度で回転して配置
                    if (item.imageDataUrl) {
                        try {
                            AppCore.showLoading('画像処理中... (' + (i + 1) + '/' + withImage.length + ')');
                            var rotDeg = item.rotation || 0;
                            var rotatedDataUrl = await _rotateImageByDeg(item.imageDataUrl, rotDeg);
                            var img = await ImageUtils.loadImage(rotatedDataUrl);
                            var ratio = Math.min(imgMaxW / img.width, imgMaxH / img.height);
                            var dw = img.width * ratio;
                            var dh = img.height * ratio;
                            var imgX = cellX + pad + (imgMaxW - dw) / 2;
                            var imgY = cellY + pad;
                            pdf.addImage(rotatedDataUrl, 'JPEG', imgX, imgY, dw, dh);
                        } catch (imgErr) {
                            console.warn('[ParkingPdf] 画像処理エラー:', imgErr.message);
                        }
                    }

                    // v1.1 - テキスト情報をCanvas画像で描画（日本語対応）
                    var textLines = [
                        _formatDate(item.date),
                        item.visitCompany || '-',
                        item.machineName || '-',
                        (item.purpose || '') + '  ¥' + (item.amount || 0).toLocaleString()
                    ];
                    var textImg = _textToImage(textLines, cellW_px);
                    var textY = cellY + cellH - textAreaH;
                    // 区切り線
                    pdf.setDrawColor(220, 220, 220);
                    pdf.setLineWidth(0.2);
                    pdf.line(cellX + pad, textY, cellX + cellW - pad, textY);
                    // テキスト画像を配置
                    pdf.addImage(textImg, 'PNG', cellX + 1, textY + 0.5, cellW - 2, textAreaH - 1);
                }

                // ページ番号
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
            if (parts.length === 3) return parts[1] + '/' + parts[2];
            return dateStr;
        } catch (e) { return dateStr; }
    }

    return { generate: generate };
})();
