import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RotateCcw, Upload, Video } from "lucide-react";
import { Btn, PageHead, Panel, Modal } from "../ui";
import { bodyParams, useStore } from "../store";
import { BodyScene } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";
import {useConnection} from "../ConnectedProvider";
import {useAction,uploadPhoto} from "../ConnectedPages";
import {image,request,type Capture,type CapturePosture} from "../api";
import LiveMesh from "../LiveMesh";

const VIEWS = [{id:"front",label:"Frente"},{id:"side",label:"Perfil"},{id:"back",label:"Espalda"}] as const;
type View=typeof VIEWS[number]["id"];
const postureLabel=(p:CapturePosture|undefined)=>VIEWS.find(v=>v.id===p)?.label||"Sin clasificar";
const PIPE = ["Tres posturas registradas", "Adaptación a las medidas del expediente", "Visualización del modelo 3D"];

export default function Captura(){const {patient}=useStore();return <PatientCapture key={patient.id}/>;}
function PatientCapture() {
  const {patient,toast}=useStore(),{selected,run,role}=useConnection(),{pending,action}=useAction(patient.id);
  const [shots,setShots]=useState<Record<string,string>>({}),[posture,setPosture]=useState<View>("front"),[drafts,setDrafts]=useState<Partial<Record<View,{file:File;src:string}>>>({}),[cameraOpen,setCameraOpen]=useState(true),[preview,setPreview]=useState<string|undefined>(),[remove,setRemove]=useState<Capture|null>(null);
  const [showAtlas,setShowAtlas]=useState(false);
  const [modelReady,setModelReady]=useState(false),[modelTimeout,setModelTimeout]=useState(false),[attempt,setAttempt]=useState(0);
  const lastAuto=useRef("");
  const markReady=useCallback(()=>{setModelReady(true);setModelTimeout(false);},[]);
  const openAtlas=()=>{setModelReady(false);setModelTimeout(false);setAttempt(v=>v+1);setShowAtlas(true);};
  const file=useRef<HTMLInputElement>(null);
  const {fat,mus}=bodyParams(patient);
  const captures=selected?.captures||[];
  const writable=role==="administrator"||role==="specialist";
  const classified=VIEWS.map(v=>captures.find(c=>c.posture===v.id));
  const count=classified.filter(Boolean).length;
  const ids=classified.map(c=>c?.id||"").join(",");
  useEffect(()=>{let alive=true;setShots({});Promise.all(classified.map(async c=>c?[c.id,await run(t=>image("/profiles/"+patient.id+"/captures/"+c.id,t)).catch(()=>"")]:null)).then(entries=>{if(alive)setShots(Object.fromEntries(entries.filter((e):e is string[]=>!!e)));});return()=>{alive=false;};},[patient.id,ids]);
  const onFile=async(f?:File,view:View=posture)=>{if(!f||!writable)return false;if(!window.confirm("¿Guardar fotografía de demostración? Solo se admiten imágenes ficticias, no fotografías personales o clínicas reales."))return false;return await action(t=>uploadPhoto(t,patient.id,f,view),"Fotografía de "+postureLabel(view).toLowerCase()+" guardada");};
  const onCameraPhoto=(f:File)=>{const view=posture;const reader=new FileReader();reader.onload=()=>{const src=String(reader.result);setDrafts(d=>({...d,[view]:{file:f,src}}));setPreview(src);setShowAtlas(false);toast("Captura de "+postureLabel(view).toLowerCase()+" disponible para revisar");};reader.onerror=()=>toast("No se pudo preparar la fotografía");reader.readAsDataURL(f);};
  const saveDraft=async(view:View)=>{const d=drafts[view];if(!d)return;if(await onFile(d.file,view)){setDrafts(old=>{const next={...old};delete next[view];return next;});setPreview(undefined);}};
  const discardDraft=(view:View)=>{setDrafts(old=>{const next={...old};delete next[view];return next;});setPreview(undefined);};
  const valid=Number.isFinite(patient.altura)&&patient.altura>0&&Number.isFinite(patient.peso)&&patient.peso>0;
  const done=showAtlas&&valid;
  useEffect(()=>{
    if(valid&&count===3&&ids&&lastAuto.current!==ids){
      lastAuto.current=ids;openAtlas();
    }
  },[valid,count,ids]);
  useEffect(()=>{
    if(!done||modelReady)return;
    const timer=window.setTimeout(()=>setModelTimeout(true),45000);
    return ()=>window.clearTimeout(timer);
  },[done,modelReady,attempt]);
  const completed=[count===3,valid,done&&modelReady];
  const progress=completed.filter(Boolean).length/3*100;
  const reset=()=>{setShowAtlas(false);setModelReady(false);setModelTimeout(false);setPreview(undefined);};
  const checks=[["Posturas registradas",count+" / 3"],["Peso",Number.isFinite(patient.peso)?patient.peso+" kg":"—"],["Altura",Number.isFinite(patient.altura)?patient.altura+" cm":"—"],["Modelo 3D",modelReady?"Cargado":valid?"Preparado":"Faltan medidas"]];

  return (
    <div>
      <PageHead title="Captura corporal" sub={`Fotografías del expediente · ${patient.nombre}`} actions={<Btn onClick={()=>{reset();setDrafts({});setCameraOpen(false);}}><RotateCcw size={16} /> Reiniciar</Btn>} />
      <Panel title="Captura anatómica por cámara" className="mb-5" action={<Btn onClick={()=>setCameraOpen(v=>!v)}>{cameraOpen?"Cerrar cámara":"Abrir cámara"}</Btn>}>
        {cameraOpen&&<><div className="mb-4 flex flex-wrap items-center gap-3"><span className="text-sm text-slate-300">Postura:</span>{VIEWS.map(v=><Btn key={v.id} variant={posture===v.id?"primary":"outline"} onClick={()=>setPosture(v.id)}>{v.label}</Btn>)}</div><LiveMesh initialMode="body" onPhoto={onCameraPhoto} photoLabel={"Tomar foto · "+postureLabel(posture)} photoDisabled={pending||!writable}/></>}
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel pad={false}>
          {done ? (
            <div className="relative"><BodyScene key={attempt} onReady={markReady} className="h-[600px] rounded-2xl" distance={4.5} ring="#34d399">
              <BodyModel sex={patient.sexo} heightCm={patient.altura} weightKg={patient.peso} ageYears={patient.edad} fat={fat} mus={mus} tone={patient.tono} mode="holo" />
            </BodyScene><div className="absolute bottom-4 left-4 z-10 flex gap-2"><Btn onClick={reset}>Ver fotografías</Btn>{modelTimeout&&!modelReady&&<Btn variant="primary" onClick={openAtlas}>Reintentar carga</Btn>}</div></div>
          ) : (
            <div className="relative grid h-[600px] place-items-center overflow-hidden rounded-2xl bg-black">
              {(preview||patient.foto)?<img src={preview||patient.foto} alt="Fotografía del expediente" className="h-full w-full object-contain"/>:<span className="text-slate-400">Sin fotografía registrada</span>}
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid meet">
                <g fill="none" stroke="#22d3ee" strokeWidth="2" strokeDasharray="7 6" opacity=".85">
                  <circle cx="200" cy="82" r="36" />
                  <path d="M200 120 C150 126 130 140 126 190 L108 330 M200 120 C250 126 270 140 274 190 L292 330 M158 190 L162 330 L150 560 M242 190 L238 330 L250 560 M162 330 L238 330" />
                </g>
              </svg>
              
              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-1.5 text-xs backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-cyan-400" /> Fotografía del expediente
              </div>
              <div className="absolute inset-x-0 bottom-4 flex flex-wrap items-center justify-center gap-3 px-4">
                <Btn variant="primary" disabled={pending||!writable} onClick={()=>file.current?.click()}>{pending?<Loader2 size={16} className="animate-spin"/>:<Upload size={16}/>} {pending?"Guardando…":"Subir foto · "+postureLabel(posture)}</Btn>
                <Btn disabled={!valid||pending} onClick={openAtlas}>Generar visualización 3D</Btn>
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{void onFile(e.target.files?.[0]);e.target.value="";}}/>

              </div>
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Fotografías registradas">
            <div className="grid grid-cols-3 gap-3">
              {VIEWS.map((v,i)=>{const c=classified[i],draft=drafts[v.id],src=draft?.src||(c?shots[c.id]:undefined);return <div key={v.id} className="min-w-0 space-y-2">
                <button type="button" onClick={()=>{setPosture(v.id);reset();setPreview(src);}} className={`relative w-full aspect-[3/4] overflow-hidden rounded-xl border ${posture===v.id?"border-cyan-400":"border-white/10"} bg-white/5`}>
                  {src?<img src={src} alt={v.label} className="h-full w-full object-contain"/>:<span className="text-xs text-slate-500">{v.label}</span>}
                  {c&&!draft&&<CheckCircle2 size={18} className="absolute right-1.5 top-1.5 text-emerald-300"/>}
                  <span className="absolute inset-x-0 bottom-0 bg-black/70 p-1 text-xs">{v.label}</span>
                </button>
                {draft?<><div className="text-xs text-amber-300">Sin guardar</div><Btn className="w-full !px-1" variant="primary" disabled={pending||!writable} onClick={()=>saveDraft(v.id)}>Guardar</Btn><Btn className="w-full !px-1" onClick={()=>discardDraft(v.id)}>Descartar</Btn></>:<div className="text-xs text-slate-400">{c?"Registrada":"Pendiente"}</div>}
              </div>;})}
            </div>
          </Panel>
          <Panel title="Control de calidad">
            <ul className="space-y-2.5 text-sm">
              {checks.map(([l, v]) => (
                <li key={l} className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-300">{l}</span><span className="text-slate-400">{v}</span></li>
              ))}
            </ul>
          </Panel>
          <Panel title="Preparación del modelo 3D">
            <ul className="space-y-3 text-sm">
              {PIPE.map((p, i) => (
                <li key={p} className={`flex items-center gap-3 ${completed[i] ? "text-white" : "text-slate-400"}`}>
                  {completed[i] ? <CheckCircle2 size={16} className="text-emerald-300" /> : i===2&&done&&!modelTimeout?<Loader2 size={16} className="animate-spin text-cyan-300"/>:<span className="h-4 w-4 rounded-full border border-slate-600" />}
                  <span className="flex-1">{p}</span><span className="text-xs text-slate-400">{completed[i]?"Completado":i===0?"Faltan posturas":i===1?"Faltan medidas":modelTimeout?"Reintentar":done?"Cargando":"Pendiente"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">{modelTimeout&&!modelReady?"El atlas está tardando en cargar. Puedes reintentar.":modelReady?"Modelo anatómico listo. Ajustado a las medidas registradas, no reconstruido desde las fotografías.":"Modelo anatómico ajustado a las medidas del expediente."}</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-700" style={{ width: `${progress}%` }} /></div>
          </Panel>
          <Panel title="Gestionar fotografías">{captures.map(c=><div key={c.id} className="flex items-center gap-2 border-b border-white/5 py-2 text-xs"><span className="flex-1">{postureLabel(c.posture)+" · "+new Date(c.created_at).toLocaleString("es-PE")}</span><Btn onClick={async()=>{try{const src=await run(t=>image("/profiles/"+patient.id+"/captures/"+c.id,t));reset();setPreview(src);}catch(e){toast(String(e));}}}>Ver</Btn><Btn variant="danger" disabled={pending||!writable} onClick={()=>setRemove(c)}>Eliminar</Btn></div>)}{!captures.length&&<p className="text-sm text-slate-400">Sin fotografías</p>}</Panel>
        </div>
      </div>
      <Modal open={!!remove} onClose={()=>setRemove(null)} title="Eliminar fotografía"><p>¿Eliminar esta fotografía?</p><Btn variant="danger" disabled={pending} onClick={async()=>{if(remove&&await action(t=>request("/profiles/"+patient.id+"/captures/"+remove.id,t,{method:"DELETE"}),"Fotografía eliminada")){setRemove(null);setPreview(undefined);}}}>Confirmar</Btn></Modal>
    </div>
  );
}
