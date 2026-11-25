const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Planner=require('../map/visit-planner');

test('予定は日付と時刻の両方が必要で、未定や不正日付に時刻を補わない',()=>{
    assert.equal(Planner.combine('',''),'');
    assert.equal(Planner.combine('2026-10-20',''),null);
    assert.equal(Planner.combine('','09:00'),null);
    assert.equal(Planner.combine('2026-02-29','09:00'),null);
    assert.equal(Planner.combine('2028-02-29','09:00'),'2028-02-29T09:00');
    assert.equal(Planner.combine('2026-10-20','24:00'),null);
});
test('複数の電話番号を結合せず、全角と国番号を扱い危険な文字列をリンクにしない',()=>{
    assert.deepEqual(Planner.phoneNumbers('０３－００００－００００ / 090-0000-0000'),['0300000000','09000000000']);
    assert.deepEqual(Planner.phoneNumbers('+81 (3) 0000 0000'),['+81300000000']);
    assert.deepEqual(Planner.phoneNumbers('javascript:alert(1)'),[]);
});
test('月表示は年またぎと閏年を含む42日を順に返す',()=>{
    const days=Planner.monthDays('2028-02');
    assert.equal(days.length,42);assert.ok(days.includes('2028-02-29'));
    assert.equal(new Date(days[0]+'T12:00:00').getDay(),0);
    assert.ok(Planner.monthDays('2027-01')[0].startsWith('2026-12'));
    assert.equal(new Set(days).size,42);
});
test('訪問先の保存に失敗した時は成功結果を返さず、以前の予定を残す',()=>{
    const data=new Map([['mm_workspace_current','2026-10'],['mm_customers_2026-10','[{"id":"test","appoDate":"2026-10-20T09:00"}]']]);
    const context=vm.createContext({console:{error:()=>{}},alert:()=>{},AppStorage:{getItem:key=>data.get(key)||null,setItem:()=>{throw Error('quota');}}});
    vm.runInContext(fs.readFileSync(require.resolve('../map/map-data-storage'),'utf8'),context);
    assert.equal(vm.runInContext("DataStorage.updateCustomer('test',{appoDate:'2026-10-21T10:00'})",context),null);
    assert.equal(JSON.parse(data.get('mm_customers_2026-10'))[0].appoDate,'2026-10-20T09:00');
});
test('ピンを押すと安全な会社名・別々の電話リンク・日時備考の編集が表示される',()=>{
    let content='',click;
    const nodes=new Map();
    const context=vm.createContext({console,GeocodeGuard:require('../map/geocode-guard'),VisitPlanner:Planner,ExpenseImport:require('../expense/expense-import'),
        document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',hidden:false,setAttribute(){}});return nodes.get(id);}},
        DataStorage:{getSettings:()=>({}),getCustomers:()=>[],getRoutes:()=>[]},RouteManager:{updateRoutePanel:()=>{}},
        google:{maps:{Map:class{},Geocoder:class{},InfoWindow:class{setContent(html){content=html;}open(){}},
            Point:class{},Size:class{},Marker:class{addListener(name,callback){click=callback;}}}}
    });
    vm.runInContext(fs.readFileSync(require.resolve('../map/route-pin-style'),'utf8'),context);
    vm.runInContext(fs.readFileSync(require.resolve('../map/map-core'),'utf8'),context);
    vm.runInContext('MapCore.initMap(); MapCore.createMarker({id:"test",company:"<script>bad</script>",address:"東京都架空区1",phone:"03-0000-0000 / 090-0000-0000",status:"pending"},{lat:35,lng:139})',context);
    click();assert.match(content,/&lt;script&gt;bad&lt;\/script&gt;/);
    assert.match(content,/href="tel:0300000000"/);assert.match(content,/href="tel:09000000000"/);
    assert.match(content,/日時・備考を編集/);assert.doesNotMatch(content,/<script>/);
});
test('日程区分の変更だけでも破棄確認し、日時が空なら確定で保存しない',()=>{
    let asked=0;
    const nodes=new Map();
    const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',focus(){},textContent:'',innerHTML:''});return nodes.get(id)};
    const context=vm.createContext({document:{getElementById:el},ExpenseImport:{escapeHtml:String},
        DataStorage:{getWorkspaces:()=>[],getCurrentWorkspaceId:()=>''},
        GoogleVisitCalendar:{setRange(){},snapshot:()=>({connected:false})},
        confirm(){asked++;return false;}
    });
    vm.runInContext(fs.readFileSync(require.resolve('../map/visit-planner'),'utf8'),context);
    el('editCompany').value='架空会社';el('editAddress').value='東京都架空区';
    el('editScheduleKind').value='undated';
    vm.runInContext('VisitPlanner.begin({})',context);
    assert.equal(vm.runInContext('VisitPlanner.allowClose()',context),true);
    el('editScheduleKind').value='confirmed';
    assert.equal(vm.runInContext('VisitPlanner.allowClose()',context),false);
    assert.equal(asked,1);
    assert.equal(vm.runInContext('VisitPlanner.validate()',context),false);
    assert.match(el('visitEditError').textContent,/「確定」/);
    el('visitScheduleDay').value='2026-11-16'; el('visitScheduleTime').value='09:00';
    assert.equal(vm.runInContext('VisitPlanner.validate()',context),true);
});

