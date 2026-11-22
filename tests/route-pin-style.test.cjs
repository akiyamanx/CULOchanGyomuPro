const test=require('node:test'),assert=require('node:assert/strict');
const pins=require('../map/route-pin-style.js');
const routes=Array.from({length:10},(_,i)=>({id:'route_'+(i+1),name:'ルート'+(i+1),color:'#2161a8'}));
test('同じ色でも10ルートは形と番号で識別できる',()=>{
  const styles=routes.map(r=>pins.routeStyle(r,routes));
  assert.equal(new Set(styles.map(s=>s.shape)).size,5);
  assert.equal(new Set(styles.map(s=>s.shape+':'+s.mark)).size,10);
  assert.equal(styles[9].mark,'10');
  assert.equal(styles[0].color,'#2161a8');
  assert.equal(pins.routeStyle(routes[3],[...routes].reverse()).mark,'4');
});
test('未アポはルート割当済みでも黒旗、アポ後は同じ番号のルート形状になる',()=>{
  const c={routeId:'route_8'};
  const flag=pins.visitStyle(c,routes);
  assert.deepEqual(flag,{shape:'flag',color:'#171a22',mark:'8'});
  assert.equal(pins.visitStyle({...c,status:'pending'},routes).shape,'flag');
  assert.deepEqual(pins.visitStyle({...c,status:'appointed'},routes),{...pins.routeStyle(routes[7],routes),mark:'R8'});
  assert.notEqual(pins.visitStyle({status:'completed'},routes).shape,pins.visitStyle({status:'appointed'},routes).shape);
});
test('保存済みの色は保ち、SVGに任意の文字列を入れない',()=>{
  const r={id:'custom',color:'" onclick="alert(1)'};
  const s=pins.routeStyle(r,[...routes,r]);
  assert.equal(s.mark,'11');
  assert.doesNotMatch(pins.svg(s),/onclick/);
  assert.match(pins.svg(pins.visitStyle({status:'pending'},[])),/#171a22/);
});

test('旗のポールと通常ピンの先端をそれぞれ地図の座標に置く',()=>{
  class Point { constructor(x,y){Object.assign(this,{x,y});} }
  class Size { constructor(width,height){Object.assign(this,{width,height});} }
  const maps={Point,Size};
  const pending=pins.icon(pins.visitStyle({routeId:'route_4',status:'pending'},routes),maps);
  const appointed=pins.icon(pins.visitStyle({routeId:'route_4',status:'appointed'},routes),maps);
  assert.deepEqual([pending.anchor.x,appointed.anchor.x],[7,18]);
  assert.match(decodeURIComponent(pending.url),/>4<\/text>/);
  assert.doesNotMatch(decodeURIComponent(appointed.url),/#171a22/);
});
