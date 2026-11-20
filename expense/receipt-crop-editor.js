const ReceiptCropEditor=(()=>{
 'use strict';
 const $=id=>document.getElementById(id), g=ReceiptCrop;
 const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2}),gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 function setup(panel){
   const canvas=$('cropSurface'),ctx=canvas.getContext('2d'),controls=$('cropCornerKeys');
   const pointers=new Map();
   let source,initial,quad,view,w,h,invoker,onApply,active=-1,activeEdge=-1,raf=0,gesture;
   const focus=()=>({x:w/2,y:h/2});
   function base(){
     const s=Math.min((w-32)/source.width,(h-32)/source.height);
     const iw=source.width*s,ih=source.height*s;
     return {w:iw,h:ih,z:1,x:(w-iw)/2,y:(h-ih)/2};
   }
   function focusBox(){
     const b=g.bounds(quad);
     view=base();
     const p=at({x:(b.x+b.r)/2,y:(b.y+b.b)/2});
     view=g.zoomView(view,p,focus(),Math.min((w-62)/((b.r-b.x)*view.w),(h-62)/((b.b-b.y)*view.h)),w,h);
   }
   function resize(){
     if(panel.hidden||!source)return;
     const rect=canvas.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);
     if(!rect.width||!rect.height||(w===rect.width&&h===rect.height&&view))return;
     const was=view&&g.toSource(view,focus()),z=view?.z;
     w=rect.width;h=rect.height;
     canvas.width=Math.max(1,Math.round(w*d));canvas.height=Math.max(1,Math.round(h*d));view=base();
     if(was)view=g.zoomView(view,at(was),focus(),z,w,h);else focusBox();
     draw();
   }
   const at=p=>({x:view.x+p.x*view.w*view.z,y:view.y+p.y*view.h*view.z});
   function schedule(){if(!raf)raf=requestAnimationFrame(()=>{raf=0;if(view&&!panel.hidden)draw();});}
   function draw(){
     ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
     ctx.fillStyle='#15272c';ctx.fillRect(0,0,w,h);
     ctx.drawImage(source,view.x,view.y,view.w*view.z,view.h*view.z);
     const pts=quad.map(at), path=()=>{pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();};
     ctx.beginPath();ctx.rect(0,0,w,h);path();ctx.fillStyle='#0e1f27aa';ctx.fill('evenodd');
     ctx.beginPath();path();ctx.lineWidth=2;ctx.strokeStyle='#ffde5a';ctx.stroke();
     pts.forEach((p,i)=>{
       const n=pts[(i+1)%4],c=mid(p,n);
       const dx=n.x-p.x,dy=n.y-p.y,length=gap(p,n);
       if(length<22)return;
       if(i===activeEdge){
         ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(n.x,n.y);
         ctx.lineWidth=4;ctx.strokeStyle='#ffde5a';ctx.stroke();
       }
       ctx.beginPath();ctx.moveTo(c.x-7*dx/length,c.y-7*dy/length);
       ctx.lineTo(c.x+7*dx/length,c.y+7*dy/length);
       ctx.save();ctx.lineCap='round';ctx.strokeStyle='#172b32';ctx.lineWidth=9;ctx.stroke();
       ctx.strokeStyle='#ffde5a';ctx.lineWidth=5;ctx.stroke();ctx.restore();
     });
     pts.forEach((p,i)=>{
       ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fillStyle=i===active?'#ffde5a':'#172b32';ctx.fill();
       ctx.lineWidth=2;ctx.strokeStyle='#ffde5a';ctx.stroke();
     });
     $('cropZoomStatus').textContent=Math.round(view.z*100)+'%';
     $('cropMinus').disabled=view.z<=1;$('cropPlus').disabled=view.z>=10;
   }
   function changeZoom(factor){
     view=g.zoomView(view,focus(),focus(),factor,w,h);schedule();
   }
   function clearPointers(){
     const ids=[...pointers.keys()];pointers.clear();gesture=null;
     for(const id of ids)if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);
   }
   function close(){
     clearPointers();source=initial=quad=view=onApply=null;active=activeEdge=-1;
     panel.hidden=true;$('parkingScanMain').hidden=false;
     $('parkingScanDialog').setAttribute('aria-labelledby','parkingScanTitle');
     if(invoker?.isConnected)invoker.focus();
     invoker=null;
   }
   function position(e){const b=canvas.getBoundingClientRect();return {x:e.clientX-b.left,y:e.clientY-b.top};}
   canvas.onpointerdown=e=>{
     if(!view||(e.pointerType==='mouse'&&e.button!==0)||pointers.size>=2)return;
     const p=position(e);
     pointers.set(e.pointerId,p);canvas.setPointerCapture(e.pointerId);
     if(pointers.size===2){
       const [a,b]=pointers.values();active=activeEdge=-1;gesture={type:'pinch',view,center:mid(a,b),span:Math.max(1,gap(a,b))};schedule();return;
     }
     const hit=g.pickHandle(quad.map(at),p);
     active=hit?.type==='corner'?hit.index:-1;
     activeEdge=hit?.type==='edge'?hit.index:-1;
     if(active>=0){
       const point=at(quad[active]);
       gesture={type:'corner',index:active,dx:point.x-p.x,dy:point.y-p.y};
     }else if(activeEdge>=0){
       gesture={type:'edge',index:activeEdge,start:g.toSource(view,p),origin:quad,view};
     }else gesture={type:'pan',view,start:p};
     schedule();
   };
   canvas.onpointermove=e=>{
     if(!pointers.has(e.pointerId)||!gesture)return;
     const p=position(e);pointers.set(e.pointerId,p);
     if(gesture.type==='pinch'){
       if(pointers.size!==2)return;
       const [a,b]=pointers.values();view=g.zoomView(gesture.view,gesture.center,mid(a,b),gap(a,b)/gesture.span,w,h);
     }else if(gesture.type==='corner'){
       const {index,dx,dy}=gesture;
       quad=g.moveCorner(quad,index,g.toSource(view,{x:p.x+dx,y:p.y+dy}));
     }else if(gesture.type==='edge'){
       const {index,start,origin}=gesture,point=g.toSource(gesture.view,p);
       quad=g.moveEdge(origin,index,index%2===0?point.y-start.y:point.x-start.x);
     }else view=g.zoomView(gesture.view,gesture.start,p,1,w,h);
     schedule();
   };
   function release(e){
     if(!pointers.delete(e.pointerId))return;
     // Do not turn a lifted pinch into a corner drag or a jump in the crop.
     gesture=null;activeEdge=-1;schedule();
   }
   canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=release;
   controls.querySelectorAll('button').forEach((b,i)=>{
     b.onfocus=b.onclick=()=>{active=i;activeEdge=-1;schedule();};
     b.onkeydown=e=>{
       const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},delta=deltas[e.key];
       if(!delta||!view)return;
       e.preventDefault();const p=at(quad[i]), unit=e.shiftKey?10:2;
       quad=g.moveCorner(quad,i,g.toSource(view,{x:p.x+delta[0]*unit,y:p.y+delta[1]*unit}));schedule();
     };
   });
   $('cropMinus').onclick=()=>changeZoom(1/1.3);$('cropPlus').onclick=()=>changeZoom(1.3);
   $('cropFit').onclick=()=>{view=base();schedule();};
   $('cropReset').onclick=()=>{quad=initial;focusBox();schedule();};
   $('cropCancel').onclick=close;
   $('cropApply').onclick=()=>{if(onApply){onApply(quad);close();}};
   new ResizeObserver(resize).observe(canvas);
   return {
    open(options){
      ({source,initial,quad,invoker,onApply}=options);view=null;active=activeEdge=-1;
      $('cropTitle').textContent=options.label+'の切り取り範囲';
      $('parkingScanMain').hidden=true;panel.hidden=false;
      $('parkingScanDialog').setAttribute('aria-labelledby','cropTitle');
      $('parkingScanDialog').scrollTop=0;resize();$('cropTitle').focus({preventScroll:true});
    },
    cancel:close,isOpen:()=>!panel.hidden
   };
 }
 return {setup};
})();