test('終了日時は任意。指定するなら有効な日付・時刻が揃い、開始より後でなければならない',()=>{
    const start='2026-12-31T20:00';
    assert.equal(Planner.scheduleEnd(start,'',''),'');
    assert.equal(Planner.scheduleEnd(start,'2027-01-01','08:30'),'2027-01-01T08:30');
    assert.equal(Planner.scheduleEnd(start,'2026-12-31','20:01'),'2026-12-31T20:01');
    assert.equal(Planner.scheduleEnd(start,'2026-12-31','20:00'),null);
    assert.equal(Planner.scheduleEnd(start,'2026-12-30','20:00'),null);
    assert.equal(Planner.scheduleEnd(start,'2027-01-01',''),null);
    assert.equal(Planner.scheduleEnd(start,'2027-02-29','08:30'),null);
    assert.equal(Planner.scheduleEnd('','2027-01-01','08:30'),null);
});
test('月・年をまたいでも1件の予定を各日で表示し、終了が午前0時ならその日は含めない',()=>{
    const span={appoDate:'2026-12-31T20:00',appoEndDate:'2027-01-02T00:00'};
    assert.equal(Planner.onDay(span,'2026-12-30'),false);
    assert.equal(Planner.onDay(span,'2026-12-31'),true);
    assert.equal(Planner.onDay(span,'2027-01-01'),true);
    assert.equal(Planner.onDay(span,'2027-01-02'),false);
    assert.equal(Planner.timeLabel(span,'2026-12-31'),'20:00〜翌日以降');
    assert.equal(Planner.timeLabel(span,'2027-01-01'),'前日以前から〜24:00');
    assert.equal(Planner.timeLabel({...span,appoEndDate:'2027-01-01T08:30'},'2027-01-01'),'前日以前から〜08:30');
    assert.equal(Planner.onDay({appoDate:span.appoDate},'2027-01-01'),false);
    assert.equal(Planner.timeLabel({appoDate:span.appoDate},'2026-12-31'),'20:00');
    assert.equal(Planner.onDay({...span,appoEndDate:'2027-02-30T12:00'},'2027-01-01'),false);
});
test('Google カレンダーのテンプレートに開始・終了と日本時間を渡し、終了なしは従来どおり1時間',()=>{
    const ctx=vm.createContext({document:{addEventListener(){}}});
    vm.runInContext(fs.readFileSync(require.resolve('../map/ui-actions'),'utf8'),ctx);
    const build=vm.runInContext('buildGcalUrl',ctx);
    let params=new URL(build('架空','東京都架空区','2026-12-31T23:30','','','','2027-01-02T08:30')).searchParams;
    assert.equal(params.get('dates'),'20261231T143000Z/20270101T233000Z');
    assert.equal(params.get('ctz'),'Asia/Tokyo');
    params=new URL(build('架空','東京都架空区','2026-12-31T23:30','','','')).searchParams;
    assert.equal(params.get('dates'),'20261231T143000Z/20261231T153000Z');
});

