// ==========================================
// CULOchan業務Pro — レシートスキャナー v1.6
// このファイルはスキャナーからのレシート取り込み・検出・AI認識を担当する
// v1.1変更: Geminiモデル名修正、エラーデバッグ強化
// v1.2追加: getRecognizedReceipts() — 駐車場明細連携用データ取得メソッド
// v1.3追加: 保存済みレシートの削除機能＋重複保存防止
// v1.4改修: チェックボックス式削除UI（誤削除防止の3ステップ削除）
// v1.5追加: Phase G — Gemini OCRプロンプトにaddress/enterTime読み取り追加
//
// v1.6追加: 読取失敗時の手入力・修正・写真付き駐車場連携
// 依存: app-core.js, receipt-image-utils.js（ImageUtils）
// ==========================================

const ReceiptScanner = (() => {
    let _scanImageDataUrl = null;
    let _detectedImages = [];
    let _recognizedReceipts = [];
    let _reading = false;
    let _deleteMode = false; // v1.4追加 - 削除モードフラグ

    function handleFileSelect(event) {
        var file = event.target.files[0];
        if (!file || _reading) return;
        if (!mayReplace()) { event.target.value = ''; return; }
        console.log('[Scanner] ファイル選択:', file.name, file.type);
        if (file.type === 'application/pdf') {
            alert('PDF形式は今後対応予定です。\nJPEG/PNGで保存してから取り込んでください。');
            event.target.value = '';
            return;
        }
        var reader = new FileReader();
        reader.onload = function(e) {
            _detectedImages = [];
            _recognizedReceipts = [];
            _scanImageDataUrl = e.target.result;
            showScanPreview(_scanImageDataUrl);
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    }

    function showScanPreview(dataUrl) {
        var el = document.getElementById('scanPreview');
        var img = document.getElementById('scanImage');
        if (el) el.style.display = 'block';
        if (img) img.src = dataUrl;
        hideDetectionResult();
        hideRecognizedList();
    }

    function mayReplace() {
        return !_recognizedReceipts.length || confirm('入力中のレシートを閉じますか？未保存の内容は失われます。');
    }

    function clearScan() {
        if (_reading || !mayReplace()) return;
        _scanImageDataUrl = null;
        _detectedImages = [];
        _recognizedReceipts = [];
        var el = document.getElementById('scanPreview');
        if (el) el.style.display = 'none';
        hideDetectionResult();
        hideRecognizedList();
    }

    async function startDetection() {
        if (_reading || !mayReplace()) return;
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
            _recognizedReceipts = [];
            hideRecognizedList();
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
    function normalizeData(data = {}) {
        const text = value => typeof value === 'string' && !['unknown','不明','読取失敗'].includes(value) ? value : '';
        return {...data, date: validDate(data.date) ? data.date : '', store: text(data.store),
            total: data.total !== '' && data.total != null && Number.isSafeInteger(Number(data.total)) && Number(data.total) >= 0 ? Number(data.total) : '',
            type: ['shopping','parking','highway','other'].includes(data.type) ? data.type : 'other',
            address: text(data.address), enterTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(data.enterTime || '') ? data.enterTime : ''};
    }
    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
        const date = new Date(value + 'T00:00:00Z');
        return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
    }
    function prepareManual(useWholeImage = false) {
        if (_reading) return;
        if (useWholeImage) {
            if (!_scanImageDataUrl || !mayReplace()) return;
            _detectedImages = [{dataUrl:_scanImageDataUrl,index:0}];
            _recognizedReceipts = [];
            renderDetectedReceipts(_detectedImages);
        }
        if (!_detectedImages.length) { alert('先にレシートの画像を選んでください。'); return; }
        _detectedImages.forEach((image,index) => {
            if (!_recognizedReceipts[index]) _recognizedReceipts[index] = {
                imageDataUrl:image.dataUrl, data:normalizeData(), checked:true, index, status:'manual'
            };
        });
        renderRecognizedReceipts(_recognizedReceipts);
    }
    async function recognizeAll() {
        if (_reading) return;
        if (!_detectedImages.length) { alert('先にレシートを検出してください'); return; }
        prepareManual();
        const apiKey = getGeminiApiKey();
        if (!apiKey) {
            alert('AI読取にはGemini APIキーの設定が必要です。下の入力欄から、手入力で登録できます。');
            return;
        }
        const pending = _recognizedReceipts.filter(r => !r.edited);
        if (!pending.length) { alert('手入力した内容はそのまま残しています。下の入力欄で修正できます。'); return; }
        _reading = true;
        let failCount = 0;
        try {
            for (const r of pending) {
                AppCore.showLoading('AI読取中... (' + (r.index + 1) + '/' + _detectedImages.length + ')');
                try {
                    const result = normalizeData(await callGeminiOcr(r.imageDataUrl,apiKey));
                    // An input made while the request was in flight always wins.
                    if (!r.edited) { r.data = result; r.status = 'read'; }
                } catch (err) {
                    failCount++;
                    r.status = 'failed'; // Keep photo and any previous values, never replace them with a fake ¥0.
                }
                if (r !== pending[pending.length - 1]) await sleep(500);
            }
        } finally {
            _reading = false;
            AppCore.hideLoading();
            renderRecognizedReceipts(_recognizedReceipts);
        }
        if (failCount) alert(failCount + '枚を読み取れませんでした。写真は残っています。下の欄へ日付・店名・金額・種類を入力してください。');
    }
    function updateField(index, field, value) {
        const r = _recognizedReceipts[index];
        if (!r || !['date','store','total','type','address','enterTime'].includes(field)) return;
        r.data[field] = field === 'total' && value !== '' ? Number(value) : value;
        r.edited = true;
    }
    function validateSelection(receipts) {
        for (const r of receipts) {
            const d = r.data;
            if (!validDate(d.date) || !d.store.trim() || d.total === '' || !Number.isSafeInteger(d.total) || d.total < 0
                || !['shopping','parking','highway','other'].includes(d.type)) {
                alert('レシート ' + (r.index + 1) + ' の日付・店名（駐車場名）・金額・種類を確認してください。金額は0以上の整数で入力します。');
                return false;
            }
        }
        return true;
    }
    async function sendToParking() {
        const count = await ParkingManager.importFromScanner();
        if (count >= 0) {
            ['parkingFilterMonth','parkingFilterDay'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
            ParkingManager.renderParkingList();
            WorkflowUI.openParking();
        }
    }

    function getGeminiApiKey() {
        var key = AppStorage.getItem('gyomupro_gemini_key') || '';
        if (key) return key;
        var s = JSON.parse(AppStorage.getItem('reform_app_settings') || '{}');
        return s.geminiApiKey || '';
    }

    async function callGeminiOcr(imageDataUrl, apiKey) {
        var base64 = imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
        var mimeMatch = imageDataUrl.match(/^data:(image\/[a-z]+);base64,/);
        var mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        var model = 'gemini-2.5-flash-lite';
        var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + model + ':generateContent?key=' + apiKey;
        // v1.5追加 - Phase G: 駐車場マッチング用にaddress/enterTimeを追加読み取り
        var prompt = 'このレシート画像を読み取ってください。\n\n'
            + '以下のJSON形式のみで回答してください。説明文やマークダウンは不要です。\n\n'
            + '{"date":"YYYY-MM-DD","store":"店名","total":合計金額の数値,'
            + '"type":"種別",'
            + '"address":"住所またはunknown",'
            + '"enterTime":"HH:MMまたはunknown",'
            + '"items":[{"name":"品名","amount":金額}]}\n\n'
            + 'typeの値: shopping（買い物）, parking（駐車場）, highway（高速道路）, other（その他）\n'
            + '日付が読めない場合はdateを"unknown"にしてください。\n'
            + '金額は数値のみ（円やカンマなし）。税込合計を使ってください。\n'
            + '小計・消費税・合計の行はitemsに含めないでください。\n'
            + '駐車場レシートの場合: addressは駐車場の住所（印字されていれば）、enterTimeは入庫時刻。\n'
            + 'それ以外のレシートや読めない場合はaddress・enterTimeを"unknown"にしてください。';
        var body = {
            contents: [{ parts: [
                { inline_data: { mime_type: mimeType, data: base64 } },
                { text: prompt }
            ]}],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
        };
        console.log('[Scanner] Gemini API呼び出し: model=' + model);
        var res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            throw new Error('Gemini APIへの接続に失敗しました（HTTP ' + res.status + '）。設定・通信状態を確認するか、手入力をご利用ください。');
        }
        var data = await res.json();
        var text = '';
        if (data.candidates && data.candidates[0]) {
            var candidate = data.candidates[0];
            if (candidate.content && candidate.content.parts) {
                text = candidate.content.parts.map(function(p) { return p.text || ''; }).join('');
            }
            if (candidate.finishReason === 'SAFETY') {
                throw new Error('安全フィルターでブロック');
            }
        }
        if (data.error) { throw new Error('AI読取サービスからエラーが返りました。'); }
        if (!text) { throw new Error('AIからの応答が空でした'); }
        text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        var jsonStart = text.indexOf('{');
        var jsonEnd = text.lastIndexOf('}');
        if (jsonStart >= 0 && jsonEnd > jsonStart) {
            text = text.substring(jsonStart, jsonEnd + 1);
        }
        try {
            var parsed = JSON.parse(text);
            return parsed;
        } catch (e) {
            throw new Error('AIの読取結果を解釈できませんでした。');
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
            div.innerHTML = '<img src="' + _escHtml(item.dataUrl) + '" alt="レシート' + (i + 1) + '">'
                + '<div class="detected-item-label">レシート ' + (i + 1) + '</div>';
            container.appendChild(div);
        });
    }

    function renderRecognizedReceipts(receipts) {
        const listEl = document.getElementById('recognizedList');
        const container = document.getElementById('recognizedReceipts');
        if (!listEl || !container) return;
        listEl.style.display = 'block';
        container.innerHTML = '';
        receipts.forEach((r,i) => {
            const d = r.data;
            const div = document.createElement('div');
            div.className = 'receipt-card receipt-edit-card' + (r.checked ? ' checked' : '');
            div.dataset.index = i;
            const field = (name,label,type='text',extra='') => '<label>' + label + '<input type="' + type
                + '" data-field="' + name + '" value="' + _escHtml(d[name]) + '" ' + extra + '></label>';
            div.innerHTML = '<div class="receipt-edit-heading"><label><input type="checkbox" class="receipt-card-check" data-select '
                + (r.checked ? 'checked' : '') + '> レシート ' + (i+1) + '</label><span class="receipt-edit-status">'
                + (r.status === 'failed' ? '読取失敗・手入力できます' : r.edited ? '手入力・修正済み' : r.status === 'read' ? '読取内容を確認' : '手入力できます') + '</span></div>'
                + '<img class="receipt-edit-photo" src="' + _escHtml(r.imageDataUrl) + '" alt="レシート ' + (i+1) + ' の写真">'
                + '<div class="receipt-edit-fields">'
                + field('date','利用日','date','required')
                + field('store','店名・駐車場名','text','required maxlength="200"')
                + field('total','金額（円）','number','min="0" step="1" inputmode="numeric" required')
                + '<label>種類<select data-field="type">'
                + Object.entries({other:'その他',parking:'駐車場',shopping:'買い物',highway:'高速道路'}).map(([value,label]) => '<option value="' + value + '"' + (d.type === value ? ' selected' : '') + '>' + label + '</option>').join('')
                + '</select></label></div><details class="receipt-edit-optional"><summary>住所・入庫時刻（任意）</summary><div class="receipt-edit-fields">'
                + field('address','駐車場の住所','text','maxlength="300"') + field('enterTime','入庫時刻','time') + '</div></details>';
            container.appendChild(div);
        });
        const capture = event => {
            const card = event.target.closest('[data-index]');
            if (!card) return;
            if (event.target.hasAttribute('data-select')) toggleCheck(Number(card.dataset.index),event.target.checked);
            else if (event.target.dataset.field) {
                updateField(Number(card.dataset.index),event.target.dataset.field,event.target.value);
                card.querySelector('.receipt-edit-status').textContent = '手入力・修正済み';
            }
        };
        container.oninput = capture;
        container.onchange = capture;
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
    // 保存済みレシートの読み込み。読めないときは例外にして、壊れたデータを空配列で上書きしない。
    function readSaved() {
        const raw = AppStorage.getItem('gyomupro_receipts');
        if (!raw) return [];
        const value = JSON.parse(raw);
        if (!Array.isArray(value)) throw new Error('保存済みレシートの形式を確認できません');
        return value;
    }
    function isQuotaError(error) {
        return !!error && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22 || error.code === 1014);
    }

    // v1.3改修 - 保存（重複チェック付き）
    // ==========================================
    async function saveAll() {
        const selected = _recognizedReceipts.filter(r => r.checked);
        if (!selected.length) { alert('保存するレシートを選択してください'); return; }
        if (!validateSelection(selected)) return;
        try {
            const saved = readSaved();
            const ids = [];
            selected.forEach(r => {
                const index = saved.findIndex(existing => r.savedId ? existing.id === r.savedId : existing.imageDataUrl === r.imageDataUrl);
                const old = index >= 0 ? saved[index] : {};
                const id = old.id || 'rcpt_' + Date.now() + '_' + Math.random().toString(36).slice(2,9);
                const record = {...old,...r.data,id,imageDataUrl:r.imageDataUrl,savedAt:new Date().toISOString()};
                if (index >= 0) saved[index] = record; else saved.push(record);
                ids.push(id);
            });
            AppStorage.setItem('gyomupro_receipts',JSON.stringify(saved));
            selected.forEach((r,i) => { r.savedId = ids[i]; });
            renderSavedReceipts();
            alert('✅ ' + selected.length + '件の内容と写真を保存しました。');
        } catch (error) {
            if (isQuotaError(error)) alert('ブラウザの保存容量がいっぱいで、保存できませんでした。保存済みレシートを減らすか、「駐車場へ送る」（写真は別の保存領域に入ります）を使ってください。入力内容と写真はこの画面に残っています。既に保存したレシートは変わっていません。');
            else alert('保存できませんでした。入力内容と写真はこの画面に残っています。ブラウザの空き容量・保存設定を確認してください。保存済みのデータは上書きしていません。');
        }
    }

    // ==========================================
    // v1.4改修 - 保存済みレシート表示（チェックボックス式削除UI）
    // 通常モード: ✕ボタンなし、下部に🗑️削除ボタン
    // 削除モード: 各行にチェックボックス＋「選択を削除」「キャンセル」
    // ==========================================
    function renderSavedReceipts() {
        var container = document.getElementById('savedReceiptList');
        if (!container) return;
        var saved;
        try { saved = readSaved(); }
        catch (error) {
            container.textContent = '保存済みレシートを読み込めません。データは上書きせず残しています。再読み込みしてもこの表示が続く場合は、バックアップから確認してください。';
            _deleteMode = false;
            return;
        }
        if (saved.length === 0) {
            container.innerHTML = '<p class="empty-msg">保存されたレシートはありません</p>';
            _deleteMode = false;
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
                + '<div class="saved-date-header">📅 ' + _escHtml(date) + '</div>';
            groups[date].forEach(function(r) {
                html += '<div class="saved-item">';
                // v1.4 - 削除モード時のみチェックボックス表示
                if (_deleteMode) {
                    html += '<input type="checkbox" class="saved-del-check" '
                        + 'data-id="' + _escHtml(r.id) + '">';
                }
                html += '<span class="saved-item-store">' + _escHtml(r.store || '不明') + '</span>'
                    + '<span class="saved-item-amount">¥' + _escHtml((Number(r.total) || 0).toLocaleString()) + '</span>'
                    + (!_deleteMode ? '<button class="btn-small saved-open" data-open-receipt="' + _escHtml(r.id) + '">開く・修正</button>' : '')
                    + '</div>';
            });
            html += '</div>';
        });
        // v1.4 - 下部ボタン（モードで切替）
        html += '<div class="saved-btn-bar">';
        if (_deleteMode) {
            html += '<button class="btn-small saved-btn-cancel" '
                + 'onclick="ReceiptScanner.cancelDeleteMode()">キャンセル</button>'
                + '<button class="btn-small saved-btn-exec" '
                + 'onclick="ReceiptScanner.executeDelete()">🗑️ 選択を削除</button>';
        } else {
            html += '<button class="btn-small saved-btn-del" '
                + 'onclick="ReceiptScanner.enterDeleteMode()">🗑️ 削除</button>';
        }
        html += '</div>';
        container.innerHTML = html;
        container.onclick = event => { const button = event.target.closest('[data-open-receipt]'); if (button) openSaved(button.dataset.openReceipt); };
    }

    function openSaved(id) {
        if (_reading || !mayReplace()) return;
        try {
            const saved = readSaved();
            const receipt = saved.find(r => r.id === id);
            if (!receipt) throw new Error('保存済みレシートが見つかりません。');
            if (!receipt.imageDataUrl) throw new Error('このレシートには写真が保存されていません。');
            _scanImageDataUrl = receipt.imageDataUrl;
            _detectedImages = [{dataUrl:receipt.imageDataUrl,index:0}];
            _recognizedReceipts = [{imageDataUrl:receipt.imageDataUrl,data:normalizeData(receipt),savedId:receipt.id,
                checked:true,index:0,status:'saved',edited:true}];
            showScanPreview(receipt.imageDataUrl);
            renderDetectedReceipts(_detectedImages);
            renderRecognizedReceipts(_recognizedReceipts);
            document.getElementById('recognizedList')?.scrollIntoView({block:'start'});
        } catch (error) { alert('レシートを開けませんでした。' + error.message); }
    }

    // v1.4追加 - 削除モード開始
    function enterDeleteMode() {
        _deleteMode = true;
        renderSavedReceipts();
    }

    // v1.4追加 - 削除モードキャンセル
    function cancelDeleteMode() {
        _deleteMode = false;
        renderSavedReceipts();
    }

    // v1.4追加 - チェック済みアイテムを削除実行
    function executeDelete() {
        var checks = document.querySelectorAll('.saved-del-check:checked');
        if (checks.length === 0) {
            alert('削除するレシートを選択してください');
            return;
        }
        if (!confirm(checks.length + '件のレシートを削除しますか？')) return;
        var deleteIds = [];
        checks.forEach(function(cb) { deleteIds.push(cb.getAttribute('data-id')); });
        try {
            var saved = readSaved();
            saved = saved.filter(function(r) {
                return deleteIds.indexOf(r.id) === -1;
            });
            AppStorage.setItem('gyomupro_receipts', JSON.stringify(saved));
        } catch (error) {
            alert('削除できませんでした。保存済みレシートは変更していません。');
            return;
        }
        _deleteMode = false;
        renderSavedReceipts();
    }

    // v1.3互換 - 保存済みレシートを全削除（clearAllSaved残す）
    function clearAllSaved() {
        if (!confirm('保存済みレシートを全て削除しますか？')) return;
        AppStorage.removeItem('gyomupro_receipts');
        _deleteMode = false;
        renderSavedReceipts();
    }

    function getRecognizedReceipts() {
        return _recognizedReceipts.slice();
    }

    function _escHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

    document.addEventListener('app:storage-ready', renderSavedReceipts);

    return {
        hasApiKey: () => Boolean(getGeminiApiKey()),
        readParkingImage: image => callGeminiOcr(image, getGeminiApiKey()),
        handleFileSelect: handleFileSelect,
        clearScan: clearScan,
        startDetection: startDetection,
        recognizeAll: recognizeAll,
        prepareManual, updateField, validateSelection, sendToParking,
        toggleCheck: toggleCheck,
        toggleSelectAll: toggleSelectAll,
        generateA4Pdf: generateA4Pdf,
        saveAll: saveAll,
        openSaved,
        getRecognizedReceipts: getRecognizedReceipts,
        enterDeleteMode: enterDeleteMode,     // v1.4追加
        cancelDeleteMode: cancelDeleteMode,   // v1.4追加
        executeDelete: executeDelete,         // v1.4追加
        clearAllSaved: clearAllSaved
    };
})();

