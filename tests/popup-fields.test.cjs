const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '../map/map-core.js'), 'utf8');
const body = name => { const i = src.indexOf('function ' + name + '('); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\n    }\n', i)); };
test('吹き出しの詳細行に担当者とフィルターが残っている', () => {
    const d = body('detailLines');
    assert.match(d, /customer\.contact\)[^\n]*👤/);
    assert.match(d, /customer\.filter\)[^\n]*🔧 フィルター/);
});
test('地図の吹き出しも地図なしカードも同じ詳細行を使う', () => {
    assert.match(body('showInfoWindow'), /detailLines\(customer\)/);
    assert.match(body('showPickCard'), /detailLines\(/);
});
