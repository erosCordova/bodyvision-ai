import {useState} from "react";
import {Download,Plus,Ruler,Pencil} from "lucide-react";
import {Badge,Btn,PageHead,Panel} from "../ui";
import {imcOf,useStore} from "../store";
import {useConnection} from "../ConnectedProvider";
import {useAction} from "../ConnectedPages";
import {saveObservation,type Observation} from "../api";

export default function Mediciones(){
 const {patient}=useStore();
 return <PatientMeasurements key={patient.id}/>;
}
function PatientMeasurements(){
 const {patient,toast}=useStore();
 const {selected,catalog}=useConnection();
 const {pending,action}=useAction();
 const fields=[["weight","Peso"],["height","Altura"],["waist","Cintura"],["hip","Cadera"],["chest","Pecho"],["arm","Brazo"],["thigh","Muslo"],["body_fat_pct","Grasa corporal"],["muscle_mass_kg","Masa muscular"]];
 const [values,setValues]=useState<Record<string,string>>({});
 const [editing,setEditing]=useState<Observation|null>(null);
 const [instrument,setInstrument]=useState(""),[reason,setReason]=useState("");
 const records=selected?.observations||[];
 const reset=()=>{setValues({});setEditing(null);setInstrument("");setReason("");};
 const edit=(o:Observation)=>{setEditing(o);setValues({[o.metric_code]:String(o.value)});setInstrument(o.instrument||"");setReason("");};
 const save=async()=>{
  const entries=Object.entries(values).filter(([,v])=>v.trim()!=="");
  if(!entries.length)return toast("Registra al menos una medición");
  if(editing&&reason.trim().length<5)return toast("Indica el motivo de la corrección");
  for(const [code,v] of entries){const m=catalog.find(m=>m.code===code);if(!m||!Number.isFinite(+v)||+v<m.min_value||+v>m.max_value)return toast("Revisa "+(m?.label||code));if(!m.allowed_methods.includes("manual")&&!instrument.trim())return toast("Indica el instrumento utilizado");}
  const at=editing?.measured_at||new Date().toISOString();
  const ok=await action(async t=>{for(const [code,v] of entries){const m=catalog.find(m=>m.code===code)!;const device=!m.allowed_methods.includes("manual");await saveObservation(t,patient.id,{metric_code:code,value:Math.round(+v*100)/100,unit:m.unit,method:device?"device":"manual",instrument:instrument.trim()||null,measured_at:at,...(editing?{correction_reason:reason.trim()}: {})},editing?.id);}},editing?"Corrección registrada":"Mediciones registradas");
  if(ok)reset();
 };
 const csv=()=>{const rows=[["Variable","Valor","Unidad","Fecha","Método"],...records.map(o=>[catalog.find(m=>m.code===o.metric_code)?.label||o.metric_code,o.value,o.unit,o.measured_at,o.method])];const text=rows.map(r=>r.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\n");const url=URL.createObjectURL(new Blob([text],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="mediciones.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const weight=values.weight?.trim()?+values.weight:patient.peso,height=values.height?.trim()?+values.height:patient.altura;
 const bmi=imcOf(weight,height),icc=values.waist&&values.hip&&+values.hip>0?+values.waist/+values.hip:NaN;
 const fmt=(v:number,d=1)=>Number.isFinite(v)?v.toFixed(d):"—";
 return <div><PageHead title="Mediciones" sub={"Registro antropométrico · "+patient.nombre} actions={<Btn disabled={!records.length} onClick={csv}><Download size={16}/> Exportar CSV</Btn>}/>
 <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
 <Panel title={<span className="flex items-center gap-2"><Ruler size={17} className="text-cyan-300"/>{editing?"Corregir medición":"Nueva medición"}</span>}>
 <div className="grid grid-cols-2 gap-3">{fields.filter(([code])=>!editing||code===editing.metric_code).map(([code,label])=>{const m=catalog.find(m=>m.code===code);return <label key={code}><span className="mb-1 block text-xs text-slate-400">{label} ({m?.unit||"—"})</span><input type="number" step=".01" disabled={pending||!m} className="field" value={values[code]||""} onChange={e=>setValues(v=>({...v,[code]:e.target.value}))}/></label>;})}</div>
 <label className="mt-3 block text-xs text-slate-400">Instrumento (obligatorio para composición corporal)<input className="field mt-1" maxLength={100} value={instrument} onChange={e=>setInstrument(e.target.value)}/></label>
 {editing&&<label className="mt-3 block text-xs text-slate-400">Motivo de corrección<input className="field mt-1" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
 <div className="mt-5 grid grid-cols-3 gap-2 text-center">{[["IMC",fmt(bmi)],["ICC",fmt(icc,2)],["Grasa registrada",Number.isFinite(patient.grasa)?patient.grasa+"%":"—"]].map(([l,v])=><div key={l} className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3"><div className="text-[11px] text-slate-400">{l}</div><div className="font-display text-lg font-bold text-cyan-200">{v}</div></div>)}</div>
 <Btn className="mt-5 w-full" variant="primary" disabled={pending} onClick={save}><Plus size={16}/>{editing?"Guardar corrección":"Guardar mediciones"}</Btn>{editing&&<Btn className="mt-2 w-full" disabled={pending} onClick={reset}>Cancelar edición</Btn>}
 </Panel>
 <Panel title="Historial de mediciones" pad={false}><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>Variable</th><th>Paciente</th><th>Fecha</th><th>Valor</th><th>Método</th><th>Acciones</th></tr></thead><tbody>{records.map(o=><tr key={o.id} className="border-t border-white/5 [&>td]:px-4 [&>td]:py-3"><td>{catalog.find(m=>m.code===o.metric_code)?.label||o.metric_code}</td><td>{patient.nombre}</td><td>{new Date(o.measured_at).toLocaleDateString("es-PE")}</td><td>{o.value} {o.unit}</td><td><Badge tone="info">{o.method==="device"?"Instrumento":"Manual"}</Badge></td><td><button className="p-2 text-cyan-300" title="Corregir medición" aria-label="Corregir medición" disabled={pending} onClick={()=>edit(o)}><Pencil size={16}/></button></td></tr>)}{!records.length&&<tr><td colSpan={6} className="py-12 text-center text-slate-400">Sin mediciones de este expediente</td></tr>}</tbody></table></div></Panel>
 </div></div>;
}
