// Approximate anatomical wireframe driven by MediaPipe Pose.
 // Coordinates describe geometry, not measured circumference or a biometric template.
export type MeshPoint={x:number;y:number;z:number;visibility?:number};
export type MeshEdge={start:number;end:number};
export type WireMesh={points:MeshPoint[];edges:MeshEdge[]};
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
 const mesh:WireMesh={points:[],edges:[]};
 const edgeSet=new Set<string>();
 const edge=(a:number,b:number)=>{if(a===b)return;const k=Math.min(a,b)+":"+Math.max(a,b);if(!edgeSet.has(k)){edgeSet.add(k);mesh.edges.push({start:a,end:b});}};
 const p=(i:number):V|null=>poseVisible(screen[i])&&valid(source[i])?{x:source[i].x*(world?1:aspect),y:source[i].y,z:source[i].z*(world?1:aspect)}:null;
 const l=p(11),r=p(12),lh=p(23),rh=p(24);
 const shoulder=l&&r?len(sub(l,r)):0,hip=lh&&rh?len(sub(lh,rh)):0;
 const span=Math.max(shoulder,hip);
 const addPoint=(v:V)=>{const i=mesh.points.length;mesh.points.push({...v,x:v.x/(world?1:aspect),z:v.z/(world?1:aspect),visibility:1});return i;};
 const rings=(centers:V[],widths:number[],depths:number[],hint:V,n=12)=>{
   if(centers.length<2)return;
   const ids:number[][]=[];
   for(let k=0;k<centers.length;k++){
     const tangent=unit(sub(centers[Math.min(k+1,centers.length-1)],centers[Math.max(0,k-1)]));
     if(len(tangent)<.1)return;
     let side=unit(sub(hint,mul(tangent,dot(hint,tangent))));
     if(len(side)<.1){const fallback=Math.abs(tangent.x)<.8?{x:1,y:0,z:0}:{x:0,y:0,z:1};side=unit(sub(fallback,mul(tangent,dot(fallback,tangent))));}
     const depth=unit(cross(tangent,side));const ring:number[]=[];
     for(let j=0;j<n;j++){const a=2*Math.PI*j/n;ring.push(addPoint(add(centers[k],add(mul(side,widths[k]*Math.cos(a)),mul(depth,depths[k]*Math.sin(a))))));}
     ids.push(ring);for(let j=0;j<n;j++)edge(ring[j],ring[(j+1)%n]);
     if(k){for(let j=0;j<n;j++){edge(ids[k-1][j],ring[j]);edge(ids[k-1][j],ring[(j+1)%n]);}}
   }
   for(const k of [0,ids.length-1]){const center=addPoint(centers[k]);for(const v of ids[k])edge(center,v);}
 };
 const axis=l&&r?unit(sub(r,l)):lh&&rh?unit(sub(rh,lh)):{x:1,y:0,z:0};
 const limb=(indices:number[],radii:number[],sections:number)=>{
   const anchors=indices.map(p);
   for(let i=0;i<anchors.length-1;i++){
     const a=anchors[i],b=anchors[i+1];if(!a||!b)continue;const distance=len(sub(b,a));if(distance<1e-5)continue;
     const base=span>1e-5?span:distance*.7;
     const centers:V[]=[],widths:number[]=[],depths:number[]=[];
     for(let j=0;j<=sections;j++){const t=j/sections;const radius=clamp(base*(radii[i]*(1-t)+radii[i+1]*t)*(1+.18*Math.sin(Math.PI*t)),distance*.025,distance*.48);centers.push(mix(a,b,t));widths.push(radius);depths.push(radius*.85);}
     rings(centers,widths,depths,axis,10);
   }
 };
 if(l&&r&&lh&&rh&&span>1e-5){
   const top=mix(l,r,.5),bottom=mix(lh,rh,.5);
   const shape=[[0,shoulder*.55],[.13,shoulder*.52],[.30,shoulder*.47],[.48,(shoulder+hip)*.205],[.65,hip*.45],[.82,hip*.56],[1,hip*.52]] as const;
   rings(shape.map(([t])=>mix(top,bottom,t)),shape.map(([,w])=>w),shape.map(([,w])=>w*.53),axis,16);
   const le=p(7),re=p(8),nose=p(0);
   if(le&&re&&nose){
     const mid=mix(le,re,.5),up=unit(sub(mid,top)),headW=clamp(len(sub(le,re))*.67,span*.15,span*.34);
     if(len(up)>.1){
       const neckTop=add(mid,mul(up,-headW*1.04));rings([top,mix(top,neckTop,.5),neckTop],[span*.15,span*.12,span*.13],[span*.11,span*.10,span*.11],axis,12);
       const t=[-1,-.8,-.5,-.2,.1,.4,.7,.9,1];const center=add(mid,mul(up,headW*.2));
       rings(t.map(v=>add(center,mul(up,v*headW*1.48))),t.map(v=>headW*Math.max(.05,Math.sqrt(1-v*v))),t.map(v=>headW*.8*Math.max(.05,Math.sqrt(1-v*v))),unit(sub(re,le)),14);
     }
   }
 }
 limb([11,13,15],[.17,.12,.075],5);limb([12,14,16],[.17,.12,.075],5);
 limb([23,25,27],[.24,.15,.09],7);limb([24,26,28],[.24,.15,.09],7);
 limb([15,19],[.09,.045],3);limb([16,20],[.09,.045],3);
 limb([27,31],[.11,.075],3);limb([28,32],[.11,.075],3);
 return mesh;
}
