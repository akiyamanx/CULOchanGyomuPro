// 同じ場所の区間・遠回りICの警告・結果表示。データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const HS = require('../map/highway-segments.js');
const ukishima = { name: '浮島IC', lat: 35.51984, lng: 139.78892 };
const A = { address: '架空県甲野市本町3-4-10 架空ビル35', lat: 35.667, lng: 139.745 };

test('同じ住所（全角・空白の違いも）や50m以内は同じ場所', () => {
    assert.ok(HS.samePlace(A, { address: '架空県甲野市本町３－４－１０　架空ビル35' }));
    assert.ok(HS.samePlace({ address: 'x', lat: 35.6670, lng: 139.7450 }, { address: 'y', lat: 35.6672, lng: 139.7451 }));
    assert.ok(!HS.samePlace(A, { address: '架空県甲野市本町2-1-1', lat: 35.68, lng: 139.76 }));
});
test('同じ場所どうしで浮島ICを通るとかなり遠回り、通り道なら警告なし', () => {
    assert.equal(HS.detour(A, A, ukishima).warn, true);
    const home = { lat: 35.38, lng: 139.93 };
    assert.equal(HS.detour(A, home, ukishima).warn, false);
    assert.equal(HS.detour({ lat: null, lng: null }, A, ukishima), null);
});

function loadCalc(customers, order) {
    const calls = [];
    const ctx = { console, setTimeout: fn => fn(), Math, Promise, Object, JSON, Array, Error, HighwaySegments: HS,
        google: { maps: { TravelMode: { DRIVING: 'D' }, DirectionsService: function () {
            this.route = (req, cb) => { calls.push(req); cb({ routes: [{ legs: [{ distance: { value: 10000, text: '' }, duration: { value: 600, text: '10分' }, steps: [] }] }] }, 'OK'); };
        } } },
        ExpenseImport: { normalizeDate: d => d },
        DataStorage: { getRoutes: () => [{ id: 'r1', order }], getCustomers: () => customers,
            getSettings: () => ({ homeAddress: '架空県乙川市2' }), getGeoCache: () => ({ '架空県乙川市2': { lat: 35.38, lng: 139.93 } }) },
        module: { exports: {} } };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../map/distance-calc.js'), 'utf8'), ctx);
    return { calc: ctx.module.exports, calls };
}
test('同じ場所の区間は0kmで、途中から高速を選んでいても道路を呼ばない', async () => {
    const cs = ['c1', 'c2', 'c3'].map(id => ({ id, routeId: 'r1', address: A.address, lat: A.lat, lng: A.lng, appoDate: '2026-11-04' }));
    const { calc, calls } = loadCalc(cs, ['c1', 'c2', 'c3']);
    const r = await calc.calcRouteDistance('r1', { c1_c2: 'highway', c2_c3: { type: 'hwFrom', ic: ukishima }, c3_home_end: 'highway' }, '2026-11-04');
    assert.equal(r.segments.length, 4);
    assert.equal(calls.length, 2); // 会社→c1 と c3→会社 だけ
    assert.deepEqual(JSON.parse(JSON.stringify(r.segments.slice(1, 3).map(s => [s.km, s.sameAddress, s.ignoredChoice]))), [[0, true, 'highway'], [0, true, 'hwFrom']]);
    assert.equal(r.totalKm, 20);
});
test('通り道でないICを選ぶと結果に遠回りの警告', async () => {
    const cs = [{ id: 'c1', routeId: 'r1', address: '架空県甲野市5', lat: 35.70, lng: 139.40, appoDate: '2026-11-04' }];
    const { calc } = loadCalc(cs, ['c1']);
    const r = await calc.calcRouteDistance('r1', { c1_home_end: { type: 'hwFrom', ic: { name: '架空北IC', lat: 36.3, lng: 139.6 } } }, '2026-11-04');
    assert.match(r.segments[1].detourWarn, /遠回り/);
    assert.equal(r.segments[0].detourWarn, undefined);
});
test('結果の表示は区間ごとに1回だけ（番号が重ならない）', () => {
    const ctx = vm.createContext({ console, window: {}, document: { getElementById: () => null } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../expense/expense-import.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '../map/route-manager.js'), 'utf8'), ctx);
    ctx.window.HighwaySegments = HS;
    const segs = [{ from: 'a', to: 'b', km: 42, duration: '42分', type: 'highway' }, { from: 'b', to: 'b', km: 0, duration: '0分', type: 'general', sameAddress: true, ignoredChoice: 'hwFrom' },
        { from: 'b', to: 'c', km: 30, duration: '40分', type: 'hwFrom', breakdown: '下道 5.0km ＋ 高速 25.0km（浮島ICから乗車）', detourWarn: '⚠️ 遠回り<b>' }];
    ctx.__r = { totalKm: 72, generalKm: 5, highwayKm: 67, segments: segs };
    const html = vm.runInContext('RouteManager.distanceResultHtml("ルート<3>", __r)', ctx);
    assert.deepEqual([...html.matchAll(/data-seg="(\d+)"/g)].map(m => m[1]), ['1', '2', '3']);
    assert.equal((html.match(/浮島ICから乗車/g) || []).length, 1);
    assert.match(html, /2\. 📍 0km（0分）/);
    assert.match(html, /同じ場所なので0km（この区間の道路の選択は使っていません）/);
    assert.doesNotMatch(html, /<b>'|ルート<3>|遠回り<b>/);
});
