// ルートの見分け方を地図、一覧、凡例で共通にする。訪問データは書き換えない。
const RoutePinStyle = (() => {
    const WIDTH=36, HEIGHT=42;
    const shapes=['drop','diamond','square','triangle','round','triangle','diamond','square','round','drop'];
    const dayColors=['#1759a8','#087a6c','#b42332','#714597','#a94d0c','#30652d','#185881',
        '#a02e75','#59651a','#614724','#3942a0','#a84158','#176b55','#89551c','#0f6581','#85389e',
        '#527522','#953d38','#246799','#71504b','#994678','#146138','#9f510f','#31508a','#7b3270',
        '#126c72','#994239','#4c5795','#676622','#096145','#915018'];
    const paths={
        drop:'M18 3C9 3 3 9 3 17c0 9 9 17 15 23 6-6 15-14 15-23C33 9 27 3 18 3Z',
        diamond:'M18 2 34 18 18 40 2 18Z',
        square:'M7 4h22a3 3 0 0 1 3 3v22a3 3 0 0 1-3 3h-5l-6 8-6-8H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z',
        triangle:'M15 5q3-5 6 0l13 24q2 5-3 5h-8l-5 6-5-6H5q-5 0-3-5Z',
        round:'M18 3a15 15 0 0 1 5 29l-5 8-5-8a15 15 0 0 1 5-29Z',
        done:'M18 3a15 15 0 0 1 6 29l-6 8-6-8A15 15 0 0 1 18 3Z',
        flag:'M5 3h27l-7 9 7 9H9v13l4 2-6 5-6-5 4-2Z'
    };
    const safeColor=value=>/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(String(value||'')) ? String(value) : '#536575';
    function standardNumber(id) {
        const n=Number(/^route_([1-9]\d*)$/.exec(String(id))?.[1]);
        return Number.isSafeInteger(n) && n<10000 ? n : 0;
    }
    function routeStyle(route,routes) {
        let n=standardNumber(route.id);
        if(!n) {
            // 個別IDが標準ルートの表示番号と重ならないよう、空き番号を順に割り当てる。
            const builtNums=new Set(routes.map(r=>standardNumber(r.id)).filter(Boolean));
            n=1;
            for(const r of routes) {
                if(standardNumber(r.id))continue;
                while(builtNums.has(n))n++;
                if(r.id===route.id)break;
                n++;
            }
            while(builtNums.has(n))n++;
        }
        return {shape:shapes[(n-1)%shapes.length],color:safeColor(route.color),mark:String(n)};
    }
    function statusStyle(status) {
        if(status==='completed')return {shape:'done',color:'#177050',mark:'✓'};
        if(status==='appointed')return {shape:'drop',color:'#1765aa',mark:'•'};
        return {shape:'flag',color:'#171a22',mark:''};
    }
    const statusLabel=status=>status==='completed'?'訪問完了':status==='appointed'?'アポ済み':'未アポ';
    function visitDay(customer) {
        if(customer.dateNeedsReview)return null;
        const iso=/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(String(customer.appoDate||''));
        if(!iso)return null;
        const [y,m,d]=iso.slice(1).map(Number);
        const leap=y%4===0 && (y%100!==0 || y%400===0);
        if(y<1 || m<1 || m>12 || d<1 || d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][m-1])return null;
        return {day:d,month:m,iso:iso[1]+'-'+iso[2]+'-'+iso[3]};
    }
    function dayStyle(d, mark=String(d)) {
        return {shape:shapes[(d-1)%shapes.length],color:dayColors[d-1],mark};
    }
    const visible=(customer,completedOnly=false)=>(customer.status==='completed')===completedOnly;
    function visitStyle(customer,routes,workspace) {
        if(customer.status==='completed')return statusStyle('completed');
        const date=visitDay(customer);
        if(customer.status==='appointed' && date)
            return dayStyle(date.day,workspace && date.iso.slice(0,7)!==workspace ? date.month+'/'+date.day : String(date.day));

        const route=routes.find(r=>r.id===customer.routeId);
        if(customer.status!=='appointed' && customer.status!=='completed')
            return {...statusStyle('pending'),mark:route ? routeStyle(route,routes).mark : ''};
        if(!route)return statusStyle(customer.status);
        const style=routeStyle(route,routes);
        return {...style,mark:'R'+style.mark};
    }
    function textColor(color) {
        const h=color.length===4 ? color.slice(1).replace(/./g,c=>c+c) : color.slice(1);
        const channels=h.match(/../g).map(x=>{const k=parseInt(x,16)/255;return k<=0.04045?k/12.92:((k+0.055)/1.055)**2.4;});
        return (channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722)>0.179?'#000000':'#ffffff';
    }
    function svg(style) {
        const shape=Object.hasOwn(paths,style.shape)?style.shape:'drop', color=safeColor(style.color);
        const mark=/^(?:R?\d{1,4}|\d{1,2}\/\d{1,2}|✓|•)$/.test(style.mark)?style.mark:'';
        const label=mark?'<text x="'+(shape==='flag'?17:18)+'" y="'+(shape==='flag'?16:shape==='triangle'?26:23)
            +'" text-anchor="middle" font-family="Arial,sans-serif" font-weight="700" font-size="'+(mark.length>3?9:mark.length>2?11:14)
            +'" fill="'+textColor(color)+'">'+mark+'</text>':'';
        return '<svg xmlns="http://www.w3.org/2000/svg" width="'+WIDTH+'" height="'+HEIGHT+'" viewBox="0 0 36 42">'
            +'<path d="'+paths[shape]+'" fill="'+color+'" stroke="#ffffff" stroke-width="2.3" stroke-linejoin="round"/>'+label+'</svg>';
    }
    function swatch(style) {return '<span class="route-pin-swatch" aria-hidden="true">'+svg(style)+'</span>';}
    function icon(style,maps) {return {url:'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg(style)),
        scaledSize:new maps.Size(WIDTH,HEIGHT),anchor:new maps.Point(style.shape==='flag'?7:18,40),labelOrigin:new maps.Point(18,51)};}
    return {routeStyle,statusStyle,statusLabel,visitDay,dayStyle,visitStyle,visible,svg,swatch,icon};
})();
if(typeof module!=='undefined')module.exports=RoutePinStyle;
