const test=require('node:test'),assert=require('node:assert/strict');
const Today=require('../map/today-visits'), Planner=require('../map/visit-planner');
const now=new Date('2026-11-30T23:00:00Z');
const visit=(id,start,extra={})=>({id,appoDate:start,status:'appointed',...extra});
test('日本時間の日付で、前月から続く訪問と今月分だけを元の保存場所付きで時刻順表示',()=>{
    assert.deepEqual(Today.clock(now),{day:'2026-12-01',time:'08:00'});
    const data={'2026-11':[
        visit('overnight','2026-11-30T18:00',{appoEndDate:'2026-12-01T09:00'}),
        visit('midnight','2026-11-30T18:00',{appoEndDate:'2026-12-01T00:00'})
    ],'2026-12':[visit('late','2026-12-01T18:00'),visit('early','2026-12-01T10:00'),visit('no-time','2026-12-01'),
        visit('different-day','2026-12-02T08:00'),visit('bad','2026-11-31T17:00',{appoEndDate:'2026-12-01T18:00'})]};
    const storage={getCurrentWorkspaceId:()=> '2026-11',getWorkspaces:()=>['2026-11','2026-12','2026-10','2027-01'].map(id=>({id})),
        getCustomersForWorkspace:id=>{if(id==='2026-10')throw Error();return data[id]||[];}};
    const r=Today.read(storage,Today.clock(now).day,Planner);
    assert.equal(r.incomplete,true);
    assert.deepEqual(r.rows.map(c=>[c.id,c.workspaceId]),[['overnight','2026-11'],['early','2026-12'],['late','2026-12'],['no-time','2026-12']]);
});
test('次の訪問に未アポ・希望・日付要確認・完了・時刻なし・過ぎた予定を自動選択しない',()=>{
    const items=[visit('done','2026-12-01T08:15',{status:'completed'}),visit('pending','2026-12-01T08:20',{status:'pending'}),
        visit('preferred','2026-12-01T08:25',{scheduleKind:'preferred'}),visit('review','2026-12-01T08:30',{dateNeedsReview:true}),
        visit('time','2026-12-01'),visit('past','2026-12-01T07:55'),visit('next','2026-12-01T12:10'),visit('later','2026-12-01T16:10')];
    assert.equal(Today.next(items,Today.clock(now),Planner)?.id,'next');
    assert.equal(Today.next(items.slice(0,6),Today.clock(now),Planner),null);
    assert.equal(Today.next([...items,visit('ongoing','2026-11-30T23:00',{appoEndDate:'2026-12-01T10:00'})],Today.clock(now),Planner)?.id,'next');
    assert.equal(Today.timeText(items[4],'2026-12-01',Planner),'時刻未定');
});
test('ナビは押すまで送信せず、固定した Google マップURLの目的地だけに住所を入れる',()=>{
    const url=new URL(Today.directions('東京都 テスト&destination=overridden'));
    assert.equal(url.origin,'https://www.google.com');
    assert.equal(url.pathname,'/maps/dir/');
    assert.deepEqual([...url.searchParams.getAll('destination')],['東京都 テスト&destination=overridden']);
    assert.equal(url.searchParams.get('api'),'1');
    assert.equal(Today.directions('  '),'');
});
const vm=require('node:vm'),fs=require('node:fs');
test('地図キーがなくても当日の一覧・次の訪問・リンク・完了切替を表示し、月を変更しない',()=>{
    const rows=[visit('now','2026-12-01T09:15',{company:'<見本>社',phone:'03-0000-0000',address:'架空の住所 & 1'}),
        visit('later','2026-12-01T11:00'),visit('done','2026-12-01T08:00',{status:'completed'}),visit('month','2026-11-29T12:00')];
    const nodes=new Map(), el=id=>{if(!nodes.has(id))nodes.set(id,{style:{},dataset:{},remove(){},setAttribute(k,v){this[k]=v;}});return nodes.get(id);};
    const ctx=vm.createContext({document:{getElementById:el},navigator:{onLine:false},VisitPlanner:Planner,
        GeocodeGuard:require('../map/geocode-guard'),ExpenseImport:require('../expense/expense-import'),RequestParser:{scheduleLabel:()=>''},
        DataStorage:{getCurrentWorkspaceId:()=> '2026-11',getWorkspaces:()=>[{id:'2026-11'},{id:'2026-12'}],
            getCustomers:()=>[rows[3]],getCustomersForWorkspace:id=>id==='2026-12'?rows.slice(0,3):[rows[3]],getRoutes:()=>[]},
        TodayVisits:{...Today,clock:()=>Today.clock(now)}});
    for(const f of ['route-pin-style','map-core'])vm.runInContext(fs.readFileSync(require.resolve('../map/'+f),'utf8'),ctx);
    const call=s=>vm.runInContext('MapCore.'+s,ctx);
    call('toggleToday()');
    assert.equal(el('mapTodayButton')['aria-pressed'],'true');
    assert.match(el('mapVisitView').textContent,/今日 12\/01 · 未完了 · 2件/);
    assert.match(el('mapTodayCard').innerHTML,/次の訪問 · 09:15/);
    assert.match(el('mapTodayCard').innerHTML,/&lt;見本&gt;社/);
    assert.match(el('mapTodayCard').innerHTML,/href="tel:0300000000"/);
    assert.match(el('mapTodayCard').innerHTML,/Google マップで経路を開く/);
    assert.match(el('mapTodayCard').innerHTML,/オフライン/);
    assert.doesNotMatch(el('customerList').innerHTML,/data-customer-id="(month|done)"/);
    call('toggleCompleted()');
    assert.match(el('customerList').innerHTML,/data-customer-id="done"/);
    assert.doesNotMatch(el('mapTodayCard').innerHTML,/次の訪問/);
    call('toggleToday()');
    assert.equal(el('mapTodayCard').hidden,true);
    assert.match(el('customerList').innerHTML,/data-customer-id="month"/);
    assert.doesNotMatch(el('customerList').innerHTML,/data-customer-id="now"/);
});

test('次の訪問の場所は明示された受付階と設置階を分け、不明な階を推測しない',()=>{
    const { locationDetails }=require('../map/today-visits.js');
    assert.deepEqual(locationDetails({address:'架空区1-8-1 架空センターＡＩＲ 16F受付15階設置'}),
      {address:'架空区1-8-1 架空センターＡＩＲ 16F受付15階設置',building:'',reception:'16F',equipment:'15階',other:''});
    assert.deepEqual(locationDetails({address:'架空区1-11-44 架空センター9F',buildingName:'架空センター',floors:['9F']}),
      {address:'架空区1-11-44 架空センター9F',building:'',reception:'',equipment:'',other:'9F'});
    assert.equal(locationDetails({address:'番地',buildingName:'別館',receptionFloor:'B1',equipmentFloor:'3階'}).building,'別館');
    assert.equal(locationDetails({address:'受付16Fと受付18F',floors:['16F','18F']}).reception,'');
    assert.equal(locationDetails({address:'架空ビル 受付16F 設置15F'}).equipment,'15F');
    assert.equal(locationDetails({address:'架空ビル 16F受付・設置15F'}).equipment,'15F');
    assert.equal(locationDetails({address:'架空ビル 15F'}).equipment,'');
});
