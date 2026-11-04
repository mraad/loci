import {landscape,parseNote,validateNote,matches,safeURL,palette} from '../shared/knowledge.js';
import {demoNotes} from '../shared/demo.js';
import {Terrain,normalizeScaling} from './terrain.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon=name=>`<svg><use href="#i-${name}"/></svg>`;
let theme='dark';try{if(localStorage.getItem('loci-theme')==='light')theme='light';}catch{}
let scaling=normalizeScaling(null);try{scaling=normalizeScaling(JSON.parse(localStorage.getItem('loci-scaling')));}catch{}
document.documentElement.dataset.theme=theme;
const regionColor=color=>theme==='light'?'#'+color.slice(1).match(/../g).map(c=>Math.round(parseInt(c,16)*.58).toString(16).padStart(2,'0')).join(''):color;
let serverMode=false;
let notes=[],model={regions:[],points:[],edges:[]},selected=null,view='landscape',region=null,editing=null,db,toastTimer,searchVersion=0;
const tauri=globalThis.__TAURI__?.core;
const native=!!tauri;
const terrain=new Terrain($('terrain'),()=>{renderOverlay();$('renderer-label').textContent=terrain.mode+' · on this device';},theme);
async function apiCall(name,params={}){
  let data;
  if(tauri)data=await tauri.invoke('loci',{operation:name,params});
  else {const response=await fetch('/api/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)});data=await response.json();if(!response.ok)throw new Error(data.error||'Server request failed.');}
  if(name==='importVault'&&data?.files)data.notes=data.files.map(f=>({...parseNote(f.text,f.path,f.modified),source:'Obsidian'}));
  if(name==='importAppleNotes'&&data?.appleNotes)data.notes=data.appleNotes.map(row=>({...parseNote(row.text,'Apple Notes/'+row.folder+'/'+row.title+'.md',Date.parse(row.modified)),id:'apple:'+row.id,title:row.title||'Untitled',source:'Apple Notes'}));
  return data;
}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),4500);}
function run(fn){return (...args)=>Promise.resolve().then(()=>fn(...args)).catch(error=>{console.error(error);toast(String(error.message||error));});}
function listen(id,event,fn){$(id).addEventListener(event,run(fn));}
function modal(id){$(id).showModal();}
async function browserDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('loci',1);req.onupgradeneeded=()=>req.result.createObjectStore('notes',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function localNotes(){return new Promise((resolve,reject)=>{const r=db.transaction('notes').objectStore('notes').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function persist(changed){
  const real=changed.filter(n=>!n.demo);if(!real.length)return;
  document.querySelector('.saved-status').lastChild.textContent=' Saving…';
  try{
    if(native||serverMode)await apiCall('importNotes',{notes:real});
    else await new Promise((resolve,reject)=>{const tx=db.transaction('notes','readwrite');real.forEach(n=>tx.objectStore('notes').put(validateNote(n)));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
    document.querySelector('.saved-status').lastChild.textContent=' All changes saved';
  }catch(e){document.querySelector('.saved-status').lastChild.textContent=' Could not save';throw e;}
}
function isDemo(){return notes.length>0&&notes.every(n=>n.demo);}
async function rebuild(){
  model=landscape(notes);terrain.setRegions(model.regions);
  $('all-count').textContent=notes.length;$('star-count').textContent=notes.filter(n=>n.starred).length;$('region-count').textContent=model.regions.length;
  $('map-stats').textContent=`${notes.length} thoughts · ${model.regions.length} regions · ${notes.every(n=>n.embedding?.length)?'semantic map':notes.some(n=>n.embedding?.length)?'hybrid map':'vocabulary map'}`;$('sample-badge').hidden=!isDemo();
  $('regions').innerHTML=model.regions.map(r=>`<button class="region-button ${region===r.id?'active':''}" data-region="${r.id}" style="--region-color:${r.color}"><span class="region-dot"></span>${esc(r.name)}<span class="count">${r.count}</span></button>`).join('');
  renderOverlay();renderPreview();renderList();
  if((native||serverMode)&&!isDemo())await apiCall('saveGraph',{edges:model.edges});
}
function renderOverlay(){
  const svg=$('overlay');svg.classList.toggle('many-regions',model.regions.length>10);svg.setAttribute('viewBox',`0 0 ${terrain.width||1} ${terrain.height||1}`);
  const coords=new Map(model.points.map(n=>[n.id,terrain.point(n.x,n.y)]));
  const connected=new Set(model.edges.filter(e=>e.a===selected||e.b===selected).flatMap(e=>[e.a,e.b]));
  terrain.setConnections(model.points,model.edges,selected,region);
  const labels=model.regions.map(r=>{const p=terrain.point(r.center[0],r.center[1]+r.spread*1.65+12);return `<text class="region-label" x="${p[0]}" y="${p[1]}" style="fill:${regionColor(r.color)}" opacity="${region!==null&&region!==r.id?.2:.65}">${esc(r.name.toUpperCase())}</text><text class="region-sub" x="${p[0]}" y="${p[1]+17}">${r.count} connected thoughts</text>`;}).join('');
  const occupied=[];
  const points=[...model.points].sort((a,b)=>(b.id===selected)-(a.id===selected)).map((n,i)=>{const p=coords.get(n.id),r=model.regions[n.region],active=n.id===selected,dim=region!==null&&region!==n.region;const label=active||(!occupied.some(q=>Math.abs(q[0]-p[0])<145&&Math.abs(q[1]-p[1])<32)&&i<20);if(label)occupied.push(p);const title=n.title.length>28?n.title.slice(0,27)+'…':n.title;return `<g class="note-node" role="button" tabindex="0" data-id="${esc(n.id)}" aria-label="${esc(n.title)}" transform="translate(${p[0]} ${p[1]})" opacity="${dim?.18:1}"><title>${esc(n.title)}</title><circle class="node-hit" r="17"/>${active?`<circle r="14" fill="${regionColor(r.color)}" opacity=".07"/><circle r="9" fill="none" stroke="${regionColor(r.color)}" opacity=".6" stroke-width="1"/>`:''}<circle class="node-dot" r="${active?4.2:connected.has(n.id)?3.8:3}" fill="${active?regionColor(r.color):'var(--node-fill)'}" stroke="${regionColor(r.color)}"/>${label?`<text class="node-label" x="12" y="4" style="font-size:${active?11:9}px;fill:${active?'var(--node-label-active)':'var(--node-label)'}">${esc(title)}</text>`:''}</g>`;}).reverse().join('');
  svg.innerHTML=labels+points;
}
// Drag frames only move what is already drawn; labels and collisions are recomputed on release.
function moveOverlay(){
  const svg=$('overlay');svg.setAttribute('viewBox',`0 0 ${terrain.width||1} ${terrain.height||1}`);
  const byId=new Map(model.points.map(n=>[n.id,n]));
  for(const g of svg.querySelectorAll('.note-node')){const n=byId.get(g.dataset.id);if(!n)continue;const p=terrain.point(n.x,n.y);g.setAttribute('transform',`translate(${p[0]} ${p[1]})`);}
  const names=svg.querySelectorAll('.region-label'),subs=svg.querySelectorAll('.region-sub');
  model.regions.forEach((r,i)=>{const p=terrain.point(r.center[0],r.center[1]+r.spread*1.65+12);names[i]?.setAttribute('x',p[0]);names[i]?.setAttribute('y',p[1]);subs[i]?.setAttribute('x',p[0]);subs[i]?.setAttribute('y',p[1]+17);});
}
function related(id){return model.edges.filter(e=>e.a===id||e.b===id).sort((a,b)=>(b.kind==='link')-(a.kind==='link')||b.weight-a.weight).map(e=>({...notes.find(n=>n.id===(e.a===id?e.b:e.a)),kind:e.kind}));}
function excerpt(n){return n.body.slice(0,4000).replace(/^---[\s\S]*?---\s*/,'').replace(/^#\s+.+\n?/,'').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,target,alias)=>alias||target).replace(/https?:\/\/\S+/g,'').replace(/^#+\s+/gm,'').replace(/#[\p{L}\p{N}_/-]+/gu,'').replace(/[*_`]/g,'').trim();}
function renderPreview(){const n=notes.find(n=>n.id===selected),panel=$('note-preview');panel.hidden=!n||view!=='landscape';if(!n)return;const r=model.regions[model.points.find(p=>p.id===n.id)?.region],rels=related(n.id);panel.innerHTML=`<div class="preview-head">${icon(n.type==='article'?'link':'note')}<span>${n.type==='article'?'Saved article':n.type==='video'?'Saved video':'A thought'} in ${esc(r?.name||'your landscape')}</span><button class="icon-button" id="preview-close" aria-label="Close note preview">${icon('close')}</button></div><h2>${esc(n.title)}</h2><div class="preview-excerpt">${esc(excerpt(n).slice(0,260))}</div><div>${n.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div><div class="preview-divider"></div><div class="preview-related-label"><span>NEARBY THOUGHTS</span><span>${rels.length} connections</span></div>${rels.slice(0,3).map(x=>`<button class="related-note" data-related="${esc(x.id)}">${icon(x.kind==='link'?'link':'note')}<span>${esc(x.title)}</span><span>↗</span></button>`).join('')||'<p class="settings-explanation">Add a [[link]] or a shared #tag to connect this thought.</p>'}<div class="preview-footer"><span>${new Date(n.modified).toLocaleDateString(undefined,{month:'short',day:'numeric'})} · ${Math.max(1,Math.ceil(n.body.split(/\s+/).length/200))} min read</span><button class="icon-button ${n.starred?'card-star':''}" id="preview-star" aria-label="${n.starred?'Remove bookmark':'Bookmark note'}">${icon('star')}</button><button id="preview-open" class="preview-open">Open note ↗</button></div>${safeURL(n.url)?`<button id="preview-source" class="related-note">${icon('link')}Visit original source<span>↗</span></button>`:''}`;}
function setView(next){view=next;region=null;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));$('view-title').textContent={landscape:'Landscape',all:'All notes',starred:'Bookmarks',recent:'Recently added'}[view];$('landscape-shell').hidden=view!=='landscape';$('list-view').hidden=view==='landscape';renderPreview();renderList();renderOverlay();requestAnimationFrame(()=>{terrain.resize();renderOverlay();});}
function renderList(){if(view==='landscape')return;let visible=notes.filter(n=>view!=='starred'||n.starred);if(view==='recent')visible=[...visible].sort((a,b)=>b.modified-a.modified);$('list-title').textContent={all:'All your thoughts.',starred:'Worth coming back to.',recent:'Freshly planted.'}[view]||'All your thoughts.';$('list-description').textContent=`${visible.length} ${visible.length===1?'thought':'thoughts'}. A world of connections.`;$('note-grid').innerHTML=visible.map(n=>`<button class="note-card" data-note="${esc(n.id)}"><div class="card-meta"><span>${icon(n.type==='article'?'link':'note')}</span>${n.starred?`<span class="card-star">${icon('star')}</span>`:''}</div><h2>${esc(n.title)}</h2><p>${esc(excerpt(n).slice(0,180))}</p><div>${n.tags.slice(0,3).map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div></button>`).join('')||'<div class="empty-state">Something worth keeping will find its way here.</div>';}
function select(id){selected=id;if(view!=='landscape')setView('landscape');renderOverlay();renderPreview();}
function openEditor(id=null){editing=id;const n=notes.find(n=>n.id===id);$('edit-title').value=n?.title||'';$('edit-body').value=n?.body||'';$('editor-eyebrow').textContent=n?'A LITTLE ROOM TO THINK':'PLANT A NEW THOUGHT';modal('editor-dialog');setTimeout(()=>$('edit-title').focus(),50);}
async function merge(incoming){
  if(!incoming.length){toast('No supported notes found. Choose .md, .markdown, or .txt files.');return;}
  if(incoming.length>5000)throw new Error('Import up to 5,000 notes at a time.');incoming.forEach(validateNote);
  const current=isDemo()?[]:notes;const merged=new Map(current.map(n=>[n.id,n]));incoming.forEach(n=>merged.set(n.id,{...n,demo:false,starred:merged.get(n.id)?.starred??n.starred??false}));if(merged.size>5000)throw new Error('This collection is limited to 5,000 notes.');
  await persist(incoming.map(n=>merged.get(n.id)));notes=[...merged.values()];selected=incoming[0].id;region=null;await rebuild();setView('landscape');toast(`${incoming.length} thoughts found a home in your landscape.`);
}
async function importFiles(files){const supported=[...files].filter(f=>/\.(md|markdown|txt)$/i.test(f.name));const incoming=[],skipped=[];if(supported.length>5000)throw new Error('Choose a folder with fewer than 5,000 text files.');for(const file of supported){if(file.size>2_000_000){skipped.push(file.name);continue;}const path=file.webkitRelativePath||file.name;if(path.split('/').some(p=>p.startsWith('.')))continue;incoming.push(parseNote(await file.text(),path,file.lastModified));}await merge(incoming);$('import-dialog').close();if(skipped.length)toast(`Imported ${incoming.length} notes. Skipped ${skipped.length} files larger than 2 MB.`);}
async function doSearch(){const request=++searchVersion,q=$('search-input').value.trim();let found;if(!q)found=[...notes].sort((a,b)=>b.modified-a.modified).slice(0,6);else if((native||serverMode)&&!isDemo()){const ids=await apiCall('searchNotes',{query:q});found=notes.filter(n=>ids.includes(n.id));}else found=notes.filter(n=>matches(n,q));if(request!==searchVersion)return;$('search-results').innerHTML=found.slice(0,30).map(n=>`<button class="search-result" data-search="${esc(n.id)}">${icon('note')}<span><strong>${esc(n.title)}</strong><small>${esc(excerpt(n).slice(0,78))}</small></span><span>↗</span></button>`).join('')||'<div class="search-empty">No thoughts found. Try another word or a #tag.</div>';}
listen('search-open','click',()=>{modal('search-dialog');doSearch();$('search-input').focus();});listen('search-input','input',doSearch);
listen('new-note','click',()=>openEditor());listen('import-open','click',()=>modal('import-dialog'));listen('sample-import','click',()=>modal('import-dialog'));
listen('settings-open','click',()=>{$('storage-info').innerHTML=`Storage <strong>${native?'Embedded SQLite':serverMode?'Server SQLite':'Browser IndexedDB'}</strong><br>${notes.filter(n=>!n.demo).length} personal notes · ${model.edges.length} connections<br>Renderer <strong>${esc(terrain.mode)}</strong><br>${native?'Data lives in your OS application data folder.':serverMode?'Data lives in the server’s SQLite file.':'Preview mode. Data is stored in this browser; export a backup to keep it portable.'}`;modal('settings-dialog');});
$('theme-select').value=theme;
listen('theme-select','change',async()=>{theme=$('theme-select').value;document.documentElement.dataset.theme=theme;terrain.setTheme(theme);renderOverlay();try{localStorage.setItem('loci-theme',theme);}catch{toast('Theme changed for this session. Your device could not save the preference.');}if(tauri)await apiCall('setTheme',{theme});});
function scalingControls(){
  $('scaling-enabled').checked=scaling.enabled;$('scaling-axes').disabled=!scaling.enabled;
  for(const axis of ['x','y','z','base']){$('scale-'+axis).value=Math.round(scaling[axis]*100);$('scale-'+axis+'-value').value=scaling[axis].toFixed(2)+'×';}
}
function applyScaling(){scaling=terrain.setScaling(scaling);scalingControls();try{localStorage.setItem('loci-scaling',JSON.stringify(scaling));}catch{toast('Scaling changed for this session. Your device could not save the preference.');}}
scalingControls();
listen('scaling-enabled','change',()=>{scaling.enabled=$('scaling-enabled').checked;applyScaling();});
for(const axis of ['x','y','z','base'])listen('scale-'+axis,'input',()=>{scaling[axis]=Number($('scale-'+axis).value)/100;applyScaling();});
listen('scaling-reset','click',()=>{scaling=normalizeScaling(null);applyScaling();});
listen('about-open','click',()=>{$('settings-dialog').close();modal('about-dialog');});
listen('import-apple-notes','click',async()=>{if(!native){toast('Open the standalone Mac app to import Apple Notes, then export a backup for server mode.');return;}const button=$('import-apple-notes');button.disabled=true;try{toast('Reading Apple Notes. macOS may ask you to allow access.');const result=await apiCall('importAppleNotes');await merge(result.notes);$('import-dialog').close();if(result.skipped)toast(`Imported ${result.notes.length} Apple Notes. Skipped ${result.skipped} locked notes.`);}finally{button.disabled=false;}});
listen('import-vault','click',async()=>{if(native){const result=await apiCall('importVault');if(!result)return;await merge(result.notes);$('import-dialog').close();if(result.skipped.length)toast(`Imported ${result.notes.length} notes. ${result.skipped.length} files skipped: ${result.skipped.slice(0,2).join('; ')}`);}else $('folder-input').click();});
listen('import-files','click',()=>$('file-input').click());listen('import-json','click',()=>$('json-input').click());
for(const id of ['file-input','folder-input'])listen(id,'change',async e=>{try{await importFiles(e.target.files);}finally{e.target.value='';}});
listen('json-input','change',async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>50_000_000)throw new Error('Backup exceeds 50 MB.');const data=JSON.parse(await f.text());if(data.version!==1||!Array.isArray(data.notes))throw new Error('Choose a Loci JSON backup.');await merge(data.notes);$('import-dialog').close();}finally{e.target.value='';}});
async function indexEmbedded(forceCPU=false){
  const worker=new Worker(new URL('./semantic-worker.js',import.meta.url),{type:'module'});
  return new Promise((resolve,reject)=>{worker.onmessage=({data})=>{if(data.type==='progress'){$('index-status').textContent=`${data.done} / ${data.total} thoughts · ${data.device==='webgpu'?'WebGPU':'CPU'}`;}if(data.type==='complete'){worker.terminate();resolve(data.notes);}if(data.type==='error'){worker.terminate();if(data.retryCPU&&!forceCPU){$('index-status').textContent='Using local CPU inference…';indexEmbedded(true).then(resolve,reject);}else reject(new Error(data.message));}};worker.onerror=()=>{worker.terminate();reject(new Error('Local model could not load. Run npm run setup:embeddings and try again.'));};worker.postMessage({notes:notes.filter(n=>!n.demo),device:forceCPU?'wasm':'auto'});});
}
listen('index-semantics','click',async()=>{
  if(isDemo()){toast('Import your notes first to create a semantic map.');return;}
  const button=$('index-semantics');button.disabled=true;$('index-status').textContent='Loading the bundled local model…';
  try{const indexed=await indexEmbedded();const result=await apiCall('saveEmbeddings',{notes:indexed});notes=result.notes;await rebuild();$('index-status').textContent='Semantic landscape ready. Everything stayed on this device.';toast('Your landscape now connects ideas by meaning.');}finally{button.disabled=false;}
});
listen('index-ollama','click',async()=>{if(isDemo()){toast('Import your notes first.');return;}const button=$('index-ollama');button.disabled=true;try{toast('Using your optional local Ollama model…');const result=await apiCall('indexSemantics');notes=result.notes;await rebuild();toast('Local Ollama embeddings are ready.');}finally{button.disabled=false;}});
listen('export-library','click',async()=>{if(native){if(await apiCall('exportLibrary'))toast('Your collection is safely exported.');}else {const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,notes:notes.filter(n=>!n.demo)},null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='loci-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your collection is exported.');}});
listen('editor-form','submit',async e=>{e.preventDefault();const title=$('edit-title').value.trim();if(!title){$('edit-title').focus();return;}const existing=notes.find(n=>n.id===editing);const body=$('edit-body').value;let n=parseNote(body,existing?.path||'Notes/'+crypto.randomUUID()+'.md');n={...n,id:existing?.demo?'note:'+crypto.randomUUID():existing?.id||n.id,title,starred:existing?.starred||false,modified:Date.now()};await persist([n]);notes=notes.filter(x=>!x.demo);const index=notes.findIndex(x=>x.id===n.id);if(index>=0)notes[index]=n;else notes.push(n);selected=n.id;$('editor-dialog').close();await rebuild();setView('landscape');toast('A thought, planted.');});
listen('capture-form','submit',async e=>{e.preventDefault();const text=$('capture-input').value.trim();if(!text)return;const n=parseNote(text,'Notes/'+crypto.randomUUID()+'.md');n.title=text.split('\n')[0].slice(0,100);await persist([n]);notes=notes.filter(x=>!x.demo);notes.push(n);selected=n.id;$('capture-input').value='';await rebuild();setView('landscape');toast('A thought, planted.');});
listen('discover','click',()=>{const choices=notes.filter(n=>n.id!==selected);if(!choices.length){toast('Add a few more thoughts to discover connections.');return;}const n=choices[Math.floor(Math.random()*choices.length)];select(n.id);toast('An old thought. A new perspective.');});
document.addEventListener('click',run(async e=>{
  const close=e.target.closest('.close-dialog');if(close){close.closest('dialog').close();return;}
  const v=e.target.closest('[data-view]');if(v){setView(v.dataset.view);return;}
  const r=e.target.closest('[data-region]');if(r){if(view!=='landscape')setView('landscape');region=region===Number(r.dataset.region)?null:Number(r.dataset.region);document.querySelectorAll('[data-region]').forEach(b=>b.classList.toggle('active',Number(b.dataset.region)===region));renderOverlay();return;}
  const target=e.target.closest('[data-id],[data-note],[data-related],[data-search]');if(target){const id=target.dataset.id||target.dataset.note||target.dataset.related||target.dataset.search;select(id);if($('search-dialog').open)$('search-dialog').close();return;}
  if(e.target.closest('#preview-close')){selected=null;renderPreview();renderOverlay();}
  if(e.target.closest('#preview-open'))openEditor(selected);
  if(e.target.closest('#preview-star')){const n=notes.find(n=>n.id===selected);const updated={...n,starred:!n.starred};await persist([updated]);notes[notes.indexOf(n)]=updated;renderPreview();renderList();$('star-count').textContent=notes.filter(n=>n.starred).length;toast(updated.starred?'Kept for another day.':'Bookmark removed.');}
  if(e.target.closest('#preview-source')){const url=safeURL(notes.find(n=>n.id===selected)?.url);if(url){if(native)await apiCall('openSource',{url});else window.open(url,'_blank','noopener,noreferrer');}}
}));
document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(!$('search-dialog').open){modal('search-dialog');run(doSearch)();}$('search-input').focus();}if(e.key==='Enter'&&e.target.matches('.note-node'))select(e.target.dataset.id);});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
function zoom(factor){terrain.zoom=Math.max(.15,Math.min(3,terrain.zoom*factor));terrain.resize();$('zoom-level').textContent=Math.round(terrain.zoom*100)+'%';renderOverlay();}
listen('zoom-in','click',()=>zoom(1.2));listen('zoom-out','click',()=>zoom(1/1.2));function fitLandscape(){terrain.yaw=-.12;terrain.pitch=.92;terrain.fit();$('zoom-level').textContent=Math.round(terrain.zoom*100)+'%';renderOverlay();}
listen('reset-view','click',fitLandscape);
for(const [id,flat] of [['terrain-view',false],['flat-view',true]])listen(id,'click',()=>{terrain.flat=flat;terrain.resize();$('orbit-controls').hidden=flat;$('terrain-view').classList.toggle('active',!flat);$('flat-view').classList.toggle('active',flat);renderOverlay();});
for(const [id,yaw,pitch] of [['rotate-left',-.22,0],['rotate-right',.22,0],['tilt-up',0,.12],['tilt-down',0,-.12]])listen(id,'click',()=>{terrain.yaw+=yaw;terrain.pitch=Math.max(.25,Math.min(1.5,terrain.pitch+pitch));terrain.resize();renderOverlay();});
$('map').addEventListener('contextmenu',e=>e.preventDefault());
let drag=null,dragFrame=0;
$('map').addEventListener('pointerdown',e=>{if(e.target.closest('.note-node'))return;drag={x:e.clientX,y:e.clientY,px:terrain.pan.x,py:terrain.pan.y,yaw:terrain.yaw,pitch:terrain.pitch,orbit:!terrain.flat&&e.button!==2};$('map').setPointerCapture(e.pointerId);$('map').classList.add('dragging');});
$('map').addEventListener('pointermove',e=>{if(!drag)return;if(drag.orbit){terrain.yaw=drag.yaw-(e.clientX-drag.x)*.006;terrain.pitch=Math.max(.25,Math.min(1.5,drag.pitch+(e.clientY-drag.y)*.005));}else{terrain.pan.x=drag.px+e.clientX-drag.x;terrain.pan.y=drag.py+e.clientY-drag.y;}if(!dragFrame)dragFrame=requestAnimationFrame(()=>{dragFrame=0;terrain.resize();moveOverlay();});});
for(const name of ['pointerup','pointercancel'])$('map').addEventListener(name,()=>{if(drag)renderOverlay();drag=null;$('map').classList.remove('dragging');});
$('map').addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*.001));},{passive:false});
new ResizeObserver(()=>{terrain.resize();renderOverlay();}).observe($('map'));
async function start(){
  let stored=[];try{if(native)stored=(await apiCall('library')).notes;else {const response=await fetch('/api/library');if(response.ok){const data=await response.json();if(!Array.isArray(data.notes))throw new Error('Invalid server response.');serverMode=true;stored=data.notes;}else if(response.status===404){db=await browserDB();stored=await localNotes();}else throw new Error('Server storage is unavailable.');}}catch(e){toast('Storage could not open. '+String(e.message||e));document.querySelector('.saved-status').lastChild.textContent=' Storage unavailable';}
  if(tauri){const caps=await apiCall('capabilities');$('import-apple-notes').hidden=caps.platform!=='macos';await apiCall('setTheme',{theme});}
  notes=stored.length?stored:demoNotes.map(n=>({...n}));await terrain.init();terrain.setScaling(scaling);if(serverMode){document.querySelector('.local-status').childNodes[1].textContent='Private server · SQLite';document.querySelector('.privacy-note').lastChild.textContent='Notes are stored on your server. Original files stay untouched.';}$('renderer-label').textContent=terrain.mode+' · on this device';selected=isDemo()?notes[0]?.id:null;await rebuild();fitLandscape();
}
run(start)();
