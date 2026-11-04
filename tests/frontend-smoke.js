const base=new URL(location.pathname.includes('/tests/')?'../src/frontend/':'./',location.href);
const {Terrain}=await import(new URL('terrain.js',base));
const {parseNote,landscape}=await import(new URL('../shared/knowledge.js',base));
const status=document.getElementById('status');
try{
 const t=new Terrain(document.getElementById('terrain'));await t.init();t.setRegions(landscape([parseNote('Garden trees roots #nature','a.md'),parseNote('Computer rendering shaders #technology','b.md')]).regions);
 const glCanvas=document.createElement('canvas');document.body.append(glCanvas);const glTerrain=new Terrain(glCanvas);glTerrain.initGL();glTerrain.setRegions(t.regions);
 const cpuCanvas=document.createElement('canvas');document.body.append(cpuCanvas);const cpuTerrain=new Terrain(cpuCanvas);cpuTerrain.context=cpuCanvas.getContext('2d');cpuTerrain.setRegions(t.regions);
 const worker=new Worker(new URL('semantic-worker.js',base),{type:'module'});
 worker.onmessage=({data})=>{if(data.type==='complete'){const v=data.notes.map(n=>n.embedding),dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),related=dot(v[0],v[1]),unrelated=dot(v[0],v[2]);if(related<=unrelated)throw new Error('Similarity ordering failed');const result={ok:true,terrain:t.mode,fallback:glTerrain.mode,canvas:cpuTerrain.mode,inference:data.device,dimensions:v[0].length,related,unrelated};status.textContent=JSON.stringify(result);worker.terminate();}if(data.type==='error'){status.textContent='FAIL: '+data.message+' '+(data.details||'');worker.terminate();}};
 worker.onerror=e=>{status.textContent='FAIL: '+e.message;};worker.postMessage({device:new URLSearchParams(location.search).get('device')==='wasm'?'wasm':'auto',notes:[parseNote('car travel','a.md'),parseNote('automobile journey','b.md'),parseNote('cooking soup','c.md')]});
}catch(e){status.textContent='FAIL: '+e.message;}
