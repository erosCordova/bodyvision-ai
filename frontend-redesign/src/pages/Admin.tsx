import { useState } from "react";
import { Download, FileText, Plus, ShieldCheck } from "lucide-react";
import { Avatar, Badge, Btn, Modal, PageHead, Panel, Segmented, Toggle } from "../ui";
import { PATIENTS, useStore, type Consent } from "../store";

const tone = (e: Consent["estado"]) => (e === "Vigente" ? "ok" : e === "Pendiente" ? "warn" : e === "Por vencer" ? "info" : "bad");

export function Consentimientos() {
  const { consents, setConsents, toast, patients } = useStore();
  const [open, setOpen] = useState(false);
  const [pac, setPac] = useState(patients[0].nombre);
  const [tipo, setTipo] = useState("Tratamiento de imágenes corporales");
  const set = (id: string, estado: Consent["estado"]) => { setConsents(consents.map((c) => (c.id === id ? { ...c, estado } : c))); toast(`Consentimiento ${estado.toLowerCase()}`); };
  const add = () => {
    setConsents([{ id: `CON-${300 + consents.length}`, paciente: pac, tipo, fecha: "Hoy", vigencia: "En 12 meses", estado: "Pendiente" }, ...consents]);
    setOpen(false); toast("Solicitud de firma enviada");
  };
  const count = (e: string) => consents.filter((c) => c.estado === e).length;
  return (
    <div>
      <PageHead title="Consentimientos" sub="Gestión de consentimientos informados y tratamiento de datos biométricos" actions={<Btn variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> Solicitar firma</Btn>} />
      <div className="mb-5 grid grid-cols-2 gap-4 xl:grid-cols-4">
        {(["Vigente", "Pendiente", "Por vencer", "Revocado"] as const).map((e) => (
          <div key={e} className="panel p-4"><Badge tone={tone(e)}>{e}</Badge><div className="mt-2 font-display text-3xl font-bold text-white">{count(e)}</div></div>
        ))}
      </div>
      <Panel pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>Paciente</th><th>Tipo</th><th>Fecha</th><th>Vigencia</th><th>Estado</th><th className="text-right">Activo</th></tr></thead>
            <tbody>
              {consents.map((c) => (
                <tr key={c.id} className="border-t border-white/5 hover:bg-white/[0.03] [&>td]:px-4 [&>td]:py-3">
                  <td><div className="flex items-center gap-3"><Avatar name={c.paciente} size={30} /><span className="font-medium text-white">{c.paciente}</span></div></td>
                  <td className="text-slate-300">{c.tipo}</td><td className="text-slate-400">{c.fecha}</td><td className="text-slate-400">{c.vigencia}</td>
                  <td><Badge tone={tone(c.estado)}>{c.estado}</Badge></td>
                  <td className="text-right"><div className="inline-block"><Toggle checked={c.estado !== "Revocado"} onChange={(v) => set(c.id, v ? "Vigente" : "Revocado")} label="Consentimiento activo" /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-sm text-slate-300"><ShieldCheck className="mt-0.5 shrink-0 text-cyan-300" size={18} />Las imágenes y mallas 3D sólo se procesan con consentimiento vigente. La revocación elimina los datos biométricos en un máximo de 30 días (RGPD, art. 17).</div>
      <Modal open={open} onClose={() => setOpen(false)} title="Solicitar consentimiento">
        <div className="space-y-4">
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Paciente</span><select className="field" value={pac} onChange={(e) => setPac(e.target.value)}>{patients.map((p) => <option key={p.id} className="bg-slate-900">{p.nombre}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Tipo</span><select className="field" value={tipo} onChange={(e) => setTipo(e.target.value)}>{["Tratamiento de imágenes corporales", "Reconstrucción 3D", "Uso de IA en análisis", "Compartir con especialista"].map((t) => <option key={t} className="bg-slate-900">{t}</option>)}</select></label>
          <Btn variant="primary" className="w-full" onClick={add}>Enviar solicitud</Btn>
        </div>
      </Modal>
    </div>
  );
}

const TEMPLATES = [
  ["Informe de composición corporal", "Resumen clínico con mapa térmico y recomendaciones."],
  ["Evolución del paciente", "Comparativa de mediciones y modelo 3D por fecha."],
  ["Resumen de cohorte", "Indicadores agregados para dirección o auditoría."],
  ["Consentimientos vigentes", "Estado legal de todos los pacientes."],
];

export function Reportes() {
  const { toast, mediciones, patient } = useStore();
  const [open, setOpen] = useState(false);
  const [tpl, setTpl] = useState(TEMPLATES[0][0]);
  const [hist, setHist] = useState([{ n: "Informe de composición corporal · Carlos Ramírez", d: "Hace 2 h", s: "184 KB" }, { n: "Resumen de cohorte · Mayo", d: "Ayer", s: "312 KB" }]);
  const gen = () => { setHist([{ n: `${tpl} · ${patient.nombre}`, d: "Ahora", s: "210 KB" }, ...hist]); setOpen(false); toast("Reporte generado"); };
  const dl = (name: string) => {
    const txt = `BODYVISION AI · ${name}\nPaciente: ${patient.nombre}\nPeso: ${patient.peso} kg\nGrasa: ${patient.grasa}%\nMediciones registradas: ${mediciones.length}\n`;
    const url = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
    const a = document.createElement("a"); a.href = url; a.download = "reporte-bodyvision.txt"; a.click(); URL.revokeObjectURL(url);
    toast("Descarga iniciada");
  };
  return (
    <div>
      <PageHead title="Reportes" sub="Genera y descarga informes clínicos" actions={<Btn variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> Generar reporte</Btn>} />
      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TEMPLATES.map(([t, d]) => (
          <button key={t} onClick={() => { setTpl(t); setOpen(true); }} className="panel p-5 text-left transition hover:-translate-y-1 hover:border-cyan-400/40"><FileText className="mb-3 text-cyan-300" /><div className="font-semibold text-white">{t}</div><div className="mt-1 text-sm text-slate-400">{d}</div></button>
        ))}
      </div>
      <Panel title="Reportes generados">
        <ul className="divide-y divide-white/5">
          {hist.map((h) => (
            <li key={h.n + h.d} className="flex items-center gap-4 py-3.5 text-sm">
              <FileText size={18} className="text-sky-300" /><div className="flex-1"><div className="text-white">{h.n}</div><div className="text-xs text-slate-500">{h.d} · {h.s}</div></div>
              <Btn onClick={() => dl(h.n)}><Download size={15} /> Descargar</Btn>
            </li>
          ))}
        </ul>
      </Panel>
      <Modal open={open} onClose={() => setOpen(false)} title="Generar reporte">
        <div className="space-y-4">
          <label className="block"><span className="mb-1 block text-xs text-slate-400">Plantilla</span><select className="field" value={tpl} onChange={(e) => setTpl(e.target.value)}>{TEMPLATES.map(([t]) => <option key={t} className="bg-slate-900">{t}</option>)}</select></label>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">Paciente: <b className="text-white">{patient.nombre}</b> · incluye gráficos y vistas 3D.</div>
          <Btn variant="primary" className="w-full" onClick={gen}>Generar</Btn>
        </div>
      </Modal>
    </div>
  );
}

const USERS = [["Dr. Martínez", "Administrador", "Activo"], ["Dra. Salazar", "Especialista", "Activo"], ["Lic. Prieto", "Nutrición", "Activo"], ["Ana Torres", "Recepción", "Invitado"]];
const INTEGR = [["API FastAPI (Python)", "Operativa", "42 ms"], ["PostgreSQL", "Operativa", "8 ms"], ["MediaPipe Pose", "Operativa", "61 ms"], ["Pipeline Maya 3D", "Operativa", "—"], ["Simulador IA", "Mantenimiento", "—"]];
const AUDIT = ["Dr. Martínez inició sesión", "Se exportó mediciones.csv", "Consentimiento revocado · Sergio Vidal", "Nuevo expediente creado", "Reporte generado · Resumen de cohorte"];

export function Administracion() {
  const [tab, setTab] = useState<"u" | "s" | "i" | "a">("u");
  const [sec, setSec] = useState({ twofa: true, ip: false, enc: true, timeout: true, audit: true });
  return (
    <div>
      <PageHead title="Administración" sub="Usuarios, seguridad, integraciones y auditoría" actions={<Segmented value={tab} onChange={setTab} options={[{ id: "u", label: "Usuarios" }, { id: "s", label: "Seguridad" }, { id: "i", label: "Integraciones" }, { id: "a", label: "Auditoría" }]} />} />
      {tab === "u" && (
        <Panel pad={false}><table className="w-full text-left text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500"><tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>Usuario</th><th>Rol</th><th>Estado</th></tr></thead><tbody>
          {USERS.map(([n, r, s]) => <tr key={n} className="border-t border-white/5 [&>td]:px-4 [&>td]:py-3"><td><div className="flex items-center gap-3"><Avatar name={n} size={32} /><span className="font-medium text-white">{n}</span></div></td><td className="text-slate-300">{r}</td><td><Badge tone={s === "Activo" ? "ok" : "warn"}>{s}</Badge></td></tr>)}
        </tbody></table><div className="border-t border-white/5 p-3 text-xs text-slate-500">{PATIENTS.length} expedientes asociados a esta organización.</div></Panel>
      )}
      {tab === "s" && (
        <Panel><div className="divide-y divide-white/5">
          {([["twofa", "Autenticación en dos pasos (2FA)", "Obligatoria para todos los usuarios clínicos"], ["ip", "Restricción por IP", "Sólo redes de la clínica"], ["enc", "Cifrado AES-256 de datos biométricos", "Imágenes y mallas 3D"], ["timeout", "Cierre de sesión por inactividad", "15 minutos"], ["audit", "Registro de auditoría", "Todas las acciones se registran"]] as const).map(([k, t, d]) => (
            <div key={k} className="flex items-center justify-between gap-4 py-4"><div><div className="font-medium text-white">{t}</div><div className="text-sm text-slate-400">{d}</div></div><Toggle checked={sec[k]} onChange={(v) => setSec({ ...sec, [k]: v })} label={t} /></div>
          ))}
        </div></Panel>
      )}
      {tab === "i" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{INTEGR.map(([n, s, l]) => (
          <div key={n} className="panel p-5"><div className="flex items-center justify-between"><div className="font-semibold text-white">{n}</div><Badge tone={s === "Operativa" ? "ok" : "warn"}>{s}</Badge></div><div className="mt-3 text-sm text-slate-400">Latencia: {l}</div></div>
        ))}</div>
      )}
      {tab === "a" && (
        <Panel><ul className="space-y-3 text-sm">{AUDIT.map((a, i) => <li key={a} className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-cyan-300" /><span className="flex-1 text-slate-200">{a}</span><span className="text-xs text-slate-500">hace {i * 17 + 3} min</span></li>)}</ul></Panel>
      )}
    </div>
  );
}
