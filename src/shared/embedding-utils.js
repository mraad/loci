import {hash} from './knowledge.js';
export const embeddedModel='all-MiniLM-L6-v2:q8:v1';
export const contentHash=n=>hash(n.title+'\n'+n.body);
export function meanVector(vectors){const size=vectors[0]?.length;if(!size||vectors.some(v=>v.length!==size||!v.every(Number.isFinite)))throw new Error('Invalid embedding vectors.');const mean=Array(size).fill(0);for(const v of vectors)for(let i=0;i<size;i++)mean[i]+=v[i]/vectors.length;const norm=Math.hypot(...mean)||1;return mean.map(x=>x/norm);}
