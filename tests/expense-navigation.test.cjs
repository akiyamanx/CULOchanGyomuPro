const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
    const ids = new Map(), handlers = {}, calls = [];
    const node = id => {
        if (!ids.has(id)) ids.set(id, {
            hidden: id === 'parkingSection', open: false,
            setAttribute: (name, value) => calls.push([id, name, value]),
            focus: options => calls.push([id, 'focus', options?.preventScroll]),
            scrollIntoView: options => calls.push([id, 'scroll', options?.behavior]),
            addEventListener() {}, querySelector: () => node('route-summary')
        });
        return ids.get(id);
    };
    const document = {
        body: {}, getElementById: node, querySelectorAll: () => [],
        querySelector: selector => node(selector),
        addEventListener: (name, handler) => { handlers[name] = handler; }
    };
    const AppCore = { switchTab(detail) { handlers['app:tabchange']({detail}); } };
    const app = vm.runInNewContext(fs.readFileSync(require.resolve('../shared/workflow-ui.js'),'utf8') + ';WorkflowUI', {
        document, AppCore, MapCore:{updateCustomerList(){}}, RouteManager:{updateRoutePanel(){}},
        MapExpenseForm:{init(){}}, window:{scrollTo(options){calls.push(['window','scroll',options.top]);}},
        MutationObserver: class { observe() {} }
    });
    app.init();
    return {app,node,calls,AppCore};
}

test('parking uses its own first screen and focuses its heading without scrolling through ETC', () => {
    const {app,node,calls} = fixture();
    app.openParking();
    assert.equal(node('parkingSection').hidden,false);
    assert.equal(node('expenseOverview').hidden,true);
    assert.deepEqual(calls.slice(-4),[
        ['tab-expense','aria-labelledby','parkingTitle'],
        ['parkingTitle','focus',true],
        ['window','scroll',0],
        ['parkingTitle','scroll','instant']
    ]);
});

test('normal expense navigation restores the overview and section jumps only visit known headings', () => {
    const {app,node,calls,AppCore} = fixture();
    app.openParking();
    AppCore.switchTab('expense');
    assert.equal(node('parkingSection').hidden,true);
    assert.equal(node('expenseOverview').hidden,false);
    app.jumpExpense('expenseDetailsTitle');
    assert.deepEqual(calls.at(-1),['expenseDetailsTitle','scroll','instant']);
    const count=calls.length;
    app.jumpExpense('parkingSection');
    assert.equal(calls.length,count);
    app.openParking();
    app.openRouteImport();
    assert.equal(node('expenseOverview').hidden,false);
    assert.equal(node('routeImport').open,true);
});

test('one copy of each existing parking field, with intake, records and both outputs in distinct sections', () => {
    const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
    for (const id of ['parkingSection','parkingPhotoStatus','parkingItemList','parkingPageSize','parkingReflectButton','routeImport','etcSection']) {
        assert.equal([...html.matchAll(new RegExp('id="'+id+'"','g'))].length,1,id);
    }
    const at=token=>html.indexOf(token);
    const order=['id="parkingSection"','id="parkingAddTitle"','id="parkingPhotoStatus"','id="parkingRecordsTitle"','id="parkingItemList"','id="parkingPrintTitle"','id="parkingPageSize"','id="parkingReflectTitle"','id="parkingReflectButton"','id="expenseOverview"'];
    order.forEach((token,i)=>assert.ok(at(token)>=0 && (i===0||at(token)>at(order[i-1])),token));
});

test('the main navigation separates travel expenses from other receipts', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    const mainNav = html.match(/<nav class="tab-nav"[\s\S]*?<\/nav>/)[0];
    assert.match(mainNav, /data-tab="map"[\s\S]*data-tab="expense"[\s\S]*data-tab="receipt"/);
    assert.match(mainNav, /data-tab="receipt"[^>]*>.*<span class="tab-label">その他レシート<\/span>/);
    const receipt = html.slice(html.indexOf('id="tab-receipt"'), html.indexOf('id="tab-expense"'));
    assert.doesNotMatch(receipt, /WorkflowUI\.openParking\(/);
    for (const feature of ['ReceiptScanner.handleFileSelect', 'ReceiptScanner.generateA4Pdf', 'ReceiptScanner.saveAll', 'ReceiptScanner.sendToParking', 'savedReceiptList']) {
        assert.ok(receipt.includes(feature), feature);
    }
});

test('the shortcut and expense overview both open the one parking intake', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /WorkflowUI\.openParking\(\)">駐車場の領収書を追加<\/button>/);
    assert.match(html, /WorkflowUI\.openParking\(\)">駐車場の領収書を追加 →<\/button>/);
    const intake = html.slice(html.indexOf('id="parkingAddTitle"'), html.indexOf('id="parkingPhotoStatus"'));
    for (const action of ['ReceiptPhoto.addFiles', 'ParkingScan.open(this)', 'ParkingManager.addItem']) {
        assert.ok(intake.includes(action), action);
    }
    assert.equal((html.match(/ParkingScan\.open\(this\)/g) || []).length, 1);
    assert.doesNotMatch(intake, /ParkingManager\.importFromScanner/);
});

