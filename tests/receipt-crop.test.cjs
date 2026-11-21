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
test('the saved-photo panel uses the same editor without changing the PDF dialog or its state',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
 const fakeCanvas=()=>({width:0,height:0,getBoundingClientRect:()=>({left:0,top:0,width:320,height:320}),getContext:()=>new Proxy({},{get:()=>()=>{}})});
 const buttons=Array.from({length:4},()=>({}));
 const all=new Map();
 const byId=k=>{
   if(!all.has(k))all.set(k,k.endsWith('cropSurface')?fakeCanvas():{hidden:k.endsWith('cropEditor'),focus(){},setAttribute(name,val){this[name]=val;},querySelectorAll:()=>buttons});
   return all.get(k);
 };
 const ctx=vm.createContext({document:{getElementById:byId},ReceiptCrop:c,devicePixelRatio:1,ResizeObserver:class{observe(){}},requestAnimationFrame:f=>f()});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../expense/receipt-crop-editor.js'),'utf8')+`
   this.scanner=ReceiptCropEditor.setup(document.getElementById('cropEditor'));
   this.photo=ReceiptCropEditor.setup(document.getElementById('photo-cropEditor'),{
      prefix:'photo-',main:document.getElementById('receiptPhotoMain'),dialog:document.getElementById('receiptPhotoDialog'),mainTitle:'receiptPhotoTitle'
   });`,ctx);
 let saved=null;
 const photo=byId('receiptPhotoDialog'), scan=byId('parkingScanDialog'), main=byId('receiptPhotoMain');
 photo.scrollTop=127;scan.scrollTop=359;
 ctx.photo.open({source:{width:400,height:800},initial:square,quad:square,invoker:{isConnected:false},label:'写真',onApply:q=>saved=q});
 a.equal(main.hidden,true);a.equal(photo['aria-labelledby'],'photo-cropTitle');
 a.equal(ctx.scanner.isOpen(),false);a.equal(scan.scrollTop,359);
 ctx.photo.cancel();a.equal(saved,null);a.equal(main.hidden,false);a.equal(photo.scrollTop,127);a.equal(photo['aria-labelledby'],'receiptPhotoTitle');
 ctx.photo.open({source:{width:400,height:800},initial:square,quad:square,invoker:{isConnected:false},label:'写真',onApply:q=>saved=q});
 byId('photo-cropApply').onclick();a.deepEqual(saved,square);a.equal(ctx.photo.isOpen(),false);
});
test('quarter-turns keep the selected pixels within the same source quad when mapped back',()=>{
 const q=[{x:.11,y:.17},{x:.42,y:.20},{x:.46,y:.57},{x:.09,y:.60}];
 const cw=c.turnQuad(q,1);
 const expected=[q[3],q[0],q[1],q[2]];
 cw.forEach((p,i)=>{near(p.x,1-expected[i].y);near(p.y,expected[i].x);});
 for(const n of [-1,0,1,2,3,4]){
   const back=c.turnQuad(c.turnQuad(q,n),-n);
   back.forEach((p,i)=>{near(p.x,q[i].x);near(p.y,q[i].y);});
   near(c.overlapRatio(back,q),1);
 }
});
test('the rotated cropped image swaps output dimensions without rotating the original canvas',()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const calls=[], ctx2d=Object.fromEntries(['save','restore','translate','rotate','drawImage'].map(k=>[k,(...v)=>calls.push([k,...v])]));
 const ctx=vm.createContext({document:{createElement:()=>({getContext:()=>ctx2d})}});
 vm.runInContext(fs.readFileSync(require.resolve('../expense/receipt-crop.js'),'utf8'),ctx);
 const image={width:200,height:85}, rotated=ctx.ReceiptCrop.turnImage(image,1);
 a.deepEqual([rotated.width,rotated.height],[85,200]);
 a.deepEqual([image.width,image.height],[200,85]);
 a.deepEqual(calls,[['save'],['translate',85,0],['rotate',Math.PI/2],['drawImage',image,0,0,200,85],['restore']]);
 a.equal(ctx.ReceiptCrop.turnImage(image,4),image);
 const half=ctx.ReceiptCrop.turnImage(image,2);a.deepEqual([half.width,half.height],[200,85]);
});
