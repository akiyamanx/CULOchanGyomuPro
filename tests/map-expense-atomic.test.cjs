const fs = require('node:fs'), vm = require('node:vm'), test = require('node:test'), assert = require('node:assert/strict');
const day = '2026-11-01', oldDay = '2026-10-31';
function row(date, values = {}) {
    const fields = {};
    const el = { dataset: {}, querySelector: key => fields[key] ??= { value: '', closest: () => el }, querySelectorAll: () => Object.values(fields) };
    el.querySelector('.exp-date').value = date;
    for (const [k, v] of Object.entries(values)) el.querySelector('.exp-' + k).value = v;
    return el;
}
function fixture() {
    const target = row(day, {distance:'120', gas:'600', 'dest-company':'架空・元の行先', parking:'400', highway:'900'});
    const old = row(oldDay, {parking:'800'});
    old.dataset.parkingImports = '{"receipt":600}';
    const rows = [target,old], alerts = [], tabs = [];
    const nodes = {mapExpenseDate:{value:day},mapExpenseRoute:{value:'route'},expDestCompany:{value:''}, expGrandTotal:{textContent:'¥2,700'}};
    let managed = false;
    const ctx = vm.createContext({
        alert: s => alerts.push(s), document: {getElementById: id => nodes[id] ?? null, querySelectorAll: s => s.includes('.exp-row') ? rows : []},
        ParkingManager: { settled: async () => {}, getItems: () => [{id:'receipt',date:day,amount:600}] },
        DataStorage: { getCurrentWorkspaceId: () => '2026-11', getRoutes: () => [{id:'route',order:['visit']}],
            getCustomers: () => [{id:'visit',routeId:'route',appoDate:day+'T09:00',company:'架空・新しい行先'}] },
        RouteManager: {getDistance: () => ({totalKm:180}), buildDestinationText: () => ({company:'架空・新しい行先',address:'架空住所'})},
        EtcWorkflow: {isManaged: () => managed}, AppCore: {switchTab: t => tabs.push(t)}
    });
    for (const f of ['expense/expense-import.js','expense/expense-manager.js','map/map-expense-form.js'])
        vm.runInContext(fs.readFileSync(new URL('../'+f,'file://'+__filename),'utf8'),ctx);
    return {rows,target,old,tabs,alerts,nodes, setManaged: () => { managed = true; },
        run: () => vm.runInContext('MapExpenseForm.reflectToExpense()',ctx)};
}
function state(f) {
    const read = (r,k) => String(r.querySelector('.exp-'+k).value);
    return [read(f.target,'distance'),read(f.target,'dest-company'),read(f.target,'gas'),read(f.target,'parking'),
        read(f.target,'highway'),read(f.old,'parking'),f.old.dataset.parkingImports,f.nodes.expGrandTotal.textContent];
}
for (const [label,setup,message] of [
    ['元の日付が重複',f=>f.rows.push(row(oldDay)), /明細が複数/],
    ['駐車場の履歴が壊れている',f=>{f.old.dataset.parkingImports='[]';}, /駐車場の取込情報/],
    ['ルートの日付が重複',f=>f.rows.push(row(day)), /明細が複数/],
    ['ETC管理中のためルート変更不可',f=>f.setManaged(), /ETC・寄り道/],
]) test(label+'なら行先・金額・合計を変更しない',async()=>{
    const f=fixture(); setup(f); const before=state(f);
    await f.run();
    assert.deepEqual(state(f),before); assert.deepEqual(f.tabs,[]); assert.match(f.alerts[0],message);
});
test('反映成功: 月またぎの日付訂正でも手入力分は残り繰り返しても二重に足さない',async()=>{
    const f=fixture();
    await f.run(); await f.run();
    assert.deepEqual(state(f).slice(0,7),['180','架空・新しい行先','2400','1000','900','200','{}']);
    assert.deepEqual(f.tabs,['expense','expense']);
});
