import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Terrain} from '../src/frontend/terrain.js';
test('3D projection changes with elevation, rotation and tilt; 2D ignores elevation',()=>{const t=new Terrain({});const high=t.project(400,500,1),low=t.project(400,500,0);assert.ok(high[1]<low[1]);const initial=t.project(200,300,0);t.yaw+=1;assert.notDeepEqual(t.project(200,300,0),initial);t.pitch=.3;assert.notDeepEqual(t.project(400,500,1),high);t.flat=true;assert.deepEqual(t.project(400,500,0),t.project(400,500,1));assert.deepEqual(t.project(400,500,1),[400,565]);});
test('connections climb the terrain instead of cutting through a ridge',()=>{const t=new Terrain({});t.field=(x)=>({h:Math.exp(-(((x-60)/20)**2))});const path=t.surfacePath({x:0,y:0},{x:120,y:0});assert.equal(path[0][0],0);assert.equal(path.at(-1)[0],120);assert.ok(path.some(p=>p[2]>.99));for(const [x,y,z] of path)assert.ok(Math.abs(z-t.surfaceHeight(x,y)-.006)<1e-9);t.flat=true;assert.ok(path.every(p=>t.project(...p)[1]===65));});
test('surface height interpolates the actual mesh triangles',()=>{const t=new Terrain({});t.heightGrid=[[{h:0},{h:1}],[{h:2},{h:4}]];assert.equal(t.surfaceHeight(-134,-177),1.25);assert.equal(t.surfaceHeight(-137,-174),1.5);const path=t.surfacePath({x:-139,y:-179},{x:-129,y:-169});assert.ok(path.every(p=>p.every(Number.isFinite)));});
test('themes recolor terrain and cached connections without moving notes or the camera',()=>{
  const t=new Terrain({});t.resize=()=>{};
  t.setRegions([{center:[600,450],count:8,color:'#bca9df'}]);
  const points=[{id:'a',x:450,y:450},{id:'b',x:750,y:450}],edges=[{a:'a',b:'b'}];
  t.setConnections(points,edges);
  const geometry=Array.from(t.connections).filter((_,i)=>i%7<3),darkMesh=t.mesh.slice(),darkLinks=t.connections.slice(3,7),camera=t.camera();
  assert.notDeepEqual(Array.from(t.lines.slice(3,6)),Array.from(darkLinks.slice(0,3)));
  assert.ok(t.lines[6]>=.6&&darkLinks[3]>=.2);
  t.setTheme('light');
  assert.equal(t.theme,'light');assert.notDeepEqual(t.mesh,darkMesh);assert.notDeepEqual(t.connections.slice(3,7),darkLinks);
  assert.deepEqual(Array.from(t.connections).filter((_,i)=>i%7<3),geometry);assert.deepEqual(t.camera(),camera);
  t.setConnections(points,edges,'a');assert.ok(t.connections[6]>.9);
  t.setTheme('dark');assert.equal(t.connectionState.selected,'a');assert.deepEqual(t.mesh,darkMesh);
  t.setTheme('constructor');assert.equal(t.theme,'dark');
});
test('contours are evenly spaced, at most ~12 per summit, and lie on the triangulated surface',()=>{
  const t=new Terrain({});t.resize=()=>{};t.setRegions([{center:[600,450],count:8,color:'#bca9df'}]);
  const levels=[...new Set(Array.from(t.lines).filter((_,i)=>i%7===2).map(z=>z.toFixed(4)))].map(Number).sort((a,b)=>a-b);
  assert.ok(levels.length>2&&levels.length<=13);const gap=levels[1]-levels[0];assert.ok(gap>=.126-1e-5);for(let i=1;i<levels.length;i++)assert.ok(Math.abs(levels[i]-levels[i-1]-gap)<2e-4);
  for(let k=0;k<t.lines.length;k+=14){const a=t.lines;for(const fraction of [0,.5,1]){const x=a[k]+(a[k+7]-a[k])*fraction,y=a[k+1]+(a[k+8]-a[k+1])*fraction,z=a[k+2]+(a[k+9]-a[k+2])*fraction;assert.ok(Math.abs(z-t.surfaceHeight(x,y)-.004)<1e-6);}}
});
test('fill bands grade blue to rose with height and the base contour ring is the palest and brightest',()=>{
  const t=new Terrain({});t.resize=()=>{};t.setRegions([{center:[600,450],spread:80,count:30,color:'#bca9df'}]);
  const low=t.heightGrid[0][0].color,peak=t.heightGrid.flat().reduce((a,b)=>b.h>a.h?b:a).color;
  assert.ok(peak[0]>low[0]*3&&peak[0]>peak[2]);assert.ok(low[2]>low[0]);
  const lines=Array.from(t.lines),rings=[];for(let k=0;k<lines.length;k+=14)rings.push([lines[k+2],lines.slice(k+3,k+7)]);
  rings.sort((a,b)=>a[0]-b[0]);const base=rings[0][1],top=rings.at(-1)[1];
  assert.ok(base[3]>top[3]&&base[2]>top[2]&&top[0]>top[2]);
});
test('independent XYZ scaling keeps surface paths attached and ignores height in 2D',()=>{
  const t=new Terrain({});t.resize=()=>{};t.setRegions([{center:[600,450],count:8,color:'#bca9df'}]);
  const points=[{id:'a',x:450,y:450},{id:'b',x:750,y:450}],edges=[{a:'a',b:'b'}];t.setConnections(points,edges);
  const mesh=t.mesh,paths=t.connections;t.flat=true;
  t.setScaling({enabled:true,x:2,y:1.5,z:3});assert.deepEqual(t.project(700,500,1),[800,590]);assert.deepEqual(t.project(700,500,1),t.project(700,500,0));
  t.flat=false;t.yaw=0;t.pitch=.5;assert.ok(Math.abs(t.project(600,450,1)[1]-(515-90*Math.cos(.5)))<1e-8);
  assert.equal(t.mesh,mesh);assert.equal(t.connections,paths);t.scale=1;t.ox=0;t.oy=0;assert.deepEqual(t.point(points[0].x,points[0].y),t.project(...t.connectionPaths[0][0]));
  for(let k=0;k<paths.length;k+=7){const p=paths.slice(k,k+3);assert.ok(Math.abs(p[2]-t.surfaceHeight(p[0],p[1])-.006)<1e-6);}
  for(const yaw of [-Math.PI/2,0,2])for(const pitch of [.25,1.5])for(let k=0;k<mesh.length;k+=147){const ry=(mesh[k]-600)*2*Math.sin(yaw)+(mesh[k+1]-450)*1.5*Math.cos(yaw),depth=(ry*Math.cos(pitch)+mesh[k+2]*3*30*Math.sin(pitch))/t.depthRange();assert.ok(Math.abs(depth)<=1);}
  t.setScaling({enabled:false,x:2,y:1.5,z:3});assert.deepEqual(t.axisScale,[1,1,1]);
});
test('invalid saved scaling values are bounded before reaching renderers',async()=>{
  const {normalizeScaling}=await import('../src/frontend/terrain.js');
  assert.deepEqual(normalizeScaling(null),{enabled:false,x:1,y:1,z:1,base:2.5});
  assert.deepEqual(normalizeScaling({enabled:true,x:Infinity,y:-5,z:900,base:9}),{enabled:true,x:1,y:.5,z:3,base:4});
  assert.deepEqual(normalizeScaling({enabled:'yes',x:'2',y:1.24,z:0,base:.2}),{enabled:false,x:1,y:1.25,z:.25,base:.5});
});
test('hills with more ideas are taller and broader, and the base slider widens every footprint',()=>{
  const t=new Terrain({});t.resize=()=>{};
  const big={center:[300,450],spread:80,count:50,color:'#99bd9e'},small={center:[900,450],spread:80,count:5,color:'#bca9df'};
  t.setRegions([big,small]);assert.equal(t.base,2.5);t.setScaling({enabled:false,base:1});
  assert.ok(t.field(...big.center).h>t.field(...small.center).h*3);
  // Height is proportional to share: a half-size hill sits near the middle, not near the top.
  const mid={center:[600,100],spread:80,count:25,color:'#d8b07c'};t.setRegions([big,mid,small]);t.setScaling({enabled:false,base:1});
  const hb=t.field(...big.center).h,hm=t.field(...mid.center).h,hs=t.field(...small.center).h;
  assert.ok(hb>hm&&hm>hs);assert.ok(Math.abs((hm-hs)/(hb-hs)-.44)<.08);t.setRegions([big,small]);t.setScaling({enabled:false,base:1});
  assert.ok(t.footprint(big)>t.footprint(small)*1.2);
  // Every note of the small hill (offsets up to 1.35×spread) still stands on ground its hill raised.
  assert.ok(t.field(small.center[0]+small.spread*1.35,450).h>t.field(small.center[0]+small.spread*1.8+1,450).h);
  // Same offset from each summit: the bigger hill is still high where the small one has fallen away.
  assert.ok(t.field(big.center[0]+110,450).h>t.field(small.center[0]+110,450).h*2);
  const before=t.footprint(small),edge=t.field(small.center[0]+150,450).h;
  t.setScaling({enabled:false,base:2});
  assert.equal(t.base,2);assert.ok(Math.abs(t.footprint(small)-before*2)<1e-9);assert.ok(t.field(small.center[0]+150,450).h>edge*1.5);
  t.setScaling({enabled:false,base:1});assert.equal(t.base,1);assert.ok(Math.abs(t.footprint(small)-before)<1e-9);
});
test('unrelated regions form distinct peaks with a valley between their mountains',async()=>{
  const {landscape,parseNote}=await import('../src/shared/knowledge.js');
  const notes=Array.from({length:6},(_,i)=>({...parseNote(i<3?'Trees garden roots':'Graphics shader code',i+'.md'),embedding:i<3?[1,0]:[0,1],embeddingModel:'fixture'}));
  // Intrinsic separation at base 1×; the wider default base deliberately blends neighbours.
  const model=landscape(notes),t=new Terrain({});t.base=1;t.regions=model.regions;assert.equal(t.regions.length,2);
  const [a,b]=t.regions;assert.ok(t.field(...a.center).h>.5);assert.ok(t.field(...b.center).h>.5);
  const fraction=a.spread/(a.spread+b.spread),x=a.center[0]+(b.center[0]-a.center[0])*fraction,y=a.center[1]+(b.center[1]-a.center[1])*fraction;
  assert.ok(t.field(x,y).h>0&&t.field(x,y).h<Math.min(t.field(...a.center).h,t.field(...b.center).h)*.1);
});

