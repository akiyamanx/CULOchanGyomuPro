// 射影変換：出力矩形の座標から元写真の四隅へ写す。
const ReceiptGeometry = (() => {
    function valid(points) {
        if (!Array.isArray(points) || points.length !== 4 || points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1)) return false;
        let area=0;
        for (let i=0;i<4;i++) {
            const a=points[i],b=points[(i+1)%4],c=points[(i+2)%4];
            if ((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)<0.0001) return false;
            area+=a.x*b.y-b.x*a.y;
        }
        return area>0.015;
    }
    function transform(points) {
        if (!valid(points)) throw new Error('四隅が交差しています。左上→右上→右下→左下の順に、領収書を囲んでください。');
        const uv=[[0,0],[1,0],[1,1],[0,1]], rows=[];
        points.forEach((p,i)=>{const [u,v]=uv[i];rows.push([u,v,1,0,0,0,-p.x*u,-p.x*v,p.x],[0,0,0,u,v,1,-p.y*u,-p.y*v,p.y]);});
        for (let col=0;col<8;col++) {
            let pivot=col;
            for(let r=col+1;r<8;r++) if(Math.abs(rows[r][col])>Math.abs(rows[pivot][col])) pivot=r;
            [rows[col],rows[pivot]]=[rows[pivot],rows[col]];
            const n=rows[col][col]; if(Math.abs(n)<1e-10) throw new Error('四隅を広げてください。');
            for(let c=col;c<9;c++) rows[col][c]/=n;
            for(let r=0;r<8;r++) if(r!==col) {const k=rows[r][col];for(let c=col;c<9;c++) rows[r][c]-=k*rows[col][c];}
        }
        return rows.map(row=>row[8]);
    }
    function map(h,u,v) {const d=h[6]*u+h[7]*v+1;return {x:(h[0]*u+h[1]*v+h[2])/d,y:(h[3]*u+h[4]*v+h[5])/d};}
    function dimensions(points,width,height) {
        const d=(a,b)=>Math.hypot((a.x-b.x)*width,(a.y-b.y)*height);
        const w=Math.max(d(points[0],points[1]),d(points[3],points[2])),h=Math.max(d(points[0],points[3]),d(points[1],points[2]));
        const scale=Math.min(1,2400/Math.max(w,h));
        return {width:Math.max(1,Math.round(w*scale)),height:Math.max(1,Math.round(h*scale))};
    }
    return {valid,transform,map,dimensions};
})();
if (typeof module !== 'undefined') module.exports=ReceiptGeometry;
