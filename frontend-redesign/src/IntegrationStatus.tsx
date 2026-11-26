import {useEffect,useRef,useState} from "react";
import {RefreshCw} from "lucide-react";
import {Badge,Btn} from "./ui";
import {request} from "./api";
import {checkProjection} from "./bodyProjection";
import {GLTFLoader} from "three/addons/loaders/GLTFLoader.js";
import {DRACOLoader} from "three/addons/loaders/DRACOLoader.js";
import * as THREE from "three";

type Result={state:"checking"|"ok"|"warn"|"bad";label:string;ms?:number;detail:string;metric?:string};
const names=["API FastAPI (Python)","PostgreSQL · Neon","MediaPipe · Rostro y cuerpo","Atlas 3D · Z-Anatomy","Simulador corporal"];
const initial=():Result[]=>names.map(()=>({state:"checking",label:"Comprobando",detail:"Verificando disponibilidad…"}));
const elapsed=(t:number)=>Math.max(0,performance.now()-t);
const round=(v:number)=>v<1?"< 1 ms":Math.round(v).toLocaleString("es-PE")+" ms";
function limit<T>(task:Promise<T>,ms:number):Promise<T>{
 return new Promise((resolve,reject)=>{const timer=window.setTimeout(()=>reject(Error("Tiempo de comprobación agotado")),ms);task.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
}
async function checkDetector(face:boolean){
 const vision=await import("./vendor/vision_bundle.mjs"),base=new URL("/pose/wasm/",location.origin).href;
 const opts={baseOptions:{modelAssetPath:new URL(face?"/pose/face_landmarker.task":"/pose/pose_landmarker_lite.task",location.origin).href,delegate:"CPU"},runningMode:"IMAGE" as const,canvas:document.createElement("canvas"),...(face?{numFaces:1}:{numPoses:1,outputSegmentationMasks:true})};
 const create=(files:any)=>face?vision.FaceLandmarker.createFromOptions(files,opts):vision.PoseLandmarker.createFromOptions(files,opts);
 let detector:any;
 try{detector=await create(await vision.FilesetResolver.forVisionTasks(base.slice(0,-1)));}catch{detector=await create({wasmLoaderPath:base+"vision_wasm_nosimd_internal.js",wasmBinaryPath:base+"vision_wasm_nosimd_internal.wasm"});}
 try{
  const canvas=document.createElement("canvas");canvas.width=canvas.height=256;const ctx=canvas.getContext("2d");if(!ctx)throw Error("Canvas no disponible");ctx.fillStyle="#202020";ctx.fillRect(0,0,256,256);
  const r=detector.detect(canvas);if(!Array.isArray(face?r.faceLandmarks:r.landmarks))throw Error("Respuesta del detector inválida");r.segmentationMasks?.forEach((m:any)=>m.close());
 }finally{detector.close();}
}
async function checkAtlas(){
 const canvas=document.createElement("canvas"),gl=canvas.getContext("webgl2");if(!gl)throw Error("WebGL 2 no disponible");gl.getExtension("WEBGL_lose_context")?.loseContext();
 const base=import.meta.env.BASE_URL;
 const layers=["skin","skeleton","muscles","organs","arteries","veins","nerves"];
 // Check all deployed model resources, then actually decode the two core layers.
 await Promise.all(layers.map(async layer=>{const r=await fetch(base+"models/zanatomy/"+layer+".glb",{method:"HEAD",cache:"no-cache",signal:AbortSignal.timeout(15000)});const type=r.headers.get("content-type")||"";if(!r.ok||type.includes("text/html"))throw Error("Capa no disponible: "+layer);}));
 const draco=new DRACOLoader().setDecoderPath(base+"draco/"),loader=new GLTFLoader().setDRACOLoader(draco);
 try{
  for(const layer of ["skin","skeleton"]){
   const gltf=await loader.loadAsync(base+"models/zanatomy/"+layer+".glb");
   let meshes=0;const materials=new Set<THREE.Material>();
   gltf.scene.traverse(o=>{if(o instanceof THREE.Mesh){if(o.geometry?.getAttribute("position")?.count>0)meshes++;o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
   materials.forEach(m=>{for(const v of Object.values(m))if(v instanceof THREE.Texture)v.dispose();m.dispose();});
   if(!meshes)throw Error("Capa vacía: "+layer);
  }
 }finally{draco.dispose();}
}
export default function IntegrationStatus(){
 const [results,setResults]=useState<Result[]>(initial),[busy,setBusy]=useState(false),[checked,setChecked]=useState<Date|null>(null);
 const generation=useRef(0),lock=useRef(false);
 const refresh=async()=>{
  if(lock.current)return;lock.current=true;const id=++generation.current;setBusy(true);setResults(initial());setChecked(null);
  const put=(i:number,r:Result)=>{if(generation.current===id)setResults(old=>old.map((v,j)=>i===j?r:v));};
  const probe=async(i:number,fn:()=>Promise<Result>)=>{const start=performance.now();try{put(i,await fn());}catch{put(i,{state:"bad",label:"No disponible",ms:elapsed(start),metric:"Tiempo de comprobación",detail:"La comprobación no se completó. Reintenta."});}};
  await Promise.all([
   probe(0,async()=>{const t=performance.now();const r=await request<{status:string}>("/health/live");if(r.status!=="alive")throw Error("API");return {state:"ok",label:"Operativa",ms:elapsed(t),detail:"Servidor accesible desde el navegador",metric:"Latencia HTTP"};}),
   probe(1,async()=>{const t=performance.now();const r=await request<{database:string;database_latency_ms?:number}>("/health/ready");if(r.database!=="connected")throw Error("DB");const measured=typeof r.database_latency_ms==="number"&&Number.isFinite(r.database_latency_ms)&&r.database_latency_ms>=0;return {state:"ok",label:"Operativa",ms:measured?r.database_latency_ms:elapsed(t),detail:"Conexión y versión de esquema verificadas",metric:measured?"Latencia de conexión y consulta":"Tiempo HTTP de verificación"};}),
   probe(2,async()=>{const t=performance.now(),checks=await limit((async()=>{const ok:boolean[]=[];for(const face of [true,false]){try{await checkDetector(face);ok.push(true);}catch{ok.push(false);}}return ok;})(),75000);const [face,body]=checks;return {state:face&&body?"ok":face||body?"warn":"bad",label:face&&body?"Operativa":face||body?"Parcial":"No disponible",ms:elapsed(t),metric:"Inicialización y prueba",detail:"Rostro: "+(face?"verificado":"error")+" · Cuerpo: "+(body?"verificado":"error")+" · Sin cámara"};}),
   probe(3,async()=>{const t=performance.now();await limit(checkAtlas(),75000);return {state:"ok",label:"Verificado",ms:elapsed(t),metric:"Carga y decodificación",detail:"7 capas accesibles · Piel y esqueleto decodificados · WebGL 2"};}),
   probe(4,async()=>{const t=performance.now();checkProjection();return {state:"ok",label:"Operativo",ms:elapsed(t),metric:"Tiempo de cálculo",detail:"Proyección visual local · Prueba de cálculo superada"};})
  ]);
  if(generation.current===id){setChecked(new Date());setBusy(false);lock.current=false;}
 };
 useEffect(()=>{void refresh();return()=>{generation.current++;lock.current=false;};},[]);
 return <div><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-slate-400">{busy?"Comprobando integraciones…":checked?"Última comprobación: "+checked.toLocaleTimeString("es-PE"):"Integraciones"}</span><Btn disabled={busy} onClick={()=>void refresh()}><RefreshCw size={15} className={busy?"animate-spin":""}/> Actualizar estado</Btn></div>
 <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{results.map((r,i)=><div key={names[i]} className="panel p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold text-white">{names[i]}</div><Badge tone={r.state==="ok"?"ok":r.state==="bad"?"bad":r.state==="warn"?"warn":"muted"}>{r.label}</Badge></div><div className="mt-3 text-sm text-slate-300">{r.metric||"Comprobación"}: {r.ms===undefined?"—":round(r.ms)}</div><div className="mt-2 text-xs text-slate-400">{r.detail}</div></div>)}</div></div>;
}
