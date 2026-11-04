'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const HS = require('../map/highway-segments.js');
const IC = require('../map/ic-kanto.js');

const ukishima = { name: '浮島IC', lat: 35.51984, lng: 139.78892 };

test('古い文字列の保存値はそのまま読める（移行）', () => {
    assert.deepEqual(HS.normalize('general'), { type: 'general', ic: null });
    assert.deepEqual(HS.normalize('highway'), { type: 'highway', ic: null });
    assert.deepEqual(HS.normalize(undefined), { type: 'general', ic: null });
    assert.deepEqual(HS.normalize('toll'), { type: 'general', ic: null });
    assert.deepEqual(HS.normalize({ toll: true }), { type: 'general', ic: null });
    assert.equal(HS.toStored('highway'), 'highway');
    assert.equal(HS.toStored({ type: 'general' }), 'general');
    assert.deepEqual(HS.toStored({ type: 'hwFrom', ic: ukishima }), { type: 'hwFrom', ic: ukishima });
    assert.deepEqual(HS.normalize({ type: 'hwUntil', ic: { name: '' } }), { type: 'hwUntil', ic: null });
});

test('区間の分け方', () => {
    assert.deepEqual(HS.planLegs('A', 'B', 'general').map(l => [l.avoidHighways, l.part]), [[true, 'general']]);
    assert.deepEqual(HS.planLegs('A', 'B', 'highway').map(l => [l.avoidHighways, l.part]), [[false, 'highway']]);
    const f = HS.planLegs('A', 'B', { type: 'hwFrom', ic: ukishima });
    assert.deepEqual(f.map(l => [l.origin, l.avoidHighways, l.part]), [['A', true, 'general'], [HS.accessPoint(ukishima), false, 'highway']]);
    const u = HS.planLegs('A', 'B', { type: 'hwUntil', ic: ukishima });
    assert.deepEqual(u.map(l => [l.avoidHighways, l.part]), [[false, 'highway'], [true, 'general']]);
    assert.equal(u[1].destination, 'B');
    const noIc = HS.planLegs('A', 'B', { type: 'hwFrom' });
    assert.equal(noIc.length, 1); assert.equal(noIc[0].fallback, true); assert.equal(noIc[0].avoidHighways, false);
});

test('距離の合成：合計は整数kmで内訳の合計と一致', () => {
    const c = HS.compose([{ part: 'general', meters: 12340 }, { part: 'highway', meters: 45620 }]);
    assert.deepEqual([c.km, c.generalKm, c.highwayKm], [58, 12, 46]);
    assert.equal(HS.breakdown(Object.assign({ choice: { type: 'hwFrom', ic: ukishima } }, c)), '下道 12.3km ＋ 高速 45.6km（浮島ICから乗車）');
    assert.equal(HS.breakdown(Object.assign({ choice: { type: 'hwUntil', ic: ukishima } }, c)), '下道 12.3km ＋ 高速 45.6km（浮島ICで降車）');
    // 端数：0.5+0.5 = 1km
    const d = HS.compose([{ part: 'general', meters: 500 }, { part: 'highway', meters: 500 }]);
    assert.equal(d.km, 1); assert.equal(d.generalKm + d.highwayKm, 1);
    // 1区間だけなら従来の round(m/1000) と同じ
    assert.equal(HS.compose([{ part: 'general', meters: 23499 }]).km, 23);
});

test('近いIC・区間の近くのIC・名前検索', () => {
    assert.ok(IC.length > 200);
    assert.equal(HS.nearestIC({ lat: 35.52, lng: 139.79 }, IC).name, '浮島IC');
    const near = HS.icsNearSegment({ lat: 35.53, lng: 139.70 }, { lat: 35.38, lng: 139.93 }, IC);
    assert.ok(near.some(ic => ic.name === '浮島IC'));
    assert.ok(near.length <= 8);
    assert.deepEqual(HS.icsNearSegment(null, { lat: 1, lng: 1 }, IC), []);
    assert.ok(HS.searchICs('浮島', IC).some(ic => ic.name === '浮島IC'));
    assert.ok(IC.every(r => !/ジャンクション/.test(r[0])));
});

test('よく使うICは回数→最近の順', () => {
    let f = HS.bumpFavorite({}, ukishima, 1);
    f = HS.bumpFavorite(f, { name: '架空IC', lat: 35, lng: 139 }, 2);
    f = HS.bumpFavorite(f, ukishima, 3);
    assert.deepEqual(HS.favoriteList(f).map(x => x.name), ['浮島IC', '架空IC']);
    assert.equal(f['浮島IC'].count, 2);
    assert.deepEqual(HS.bumpFavorite(f, { name: '' }), f);
});

function loadCalc(meterFor, choices) {
    const calls = [];
    const ctx = {
        console, setTimeout: (fn) => fn(), Math, Promise, Object, JSON, Array, Error,
        HighwaySegments: HS,
        google: { maps: { TravelMode: { DRIVING: 'D' }, DirectionsService: function () {
            this.route = (req, cb) => { calls.push(req); const m = meterFor(req); cb('OK', undefined) || 0; void m; };
        } } },
        ExpenseImport: { normalizeDate: d => d },
        DataStorage: {
            getRoutes: () => [{ id: 'r1', order: ['c1'] }],
            getCustomers: () => [{ id: 'c1', routeId: 'r1', address: '架空県甲野市1', appoDate: '2026-11-04' }],
            getSettings: () => ({ homeAddress: '架空県乙川市2' })
        }
    };
    ctx.google.maps.DirectionsService = function () {
        this.route = (req, cb) => { calls.push(req); const m = meterFor(req);
            cb({ routes: [{ legs: [{ distance: { value: m, text: '' }, duration: { value: 600, text: '10分' }, steps: [] }] }] }, 'OK'); };
    };
    ctx.module = { exports: {} };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../map/distance-calc.js'), 'utf8'), ctx);
    return { calc: ctx.module.exports, calls };
}

test('距離計算：古い保存値は従来と同じ・途中から高速は合計', async () => {
    const meter = req => (req.avoidHighways ? 12340 : 45620);
    const old = loadCalc(meter);
    const r0 = await old.calc.calcRouteDistance('r1', { home_start_c1: 'highway' }, '2026-11-04');
    assert.equal(old.calls.length, 2);
    assert.deepEqual([r0.totalKm, r0.highwayKm, r0.generalKm], [46 + 12, 46, 12]);

    const nw = loadCalc(meter);
    const r1 = await nw.calc.calcRouteDistance('r1', { home_start_c1: { type: 'hwFrom', ic: ukishima }, c1_home_end: 'general' }, '2026-11-04');
    assert.equal(nw.calls.length, 3);
    assert.equal(r1.segments[0].km, 58);
    assert.equal(r1.segments[0].ic, '浮島IC');
    assert.match(r1.segments[0].breakdown, /浮島ICから乗車/);
    assert.equal(r1.totalKm, 58 + 12);
    assert.equal(r1.generalKm + r1.highwayKm, r1.totalKm);
});
