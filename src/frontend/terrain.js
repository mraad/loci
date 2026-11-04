const elevationUnit=30;
const contourBase=.045,baseStep=.126;
// Fill bands grade from low ground to peak; contour lines grade from a pale base ring to a warm summit ring.
const terrainColors={
  dark:{background:[.027,.058,.105],ramp:[[.07,.12,.22],[.16,.22,.38],[.32,.30,.48],[.52,.38,.54],[.74,.52,.58]],contour:[[.78,.86,.96],[.94,.62,.44]],link:[.48,.73,.85],activeLink:[.77,.86,1]},
  light:{background:[.937,.953,.980],ramp:[[.86,.89,.94],[.72,.76,.88],[.66,.62,.80],[.70,.55,.66],[.76,.50,.54]],contour:[[.30,.40,.58],[.74,.38,.16]],link:[.14,.36,.53],activeLink:[.20,.25,.55]}
};
function ramp(stops,t){const s=Math.max(0,Math.min(1,t))*(stops.length-1),i=Math.min(Math.floor(s),stops.length-2),a=s-i;return stops[i].map((v,k)=>v+(stops[i+1][k]-v)*a);}
export function normalizeScaling(value){
  const axis=(key,min,max=3,fallback=1)=>Number.isFinite(value?.[key])?Math.round(Math.max(min,Math.min(max,value[key]))*20)/20:fallback;
  // Hill base is independent of the XYZ toggle: it widens every hill's footprint on the ground.
  return {enabled:value?.enabled===true,x:axis('x',.5),y:axis('y',.5),z:axis('z',.25),base:axis('base',.5,4,2.5)};
}
export class Terrain {
  constructor(canvas,onChange,theme='dark'){this.axisScale=[1,1,1];this.base=2.5;this.theme=theme==='light'?'light':'dark';this.canvas=canvas;this.onChange=onChange;this.regions=[];this.zoom=1;this.pan={x:0,y:0};this.flat=false;this.yaw=-.12;this.pitch=.92;this.mode='Canvas';this.mesh=new Float32Array();this.lines=new Float32Array();this.connections=new Float32Array();}
  setScaling(value){
    const settings=normalizeScaling(value);this.axisScale=settings.enabled?[settings.x,settings.y,settings.z]:[1,1,1];
    const rebuild=settings.base!==this.base;this.base=settings.base;
    if(rebuild)this.build();else this.draw();
    this.onChange?.();return settings;
  }
  // A region's share of the largest region, 0–1: height is proportional to it.
  weight(r){const top=this.maxCount||Math.max(1,...this.regions.map(x=>x.count||1));return (r.count||1)/top;}
  // Footprint uses a softer curve, and its floor .75 keeps every note (placed within 1.35×spread) on its hill: edge = 1.8×.75 = 1.35.
  footprint(r,w=this.weight(r)){return (r.spread||150+Math.sqrt(r.count)*17)*this.base*(.75+.25*Math.pow(w,.6));}
  fit(){
    if(!this.regions.length||!this.width)return;
    const corners=this.regions.flatMap(r=>{const radius=this.footprint(r)*1.8+20;return [-1,1].flatMap(x=>[-1,1].flatMap(y=>[0,this.maxHeight||1].map(h=>this.project(r.center[0]+x*radius,r.center[1]+y*radius,h))));});
    const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),left=Math.min(...xs),right=Math.max(...xs),top=Math.min(...ys),bottom=Math.max(...ys),base=this.scale/this.zoom;
    this.zoom=Math.max(.15,Math.min(3,(this.width-100)/Math.max(300,right-left)/base,(this.height-100)/Math.max(240,bottom-top)/base));
    const scale=base*this.zoom;this.pan={x:(600-(left+right)/2)*scale,y:(450-(top+bottom)/2)*scale};
    this.resize();this.onChange?.();
  }
  depthRange(){const [x,y,z]=this.axisScale;return Math.max(1200,Math.hypot(748*x,630*y)+(this.maxHeight||0)*elevationUnit*z+2);}
  get colors(){return terrainColors[this.theme];}
  setTheme(theme){
    if(!['light','dark'].includes(theme)||theme===this.theme)return;
    const state=this.connectionState;this.theme=theme;this.connectionState=null;this.build();
    if(state)this.setConnections(state.points,state.edges,state.selected,state.region);
    this.onChange?.();
  }
  async init(){
    try{
      if(!navigator.gpu)throw new Error('WebGPU unavailable');
      const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('No adapter');
      const device=await adapter.requestDevice();this.device=device;
      const context=this.canvas.getContext('webgpu');if(!context)throw new Error('No WebGPU canvas');
      const format=navigator.gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});this.context=context;
      const module=device.createShaderModule({code:`struct Params { transform:vec4f, camera:vec4f, axes:vec4f }; @group(0) @binding(0) var<uniform> p:Params;
        struct Out { @builtin(position) pos:vec4f, @location(0) color:vec4f };
        @vertex fn vs(@location(0) pos:vec3f,@location(1) color:vec4f)->Out {var o:Out;let d=(pos.xy-vec2f(600,450))*p.axes.xy;let elevation=pos.z*p.axes.z;let r=vec2f(d.x*p.camera.x-d.y*p.camera.y,d.x*p.camera.y+d.y*p.camera.x);let screen=vec2f(600+r.x,515+r.y*p.camera.z-elevation*${elevationUnit}*p.camera.w);let depth=.5-(r.y*p.camera.w+elevation*${elevationUnit}*p.camera.z)/(2*p.axes.w);o.pos=vec4f(screen*p.transform.xy+p.transform.zw,depth,1);o.color=color;return o;}
        @fragment fn fs(o:Out)->@location(0) vec4f {return o.color;}`});
      const descriptor=topology=>({layout:'auto',vertex:{module,entryPoint:'vs',buffers:[{arrayStride:28,attributes:[{shaderLocation:0,offset:0,format:'float32x3'},{shaderLocation:1,offset:12,format:'float32x4'}]}]},fragment:{module,entryPoint:'fs',targets:[{format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology},depthStencil:{format:'depth24plus',depthWriteEnabled:topology==='triangle-list',depthCompare:'less-equal'}});
      this.pipelines=[device.createRenderPipeline(descriptor('triangle-list')),device.createRenderPipeline(descriptor('line-list'))];
      this.uniform=device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      this.bindings=this.pipelines.map(p=>device.createBindGroup({layout:p.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniform}}]}));this.mode='WebGPU';
      device.lost.then(()=>this.fallback());
    }catch{this.device=null;this.context=null;this.resetCanvas();try{this.initGL();}catch{this.fallback();}}
    this.resize();return this.mode;
  }
  resetCanvas(){const old=this.canvas;this.canvas=old.cloneNode();old.replaceWith(this.canvas);}
  initGL(){
    const gl=this.canvas.getContext('webgl',{alpha:false,antialias:true});
    if(!gl){this.context=this.canvas.getContext('2d');this.mode='Canvas';return;}
    this.gl=gl;const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,`attribute vec3 position; attribute vec4 color; uniform vec4 transform; uniform vec4 camera; uniform vec4 axes; varying vec4 vColor; void main(){vec2 d=(position.xy-vec2(600.,450.))*axes.xy;float elevation=position.z*axes.z;vec2 r=vec2(d.x*camera.x-d.y*camera.y,d.x*camera.y+d.y*camera.x);vec2 screen=vec2(600.+r.x,515.+r.y*camera.z-elevation*${elevationUnit}.*camera.w);float depth=-(r.y*camera.w+elevation*${elevationUnit}.*camera.z)/axes.w;gl_Position=vec4(screen*transform.xy+transform.zw,depth,1.);vColor=color;}`));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,'precision mediump float; varying vec4 vColor; void main(){gl_FragColor=vColor;}'));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error('Unable to link terrain shader');gl.useProgram(p);this.program=p;this.uniformGL=gl.getUniformLocation(p,'transform');this.cameraGL=gl.getUniformLocation(p,'camera');this.axesGL=gl.getUniformLocation(p,'axes');gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);this.positionGL=gl.getAttribLocation(p,'position');this.colorGL=gl.getAttribLocation(p,'color');this.buffersGL=[gl.createBuffer(),gl.createBuffer()];gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);this.mode='WebGL';
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.fallback();});
  }
  fallback(){this.resetCanvas();this.gl=null;this.device=null;this.context=this.canvas.getContext('2d');this.mode='Canvas';this.resize();this.onChange?.();}
  resize(){const r=this.canvas.getBoundingClientRect();this.width=r.width||1;this.height=r.height||1;this.dpr=Math.min(devicePixelRatio||1,2);const w=Math.round(this.width*this.dpr),h=Math.round(this.height*this.dpr),changed=this.canvas.width!==w||this.canvas.height!==h;if(changed){this.canvas.width=w;this.canvas.height=h;}this.scale=Math.min(this.width/1150,this.height/810)*this.zoom;this.ox=(this.width-1200*this.scale)/2+this.pan.x;this.oy=(this.height-900*this.scale)/2+this.pan.y;if(this.device&&(changed||!this.depthTexture)){this.depthTexture?.destroy();this.depthTexture=this.device.createTexture({size:[this.canvas.width,this.canvas.height],format:'depth24plus',usage:GPUTextureUsage.RENDER_ATTACHMENT});}this.draw();}
  field(x,y){
    let height=.025+.008*Math.sin(x*.008)*Math.cos(y*.01)+.005*Math.cos((x+y)*.006),red=0,green=0,blue=0,sum=0;
    this.regions.forEach(r=>{
      const [cx,cy]=r.center,w=this.weight(r),spread=this.footprint(r,w),dx=(x-cx)/spread,dy=(y-cy)/(spread*.95),distance=dx*dx+dy*dy;
      if(distance>=3.24)return;
      // A smooth, broad shoulder meets gently rolling ground with no sharp rim.
      const t=Math.sqrt(distance)/1.8,shoulder=1-t*t*t*(t*(t*6-15)+10),ripple=1+.025*Math.sin(x*.017+y*.013)+.015*Math.cos(y*.043-x*.014);
      // Height grows linearly with the hill's share of ideas; the .5 floor keeps a one-note hill visible.
      const v=shoulder*(.5+2.5*w)*ripple,color=r.rgb||=r.color.match(/\w\w/g).map(c=>parseInt(c,16)/255);
      height+=v;sum+=v;red+=color[0]*v;green+=color[1]*v;blue+=color[2]*v;
    });
    return {h:height,cover:sum,r:red/(sum||1),g:green/(sum||1),b:blue/(sum||1)};
  }
  camera(){return this.flat?[1,0,1,0]:[Math.cos(this.yaw),Math.sin(this.yaw),Math.sin(this.pitch),Math.cos(this.pitch)];}
  project(x,y,h=this.field(x,y).h){const [c,s,p,q]=this.camera(),dx=(x-600)*this.axisScale[0],dy=(y-450)*this.axisScale[1];return [600+dx*c-dy*s,515+(dx*s+dy*c)*p-h*this.axisScale[2]*elevationUnit*q];}
  point(x,y){const p=this.project(x,y,this.surfaceHeight(x,y)+.006);return [p[0]*this.scale+this.ox,p[1]*this.scale+this.oy];}
  surfaceHeight(x,y){
    if(!this.heightGrid)return this.field(x,y).h;
    const step=this.gridStep||12,u=(x+140)/step,v=(y+180)/step,grid=this.heightGrid;
    if(u<0||v<0||u>grid[0].length-1||v>grid.length-1)return this.field(x,y).h;
    const i=Math.min(Math.floor(u),grid[0].length-2),j=Math.min(Math.floor(v),grid.length-2);
    const a=u-i,b=v-j,h00=grid[j][i].h,h10=grid[j][i+1].h,h01=grid[j+1][i].h,h11=grid[j+1][i+1].h;
    return b<=a?h00*(1-a)+h10*(a-b)+h11*b:h00*(1-b)+h11*a+h01*(b-a);
  }
  surfacePath(a,b){
    const step=this.gridStep||12,steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/6)),times=new Set(Array.from({length:steps+1},(_,i)=>i/steps));
    // Include every mesh-edge crossing, so each lifted segment follows one terrain triangle exactly.
    for(const [start,end] of [[a.x+140,b.x+140],[a.y+180,b.y+180],[a.x-a.y-40,b.x-b.y-40]]){
      if(start===end)continue;for(let k=Math.floor(Math.min(start,end)/step)+1;k*step<Math.max(start,end);k++){const t=(k*step-start)/(end-start);if(t>0&&t<1)times.add(t);}
    }
    return [...times].sort((x,y)=>x-y).map(t=>{const x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;return [x,y,this.surfaceHeight(x,y)+.006];});
  }
  setConnections(points,edges,selected=null,region=null){
    const old=this.connectionState;if(old?.points===points&&old.edges===edges&&old.selected===selected&&old.region===region)return;
    const lookup=new Map(points.map(p=>[p.id,p]));
    if(!old||old.points!==points||old.edges!==edges)this.connectionPaths=edges.map(e=>{const a=lookup.get(e.a),b=lookup.get(e.b);return a&&b?this.surfacePath(a,b):[];});
    const vertices=[];edges.forEach((e,i)=>{const active=e.a===selected||e.b===selected,a=lookup.get(e.a),b=lookup.get(e.b),dim=region!==null&&a?.region!==region&&b?.region!==region;
      const color=[...(active?this.colors.activeLink:this.colors.link),dim?.03:active?.95:selected?.08:e.kind==='link'?.42:.22],path=this.connectionPaths[i];
      for(let j=1;j<path.length;j++)vertices.push(...path[j-1],...color,...path[j],...color);
    });
    this.connections=new Float32Array(vertices);this.connectionState={points,edges,selected,region};
    if(this.device){this.connectionGPU?.destroy();this.connectionGPU=this.device.createBuffer({size:Math.max(28,this.connections.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(this.connectionGPU,0,this.connections);}
    if(this.gl){this.connectionGL ||= this.gl.createBuffer();this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.connectionGL);this.gl.bufferData(this.gl.ARRAY_BUFFER,this.connections,this.gl.STATIC_DRAW);}
    this.draw();
  }
  setRegions(regions){this.regions=regions;this.maxCount=Math.max(1,...regions.map(r=>r.count||1));this.connectionState=null;this.build();}
  build(){
    const mesh=[],lines=[],step=8,nx=186,ny=156,grid=[];this.gridStep=step;
    for(let j=0;j<=ny;j++){const row=[];for(let i=0;i<=nx;i++){const x=i*step-140,y=j*step-180,f=this.field(x,y);row.push({x,y,...f,p:[x,y,f.h]});}grid.push(row);}
    this.heightGrid=grid;this.maxHeight=Math.max(...grid.map(row=>Math.max(...row.map(p=>p.h))));
    // Colour bands and rings span the actual summit, so the top is rose whatever the height scale.
    // Ring spacing widens with tall terrain so a summit never carries more than ~12 rings.
    const contourStep=Math.max(baseStep,(this.maxHeight-contourBase)/12),count=Math.max(1,Math.ceil((this.maxHeight-contourBase)/contourStep)),bands=Array.from({length:count+1},(_,n)=>ramp(this.colors.ramp,n/count));
    // One spare ring: with step = range/12 the accumulated level can land a float below the summit.
    const rings=Array.from({length:count+1},(_,n)=>[...ramp(this.colors.contour,n/count),n?.62:.9]);
    for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
      const sx=(grid[j][Math.min(nx,i+1)].h-grid[j][Math.max(0,i-1)].h)*elevationUnit/(step*(i>0&&i<nx?2:1)),sy=(grid[Math.min(ny,j+1)][i].h-grid[Math.max(0,j-1)][i].h)*elevationUnit/(step*(j>0&&j<ny?2:1));
      const light=(.58+.42*Math.max(0,(.4*sx+.5*sy+.76)/Math.hypot(sx,sy,1)))/.8992,shade=this.theme==='light'?(1+light)/2:light;
      const v=grid[j][i],[r,g,b]=bands[Math.min(count,Math.floor((v.h-contourBase)/contourStep)+1)],tint=Math.min(v.cover,1)*.05;
      v.color=[Math.min(1,(r+v.r*tint)*shade),Math.min(1,(g+v.g*tint)*shade),Math.min(1,(b+v.b*tint)*shade),1];
    }
    const vertex=(array,p,color)=>array.push(...p,...color);
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      const cell=[grid[j][i],grid[j][i+1],grid[j+1][i+1],grid[j+1][i]];
      [0,1,2,0,2,3].forEach(k=>vertex(mesh,cell[k].p,cell[k].color));
      // Double-spaced contours follow the same triangles as the terrain and connections.
      const top=Math.max(cell[0].h,cell[1].h,cell[2].h,cell[3].h);
      for(let n=0,level=contourBase;level<top;n++,level+=contourStep){
        const color=rings[n];
        for(const triangle of [[0,1,2],[0,2,3]]){
          const intersections=[];
          for(let e=0;e<3;e++){const a=cell[triangle[e]],b=cell[triangle[(e+1)%3]];if((a.h>=level)===(b.h>=level))continue;const t=(level-a.h)/(b.h-a.h);intersections.push([a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t,level+.004]);}
          if(intersections.length===2){vertex(lines,intersections[0],color);vertex(lines,intersections[1],color);}
        }
      }
    }
    this.mesh=new Float32Array(mesh);this.lines=new Float32Array(lines);
    if(this.device){this.buffersGPU?.forEach(b=>b.destroy());this.buffersGPU=[this.mesh,this.lines].map(data=>{const b=this.device.createBuffer({size:Math.max(28,data.byteLength),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});this.device.queue.writeBuffer(b,0,data);return b;});}
    if(this.gl)[this.mesh,this.lines].forEach((data,i)=>{this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.buffersGL[i]);this.gl.bufferData(this.gl.ARRAY_BUFFER,data,this.gl.STATIC_DRAW);});
    this.resize();
  }
  draw(){
    if(!this.width)return;const transform=new Float32Array([2*this.scale/this.width,-2*this.scale/this.height,2*this.ox/this.width-1,1-2*this.oy/this.height,...this.camera(),...this.axisScale,this.depthRange()]);
    if(this.device){if(!this.buffersGPU)return;this.device.queue.writeBuffer(this.uniform,0,transform);const encoder=this.device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:this.colors.background[0],g:this.colors.background[1],b:this.colors.background[2],a:1},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:this.depthTexture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'store'}});this.pipelines.forEach((p,i)=>{pass.setPipeline(p);pass.setBindGroup(0,this.bindings[i]);pass.setVertexBuffer(0,this.buffersGPU[i]);pass.draw((i?this.lines:this.mesh).length/7);});if(this.connectionGPU&&this.connections.length){pass.setPipeline(this.pipelines[1]);pass.setBindGroup(0,this.bindings[1]);pass.setVertexBuffer(0,this.connectionGPU);pass.draw(this.connections.length/7);}pass.end();this.device.queue.submit([encoder.finish()]);}
    else if(this.gl){const gl=this.gl;gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(...this.colors.background,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.uniform4fv(this.uniformGL,transform.subarray(0,4));gl.uniform4fv(this.cameraGL,transform.subarray(4,8));gl.uniform4fv(this.axesGL,transform.subarray(8,12));[this.mesh,this.lines,this.connections].forEach((data,i)=>{if(!data.length)return;gl.bindBuffer(gl.ARRAY_BUFFER,i===2?this.connectionGL:this.buffersGL[i]);gl.enableVertexAttribArray(this.positionGL);gl.vertexAttribPointer(this.positionGL,3,gl.FLOAT,false,28,0);gl.enableVertexAttribArray(this.colorGL);gl.vertexAttribPointer(this.colorGL,4,gl.FLOAT,false,28,12);gl.drawArrays(i?gl.LINES:gl.TRIANGLES,0,data.length/7);});}
    else if(this.context){const ctx=this.context;ctx.setTransform(this.dpr,0,0,this.dpr,0,0);ctx.fillStyle=`rgb(${this.colors.background.map(c=>c*255).join(',')})`;ctx.fillRect(0,0,this.width,this.height);ctx.translate(this.ox,this.oy);ctx.scale(this.scale,this.scale);
      for(let k=0;k<this.mesh.length;k+=21){const a=this.mesh;ctx.fillStyle=`rgb(${a[k+3]*255},${a[k+4]*255},${a[k+5]*255})`;ctx.beginPath();[0,7,14].forEach((offset,i)=>{const p=this.project(a[k+offset],a[k+offset+1],a[k+offset+2]);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.fill();}
      for(let k=0;k<this.lines.length;k+=14){const a=this.lines;ctx.strokeStyle=`rgba(${a[k+3]*255},${a[k+4]*255},${a[k+5]*255},${a[k+6]})`;ctx.lineWidth=1.1/this.scale;ctx.beginPath();ctx.moveTo(...this.project(a[k],a[k+1],a[k+2]));ctx.lineTo(...this.project(a[k+7],a[k+8],a[k+9]));ctx.stroke();}
      for(let k=0;k<this.connections.length;k+=14){const a=this.connections;ctx.strokeStyle=`rgba(${a[k+3]*255},${a[k+4]*255},${a[k+5]*255},${a[k+6]})`;ctx.lineWidth=1.25/this.scale;ctx.beginPath();ctx.moveTo(...this.project(a[k],a[k+1],a[k+2]));ctx.lineTo(...this.project(a[k+7],a[k+8],a[k+9]));ctx.stroke();}}
  }
}
