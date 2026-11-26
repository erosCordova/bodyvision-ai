// Approximate anatomical wireframe driven by MediaPipe Pose.
 // Coordinates describe geometry, not measured circumference or a biometric template.
export type MeshPoint={x:number;y:number;z:number;visibility?:number};
export type MeshEdge={start:number;end:number};
export type MeshFace=[number,number,number];
export type MeshRing={start:number;count:number;center:MeshPoint;normal:{x:number;y:number};radius:number;key:string};
export type WireMesh={points:MeshPoint[];edges:MeshEdge[];faces:MeshFace[];rings:MeshRing[]};
export type BodyMask={width:number;height:number;data:Float32Array};
type V={x:number;y:number;z:number};
const add=(a:V,b:V):V=>({x:a.x+b.x,y:a.y+b.y,z:a.z+b.z});
const sub=(a:V,b:V):V=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const mul=(a:V,s:number):V=>({x:a.x*s,y:a.y*s,z:a.z*s});
const dot=(a:V,b:V)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a:V,b:V):V=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const len=(a:V)=>Math.hypot(a.x,a.y,a.z);
const unit=(a:V):V=>len(a)>1e-8?mul(a,1/len(a)):{x:0,y:0,z:0};
const mix=(a:V,b:V,t:number)=>add(mul(a,1-t),mul(b,t));
const clamp=(n:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,n));
const valid=(p:MeshPoint|undefined)=>!!p&&[p.x,p.y,p.z].every(Number.isFinite);
export const poseVisible=(p:MeshPoint|undefined)=>valid(p)&&(p!.visibility??1)>=.5&&p!.x>=0&&p!.x<=1&&p!.y>=0&&p!.y<=1;
export const fullBodyVisible=(p:MeshPoint[])=>[0,11,12,13,14,15,16,23,24,25,26,27,28,31,32].every(i=>poseVisible(p[i]));
// Build matching independent meshes for image space and metric-like world space.
// Use only confidently visible joints; never infer an occluded limb.
export function buildBodyWire(source:MeshPoint[],screen:MeshPoint[],aspect=1,world=false):WireMesh{
 const mesh:WireMesh={points:[],edges:[],faces:[],rings:[]};
 const edgeSet=new Set<string>();
 const edge=(a:number,b:number)=>{if(a===b)return;const k=Math.min(a,b)+":"+Math.max(a,b);if(!edgeSet.has(k)){edgeSet.add(k);mesh.edges.push({start:a,end:b});}};
 const p=(i:number):V|null=>poseVisible(screen[i])&&valid(source[i])?{x:source[i].x*(world?1:aspect),y:source[i].y,z:source[i].z*(world?1:aspect)}:null;
 const l=p(11),r=p(12),lh=p(23),rh=p(24);
 const shoulder=l&&r?len(sub(l,r)):0,hip=lh&&rh?len(sub(lh,rh)):0;
 const span=Math.max(shoulder,hip);
 const addPoint=(v:V)=>{const i=mesh.points.length;mesh.points.push({...v,x:v.x/(world?1:aspect),z:v.z/(world?1:aspect),visibility:1});return i;};
 const rings=(centers:V[],widths:number[],depths:number[],hint:V,n=16,key="part")=>{
   if(centers.length<2)return;
   const ids:number[][]=[];
   for(let k=0;k<centers.length;k++){
     const tangent=unit(sub(centers[Math.min(k+1,centers.length-1)],centers[Math.max(0,k-1)]));
     if(len(tangent)<.1)return;
     let side=unit(sub(hint,mul(tangent,dot(hint,tangent))));
     if(len(side)<.1){const fallback=Math.abs(tangent.x)<.8?{x:1,y:0,z:0}:{x:0,y:0,z:1};side=unit(sub(fallback,mul(tangent,dot(fallback,tangent))));}
     const depth=unit(cross(tangent,side));const ring:number[]=[];
     for(let j=0;j<n;j++){const a=2*Math.PI*j/n;ring.push(addPoint(add(centers[k],add(mul(side,widths[k]*Math.cos(a)),mul(depth,depths[k]*Math.sin(a))))));}
     const norm=unit({x:-tangent.y,y:tangent.x,z:0});
     const center={x:centers[k].x/(world?1:aspect),y:centers[k].y,z:centers[k].z/(world?1:aspect)};
     const radius=Math.max(...ring.map(i=>Math.abs((mesh.points[i].x-center.x)*(world?1:aspect)*norm.x+(mesh.points[i].y-center.y)*norm.y)));
     mesh.rings.push({start:ring[0],count:n,center,normal:{x:norm.x,y:norm.y},radius,key:key+":"+k});
     ids.push(ring);for(let j=0;j<n;j++)edge(ring[j],ring[(j+1)%n]);
     if(k){for(let j=0;j<n;j++){edge(ids[k-1][j],ring[j]);edge(ids[k-1][j],ring[(j+1)%n]);mesh.faces.push([ids[k-1][j],ring[j],ring[(j+1)%n]],[ids[k-1][j],ring[(j+1)%n],ids[k-1][(j+1)%n]]);}}
   }
   for(const k of [0,ids.length-1]){const center=addPoint(centers[k]);for(let j=0;j<n;j++){edge(center,ids[k][j]);mesh.faces.push([center,ids[k][j],ids[k][(j+1)%n]]);}}
 };
 const axis=l&&r?unit(sub(r,l)):lh&&rh?unit(sub(rh,lh)):{x:1,y:0,z:0};
 const limb=(indices:number[],radii:number[],sections:number)=>{
   const anchors=indices.map(p);let centers:V[]=[],widths:number[]=[],depths:number[]=[],start=0;
   const flush=()=>{if(centers.length>1)rings(centers,widths,depths,axis,16,"limb-"+indices[0]+"-"+start);centers=[];widths=[];depths=[];};
   for(let i=0;i<anchors.length-1;i++){
     const a=anchors[i],b=anchors[i+1];if(!a||!b){flush();continue;}const distance=len(sub(b,a));if(distance<1e-5){flush();continue;}
     if(!centers.length)start=i;
     const base=span>1e-5?span:distance*.7;
     for(let j=centers.length?1:0;j<=sections;j++){const t=j/sections;const radius=clamp(base*(radii[i]*(1-t)+radii[i+1]*t)*(1+.23*Math.sin(Math.PI*t)),distance*.025,distance*.48);centers.push(mix(a,b,t));widths.push(radius);depths.push(radius*.82);}
   }
   // One continuous strip through elbow/knee; soften the bend without shifting the endpoints.
   if(centers.length>2){const copy=centers.slice();for(let i=1;i<centers.length-1;i++)centers[i]=add(mul(copy[i],.75),mul(add(copy[i-1],copy[i+1]),.125));}
   flush();
 };
 if(l&&r&&lh&&rh&&span>1e-5){
   const top=mix(l,r,.5),bottom=mix(lh,rh,.5);
   const shape=[[0,shoulder*.53],[.06,shoulder*.55],[.13,shoulder*.54],[.21,shoulder*.51],[.30,shoulder*.48],[.40,shoulder*.45],[.50,(shoulder+hip)*.215],[.60,(shoulder+hip)*.22],[.70,hip*.56],[.80,hip*.62],[.90,hip*.61],[1,hip*.54]] as const;
   rings(shape.map(([t])=>mix(top,bottom,t)),shape.map(([,w])=>w),shape.map(([,w])=>w*.53),axis,24,"torso");
   const le=p(7),re=p(8),nose=p(0);
   if(le&&re&&nose){
     const mid=mix(le,re,.5),up=unit(sub(mid,top)),headW=clamp(len(sub(le,re))*.67,span*.15,span*.34);
     if(len(up)>.1){
       const neckTop=add(mid,mul(up,-headW*1.04));rings([top,mix(top,neckTop,.5),neckTop],[span*.15,span*.12,span*.13],[span*.11,span*.10,span*.11],axis,18,"neck");
       const t=[-1,-.92,-.8,-.65,-.5,-.35,-.2,0,.2,.4,.58,.73,.85,.95,1];const center=add(mid,mul(up,headW*.2));
       rings(t.map(v=>add(center,mul(up,v*headW*1.48))),t.map(v=>headW*Math.max(.05,Math.sqrt(1-v*v))),t.map(v=>headW*.8*Math.max(.05,Math.sqrt(1-v*v))),unit(sub(re,le)),24,"head");
     }
   }
 }
 limb([11,13,15],[.17,.105,.065],9);limb([12,14,16],[.17,.12,.075],5);
 limb([23,25,27],[.23,.12,.065],11);limb([24,26,28],[.24,.15,.09],7);
 limb([15,19],[.085,.045],5);limb([16,20],[.09,.045],3);
 limb([27,31],[.10,.065],5);limb([28,32],[.11,.075],3);
 return mesh;
}

