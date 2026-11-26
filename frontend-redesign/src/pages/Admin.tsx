import { useState,useEffect } from "react";
import { Download, FileText, Plus, ShieldCheck, Trash2, Pencil } from "lucide-react";
import { Avatar, Badge, Btn, Modal, PageHead, Panel, Segmented, Toggle } from "../ui";
import { useStore } from "../store";

import {useConnection} from "../ConnectedProvider";
import {request,json,type Role,type Account} from "../api";
import {downloadReportPdf,type ReportTable} from "../reportPdf";

const purposes={images:"Tratamiento de imágenes corporales",reconstruction:"Reconstrucción 3D",analysis:"Uso de IA en análisis",sharing:"Compartir con especialista",camera:"Captura anatómica por cámara"};
type Purpose=keyof typeof purposes;
type State="active"|"pending"|"expiring"|"revoked"|"expired";
type ConsentRow={id:string;profile_id:string;patient_name:string;purpose:Purpose;state:State;created_at:string;accepted_at:string|null;expires_at:string|null;revoked_at:string|null};
const states:Record<State,{label:string;tone:"ok"|"warn"|"info"|"bad"}>={active:{label:"Vigente",tone:"ok"},pending:{label:"Pendiente",tone:"warn"},expiring:{label:"Por vencer",tone:"info"},revoked:{label:"Revocado",tone:"bad"},expired:{label:"Vencido",tone:"bad"}};
const dateLabel=(v:string|null)=>v?new Date(v).toLocaleDateString("es-PE",{timeZone:"America/Lima"}):"—";
export function Consentimientos(){
 const {patients,selectedId,toast}=useStore(),{run,role,token,records}=useConnection();
 const [items,setItems]=useState<ConsentRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(""),[open,setOpen]=useState(false),[pac,setPac]=useState(""),[purpose,setPurpose]=useState<Purpose>("images"),[saving,setSaving]=useState(false),[action,setAction]=useState<{row:ConsentRow;kind:"accept"|"revoke"}|null>(null),[confirmed,setConfirmed]=useState(false),[filter,setFilter]=useState<State|"all">("all");
 const writable=role==="administrator"||role==="specialist";
 const active=patients.filter(p=>records.some(r=>r.profile.id===p.id&&r.profile.status==="active"));
 const reload=async()=>{setLoading(true);setError("");try{const result=await run(t=>request<{items:ConsentRow[]}>("/sandbox/consents",t));setItems(result.items);}catch(e){setError(e instanceof Error?e.message:"No se pudieron consultar los consentimientos.");}finally{setLoading(false);}};
 useEffect(()=>{if(token)void reload();else{setItems([]);setLoading(false);}},[token]);
 const create=async()=>{if(!pac||saving)return;setSaving(true);try{await run(t=>request("/sandbox/consents",t,json("POST",{profile_id:pac,purpose})));setOpen(false);await reload();toast("Solicitud registrada");}catch(e){toast(e instanceof Error?e.message:"No se pudo registrar");}finally{setSaving(false);}};
 const change=async()=>{if(!action||!confirmed||saving)return;setSaving(true);try{await run(t=>request("/sandbox/consents/"+action.row.id,t,json("PATCH",{action:action.kind,confirmed:true})));toast(action.kind==="accept"?"Consentimiento registrado":"Consentimiento revocado");setAction(null);await reload();}catch(e){toast(e instanceof Error?e.message:"No se pudo actualizar");}finally{setSaving(false);}};
 const begin=()=>{setPac(active.some(p=>p.id===selectedId)?selectedId:active[0]?.id||"");setPurpose("images");setOpen(true);};
 const shown=items.filter(c=>filter==="all"||c.state===filter);
 return <div>
 <PageHead title="Consentimientos" sub="Gestión de consentimientos por expediente" actions={<Btn variant="primary" disabled={!writable||!active.length||loading} onClick={begin}><Plus size={16}/> Solicitar consentimiento</Btn>}/>
 <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-5">{(Object.keys(states) as State[]).map(e=><button key={e} className={"panel p-4 text-left "+(filter===e?"!border-cyan-400/60":"")} onClick={()=>setFilter(filter===e?"all":e)}><Badge tone={states[e].tone}>{states[e].label}</Badge><div className="mt-2 font-display text-3xl font-bold text-white">{loading||error?"—":items.filter(c=>c.state===e).length}</div></button>)}</div>
 <Panel pad={false}><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>Paciente</th><th>Tipo</th><th>Fecha</th><th>Vigencia</th><th>Estado</th><th className="text-right">Acciones</th></tr></thead><tbody>
 {loading||error||!shown.length?<tr><td colSpan={6} className="py-10 text-center text-slate-400">{loading?"Cargando consentimientos…":error||"No hay solicitudes registradas"+(filter==="all"?"":" con este estado")}{error&&<Btn className="ml-3" onClick={reload}>Reintentar</Btn>}</td></tr>:shown.map(c=><tr key={c.id} className="border-t border-white/5 [&>td]:px-4 [&>td]:py-3"><td><div className="flex items-center gap-3"><Avatar name={c.patient_name} size={30}/><span className="font-medium text-white">{c.patient_name}</span></div></td><td>{purposes[c.purpose]}</td><td>{dateLabel(c.accepted_at||c.created_at)}</td><td>{dateLabel(c.expires_at)}</td><td><Badge tone={states[c.state].tone}>{states[c.state].label}</Badge></td><td><div className="flex justify-end gap-2">{writable&&c.state==="pending"&&active.some(p=>p.id===c.profile_id)&&<Btn onClick={()=>{setConfirmed(false);setAction({row:c,kind:"accept"});}}>Confirmar</Btn>}{writable&&c.state!=="revoked"&&<button className="text-xs text-rose-300" onClick={()=>{setConfirmed(false);setAction({row:c,kind:"revoke"});}}>{c.state==="pending"?"Cancelar":"Revocar"}</button>}</div></td></tr>)}
 </tbody></table></div></Panel>
 <Modal open={open} onClose={()=>setOpen(false)} title="Solicitar consentimiento"><div className="space-y-4"><label className="block">Paciente<select className="field mt-1" value={pac} onChange={e=>setPac(e.target.value)}>{active.map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label><label className="block">Finalidad<select className="field mt-1" value={purpose} onChange={e=>setPurpose(e.target.value as Purpose)}>{Object.entries(purposes).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><Btn variant="primary" className="w-full" disabled={!pac||saving} onClick={create}>Registrar solicitud</Btn></div></Modal>
 <Modal open={!!action} onClose={()=>setAction(null)} title={action?.kind==="accept"?"Confirmar consentimiento":"Revocar o cancelar solicitud"}>{action&&<div className="space-y-4"><p>{action.row.patient_name} · {purposes[action.row.purpose]}</p><label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{action.kind==="accept"?"Confirmo la autorización para la finalidad indicada.":"Confirmo la revocación o cancelación de esta solicitud."}</label>{action.kind==="accept"&&<p className="text-xs text-slate-400">Vigencia: 365 días · Sin firma legal</p>}<Btn disabled={!confirmed||saving} variant={action.kind==="accept"?"primary":"danger"} onClick={change}>Confirmar</Btn></div>}</Modal>
 </div>;
}

const TEMPLATES = [
  ["Informe de composición corporal","Últimas mediciones de composición corporal."],
  ["Evolución del paciente","Historial de mediciones registradas."],
  ["Medidas antropométricas","Medidas de segmentos corporales."],
  ["Informe general de pacientes","Resumen de todos los expedientes accesibles."],
];
type SavedReport=ReportTable&{id:string;patientId:string;date:string};
export function Reportes(){
  return <PatientReports/>;
}
function PatientReports(){
  const {toast,patient}=useStore(),{selected,catalog,records,busy}=useConnection();
  const [reports,setReports]=useState<SavedReport[]>([]),[tpl,setTpl]=useState(TEMPLATES[0][0]),[view,setView]=useState<SavedReport|null>(null),[removing,setRemoving]=useState<SavedReport|null>(null);
  const [open,setOpen]=useState(false);
  const composition=["weight","height","body_fat_pct","muscle_mass_kg"],segments=["waist","hip","chest","arm","thigh","neck"];
  const make=(template:string):SavedReport=>{
    if(template===TEMPLATES[3][0])return {id:crypto.randomUUID(),patientId:"all",title:template,patient:"Todos los pacientes",code:records.length+" expedientes",date:new Date().toLocaleString("es-PE"),columns:["Paciente","Expediente","Estado","Peso (kg)","Estatura (cm)","Grasa (%)","Músculo (kg)"],rows:records.map(r=>{const val=(code:string)=>{const o=r.observations.find(x=>x.metric_code===code);return o&&Number.isFinite(o.value)?new Intl.NumberFormat("es-PE",{maximumFractionDigits:2}).format(o.value):"—";};return [r.profile.display_name||r.profile.display_code,r.profile.display_code,{active:"Activo",restricted:"Restringido",archived:"Archivado"}[r.profile.status],val("weight"),val("height"),val("body_fat_pct"),val("muscle_mass_kg")];})};
    const ms=selected?.observations||[];
    const filtered=template===TEMPLATES[0][0]?ms.filter(o=>composition.includes(o.metric_code)).filter((o,i,a)=>a.findIndex(x=>x.metric_code===o.metric_code)===i):template===TEMPLATES[2][0]?ms.filter(o=>segments.includes(o.metric_code)):ms;
    return {id:crypto.randomUUID(),patientId:patient?.id||"",title:template,patient:patient?.nombre||"Sin paciente seleccionado",code:selected?.profile.display_code||"—",date:new Date().toLocaleString("es-PE"),columns:["Variable","Valor","Unidad","Fecha"],rows:filtered.map(o=>[catalog.find(m=>m.code===o.metric_code)?.label||o.metric_code,new Intl.NumberFormat("es-PE",{maximumFractionDigits:2}).format(o.value),o.unit,new Date(o.measured_at).toLocaleDateString("es-PE")])};
  };
  const preview=make(tpl);
  const table=(r:ReportTable)=><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr>{r.columns.map(c=><th key={c} className="px-3 py-3">{c}</th>)}</tr></thead><tbody>{r.rows.map((row,i)=><tr key={i} className="border-t border-white/5">{row.map((cell,j)=><td key={j} className="px-3 py-3">{cell}</td>)}</tr>)}{!r.rows.length&&<tr><td colSpan={r.columns.length} className="py-8 text-center text-slate-400">Sin datos registrados para este informe</td></tr>}</tbody></table></div>;
  const gen=()=>{if(!preview.rows.length)return toast("No hay mediciones para generar este reporte");setReports(r=>[preview,...r]);setOpen(false);setView(preview);toast("Reporte generado");};
  const dl=(r:SavedReport)=>{try{downloadReportPdf(r,"BodyVision-"+r.patient.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"-")+"-"+r.title.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-zA-Z0-9]+/g,"-")+"-"+new Date().toISOString().slice(0,10)+".pdf");}catch{toast("No se pudo generar el PDF");}};
  return <div>
    <PageHead title="Reportes" sub={preview.patient} actions={<Btn variant="primary" onClick={()=>setOpen(true)}><Plus size={16}/> Generar reporte</Btn>}/>
    <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">{TEMPLATES.map(([t,d])=><button key={t} onClick={()=>setTpl(t)} className={"panel p-5 text-left hover:border-cyan-400/40 "+(tpl===t?"!border-cyan-400/60":"")}><FileText className="mb-3 text-cyan-300"/><div className="font-semibold text-white">{t}</div><div className="mt-1 text-sm text-slate-400">{d}</div></button>)}</div>
    <Panel title={tpl+" · "+preview.patient} action={<Btn disabled={busy||!preview.rows.length} onClick={()=>dl(preview)}><Download size={15}/> Descargar PDF</Btn>}>{table(preview)}</Panel>
    <Panel className="mt-5" title="Reportes generados"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="py-3">Informe</th><th>Paciente</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody>{reports.map(r=><tr key={r.id} className="border-t border-white/5"><td className="py-3">{r.title}</td><td>{r.patient}</td><td>{r.date}</td><td><div className="flex flex-wrap gap-2"><Btn onClick={()=>setView(r)}>Ver</Btn><Btn onClick={()=>dl(r)}><Download size={15}/> PDF</Btn><button title="Eliminar reporte" className="p-2 text-rose-300" onClick={()=>setRemoving(r)}><Trash2 size={16}/></button></div></td></tr>)}{!reports.length&&<tr><td colSpan={4} className="py-8 text-center text-slate-400">Sin reportes generados en esta sesión</td></tr>}</tbody></table></div></Panel>
    <Modal open={open} onClose={()=>setOpen(false)} title="Generar reporte"><div className="space-y-4"><p className="text-sm text-slate-300">Paciente: {preview.patient}</p><select className="field" value={tpl} onChange={e=>setTpl(e.target.value)}>{TEMPLATES.map(([t])=><option key={t}>{t}</option>)}</select><Btn variant="primary" disabled={!preview.rows.length} className="w-full" onClick={gen}>Generar</Btn></div></Modal>
    <Modal open={!!view} onClose={()=>setView(null)} title={view?view.title+" · "+view.patient:"Consultar reporte"} wide>{view&&<><p className="mb-3 text-sm text-slate-300">Paciente: {view.patient} · {view.code}</p>{table(view)}<Btn className="mt-4" onClick={()=>dl(view)}><Download size={15}/> Descargar PDF</Btn></>}</Modal>
    <Modal open={!!removing} onClose={()=>setRemoving(null)} title="Eliminar reporte"><p className="text-sm text-slate-300">¿Eliminar {removing?.title} de esta sesión?</p><Btn className="mt-4" variant="danger" onClick={()=>{if(removing){setReports(r=>r.filter(x=>x.id!==removing.id));setRemoving(null);}}}>Eliminar</Btn></Modal>
  </div>;
}