test('both major expense transitions use the same freestanding divider heading', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    for (const id of ['expenseDetailsTitle', 'expenseFinishTitle']) {
        assert.match(html, new RegExp('<h3 class="section-title expense-divider" id="' + id + '" tabindex="-1">[^\n]+</h3>\\s*<section class="panel-card'));
    }
    assert.match(html, /<section class="panel-card finish-card" aria-labelledby="expenseFinishTitle">/);
});

test('existing archived parking receipts still reach parking; other archive items are not imported', async () => {
    const image = i => 'data:image/jpeg;base64,' + i;
    const archive = [
        {id:'legacy-parking',date:'2026-11-10',store:'試験駐車場',total:700,type:'parking',imageDataUrl:image('YWJj')},
        {id:'legacy-shop',date:'2026-11-10',store:'試験商店',total:1200,type:'shopping',imageDataUrl:image('ZGVm')}
    ];
    const {app,node} = fixture();
    const archiveText = JSON.stringify(archive);
    let saved = [{id:'already-in-ledger',amount:500}], writes = 0;
    const ctx = vm.createContext({
        clearTimeout, confirm:()=>true, alert(){},
        document:{addEventListener(){},getElementById(id){return id.startsWith('parkingFilter')?node(id):null;}},
        AppStorage:{getItem(key){assert.equal(key,'gyomupro_receipts');return archiveText;},setItem(){throw Error('do not rewrite the general archive');}},
        ParkingIDB:{migrateFromLocalStorage:async()=>({}),getAll:async()=>saved,putAll:async rows=>{writes++;saved=structuredClone(rows);return true;}},
        WorkflowUI:app
    });
    vm.runInContext(fs.readFileSync(require.resolve('../expense/parking-manager.js'),'utf8'),ctx);
    vm.runInContext(fs.readFileSync(require.resolve('../receipt/receipt-scanner.js'),'utf8'),ctx);
    await vm.runInContext('ParkingManager.init()',ctx);
    vm.runInContext("ReceiptScanner.openSaved('legacy-shop')",ctx);
    await vm.runInContext('ReceiptScanner.sendToParking()',ctx);
    assert.equal(writes,0);
    vm.runInContext("ReceiptScanner.openSaved('legacy-parking')",ctx);
    await vm.runInContext('ReceiptScanner.sendToParking()',ctx);
    assert.equal(writes,1);
    assert.deepEqual(saved.slice(0,1),[{id:'already-in-ledger',amount:500}]);
    assert.equal(saved[1].amount,700);
    assert.equal(saved[1].imageDataUrl,archive[0].imageDataUrl);
    assert.equal(node('parkingSection').hidden,false);
    assert.equal(node('expenseOverview').hidden,true);
    await vm.runInContext('ReceiptScanner.sendToParking()',ctx);
    assert.equal(writes,1,'retry must not duplicate a previously imported archive item');
});

test('parking company picker remains outside the hidden expense overview', () => {
    const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
    assert.match(html, /id="parkingSection"[\s\S]+<dialog id="parkingCompanyDialog"[\s\S]*?<\/dialog>\s*<\/section>\s*<div id="expenseOverview">/);
    assert.doesNotMatch(html, /id="parkingScanSample"/);
});

test('PDF add result is in its sticky action footer and saved photo opens the shared crop editor',()=>{
    const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
    const css=fs.readFileSync(require.resolve('../styles/parking-workflow.css'),'utf8');
    const scanner=fs.readFileSync(require.resolve('../expense/parking-scan.js'),'utf8');
    const photo=fs.readFileSync(require.resolve('../receipt/receipt-photo.js'),'utf8');
    assert.match(html,/<div class="scan-footer"><p id="parkingScanFeedback"[^>]*role="status"[^>]*><\/p><div class="parking-actions"><button id="parkingScanSave"/);
    assert.match(css,/\.scan-footer\{bottom:0;position:sticky/);
    assert.match(scanner,/feedback\('領収書を保存しています…','pending'\)/);
    assert.match(scanner,/feedback\(count\?count\+'枚追加しました。'/);
    assert.match(scanner,/if\(adding\)feedback\('追加できませんでした。'/);
    assert.match(photo,/ReceiptCropEditor\.clonePanel\('photo-'\)/);
    assert.match(photo,/dialog\.showModal\(\);dialog\.scrollTop=0;openCrop\(\)/);
    assert.match(photo,/originalImageDataUrl:item\.originalImageDataUrl\|\|item\.imageDataUrl/);
});
test('individual scan rotation is separate from page orientation and saved overlap coordinates',()=>{
    const html=fs.readFileSync(require.resolve('../index.html'),'utf8');
    const scanner=fs.readFileSync(require.resolve('../expense/parking-scan.js'),'utf8');
    assert.match(html,/id="parkingScanRotate"[^>]*>ページ全体を右に90°/);
    assert.match(html,/id="cropTurnLeft"[^>]*>この1枚を左へ90°/);
    assert.match(html,/id="cropTurnRight"[^>]*>この1枚を右へ90°/);
    assert.match(scanner,/let quad=initial, turn=0/);
    assert.match(scanner,/cropImage\(quad,turn\(\),2400\)/);
    assert.match(scanner,/\{layout:layout\.value,angle\}\)/);
});
