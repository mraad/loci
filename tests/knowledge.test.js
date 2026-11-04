import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseNote,landscape,validateNote,safeURL,matches} from '../src/shared/knowledge.js';
import {demoNotes} from '../src/shared/demo.js';
test('Obsidian frontmatter, aliases, headings, tags and URLs',()=>{const n=parseNote('---\ntitle: "A garden"\ntags: [nature, ideas]\n---\n# Heading\n[[folder/Tree#Roots|trees]] and #ecology\nhttps://example.com','Garden.md');assert.equal(n.title,'A garden');assert.deepEqual(n.links,['folder/Tree']);assert.deepEqual(n.tags,['ecology','nature','ideas']);assert.equal(n.url,'https://example.com');assert.equal(n.type,'article');assert.equal(n.id,parseNote('changed','Garden.md').id);});
test('Windows paths and multiline YAML tags',()=>{const n=parseNote('---\ntags:\n  - design\n  - systems\n---\nHello','C:\\notes\\My note.md');assert.equal(n.title,'My note');assert.deepEqual(n.tags,['design','systems']);});
test('graph resolves paths and aliases and ignores unresolved links',()=>{const a=parseNote('[[folder/Tree|tree]] [[Unknown]]','Garden.md'),b=parseNote('Roots and leaves','folder/Tree.md');const g=landscape([a,b]);assert.equal(g.edges.filter(e=>e.kind==='link').length,1);assert.equal(g.edges[0].b,b.id);assert.equal(landscape([]).regions.length,0);});
test('landscape is deterministic with finite coordinates and deduplicated edges',()=>{const g=landscape(demoNotes);assert.deepEqual(g,landscape(demoNotes));assert.ok(g.regions.length<=6);assert.equal(g.points.length,demoNotes.length);g.points.forEach(n=>assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y)));assert.equal(new Set(g.edges.map(e=>[e.a,e.b].sort().join('|'))).size,g.edges.length);});
test('search, validation and safe source boundaries',()=>{assert.ok(matches(demoNotes[0],'QUIET'));assert.throws(()=>validateNote({title:'oops'}));assert.throws(()=>parseNote('x'.repeat(2_000_001)));assert.equal(safeURL('javascript:alert(1)'),null);assert.equal(safeURL('file:///etc/passwd'),null);assert.equal(safeURL('https://example.com'),'https://example.com/');});
test('tags define distinct topic regions rather than repeated names',()=>{const g=landscape(demoNotes);assert.equal(g.regions.length,6);assert.deepEqual(g.regions.map(r=>r.name),['Design','Nature','Learning','Technology','Creativity','Living']);for(const tag of ['design','nature','learning'])assert.equal(new Set(g.points.filter(n=>n.tags.includes(tag)).map(n=>n.region)).size,1);});
test('duplicate basenames resolve within the source folder',()=>{const a=parseNote('[[Tree]]','a/Garden.md'),b=parseNote('Roots','a/Tree.md'),c=parseNote('Other tree','b/Tree.md');const g=landscape([a,b,c]);assert.equal(g.edges.find(e=>e.kind==='link').b,b.id);});
test('similar notes are nearer than unrelated notes',()=>{const ns=[parseNote('Garden trees roots flowers soil leaves','a.md'),parseNote('Garden trees roots flowers soil leaves','b.md'),parseNote('Graphics shader rendering computer GPU pipeline','c.md'),parseNote('Graphics shader rendering computer GPU pipeline','d.md')];const g=landscape(ns),dist=(i,j)=>Math.hypot(g.points[i].x-g.points[j].x,g.points[i].y-g.points[j].y);assert.ok(dist(0,1)<dist(0,2));assert.ok(dist(2,3)<dist(1,3));});
test('semantic vectors connect synonyms without shared vocabulary',()=>{const a={...parseNote('automobile journey','a.md'),embedding:[1,0],embeddingModel:'fixture'},b={...parseNote('car travel','b.md'),embedding:[.99,.01],embeddingModel:'fixture'},c={...parseNote('cooking soup','c.md'),embedding:[0,1],embeddingModel:'fixture'};const g=landscape([a,b,c]),d=(i,j)=>Math.hypot(g.points[i].x-g.points[j].x,g.points[i].y-g.points[j].y);assert.ok(d(0,1)<d(0,2));});
test('content fingerprint and mean vector match the Rust core',async()=>{const {contentHash,meanVector}=await import('../src/shared/embedding-utils.js');assert.equal(contentHash({title:'Café 🚀',body:'A garden 🌳'}),3765279659);assert.equal(parseNote('x','MyVault/notes/a.md').id,'n118555874');assert.deepEqual(meanVector([[2,0],[2,0]]),[1,0]);});
test('an unindexed new note does not discard established semantic regions',()=>{const notes=Array.from({length:6},(_,i)=>({...parseNote(i<3?'Garden trees roots':'Computer code shader',i+'.md'),embedding:i<3?[1,0]:[0,1],embeddingModel:'fixture'}));const before=landscape(notes),after=landscape([...notes,parseNote('New garden roots','new.md')]);assert.equal(after.regions.length,before.regions.length);for(let i=0;i<notes.length;i++)assert.equal(after.points[i].region,before.points[i].region);});
test('unrelated semantic families get their own regions beyond the old six-region cap',()=>{
  const notes=Array.from({length:24},(_,i)=>({...parseNote('Topic '+Math.floor(i/3),i+'.md'),embedding:Array.from({length:8},(_,j)=>j===Math.floor(i/3)?1:0),embeddingModel:'fixture'}));
  const result=landscape(notes);assert.equal(result.regions.length,8);
  for(let family=0;family<8;family++)assert.equal(new Set(result.points.slice(family*3,family*3+3).map(p=>p.region)).size,1);
  assert.equal(new Set(result.points.filter((_,i)=>i%3===0).map(p=>p.region)).size,8);
  for(let i=0;i<result.regions.length;i++)for(let j=i+1;j<result.regions.length;j++){const a=result.regions[i],b=result.regions[j];assert.ok(Math.hypot(a.center[0]-b.center[0],a.center[1]-b.center[1])>1.8*(a.spread+b.spread));}
  for(const p of result.points){const r=result.regions[p.region];assert.ok(Math.hypot(p.x-r.center[0],p.y-r.center[1])<=r.spread*1.35+1e-6);assert.ok(p.x>=-40&&p.x<=1240&&p.y>=70&&p.y<=830);}
  assert.deepEqual(result,landscape(notes));assert.ok(result.regions.every(r=>/^#[0-9a-f]{6}$/i.test(r.color)));
});
test('an unrelated unindexed note gets a separate region instead of being forced into an existing topic',()=>{
  const notes=Array.from({length:4},(_,i)=>({...parseNote(i<2?'Garden roots trees':'Computer code shader',i+'.md'),embedding:i<2?[1,0]:[0,1],embeddingModel:'fixture'}));
  const before=landscape(notes),after=landscape([...notes,parseNote('Ballet choreography pirouette','dance.md')]);
  assert.equal(after.regions.length,before.regions.length+1);assert.equal(after.regions[after.points.at(-1).region].count,1);
});
test('dense knowledge spreads over hill shoulders instead of piling up at the summit',()=>{
  const notes=Array.from({length:30},(_,i)=>({...parseNote('Garden trees roots',i+'.md'),embedding:[1,0],embeddingModel:'fixture'}));
  const result=landscape(notes),region=result.regions[0];let closest=Infinity;
  for(let i=0;i<result.points.length;i++)for(let j=i+1;j<result.points.length;j++)closest=Math.min(closest,Math.hypot(result.points[i].x-result.points[j].x,result.points[i].y-result.points[j].y));
  assert.ok(closest>region.spread*.2);assert.ok(result.points.filter(p=>Math.hypot(p.x-region.center[0],p.y-region.center[1])>region.spread*.7).length>10);
});