export function Administracion() {
  const {patients,user}=useStore();
  const {token,role,run}=useConnection();
  const {toast}=useStore();
  const [accounts,setAccounts]=useState<Account[]>([]),[usersLoading,setUsersLoading]=useState(false),[accountOpen,setAccountOpen]=useState(false),[saving,setSaving]=useState(false),[accountError,setAccountError]=useState("");
  const [form,setForm]=useState({display_name:"",email:"",password:"",role:"specialist" as Role});
  const roles:Record<Role,string>={administrator:"Administrador",specialist:"Especialista",member:"Miembro (lectura)",privacy_officer:"Responsable de privacidad"};
  const loadUsers=async()=>{setUsersLoading(true);try{const result=await run(t=>request<{items:Account[]}>("/auth/admin/users",t));setAccounts(result.items);}catch(e){setAccountError(e instanceof Error?e.message:String(e));}finally{setUsersLoading(false);}};
  useEffect(()=>{if(token&&role==="administrator")void loadUsers();},[token,role]);
  const createAccount=async()=>{setAccountError("");if(!form.display_name.trim()||!/^\S+@\S+\.\S+$/.test(form.email)||form.password.length<12){setAccountError("Completa nombre, correo y contraseña de al menos 12 caracteres.");return;}setSaving(true);try{await run(t=>request("/auth/admin/users",t,json("POST",form)));setAccountOpen(false);setForm({display_name:"",email:"",password:"",role:"specialist"});toast("Cuenta creada");await loadUsers();}catch(e){setAccountError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}};
  const [tab,setTab]=useState<"u"|"s"|"i"|"a">("u");
  const [health,setHealth]=useState("Consultando");
  useEffect(()=>{let alive=true;request<{database:string}>("/health/ready").then(r=>{if(alive)setHealth(r.database==="connected"?"Operativa":"No verificada");}).catch(()=>{if(alive)setHealth("No disponible");});return()=>{alive=false;};},[]);

  const INTEGR=[["API FastAPI (Python)",health,"—"],["PostgreSQL",health,"—"],["MediaPipe Pose","No habilitado","—"],["Pipeline Maya 3D","Atlas local","—"],["Simulador IA","Visualización local","—"]];
  const AUDIT:string[]=[];
  const sec={twofa:false,ip:false,enc:false,timeout:true,audit:true};
  return (
    <div>
      <PageHead title="Administración" sub="Usuarios, seguridad, integraciones y auditoría" actions={<Segmented value={tab} onChange={setTab} options={[{ id: "u", label: "Usuarios" }, { id: "s", label: "Seguridad" }, { id: "i", label: "Integraciones" }, { id: "a", label: "Auditoría" }]} />} />
      {tab === "u" && (<>
        <div className="mb-4 flex justify-end"><Btn variant="primary" onClick={()=>{setAccountError("");setForm({display_name:"",email:"",password:"",role:"specialist"});setAccountOpen(true);}}><Plus size={16}/> Nuevo usuario</Btn></div>
        <Panel pad={false}><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead><tbody>
          {accounts.map(a=><tr key={a.user_id} className="border-t border-white/5 [&>td]:px-4 [&>td]:py-3"><td><div className="flex items-center gap-3"><Avatar name={a.display_name} size={32}/><span className="font-medium text-white">{a.display_name}</span></div></td><td>{a.email}</td><td>{roles[a.role]}</td><td><Badge tone="ok">Activo</Badge></td></tr>)}
          {!accounts.length&&<tr><td colSpan={4} className="py-8 text-center text-slate-400">{usersLoading?"Cargando usuarios…":"Sin usuarios disponibles"}</td></tr>}
        </tbody></table></div>{accountError&&!accountOpen&&<p className="p-3 text-sm text-rose-300">{accountError}</p>}<div className="border-t border-white/5 p-3 text-xs text-slate-500">{accounts.length} usuarios registrados.</div></Panel>
        <Modal open={accountOpen} onClose={()=>{if(!saving)setAccountOpen(false);}} title="Nuevo usuario"><div className="space-y-4">
          <label className="block text-sm">Nombre completo<input className="field mt-1" value={form.display_name} maxLength={100} onChange={e=>setForm({...form,display_name:e.target.value})}/></label>
          <label className="block text-sm">Correo electrónico<input type="email" className="field mt-1" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
          <label className="block text-sm">Contraseña inicial<input type="password" autoComplete="new-password" className="field mt-1" value={form.password} maxLength={128} onChange={e=>setForm({...form,password:e.target.value})}/><span className="text-xs text-slate-400">Mínimo 12 caracteres.</span></label>
          <label className="block text-sm">Tipo de usuario<select className="field mt-1" value={form.role} onChange={e=>setForm({...form,role:e.target.value as Role})}>{Object.entries(roles).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
          {accountError&&<p className="text-sm text-rose-300">{accountError}</p>}<div className="flex justify-end gap-2"><Btn disabled={saving} onClick={()=>setAccountOpen(false)}>Cancelar</Btn><Btn variant="primary" disabled={saving} onClick={createAccount}>{saving?"Guardando…":"Crear usuario"}</Btn></div>
        </div></Modal>
      </>)}
      {tab === "s" && (
        <Panel><div className="divide-y divide-white/5">
          {([["twofa", "Autenticación en dos pasos (2FA)", "No habilitada en este entorno"], ["ip", "Restricción por IP", "No disponible"], ["enc", "Cifrado de fotografías", "Configuración del servidor"], ["timeout", "Vigencia de sesión", "30 días renovables; cierre manual"], ["audit", "Registro de auditoría", "Todas las acciones se registran"]] as const).map(([k, t, d]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-4"><div><div className="font-medium text-white">{t}</div><div className="text-sm text-slate-400">{d}</div></div><Badge tone={k==="timeout"||k==="audit"?"info":"muted"}>{k==="timeout"||k==="audit"?"Servidor":"No configurable"}</Badge></div>
          ))}
        </div></Panel>
      )}
      {tab === "i" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{INTEGR.map(([n, s, l]) => (
          <div key={n} className="panel p-5"><div className="flex items-center justify-between"><div className="font-semibold text-white">{n}</div><Badge tone={s === "Operativa" ? "ok" : "warn"}>{s}</Badge></div><div className="mt-3 text-sm text-slate-400">Latencia: {l}</div></div>
        ))}</div>
      )}
      {tab === "a" && (
        <Panel><p className="text-sm text-slate-400">Consulta de auditoría no habilitada para esta cuenta.</p><ul className="space-y-3 text-sm">{AUDIT.map((a, i) => <li key={a} className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-cyan-300" /><span className="flex-1 text-slate-200">{a}</span><span className="text-xs text-slate-500">hace {i * 17 + 3} min</span></li>)}</ul></Panel>
      )}
    </div>
  );
}
