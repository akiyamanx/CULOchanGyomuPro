// ETC利用照会の5列×2段の証明書。元の枠と読み取った値を別々に保持する。
const EtcDocument = (() => {
    const normal = value => String(value || '').normalize('NFKC').replace(/\s/g, '');
    function parseCell(text) {
        const s = normal(text), d = s.match(/(\d{2,4})年(\d{1,2})月(\d{1,2})日/);
        const time = s.match(/(\d{1,2})時(\d{1,2})分/), fee = s.match(/通行料金[¥￥]([\d,]+)[-ー]?/);
        const number = s.match(/取扱番号([A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+)/);
        const issuer = s.match(/登録番号[:：]?(T\d{13})/);
        let date = '';
        if (d) {
            const y = Number(d[1]) + (d[1].length === 2 ? 2000 : 0), m = Number(d[2]), day = Number(d[3]);
            const check = new Date(Date.UTC(y,m-1,day));
            if (check.getUTCFullYear() === y && check.getUTCMonth() === m-1 && check.getUTCDate() === day)
                date = [y,String(m).padStart(2,'0'),String(day).padStart(2,'0')].join('-');
        }
        const amount = fee ? Number(fee[1].replace(/,/g,'')) : null;
        const entry = s.match(/料金所\(自\)(.*?)料金所\(至\)/)?.[1] || '';
        const exit = s.match(/料金所\(至\)(.*?)(?=\d{2,4}年)/)?.[1] || '';
        const clock = time && +time[1]<24 && +time[2]<60 ? time[1].padStart(2,'0')+':'+time[2].padStart(2,'0') : '';
        return {date,time:clock,amount,entry,exit,number:number?.[1] || '',issuer:issuer?.[1] || '',
            valid:Boolean(date && clock && Number.isSafeInteger(amount) && amount>=0 && number && issuer)};
    }
    function pageCells(items,width,height) {
        if (Math.abs(width/height-842/595)>.025) throw new Error('A4横・5列×2段のETC利用証明書に対応しています。');
        const sx=width/842,sy=height/595,cells=[];
        const xs=[17.28,177.48,335.88,494.28,652.68,809.28],ys=[17.92,297.28,577.72];
        for(let row=0;row<2;row++) for(let col=0;col<5;col++) {
            const rect={x:(xs[col]-.4)*sx,y:(ys[row]-.4)*sy,w:(xs[col+1]-xs[col]+.8)*sx,h:(ys[row+1]-ys[row]+.8)*sy};
            const parts=items.filter(i=>i.x>=rect.x && i.x<rect.x+rect.w && i.y>=rect.y && i.y<rect.y+rect.h);
            const lines=[];
            for(const part of parts) {let line=lines.find(l=>Math.abs(l.y-part.y)<2.5*sy);if(!line){line={y:part.y,parts:[]};lines.push(line);}line.parts.push(part);}
            const text=lines.sort((a,b)=>a.y-b.y).map(l=>l.parts.sort((a,b)=>a.x-b.x).map(p=>p.text).join(' ')).join('\n');
            if(!normal(text))continue;
            if(!normal(text).includes('利用証明書'))throw new Error('証明書の枠を確認できないページがあります。異なる配置・画像PDFは未対応です。');
            const data=parseCell(text);
            if(!data.valid)throw new Error('日付・時刻・通行料金・取扱番号を確認できない証明書があります。原本を確認してください。');
            cells.push({...data,rect,id:'etc-proof:'+data.issuer+':'+data.number});
        }
        if(!cells.length)throw new Error('文字データのあるETC利用証明書を選んでください。画像PDFは未対応です。');
        return cells;
    }
    function merge(records,incoming) {
        const map=new Map(records.map(r=>[r.id,r]));let added=0;
        for(const item of incoming) {
            const old=map.get(item.id);
            if(old && ['date','time','amount','entry','exit'].some(k=>old[k]!==item[k]))throw new Error('同じ取扱番号で内容が違う証明書があります。二重に追加せず停止しました。');
            if(!old){map.set(item.id,item);added++;}
        }
        return {records:[...map.values()].sort((a,b)=>(a.date+a.time+a.id).localeCompare(b.date+b.time+b.id)),added};
    }
    return {normal,parseCell,pageCells,merge};
})();
if(typeof module!=='undefined')module.exports=EtcDocument;
