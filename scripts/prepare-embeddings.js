import {mkdir,copyFile,writeFile,stat,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const vendor=resolve(root,'src/frontend/vendor'),model=resolve(root,'src/frontend/models/minilm');
await mkdir(vendor,{recursive:true});await mkdir(resolve(model,'onnx'),{recursive:true});
await copyFile(resolve(root,'node_modules/@huggingface/transformers/dist/transformers.min.js'),resolve(vendor,'transformers.min.js'));
for(const suffix of ['.asyncify',''])for(const ext of ['.mjs','.wasm']){const name='ort-wasm-simd-threaded'+suffix+ext;await copyFile(resolve(root,'node_modules/onnxruntime-web/dist',name),resolve(vendor,name));}
await copyFile(resolve(root,'node_modules/@huggingface/transformers/LICENSE'),resolve(vendor,'TRANSFORMERS-LICENSE'));
const license=await fetch('https://raw.githubusercontent.com/microsoft/onnxruntime/main/LICENSE');if(!license.ok)throw new Error('ONNX license download failed');await writeFile(resolve(vendor,'ONNX-LICENSE'),await license.text());
const revision='751bff3';
// Files are bundled locally; the running application never contacts Hugging Face.
for(const name of ['config.json','tokenizer.json','tokenizer_config.json','special_tokens_map.json','onnx/model_quantized.onnx']){
 const target=resolve(model,name);try{if((await stat(target)).size>0)continue;}catch{}
 const response=await fetch('https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/'+revision+'/'+name);if(!response.ok)throw new Error('Model download failed '+name+': '+response.status);
 const bytes=new Uint8Array(await response.arrayBuffer());await writeFile(target,bytes);console.log(name+' '+bytes.length+' bytes');
}
await copyFile(resolve(vendor,'TRANSFORMERS-LICENSE'),resolve(model,'LICENSE'));
for(const name of ['transformers.web.min.js','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm'])await rm(resolve(vendor,name),{force:true});
console.log('Local embedding assets ready.');
