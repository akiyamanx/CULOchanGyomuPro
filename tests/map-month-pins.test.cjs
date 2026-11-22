const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const pins=require('../map/route-pin-style');
const script=(ctx,file)=>vm.runInContext(fs.readFileSync(require.resolve('../map/'+file),'utf8'),ctx);
const day=n=>'2026-12-'+String(n).padStart(2,'0');
test('月の1〜31日、色・形ともに使い、日付の取り違えを防ぐ',()=>{
    const styles=Array.from({length:31},(_,i)=>pins.visitStyle({status:'appointed',appoDate:day(i+1)},[],'2026-12'));
    assert.deepEqual(styles.map(p=>p.mark),Array.from({length:31},(_,i)=>String(i+1)));
    assert.equal(new Set(styles.map(p=>p.color+':'+p.shape)).size,31);
    assert.equal(styles[2].color,'#b42332');
    assert.equal(pins.visitStyle({status:'appointed',appoDate:'2027-01-01'},[],'2026-12').mark,'1/1');
    assert.equal(pins.visitStyle({status:'appointed',appoDate:'2026-02-31'},[],'2026-02').mark,'•');
    assert.equal(pins.visitStyle({status:'appointed',appoDate:day(3),dateNeedsReview:true},[],'2026-12').mark,'•');
});
test('黒旗と完了マークは日付・ルートにかかわらず優先する',()=>{
    const c={status:'pending',appoDate:day(3),routeId:'route_3'};
    assert.equal(pins.visitStyle(c,[],'2026-12').shape,'flag');
    assert.equal(pins.visitStyle({...c,status:'completed'},[],'2026-12').mark,'✓');
});
test('旧月のルートや訪問順を保持しつつ31番まで選択でき、読込時は保存を書き換えない',()=>{
    const data=new Map([['mm_workspace_current','2026-12'],['mm_routes_2026-12',JSON.stringify([{id:'route_1',name:'いつもの',color:'#abc',order:['a']},{id:'custom',name:'別ルート',order:[]}])]]);
    const ctx=vm.createContext({AppStorage:{getItem:k=>data.get(k)||null,setItem(){throw Error('no write');}}});
    script(ctx,'map-data-storage');
    const routes=JSON.parse(vm.runInContext('JSON.stringify(DataStorage.getRoutes())',ctx));
    assert.deepEqual(routes[0],{id:'route_1',name:'いつもの',color:'#abc',order:['a']});
    assert.equal(routes.find(r=>r.id==='custom').name,'別ルート');
    assert.equal(routes.filter(r=>/^route_\d+$/.test(r.id)).length,31);
    assert.equal(JSON.parse(data.get('mm_routes_2026-12')).length,2);
});
test('完了の地図表示を切り替え、元の訪問を消さず更新・追加時も表示を守る',()=>{
    const people=[{id:'a',status:'appointed',appoDate:day(3),lat:35,lng:139},{id:'b',status:'completed',appoDate:day(15),lat:35,lng:140}];
    const nodes=new Map(), el=id=>{if(!nodes.has(id))nodes.set(id,{style:{},remove(){},setAttribute(k,v){this[k]=v;}});return nodes.get(id);};
    const ctx=vm.createContext({document:{getElementById:el},GeocodeGuard:require('../map/geocode-guard'),ExpenseImport:require('../expense/expense-import'),
        RequestParser:{scheduleLabel:()=>''},RouteManager:{updateRoutePanel(){}},
        DataStorage:{getCustomers:()=>people,getViewCustomers:()=>people,getSettings:()=>({}),getGeoCache:()=>({}),getRoutes:()=>[],getCurrentWorkspaceId:()=> '2026-12'},
        google:{maps:{Map:class{fitBounds(){}},InfoWindow:class{close(){}},Geocoder:class{},LatLngBounds:class{extend(){}},LatLng:class{},Point:class{},Size:class{},
            Marker:class{constructor(o){Object.assign(this,o);} addListener(){} setMap(){} setVisible(v){this.visible=v;} setIcon(i){this.icon=i;} setTitle(){} getPosition(){return this.position;}}}}});
    script(ctx,'route-pin-style'); script(ctx,'map-core');
    vm.runInContext('MapCore.initMap()',ctx);
    const markers=()=>vm.runInContext('MapCore.getMarkers()',ctx);
    const visibility=()=>Array.from(markers(),m=>m.visible);
    assert.deepEqual(visibility(),[true,false]);
    assert.match(el('customerList').innerHTML,/data-customer-id="a"/);
    assert.doesNotMatch(el('customerList').innerHTML,/data-customer-id="b"/);
    vm.runInContext('MapCore.toggleCompleted()',ctx);
    assert.deepEqual(visibility(),[false,true]);
    assert.equal(el('mapCompletedButton')['aria-pressed'],'true');
    assert.match(el('customerList').innerHTML,/data-customer-id="b"/);
    people[0]={...people[0],status:'completed'};
    vm.runInContext('MapCore.updateMarkerColor("a")',ctx);
    assert.deepEqual(visibility(),[true,true]);
    assert.match(decodeURIComponent(markers()[0].icon.url),/✓/);
    vm.runInContext('MapCore.toggleCompleted()',ctx);
    assert.deepEqual(visibility(),[false,false]);
    assert.equal(people.length,2);
});
