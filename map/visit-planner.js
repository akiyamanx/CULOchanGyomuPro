// Appointment helpers and the calendar beside the existing visit editor.
const VisitPlanner = (() => {
    const pad = value => String(value).padStart(2,'0');
    const dayKey = date => `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    const esc = value => ExpenseImport.escapeHtml(String(value ?? ''));
    const byId = id => document.getElementById(id);
    let month = '', selectedDay = '', appointments = [], readFailed = false, baseline = '';
    const fields = ['editCompany','editAddress','editPhone','editContact','editRoute','editStatus','editPurpose','editNote','visitScheduleDay','visitScheduleTime'];
    function combine(day,time) {
        if (!day && !time) return '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
        const date = new Date(`${day}T12:00:00`);
        return !isNaN(date.getTime()) && dayKey(date) === day ? `${day}T${time}` : null;
    }
    function phoneNumbers(value) {
        return [...new Set(String(value||'').normalize('NFKC').split(/[\/／,，;\n]+/).map(part=>{
            const found=part.match(/\+?\d[\d() -]{7,}\d/);
            return found ? found[0].replace(/[^\d+]/g,'') : '';
        }).filter(phone=>/^\+?\d{9,15}$/.test(phone)))];
    }
    function monthDays(value) {
        const [year,number]=value.split('-').map(Number), first=new Date(year,number-1,1);
        return Array.from({length:42},(_,i)=>dayKey(new Date(year,number-1,i-first.getDay()+1)));
    }
    function readAppointments() {
        readFailed=false;
        try {
            const ids=[...new Set([...DataStorage.getWorkspaces().map(ws=>ws.id),DataStorage.getCurrentWorkspaceId()])].filter(Boolean);
            appointments=ids.flatMap(workspace=>DataStorage.getCustomersForWorkspace(workspace).filter(c=>c.appoDate)
                .map(c=>({...c,workspace}))).sort((a,b)=>a.appoDate.localeCompare(b.appoDate));
        } catch (error) { appointments=[]; readFailed=true; }
    }
    const signature = () => JSON.stringify(fields.map(id=>byId(id).value));
    function refreshPhone() {
        const phones=phoneNumbers(byId('editPhone').value);
        byId('visitPhoneActions').innerHTML=phones.length ? phones.map((phone,i)=>`<a class="btn visit-call" href="tel:${esc(phone)}">電話${phones.length>1?' '+(i+1):'をかける'}<small>${esc(phone)}</small></a>`).join('') : '<span class="visit-help">電話番号が未登録です</span>';
    }
    function renderCalendar() {
        if(!month)return;
        const days=monthDays(month), counts={};
        const google=typeof GoogleVisitCalendar==='undefined'?null:GoogleVisitCalendar.snapshot();
        const googleEvents=google?.status==='ready'?google.events:[];
        const focusedDay=document.activeElement?.dataset?.visitDay;
        appointments.forEach(c=>{const key=c.appoDate.slice(0,10);counts[key]=(counts[key]||0)+1;});
        byId('visitCalendarMonth').textContent=month.replace('-','年')+'月';
        byId('visitCalendarDays').innerHTML=days.map(day=>{
            const gcount=googleEvents.filter(event=>GoogleCalendarData.onDay(event,day)).length;
            return `<button type="button" data-visit-day="${day}" class="visit-day ${day.startsWith(month)?'':'outside-month'}" aria-label="${day}、アプリ${counts[day]||0}件、Google${google?.status==='ready'?gcount+'件':'未確認'}" aria-pressed="${day===selectedDay}">${Number(day.slice(-2))}<small>${gcount?'G '+gcount:google?.status==='ready'?'':'G ?'}</small><small>${counts[day]?'訪 '+counts[day]:'　'}</small></button>`;
        }).join('');
        if(focusedDay&&days.includes(focusedDay))byId('visitCalendarDays').querySelector(`[data-visit-day="${focusedDay}"]`)?.focus({preventScroll:true});
        byId('visitSelectedDay').textContent=selectedDay.replaceAll('-','/');
        const googleRows=googleEvents.filter(event=>GoogleCalendarData.onDay(event,selectedDay));
        const checked=google?.status==='ready'&&selectedDay>=google.first&&selectedDay<=google.last;
        byId('googleVisitAgenda').innerHTML=!checked ? '<p class="visit-unconfirmed">'+esc(google?.status==='loading'?'Googleの予定を読み込み中です…':google?.status==='ready'?'表示中の月カレンダーから日付を選んでください。':'Googleの予定はまだ確認できていません。上の接続状態を確認してください。')+'</p>' :
            googleRows.length?'<ul>'+googleRows.map(event=>`<li><strong class="visit-event-time">${esc(GoogleCalendarData.timeLabel(event,selectedDay))}</strong><span class="visit-event-source">Google · ${esc(event.calendarName)}</span><b>${esc(event.title)}</b>${event.location?`<small>場所：${esc(event.location)}</small>`:''}${!event.busy?`<small>${event.declined?'不参加':'予定あり・時間は空きとして登録'}</small>`:event.tentative?'<small>仮の予定</small>':''}</li>`).join('')+'</ul>':'<p>選択中のGoogleカレンダーに、この日の予定はありません。</p>';
        byId('visitAgendaTitle').textContent='このアプリに保存した訪問予定';
        const rows=appointments.filter(c=>c.appoDate.startsWith(selectedDay));
        byId('visitAgenda').innerHTML=readFailed ? '<p role="alert">保存済み予定を読み込めません。空き時間とは判断せず、元のデータを確認してください。</p>' : rows.length ? '<ul>'+rows.map(c=>`<li><strong>${esc(c.appoDate.slice(11,16))}</strong><span>${esc(c.company)}<small>${esc(c.purpose||'作業内容未設定')} · ${c.status==='appointed'?'アポ済み':c.status==='completed'?'完了':'未アポ'}</small><small>${esc(c.address||'')}</small></span></li>`).join('')+'</ul>' : '<p>この日に保存された訪問予定はありません。</p>';
        const proposed=combine(byId('visitScheduleDay').value,byId('visitScheduleTime').value);
        const duplicate=proposed && appointments.some(c=>c.appoDate===proposed && !(c.id===MapCore.getCurrentEditId() && c.workspace===DataStorage.getCurrentWorkspaceId()));
        const googleConflict=proposed&&checked&&googleRows.some(event=>GoogleCalendarData.atStart(event,proposed));
        byId('visitScheduleHint').textContent=googleConflict?'訪問開始時刻がGoogleの予定と重なっています。予定の時間・移動時間を確認してください。':duplicate ? '同じ時刻の訪問予定があります。移動時間も含めて確認してください。' : '日付と時刻を入力して保存。作業時間と移動時間も考えて予定を組んでください。';
    }
    function loadGoogleMonth() {
        const days=monthDays(month);GoogleVisitCalendar.setRange(days[0],days[41]);
    }
    function sync() {
        const day=byId('visitScheduleDay').value, time=byId('visitScheduleTime').value;
        byId('editAppoDate').value=combine(day,time)||'';
        if (day) {selectedDay=day;month=day.slice(0,7);}
        loadGoogleMonth();renderCalendar();
    }
    function begin(customer) {
        byId('visitEditorName').textContent=customer.company||'訪問先';
        byId('visitEditorAddress').textContent=customer.address||'';
        byId('visitScheduleDay').value=(customer.appoDate||'').slice(0,10);
        byId('visitScheduleTime').value=(customer.appoDate||'').slice(11,16);
        selectedDay=byId('visitScheduleDay').value||dayKey(new Date()); month=selectedDay.slice(0,7);
        byId('visitEditError').textContent='';
        readAppointments(); refreshPhone();loadGoogleMonth();renderCalendar();baseline=signature();
        if(GoogleVisitCalendar.snapshot().connected&&GoogleVisitCalendar.snapshot().status!=='loading')GoogleVisitCalendar.refresh();
    }
    function validate() {
        const value=combine(byId('visitScheduleDay').value,byId('visitScheduleTime').value);
        let message='';
        if (!byId('editCompany').value.trim()||!byId('editAddress').value.trim()) message='会社名と住所を入力してください。';
        else if (value===null) message='訪問日と時刻を両方入力してください。未定に戻す場合は両方を空欄にします。';
        byId('visitEditError').textContent=message;
        if(message){byId('visitEditError').focus();return false;}
        byId('editAppoDate').value=value;return true;
    }
    function allowClose() { return signature()===baseline || confirm('保存していない変更があります。変更を破棄して閉じますか？'); }
    function saved() { baseline=signature();readAppointments();renderCalendar(); }
    function init() {
        GoogleVisitCalendar.init(renderCalendar);
        byId('editModal').addEventListener('input',event=>{
            if(!fields.includes(event.target.id))return;
            restoreEditButtons(); byId('visitEditError').textContent='';
            if(event.target.id==='editPhone')refreshPhone();
            if(event.target.id.startsWith('visitSchedule'))sync();
        });
        byId('visitCalendarDays').addEventListener('click',event=>{
            const button=event.target.closest('[data-visit-day]');if(!button)return;
            const day=button.dataset.visitDay;
            byId('visitScheduleDay').value=day;restoreEditButtons();sync();
            byId('visitCalendarDays').querySelector(`[data-visit-day="${day}"]`)?.focus({preventScroll:true});
        });
        document.querySelectorAll('[data-visit-month]').forEach(button=>button.addEventListener('click',()=>{
            const date=new Date(month+'-01T12:00:00');date.setMonth(date.getMonth()+Number(button.dataset.visitMonth));
            month=dayKey(date).slice(0,7);loadGoogleMonth();renderCalendar();
        }));
        document.querySelectorAll('[data-visit-shift]').forEach(button=>button.addEventListener('click',()=>{
            const date=new Date(selectedDay+'T12:00:00');date.setDate(date.getDate()+Number(button.dataset.visitShift));
            byId('visitScheduleDay').value=dayKey(date);restoreEditButtons();sync();
        }));
    }
    return {init,begin,validate,allowClose,saved,phoneNumbers,combine,monthDays};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=VisitPlanner;
