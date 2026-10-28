// 取込データ由来の文字列(会社名・ルート名など)が、画面HTMLにそのまま入らないことを確認する。
// データはすべて架空。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const EVIL = '<img src=x onerror=alert(1)>\'");alert(2);//';
function load(files, extra = {}) {
    const elements = {};
    const el = id => elements[id] || (elements[id] = { id, innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelectorAll: () => [], appendChild() {}, addEventListener() {} });
    const store = new Map();
    const storage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    const context = vm.createContext({
        console, alert() {}, confirm: () => true, setTimeout, clearTimeout, localStorage: storage, PreviewStorage: storage,
        document: { addEventListener() {}, getElementById: el, querySelectorAll: () => [], querySelector: () => null, createElement: () => el('_tmp' + Math.random()), body: { appendChild() {}, insertAdjacentHTML() {} } },
        window: {}, ...extra,
    });
    for (const file of files) vm.runInContext(fs.readFileSync(require.resolve('../' + file), 'utf8'), context, { filename: file });
    return { context, el, store };
}

test('ルート一覧: 会社名・ルート名・ID・色がエスケープされ、onclickの引数から抜け出せない', () => {
    const { context, el } = load(['expense/expense-import.js', 'map/route-manager.js'], {
        DataStorage: {
            getRoutes: () => [{ id: EVIL, name: EVIL, color: 'red;background:url(x)' }],
            getCustomers: () => [{ id: EVIL, company: EVIL, routeId: EVIL }, { id: 'u1', company: EVIL }],
        },
    });
    vm.runInContext('RouteManager.updateRoutePanel()', context);
    for (const id of ['routeManager', 'legendItems']) {
        const html = el(id).innerHTML;
        assert.ok(html.length > 0, id);
        assert.doesNotMatch(html, /<img/i, id);
        assert.doesNotMatch(html, /url\(x\)/, id + ' color');
    }
    const html = el('routeManager').innerHTML;
    // onclick属性をHTMLデコードして実際に評価しても、引数は元の文字列そのもの(JSとして抜け出さない)
    const decode = text => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const calls = [];
    const sandbox = vm.createContext({
        MapCore: { focusMarker: value => calls.push(['focus', value]) },
        RouteManager: { toggleRouteSection() {}, calcDistance: value => calls.push(['calc', value]) },
        event: { stopPropagation() {} },
        alert: () => calls.push(['INJECTED']),
    });
    for (const m of html.matchAll(/onclick="([^"]*)"/g)) vm.runInContext(decode(m[1]), Object.assign(sandbox, { __this: null }));
    assert.ok(calls.length >= 3);
    assert.ok(!calls.some(c => c[0] === 'INJECTED'));
    assert.ok(calls.every(c => c[1] === EVIL || c[1] === 'u1'));
});

test('保存済みレシート: 読めないデータは空扱いにせず、上書きもしない', () => {
    const { context, el, store } = load(['expense/expense-import.js', 'receipt/receipt-scanner.js']);
    store.set('gyomupro_receipts', '{broken');
    vm.runInContext('ReceiptScanner.cancelDeleteMode()', context);
    assert.match(el('savedReceiptList').textContent, /読み込めません/);
    assert.equal(store.get('gyomupro_receipts'), '{broken');
});

test('保存済みレシート: ID・金額に不正な文字列があってもHTMLに出ない', () => {
    const { context, el, store } = load(['expense/expense-import.js', 'receipt/receipt-scanner.js']);
    store.set('gyomupro_receipts', JSON.stringify([{ id: EVIL, total: '<b>x</b>', date: '2026-10-01', dataUrl: 'data:image/png;base64,AAAA' }]));
    vm.runInContext('ReceiptScanner.cancelDeleteMode()', context);
    assert.doesNotMatch(el('savedReceiptList').innerHTML, /<img src=x|<b>x/);
});
