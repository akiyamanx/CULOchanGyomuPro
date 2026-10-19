const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(entries = []) {
    const storage = new Map(entries);
    const context = vm.createContext({console, localStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value)
    }});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../map/map-data-storage.js'), 'utf8'), context);
    return {storage, run: source => JSON.parse(JSON.stringify(vm.runInContext(source, context)))};
}

test('新規ルートと旧保存ルートの2・7・10は同じ新配色になり、訪問順・距離を保持する', () => {
    const defaults = fixture().run('DataStorage.getRoutes()');
    const old = [
        {id:'route_2', name:'営業先', color:'#EA4335', order:['b','a'], distanceKm:181},
        {id:'route_7', name:'ルート7', color:'#e91e63', order:['c']},
        {id:'route_10', name:'ルート10', color:'#ff5722', order:[]}
    ];
    const data = fixture([['mm_routes', JSON.stringify(old)]]);
    const actual = data.run('DataStorage.getRoutes()');
    old.forEach((route, i) => {
        const expectedColor = defaults.find(item => item.id === route.id).color;
        assert.notEqual(expectedColor.toLowerCase(), route.color.toLowerCase());
        assert.deepEqual(actual[i], {...route, color:expectedColor});
    });
    assert.equal(data.storage.get('mm_routes'), JSON.stringify(old), '読み込みだけでは保存済みデータを書き換えない');
    assert.equal(new Set(defaults.map(route => route.color)).size, 10);
});

test('月を切り替えても新配色を表示し、通常の保存後も同じ内容を読み戻す', () => {
    const data = fixture([
        ['mm_workspace_current','2026-10'],
        ['mm_workspaces',JSON.stringify([{id:'2026-10'},{id:'2026-09'}])],
        ['mm_routes_2026-10',JSON.stringify([{id:'route_2',color:'#ea4335',order:['a']}])],
        ['mm_routes_2026-09',JSON.stringify([{id:'route_7',color:'#e91e63',order:['b']}])]
    ]);
    assert.equal(data.run('DataStorage.getRoutes()')[0].color, '#283593');
    assert.equal(data.run("DataStorage.switchWorkspace('2026-09')"), true);
    const expected = data.run('DataStorage.getRoutes()');
    assert.equal(expected[0].color, '#00796b');
    data.run('DataStorage.saveRoutes(DataStorage.getRoutes()); true');
    assert.deepEqual(JSON.parse(data.storage.get('mm_routes_2026-09')), expected);
    assert.deepEqual(data.run('DataStorage.getRoutes()'), expected);
});

test('個別に変更した色と、対象外ルートの色は変更しない', () => {
    const routes = [
        {id:'route_2',color:'#123456',order:['a']},
        {id:'route_7',color:'#ff5722',order:[]},
        {id:'route_10',color:'#ffffff',order:[]},
        {id:'route_custom',color:'#ea4335',order:[]},
        {id:'route_1',color:'#4285f4',order:[]}
    ];
    assert.deepEqual(fixture([['mm_routes',JSON.stringify(routes)]]).run('DataStorage.getRoutes()'), routes);
});

test('過去月のルートを月切替なしで読み、未保存の標準ルートも列挙できる',()=>{
    const data=fixture([['mm_workspace_current','2026-10'],['mm_routes_2026-09',JSON.stringify([{id:'r',name:'9月のルート'}])]]);
    assert.equal(data.run("DataStorage.getRoutes('2026-09')")[0].name,'9月のルート');
    assert.equal(data.run("DataStorage.getRoutes('2026-08')").length,10);
    assert.equal(data.storage.get('mm_workspace_current'),'2026-10');
});
