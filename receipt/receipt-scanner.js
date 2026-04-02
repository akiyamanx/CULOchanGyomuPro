// ==========================================
// CULOchan業務Pro — レシートスキャナー v1.2
// このファイルはスキャナーからのレシート取り込み・検出・AI認識を担当する
// v1.1変更: Geminiモデル名修正、エラーデバッグ強化
// v1.2追加: getRecognizedReceipts() — 駐車場明細連携用データ取得メソッド
//
// 依存: app-core.js, receipt-image-utils.js（ImageUtils）
// ==========================================

const ReceiptScanner = (() => {
    let _scanImageDataUrl = null;
    let _detectedImages = [];
    let _recognizedReceipts = [];

    // ==========================================
    // ファイル選択ハンドラ
    // ==========================================
    function handleFileSelect(event) {
        var file = event.target.files[0];
        if (!file) return;
        console.log('[Scanner] ファイル選択:', file.name, file.type);

        if (file.type === 'application/pdf') {
            alert('PDF形式は今後対応予定です。\nJPEG/PNGで保存してから取り込んでください。');
            event.target.value = '';
            return;
        }

        var reader = new FileReader();
        reader.onload = function(e) {
            _scanImageDataUrl = e.target.result;
            showScanPreview(_scanImageDataUrl);
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    }

    // ==========================================
    // プレビュー表示 / クリア
    // ==========================================
    function showScanPreview(dataUrl) {
        var el = document.getElementById('scanPreview');
        var img = document.getElementById('scanImage');
        if (el) el.style.display = 'block';
        if (img) img.src = dataUrl;
        hideDetectionResult();
        hideRecognizedList();
    }

    function clearScan() {
        _scanImageDataUrl = null;
        _detectedImages = [];
        _recognizedReceipts = [];
        var el = document.getElementById('scanPreview');
        if (el) el.style.display = 'none';
        hideDetectionResult();
        hideRecognizedList();
    }

    // ==========================================
    // レシート検出（ImageUtilsに委譲）
    // ==========================================
    async function startDetection() {
        if (!_scanImageDataUrl) {
            alert('先にスキャン画像を選択してください');
            return;
        }

        AppCore.showLoading('レシートを検出中...');
        try {
            var img = await ImageUtils.loadImage(_scanImageDataUrl);
            var canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            var gray = ImageUtils.toGrayscale(imageData.data, canvas.width, canvas.height);
            var regions = ImageUtils.detectRegionsOnWhiteBg(gray, canvas.width, canvas.height);

            if (regions.length === 0) {
                AppCore.hideLoading();
                alert('レシートが検出できませんでした。\n画像を確認してください。');
                return;
            }

            _detectedImages = [];
            for (var i = 0; i < regions.length; i++) {
                _detectedImages.push({
                    dataUrl: ImageUtils.cropRegion(canvas, regions[i]),
                    region: regions[i],
                    index: i
                });
            }

            renderDetectedReceipts(_detectedImages);
            AppCore.hideLoading();
            console.log('[Scanner] 検出完了:', _detectedImages.length + '枚');
        } catch (err) {
            AppCore.hideLoading();
            console.error('[Scanner] 検出エラー:', err);
            alert('レシート検出中にエラー:\n' + err.message);
        }
    }

    // ==========================================
    // AI認識（Gemini API）
    // ==========================================
    async function recognizeAll() {
        if (_detectedImages.length === 0) {
            alert('先にレシートを検出してください');
            return;
        }

        var apiKey = getGeminiApiKey();
        if (!apiKey) {
            alert('Gemini APIキーが未設定です。\nヘッダーの⚙️から設定してください。');
            return;
        }

        _recognizedReceipts = [];
        var failCount = 0;

        for (var i = 0; i < _detectedImages.length; i++) {
            AppCore.showLoading('AI読取中... (' + (i + 1) + '/' + _detectedImages.length + ')');
            try {
                var result = await callGeminiOcr(_detectedImages[i].dataUrl, apiKey);
                _recognizedReceipts.push({
                    imageDataUrl: _detectedImages[i].dataUrl,
                    data: result,
                    checked: true,
                    index: i
                });
            } catch (err) {
                console.warn('[Scanner] AI認識失敗 #' + (i + 1) + ':', err.message);
                failCount++;
                _recognizedReceipts.push({
                    imageDataUrl: _detectedImages[i].dataUrl,
                    data: { date: '不明', store: '読取失敗', total: 0, type: 'unknown' },
                    checked: false,
                    index: i
                });
            }
            // v1.0 - API課金安全策: 500ms間隔
            if (i < _detectedImages.length - 1) await sleep(500);
        }

        AppCore.hideLoading();
        renderRecognizedReceipts(_recognizedReceipts);

        // v1.1 - 結果サマリー表示
        var okCount = _recognizedReceipts.length - failCount;
        if (failCount > 0) {
            alert('AI読取完了\n成功: ' + okCount + '枚 / 失敗: ' + failCount + '枚');
        }
    }

    // Gemini APIキー取得
    function getGeminiApiKey() {
        var key = localStorage.getItem('gyomupro_gemini_key') || '';
        if (key) return key;
        var s = JSON.parse(localStorage.getItem('reform_app_settings') || '{}');
        return s.geminiApiKey || '';
    }

    // v1.1 - Gemini API呼び出し（モデル名修正＋デバッグ強化）
    async function callGeminiOcr(imageDataUrl, apiKey) {
        var base64 = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
        var mimeMatch = imageDataUrl.match(/^data:(image\/[a-z]+);base64,/);
        var mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

        var model = 'gemini-2.5-flash-lite';
        var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + model + ':generateContent?key=' + apiKey;

        var prompt = 'このレシート画像を読み取ってください。\n\n'
            + '以下のJSON形式のみで回答してください。説明文やマークダウンは不要です。\n\n'
            + '{"date":"YYYY-MM-DD","store":"店名","total":合計金額の数値,'
            + '"type":"種別","items":[{"name":"品名","amount":金額}]}\n\n'
            + 'typeの値: shopping（買い物）, parking（駐車場）, highway（高速道路）, other（その他）\n'
            + '日付が読めない場合はdateを"unknown"にしてください。\n'
            + '金額は数値のみ（円やカンマなし）。税込合計を使ってください。\n'
            + '小計・消費税・合計の行はitemsに含めないでください。';

        var body = {
            contents: [{ parts: [
                { inline_data: { mime_type: mimeType, data: base64 } },
                { text: prompt }
            ]}],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1024
            }
        };

        console.log('[Scanner] Gemini API呼び出し: model=' + model);

        var res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            var errText = '';
            try { errText = await res.text(); } catch (e) {}
            console.error('[Scanner] API HTTP エラー:', res.status, errText);
            throw new Error('Gemini API ' + res.status + ': ' + errText.substring(0, 200));
        }

        var data = await res.json();
        console.log('[Scanner] APIレスポンス:', JSON.stringify(data).substring(0, 300));

        var text = '';
        if (data.candidates && data.candidates[0]) {
            var candidate = data.candidates[0];
            if (candidate.content && candidate.content.parts) {
                text = candidate.content.parts.map(function(p) {
                    return p.text || '';
                }).join('');
            }
            if (candidate.finishReason === 'SAFETY') {
                console.warn('[Scanner] 安全フィルターでブロックされました');
                throw new Error('安全フィルターでブロック');
            }
        }

        if (data.error) {
            console.error('[Scanner] APIエラー:', data.error.message);
            throw new Error(data.error.message);
        }

        if (!text) {
            console.warn('[Scanner] 空のレスポンス:', JSON.stringify(data));
            throw new Error('AIからの応答が空でした');
        }

        console.log('[Scanner] AI生テキスト:', text.substring(0, 200));

        text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        var jsonStart = text.indexOf('{');
        var jsonEnd = text.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
            text = text.substring(jsonStart, jsonEnd + 1);
        }

        try {
            var parsed = JSON.parse(text);
            console.log('[Scanner] パース成功:', parsed.store, '¥' + parsed.total);
            return parsed;
        } catch (e) {
            console.error('[Scanner] JSONパース失敗:', text);
            throw new Error('JSONパース失敗: ' + text.substring(0, 100));
        }
    }

    // ==========================================
    // UI描画
    // ==========================================
    function renderDetectedReceipts(items) {
        var container = document.getElementById('detectedReceipts');
        var countEl = document.getElementById('detectedCount');
        var resultEl = document.getElementById('detectionResult');
        if (!container || !resultEl) return;

        resultEl.style.display = 'block';
        if (countEl) countEl.textContent = items.length + '枚';

        container.innerHTML = '';
        items.forEach(function(item, i) {
            var div = document.createElement('div');
            div.className = 'detected-item';
            div.innerHTML = '<img src="' + item.dataUrl + '" alt="レシート' + (i + 1) + '">'
                + '<div class="detected-item-label">レシート ' + (i + 1) + '</div>';
            container.appendChild(div);
        });
    }

    function renderRecognizedReceipts(receipts) {
        var listEl = document.getElementById('recognizedList');
        var container = document.getElementById('recognizedReceipts');
        if (!listEl || !container) return;
        listEl.style.display = 'block';

        var typeLabel = { shopping: '買い物', parking: '駐車', highway: '高速', other: 'その他' };
        container.innerHTML = '';
        receipts.forEach(function(r, i) {
            var d = r.data;
            var div = document.createElement('div');
            div.className = 'receipt-card' + (r.checked ? ' checked' : '');
            div.innerHTML = ''
                + '<input type="checkbox" class="receipt-card-check" '
                + (r.checked ? 'checked' : '')
                + ' onchange="ReceiptScanner.toggleCheck(' + i + ',this.checked)">'
                + '<img class="receipt-card-thumb" src="' + r.imageDataUrl + '">'
                + '<div class="receipt-card-info">'
                + '<div class="receipt-card-date">' + (d.date || '日付不明') + '</div>'
                + '<div class="receipt-card-store">' + (d.store || '店名不明') + '</div>'
                + '<div class="receipt-card-amount">¥' + ((d.total || 0).toLocaleString())
                + '<span class="receipt-card-type type-' + (d.type || 'other') + '">'
                + (typeLabel[d.type] || 'その他') + '</span></div></div>';
            container.appendChild(div);
        });
    }

    function hideDetectionResult() {
        var el = document.getElementById('detectionResult');
        if (el) el.style.display = 'none';
    }
    function hideRecognizedList() {
        var el = document.getElementById('recognizedList');
        if (el) el.style.display = 'none';
    }

    function toggleCheck(idx, checked) {
        if (_recognizedReceipts[idx]) _recognizedReceipts[idx].checked = checked;
        var cards = document.querySelectorAll('.receipt-card');
        if (cards[idx]) cards[idx].classList.toggle('checked', checked);
    }
    function toggleSelectAll() {
        var all = _recognizedReceipts.every(function(r) { return r.checked; });
        _recognizedReceipts.forEach(function(r) { r.checked = !all; });
        renderRecognizedReceipts(_recognizedReceipts);
    }

    // ==========================================
    // A4 PDF出力
    // ==========================================
    async function generateA4Pdf() {
        var selected = _recognizedReceipts.filter(function(r) { return r.checked; });
        if (selected.length === 0) { alert('PDFに含めるレシートを選択してください'); return; }

        AppCore.showLoading('A4 PDF生成中...');
        try {
            var jsPDF = window.jspdf.jsPDF;
            var pdf = new jsPDF('portrait', 'mm', 'a4');
            var pageW = pdf.internal.pageSize.getWidth();
            var pageH = pdf.internal.pageSize.getHeight();
            var margin = 10;
            var cols = 2;
            var maxPerPage = 8;
            var cellW = (pageW - margin * 2) / cols;
            var rows = Math.min(Math.ceil(selected.length / cols), 4);
            var cellH = (pageH - margin * 2) / rows;
            var pad = 3;

            for (var i = 0; i < selected.length; i++) {
                if (i > 0 && i % maxPerPage === 0) pdf.addPage();
                var pi = i % maxPerPage;
                var col = pi % cols;
                var row = Math.floor(pi / cols);
                var x = margin + col * cellW + pad;
                var y = margin + row * cellH + pad;
                var maxW = cellW - pad * 2;
                var maxH = cellH - pad * 2;

                var img = await ImageUtils.loadImage(selected[i].imageDataUrl);
                var ratio = Math.min(maxW / img.width, maxH / img.height);
                var dw = img.width * ratio;
                var dh = img.height * ratio;
                pdf.addImage(selected[i].imageDataUrl, 'JPEG',
                    x + (maxW - dw) / 2, y + (maxH - dh) / 2, dw, dh);
            }

            var today = new Date().toISOString().split('T')[0].replace(/-/g, '');
            pdf.save('レシート_' + today + '.pdf');
            AppCore.hideLoading();
            alert('✅ PDF出力完了！（' + selected.length + '枚）');
        } catch (err) {
            AppCore.hideLoading();
            alert('PDF生成に失敗:\n' + err.message);
        }
    }

    // ==========================================
    // 保存（Phase A簡易版 — localStorage）
    // ==========================================
    async function saveAll() {
        var toSave = _recognizedReceipts.filter(function(r) { return r.checked; });
        if (toSave.length === 0) { alert('保存するレシートを選択してください'); return; }

        var saved = JSON.parse(localStorage.getItem('gyomupro_receipts') || '[]');
        toSave.forEach(function(r) {
            saved.push({
                id: 'rcpt_' + Date.now() + '_' + r.index,
                date: r.data.date || 'unknown',
                store: r.data.store || '',
                total: r.data.total || 0,
                type: r.data.type || 'other',
                items: r.data.items || [],
                imageDataUrl: r.imageDataUrl,
                savedAt: new Date().toISOString()
            });
        });
        localStorage.setItem('gyomupro_receipts', JSON.stringify(saved));
        alert('✅ ' + toSave.length + '件保存しました！');
        renderSavedReceipts();
    }

    function renderSavedReceipts() {
        var container = document.getElementById('savedReceiptList');
        if (!container) return;
        var saved = JSON.parse(localStorage.getItem('gyomupro_receipts') || '[]');
        if (saved.length === 0) {
            container.innerHTML = '<p class="empty-msg">保存されたレシートはありません</p>';
            return;
        }
        var groups = {};
        saved.forEach(function(r) {
            var d = r.date || 'unknown';
            if (!groups[d]) groups[d] = [];
            groups[d].push(r);
        });
        var html = '';
        Object.keys(groups).sort().reverse().forEach(function(date) {
            html += '<div class="saved-date-group">'
                + '<div class="saved-date-header">📅 ' + date + '</div>';
            groups[date].forEach(function(r) {
                html += '<div class="saved-item">'
                    + '<span class="saved-item-store">' + (r.store || '不明') + '</span>'
                    + '<span class="saved-item-amount">¥' + (r.total || 0).toLocaleString() + '</span>'
                    + '</div>';
            });
            html += '</div>';
        });
        container.innerHTML = html;
    }

    // v1.2追加 - 認識済みレシートを外部に提供（駐車場明細連携用）
    function getRecognizedReceipts() {
        return _recognizedReceipts.slice();
    }

    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    document.addEventListener('DOMContentLoaded', renderSavedReceipts);

    return {
        handleFileSelect: handleFileSelect,
        clearScan: clearScan,
        startDetection: startDetection,
        recognizeAll: recognizeAll,
        toggleCheck: toggleCheck,
        toggleSelectAll: toggleSelectAll,
        generateA4Pdf: generateA4Pdf,
        saveAll: saveAll,
        getRecognizedReceipts: getRecognizedReceipts
    };
})();
