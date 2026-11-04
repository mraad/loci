import {embeddedModel,contentHash,meanVector} from './embedding-utils.js';
export async function embedNotes(pipe,notes,progress=()=>{}){
  const result=[];
    for(let i=0;i<notes.length;i++){
      const n=notes[i],fingerprint=contentHash(n);
      if(n.embeddingModel===embeddedModel&&n.embeddingHash===fingerprint&&n.embedding?.length){result.push(n);continue;}
      const title=pipe.tokenizer.decode(pipe.tokenizer.encode(n.title,{add_special_tokens:false}).slice(0,32),{skip_special_tokens:true});
      const ids=pipe.tokenizer.encode(n.body||n.title,{add_special_tokens:false}),chunks=[];
      for(let start=0;start<ids.length;start+=180)chunks.push(title+'\n'+pipe.tokenizer.decode(ids.slice(start,start+200),{skip_special_tokens:true}));
      const vectors=[];for(let j=0;j<chunks.length;j+=8){const output=await pipe(chunks.slice(j,j+8),{pooling:'mean',normalize:true,truncation:true,max_length:256});vectors.push(...output.tolist());}
      result.push({...n,embedding:meanVector(vectors),embeddingModel:embeddedModel,embeddingHash:fingerprint});
      progress(i+1,notes.length);
    }
  return result;
}
