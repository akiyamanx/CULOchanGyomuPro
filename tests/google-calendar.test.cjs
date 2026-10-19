const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Data=require('../map/google-calendar-data');
const calendar={id:'work@example.invalid',name:'仕事用（架空）'};
const event=(start,end,other={})=>({id:'event',summary:'A社 訪問',start:{dateTime:start},end:{dateTime:end},...other});
const timed=(other={})=>Data.normalizeEvent(event('2026-10-19T09:00:00+09:00','2026-10-19T10:00:00+09:00',other),calendar);
const response=data=>({ok:true,json:async()=>data});
test('日本時間で日をまたぐ予定と終了ちょうどの境界を表示する',()=>{
    const row=Data.normalizeEvent(event('2026-10-18T14:30:00Z','2026-10-19T15:00:00Z'),calendar);
    assert.equal(Data.timeLabel(row,'2026-10-18'),'23:30〜翌日以降');
    assert.equal(Data.timeLabel(row,'2026-10-19'),'前日から〜24:00');
    assert.equal(Data.onDay(row,'2026-10-20'),false);
    assert.equal(Data.atStart(timed(),'2026-10-19T09:00'),true);
    assert.equal(Data.atStart(timed(),'2026-10-19T10:00'),false);
});
test('終日予定の終了日は含めず、複数日と閏日を扱う',()=>{
    const row=Data.normalizeEvent({id:'all-day',start:{date:'2028-02-28'},end:{date:'2028-03-01'}},calendar);
    assert.equal(Data.onDay(row,'2028-02-29'),true);assert.equal(Data.onDay(row,'2028-03-01'),false);
    assert.equal(Data.timeLabel(row,'2028-02-29'),'終日');assert.equal(Data.nextDay('2028-02-29'),'2028-03-01');
    assert.throws(()=>Data.nextDay('2026-02-29'));
});
test('キャンセルは除外、非公開は予定あり、不参加・透明予定は衝突扱いしない',()=>{
    assert.equal(Data.normalizeEvent({status:'cancelled'},calendar),null);
    assert.match(timed({summary:undefined}).title,/予定あり/);
    assert.equal(Data.atStart(timed({transparency:'transparent'}),'2026-10-19T09:30'),false);
    assert.equal(timed({attendees:[{self:true,responseStatus:'declined'}]}).busy,false);
    assert.throws(()=>Data.normalizeEvent(event('2026-10-19T09:00:00','2026-10-19T10:00:00'),calendar));
    assert.throws(()=>Data.normalizeEvent(event('2026-10-19T10:00:00Z','2026-10-19T09:00:00Z'),calendar));
});
test('カレンダー一覧の続きと読み取り権限を扱う',async()=>{
    const pages=[{items:[{id:'work',summary:'仕事',accessRole:'owner',primary:true}],nextPageToken:'next'},
        {items:[{id:'private',summary:'個人',accessRole:'reader'},{id:'busy',summary:'共有',accessRole:'freeBusyReader'}]}];
    const urls=[];const rows=await Data.createReader(async url=>{urls.push(url);return response(pages.shift());}).calendars('test-token');
    assert.equal(rows.length,3);assert.equal(rows[2].readable,false);assert.match(urls[1],/pageToken=next/);
});
test('繰り返し展開・全ページ取得・期間指定。認証情報はURLや保存に渡さない',async()=>{
    const requests=[];let page=0;
    const rows=await Data.createReader(async(url,options)=>{requests.push({url,options});return response(++page===1?
        {items:[event('2026-10-19T09:00:00+09:00','2026-10-19T10:00:00+09:00')],nextPageToken:'next'}:
        {items:[event('2026-10-20T09:00:00+09:00','2026-10-20T10:00:00+09:00',{id:'repeat-instance'})]});})
        .events([calendar],'2026-10-01','2026-10-31','fake-token');
    assert.equal(rows.length,2);
    const url=new URL(requests[0].url);assert.equal(url.searchParams.get('singleEvents'),'true');
    assert.equal(url.searchParams.get('timeMax'),'2026-11-01T00:00:00+09:00');
    assert.equal(url.searchParams.get('timeZone'),'Asia/Tokyo');assert.doesNotMatch(url.href,/fake-token/);
    assert.equal(requests[0].options.headers.Authorization,'Bearer fake-token');assert.equal(requests[0].options.cache,'no-store');
    assert.match(requests[1].url,/pageToken=next/);
});
test('1つのカレンダーや続きの読み込みが失敗しても部分結果を返さない',async()=>{
    let page=0;const reader=Data.createReader(async()=>++page===1?response({items:[event('2026-10-19T09:00:00Z','2026-10-19T10:00:00Z')],nextPageToken:'more'}):{ok:false,status:403});
    await assert.rejects(reader.events([calendar],'2026-10-01','2026-10-31','fake'),/権限/);
    await assert.rejects(Data.createReader(async()=>response({items:'invalid'})).calendars('fake'),/応答/);
    await assert.rejects(Data.createReader(async()=>({ok:false,status:401})).calendars('fake'),error=>error.status===401);
});
function harness(fetcher) {
    const nodes=new Map(),writes=[],timers=[];let auth,callbacks=[];
    const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',hidden:false,dataset:{},addEventListener(type,fn){this[type]=fn;},focus(){this.focused=true;}});return nodes.get(id);};
    const context=vm.createContext({GoogleCalendarData:Data,ExpenseImport:require('../expense/expense-import'),Date,Intl,URLSearchParams,AbortController,
        setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){},fetch:fetcher,
        localStorage:{getItem:()=> '123-fake.apps.googleusercontent.com',setItem:(key,value)=>writes.push({key,value})},
        document:{getElementById:node},window:{addEventListener(){},google:{accounts:{oauth2:{hasGrantedAllScopes:()=>true,
            initTokenClient(options){auth=options;return{requestAccessToken(){callbacks.push(options.callback);}};},revoke(token,done){done({successful:true});}}}}}});
    vm.runInContext(fs.readFileSync(require.resolve('../map/google-visit-calendar'),'utf8'),context);
    vm.runInContext('GoogleVisitCalendar.init(()=>{});GoogleVisitCalendar.setRange("2026-10-01","2026-10-31");',context);
    const state=()=>vm.runInContext('GoogleVisitCalendar.snapshot()',context);
    return{node,writes,timers,state,context,connect(){node('googleCalendarConnect').click();return auth;},callbacks};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const listResponse=()=>response({items:[{id:'work',summary:'仕事（架空）',accessRole:'owner',primary:true}]});