test('編集画面で月をまたぐ終了日時を保存し、同じIDのまま両日に表示して再編集できる',()=>{
    const nodes=new Map();
    const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',focus(){}});return nodes.get(id)};
    const visit={id:'night',company:'架空会社（泊まり）',address:'東京都架空区',status:'pending',appoDate:null};
    const data=new Map([
        ['mm_workspace_current','2026-11'],
        ['mm_workspaces',JSON.stringify([{id:'2026-11',name:'11月'}])],
        ['mm_customers_2026-11',JSON.stringify([visit])]
    ]);
    const context=vm.createContext({console,document:{getElementById:el,addEventListener(){}},ExpenseImport:{escapeHtml:String},
        AppStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)},
        GoogleVisitCalendar:{setRange(){},snapshot:()=>({connected:false})},
        MapCore:{getCurrentEditId:()=>visit.id,refreshAllMarkers(){}},
        RouteManager:{updateRoutePanel(){}},confirm:()=>false
    });
    for(const file of ['map-data-storage','visit-planner','ui-actions']){
        vm.runInContext(fs.readFileSync(require.resolve('../map/'+file),'utf8'),context);
    }
    const run=code=>vm.runInContext(code,context);
    context.showGcalConfirm=(...args)=>{context.calendarArgs=args;};
    el('editCompany').value=visit.company;el('editAddress').value=visit.address;
    el('editScheduleKind').value='confirmed';
    el('visitDateSourceWarning').hidden=true;
    run("VisitPlanner.begin(DataStorage.findCustomer('night'))");
    el('visitScheduleDay').value='2026-11-30'; el('visitScheduleTime').value='18:00';
    el('visitScheduleEndDay').value='2026-12-01';
    assert.equal(run('VisitPlanner.allowClose()'),false);
    run('saveEdit()');
    assert.match(el('visitEditError').textContent,/終了日と終了時刻/);
    assert.equal(JSON.parse(data.get('mm_customers_2026-11'))[0].appoDate,null);
    el('visitScheduleEndTime').value='09:30';
    run('saveEdit()');
    const saved=JSON.parse(data.get('mm_customers_2026-11'));
    assert.equal(saved.length,1);
    assert.equal(saved[0].id,'night');
    assert.equal(saved[0].appoDate,'2026-11-30T18:00');
    assert.equal(saved[0].appoEndDate,'2026-12-01T09:30');
    assert.equal(context.calendarArgs[6],saved[0].appoEndDate);
    assert.equal(data.has('mm_customers_2026-12'),false);
    run("VisitPlanner.begin(DataStorage.findCustomer('night'))");
    assert.equal(el('visitScheduleEndDetails').open,true);
    assert.equal(el('visitScheduleEndDay').value,'2026-12-01');
    assert.equal(el('visitScheduleEndTime').value,'09:30');
    assert.match(el('visitAgenda').innerHTML,/18:00〜翌日以降/);
    assert.match(el('visitCalendarDays').innerHTML,/2026-12-01、アプリ1件/);
    el('visitScheduleEndDay').value=''; el('visitScheduleEndTime').value='';
    run('saveEdit()');
    assert.equal(JSON.parse(data.get('mm_customers_2026-11'))[0].appoEndDate,null);
    assert.match(el('visitCalendarDays').innerHTML,/2026-12-01、アプリ0件/);
});

function workActualHarness() {
    const nodes=new Map();
    const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,open:false,focus(){},setAttribute(){},onclick:null});return nodes.get(id)};
    const context=vm.createContext({console,document:{getElementById:el,addEventListener(){},querySelectorAll:()=>[]},
        ExpenseImport:{escapeHtml:String},
        DataStorage:{getWorkspaces:()=>[],getCurrentWorkspaceId:()=>''},
        GoogleVisitCalendar:{setRange(){},snapshot:()=>({connected:false})}
    });
    vm.runInContext(fs.readFileSync(require.resolve('../map/equipment-history'),'utf8'),context);
    vm.runInContext(fs.readFileSync(require.resolve('../map/equipment-history-ui'),'utf8'),context);
    vm.runInContext(fs.readFileSync(require.resolve('../map/visit-planner'),'utf8'),context);
    el('editCompany').value='架空商事'; el('editAddress').value='東京都架空区試験1-2-3';
    el('editStatus').value='appointed';
    el('visitScheduleDay').value='2026-11-30'; el('visitScheduleTime').value='11:00';
    return {el, run:code=>vm.runInContext(code,context)};
}

