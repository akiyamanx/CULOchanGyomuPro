const test = require('node:test'); const assert = require('node:assert');
const RM = require('../map/result-map.js');
const P = (a, b) => [{ lat: a, lng: 139.7 }, { lat: b, lng: 139.8 }];
const result = { segments: [{}, {}, {}], mapData: [
  { seg: 0, legs: [{ part: 'general', path: P(35.60, 35.61) }], ic: null, warn: false },
  // seg 1 は同じ場所（道筋なし）
  { seg: 2, legs: [{ part: 'general', path: P(35.61, 35.52) }, { part: 'highway', path: P(35.52, 35.43) }], ic: { name: '架空IC', lat: 35.52, lng: 139.79 }, warn: true }] };
test('色分け: 下道=青、高速=緑、警告あり=オレンジ', () => {
  assert.strictEqual(RM.colorFor('general', false), '#1e88e5');
  assert.strictEqual(RM.colorFor('highway', false), '#43a047');
  assert.strictEqual(RM.colorFor('highway', true), '#ff6d00');
});
test('途中からは下道と高速の2本の線とICのピン', () => {
  const p = RM.plan(result);
  assert.deepStrictEqual(p.lines.map(l => [l.seg, l.part]), [[0, 'general'], [2, 'general'], [2, 'highway']]);
  assert.ok(p.lines.filter(l => l.seg === 2).every(l => l.color === '#ff6d00'));
  assert.deepStrictEqual(p.pins.map(x => x.name), ['架空IC']);
});
test('番号つきの停車地、同じ位置はまとめる', () => {
  const p = RM.plan(result);
  assert.deepStrictEqual(p.stops.map(s => s.label), ['会', '1', '2', '会']);
});
test('道筋が無ければ描かずに例外（一覧だけ表示する）', () => {
  assert.throws(() => RM.draw({}, { segments: [], mapData: [] }, {}));
});
