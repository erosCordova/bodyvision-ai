import {useState,type ReactNode} from "react";
import {useNavigate,Link} from "react-router-dom";
import {Plus,Pencil,Archive,Download,Upload,Trash2,RefreshCw} from "lucide-react";
import {Btn,Panel,PageHead,Modal,Badge} from "./ui";
import {useStore} from "./store";
import {useConnection} from "./ConnectedProvider";
import {request,json,saveObservation,image,type Profile,type Observation,type Metric,type Capture} from "./api";


// Re-encode to a small non-interlaced PNG and retain only the mandatory chunks.
// The server independently validates every chunk, CRC, dimensions and payload.
async function syntheticPng(file:File):Promise<Blob>{
 if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>10*1024*1024)throw Error("Selecciona JPG, PNG o WEBP de hasta 10 MB.");
 const bitmap=await createImageBitmap(file);
 try{
  for(const size of [512,384,256,192,128]){
   const canvas=document.createElement("canvas"),scale=Math.min(1,size/Math.max(bitmap.width,bitmap.height));
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext("2d");if(!ctx)throw Error("No se pudo convertir la imagen.");
   ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("Conversión PNG fallida")),"image/png"));
   const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),parts:Uint8Array[]=[bytes.slice(0,8)];
   for(let i=8;i+12<=bytes.length;){const n=view.getUint32(i),end=i+n+12;if(end>bytes.length)throw Error("PNG inválido");const name=String.fromCharCode(...bytes.slice(i+4,i+8));if(["IHDR","IDAT","IEND"].includes(name))parts.push(bytes.slice(i,end));i=end;if(name==="IEND")break;}
   const result=new Blob(parts,{type:"image/png"});if(result.size<=262144)return result;
  }
  throw Error("No se pudo reducir la imagen a 256 KiB.");
 }finally{bitmap.close();}
}
export async function uploadPhoto(token:string,profileId:string,file:File){const png=await syntheticPng(file);return request("/profiles/"+profileId+"/captures",token,{method:"POST",body:png,headers:{"Content-Type":"image/png","X-Synthetic-Only":"confirmed"}});}