test('接続拒否・部分許可で予定を取得せず、トークンや予定を保存しない',async()=>{
    let calls=0;const h=harness(async()=>{calls++;return listResponse();});
    const auth=h.connect();auth.callback({error:'access_denied'});
    assert.equal(h.state().status,'error');assert.equal(calls,0);assert.equal(h.writes.length,0);
    const next=h.connect();h.context.window.google.accounts.oauth2.hasGrantedAllScopes=()=>false;
    next.callback({access_token:'fake-secret',expires_in:3600});assert.equal(calls,0);assert.equal(h.state().connected,false);
});
test('アカウント切替・解除後に遅れて返った予定は表示しない',async()=>{
    let finish;const h=harness(async url=>url.includes('calendarList')?listResponse():new Promise(resolve=>finish=resolve));
    h.connect().callback({access_token:'fake-secret',expires_in:3600});await tick();
    h.node('googleCalendarDisconnect').click();finish(response({items:[event('2026-10-19T09:00:00Z','2026-10-19T10:00:00Z')]}));await tick();
    assert.equal(h.state().status,'disconnected');assert.equal(h.state().events.length,0);assert.equal(h.writes.length,0);
    const old=h.connect();h.node('googleCalendarDisconnect').click();old.callback({access_token:'late-token',expires_in:3600});
    assert.equal(h.state().connected,false);
});
test('日付を素早く変えても古い月の応答を混ぜず、期限切れで内容を消す',async()=>{
    const pending=[];const h=harness(async url=>url.includes('calendarList')?listResponse():new Promise(resolve=>pending.push(resolve)));
    h.connect().callback({access_token:'fake',expires_in:3600});await tick();
    vm.runInContext('GoogleVisitCalendar.setRange("2026-11-01","2026-11-30")',h.context);await tick();
    pending[1](response({items:[event('2026-11-19T09:00:00Z','2026-11-19T10:00:00Z',{id:'new'})]}));await tick();
    pending[0](response({items:[event('2026-10-19T09:00:00Z','2026-10-19T10:00:00Z',{id:'old'})]}));await tick();
    assert.match(h.state().events[0].id,/new/);assert.equal(h.state().status,'ready');
    h.timers.find(t=>t.ms>3000000).fn();assert.equal(h.state().status,'expired');assert.equal(h.state().events.length,0);
});
test('通信失敗・カレンダー未選択を予定ゼロの成功扱いにしない',async()=>{
    const h=harness(async url=>url.includes('calendarList')?listResponse():{ok:false,status:503});
    h.connect().callback({access_token:'fake',expires_in:3600});await tick();
    assert.equal(h.state().status,'error');assert.equal(h.state().events.length,0);
    h.node('googleCalendarChoices').change({target:{dataset:{googleCalendar:'0'},checked:false}});await tick();
    assert.equal(h.state().status,'unselected');
});
test('Google予定の題名・場所・カレンダー名をHTMLとして実行しない',()=>{
    const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:''});return nodes.get(id);};
    const row=timed({summary:'<img src=x onerror=alert(1)>',location:'<script>bad</script>'});row.calendarName='<b>private</b>';
    const context=vm.createContext({Date,GoogleCalendarData:Data,ExpenseImport:require('../expense/expense-import'),
        document:{getElementById:node},DataStorage:{getWorkspaces:()=>[],getCurrentWorkspaceId:()=>'',getCustomersForWorkspace:()=>[]},
        MapCore:{getCurrentEditId:()=>''},GoogleVisitCalendar:{setRange(){},snapshot:()=>({status:'ready',events:[row],first:'2026-10-01',last:'2026-10-31',connected:false})}});
    vm.runInContext(fs.readFileSync(require.resolve('../map/visit-planner'),'utf8'),context);
    vm.runInContext('VisitPlanner.begin({appoDate:"2026-10-19T09:30"})',context);
    assert.doesNotMatch(node('googleVisitAgenda').innerHTML,/<(?:img|script|b>private)/);
    assert.match(node('googleVisitAgenda').innerHTML,/&lt;img/);assert.match(node('visitScheduleHint').textContent,/重なって/);
});
test('Service WorkerはGoogle予定の認証付き通信をキャッシュしない',()=>{
    const handlers={};const context=vm.createContext({URL,self:{addEventListener:(name,fn)=>handlers[name]=fn}});
    vm.runInContext(fs.readFileSync(require.resolve('../sw.js'),'utf8'),context);
    for(const url of ['https://www.googleapis.com/calendar/v3/calendars/primary/events','https://accounts.google.com/gsi/client']) {
        handlers.fetch({request:{url,headers:{has:()=>false}},respondWith(){assert.fail('private request intercepted');}});
    }
    handlers.fetch({request:{url:'https://example.invalid',headers:{has:()=>true}},respondWith(){assert.fail('authorization intercepted');}});
});
