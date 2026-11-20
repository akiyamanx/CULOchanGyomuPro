const test=require('node:test'), a=require('node:assert/strict');
const c=require('../expense/receipt-crop.js');
const square=c.fromBox({x:.1,y:.2,w:.6,h:.6});
const near=(x,y)=>a.ok(Math.abs(x-y)<1e-8, x+' != '+y);
test('independent corners stay convex and inside the source',()=>{
 const q=c.moveCorner(square,0,{x:0,y:.05});
 a.deepEqual(q[0],{x:0,y:.05}); a.deepEqual(q.slice(1),square.slice(1));
 a.equal(c.moveCorner(square,0,{x:1,y:1}),square);
 a.deepEqual(c.moveCorner(square,0,{x:-1,y:-1})[0],{x:0,y:0});
});
test('projective crop maps all four corners, including a skewed receipt',()=>{
 const q=c.moveCorner(square,0,{x:.02,y:.36});
 const map=c.project(q);
 [[0,0],[1,0],[1,1],[0,1]].forEach(([u,v],i)=>{const p=map(u,v);near(p.x,q[i].x);near(p.y,q[i].y);});
 const out=c.raster(q,{x:0,y:0,width:4,height:4,data:Uint8ClampedArray.from({length:64},(_,i)=>i%4===3?255:120)},4,4,8);
 a.ok(out.width>0&&out.height>0);a.ok(out.data.every((x,i)=>x===(i%4===3?255:120)));
});
test('pinch anchors the source under the midpoint and allows two-finger pan',()=>{
 const v={x:5,y:2,w:100,h:200,z:1};
 const before=c.toSource(v,{x:55,y:102});
 const next=c.zoomView(v,{x:55,y:102},{x:65,y:112},2,300,300);
 a.equal(next.z,2);
 a.deepEqual(c.toSource(next,{x:65,y:112}),before);
 a.equal(c.zoomView(v,{x:0,y:0},{x:0,y:0},100,300,300).z,10);
});
test('overlap uses the quadrilateral, not just bounding rectangles',()=>{
 const q=[{x:.05,y:0},{x:.85,y:.8},{x:.8,y:.85},{x:0,y:.05}];
 const r=[{x:.2,y:0},{x:1,y:.8},{x:.95,y:.85},{x:.15,y:.05}];
 near(c.overlapRatio(q,r),0);near(c.overlapRatio(q,q),1);
});
test('editor accepts two touches, then drags only the intended corner',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const callbacks=[],points=[],caps=new Set(),buttons=Array.from({length:4},()=>({}));
 const context2d=new Proxy({arc(x,y){points.push({x,y});}},{get:(o,k)=>o[k]||(()=>{})});
 const nodes=new Proxy({}, {get:(o,k)=>o[k]??=(k==='cropSurface'?{
   getBoundingClientRect:()=>({left:0,top:0,width:320,height:320}),
   getContext:()=>context2d,setPointerCapture:id=>caps.add(id),hasPointerCapture:id=>caps.has(id),
   releasePointerCapture:id=>caps.delete(id)
 }:{hidden:false,focus(){},setAttribute(){},querySelectorAll:()=>buttons})});
 const ctx=vm.createContext({document:{getElementById:k=>nodes[k]},ReceiptCrop:c,devicePixelRatio:1,
   ResizeObserver:class{observe(){}},requestAnimationFrame:f=>callbacks.push(f)});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../expense/receipt-crop-editor.js'),'utf8')+'; this.editor=ReceiptCropEditor.setup(document.getElementById("cropEditor"));',ctx);
 let saved;
 ctx.editor.open({source:{width:400,height:400},initial:square,quad:square,invoker:{isConnected:false},label:'test',onApply:q=>saved=q});
 const canvas=nodes.cropSurface,event=(id,x,y)=>({pointerId:id,clientX:x,clientY:y,pointerType:'touch'});
 const old=parseInt(nodes.cropZoomStatus.textContent);
 canvas.onpointerdown(event(1,100,150));canvas.onpointerdown(event(2,200,150));
 canvas.onpointermove(event(1,80,150));canvas.onpointermove(event(2,220,150));
 while(callbacks.length)callbacks.shift()();
 a.ok(parseInt(nodes.cropZoomStatus.textContent)>old);
 canvas.onpointerup(event(1,80,150));canvas.onpointermove(event(2,240,150));canvas.onpointerup(event(2,240,150));
 nodes.cropFit.onclick();while(callbacks.length)callbacks.shift()();
 const point=points.at(-4);
 canvas.onpointerdown(event(3,point.x,point.y));canvas.onpointermove(event(3,point.x+14,point.y-8));canvas.onpointerup(event(3,point.x+14,point.y-8));
 nodes.cropApply.onclick();
 a.ok(saved[0].x>square[0].x&&saved[0].y<square[0].y);a.deepEqual(saved.slice(1),square.slice(1));

 ctx.editor.open({source:{width:400,height:400},initial:saved,quad:saved,invoker:{isConnected:false},label:'test',onApply:q=>saved=q});
 nodes.cropFit.onclick();while(callbacks.length)callbacks.shift()();
 const before=saved, [left,right]=points.slice(-4,-2),mx=(left.x+right.x)/2,my=(left.y+right.y)/2;
 canvas.onpointerdown(event(4,mx,my));
 canvas.onpointermove(event(4,mx+24,my+18));canvas.onpointerup(event(4,mx+24,my+18));nodes.cropApply.onclick();
 for(const i of [0,1]){near(saved[i].x,before[i].x);near(saved[i].y-before[i].y,18/288);}
 a.deepEqual(saved.slice(2),before.slice(2));

});
test('edge shifts both endpoints on the correct axis and keeps any existing tilt',()=>{
 const tilted=c.moveCorner(square,0,{x:.08,y:.16});
 const top=c.moveEdge(tilted,0,.12);
 for(const i of [0,1]){ near(top[i].x,tilted[i].x); near(top[i].y-tilted[i].y,.12); }
 a.deepEqual(top.slice(2),tilted.slice(2));
 const right=c.moveEdge(tilted,1,-.18);
 for(const i of [1,2]){ near(right[i].x-tilted[i].x,-.18); near(right[i].y,tilted[i].y); }
 a.equal(right[0],tilted[0]);a.equal(right[3],tilted[3]);
 const bottom=c.moveEdge(square,2,.03),left=c.moveEdge(square,3,-.03);
 near(bottom[2].y-square[2].y,.03);near(bottom[3].y-square[3].y,.03);
 near(left[0].x-square[0].x,-.03);near(left[3].x-square[3].x,-.03);
});
test('edge clamps at page bounds and never crosses the opposite side',()=>{
 const expanded=c.moveEdge(square,3,-5);near(expanded[0].x,0);near(expanded[3].x,0);
 const squeezed=c.moveEdge(square,0,5);a.ok(squeezed[0].y<square[3].y&&squeezed[0].y>square[0].y);
 a.ok(Number.isFinite(c.project(squeezed)(.5,.5).y));
});
test('hit testing keeps corners independent and recognizes the lines',()=>{
 const pts=square.map(p=>({x:p.x*300,y:p.y*300}));
 a.deepEqual(c.pickHandle(pts,{x:110,y:65}),{type:'edge',index:0});
 a.deepEqual(c.pickHandle(pts,{x:213,y:130}),{type:'edge',index:1});
 a.deepEqual(c.pickHandle(pts,{x:37,y:65}),{type:'corner',index:0});
 a.equal(c.pickHandle(pts,{x:150,y:150}),null);
 const narrow=c.fromBox({x:20,y:20,w:30,h:200});
 a.deepEqual(c.pickHandle(narrow,{x:35,y:20}),{type:'edge',index:0});
});