test('作業実績が全部空なら、未完了でも予定・備考を保存できる',()=>{
    const {run,el}=workActualHarness();
    run('VisitPlanner.begin({})');
    assert.equal(el('workActualDay').value,'');
    assert.equal(el('workActualStart').value,'');
    assert.equal(el('workActualEnd').value,'');
    assert.equal(el('workActualSummary').value,'');
    assert.equal(run('VisitPlanner.validate()'),true);
    assert.equal(el('visitEditError').textContent,'');
});

test('未完了で実績の日付だけ入っていると保存できず、取り消し案内がある',()=>{
    const {run,el}=workActualHarness();
    run('VisitPlanner.begin({})');
    el('workActualDay').value='2026-11-26';
    assert.equal(run('VisitPlanner.validate()'),false);
    assert.match(el('visitEditError').textContent,/完了/);
    assert.match(el('visitEditError').textContent,/実績の入力を取り消す/);
});

test('実績の入力を取り消すと、日付・時刻・作業内容が空になり未完了でも保存できる',()=>{
    const {run,el}=workActualHarness();
    run('VisitPlanner.begin({})');
    el('workActualDay').value='2026-11-26';
    el('workActualStart').value='10:00';
    el('workActualEnd').value='11:00';
    el('workActualSummary').value='架空の交換部材';
    run('VisitPlanner.validate()');
    run('EquipmentHistoryUI.clear()');
    assert.equal(el('workActualDay').value,'');
    assert.equal(el('workActualStart').value,'');
    assert.equal(el('workActualEnd').value,'');
    assert.equal(el('workActualSummary').value,'');
    assert.equal(el('visitEditError').textContent,'');
    assert.equal(run('VisitPlanner.validate()'),true);
});

test('各欄の未選択は、その項目だけ空にする',()=>{
    const {run,el}=workActualHarness();
    run('VisitPlanner.begin({})');
    el('workActualDay').value='2026-11-26';
    el('workActualStart').value='10:00';
    el('workActualEnd').value='11:00';
    run('EquipmentHistoryUI.clearField("workActualDay")');
    assert.equal(el('workActualDay').value,'');
    assert.equal(el('workActualStart').value,'10:00');
    assert.equal(el('workActualEnd').value,'11:00');
});

test('完了で実績が揃っていれば、従来どおり保存できる',()=>{
    const {run,el}=workActualHarness();
    run('VisitPlanner.begin({status:"completed",workActual:{day:"2026-11-20",start:"09:00",end:"10:30",summary:"架空の交換"}})');
    el('editStatus').value='completed';
    assert.equal(el('workActualDay').value,'2026-11-20');
    assert.equal(el('workActualStart').value,'09:00');
    assert.equal(el('workActualEnd').value,'10:30');
    assert.equal(el('workActualSummary').value,'架空の交換');
    assert.equal(run('VisitPlanner.validate()'),true);
    assert.equal(run('JSON.stringify(EquipmentHistory.actual(EquipmentHistoryUI.input()))'),JSON.stringify({day:'2026-11-20',start:'09:00',end:'10:30',summary:'架空の交換'}));
});

test('保存済みの実績がなければ、編集を開いても作業日に今日の日付を入れない',()=>{
    const {run,el}=workActualHarness();
    run('VisitPlanner.begin({company:"架空商事",address:"東京都架空区試験1-2-3",status:"pending"})');
    assert.equal(el('workActualDay').value,'');
    assert.equal(el('workActualDetails').open,false);
    assert.equal(run('VisitPlanner.validate()'),true);
});
