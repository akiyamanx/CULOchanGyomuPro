// Read-only Calendar API boundary. No credentials or event data are persisted here.
const GoogleCalendarData = (() => {
    const zone = 'Asia/Tokyo';
    const scopes = ['https://www.googleapis.com/auth/calendar.events.readonly', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
    const text = value => typeof value === 'string' ? value : '';
    function validDay(day) {
        return /^\d{4}-\d{2}-\d{2}$/.test(day) && !isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day;
    }
    function nextDay(day) {
        if (!validDay(day)) throw Error('日付を確認してください。');
        return new Date(Date.parse(day)+86400000).toISOString().slice(0,10);
    }
    function dayBounds(day) {
        return [Date.parse(day+'T00:00:00+09:00'), Date.parse(nextDay(day)+'T00:00:00+09:00')];
    }
    function japanDay(ms) { return new Date(ms+9*3600000).toISOString().slice(0,10); }
    function clock(ms) { return new Date(ms+9*3600000).toISOString().slice(11,16); }
    function normalizeEvent(raw, calendar) {
        if (!raw || typeof raw !== 'object') throw Error('Googleの予定の形式を確認できません。');
        if (raw.status === 'cancelled') return null;
        const allDay = !!raw.start?.date;
        let start, end;
        if (allDay) {
            if (!validDay(raw.start.date) || !validDay(raw.end?.date)) throw Error('Googleの終日予定の日付を確認できません。');
            start=dayBounds(raw.start.date)[0];end=dayBounds(raw.end.date)[0];
        } else {
            const timestamp = value => typeof value === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
            start=timestamp(raw.start?.dateTime);end=timestamp(raw.end?.dateTime);
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text(raw.id)) throw Error('Googleの予定の時刻を確認できません。');
        const declined=Array.isArray(raw.attendees) && raw.attendees.some(a=>a?.self && a.responseStatus==='declined');
        return {id:calendar.id+':'+raw.id, calendarId:calendar.id, calendarName:calendar.name,
            title:text(raw.summary)||'予定あり（詳細非公開）', location:text(raw.location), start, end, allDay,
            busy:raw.transparency!=='transparent' && !declined, declined, tentative:raw.status==='tentative'};
    }
    function onDay(event, day) { const [start,end]=dayBounds(day);return event.start < end && event.end > start; }
    function timeLabel(event, day) {
        if(event.allDay)return '終日';
        const [start,end]=dayBounds(day);
        return (event.start<start?'前日から':clock(event.start))+'〜'+(event.end>end?'翌日以降':event.end===end?'24:00':clock(event.end));
    }
    function atStart(event, value) {
        const start=Date.parse(value+':00+09:00');return event.busy && event.start<=start && event.end>start;
    }
    function apiError(status) {
        const error=Error(status===401?'Googleとの接続期限が切れました。接続し直してください。':
            status===403?'Googleの予定を読み込めません。Calendar APIの有効化と閲覧権限を確認してください。':
            status===429?'Googleへの読み込みが混み合っています。少し待って「更新」を押してください。':
            'Googleの予定を読み込めませんでした。通信を確認して「更新」を押してください。');
        error.status=status;return error;
    }
    function createReader(fetcher) {
        async function pages(path, params, token, signal) {
            const items=[], seen=new Set();let pageToken='';
            do {
                if(seen.has(pageToken)||seen.size>=100)throw Error('予定が多いため最後まで読み込めませんでした。Googleカレンダーで確認してください。');
                seen.add(pageToken);
                const query=new URLSearchParams(params);if(pageToken)query.set('pageToken',pageToken);
                let response;
                try { response=await fetcher('https://www.googleapis.com/calendar/v3/'+path+'?'+query,
                    {headers:{Authorization:'Bearer '+token},signal,cache:'no-store',credentials:'omit',redirect:'error'}); }
                catch(error) {if(error.name==='AbortError')throw error;throw apiError(0);}
                if(!response.ok)throw apiError(response.status);
                const data=await response.json();
                if(!data || (data.items!==undefined&&!Array.isArray(data.items)) || (data.nextPageToken!==undefined&&typeof data.nextPageToken!=='string'))throw Error('Googleの応答を確認できませんでした。もう一度更新してください。');
                items.push(...(data.items||[]));pageToken=data.nextPageToken||'';
            } while(pageToken);
            return items;
        }
        async function calendars(token,signal) {
            const rows=await pages('users/me/calendarList',{maxResults:'250',showHidden:'true',fields:'nextPageToken,items(id,summary,summaryOverride,primary,selected,accessRole,deleted)'},token,signal);
            return rows.filter(c=>!c.deleted).map(c=>{
                if(!text(c.id)||!text(c.accessRole))throw Error('Googleのカレンダー一覧を確認できません。');
                return {id:c.id,name:text(c.summaryOverride)||text(c.summary)||'カレンダー',primary:!!c.primary,selected:!!c.selected,
                    readable:['reader','writer','owner','writerWithoutPrivateAccess'].includes(c.accessRole)};
            });
        }
        async function events(calendars, first, last, token, signal) {
            if(!validDay(first)||!validDay(last)||last<first)throw Error('表示する期間を確認してください。');
            const rows=[];
            // A failed calendar rejects the complete snapshot; partial data is never "free time".
            for(const calendar of calendars) {
                const raw=await pages('calendars/'+encodeURIComponent(calendar.id)+'/events',{
                    timeMin:first+'T00:00:00+09:00',timeMax:nextDay(last)+'T00:00:00+09:00',timeZone:zone,
                    singleEvents:'true',showDeleted:'false',orderBy:'startTime',maxResults:'250',
                    fields:'nextPageToken,items(id,status,summary,location,start,end,transparency,attendees(self,responseStatus))'
                },token,signal);
                rows.push(...raw.map(event=>normalizeEvent(event,calendar)).filter(Boolean));
            }
            return rows.sort((a,b)=>a.start-b.start||a.end-b.end);
        }
        return {calendars,events};
    }
    return {zone,scopes,validDay,nextDay,dayBounds,japanDay,timeLabel,onDay,atStart,normalizeEvent,createReader};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=GoogleCalendarData;
