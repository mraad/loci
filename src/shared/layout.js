export function denseCosine(a,b){if(!a||!b||a.length!==b.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return dot/Math.sqrt(aa*bb||1);}
export function positionNotes(points,pairs){
  if(points.length<2)return;
  const forces=points.map(()=>[0,0,0]);
  // Neighbor attraction and far-pair separation preserve both local and broad relationships.
  for(let iteration=0;iteration<100;iteration++){
    forces.forEach(f=>f.fill(0));
    for(const {i,j,score} of pairs){const a=points[i],b=points[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||.01,target=70+720*Math.pow(1-Math.max(0,Math.min(1,score)),1.7),weight=.15+score*3,f=(d-target)/d*weight;
      forces[i][0]+=dx*f;forces[i][1]+=dy*f;forces[j][0]-=dx*f;forces[j][1]-=dy*f;forces[i][2]+=weight;forces[j][2]+=weight;
    }
    points.forEach((p,i)=>{const f=forces[i];p.x+=Math.max(-18,Math.min(18,f[0]/(f[2]||1)*.65));p.y+=Math.max(-18,Math.min(18,f[1]/(f[2]||1)*.65));});
  }
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys),scale=Math.min(970/(maxX-minX||1),570/(maxY-minY||1),1.3);
  points.forEach(p=>{p.x=600+(p.x-(minX+maxX)/2)*scale;p.y=510+(p.y-(minY+maxY)/2)*scale;});
}

export function positionRegions(points,regions,pairs){
  const members=regions.map(r=>points.filter(p=>p.region===r.id)),offsets=new Map();
  const mountains=regions.map((r,i)=>{
    const group=members[i],cx=group.reduce((s,p)=>s+p.x,0)/group.length,cy=group.reduce((s,p)=>s+p.y,0)/group.length;
    const radius=Math.max(...group.map(p=>Math.hypot(p.x-cx,p.y-cy))),shrink=Math.min(1,(55+Math.sqrt(group.length)*4)/(radius||1));
    for(const p of group)offsets.set(p.id,[(p.x-cx)*shrink*1.45,(p.y-cy)*shrink*1.45]);
    r.spread=Math.max(45,radius*shrink*1.2);
    const limit=r.spread*1.35,spacing=1.65*limit/Math.sqrt(group.length);
    for(let iteration=0;group.length>1&&iteration<100;iteration++){
      let overlap=0;
      for(let a=0;a<group.length;a++)for(let b=a+1;b<group.length;b++){
        const first=offsets.get(group[a].id),second=offsets.get(group[b].id),dx=second[0]-first[0],dy=second[1]-first[1],d=Math.hypot(dx,dy),gap=spacing-d;
        if(gap<=0)continue;overlap=Math.max(overlap,gap);
        const angle=(a*31+b)*2.4,ux=d?dx/d:Math.cos(angle),uy=d?dy/d:Math.sin(angle);
        first[0]-=ux*gap/2;first[1]-=uy*gap/2;second[0]+=ux*gap/2;second[1]+=uy*gap/2;
      }
      for(const p of group){const offset=offsets.get(p.id),distance=Math.hypot(...offset);if(distance>limit){offset[0]*=limit/distance;offset[1]*=limit/distance;}}
      if(overlap<.01)break;
    }
    return {x:cx,y:cy};
  });
  const scores=new Map();
  for(const {i,j,score} of pairs){let a=points[i].region,b=points[j].region;if(a===b)continue;if(a>b)[a,b]=[b,a];const key=a+':'+b,entry=scores.get(key)||{i:a,j:b,score:0,count:0};entry.score+=score;entry.count++;scores.set(key,entry);}
  positionNotes(mountains,[...scores.values()].map(p=>({...p,score:p.score/p.count})));
  // Preserve semantic placement while keeping each mountain's finite footprint separate.
  for(let iteration=0;iteration<300;iteration++){
    let overlap=0;
    for(let i=0;i<mountains.length;i++)for(let j=i+1;j<mountains.length;j++){
      const a=mountains[i],b=mountains[j],dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy),gap=1.8*(regions[i].spread+regions[j].spread)+90-d;
      if(gap<=0)continue;overlap=Math.max(overlap,gap);
      const angle=(i*31+j)*2.4,ux=d?dx/d:Math.cos(angle),uy=d?dy/d:Math.sin(angle);
      a.x-=ux*gap/2;a.y-=uy*gap/2;b.x+=ux*gap/2;b.y+=uy*gap/2;
    }
    if(overlap<.01)break;
  }
  const minX=Math.min(...mountains.map((p,i)=>p.x-regions[i].spread*1.8)),maxX=Math.max(...mountains.map((p,i)=>p.x+regions[i].spread*1.8));
  const minY=Math.min(...mountains.map((p,i)=>p.y-regions[i].spread*1.8)),maxY=Math.max(...mountains.map((p,i)=>p.y+regions[i].spread*1.8));
  const scale=Math.min(1280/(maxX-minX||1),760/(maxY-minY||1),1.4);
  regions.forEach((r,i)=>{r.center=[600+(mountains[i].x-(minX+maxX)/2)*scale,450+(mountains[i].y-(minY+maxY)/2)*scale];r.spread*=scale;for(const p of members[i]){const offset=offsets.get(p.id);p.x=r.center[0]+offset[0]*scale;p.y=r.center[1]+offset[1]*scale;}});
}
