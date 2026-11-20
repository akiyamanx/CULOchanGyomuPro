// Saved workspaces are the source of truth. Never copy mail, addresses or notes into the directory.
const VisitNameDirectory = (() => {
    'use strict';
    const lines = ['あ行','か行','さ行','た行','な行','は行','ま行','や行','ら行','わ行','英字・数字','読み未確認'];
    const initials = ['あいうえおぁぃぅぇぉゔ','かきくけこがぎぐげご','さしすせそざじずぜぞ','たちつてとだぢづでどっ','なにぬねの','はひふへほばびぶべぼぱぴぷぺぽ','まみむめも','やゆよゃゅょ','らりるれろ','わをんゎ'];
    const legal = /株式会社|株式會社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益財団法人|公益社団法人|医療法人(?:社団|財団)?|社会福祉法人|学校法人|宗教法人|特定非営利活動法人|司法書士法人|弁理士法人|\((?:株|有|同)\)/u;
    const types = {'株式會社':'株式会社','(株)':'株式会社','(有)':'有限会社','(同)':'合同会社'};
    const collator = new Intl.Collator('ja-JP',{numeric:true,sensitivity:'base'});
    const clean = s => typeof s === 'string' ? s.trim().replace(/\s+/gu,' ') : '';
    const folded = s => clean(s).normalize('NFKC');
    const plain = s => folded(s).replace(legal,' ').trim();
    const base = s => plain(s).toLowerCase().replace(/[\s・･]/gu,'');
    const form = s => { const f=folded(s).match(legal)?.[0] || ''; return types[f] || f; };
    const hira = s => folded(s).replace(/[ァ-ヶ]/gu,c=>String.fromCharCode(c.charCodeAt(0)-96));
    const reading = s => { const v=hira(s); return v.length<=180 && /^[ぁ-ゖー ]+$/u.test(v) ? v : ''; };
    const group = row => {
        const c = hira(row.reading || plain(row.name))[0] || '';
        const i = c ? initials.findIndex(chars=>chars.includes(c)) : -1;
        return i>=0 ? lines[i] : /^[a-z0-9]/i.test(c) ? lines[10] : lines[11];
    };
    function validName(name) {
        return name.length>0 && name.length<=180 && !/[\p{Cc}<>]/u.test(name) &&
            /[\p{L}\p{N}]/u.test(base(name)) && !/^(?:不明|名称不明|会社名不明|会社名|顧客名|設置先|未入力|未確認|要確認|n\/a|none|unknown|[-ー―]+)$/iu.test(base(name));
    }
    function parseSeed(source) {
        const data=JSON.parse(source);
        if(data?.format!=='gyomu-customer-directory-v1'||!Array.isArray(data.customers)||data.customers.length>1500) throw new Error('invalid seed');
        return data.customers.map(r=>{
            const name=clean(r?.name), kana=reading(r?.reading);
            if(!validName(name)||(r.reading&&!kana)||!Array.isArray(r.sites)||r.sites.length>100) throw new Error('invalid row');
            const sites=r.sites.map(s=>{const site=clean(s);if(!validName(site))throw new Error('invalid site');return site;});
            return {name,reading:kana,sites};
        });
    }
    function collect(seed,visits) {
        const rows=new Map(),aliases=new Map();
        function add(r, seeded=false) {
            const b=base(r.name),f=form(r.name),id=b+'|'+f;
            let row=rows.get(id);
            if(!row)rows.set(id,row={name:r.name,reading:r.reading||'',sites:[],seeded});
            else {
                if(!row.reading&&r.reading)row.reading=r.reading;
                if(!row.seeded&&f&&folded(r.name).includes(f)&&!folded(row.name).includes(f))row.name=r.name;
            }
            for(const site of r.sites||[]){
                const k=base(site);if(k===b)continue;
                if(!aliases.has(k))aliases.set(k,new Set());
                aliases.get(k).add(id);
                if(!row.sites.some(s=>base(s)===k))row.sites.push(site);
            }
        }
        for(const row of seed)add(row,true);
        // Read names from committed visits, not from a parser's draft or unresolved mail.
        const known=visits.filter(v=>v && typeof v.id==='string' && v.id && !v.mailNeedsReview)
            .map(v=>({name:clean(v.company),reading:reading(v.companyReading)})).filter(v=>validName(v.name));
        const forms = new Map();
        for(const r of [...seed,...known]) {
            const b=base(r.name),f=form(r.name);if(!f)continue;
            if(!forms.has(b))forms.set(b,new Set());
            forms.get(b).add(f);
        }
        for(const r of [...known.filter(r=>form(r.name)),...known.filter(r=>!form(r.name))]){
            const b=base(r.name),f=form(r.name),site=aliases.get(b);
            if(site?.size===1 && [...site].some(id=>!f || id.endsWith('|'+f)))continue;
            const options=forms.get(b);
            // A form-free name maps only when unambiguous; two explicit different legal forms stay distinct.
            if(!f&&options?.size===1){
                const canonical=rows.get(b+'|'+[...options][0]);
                if(canonical){if(!canonical.reading&&r.reading)canonical.reading=r.reading;continue;}
            }
            if(!f&&options?.size>1)continue;
            add(r);
        }
        // An existing imported name with no legal suffix may now have a single explicit form.
        for(const [b,options] of forms){
            if(options.size!==1)continue;
            const bare=rows.get(b+'|'),id=b+'|'+[...options][0],typed=rows.get(id);
            if(!bare||!typed)continue;
            rows.delete(b+'|');
            rows.set(id,{name:typed.name,reading:bare.reading||typed.reading,sites:[...new Map([...bare.sites,...typed.sites].map(s=>[base(s),s])).values()]});
        }
        return [...rows.values()].map(({name,reading,sites})=>({name,reading,sites:sites.sort(collator.compare)})).sort((a,b)=>
            lines.indexOf(group(a))-lines.indexOf(group(b)) ||
            collator.compare(hira(a.reading||plain(a.name)),hira(b.reading||plain(b.name))) || collator.compare(a.name,b.name));
    }
    function read(storage,seed) {
        const visits=[];let skipped=0;
        for(const id of new Set(storage.getWorkspaces().map(w=>w.id))){
            try {
                const rows=storage.getCustomersForWorkspace(id);
                if(!Array.isArray(rows))throw new Error();
                for(const visit of rows)visits.push(visit);
            }catch{skipped++;}
        }
        return {rows:collect(seed,visits),skipped};
    }
    return {lines,group,collect,read,parseSeed};
})();
if(typeof module==='object'&&module.exports)module.exports=VisitNameDirectory;