export function sampleMask(mask:BodyMask,x:number,y:number):number{
 if(x<0||x>1||y<0||y>1||!Number.isFinite(x+y))return 0;
 const i=Math.round(x*(mask.width-1)),j=Math.round(y*(mask.height-1));return mask.data[j*mask.width+i]??0;
}
export type RingFit={factor:number;shift:number};
export function fitRingFactors(mesh:WireMesh,mask:BodyMask,aspect:number):Map<string,RingFit>{
 const result=new Map<string,RingFit>();
 for(const r of mesh.rings){
  if(r.radius<.002||Math.hypot(r.normal.x,r.normal.y)<.5||sampleMask(mask,r.center.x,r.center.y)<.55)continue;
  const scan=(sign:number)=>{let distance=0;const max=r.radius*1.65,step=Math.max(.001,r.radius/28);for(let t=step;t<=max;t+=step){const x=r.center.x+sign*t*r.normal.x/aspect,y=r.center.y+sign*t*r.normal.y;if(sampleMask(mask,x,y)<.50)break;distance=t;}return distance;};
  const l=scan(-1),rr=scan(1);if(Math.min(l,rr)<r.radius*.16)continue;
  const factor=clamp((l+rr)/(2*r.radius),.58,1.6);
  const shift=clamp((rr-l)*.5,-r.radius*.32,r.radius*.32);
  result.set(r.key,{factor,shift});
 }
 return result;
}
export function applyRingFit(mesh:WireMesh,fits:Map<string,RingFit>,aspect:number,world:boolean):WireMesh{
 const points=mesh.points.map(p=>({...p}));
 for(const r of mesh.rings){
  const fit=fits.get(r.key);if(!fit)continue;
  // A single view constrains projected width, not true depth. Keep depth conservative.
  const factor=fit.factor,depthFactor=1+(factor-1)*.35;
  for(let i=r.start;i<r.start+r.count;i++){
   const p=points[i];const shift=world?0:fit.shift;
   p.x=r.center.x+(p.x-r.center.x)*factor+shift*r.normal.x/aspect;
   p.y=r.center.y+(p.y-r.center.y)*factor+shift*r.normal.y;
   p.z=r.center.z+(p.z-r.center.z)*depthFactor;
  }
 }
 return {...mesh,points};
}
export function smoothPose(current:MeshPoint[],prior:MeshPoint[]):MeshPoint[]{
 if(current.length!==prior.length)return current.map(p=>({...p}));
 return current.map((p,i)=>{const q=prior[i];if(!valid(p)||!valid(q)||(p.visibility??1)<.5||(q.visibility??1)<.5)return {...p};
  const speed=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z),alpha=clamp(.35+speed*5,.35,.9);
  return {...p,x:q.x+(p.x-q.x)*alpha,y:q.y+(p.y-q.y)*alpha,z:q.z+(p.z-q.z)*alpha};});
}