export function useAction(){
 const {refresh,run}=useConnection(),{toast}=useStore();
 const [pending,setPending]=useState(false);
 const action=async(fn:(token:string)=>Promise<unknown>,message:string)=>{
  setPending(true);let saved=false;
  try{await run(fn);saved=true;await refresh();toast(message);return true;}
  catch(e){toast((saved?"Guardado, pero no se pudo recargar: ":"")+(e instanceof Error?e.message:String(e)));if(!saved)try{await refresh();}catch{}return false;}
  finally{setPending(false);}
 };
 return {pending,action};
}
export function NeedPatient({children,complete=false,body=false}:{children:ReactNode;complete?:boolean;body?:boolean}){
 const {patient}=useStore(),{selected,busy,error}=useConnection();
 if(busy)return <Panel>Consultando expedientes en PostgreSQL…</Panel>;
 if(error)return <Panel>{error}</Panel>;
 if(!selected||!patient)return <Panel title="Sin expediente seleccionado"><Link className="text-cyan-300" to="/app/expedientes">Crear o seleccionar expediente</Link></Panel>;
 if(selected.profile.status!=="active")return <Panel title="Expediente no activo">Los expedientes archivados o restringidos no se utilizan para simulación o captura.</Panel>;
 if((complete||body)&&(!["male","female"].includes(selected.profile.sex||"")||![patient.peso,patient.altura,...(complete?[patient.grasa,patient.musculo]:[])].every(Number.isFinite)))return <Panel title="Completa los datos corporales"><p className="mb-3 text-sm text-slate-400">{complete?"Registra peso, estatura, grasa corporal y masa muscular observada mediante instrumento.":"Registra peso y estatura antes de abrir el modelo personalizado."}</p><Link to="/app/mediciones" className="text-cyan-300">Registrar mediciones</Link></Panel>;
 return <>{children}</>;
}
export function ConnectedProfiles(){
 const {records,refresh}=useConnection(),{select,toast}=useStore(),nav=useNavigate(),{pending,action}=useAction();
 const [open,setOpen]=useState(false),[edit,setEdit]=useState<Profile|null>(null),[archive,setArchive]=useState<Profile|null>(null),[name,setName]=useState(""),[year,setYear]=useState(1990),[sex,setSex]=useState("male"),[query,setQuery]=useState("");
 const [photo,setPhoto]=useState<File|null>(null),[confirmed,setConfirmed]=useState(false),[weight,setWeight]=useState(""),[height,setHeight]=useState("");
 const begin=(p?:Profile)=>{setEdit(p||null);setName(p?.display_name||"");setYear(p?.birth_year||1990);setSex(p?.sex||"male");setPhoto(null);setConfirmed(false);setWeight("");setHeight("");setOpen(true);};
 const submit=async()=>{if(!name.trim()||year<1900||year>new Date().getFullYear()){toast("Revisa los datos del expediente");return;}
  if(photo&&!confirmed){toast("Confirma que la fotografía es ficticia");return;}
  if(!edit&&((weight&&(!Number.isFinite(+weight)||+weight<20||+weight>500))||(height&&(!Number.isFinite(+height)||+height<50||+height>250)))){toast("Revisa peso y estatura");return;}
  let created:Profile|undefined;
  const success=await action(async t=>{
   if(edit){await request("/profiles/"+edit.id,t,json("PATCH",{display_name:name.trim()}));return;}
   // Validate/encode before creating the profile; retain its ID if an optional write fails.
   if(photo)await syntheticPng(photo);
   created=await request<Profile>("/profiles",t,json("POST",{display_name:name.trim(),birth_year:year,sex}));
   const at=new Date().toISOString();
   for(const [metric_code,value,unit] of [["weight",weight,"kg"],["height",height,"cm"]]){
    if(value)await saveObservation(t,created.id,{metric_code,value:+value,unit,measured_at:at,method:"manual"});
   }
   if(photo)await uploadPhoto(t,created.id,photo);
  },edit?"Expediente actualizado":"Expediente creado");
  if(created){select(created.id);setOpen(false);if(!success)toast("El expediente ya existe. Completa los datos pendientes desde Mediciones o Captura corporal.");}
  else if(success)setOpen(false);
 };
 return <div><PageHead title="Expedientes" sub={records.length+" expedientes de tu cuenta de pruebas"} actions={<><Btn onClick={()=>void refresh().catch(()=>{})}><RefreshCw size={16}/> Actualizar</Btn><Btn variant="primary" onClick={()=>begin()}><Plus size={16}/> Nuevo expediente</Btn></>}/>
 <Panel><input className="field mb-4" placeholder="Buscar expediente" value={query} onChange={e=>setQuery(e.target.value)}/><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-slate-400"><tr><th>Paciente</th><th>Código</th><th>Edad aprox.</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{records.filter(r=>(r.profile.display_name+" "+r.profile.display_code).toLowerCase().includes(query.toLowerCase())).map(({profile:p,photo})=><tr key={p.id} className="border-t border-white/10 [&>td]:py-3"><td><button className="flex items-center gap-2 text-cyan-300" onClick={()=>{select(p.id);nav("/app/vision-3d");}}>{photo&&<img src={photo} className="h-9 w-9 rounded-full object-cover" alt="Foto ficticia"/>}{p.display_name||p.display_code}</button></td><td>{p.display_code}</td><td>{new Date().getFullYear()-p.birth_year}</td><td><Badge tone={p.status==="active"?"ok":"muted"}>{p.status==="active"?"Activo":p.status==="restricted"?"Restringido":"Archivado"}</Badge></td><td><div className="flex gap-2">{p.status==="active"&&<><Btn onClick={()=>begin(p)}><Pencil size={14}/> Editar</Btn><Btn variant="danger" onClick={()=>setArchive(p)}><Archive size={14}/> Archivar</Btn><Btn onClick={()=>{select(p.id);nav("/app/mediciones");}}>Mediciones</Btn></>}</div></td></tr>)}</tbody></table>{!records.length&&<p className="py-8 text-center text-slate-400">No tienes expedientes. Crea uno para comenzar.</p>}</div></Panel>
 <Modal open={open} onClose={()=>setOpen(false)} title={edit?"Editar expediente":"Nuevo expediente"}><div className="space-y-3"><label className="block">Nombre ficticio<input className="field" maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><label className="block">Año de nacimiento<input className="field" type="number" disabled={!!edit} value={year} onChange={e=>setYear(+e.target.value)}/></label><label className="block">Sexo<select className="field" disabled={!!edit} value={sex} onChange={e=>setSex(e.target.value)}><option value="male">Hombre</option><option value="female">Mujer</option><option value="other">Otro</option></select></label>{!edit&&<><div className="grid grid-cols-2 gap-3"><label>Peso (kg)<input type="number" className="field" step=".01" value={weight} onChange={e=>setWeight(e.target.value)}/></label><label>Altura (cm)<input type="number" className="field" step=".01" value={height} onChange={e=>setHeight(e.target.value)}/></label></div><label className="block">Fotografía ficticia (opcional)<input className="field" type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>setPhoto(e.target.files?.[0]||null)}/></label>{photo&&<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo que la imagen es ficticia.</label>}</>}<p className="text-xs text-slate-400">Grasa y masa muscular se registran como observaciones instrumentales en Mediciones. Solo datos ficticios.</p><Btn variant="primary" disabled={pending} onClick={submit}>Guardar</Btn></div></Modal>
 <Modal open={!!archive} onClose={()=>setArchive(null)} title="Archivar expediente"><p className="text-sm">Se conservará el historial de {archive?.display_name}; no se permite borrado físico.</p><Btn variant="danger" disabled={pending} onClick={async()=>{if(archive&&await action(t=>request("/profiles/"+archive.id+"/archive",t,json("POST",{})),"Expediente archivado"))setArchive(null);}}>Confirmar archivado</Btn></Modal></div>;
}
export function ConnectedMeasurements(){
 const {selected}=useConnection();return <NeedPatient><MeasurementForm key={selected?.profile.id}/></NeedPatient>;
}
function MeasurementForm(){
 const {selected,catalog}=useConnection(),{toast}=useStore(),{pending,action}=useAction();
 const [code,setCode]=useState(catalog[0]?.code||"weight"),[value,setValue]=useState(""),[instrument,setInstrument]=useState(""),[editing,setEditing]=useState<Observation|null>(null),[reason,setReason]=useState("");
 const metric=catalog.find(m=>m.code===code);
 const reset=()=>{setEditing(null);setValue("");setInstrument("");setReason("");};
 const submit=async()=>{if(!selected||!metric||!value.trim()||!Number.isFinite(+value)||+value<metric.min_value||+value>metric.max_value){toast("Valor fuera del rango autorizado");return;}
 const device=metric.allowed_methods.includes("device")&&!metric.allowed_methods.includes("manual");
 if(device&&!instrument.trim()){toast("Indica el instrumento de medición observado");return;}
 if(editing&&reason.trim().length<5){toast("Indica el motivo de la corrección");return;}
 const body={metric_code:code,value:+value,unit:metric.unit,method:device?"device":"manual",instrument:instrument.trim()||null,measured_at:editing?.measured_at||new Date().toISOString(),...(editing?{correction_reason:reason.trim()}: {})};
 if(await action(t=>saveObservation(t,selected.profile.id,body,editing?.id),editing?"Corrección registrada":"Medición guardada"))reset();
 };
 return <div><PageHead title="Mediciones" sub={selected?.profile.display_name||selected?.profile.display_code}/><div className="grid gap-5 xl:grid-cols-[350px_1fr]"><Panel title={editing?"Corregir medición":"Nueva medición"}><div className="space-y-3"><label className="block">Variable<select className="field" disabled={!!editing} value={code} onChange={e=>{setCode(e.target.value);setValue("");}}>{catalog.map(m=><option key={m.code} value={m.code}>{m.label} ({m.unit})</option>)}</select></label><label className="block">Valor ({metric?.unit})<input className="field" type="number" step=".01" value={value} onChange={e=>setValue(e.target.value)}/></label><label className="block">Instrumento<input className="field" value={instrument} maxLength={100} onChange={e=>setInstrument(e.target.value)}/></label>{editing&&<label className="block">Motivo<input className="field" value={reason} onChange={e=>setReason(e.target.value)}/></label>}<Btn variant="primary" disabled={pending} onClick={submit}>Guardar</Btn>{editing&&<Btn onClick={reset}>Cancelar</Btn>}</div></Panel><Panel title="Historial de mediciones vigentes"><div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr className="text-slate-400"><th>Variable</th><th>Valor</th><th>Fecha</th><th>Acción</th></tr></thead><tbody>{selected?.observations.map(o=><tr key={o.id} className="border-t border-white/10 [&>td]:py-3"><td>{catalog.find(m=>m.code===o.metric_code)?.label||o.metric_code}</td><td>{o.value} {o.unit}</td><td>{new Date(o.measured_at).toLocaleDateString("es-PE")}</td><td><Btn onClick={()=>{setEditing(o);setCode(o.metric_code);setValue(String(o.value));setInstrument(o.instrument||"");}}><Pencil size={14}/> Corregir</Btn></td></tr>)}</tbody></table>{!selected?.observations.length&&<p className="py-8 text-slate-400">Sin mediciones registradas.</p>}</div></Panel></div></div>;
}
export function ConnectedCaptures(){const {selected}=useConnection();return <NeedPatient><CaptureForm key={selected?.profile.id}/></NeedPatient>;}
function CaptureForm(){
 const {selected,run}=useConnection(),{toast,patient}=useStore(),{pending,action}=useAction();
 const [file,setFile]=useState<File|null>(null),[confirmed,setConfirmed]=useState(false),[preview,setPreview]=useState<string|undefined>(),[remove,setRemove]=useState<Capture|null>(null);
 const upload=async()=>{if(!file||!selected||!confirmed)return;if(await action(t=>uploadPhoto(t,selected.profile.id,file),"Imagen cifrada registrada")){setFile(null);setConfirmed(false);setPreview(undefined);}};
 return <div><PageHead title="Captura corporal" sub={"Fotografías del expediente · "+patient.nombre}/><div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
 <Panel pad={false}><div className="relative grid h-[600px] place-items-center overflow-hidden rounded-2xl bg-black">{(preview||selected?.photo)?<img src={preview||selected?.photo} alt="Fotografía ficticia" className="h-full w-full object-contain"/>:<div className="text-center text-slate-400"><Upload className="mx-auto mb-3" size={32}/>Sin fotografía registrada</div>}<div className="absolute left-4 top-4 rounded-lg bg-black/60 px-3 py-2 text-xs text-cyan-300">{patient.nombre}</div></div></Panel>
 <div className="space-y-5"><Panel title="Subir fotografía"><input type="file" accept="image/jpeg,image/png,image/webp" className="field" onChange={e=>setFile(e.target.files?.[0]||null)}/><p className="my-3 text-xs text-slate-400">JPG, PNG o WEBP. Se convierte a PNG sin metadatos; almacenamiento cifrado temporal.</p><label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo que es una imagen ficticia.</label><Btn variant="primary" className="mt-3 w-full" disabled={!file||!confirmed||pending} onClick={upload}><Upload size={16}/> Guardar fotografía</Btn></Panel>
 <Panel title="Fotografías registradas">{selected?.captures.map(c=><div key={c.id} className="flex flex-wrap items-center gap-2 border-b border-white/10 py-3"><span className="flex-1 text-xs">{new Date(c.created_at).toLocaleString("es-PE")} · vence {new Date(c.expires_at).toLocaleDateString("es-PE")}</span><Btn onClick={async()=>{try{setPreview(await run(t=>image("/profiles/"+selected.profile.id+"/captures/"+c.id,t)));}catch(e){toast(String(e));}}}>Ver</Btn><Btn variant="danger" onClick={()=>setRemove(c)}><Trash2 size={14}/></Btn></div>)}{!selected?.captures.length&&<p className="text-sm text-slate-400">Sin fotografías registradas.</p>}</Panel></div></div>
 <Modal open={!!remove} onClose={()=>setRemove(null)} title="Eliminar fotografía"><p>¿Eliminar la imagen seleccionada?</p><div className="mt-4 flex justify-end gap-2"><Btn onClick={()=>setRemove(null)}>Cancelar</Btn><Btn variant="danger" disabled={pending} onClick={async()=>{if(remove&&selected&&await action(t=>request("/profiles/"+selected.profile.id+"/captures/"+remove.id,t,{method:"DELETE"}),"Fotografía eliminada")){setRemove(null);setPreview(undefined);}}}>Eliminar</Btn></div></Modal></div>;
}
export function ConnectedReports(){const {selected,catalog}=useConnection();return <NeedPatient><PageHead title="Reportes" sub="Exportación de mediciones de tu expediente"/><Panel title="Historial observado"><Btn disabled={!selected?.observations.length} onClick={()=>{if(!selected)return;const rows=[["Variable","Valor","Unidad","Fecha"],...selected.observations.map(o=>[catalog.find(m=>m.code===o.metric_code)?.label||o.metric_code,o.value,o.unit,o.measured_at])];const csv=rows.map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")).join("\n");const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="bodyvision-mediciones.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}><Download size={16}/> Exportar CSV</Btn><p className="mt-3 text-sm text-slate-400">La generación y conservación de reportes oficiales del servidor requiere el entorno privado autorizado.</p></Panel></NeedPatient>;}
export function ConnectedAnalytics(){const {records}=useConnection();return <div><PageHead title="Analítica" sub="Registros de tu cuenta de pruebas"/><div className="grid gap-4 md:grid-cols-3">{[["Expedientes",records.length],["Activos",records.filter(r=>r.profile.status==="active").length],["Mediciones vigentes",records.reduce((n,r)=>n+r.observations.length,0)]].map(([label,value])=><Panel key={label} title={label}><div className="text-3xl font-bold text-cyan-300">{value}</div></Panel>)}</div></div>;}
export function Unavailable({title}:{title:string}){return <div><PageHead title={title}/><Panel title="No habilitado en el entorno de pruebas"><p className="text-sm text-slate-400">La API actual reserva estas operaciones para el entorno privado. No se simularán permisos, firmas ni cambios administrativos.</p></Panel></div>;}

export function ConnectedHome(){const {records}=useConnection();return <div><PageHead title="Dashboard" sub="Resumen de tu espacio de pruebas"/><div className="grid gap-4 sm:grid-cols-3">{[["Expedientes",records.length],["Activos",records.filter(r=>r.profile.status==="active").length],["Observaciones",records.reduce((n,r)=>n+r.observations.length,0)]].map(([label,value])=><Panel key={label} title={label}><div className="text-3xl font-bold text-cyan-300">{value}</div></Panel>)}</div><Panel title="Expedientes" className="mt-5"><Link className="text-cyan-300" to="/app/expedientes">Crear o consultar expedientes</Link></Panel></div>;}
