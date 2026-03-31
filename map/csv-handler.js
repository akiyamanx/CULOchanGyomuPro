// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.5 - csv-handler.js
// CSV/Excelアップロード・パース・同一住所まとめ
// v2.0新規作成 - 分割ファイル構成対応
// v2.2.1変更 - 営業所・型式・フィルター・都道府県の検出追加
// v2.2.2変更 - ヘッダー行自動検出改善、mapキー名をequipTypeに統一
// v2.2.4修正 - 「設置先TEL」が会社名列に誤判定される問題を修正
//              電話・担当者・備考を先にチェックする判定順序に変更
// v2.5追加 - 目的(purpose)列の自動検出対応
// ============================================

const CsvHandler = (() => {

    // v2.0 - ファイル読み込みハンドラー
    function handleFile(event) {
        const file = event.target.files[0];
        if (!file) return;

        const ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'csv') {
            readCSV(file);
        } else if (ext === 'xlsx' || ext === 'xls') {
            if (typeof XLSX === "undefined") { alert("⚠️ SheetJSライブラリが読み込まれていません。ページをリロードしてください。"); return; } readExcel(file);
        } else {
            alert('CSV, XLSX, XLS ファイルを選択してください。');
        }
        event.target.value = '';
    }

    // v2.0 - CSV読み込み
    function readCSV(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const text = e.target.result;
            const rows = parseCSV(text);
            processRows(rows);
        };
        reader.readAsText(file, 'UTF-8');
    }

    // v2.0 - CSVパース（カンマ区切り、ダブルクォート対応）
    function parseCSV(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const rows = [];
        for (const line of lines) {
            const cols = [];
            let current = '';
            let inQuotes = false;
            for (let i = 0; i < line.length; i++) {
                const ch = line[i];
                if (ch === '"') {
                    inQuotes = !inQuotes;
                } else if (ch === ',' && !inQuotes) {
                    cols.push(current.trim());
                    current = '';
                } else {
                    current += ch;
                }
            }
            cols.push(current.trim());
            rows.push(cols);
        }
        return rows;
    }

    // v2.0 - Excel読み込み（SheetJS/xlsx使用）
    function readExcel(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                processRows(rows);
            } catch (err) {
                alert('❌ Excel読込エラー: ' + err.message);
                console.error('Excel読込エラー:', err);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    // v2.0 - 行データを顧客データに変換
    function processRows(rows) {
        if (rows.length < 2) {
            alert('データが見つかりません。');
            return;
        }

        // v2.2.2改善 - ヘッダー行を自動検出（「会社」「住所」「設置先」を含む行を探す）
        let headerRowIdx = 0;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
            const currentRow = rows[i] || []; const rowStr = currentRow.map(c => String(c || '')).join('').toLowerCase();
            if (rowStr.includes('会社') || rowStr.includes('設置先') || rowStr.includes('住所')) {
                headerRowIdx = i;
                break;
            }
        }

        const header = rows[headerRowIdx].map(h => String(h || '').trim());
        const colMap = detectColumns(header);

        if (colMap.company === -1 && colMap.address === -1) {
            alert('会社名または住所の列が見つかりません。');
            return;
        }

        const dataRows = rows.slice(headerRowIdx + 1).filter(r => r.length > 1 && r.some(c => c));
        const newCustomers = [];

        for (const row of dataRows) {
            const company = colMap.company >= 0 ? String(row[colMap.company] || '').trim() : '';
            // v2.2.2変更 - 都道府県と住所を結合
            let address = colMap.address >= 0 ? String(row[colMap.address] || '').trim() : '';
            if (colMap.prefecture >= 0) {
                const pref = String(row[colMap.prefecture] || '').trim();
                if (pref && address && !address.startsWith(pref)) {
                    address = pref + address;
                }
            }

            if (!company && !address) continue;

            const customer = {
                company: company,
                address: address,
                phone: colMap.phone >= 0 ? String(row[colMap.phone] || '').trim() : '',
                contact: colMap.contact >= 0 ? String(row[colMap.contact] || '').trim() : '',
                note: colMap.note >= 0 ? String(row[colMap.note] || '').trim() : '',
                managementNo: colMap.managementNo >= 0 ? String(row[colMap.managementNo] || '').trim() : '',
                // v2.2.2変更 - 営業所・型式・交換フィルター
                branch: colMap.branch >= 0 ? String(row[colMap.branch] || '').trim() : '',
                equipType: colMap.equipType >= 0 ? String(row[colMap.equipType] || '').trim() : '',
                filter: colMap.filter >= 0 ? String(row[colMap.filter] || '').trim() : '',
                // v2.5追加 - 目的
                purpose: colMap.purpose >= 0 ? String(row[colMap.purpose] || '').trim() : ''
            };
            newCustomers.push(customer);
        }

        if (newCustomers.length === 0) {
            alert('有効なデータが見つかりません。');
            return;
        }

        // v2.0 - 同一住所をまとめる処理
        const grouped = groupByAddress(newCustomers);

        // v2.0 - データを保存してジオコーディング開始
        const existing = DataStorage.getCustomers();
        for (const item of grouped) {
            DataStorage.addCustomer(item);
        }

        alert(`✅ ${grouped.length}件のデータを読み込みました！\n（元データ: ${newCustomers.length}件、同一住所まとめ後: ${grouped.length}件）`);

        // v2.0 - 地図にマーカー追加
        if (typeof MapCore !== 'undefined') {
            MapCore.geocodeAndPlot(grouped);
        }
    }

    // v2.2.4修正 - ヘッダーからカラム位置を自動検出
    // 判定順序を変更: 電話・担当者・備考を先にチェック（「設置先TEL」誤判定対策）
    function detectColumns(header) {
        const map = {
            company: -1,
            address: -1,
            phone: -1,
            contact: -1,
            note: -1,
            managementNo: -1,
            prefecture: -1,
            branch: -1,
            equipType: -1,
            filter: -1,
            purpose: -1
        };

        for (let i = 0; i < header.length; i++) {
            const h = (header[i] || '').toLowerCase();

            // v2.2.4修正 - 電話を最優先でチェック（「設置先TEL」対策）
            if (h.includes('電話') || h.includes('tel') || h.includes('phone')) {
                if (map.phone === -1) map.phone = i;
            }
            // v2.2.4修正 - 担当者も先にチェック（「受付担当者」対策）
            else if (h.includes('担当') || h.includes('contact') || h.includes('受付')) {
                if (map.contact === -1) map.contact = i;
            }
            // v2.2.4修正 - 備考・情報も先にチェック（「設置先情報」対策）
            else if (h.includes('備考') || h.includes('情報') || h.includes('note') || h.includes('memo')) {
                if (map.note === -1) map.note = i;
            }
            // 会社名（上の条件に引っかからなかった「設置先」がここに来る）
            else if (h.includes('会社') || h.includes('設置先') || h.includes('名称') || h.includes('company')) {
                if (map.company === -1) map.company = i;
            }
            // 住所
            else if (h.includes('住所') || h.includes('address') || h.includes('所在地')) {
                if (map.address === -1) map.address = i;
            }
            // 管理番号
            else if (h.includes('管理') || h.includes('管理no') || h.includes('u管理')) {
                if (map.managementNo === -1) map.managementNo = i;
            }

            // v2.2.2変更 - 都道府県（独立if文で判定）
            if (map.prefecture === -1 && (h.includes('都道府県') || h.includes('prefecture'))) {
                map.prefecture = i;
            }
            // v2.2.2変更 - 営業所
            if (map.branch === -1 && (h.includes('営業所') || h.includes('支店') || h.includes('branch'))) {
                map.branch = i;
            }
            // v2.2.2変更 - 型式（「型式」にマッチ、「交換機種」は除外）
            if (map.equipType === -1 && (h === '型式' || h.includes('型式')) && !h.includes('交換')) {
                map.equipType = i;
            }
            // v2.2.2変更 - 交換フィルター
            if (map.filter === -1 && (h.includes('フィルター') || h.includes('交換フィルター') || h.includes('filter'))) {
                map.filter = i;
            }
            // v2.5追加 - 目的（メンテナンス/修理/本体設置/その他）
            if (map.purpose === -1 && (h.includes('目的') || h.includes('purpose') || h.includes('作業内容'))) {
                map.purpose = i;
            }
        }

        // v2.0 - カラムが見つからない場合、位置ベースで推定
        if (map.company === -1 && map.address === -1 && header.length >= 3) {
            map.managementNo = 0;
            map.company = 1;
            map.address = 2;
            if (header.length >= 4) map.phone = 3;
            if (header.length >= 5) map.contact = 4;
            if (header.length >= 6) map.note = 5;
        }

        return map;
    }

    // v2.0 - 同一住所のデータをまとめる
    function groupByAddress(customers) {
        const addressMap = {};

        for (const c of customers) {
            // v2.0 - 住所を正規化（全角→半角、スペース除去）
            const normalizedAddr = normalizeAddress(c.address);

            if (addressMap[normalizedAddr]) {
                // v2.0 - 同一住所に追加 → 台数カウント
                const existing = addressMap[normalizedAddr];
                existing.unitCount = (existing.unitCount || 1) + 1;
                // v2.0 - 会社名が異なる場合はメモに追記
                if (existing.company !== c.company) {
                    existing.note = (existing.note ? existing.note + '\n' : '') + `[${c.company}] ${c.note || ''}`;
                } else {
                    if (c.note) {
                        existing.note = (existing.note ? existing.note + '\n' : '') + c.note;
                    }
                }
            } else {
                addressMap[normalizedAddr] = { ...c, unitCount: 1 };
            }
        }

        return Object.values(addressMap);
    }

    // v2.0 - 住所正規化
    function normalizeAddress(address) {
        if (!address) return '';
        return address
            .replace(/\s+/g, '')
            .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
            .replace(/[ー−‐]/g, '-')
            .replace(/　/g, '');
    }

    // v2.0 - 公開API
    return { handleFile, processRows, groupByAddress };
})();