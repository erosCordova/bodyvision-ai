import {useEffect,useRef,useState} from "react";
import {Camera,Square} from "lucide-react";
import {Canvas} from "@react-three/fiber";
import {OrbitControls} from "@react-three/drei";
import {Btn,Panel} from "./ui";
import * as THREE from "three";
type Point={x:number;y:number;z:number;visibility?:number};
type Edge={start:number;end:number};
type Frame={points:Point[];edges:Edge[];world:Point[]};
const bodyEdges=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32],[15,17],[17,19],[19,21],[16,18],[18,20],[20,22],[0,2],[2,5],[0,1],[1,4]].map(([start,end])=>({start,end}));
function Mesh({frame,face}:{frame:Frame;face:boolean}){
 const pts=frame.world.length?frame.world:frame.points;
 const valid=pts.filter(p=>[p.x,p.y,p.z].every(Number.isFinite));
 const center=valid.length?valid.reduce((a,p)=>a.add(new THREE.Vector3(p.x,-p.y,-p.z)),new THREE.Vector3()).divideScalar(valid.length):new THREE.Vector3();
 const scale=face?5:1.8;
 const coords=pts.map(p=>new THREE.Vector3(p.x,-p.y,-p.z).sub(center).multiplyScalar(scale));
 const pairs:number[]=[];for(const {start,end} of frame.edges){if(!coords[start]||!coords[end]||(frame.points[start]?.visibility??1)<.5||(frame.points[end]?.visibility??1)<.5)continue;pairs.push(...coords[start].toArray(),...coords[end].toArray());}
 return <><lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" args={[new Float32Array(pairs),3]}/></bufferGeometry><lineBasicMaterial color="#67e8f9" transparent opacity={.85}/></lineSegments><points><bufferGeometry><bufferAttribute attach="attributes-position" args={[new Float32Array(coords.filter((_,i)=>(frame.points[i]?.visibility??1)>=.5).flatMap(v=>v.toArray())),3]}/></bufferGeometry><pointsMaterial color="#e0f2fe" size={.018}/></points></>;
}
export default function LiveMesh(){
 const [mode,setMode]=useState<"face"|"body">("face"),[accepted,setAccepted]=useState(false),[running,setRunning]=useState(false),[status,setStatus]=useState("Cámara apagada"),[frame,setFrame]=useState<Frame|null>(null);
 const video=useRef<HTMLVideoElement>(null),overlay=useRef<HTMLCanvasElement>(null),stream=useRef<MediaStream|null>(null),model=useRef<any>(null),seq=useRef(0),raf=useRef(0);
 const stop=()=>{seq.current++;cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;try{model.current?.close();}catch{}model.current=null;if(video.current)video.current.srcObject=null;setRunning(false);setFrame(null);setStatus("Cámara apagada");const c=overlay.current;c?.getContext("2d")?.clearRect(0,0,c.width,c.height);};
 useEffect(()=>()=>{seq.current++;cancelAnimationFrame(raf.current);stream.current?.getTracks().forEach(t=>t.stop());try{model.current?.close();}catch{}},[]);
 const start=async()=>{
  if(!accepted||running)return;const id=++seq.current;setRunning(true);setStatus("Iniciando cámara y modelo…");setFrame(null);
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error("La cámara necesita HTTPS y un navegador compatible.");
   const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false});
   if(id!==seq.current){media.getTracks().forEach(t=>t.stop());return;}stream.current=media;
   if(!video.current)throw Error("Visor de cámara no disponible");video.current.srcObject=media;await video.current.play();
   const vision=await import("./vendor/vision_bundle.mjs");const files=await vision.FilesetResolver.forVisionTasks(new URL("/pose/wasm",location.origin).href);
   const face=mode==="face";const options={baseOptions:{modelAssetPath:new URL(face?"/pose/face_landmarker.task":"/pose/pose_landmarker_lite.task",location.origin).href,delegate:"CPU"},runningMode:"VIDEO" as const,...(face?{numFaces:1}:{numPoses:1,outputSegmentationMasks:false})};
   const detector=await (face?vision.FaceLandmarker.createFromOptions(files,options):vision.PoseLandmarker.createFromOptions(files,options));
   if(id!==seq.current){detector.close();return;}model.current=detector;
   const edges:Edge[]=face?vision.FaceLandmarker.FACE_LANDMARKS_TESSELATION:bodyEdges;
   let last=-Infinity,lastTime=-1;
   const tick=(now:number)=>{if(id!==seq.current)return;try{
     const v=video.current,c=overlay.current;if(v&&c&&v.readyState>=2&&now-last>100&&v.currentTime!==lastTime){last=now;lastTime=v.currentTime;const result=detector.detectForVideo(v,now);const points:Point[]=(face?result.faceLandmarks:result.landmarks)?.[0]||[];const world:Point[]=face?[]:result.worldLandmarks?.[0]||[];
     if(points.length){setFrame({points,edges,world});setStatus(face?"Rostro detectado · "+points.length+" puntos":"Cuerpo detectado · "+points.filter(p=>(p.visibility??0)>=.5).length+" puntos visibles");}else{setFrame(null);setStatus(face?"Coloca el rostro frente a la cámara":"Sitúa el cuerpo dentro del encuadre");}
     if(c.width!==v.videoWidth||c.height!==v.videoHeight){c.width=v.videoWidth;c.height=v.videoHeight;}const ctx=c.getContext("2d");if(ctx){ctx.clearRect(0,0,c.width,c.height);ctx.strokeStyle="#22d3ee";ctx.lineWidth=face?.65:2;ctx.beginPath();for(const {start,end} of edges){const a=points[start],b=points[end];if(a&&b&&(a.visibility??1)>=.5&&(b.visibility??1)>=.5){ctx.moveTo(a.x*c.width,a.y*c.height);ctx.lineTo(b.x*c.width,b.y*c.height);}}ctx.stroke();}
     }raf.current=requestAnimationFrame(tick);
    }catch(e){stop();setStatus("No se pudo completar la detección. Reintenta.");}};
   setStatus("Buscando puntos anatómicos…");raf.current=requestAnimationFrame(tick);
  }catch(e){if(id===seq.current){stop();setStatus(e instanceof Error?e.message:"No se pudo iniciar la cámara.");}}
 };
 return <div className="space-y-4"><div className="flex flex-wrap items-center gap-3"><select className="field !w-auto" disabled={running} value={mode} onChange={e=>{setMode(e.target.value as "face"|"body");setFrame(null);}}><option value="face">Rostro</option><option value="body">Cuerpo completo</option></select><Btn variant="primary" disabled={!accepted||running} onClick={start}><Camera size={16}/> Activar cámara</Btn><Btn disabled={!running} onClick={stop}><Square size={15}/> Detener</Btn><span className="text-sm text-cyan-300">{status}</span></div>
 <label className="flex items-start gap-2 text-sm text-slate-300"><input type="checkbox" checked={accepted} onChange={e=>{setAccepted(e.target.checked);if(!e.target.checked)stop();}}/> Autorizo el procesamiento local de mi imagen durante esta captura. No se guardan imágenes, puntos faciales, plantillas de identidad ni vídeo.</label>
 <div className="grid gap-4 lg:grid-cols-2"><Panel pad={false}><div className="relative aspect-video overflow-hidden rounded-xl bg-black"><video ref={video} muted playsInline className="absolute inset-0 h-full w-full object-contain"/><canvas ref={overlay} className="pointer-events-none absolute inset-0 h-full w-full object-contain"/>{!running&&<div className="absolute inset-0 grid place-items-center text-sm text-slate-400">Vista previa de cámara</div>}</div></Panel><Panel pad={false}><div className="relative aspect-video overflow-hidden rounded-xl bg-[#050c18]">{frame?<Canvas camera={{position:[0,0,3],fov:42}}><Mesh frame={frame} face={mode==="face"}/><OrbitControls enablePan={false}/></Canvas>:<div className="grid h-full place-items-center text-sm text-slate-400">La geometría aparecerá al detectar puntos</div>}</div></Panel></div>
 <p className="text-xs text-slate-400">{mode==="face"?"Malla facial de puntos y conexiones estimadas en 3D.":"Estructura corporal 3D de puntos de pose; no es una superficie corporal completa."} No identifica personas ni mide composición corporal. La cámara se detiene al salir.</p></div>;
}
