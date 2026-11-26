import {useEffect,useRef,useState} from "react";
import {Camera,Square} from "lucide-react";
import {Btn,Panel} from "./ui";
import {buildBodyWire,fullBodyVisible,fitRingFactors,applyRingFit,smoothPose,type BodyMask,type RingFit,type WireMesh} from "./bodyWire";
type Point={x:number;y:number;z:number;visibility?:number};
type Edge={start:number;end:number};
type Frame={points:Point[];edges:Edge[];world:Point[];body?:WireMesh;aspect?:number};
const bodyEdges=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32],[15,17],[17,19],[19,21],[16,18],[18,20],[20,22],[0,2],[2,5],[0,1],[1,4]].map(([start,end])=>({start,end}));
// Face landmarks may contain visibility=0: unlike pose landmarks, that field
// is not a confidence signal for the face model. Validate coordinates instead.
const visible=(p:Point|undefined,face:boolean)=>!!p&&[p.x,p.y,p.z].every(Number.isFinite)&&(face||(p.visibility??1)>=.5);
function drawMesh(canvas:HTMLCanvasElement,frame:Frame|null,face:boolean,yaw:number,pitch:number,zoom:number){
 const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
 const dpr=Math.min(window.devicePixelRatio||1,2);
 if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
 const ctx=canvas.getContext("2d");if(!ctx)return;
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 if(!frame)return;
 const pts=frame.body?frame.body.points:frame.world.length===frame.points.length?frame.world:frame.points;
 const displayPoints=frame.body?frame.body.points:frame.points,displayEdges=frame.body?frame.body.edges:frame.edges;
 const valid=pts.filter((p,i)=>visible(displayPoints[i],face)&&[p.x,p.y,p.z].every(Number.isFinite));
 if(!valid.length)return;
 const center=valid.reduce((a,p)=>({x:a.x+p.x/valid.length,y:a.y+p.y/valid.length,z:a.z+p.z/valid.length}),{x:0,y:0,z:0});
 const extent=Math.max(.001,...valid.map(p=>Math.hypot(p.x-center.x,p.y-center.y,p.z-center.z)));
 const scale=Math.min(w,h)*.39*zoom/extent;
 const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
 const coords=pts.map((p,i)=>{if(!visible(displayPoints[i],face)||![p.x,p.y,p.z].every(Number.isFinite))return null;
  const x=p.x-center.x,y=p.y-center.y,z=p.z-center.z;
  const rx=x*cy+z*sy,rz=-x*sy+z*cy,ry=y*cp-rz*sp,depth=y*sp+rz*cp;
  return {x:w/2+rx*scale,y:h/2+ry*scale,z:depth};
 });
 if(!face&&frame.body?.faces.length){const triangles=frame.body.faces.map(indices=>{const a=coords[indices[0]],b=coords[indices[1]],c=coords[indices[2]];return a&&b&&c?{a,b,c,depth:(a.z+b.z+c.z)/3}:null;}).filter(t=>t!==null).sort((a,b)=>b!.depth-a!.depth);for(const t of triangles){if(!t)continue;const {a,b,c}=t;const ux=b.x-a.x,uy=b.y-a.y,uz=(b.z-a.z)*scale,vx=c.x-a.x,vy=c.y-a.y,vz=(c.z-a.z)*scale;const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const n=Math.hypot(nx,ny,nz)||1;const light=.28+.72*Math.abs((nx*.35-ny*.45+nz*.82)/n);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineTo(c.x,c.y);ctx.closePath();ctx.fillStyle="rgba(14,"+Math.round(50+95*light)+","+Math.round(75+112*light)+",0.82)";ctx.fill();ctx.strokeStyle="rgba(86,225,247,0.34)";ctx.lineWidth=.55;ctx.stroke();}return;}
 ctx.strokeStyle="#52e6f3";ctx.lineWidth=face?.85:1;ctx.beginPath();
 for(const {start,end} of displayEdges){const a=coords[start],b=coords[end];if(a&&b){ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);}}ctx.stroke();
 ctx.fillStyle="#ddfaff";ctx.beginPath();for(const p of coords){if(!p)continue;const radius=face?1.15:1.05;ctx.moveTo(p.x+radius,p.y);ctx.arc(p.x,p.y,radius,0,2*Math.PI);}ctx.fill();
}
function MeshPreview({frame,face}:{frame:Frame|null;face:boolean}){
 const canvas=useRef<HTMLCanvasElement>(null),current=useRef(frame),rotation=useRef({yaw:0,pitch:0,zoom:1}),drag=useRef<{x:number;y:number}|null>(null);
 current.current=frame;
 const paint=()=>{const c=canvas.current;if(c)drawMesh(c,current.current,face,rotation.current.yaw,rotation.current.pitch,rotation.current.zoom);};
 useEffect(paint,[frame,face]);
 useEffect(()=>{const c=canvas.current;if(!c)return;const observer=new ResizeObserver(paint);observer.observe(c);return()=>observer.disconnect();},[face]);
 return <div className="relative aspect-video overflow-hidden rounded-xl bg-[#050c18]">
 <canvas ref={canvas} aria-label="Malla anatómica tridimensional interactiva" className="absolute inset-0 h-full w-full touch-none cursor-grab" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY};}} onPointerMove={e=>{if(!drag.current)return;rotation.current.yaw+=(e.clientX-drag.current.x)*.012;rotation.current.pitch=Math.max(-1.4,Math.min(1.4,rotation.current.pitch+(e.clientY-drag.current.y)*.012));drag.current={x:e.clientX,y:e.clientY};paint();}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onWheel={e=>{rotation.current.zoom=Math.max(.5,Math.min(2.5,rotation.current.zoom-e.deltaY*.001));paint();}}/>
 {!frame?<div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">La geometría aparecerá al detectar puntos</div>:<div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 text-xs text-slate-300"><span className="pointer-events-none">Arrastra para rotar · rueda para acercar</span><Btn className="!px-2 !py-1" onClick={()=>{rotation.current={yaw:0,pitch:0,zoom:1};paint();}}>Centrar</Btn></div>}
 </div>;
}
export default function LiveMesh(){
 const [mode,setMode]=useState<"face"|"body">("face"),[running,setRunning]=useState(false),[status,setStatus]=useState("Cámara apagada"),[frame,setFrame]=useState<Frame|null>(null);
 const video=useRef<HTMLVideoElement>(null),overlay=useRef<HTMLCanvasElement>(null),stream=useRef<MediaStream|null>(null),model=useRef<any>(null),seq=useRef(0),raf=useRef(0);
 const stop=()=>{seq.current++;cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;try{model.current?.close();}catch{}model.current=null;if(video.current)video.current.srcObject=null;setRunning(false);setFrame(null);setStatus("Cámara apagada");const c=overlay.current;c?.getContext("2d")?.clearRect(0,0,c.width,c.height);};
 useEffect(()=>()=>{seq.current++;cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());try{model.current?.close();}catch{}},[]);
 const start=async()=>{
  if(running)return;
  if(!window.confirm("¿Autorizas activar la cámara para procesar tu imagen localmente? No se guardarán imágenes ni datos biométricos."))return;
  const id=++seq.current;setRunning(true);setStatus("Solicitando permiso de cámara…");setFrame(null);
  let stage="camera";
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error("La cámara necesita HTTPS y un navegador compatible.");
   let media:MediaStream;
   try{media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"user"},width:{ideal:640},height:{ideal:480}},audio:false});}catch(e){if(e instanceof DOMException&&e.name==="OverconstrainedError")media=await navigator.mediaDevices.getUserMedia({video:true,audio:false});else throw e;}
   if(id!==seq.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;
   if(!video.current)throw Error("Visor de cámara no disponible");video.current.srcObject=media;await video.current.play();
   stage="model";setStatus("Cámara activa · cargando detección…");
   const vision=await import("./vendor/vision_bundle.mjs");const base=new URL("/pose/wasm/",location.origin).href;
   const face=mode==="face";const options={baseOptions:{modelAssetPath:new URL(face?"/pose/face_landmarker.task":"/pose/pose_landmarker_lite.task",location.origin).href,delegate:"CPU"},runningMode:"VIDEO" as const,...(face?{numFaces:1}:{numPoses:1,outputSegmentationMasks:true})};
   const create=(files:any)=>face?vision.FaceLandmarker.createFromOptions(files,{...options,canvas:document.createElement("canvas")}):vision.PoseLandmarker.createFromOptions(files,{...options,canvas:document.createElement("canvas")});
   let detector:any;
   try{detector=await create(await vision.FilesetResolver.forVisionTasks(base.slice(0,-1)));}catch{detector=await create({wasmLoaderPath:base+"vision_wasm_nosimd_internal.js",wasmBinaryPath:base+"vision_wasm_nosimd_internal.wasm"});}
   if(id!==seq.current){detector.close();return;}model.current=detector;
   const edges:Edge[]=face?Array.from(vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION||[]):bodyEdges;
   let last=-Infinity,lastTime=-1,previousScreen:Point[]=[],previousWorld:Point[]=[],previousFits=new Map<string,RingFit>();
   const maskCanvas=document.createElement("canvas");
   const maskContext=maskCanvas.getContext("2d");
   const tick=(now:number)=>{if(id!==seq.current)return;try{
     const v=video.current,c=overlay.current;if(v&&c&&v.readyState>=2&&now-last>100&&v.currentTime!==lastTime){last=now;lastTime=v.currentTime;let result:any,mask:BodyMask|undefined;
     if(face){result=detector.detectForVideo(v,now);}else{
      // Copy only the small probability mask within MediaPipe's callback lifetime.
      detector.detectForVideo(v,now,(r:any)=>{result=r;const m=r.segmentationMasks?.[0];if(m)try{mask={width:m.width,height:m.height,data:new Float32Array(m.getAsFloat32Array())};}catch{/* pose still works without segmentation */}});
     }
     const raw:Point[]=(face?result?.faceLandmarks:result?.landmarks)?.[0]||[],rawWorld:Point[]=face?[]:result?.worldLandmarks?.[0]||[];
     const points=face?raw:smoothPose(raw,previousScreen),world=face?[]:smoothPose(rawWorld,previousWorld);
     previousScreen=points;previousWorld=world;
     const aspect=v.videoWidth/Math.max(1,v.videoHeight);
     let screenMesh=face?undefined:buildBodyWire(points,points,aspect,false);
     let worldMesh=face?undefined:world.length===points.length?buildBodyWire(world,points,aspect,true):screenMesh;
     if(mask&&screenMesh&&worldMesh){
      const fits=fitRingFactors(screenMesh,mask,aspect);
      for(const [key,fit] of fits){const prior=previousFits.get(key);if(prior){fit.factor=prior.factor*.55+fit.factor*.45;fit.shift=prior.shift*.55+fit.shift*.45;}}
      previousFits=fits;const same=worldMesh===screenMesh;screenMesh=applyRingFit(screenMesh,fits,aspect,false);worldMesh=same?screenMesh:applyRingFit(worldMesh,fits,aspect,true);
     }else{previousFits.clear();}

     if(points.length){setFrame({points,edges,world,body:worldMesh,aspect});setStatus(face?"Rostro detectado · "+points.length+" puntos":fullBodyVisible(points)?(mask?"Cuerpo completo · silueta ajustada":"Cuerpo completo · malla de pose"):screenMesh?.points.length?"Captura parcial · muestra todo el cuerpo":"Sitúa el cuerpo dentro del encuadre");}else{setFrame(null);setStatus(face?"Coloca el rostro frente a la cámara":"Sitúa el cuerpo dentro del encuadre");}
     if(c.width!==v.videoWidth||c.height!==v.videoHeight){c.width=v.videoWidth;c.height=v.videoHeight;}const ctx=c.getContext("2d");if(ctx){ctx.clearRect(0,0,c.width,c.height);if(mask&&maskContext){maskCanvas.width=mask.width;maskCanvas.height=mask.height;const img=maskContext.createImageData(mask.width,mask.height);for(let j=0;j<mask.height;j++)for(let i=0;i<mask.width;i++){const k=j*mask.width+i;if(mask.data[k]<.52)continue;const boundary=i===0||j===0||i===mask.width-1||j===mask.height-1||mask.data[k-1]<.52||mask.data[k+1]<.52||mask.data[k-mask.width]<.52||mask.data[k+mask.width]<.52;img.data[k*4]=35;img.data[k*4+1]=220;img.data[k*4+2]=245;img.data[k*4+3]=boundary?205:22;}maskContext.putImageData(img,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(maskCanvas,0,0,c.width,c.height);}ctx.strokeStyle="#22d3ee";const drawPoints=screenMesh?.points||points,drawEdges=screenMesh?.edges||edges;ctx.lineWidth=face?1.25:.7;ctx.beginPath();for(const {start,end} of drawEdges){const a=drawPoints[start],b=drawPoints[end];if(visible(a,face)&&visible(b,face)){ctx.moveTo(a.x*c.width,a.y*c.height);ctx.lineTo(b.x*c.width,b.y*c.height);}}ctx.stroke();ctx.fillStyle="#b7fcff";ctx.beginPath();for(const p of drawPoints){if(!visible(p,face))continue;const x=p.x*c.width,y=p.y*c.height,r=face?1.4:1.0;ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,2*Math.PI);}ctx.fill();}
     }raf.current=requestAnimationFrame(tick);
    }catch(e){cancelAnimationFrame(raf.current);try{model.current?.close();}catch{}model.current=null;setFrame(null);setStatus("Cámara activa · error de detección. Detén y vuelve a activar para reintentar.");}};
   setStatus("Buscando puntos anatómicos…");raf.current=requestAnimationFrame(tick);
  }catch(e){if(id===seq.current){if(stage==="model"){setStatus("Cámara activa · no se pudo cargar el modelo de IA. Detén y reintenta.");return;}stop();const name=e instanceof Error?e.name:"";setStatus(name==="NotAllowedError"||name==="SecurityError"?"Permiso de cámara bloqueado. Permite la cámara desde el icono de configuración junto a la dirección del navegador.":name==="NotFoundError"?"No se detectó ninguna cámara.":name==="NotReadableError"||name==="AbortError"?"La cámara no está disponible; revisa si otra aplicación la está utilizando.":e instanceof Error?e.message:"No se pudo iniciar la cámara.");}}
 };
 return <div className="space-y-4"><div className="flex flex-wrap items-center gap-3"><select className="field !w-auto" disabled={running} value={mode} onChange={e=>{setMode(e.target.value as "face"|"body");setFrame(null);}}><option value="face">Rostro</option><option value="body">Cuerpo completo</option></select><Btn variant="primary" disabled={running} onClick={start}><Camera size={16}/> Activar cámara</Btn><Btn disabled={!running} onClick={stop}><Square size={15}/> Detener</Btn><span className="text-sm text-cyan-300">{status}</span></div>
 <p className="text-sm text-slate-400">Al activar la cámara se solicitará autorización. El procesamiento es local y no se guardan imágenes ni datos biométricos.</p>
 <div className="grid gap-4 lg:grid-cols-2"><Panel pad={false}><div className="relative aspect-video overflow-hidden rounded-xl bg-black"><video ref={video} autoPlay muted playsInline className="absolute inset-0 h-full w-full object-contain"/><canvas ref={overlay} className="pointer-events-none absolute inset-0 z-10 h-full w-full object-contain"/>{!running&&<div className="absolute inset-0 grid place-items-center text-sm text-slate-400">Vista previa de cámara</div>}</div></Panel><Panel pad={false}><MeshPreview frame={frame} face={mode==="face"}/></Panel></div>
 <p className="text-xs text-slate-400">{mode==="face"?"Malla facial de puntos y conexiones estimadas en 3D.":"Malla anatómica aproximada: pose, ajuste al contorno visible y superficie sombreada. La profundidad es estimada; no es un escaneo exacto."} No identifica personas ni mide composición corporal. La cámara se detiene al salir.</p></div>;
}
