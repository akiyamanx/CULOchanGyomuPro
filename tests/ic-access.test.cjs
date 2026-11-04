const test = require('node:test'); const assert = require('node:assert');
const HS = require('../map/highway-segments.js');
const UK = { name: '浮島IC', lat: 35.51984, lng: 139.78892 };
const KN = { name: '木更津金田IC', lat: 35.43195, lng: 139.92424 };
test('途中から: 下道は浮島ICの一般道側入口へ向かう（本線上の点ではない）', () => {
  const l = HS.planLegs('架空の出発地', '架空の到着地', { type: 'hwFrom', ic: UK });
  assert.strictEqual(l[0].avoidHighways, true);
  assert.deepStrictEqual(l[0].destination, HS.IC_ACCESS['浮島IC']);
  assert.deepStrictEqual(l[1].origin, HS.IC_ACCESS['浮島IC']);
  assert.notStrictEqual(l[0].destination.lat, UK.lat);
});
test('途中まで: 金田ICは国道409号側の出口から下道', () => {
  const l = HS.planLegs('架空A', '架空B', { type: 'hwUntil', ic: KN });
  assert.strictEqual(l[1].avoidHighways, true);
  assert.deepStrictEqual(l[1].origin, HS.IC_ACCESS['木更津金田IC']);
});
test('入口の登録がないICは従来どおりICの点', () => {
  const ic = { name: '架空IC', lat: 35.1, lng: 139.1 };
  assert.deepStrictEqual(HS.planLegs('a', 'b', { type: 'hwFrom', ic })[0].destination, { lat: 35.1, lng: 139.1 });
});
test('下道が直線に比べて長すぎると警告（北品川付近→浮島IC 下道91.5km）', () => {
  const from = { lat: 35.6215, lng: 139.7327 };
  const bad = HS.generalDetour(from, {}, { type: 'hwFrom', ic: UK }, 91500);
  assert.strictEqual(bad.warn, true);
  assert.ok(bad.straightKm > 10 && bad.straightKm < 15);
  assert.strictEqual(HS.generalDetour(from, {}, { type: 'hwFrom', ic: UK }, 20000).warn, false);
});
test('途中まで は到着側で判定、位置不明や下道・高速は判定しない', () => {
  const to = { lat: 35.4286, lng: 139.9774 };
  assert.strictEqual(HS.generalDetour({}, to, { type: 'hwUntil', ic: KN }, 60000).warn, true);
  assert.strictEqual(HS.generalDetour({}, to, { type: 'hwUntil', ic: KN }, 8000).warn, false);
  assert.strictEqual(HS.generalDetour({ lat: null, lng: null }, to, { type: 'hwFrom', ic: UK }, 90000), null);
  assert.strictEqual(HS.generalDetour({}, to, 'general', 90000), null);
});
