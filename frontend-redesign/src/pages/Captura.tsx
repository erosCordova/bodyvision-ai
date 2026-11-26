import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RotateCcw, Upload, Video } from "lucide-react";
import { Btn, PageHead, Panel, Modal } from "../ui";
import { bodyParams, useStore } from "../store";
import { BodyScene } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";
import {useConnection} from "../ConnectedProvider";
import {useAction,uploadPhoto} from "../ConnectedPages";
import {image,request,type Capture} from "../api";

const VIEWS = ["Foto 1", "Foto 2", "Foto 3"];
const PIPE = ["Fotografías registradas", "Adaptación a las medidas del expediente", "Visualización del modelo 3D"];

export default function Captura(){const {patient}=useStore();return <PatientCapture key={patient.id}/>;}
function PatientCapture() {
  const {patient,toast}=useStore(),{selected,run}=useConnection(),{pending,action}=useAction(patient.id);
  const [shots,setShots]=useState<string[]>([]),[preview,setPreview]=useState<string|undefined>(),[remove,setRemove]=useState<Capture|null>(null);
  const [showAtlas,setShowAtlas]=useState(false);
  const [modelReady,setModelReady]=useState(false),[modelTimeout,setModelTimeout]=useState(false),[attempt,setAttempt]=useState(0);
  const lastAuto=useRef("");
  const markReady=useCallback(()=>{setModelReady(true);setModelTimeout(false);},[]);
  const openAtlas=()=>{setModelReady(false);setModelTimeout(false);setAttempt(v=>v+1);setShowAtlas(true);};
  const file=useRef<HTMLInputElement>(null);
  const {fat,mus}=bodyParams(patient);
  const captures=selected?.captures||[];
  const ids=captures.slice(0,3).map(c=>c.id).join(",");
  useEffect(()=>{let alive=true;setShots([]);setPreview(undefined);Promise.all(captures.slice(0,3).map((c,i)=>i===0&&patient.foto?Promise.resolve(patient.foto):run(t=>image("/profiles/"+patient.id+"/captures/"+c.id,t)).catch(()=>""))).then(s=>{if(alive)setShots(s);});return()=>{alive=false;};},[patient.id,ids]);
  const onFile=async(f?:File)=>{if(!f)return;if(!window.confirm("El almacenamiento actual solo admite imágenes de prueba, no fotografías clínicas o personales reales. ¿Confirmas que la imagen cumple esta condición?"))return;await action(t=>uploadPhoto(t,patient.id,f),"Fotografía guardada");};
  const valid=Number.isFinite(patient.altura)&&patient.altura>0&&Number.isFinite(patient.peso)&&patient.peso>0;
  const done=showAtlas&&valid;
  useEffect(()=>{
    if(valid&&captures.length>=3&&ids&&lastAuto.current!==ids){
      lastAuto.current=ids;openAtlas();
    }
  },[valid,captures.length,ids]);
  useEffect(()=>{
    if(!done||modelReady)return;
    const timer=window.setTimeout(()=>setModelTimeout(true),45000);
    return ()=>window.clearTimeout(timer);
  },[done,modelReady,attempt]);
  const step=Math.min(captures.length,2);
  const completed=[captures.length>0,valid,done&&modelReady];
  const progress=completed.filter(Boolean).length/3*100;
  const reset=()=>{setShowAtlas(false);setModelReady(false);setModelTimeout(false);setPreview(undefined);};
  const checks=[["Fotografías",String(captures.length)],["Peso",Number.isFinite(patient.peso)?patient.peso+" kg":"—"],["Altura",Number.isFinite(patient.altura)?patient.altura+" cm":"—"],["Modelo 3D",modelReady?"Cargado":valid?"Preparado":"Faltan medidas"]];

  return (
    <div>
      <PageHead title="Captura corporal" sub={`Fotografías del expediente · ${patient.nombre}`} actions={<Btn onClick={reset}><RotateCcw size={16} /> Reiniciar</Btn>} />
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
                <Btn variant="primary" disabled={pending} onClick={()=>file.current?.click()}>{pending?<Loader2 size={16} className="animate-spin"/>:<Upload size={16}/>} {pending?"Guardando…":"Subir foto"}</Btn>
                <Btn disabled={!valid||pending} onClick={openAtlas}>Generar visualización 3D</Btn>
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{void onFile(e.target.files?.[0]);e.target.value="";}}/>

              </div>
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Fotografías registradas">
            <div className="grid grid-cols-3 gap-3">
              {VIEWS.map((v, i) => (
                <div key={v} onClick={()=>{if(shots[i]){reset();setPreview(shots[i]);}}} className={`relative aspect-[3/4] overflow-hidden rounded-xl border ${i === step && !done ? "border-cyan-400" : "border-white/10"} bg-white/5`}>
                  {shots[i] ? <img src={shots[i]} alt={v} className="h-full w-full object-cover object-top" /> : <div className="grid h-full place-items-center text-xs text-slate-500">{v}</div>}
                  {shots[i] && <CheckCircle2 size={18} className="absolute right-1.5 top-1.5 text-emerald-300" />}
                </div>
              ))}
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
                  <span className="flex-1">{p}</span><span className="text-xs text-slate-400">{completed[i]?"Completado":i===0?"Sin fotos":i===1?"Faltan medidas":modelTimeout?"Reintentar":done?"Cargando":"Pendiente"}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-400">{modelTimeout&&!modelReady?"El atlas está tardando en cargar. Puedes reintentar.":modelReady?"Modelo anatómico listo. Ajustado a las medidas registradas, no reconstruido desde las fotografías.":"Modelo anatómico ajustado a las medidas del expediente."}</p><div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-700" style={{ width: `${progress}%` }} /></div>
          </Panel>
          <Panel title="Gestionar fotografías">{captures.map(c=><div key={c.id} className="flex items-center gap-2 border-b border-white/5 py-2 text-xs"><span className="flex-1">{new Date(c.created_at).toLocaleString("es-PE")}</span><Btn onClick={async()=>{try{const src=await run(t=>image("/profiles/"+patient.id+"/captures/"+c.id,t));reset();setPreview(src);}catch(e){toast(String(e));}}}>Ver</Btn><Btn variant="danger" disabled={pending} onClick={()=>setRemove(c)}>Eliminar</Btn></div>)}{!captures.length&&<p className="text-sm text-slate-400">Sin fotografías</p>}</Panel>
        </div>
      </div>
      <Modal open={!!remove} onClose={()=>setRemove(null)} title="Eliminar fotografía"><p>¿Eliminar esta fotografía?</p><Btn variant="danger" disabled={pending} onClick={async()=>{if(remove&&await action(t=>request("/profiles/"+patient.id+"/captures/"+remove.id,t,{method:"DELETE"}),"Fotografía eliminada")){setRemove(null);setPreview(undefined);}}}>Confirmar</Btn></Modal>
    </div>
  );
}
