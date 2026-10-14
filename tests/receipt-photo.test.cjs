const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('../receipt/receipt-photo-geometry.js');
test('四隅補正は矩形・台形の頂点と中心を正しく写像する',()=>{
    const rectangle=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
    assert.deepEqual(g.map(g.transform(rectangle),.5,.5),{x:.5,y:.5});
    const trapezoid=[{x:.2,y:.1},{x:.8,y:.1},{x:1,y:.9},{x:0,y:.9}];
    const h=g.transform(trapezoid);
    [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>{const p=g.map(h,u,v);assert.ok(Math.abs(p.x-trapezoid[i].x)<1e-8);assert.ok(Math.abs(p.y-trapezoid[i].y)<1e-8);});
    assert.ok(Math.abs(g.map(h,.5,.5).x-.5)<1e-8);
});
test('交差・範囲外・極端に小さい四隅を拒否する',()=>{
    for(const points of [[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}], [{x:-1,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}], [{x:0,y:0},{x:.01,y:0},{x:.01,y:.01},{x:0,y:.01}]]) assert.throws(()=>g.transform(points));
});
test('写真の縦横比を維持して処理サイズを制限する',()=>{
    const box=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
    assert.deepEqual(g.dimensions(box,2000,4000),{width:1200,height:2400});
});
