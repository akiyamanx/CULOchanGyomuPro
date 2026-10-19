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
    scrollIntoView() {}
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
        ParkingManager:{getItems:()=>fixture.parking,getSelectedItems:()=>[],snapshotSelected:async()=>[]},
        AppCore:{switchTab:name=>document.getElementById('testResults').dataset.tab=name},
        alert:()=>{},confirm:()=>true});
    context.window = context;
    for (const file of ['expense/expense-import.js','tests/expense-draft-memory.js','expense/expense-draft-receipts.js','expense/expense-manager.js','map/route-manager.js','map/map-expense-form.js','tests/expense-browser-tests.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'), context, {filename:file});
    }
    await vm.runInContext('runExpenseTests()', context);
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

function draftFixture() {
    const body=new Element('body');
    const add=(id,tag='div')=>{const el=new Element(tag);el.id=id;body.appendChild(el);return el};
    for(const id of ['expSubmitDate','expSSName','expEmployeeName','expDestCompany','expDestAddress','draftReceiptSource','parkingPageSize','draftReceiptPageSize'])add(id,'input');
    for(const id of ['expenseRows','expGrandTotal','expDraftList','draftReceiptCards','draftReceiptHint','loadedDraftReceipts','loadedDraftReceiptCount','draftReceiptEditStatus','draftReceiptLoadedOption'])add(id);
    const document={createElement:tag=>new Element(tag),getElementById:id=>descendants(body).find(el=>el.id===id)||null,querySelectorAll:s=>body.querySelectorAll(s),querySelector:s=>body.querySelector(s)};
    let receipts=[{id:'p',date:'2026-10-19',imageDataUrl:'saved-photo',visitCompany:'保存時の会社',machineName:'DP400',purpose:'修理',pdfScale:80}],pdf;
    const alerts=[];
    const context=vm.createContext({console,document,alert:m=>alerts.push(m),confirm:()=>true,
        ParkingManager:{getSelectedItems:()=>receipts,snapshotSelected:async()=>JSON.parse(JSON.stringify(receipts))},ParkingPdf:{generate:async snapshot=>{pdf=snapshot}}});
    for(const file of ['expense/expense-import.js','tests/expense-draft-memory.js','expense/expense-draft-receipts.js','expense/expense-manager.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);
    document.getElementById('draftReceiptSource').value='current';document.getElementById('parkingPageSize').value='4';
    vm.runInContext('ExpenseManager.init()',context);
    document.getElementById('expDestCompany').value='保存時の行先';
    return {context,document,alerts,replace:()=>{receipts=[]},pdf:()=>pdf,run:code=>vm.runInContext(code,context)};
}
test('下書きから写真・説明・配置を復元し、通常明細を変更後もPDFに保存時の内容を渡す',async()=>{
    const f=draftFixture();const id=await f.run('ExpenseManager.saveDraft()');assert.ok(id);
    f.replace();f.document.getElementById('expDestCompany').value='変更後';
    await f.run('ExpenseManager.loadDraft('+JSON.stringify(id)+')');
    assert.equal(f.document.getElementById('expDestCompany').value,'保存時の行先');assert.equal(f.document.getElementById('draftReceiptSource').value,'loaded');
    await f.run('ExpenseDraftReceipts.preview()');assert.equal(f.pdf().items[0].imageDataUrl,'saved-photo');assert.equal(f.pdf().items[0].visitCompany,'保存時の会社');assert.equal(f.pdf().pageSize,4);
    f.document.getElementById('draftReceiptCards').oninput({target:{dataset:{draftField:'purpose'},value:'メンテナンス',closest:()=>({dataset:{index:'0'}})}});
    const revised=await f.run('ExpenseManager.saveDraft()');assert.notEqual(revised,id);
    assert.equal((await f.run('ExpenseDraftStore.get('+JSON.stringify(revised)+')')).parkingReceipts.items[0].purpose,'メンテナンス');
    assert.equal((await f.run('ExpenseDraftStore.get('+JSON.stringify(id)+')')).parkingReceipts.items[0].purpose,'修理');
});
test('下書きの保存失敗は成功表示にせず、画面の内容を保持する',async()=>{
    const f=draftFixture();f.run("ExpenseDraftStore.save=async()=>{throw Error('quota')}");
    assert.equal(await f.run('ExpenseManager.saveDraft()'),undefined);assert.match(f.alerts.at(-1),/保存できません/);assert.equal(f.document.getElementById('expDestCompany').value,'保存時の行先');
});
test('旧下書きの読込は写真なしと表示し、現在の別の写真を自動的に付けない',async()=>{
    const f=draftFixture();await f.run("ExpenseDraftStore.save({id:123,destCompany:'旧行先',rows:[]})");await f.run('ExpenseManager.loadDraft(123)');
    assert.equal(f.document.getElementById('draftReceiptSource').value,'none');assert.match(f.alerts.at(-1),/旧下書きには領収書が保存されていません/);
    const id=await f.run('ExpenseManager.saveDraft()');assert.equal((await f.run('ExpenseDraftStore.get('+JSON.stringify(id)+')')).parkingReceipts.items.length,0);
});
