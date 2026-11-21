(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory();
  else root.ReceiptCrop=factory();
})(globalThis,()=>{
  'use strict';
  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const cross=(a,b,p)=>(b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
  const area=q=>Math.abs(q.reduce((s,p,i)=>{const n=q[(i+1)%q.length];return s+p.x*n.y-p.y*n.x;},0))/2;
  const fromBox=({x,y,w,h})=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
  const quarterTurns=steps=>((steps%4)+4)%4;
  function turnQuad(quad,steps){
    for(let i=0;i<quarterTurns(steps);i++){
      const [a,b,c,d]=quad;
      quad=[d,a,b,c].map(p=>({x:1-p.y,y:p.x}));
    }
    return quad;
  }
  // w/h describe the destination rectangle after rotation, in canvas coordinates.
  function drawTurn(ctx,source,steps,x,y,w,h){
    const turn=quarterTurns(steps);
    if(!turn){ctx.drawImage(source,x,y,w,h);return;}
    ctx.save();
    ctx.translate(x+(turn===1||turn===2?w:0),y+(turn===2||turn===3?h:0));
    ctx.rotate(turn*Math.PI/2);
    ctx.drawImage(source,0,0,turn%2?h:w,turn%2?w:h);
    ctx.restore();
  }
  function turnImage(source,steps){
    const turn=quarterTurns(steps);
    if(!turn)return source;
    const out=document.createElement('canvas');
    out.width=turn%2?source.height:source.width;
    out.height=turn%2?source.width:source.height;
    drawTurn(out.getContext('2d'),source,turn,0,0,out.width,out.height);
    return out;
  }
  function bounds(q){
    const xs=q.map(p=>p.x),ys=q.map(p=>p.y);
    return {x:Math.min(...xs),y:Math.min(...ys),r:Math.max(...xs),b:Math.max(...ys)};
  }
  const valid=q=>q.every((a,j)=>cross(a,q[(j+1)%4],q[(j+2)%4])>1e-5)&&area(q)>.00015;
  function moveCorner(quad,i,p){
    const q=quad.slice();q[i]={x:clamp(p.x,0,1),y:clamp(p.y,0,1)};
    return valid(q)?q:quad;
  }
  // Top/bottom use the vertical axis, left/right the horizontal axis. Both
  // endpoints move by the same amount, so a perspective-adjusted edge keeps its angle.
  function moveEdge(quad,i,delta){
    if(!Number.isInteger(i)||i<0||i>3||!Number.isFinite(delta))return quad;
    const j=(i+1)%4, axis=i%2===0?'y':'x';
    const a=quad[i][axis],b=quad[j][axis];
    const d=clamp(delta,-Math.min(a,b),1-Math.max(a,b));
    if(!d)return quad;
    const candidate=t=>quad.map((p,k)=>k===i||k===j?{...p,[axis]:clamp(p[axis]+d*t,0,1)}:p);
    let q=candidate(1);
    if(valid(q))return q;
    let lo=0,hi=1;
    for(let n=0;n<20;n++){
      const mid=(lo+hi)/2;
      if(valid(candidate(mid)))lo=mid;else hi=mid;
    }
    return lo>0?candidate(lo):quad;
  }
  function pickHandle(pts,p){
    const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
    const distances=pts.map(q=>dist(q,p)),corner=distances.indexOf(Math.min(...distances));
    let centerIndex=-1,centerDist=Infinity,edgeIndex=-1,edgeDist=Infinity;
    for(let i=0;i<4;i++){
      const a=pts[i],b=pts[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y;
      const center=dist({x:(a.x+b.x)/2,y:(a.y+b.y)/2},p);
      if(center<centerDist){centerDist=center;centerIndex=i;}
      const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);
      if(t<=0||t>=1||!Number.isFinite(t))continue;
      const d=dist({x:a.x+t*dx,y:a.y+t*dy},p);
      if(d<edgeDist){edgeDist=d;edgeIndex=i;}
    }
    if(centerDist<=18&&centerDist<distances[corner])return {type:'edge',index:centerIndex};
    if(distances[corner]<=26)return {type:'corner',index:corner};
    return edgeDist<=16?{type:'edge',index:edgeIndex}:null;
  }
  function overlapRatio(a,b){
    let q=a;
    for(let i=0;i<4&&q.length;i++){
      const edge=b[i],last=b[(i+1)%4],next=[];
      for(let j=0;j<q.length;j++){
        const p=q[j],n=q[(j+1)%q.length],xp=cross(edge,last,p),xn=cross(edge,last,n);
        if(xp>=0)next.push(p);
        if((xp>=0)!==(xn>=0)){const t=xp/(xp-xn);next.push({x:p.x+t*(n.x-p.x),y:p.y+t*(n.y-p.y)});}
      }
      q=next;
    }
    return area(q)/Math.min(area(a),area(b));
  }
  function project([a,b,c,d]){
    const dx1=b.x-c.x,dx2=d.x-c.x,dx3=a.x-b.x+c.x-d.x;
    const dy1=b.y-c.y,dy2=d.y-c.y,dy3=a.y-b.y+c.y-d.y;
    const det=dx1*dy2-dx2*dy1;
    const g=(dx3*dy2-dx2*dy3)/det,h=(dx1*dy3-dx3*dy1)/det;
    const ax=b.x-a.x+g*b.x,bx=d.x-a.x+h*d.x;
    const ay=b.y-a.y+g*b.y,by=d.y-a.y+h*d.y;
    return (u,v)=>{const w=g*u+h*v+1;return {x:(ax*u+bx*v+a.x)/w,y:(ay*u+by*v+a.y)/w};};
  }
  function raster(q,src,iw,ih,maxSide){
    const [a,b,c,d]=q,dist=(a,b)=>Math.hypot((b.x-a.x)*iw,(b.y-a.y)*ih);
    const w=Math.max(dist(a,b),dist(d,c)),h=Math.max(dist(a,d),dist(b,c));
    const scale=Math.min(1,maxSide/Math.max(w,h));
    const width=Math.max(1,Math.round(w*scale)),height=Math.max(1,Math.round(h*scale));
    const data=new Uint8ClampedArray(width*height*4),map=project(q);
    for(let y=0,k=0;y<height;y++)for(let x=0;x<width;x++,k+=4){
      const p=map((x+.5)/width,(y+.5)/height);
      const px=clamp(p.x*iw-src.x-.5,0,src.width-1),py=clamp(p.y*ih-src.y-.5,0,src.height-1);
      const x0=Math.floor(px),y0=Math.floor(py),fx=px-x0,fy=py-y0;
      const i=(y0*src.width+x0)*4,r=x0<src.width-1?4:0,b=y0<src.height-1?src.width*4:0;
      for(let j=0;j<3;j++){
        const s=src.data;
        const val=t=>s[t+j]*s[t+3]/255+255-s[t+3];
        data[k+j]=(val(i)*(1-fx)+val(i+r)*fx)*(1-fy)+(val(i+b)*(1-fx)+val(i+b+r)*fx)*fy;
      }
      data[k+3]=255;
    }
    return {data,width,height};
  }
  function image(source,q,maxSide){
    const [a,b,c,d]=q;
    if(a.y===b.y&&b.x===c.x&&c.y===d.y&&d.x===a.x)return GyomuScanner.cropImage(source,{x:a.x,y:a.y,w:c.x-a.x,h:c.y-a.y},{maxSide});
    const bnd=bounds(q), x=Math.floor(bnd.x*source.width),y=Math.floor(bnd.y*source.height);
    const w=Math.ceil(bnd.r*source.width)-x,h=Math.ceil(bnd.b*source.height)-y;
    const pixels=source.getContext('2d').getImageData(x,y,w,h);
    const out=raster(q,{x,y,width:w,height:h,data:pixels.data},source.width,source.height,maxSide);
    const canvas=document.createElement('canvas');canvas.width=out.width;canvas.height=out.height;
    canvas.getContext('2d').putImageData(new ImageData(out.data,out.width,out.height),0,0);
    return canvas;
  }
  const toSource=(v,p)=>({x:(p.x-v.x)/(v.w*v.z),y:(p.y-v.y)/(v.h*v.z)});
  function limit(v,w,h){
    const ww=v.w*v.z,hh=v.h*v.z;
    const mx=Math.min(w*.22,ww*.5),my=Math.min(h*.22,hh*.5);
    return {...v,x:clamp(v.x,mx-ww,w-mx),y:clamp(v.y,my-hh,h-my)};
  }
  function zoomView(v,from,to,factor,w,h){
    const z=clamp(v.z*factor,1,10),p=toSource(v,from);
    return limit({...v,z,x:to.x-p.x*v.w*z,y:to.y-p.y*v.h*z},w,h);
  }
  return {fromBox,bounds,quarterTurns,turnQuad,drawTurn,turnImage,moveCorner,moveEdge,pickHandle,overlapRatio,project,raster,image,toSource,zoomView};
});
