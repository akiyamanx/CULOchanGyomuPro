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
        const days=monthDays(month), counts={};
        appointments.forEach(c=>{const key=c.appoDate.slice(0,10);counts[key]=(counts[key]||0)+1;});
        byId('visitCalendarMonth').textContent=month.replace('-','年')+'月';
        byId('visitCalendarDays').innerHTML=days.map(day=>`<button type="button" data-visit-day="${day}" class="visit-day ${day.startsWith(month)?'':'outside-month'}" aria-label="${day}、保存済み予定${counts[day]||0}件" aria-pressed="${day===selectedDay}">${Number(day.slice(-2))}<small>${counts[day]?counts[day]+'件':'　'}</small></button>`).join('');
        byId('visitAgendaTitle').textContent=selectedDay+' の保存済み予定';
        const rows=appointments.filter(c=>c.appoDate.startsWith(selectedDay));
        byId('visitAgenda').innerHTML=readFailed ? '<p role="alert">保存済み予定を読み込めません。空き時間とは判断せず、元のデータを確認してください。</p>' : rows.length ? '<ul>'+rows.map(c=>`<li><strong>${esc(c.appoDate.slice(11,16))}</strong><span>${esc(c.company)}<small>${esc(c.purpose||'作業内容未設定')} · ${c.status==='appointed'?'アポ済み':c.status==='completed'?'完了':'未アポ'}</small></span></li>`).join('')+'</ul>' : '<p>この日に保存された訪問予定はありません。</p>';
        const proposed=combine(byId('visitScheduleDay').value,byId('visitScheduleTime').value);
        const duplicate=proposed && appointments.some(c=>c.appoDate===proposed && !(c.id===MapCore.getCurrentEditId() && c.workspace===DataStorage.getCurrentWorkspaceId()));
        byId('visitScheduleHint').textContent=duplicate ? '同じ時刻の訪問予定があります。移動時間も含めて確認してください。' : '日付と時刻を入力して保存。アポ確定後は「アポ済み」に変更してください。';
    }
    function sync() {
        const day=byId('visitScheduleDay').value, time=byId('visitScheduleTime').value;
        byId('editAppoDate').value=combine(day,time)||'';
        if (day) {selectedDay=day;month=day.slice(0,7);}
        renderCalendar();
    }
    function begin(customer) {
        byId('visitEditorName').textContent=customer.company||'訪問先';
        byId('visitEditorAddress').textContent=customer.address||'';
        byId('visitScheduleDay').value=(customer.appoDate||'').slice(0,10);
        byId('visitScheduleTime').value=(customer.appoDate||'').slice(11,16);
        selectedDay=byId('visitScheduleDay').value||dayKey(new Date()); month=selectedDay.slice(0,7);
        byId('visitEditError').textContent='';
        readAppointments(); refreshPhone(); renderCalendar(); baseline=signature();
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
            month=dayKey(date).slice(0,7);renderCalendar();
        }));
    }
    return {init,begin,validate,allowClose,saved,phoneNumbers,combine,monthDays};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=VisitPlanner;