test('meadow hills have broad shoulders and blend smoothly into rolling low ground',()=>{
  const t=new Terrain({});t.regions=[{center:[600,450],spread:100,count:8,color:'#99bd9e'}];
  const peak=t.field(600,450).h,shoulder=t.field(660,450).h;assert.ok(shoulder/peak>.7);
  const edge=600+t.footprint(t.regions[0])*1.8;assert.ok(Math.abs(t.field(edge-.001,450).h-t.field(edge+.001,450).h)<1e-4);
  const lift=Math.abs(t.project(600,450,t.field(600,450).h)[1]-t.project(600,450,0)[1]);assert.ok(lift>40&&lift<100);
});
test('Fit landscape frames spread-out regions and active XYZ scales in both views',()=>{
  const original=globalThis.devicePixelRatio;globalThis.devicePixelRatio=1;
  try{
    const t=new Terrain({getBoundingClientRect:()=>({width:1188,height:762})});t.regions=[{center:[100,150],spread:110,count:8,color:'#99bd9e'},{center:[1100,750],spread:90,count:8,color:'#bca9df'}];t.maxHeight=1.2;t.resize();
    for(const flat of [false,true]){t.flat=flat;t.setScaling({enabled:true,x:3,y:2,z:3});t.fit();assert.deepEqual(t.axisScale,[3,2,3]);for(const r of t.regions)for(const signX of [-1,1])for(const signY of [-1,1])for(const h of [0,1.2]){const [x,y]=t.project(r.center[0]+signX*r.spread*1.8,r.center[1]+signY*r.spread*1.8,h);assert.ok(x*t.scale+t.ox>=40&&x*t.scale+t.ox<=1148);assert.ok(y*t.scale+t.oy>=40&&y*t.scale+t.oy<=722);}}
  }finally{if(original===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=original;}
});
