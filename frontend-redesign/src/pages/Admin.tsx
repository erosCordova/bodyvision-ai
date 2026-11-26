import { useState,useEffect } from "react";
import { Download, FileText, Plus, ShieldCheck, Trash2, Pencil } from "lucide-react";
import { Avatar, Badge, Btn, Modal, PageHead, Panel, Segmented, Toggle } from "../ui";
import { useStore, type Consent, type ReportRecord } from "../store";

import {useConnection} from "../ConnectedProvider";
import {request,json,type Role,type Account} from "../api";

const tone = (e: Consent["estado"]) => (e === "Vigente" ? "ok" : e === "Pendiente" ? "warn" : e === "Por vencer" ? "info" : "bad");

export function Consentimientos() {
  const { consents, setConsents, toast, patients } = useStore();
  const [open, setOpen] = useState(false);
  const [pac, setPac] = useState(patients[0]?.id||"");
  const [tipo, setTipo] = useState("Tratamiento de imágenes corporales");
  const [editing,setEditing]=useState<Consent|null>(null);
  const [removing,setRemoving]=useState<Consent|null>(null);
  const types=["Tratamiento de imágenes corporales","Reconstrucción 3D","Uso de IA en análisis","Compartir con especialista"];
  const begin=()=>{setEditing(null);setPac((patients[0]?.id||""));setTipo(types[0]);setOpen(true);};
  const edit=(c:Consent)=>{setEditing(c);setPac(c.patientId??patients[0].id);setTipo(c.tipo);setOpen(true);};
  const add=()=>{
    const p=patients.find(p=>p.id===pac);if(!p)return;
    if(editing&&editing.estado!=="Pendiente")return;
    const next:Consent=editing?{...editing,patientId:p.id,paciente:p.nombre,tipo}:{id:"CON-"+crypto.randomUUID().slice(0,8),patientId:p.id,paciente:p.nombre,tipo,fecha:new Date().toLocaleDateString("es-PE"),vigencia:"Sin firma",estado:"Pendiente"};
    if(setConsents(editing?consents.map(c=>c.id===editing.id?next:c):[next,...consents])){setOpen(false);toast(editing?"Solicitud actualizada":"Solicitud registrada");}
  };
  const remove=()=>{if(!removing)return;const pending=removing.estado==="Pendiente";const next=pending?consents.filter(c=>c.id!==removing.id):consents.map(c=>c.id===removing.id?{...c,estado:"Revocado" as const}:c);if(setConsents(next)){setRemoving(null);toast(pending?"Solicitud eliminada":"Consentimiento revocado");}};
  const count = (e: string) => consents.filter((c) => c.estado === e).length;
  return (
    <div>
      <PageHead title="Consentimientos" sub="Gestión de consentimientos informados y tratamiento de datos biométricos" actions={<Btn variant="primary" disabled title="Operación no habilitada en el servidor de pruebas" onClick={begin}><Plus size={16} /> Solicitar firma</Btn>} />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {(["Vigente", "Pendiente", "Por vencer", "Revocado"] as const).map((e) => (
          <div key={e} className="panel p-4"><Badge tone={tone(e)}>{e}</Badge><div className="mt-2 font-display text-3xl font-bold text-white">—</div></div>
        ))}
      </div>
      <Panel pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>Paciente</th><th>Tipo</th><th>Fecha</th><th>Vigencia</th><th>Estado</th><th className="text-right">Acciones</th></tr></thead>
            <tbody>
              {!consents.length&&<tr><td colSpan={6} className="py-12 text-center text-slate-400">Consentimientos no disponibles en este entorno</td></tr>}
              {consents.map((c) => (
                <tr key={c.id} className="border-t border-white/5 hover:bg-white/[0.03] [&>td]:px-4 [&>td]:py-3">
                  <td><div className="flex items-center gap-3"><Avatar name={c.paciente} size={30} /><span className="font-medium text-white">{c.paciente}</span></div></td>
                  <td className="text-slate-300">{c.tipo}</td><td className="text-slate-400">{c.fecha}</td><td className="text-slate-400">{c.vigencia}</td>
                  <td><Badge tone={tone(c.estado)}>{c.estado}</Badge></td>
                  <td className="text-right"><div className="flex justify-end gap-2">{c.estado==="Pendiente"&&<button title="Editar solicitud" className="p-2 text-cyan-300" onClick={()=>edit(c)}><Pencil size={16}/></button>}{c.estado!=="Revocado"&&<button className="rounded-lg px-2 py-1 text-xs text-rose-300" onClick={()=>setRemoving(c)}>{c.estado==="Pendiente"?"Eliminar":"Revocar"}</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-slate-300"><ShieldCheck className="mt-0.5 shrink-0 text-cyan-300" size={18} />El servidor de pruebas no habilita la gestión de consentimientos. </div>
      <Modal open={open} onClose={() => setOpen(false)} title={editing?"Editar solicitud":"Solicitar consentimiento"}>
        <div className="space-y-4">
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Paciente</span><select className="field" value={pac} onChange={(e) => setPac(e.target.value)}>{patients.map((p) => <option key={p.id} value={p.id} className="bg-slate-900">{p.nombre}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Tipo</span><select className="field" value={tipo} onChange={(e) => setTipo(e.target.value)}>{["Tratamiento de imágenes corporales", "Reconstrucción 3D", "Uso de IA en análisis", "Compartir con especialista"].map((t) => <option key={t} className="bg-slate-900">{t}</option>)}</select></label>
          <Btn variant="primary" className="w-full" onClick={add}>{editing?"Guardar cambios":"Registrar solicitud"}</Btn>
        </div>
      </Modal>
      <Modal open={!!removing} onClose={()=>setRemoving(null)} title={removing?.estado==="Pendiente"?"Eliminar solicitud":"Revocar consentimiento"}><p className="text-sm text-slate-300">Confirma la acción para {removing?.paciente}.</p><div className="mt-5 flex justify-end gap-2"><Btn onClick={()=>setRemoving(null)}>Cancelar</Btn><Btn variant="danger" onClick={remove}>Confirmar</Btn></div></Modal>
    </div>
  );
}

const TEMPLATES = [
  ["Informe de composición corporal","Datos de composición del expediente seleccionado."],
  ["Evolución del paciente","Mediciones registradas del expediente seleccionado."],
  ["Consentimientos del paciente","Estado de solicitudes vinculadas al expediente."],
];
export function Reportes(){
  const {patient}=useStore();
  return <PatientReports key={patient.id}/>;
}
function PatientReports(){
  const {toast,mediciones,patient,consents}=useStore();
  const [reports,setReports]=useState<ReportRecord[]>([]);
  const {selected,catalog}=useConnection();
  const [open,setOpen]=useState(false);
  const [tpl,setTpl]=useState(TEMPLATES[0][0]);
  const [removing,setRemoving]=useState<ReportRecord|null>(null);
  const [view,setView]=useState<ReportRecord|null>(null);
  const records=reports.filter(r=>r.patientId===patient.id);
  const gen=()=>{
    if(tpl===TEMPLATES[2][0])return toast("Consentimientos no habilitados en el servidor");
    const ms=selected?.observations||[];
    const title=tpl+" · "+patient.nombre;
    const content=["BODYVISION AI · Informe de registros",title,"Expediente: "+patient.id,"Edad aproximada: "+patient.edad+" años",...ms.filter(o=>tpl===TEMPLATES[1][0]||["weight","height","body_fat_pct","muscle_mass_kg"].includes(o.metric_code)).map(o=>(catalog.find(m=>m.code===o.metric_code)?.label||o.metric_code)+" · "+o.value+" "+o.unit+" · "+o.measured_at)].join("\n");
    const report:ReportRecord={id:crypto.randomUUID(),patientId:patient.id,title,date:new Date().toLocaleString("es-PE"),content};
    setReports([report,...reports]);setOpen(false);toast("Reporte generado para descarga local");
  };
  const dl=(r:ReportRecord)=>{const url=URL.createObjectURL(new Blob([r.content],{type:"text/plain;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="bodyvision-"+r.id+".txt";a.click();URL.revokeObjectURL(url);};
  return <div>
    <PageHead title="Reportes" sub={patient.nombre+" · informes de la sesión"} actions={<Btn variant="primary" onClick={()=>setOpen(true)}><Plus size={16}/> Generar reporte</Btn>}/>
    <div className="mb-6 grid gap-4 md:grid-cols-3">{TEMPLATES.map(([t,d])=><button key={t} disabled={t===TEMPLATES[2][0]} onClick={()=>{setTpl(t);setOpen(true);}} className="panel p-5 text-left hover:border-cyan-400/40"><FileText className="mb-3 text-cyan-300"/><div className="font-semibold text-white">{t}</div><div className="mt-1 text-sm text-slate-400">{d}</div></button>)}</div>
    <Panel title="Reportes generados"><ul className="divide-y divide-white/5">{records.map(r=><li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm"><FileText size={18} className="text-sky-300"/><div className="flex-1"><button className="text-left text-white hover:text-cyan-300" onClick={()=>setView(r)}>{r.title}</button><div className="text-xs text-slate-500">{r.date}</div></div><Btn onClick={()=>dl(r)}><Download size={15}/> Descargar</Btn><button title="Eliminar reporte" className="p-2 text-rose-300" onClick={()=>setRemoving(r)}><Trash2 size={16}/></button></li>)}</ul>{!records.length&&<p className="py-8 text-center text-slate-400">Sin reportes de este expediente</p>}</Panel>
    <Modal open={open} onClose={()=>setOpen(false)} title="Generar reporte"><div className="space-y-4"><select className="field" value={tpl} onChange={e=>setTpl(e.target.value)}>{TEMPLATES.map(([t])=><option key={t} disabled={t===TEMPLATES[2][0]}>{t}</option>)}</select><p className="text-sm text-slate-300">Paciente: {patient.nombre}. Se generará una copia descargable de los datos del servidor. No se guarda en PostgreSQL.</p><Btn variant="primary" className="w-full" onClick={gen}>Generar</Btn></div></Modal>
    <Modal open={!!view} onClose={()=>setView(null)} title="Consultar reporte" wide><pre className="whitespace-pre-wrap text-sm text-slate-300">{view?.content}</pre></Modal>
    <Modal open={!!removing} onClose={()=>setRemoving(null)} title="Eliminar reporte"><p className="text-sm text-slate-300">¿Eliminar {removing?.title}?</p><div className="mt-5 flex justify-end gap-2"><Btn onClick={()=>setRemoving(null)}>Cancelar</Btn><Btn variant="danger" onClick={()=>{if(removing){setReports(reports.filter(r=>r.id!==removing.id));setRemoving(null);toast("Reporte local eliminado");}}}>Eliminar</Btn></div></Modal>
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
  const createAccount=async()=>{setAccountError("");if(!form.display_name.trim()||!/^\\S+@\\S+\\.\\S+$/.test(form.email)||form.password.length<12){setAccountError("Completa nombre, correo y contraseña de al menos 12 caracteres.");return;}setSaving(true);try{await run(t=>request("/auth/admin/users",t,json("POST",form)));setAccountOpen(false);setForm({display_name:"",email:"",password:"",role:"specialist"});toast("Cuenta creada");await loadUsers();}catch(e){setAccountError(e instanceof Error?e.message:String(e));}finally{setSaving(false);}};
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
