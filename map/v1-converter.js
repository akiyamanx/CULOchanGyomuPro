// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.3 - v1-converter.js
// v1.0→v2.0バックアップデータ変換
// v2.3でdata-storage.jsから分離（500行ルール対応）
// ============================================

// v2.0.1追加 - v1.0→v2.0データ変換
function convertV1toV2(v1Data) {
    const customers = [];
    const routes = DataStorage.getRoutes();

    for (const item of v1Data.data) {
        // v2.0.1 - v1.0のrouteId(数値0-10)→v2.0のrouteId(文字列)に変換
        let routeId = null;
        if (item.routeId && item.routeId > 0 && item.routeId <= 10) {
            routeId = 'route_' + item.routeId;
        }

        // v2.0.1 - ステータス判定
        let status = 'pending';
        if (item.appointmentDate) status = 'appointed';

        // v2.0.1 - アポ日時の統合
        let appoDate = null;
        if (item.appointmentDate) {
            appoDate = item.appointmentDate;
            if (item.appointmentTime) {
                appoDate += 'T' + item.appointmentTime;
            }
        }

        // v2.0.1 - 台数
        const unitCount = item.count || (item.allItems ? item.allItems.length : 1);

        // v2.0.1 - 階数情報をメモに含める
        let note = item.note || '';
        if (item.floors && item.floors.length > 0 && !note.includes('階')) {
            note = '【階数】' + item.floors.join(', ') + (note ? '\n' + note : '');
        }

        const customer = {
            id: item.id || 'c_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            company: item.displayName || item.company || '',
            address: item.originalAddress || item.address || '',
            phone: item.phone || '',
            contact: item.contact || '',
            note: note,
            managementNo: item.no || '',
            model: item.model || '',
            reason: item.reason || '',
            info: item.info || '',
            routeId: routeId,
            status: status,
            appoDate: appoDate,
            unitCount: unitCount,
            lat: item.position ? item.position.lat : null,
            lng: item.position ? item.position.lng : null,
            floors: item.floors || [],
            allItems: item.allItems || [],
            createdAt: v1Data.exportDate || new Date().toISOString()
        };

        customers.push(customer);
    }

    return { customers };
}
