import {denseCosine,positionNotes,positionRegions} from './layout.js';
const stop = new Set('https http www com github utm source medium false true null a an the and or of in on at to for from with is are was be been it its this that these those as by how what why can will would should your you our we their they my i not but about into more through than have has do does all also us them most one new'.split(' '));
export const palette = ['#b9b3e7', '#99bd9e', '#d8b07c', '#82afb9', '#ca96ac', '#9faaa5'];
export const centers = [[360,345],[810,260],[630,580],[1055,490],[150,650],[1020,760]];
function regionColor(index){
  if(index<palette.length)return palette[index];
  const hue=(index*137.508)%360,light=.70,chroma=.33*Math.min(light,1-light);
  const channel=n=>{const k=(n+hue/30)%12;return Math.round(255*(light-chroma*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};
  return '#'+channel(0)+channel(8)+channel(4);
}
export function hash(s) { let h=2166136261; for (const c of s) h=Math.imul(h^c.charCodeAt(0),16777619); return h>>>0; }
export function tokens(s) { return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}-]{2,}/gu)||[]).filter(w=>!stop.has(w)&&!/^\d/.test(w)); }
export function parseNote(text, path='Untitled.md', modified=Date.now()) {
  if (typeof text!=='string' || text.length>2_000_000) throw new Error('Notes must be text smaller than 2 MB.');
  const front=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const body=front?text.slice(front[0].length):text;
  const title=(front?.[1].match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]||body.match(/^#\s+(.+)$/m)?.[1]||path.split(/[\\/]/).pop().replace(/\.(md|markdown|txt)$/i,'')).trim();
  const tags=[...new Set([...(body.match(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)||[]).map(t=>t.trim().slice(1)),...(front?.[1].match(/^tags:\s*\[([^\]]*)\]/m)?.[1]||'').split(',').map(t=>t.trim().replace(/^["']|["']$/g,'')),...(front?.[1].match(/^tags:\s*\n((?:[ \t]+- .+\r?\n?)+)/m)?.[1].match(/- (.+)/g)||[]).map(t=>t.slice(2).trim().replace(/^[\"']|[\"']$/g,''))].filter(Boolean))];
  const links=[...body.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)].map(m=>m[1].trim());
  const url=body.match(/https?:\/\/[^\s)>\]]+/)?.[0]||'';
  return {id:'n'+hash(path),path,title,body,tags,links,url,modified:Number(modified)||Date.now(),type:url?( /youtu\.be|youtube\.com|vimeo\.com/.test(url)?'video':'article'):'note',starred:false};
}
export function validateNote(n) {
  if (!n || typeof n.id!=='string' || !n.id || n.id.length>300 || typeof n.title!=='string' || !n.title.trim() || n.title.length>1000 || typeof n.body!=='string' || n.body.length>2_000_000 || !Array.isArray(n.tags)||!n.tags.every(x=>typeof x==='string')||!Array.isArray(n.links)||!n.links.every(x=>typeof x==='string')) throw new Error('Invalid note.');
  if(n.path!==undefined&&typeof n.path!=='string')throw new Error('Invalid note path.');
  if(n.embedding!==undefined&&(!Array.isArray(n.embedding)||n.embedding.length>4096||!n.embedding.every(Number.isFinite)||typeof n.embeddingModel!=='string'))throw new Error('Invalid embedding.');
  return n;
}
function vector(n) {
  const counts=new Map();
  for(const w of tokens(n.title+' '+n.title+' '+(n.tags.join(' ')+' ').repeat(3)+' '+n.body.slice(0,24000).replace(/https?:\/\/\S+/g,' '))) counts.set(w,(counts.get(w)||0)+1);
  return counts;
}
export function similarity(a,b) {let dot=0,aa=0,bb=0;for(const [w,v] of a){aa+=v*v;dot+=v*(b.get(w)||0);}for(const v of b.values())bb+=v*v;return dot/Math.sqrt(aa*bb||1);}
export function landscape(notes) {
  if (!notes.length) return {regions:[],points:[],edges:[]};
  const vecs=notes.map(vector), df=new Map();
  vecs.forEach(v=>{for(const w of v.keys())df.set(w,(df.get(w)||0)+1);});
  vecs.forEach(v=>{for(const [w,c] of v)v.set(w,(1+Math.log(c))*Math.log(1+notes.length/(df.get(w)||1)));});
  const reference=notes.find(n=>n.embedding?.length),known=notes.map((n,i)=>n.embedding?.length===reference?.embedding?.length&&n.embedding?.length&&n.embeddingModel===reference?.embeddingModel?i:-1).filter(i=>i>=0),knownSet=new Set(known);
  const semanticReady=known.length>=2&&known.length>=notes.length/2;
  const groups=[],tagged=new Map();let assignments;
  if(semanticReady){
    const seeds=[known[0]],nearest=notes.map((n,i)=>knownSet.has(i)?denseCosine(n.embedding,notes[known[0]].embedding):Infinity);
    // shortcut: cap at 64 regions for large collections; use a multilevel atlas beyond that.
    while(seeds.length<Math.min(64,known.length)){
      let best=-1,score=Infinity;for(const i of known)if(nearest[i]<score){score=nearest[i];best=i;}
      if(best<0||score>=.12)break;
      seeds.push(best);for(const i of known)nearest[i]=Math.max(nearest[i],denseCosine(notes[i].embedding,notes[best].embedding));
    }
    let centroids=seeds.map(i=>notes[i].embedding);
    for(let step=0;step<18;step++){
      assignments=notes.map((n,index)=>{if(!knownSet.has(index))return -1;let best=0,score=-Infinity;centroids.forEach((v,i)=>{const s=denseCosine(n.embedding,v);if(s>score){score=s;best=i;}});return best;});
      const sums=centroids.map(()=>Array(centroids[0].length).fill(0)),counts=centroids.map(()=>0);
      notes.forEach((n,i)=>{const k=assignments[i];if(k<0)return;counts[k]++;n.embedding.forEach((v,j)=>sums[k][j]+=v);});
      centroids=sums.map((v,i)=>counts[i]?v:centroids[i]);
    }
    const remap=new Map();assignments.forEach((k,i)=>{if(k<0)return;if(!remap.has(k)){remap.set(k,groups.length);groups.push({v:new Map(),indices:[]});}const index=remap.get(k);groups[index].indices.push(i);for(const [w,v] of vecs[i])groups[index].v.set(w,(groups[index].v.get(w)||0)+v);});assignments=assignments.map(k=>k<0?-1:remap.get(k));
    assignments.forEach((k,i)=>{if(k>=0)return;let best=0,score=-1;groups.forEach((g,j)=>{const s=similarity(vecs[i],g.v);if(s>score){score=s;best=j;}});if(score<.13&&groups.length<64){best=groups.length;groups.push({v:new Map(),indices:[]});}assignments[i]=best;groups[best].indices.push(i);for(const [w,v] of vecs[i])groups[best].v.set(w,(groups[best].v.get(w)||0)+v);});
  }else{
  // Existing tags are stronger evidence than vocabulary; untagged notes use weighted similarity.
  assignments=notes.map((n,i)=>{
    const tag=n.tags[0]?.toLowerCase();
    let best=tagged.get(tag)??-1,score=.13;
    if(best<0 && !tag) groups.forEach((g,k)=>{const s=similarity(vecs[i],g.v);if(s>score){best=k;score=s;}});
    if(best<0 && groups.length<64){best=groups.length;groups.push({v:new Map(),indices:[]});if(tag)tagged.set(tag,best);}
    if(best<0){best=0;let s=-1;groups.forEach((g,k)=>{const x=similarity(vecs[i],g.v);if(x>s){s=x;best=k;}});}
    groups[best].indices.push(i);for(const [w,v] of vecs[i])groups[best].v.set(w,(groups[best].v.get(w)||0)+v);
    return best;
  });
  }
  const regionNames=new Set();
  const regions=groups.map((g,i)=>{
    const commonTags=new Map(),titleTerms=new Map();
    g.indices.forEach(j=>{
      notes[j].tags.forEach(t=>commonTags.set(t,(commonTags.get(t)||0)+1));
      for(const word of new Set(tokens(notes[j].title)))titleTerms.set(word,(titleTerms.get(word)||0)+Math.log(1+notes.length/(df.get(word)||1)));
    });
    const tag=!semanticReady?[...commonTags].filter(([t])=>!['clippings','notes','source','daily'].includes(t.toLowerCase())).sort((a,b)=>b[1]-a[1])[0]?.[0]:null;
    const words=[...(semanticReady&&titleTerms.size?titleTerms:g.v)].sort((a,b)=>b[1]-a[1]).map(([word])=>word);
    let name=(tag||words.slice(0,semanticReady?2:1).join(' ')||'Ideas').replace(/[-_/]/g,' ').replace(/\b\p{L}/gu,c=>c.toUpperCase());
    if(regionNames.has(name))name+=' '+(i+1);regionNames.add(name);
    return {id:i,name,color:regionColor(i),center:centers[i]||[600+Math.cos(i*2.4)*400,450+Math.sin(i*2.4)*280],count:g.indices.length};
  });
  const points=notes.map((n,i)=>{const r=regions[assignments[i]],h=hash(n.id),a=(h%6283)/1000, radius=35+((h>>>8)%115); return {...n,region:r.id,x:r.center[0]+Math.cos(a)*radius,y:r.center[1]+Math.sin(a)*radius*.82};});
  const paths=new Map(),aliases=new Map();
  const stem=p=>p.replace(/\\/g,'/').replace(/\.(md|markdown|txt)$/i,'').toLowerCase();
  notes.forEach(n=>{paths.set(stem(n.path),n.id);for(const key of new Set([stem(n.path).split('/').pop(),n.title.toLowerCase()]))aliases.set(key,aliases.has(key)?null:n.id);});
  const edges=[],seen=new Set();
  const add=(a,b,kind,weight=1)=>{const key=[a,b].sort().join('|');if(a!==b&&!seen.has(key)){seen.add(key);edges.push({a,b,kind,weight});}};
  notes.forEach(n=>n.links.forEach(l=>{const key=stem(l),folder=stem(n.path).split('/').slice(0,-1).join('/');const id=paths.get(folder?folder+'/'+key:key)||paths.get(key)||aliases.get(key);if(id)add(n.id,id,'link');}));
  const indices=new Map(notes.map((n,i)=>[n.id,i])),linked=new Set(edges.map(e=>[indices.get(e.a),indices.get(e.b)].sort((a,b)=>a-b).join(':')));
  const pairs=[],pairKeys=new Set(),neighbors=notes.map(()=>[]);
  const addPair=(i,j)=>{if(i===j)return;if(i>j)[i,j]=[j,i];const key=i+':'+j;if(pairKeys.has(key))return;pairKeys.add(key);
    const a=notes[i],b=notes[j],lexical=similarity(vecs[i],vecs[j]),shared=a.tags.some(t=>b.tags.includes(t));
    const semantic=a.embedding&&b.embedding&&a.embeddingModel===b.embeddingModel&&a.embedding.length===b.embedding.length;
    let score=semantic?Math.max(0,denseCosine(a.embedding,b.embedding))*.80+lexical*.15+(shared?.05:0):lexical*.75+(shared?.25:0);
    if(linked.has(key))score=Math.min(1,score+.15);
    pairs.push({i,j,score});neighbors[i].push({j,score});neighbors[j].push({j:i,score});
  };
  // shortcut: all pairs up to 600 notes; larger collections use deterministic samples plus explicit links.
  for(let i=0;i<notes.length;i++){if(notes.length<=600){for(let j=i+1;j<notes.length;j++)addPair(i,j);}else{for(let k=1;k<=60;k++)addPair(i,(i+k*97)%notes.length);for(const j of groups[assignments[i]].indices.slice(0,35))addPair(i,j);}}
  for(const e of edges)addPair(indices.get(e.a),indices.get(e.b));
  neighbors.forEach((list,i)=>list.filter(p=>p.score>.20).sort((a,b)=>b.score-a.score).slice(0,3).forEach(p=>add(notes[i].id,notes[p.j].id,'similar',p.score)));
  positionNotes(points,pairs);
  positionRegions(points,regions,pairs);
  return {regions,points,edges};
}
export function matches(n,q){return (n.title+' '+n.body+' '+n.tags.join(' ')).toLowerCase().includes(q.toLowerCase());}
export function safeURL(url) {try{const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
