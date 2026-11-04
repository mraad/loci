import {pipeline,env,AutoTokenizer} from './vendor/transformers.min.js';
import {embedNotes} from '../shared/embedded-index.js';
env.allowRemoteModels=false;env.allowLocalModels=true;env.localModelPath=new URL('./models/',import.meta.url).pathname;env.useBrowserCache=false;env.useFS=false;env.useFSCache=false;
env.backends.onnx.wasm.numThreads=1;env.backends.onnx.wasm.proxy=false;
let extractor,device='wasm';
async function load(forceCPU=false){
  if(extractor)return extractor;
  device=!forceCPU&&navigator.gpu?'webgpu':'wasm';
  const suffix=device==='webgpu'?'.asyncify':'';
  env.backends.onnx.wasm.wasmPaths={wasm:new URL('./vendor/ort-wasm-simd-threaded'+suffix+'.wasm',import.meta.url).href,mjs:new URL('./vendor/ort-wasm-simd-threaded'+suffix+'.mjs',import.meta.url).href};
  extractor=await pipeline('feature-extraction',new URL('./models/minilm/',import.meta.url).pathname,{device,dtype:'q8',local_files_only:true});
  extractor.tokenizer ||= await AutoTokenizer.from_pretrained(new URL('./models/minilm/',import.meta.url).pathname,{local_files_only:true});
  return extractor;
}
self.onmessage=async({data})=>{
  try{
    const pipe=await load(data.device==='wasm'),result=await embedNotes(pipe,data.notes,(done,total)=>postMessage({type:'progress',done,total,device}));
    postMessage({type:'complete',notes:result,device});
  }catch(e){postMessage({type:'error',message:String(e.message||e),details:e.stack,retryCPU:device==='webgpu'});}
};
