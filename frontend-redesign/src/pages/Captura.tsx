import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RotateCcw, Upload, Video } from "lucide-react";
import { Btn, PageHead, Panel, Modal } from "../ui";
import { bodyParams, useStore } from "../store";
import { BodyScene } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";
import {useConnection} from "../ConnectedProvider";
import {useAction,uploadPhoto} from "../ConnectedPages";
import {image,request,type Capture} from "../api";

const VIEWS = ["Foto 1", "Foto 2", "Foto 3"];
const PIPE = ["Fotografías registradas", "Atlas anatómico de referencia", "Reconstrucción desde imágenes (no habilitada)"];

export default function Captura(){const {patient}=useStore();return <PatientCapture key={patient.id}/>;}
function PatientCapture() {
  const {patient,toast}=useStore(),{selected,run}=useConnection(),{pending,action}=useAction();
  const [shots,setShots]=useState<string[]>([]),[preview,setPreview]=useState<string|undefined>(),[confirmed,setConfirmed]=useState(false),[remove,setRemove]=useState<Capture|null>(null);
  const [showAtlas,setShowAtlas]=useState(false);
  const file=useRef<HTMLInputElement>(null);
  const {fat,mus}=bodyParams(patient);
  const captures=selected?.captures||[];
  const ids=captures.slice(0,3).map(c=>c.id).join(",");
  useEffect(()=>{let alive=true;setShots([]);setPreview(undefined);Promise.all(captures.slice(0,3).map(c=>run(t=>image("/profiles/"+patient.id+"/captures/"+c.id,t)).catch(()=>""))).then(s=>{if(alive)setShots(s);});return()=>{alive=false;};},[patient.id,ids]);
  const onFile=async(f?:File)=>{if(!f||!confirmed)return;if(await action(t=>uploadPhoto(t,patient.id,f),"Fotografía guardada"))setConfirmed(false);};
  const valid=Number.isFinite(patient.altura)&&Number.isFinite(patient.peso);
  const done=showAtlas&&valid;
  const step=Math.min(captures.length,2),proc=captures.length?1:0;
  const reset=()=>{setShowAtlas(false);setPreview(undefined);};
  const checks=[["Fotografías",String(captures.length)],["Peso",Number.isFinite(patient.peso)?patient.peso+" kg":"—"],["Altura",Number.isFinite(patient.altura)?patient.altura+" cm":"—"],["Reconstrucción","No habilitada"]];

  return (
    <div>
      <PageHead title="Captura corporal" sub={`Fotografías del expediente · ${patient.nombre}`} actions={<Btn onClick={reset}><RotateCcw size={16} /> Reiniciar</Btn>} />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel pad={false}>
          {done ? (
            <BodyScene className="h-[600px] rounded-2xl" distance={4.5} ring="#34d399">
              <BodyModel sex={patient.sexo} heightCm={patient.altura} weightKg={patient.peso} ageYears={patient.edad} fat={fat} mus={mus} tone={patient.tono} mode="holo" />
            </BodyScene>
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
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" /> Fotografía del expediente
              </div>
              <div className="absolute inset-x-0 bottom-4 flex flex-wrap items-center justify-center gap-3 px-4">
                <label className="flex items-center gap-2 rounded-lg bg-black/80 px-3 py-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Imagen ficticia</label>
                <Btn variant="primary" disabled={!confirmed||pending} onClick={()=>file.current?.click()}><Upload size={16}/> Subir foto</Btn>
                <Btn disabled={!valid} onClick={()=>setShowAtlas(true)}>Ver atlas 3D</Btn>
                <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e=>{void onFile(e.target.files?.[0]);e.target.value="";}}/>

              </div>
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Fotografías registradas">
            <div className="grid grid-cols-3 gap-3">
              {VIEWS.map((v, i) => (
                <div key={v} onClick={()=>{if(shots[i]){setPreview(shots[i]);setShowAtlas(false);}}} className={`relative aspect-[3/4] overflow-hidden rounded-xl border ${i === step && !done ? "border-cyan-400" : "border-white/10"} bg-white/5`}>
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
          <Panel title="Pipeline de reconstrucción">
            <ul className="space-y-3 text-sm">
              {PIPE.map((p, i) => (
                <li key={p} className={`flex items-center gap-3 ${proc > i ? "text-white" : proc === i ? "text-cyan-200" : "text-slate-500"}`}>
                  {proc > i ? <CheckCircle2 size={16} className="text-emerald-300" /> : proc === i ? <Loader2 size={16} className="animate-spin" /> : <span className="h-4 w-4 rounded-full border border-slate-600" />}
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-700" style={{ width: `${Math.max(0, proc) / PIPE.length * 100}%` }} /></div>
          </Panel>
          <Panel title="Gestionar fotografías">{captures.map(c=><div key={c.id} className="flex items-center gap-2 border-b border-white/5 py-2 text-xs"><span className="flex-1">{new Date(c.created_at).toLocaleString("es-PE")}</span><Btn onClick={async()=>{try{setPreview(await run(t=>image("/profiles/"+patient.id+"/captures/"+c.id,t)));setShowAtlas(false);}catch(e){toast(String(e));}}}>Ver</Btn><Btn variant="danger" disabled={pending} onClick={()=>setRemove(c)}>Eliminar</Btn></div>)}{!captures.length&&<p className="text-sm text-slate-400">Sin fotografías</p>}</Panel>
        </div>
      </div>
      <Modal open={!!remove} onClose={()=>setRemove(null)} title="Eliminar fotografía"><p>¿Eliminar esta fotografía?</p><Btn variant="danger" disabled={pending} onClick={async()=>{if(remove&&await action(t=>request("/profiles/"+patient.id+"/captures/"+remove.id,t,{method:"DELETE"}),"Fotografía eliminada")){setRemove(null);setPreview(undefined);}}}>Confirmar</Btn></Modal>
    </div>
  );
}
