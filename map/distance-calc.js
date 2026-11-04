// [CULOchanGyomuPro統合] v1.3 2026-03-31 - maintenance-map-ap v2.5からコピー
// ============================================
// メンテナンスマップ v2.2.3 - distance-calc.js
// 走行距離計算モジュール（Directions API使用）
// v2.2新規作成
// v2.2.3変更 - segmentChoices（区間別設定）を直接受け取る
// ============================================

const DistanceCalc = (() => {
    // v2.2 - Directions APIで2点間の距離を取得する
    function getDistance(origin, destination, avoidHighways) {
        return new Promise((resolve, reject) => {
            const service = new google.maps.DirectionsService();
            service.route({
                origin: origin,
                destination: destination,
                travelMode: google.maps.TravelMode.DRIVING,
                avoidHighways: avoidHighways
            }, (result, status) => {
                if (status === 'OK' && result.routes[0]) {
                    const leg = result.routes[0].legs[0];
                    resolve({
                        distanceM: leg.distance.value,
                        distanceKm: Math.round(leg.distance.value / 1000),
                        distanceText: leg.distance.text,
                        durationSec: leg.duration.value,
                        durationText: leg.duration.text,
                        roadText: (leg.steps || []).map(step => step.instructions || '').join(' ')
                    });
                } else {
                    reject(new Error('Directions API error: ' + status));
                }
            });
        });
    }

    // v2.2.3変更 - ルート全体の走行距離を計算する
    // 第2引数: segmentChoices = { "fromId_toId": "general"|"highway", ... }
    async function calcRouteDistance(routeId, segmentChoices, date) {
        const routes = DataStorage.getRoutes();
        const route = routes.find(r => r.id === routeId);
        if (!route) throw new Error('ルートが見つかりません');

        const customers = DataStorage.getCustomers();
        const members = customers.filter(c => c.routeId === routeId && (!date || ExpenseImport.normalizeDate(c.appoDate) === date));
        if (members.length === 0) throw new Error('ルートにメンバーがいません');

        // 訪問順で並べ替え
        const ordered = [];
        if (route.order && route.order.length > 0) {
            for (const cid of route.order) {
                const found = members.find(m => m.id === cid);
                if (found) ordered.push(found);
            }
            for (const m of members) {
                if (!ordered.find(o => o.id === m.id)) ordered.push(m);
            }
        } else {
            ordered.push(...members);
        }

        // 会社住所を取得（既存の保存キーhomeAddressを引き続き使用）
        const settings = DataStorage.getSettings();
        const homeAddress = settings.homeAddress;
        if (!homeAddress) throw new Error('設定で会社住所（出発・帰着）を登録してください');

        // v2.2.3 - segmentChoicesが渡されなかった場合のフォールバック
        const choices = segmentChoices || {};

        // 全ポイントリスト: 会社 → 各顧客 → 会社
        const points = [];
        points.push({ address: homeAddress, id: 'home_start' });
        ordered.forEach(m => points.push({ address: m.address, id: m.id }));
        points.push({ address: homeAddress, id: 'home_end' });

        // 区間ごとに距離計算（途中から／途中まで高速はICで2つに分けて合計する）
        const HS = (typeof HighwaySegments !== 'undefined') ? HighwaySegments : null;
        let totalKm = 0;
        let highwayKm = 0;
        let generalKm = 0;
        const segments = [];
        let calls = 0;

        for (let i = 0; i < points.length - 1; i++) {
            const from = points[i];
            const to = points[i + 1];
            const segKey = `${from.id}_${to.id}`;
            const raw = choices[segKey] || 'general';
            const choice = HS ? HS.normalize(raw) : { type: raw === 'highway' ? 'highway' : 'general', ic: null };
            const legs = HS ? HS.planLegs(from.address, to.address, choice)
                : [{ origin: from.address, destination: to.address, avoidHighways: choice.type === 'general', part: choice.type }];
            const segType = choice.type;
            const base = { from: from.address.substring(0, 20), to: to.address.substring(0, 20), type: segType };
            try {
                const results = [];
                for (const leg of legs) {
                    // Directions API呼び出し（レート制限対策で500ms間隔）
                    if (calls++ > 0) await sleep(500);
                    const r = await getDistance(leg.origin, leg.destination, leg.avoidHighways);
                    results.push({ part: leg.part, meters: r.distanceM, r });
                }
                const c = HS ? HS.compose(results)
                    : { km: results[0].r.distanceKm, generalKm: segType === 'general' ? results[0].r.distanceKm : 0, highwayKm: segType === 'general' ? 0 : results[0].r.distanceKm };
                const durSec = results.reduce((t, x) => t + (x.r.durationSec || 0), 0);
                const seg = Object.assign(base, {
                    km: c.km, generalKm: c.generalKm, highwayKm: c.highwayKm, generalM: c.generalM, highwayM: c.highwayM,
                    duration: results.length > 1 ? Math.round(durSec / 60) + '分' : results[0].r.durationText,
                    roadText: results.map(x => x.r.roadText).join(' '),
                    ic: choice.ic ? choice.ic.name : undefined
                });
                if (HS) seg.breakdown = HS.breakdown(Object.assign({ choice }, c));
                segments.push(seg);
                totalKm += c.km;
                highwayKm += c.highwayKm;
                generalKm += c.generalKm;
            } catch (err) {
                console.warn(`区間距離計算失敗: ${from.address} → ${to.address}`, err);
                segments.push(Object.assign(base, { km: 0, duration: '計算失敗', error: true }));
            }
        }

        if (segments.some(segment => segment.error)) {
            throw new Error('距離を計算できない区間があります。住所と道路設定を確認してください（精算書には反映していません）');
        }
        return { totalKm, highwayKm, generalKm, segments };
    }

    // v2.2 - 待機関数
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    return { getDistance, calcRouteDistance };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = DistanceCalc;
