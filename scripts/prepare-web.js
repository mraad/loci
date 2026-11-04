import {mkdir,cp,rm,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),destination=resolve(root,'.build/web');
for(const file of ['src/frontend/vendor/transformers.min.js','src/frontend/models/minilm/onnx/model_quantized.onnx'])await stat(resolve(root,file));
await mkdir(resolve(root,'.build'),{recursive:true});await rm(destination,{recursive:true,force:true});
await cp(resolve(root,'src/frontend'),destination,{recursive:true});await cp(resolve(root,'src/shared'),resolve(destination,'shared'),{recursive:true});
console.log('Vanilla JS interface and offline model staged for Rust desktop/server.');
