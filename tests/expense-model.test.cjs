// Node用の最小DOMモデル。ブラウザ表示やPDF描画の代わりではない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Element {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this._value = ''; this._html = ''; this.className = ''; }
    get value() { return this._value; }
    set value(value) { this._value = String(value ?? ''); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener() {}
    closest(selector) { return matches(this, selector) ? this : this.parent && this.parent.closest(selector); }
    querySelectorAll(selector) { return descendants(this).filter(child => matches(child, selector)); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get textContent() { return this._text || this._html.replace(/<[^>]*>/g, ''); }
    set textContent(value) { this._text = String(value); }
    get innerHTML() { return this._html; }
    set innerHTML(value) {
        this._html = value; this._text = ''; this.children = [];
        // 入力・集計要素だけをモデル化する。
        for (const match of value.matchAll(/<(input|select|textarea|span|div)\b([^>]*)>/g)) {
            const child = new Element(match[1]);
            for (const attr of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
                if (attr[1] === 'class') child.className = attr[2];
                else child[attr[1]] = attr[2];
            }
            this.appendChild(child);
        }
        if (this.tagName === 'select') this.value = (value.match(/<option value="([^"]*)"/) || [,''])[1];
    }
}
function descendants(element) { return element.children.flatMap(child => [child, ...descendants(child)]); }
function matches(element, selector) {
    const parts = selector.trim().split(/\s+/);
    const leaf = parts.pop();
    const own = leaf.startsWith('.') ? element.className.split(/\s+/).includes(leaf.slice(1))
        : leaf.startsWith('#') ? element.id === leaf.slice(1) : element.tagName === leaf;
    if (!own) return false;
    if (!parts.length) return true;
    let ancestor = element.parent;
    while (ancestor) { if (matches(ancestor, parts.join(' '))) return true; ancestor = ancestor.parent; }
    return false;
}

test('日別反映・再取込・駐車場更新・下書き復元・マップ参照・PDFデータを実装コードで検証', async () => {
    const body = new Element('body');
    const add = (id, tag, parent = body) => { const element = new Element(tag); element.id = id; parent.appendChild(element); return element; };
    const expense = add('tab-expense', 'div');
    for (const id of ['expSubmitDate','expSSName','expEmployeeName','expDestCompany','expDestAddress']) add(id, 'input', expense);
    for (const id of ['expenseRows','expGrandTotal','expDraftList']) add(id, 'div', expense);
    add('testResults', 'pre'); add('tabExpense', 'div');
    const document = {body, createElement:tag => new Element(tag), getElementById:id => descendants(body).find(element => element.id === id) || null,
        querySelectorAll:selector => body.querySelectorAll(selector), querySelector:selector => body.querySelector(selector)};
    const store = new Map();
    const localStorage = {getItem:key => store.get(key) ?? null, setItem:(key,value) => store.set(key,String(value)), removeItem:key => store.delete(key)};
    const fixture = {
        customers:[{id:'a',routeId:'route_1',company:'検証株式会社',address:'千葉県千葉市中央区中央1-1',appoDate:'2026-10-08T09:00'}, {id:'b',routeId:'route_1',company:'架空メンテナンス',address:'東京都江東区夢の島2-2',appoDate:'2026-10-09T10:00'}],
        routes:[{id:'route_1',name:'検証ルート',order:['a','b']}], parking:[]
    };
    const context = vm.createContext({console, document, localStorage, fixture,
        DataStorage:{getCustomers:()=>fixture.customers,getRoutes:()=>fixture.routes,getSettings:()=>({homeAddress:'検証出発点'}),getCurrentWorkspaceId:()=> '2026-10'},
        ParkingManager:{getItems:()=>fixture.parking},
        AppCore:{switchTab:name=>document.getElementById('testResults').dataset.tab=name},
        alert:()=>{},confirm:()=>true});
    context.window = context;
    for (const file of ['expense/expense-import.js','expense/expense-manager.js','map/route-manager.js','map/map-expense-form.js','tests/expense-browser-tests.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), context, {filename:file});
    }
    vm.runInContext('runExpenseTests()', context);
    const output = document.getElementById('testResults');
    assert.equal(output.dataset.result, 'pass', output.textContent);
    assert.equal((output.textContent.match(/^PASS /gm) || []).length, 18, output.textContent);
    const pages = [];
    let added = 0, saved = '';
    context.AppCore.showLoading = () => {};
    context.AppCore.hideLoading = () => {};
    context.jspdf = {jsPDF:class { addPage() { added++; } save(name) { saved = name; } }};
    context.PdfRenderer = {addPage:async (pdf, dom) => pages.push({html:dom.innerHTML,footer:dom.children.at(-1).textContent})};
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../expense/expense-pdf.js'),'utf8'), context);
    await vm.runInContext('ExpensePdf.generate()', context);
    assert.equal(pages.length, 2, '7行は2ページへ分割');
    assert.equal(added, 1);
    assert.equal(saved, '交通費精算_20261009.pdf');
    for (const page of pages) {
        assert.match(page.html, /駐車場代/);
        assert.equal((page.html.match(/<td style="height:50px;/g) || []).length, 72, '各ページ6行×12列');
        assert.match(page.footer, /7,300円/, '駐車場代を含む全ページ合計');
    }
    assert.match(pages[0].html, /2400円/);
    assert.match(pages[0].html, /1700円/);
    assert.match(pages[0].html, /検証株式会社/);
});

test('日別距離はその日の訪問先だけを計算し、区間失敗で未完成の金額を反映しない', async () => {
    let fail = false;
    const visited = [];
    const context = vm.createContext({console:{warn(){}},setTimeout:callback=>callback(),
        ExpenseImport:require('../expense/expense-import.js'),
        DataStorage:{getRoutes:()=>[{id:'r',order:['a','b']}],getCustomers:()=>[
            {id:'a',routeId:'r',appoDate:'2026-10-08T09:00',address:'当日の訪問先'},
            {id:'b',routeId:'r',appoDate:'2026-10-09T09:00',address:'翌日の訪問先'}],getSettings:()=>({homeAddress:'自宅'})},
        google:{maps:{TravelMode:{DRIVING:'DRIVING'},DirectionsService:class {
            route(request, callback) {
                visited.push(request.destination);
                if (fail) callback({},'ZERO_RESULTS');
                else callback({routes:[{legs:[{distance:{value:50000,text:'50 km'},duration:{value:3000,text:'50分'}}]}]},'OK');
            }
        }}}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../map/distance-calc.js'),'utf8'),context);
    const result = await vm.runInContext("DistanceCalc.calcRouteDistance('r',{},'2026-10-08')",context);
    assert.equal(result.totalKm,100);
    assert.deepEqual(visited,['当日の訪問先','自宅']);
    fail = true;
    await assert.rejects(vm.runInContext("DistanceCalc.calcRouteDistance('r',{},'2026-10-08')",context),/計算できない区間/);
});
