const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// 保存処理の完了・失敗を制御するIDBモデル。実ブラウザの代替ではない。
function parkingContext(existing, legacy, failWrites = false) {
    const records = new Map(existing.map(item => [item.id, structuredClone(item)]));
    const storage = new Map([['gyomupro_parking', JSON.stringify(legacy)]]);
    const db = {
        transaction() {
            const pending = new Map(records);
            let writing = false;
            const tx = {
                objectStore() {
                    function request(value) {
                        const req = {};
                        queueMicrotask(() => {
                            req.result = value;
                            if (req.onsuccess) req.onsuccess();
                        });
                        return req;
                    }
                    return {
                        count: () => request(records.size),
                        getAll: () => request(Array.from(records.values()).map(item => structuredClone(item))),
                        put(item) { writing = true; pending.set(item.id, structuredClone(item)); return request(item.id); },
                        add(item) { writing = true; pending.set(item.id, structuredClone(item)); return request(item.id); },
                        delete(id) { writing = true; pending.delete(id); return request(undefined); },
                        clear() { writing = true; pending.clear(); return request(undefined); }
                    };
                }
            };
            setImmediate(() => {
                if (writing && failWrites) {
                    tx.error = new Error('storage unavailable');
                    if (tx.onerror) tx.onerror();
                    if (tx.onabort) tx.onabort();
                } else {
                    if (writing) { records.clear(); for (const [key, item] of pending) records.set(key, item); }
                    if (tx.oncomplete) tx.oncomplete();
                }
            });
            return tx;
        }
    };
    const context = vm.createContext({console: {log(){}, warn(){}, error(){}},
        localStorage: {getItem: key => storage.get(key) ?? null, removeItem: key => storage.delete(key)},
        indexedDB: {open() { const req = {}; queueMicrotask(() => req.onsuccess({target: {result: db}})); return req; }}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../expense/parking-idb.js'), 'utf8'), context);
    return {context, records, storage};
}

test('駐車場移行は既存IDBを保持し、旧保存にだけある明細も取り込む', async () => {
    const fixture = parkingContext([{id:'new',amount:800}], [{id:'old',amount:600}]);
    await vm.runInContext('ParkingIDB.migrateFromLocalStorage()', fixture.context);
    assert.equal(fixture.records.get('new').amount, 800);
    assert.equal(fixture.records.get('old')?.amount, 600);
    assert.equal(fixture.storage.has('gyomupro_parking'), false);
});

test('同じ駐車場IDの内容が異なる時は両方の原データを保持する', async () => {
    const fixture = parkingContext([{id:'same',amount:800}], [{id:'same',amount:600},{id:'old',amount:300}]);
    const result = await vm.runInContext('ParkingIDB.migrateFromLocalStorage()', fixture.context);
    assert.equal(fixture.records.get('same').amount, 800);
    assert.equal(fixture.records.get('old')?.amount, 300);
    assert.equal(JSON.parse(fixture.storage.get('gyomupro_parking'))[0].amount, 600);
    assert.equal(result.conflicts, 1);
});

test('駐車場移行の保存に失敗した時は旧データを削除しない', async () => {
    const fixture = parkingContext([], [{id:'old',amount:600}], true);
    await vm.runInContext('ParkingIDB.migrateFromLocalStorage()', fixture.context);
    assert.equal(fixture.storage.has('gyomupro_parking'), true);
    assert.equal(fixture.records.size, 0);
});

test('駐車場の削除は要求成功後の保存中断を成功扱いしない', async () => {
    for (const operation of ["ParkingIDB.remove('saved')", 'ParkingIDB.clearAll()']) {
        const fixture = parkingContext([{id:'saved',amount:800}], [], true);
        await assert.rejects(vm.runInContext(operation, fixture.context), /storage unavailable/);
        assert.equal(fixture.records.get('saved').amount, 800);
    }
});

test('距離再計算が失敗した時は以前の計算結果を精算へ再利用しない', async () => {
    let routes = [{id:'r',name:'検証ルート',order:['a']}];
    const context = vm.createContext({console, alert(){}, confirm:()=>false,
        document: {getElementById:()=>({style:{},textContent:''})},
        DataStorage: {getRoutes:()=>structuredClone(routes), saveRoutes:value=>{routes=structuredClone(value);},
            getCustomers:()=>[{id:'a',routeId:'r',appoDate:'2026-10-08T09:00',address:'架空訪問先'}],
            getSettings:()=>({homeAddress:'架空出発点'}), getCurrentWorkspaceId:()=> '2026-10',
            getSegments:()=>({}), saveSegments(){}},
        ExpenseImport: require('../expense/expense-import.js'),
        SegmentDialog:{show:async()=>({home_start_a:'general'})},
        DistanceCalc:{calcRouteDistance:async()=>{throw new Error('計算失敗');}},
        MapExpenseForm:{updateSummary(){}}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../map/route-manager.js'),'utf8'),context);
    const signature = vm.runInContext("RouteManager.distanceSignature('r','2026-10-08')",context);
    routes[0].distanceResults = {'2026-10-08':{totalKm:180,signature}};
    assert.ok(vm.runInContext("RouteManager.getDistance('r','2026-10-08')",context));
    await vm.runInContext("RouteManager.calcDistance('r','2026-10-08')",context);
    assert.equal(vm.runInContext("RouteManager.getDistance('r','2026-10-08')",context),null);
});

function managerContext() {
    const alerts = [];
    const context = vm.createContext({console:{log(){},warn(){},error(){}}, Date, Math,
        document:{getElementById:()=>null}, alert:message=>alerts.push(message), confirm:()=>true,
        ParkingIDB:{migrateFromLocalStorage:async()=>({migrated:false}),
            getAll:async()=>[{id:'saved',amount:800}], putAll:async()=>false,
            remove:async()=>false, clearAll:async()=>false},
        ReceiptScanner:{getRecognizedReceipts:()=>[{checked:true,imageDataUrl:'data:image/png;base64,fixture',data:{type:'parking',date:'2026-10-08',total:600}}]}
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../expense/parking-manager.js'),'utf8'),context);
    return {context,alerts};
}

test('駐車場の保存失敗を取込成功と表示せず、未保存の追加を取り消す',async()=>{
    const {context,alerts}=managerContext();
    await vm.runInContext('ParkingManager.init()',context);
    await vm.runInContext('ParkingManager.importFromScanner()',context);
    assert.equal(alerts.some(message=>message.includes('取り込みました')),false);
    assert.ok(alerts.some(message=>message.includes('保存できません')));
    assert.equal(vm.runInContext('ParkingManager.getItems().length',context),1);
});

test('駐車場の削除に失敗した時は画面側の明細も保持する',async()=>{
    const {context}=managerContext();
    await vm.runInContext('ParkingManager.init()',context);
    await vm.runInContext("ParkingManager.removeItem('saved')",context);
    assert.equal(vm.runInContext('ParkingManager.getItems().length',context),1);
    await vm.runInContext('ParkingManager.clearAll()',context);
    assert.equal(vm.runInContext('ParkingManager.getItems().length',context),1);
});
