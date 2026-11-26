import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, Box, Plus, Search, SlidersHorizontal, Sparkles, ImagePlus, Pencil, Trash2 } from "lucide-react";
import { Avatar, Badge, Btn, Modal, PageHead, Panel, Segmented, chartTip, estadoTone } from "../ui";
import { bodyParams, historial, idealWeight, imcOf, useStore, type Patient } from "../store";
import { BodyScene } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";
import type { Sex } from "../three/assets";

export function Expedientes() {
  const nav = useNavigate();
  const { patients, addPatient, updatePatient, deletePatient, select, toast } = useStore();
  const [q, setQ] = useState("");
  const [sex, setSex] = useState<"all" | Sex>("all");
  const [estado, setEstado] = useState("Todos");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ nombre: "", edad: 30, sexo: "male" as Sex, altura: 175, peso: 75, grasa: 20, musculo: 38, objetivo: "Salud general" });

  const [editing, setEditing] = useState<Patient | null>(null);
  const [deleting, setDeleting] = useState<Patient | null>(null);
  const [status, setStatus] = useState<Patient["estado"]>("Nuevo");
  const [foto, setFoto] = useState<string | undefined>();
  const [reading, setReading] = useState(false);
  const photoRequest = useRef(0);
  const reset = () => {
    photoRequest.current++;
    setEditing(null); setStatus("Nuevo");
    setFoto(undefined);
    setReading(false);
    setF({ nombre: "", edad: 30, sexo: "male", altura: 175, peso: 75, grasa: 20, musculo: 38, objetivo: "Salud general" });
  };
  const edit = (p: Patient) => { reset(); setEditing(p); setStatus(p.estado); setF({nombre:p.nombre,edad:p.edad,sexo:p.sexo,altura:p.altura,peso:p.peso,grasa:p.grasa,musculo:p.musculo,objetivo:p.objetivo}); setFoto(p.foto); setOpen(true); };
  const close = () => { reset(); setOpen(false); };
  const pickPhoto = async (file?: File) => {
    const request = ++photoRequest.current;
    setReading(false);
    if (!file) return;
    if (!["image/jpeg","image/png","image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
      toast("Selecciona una imagen JPG, PNG o WEBP de hasta 10 MB");
      return;
    }
    setReading(true);
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("No se pudo leer la imagen");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", 0.8);
        if (photoRequest.current === request) setFoto(data);
      } finally { bitmap.close(); }
    } catch { if (photoRequest.current === request) toast("No se pudo abrir la imagen"); }
    finally { if (photoRequest.current === request) setReading(false); }
  };

  const list = useMemo(
    () => patients.filter((p) => (sex === "all" || p.sexo === sex) && (estado === "Todos" || p.estado === estado) && (p.nombre + p.id).toLowerCase().includes(q.toLowerCase())),
    [patients, q, sex, estado]
  );

  const create = () => {
    if (!f.nombre.trim()) return toast("Indica el nombre del paciente");
    if (reading) return;
    if (!Number.isInteger(f.edad) || f.edad < 18 || f.edad > 100) return toast("El atlas de demostración admite edades de 18 a 100 años");
    if (![f.altura, f.peso, f.grasa, f.musculo].every(Number.isFinite) || f.altura < 100 || f.altura > 230 || f.peso < 25 || f.peso > 350 || f.grasa < 0 || f.grasa > 70 || f.musculo < 0 || f.musculo > 100 || f.grasa + f.musculo > 100) return toast("Revisa las medidas corporales y los porcentajes");
    const record={...f,nombre:f.nombre.trim(),foto,estado:status};
    const saved=editing?updatePatient(editing.id,record):addPatient({...record,tono:"medio",email:"nuevo@correo.com"});
    if(!saved)return toast("No se pudo guardar el expediente");
    toast(editing?"Expediente actualizado":"Expediente creado correctamente");close();
  };

  return (
    <div>
      <PageHead
        title="Expedientes"
        sub={`${list.length} pacientes · selecciona uno para ver su gemelo digital`}
        actions={<Btn variant="primary" onClick={() => { reset(); setOpen(true); }}><Plus size={16} /> Nuevo expediente</Btn>}
      />
      <Panel pad={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-white/5 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="field pl-9" placeholder="Buscar por nombre o ID…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Segmented value={sex} onChange={setSex} options={[{ id: "all", label: "Todos" }, { id: "male", label: "Hombres" }, { id: "female", label: "Mujeres" }]} />
          <select className="field !w-auto" value={estado} onChange={(e) => setEstado(e.target.value)}>
            {["Todos", "Activo", "En seguimiento", "Nuevo", "Alta"].map((e) => <option key={e} className="bg-slate-900">{e}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-slate-500">
              <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium">
                <th>Paciente</th><th>ID</th><th>Edad</th><th>IMC</th><th>% Grasa</th><th>Objetivo</th><th>Estado</th><th>Última</th><th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const imc = imcOf(p.peso, p.altura);
                return (
                  <tr key={p.id} onClick={() => { select(p.id); nav(`/app/expedientes/${p.id}`); }} className="cursor-pointer border-t border-white/5 transition hover:bg-cyan-400/[0.04] [&>td]:px-4 [&>td]:py-3">
                    <td>
                      <div className="flex items-center gap-3">
                        <Avatar name={p.nombre} size={34} photo={p.foto} />
                        <div>
                          <div className="font-medium text-white">{p.nombre}</div>
                          <div className="text-xs text-slate-500">{p.sexo === "male" ? "Hombre" : "Mujer"} · {p.altura} cm · {p.peso} kg</div>
                        </div>
                      </div>
                    </td>
                    <td className="text-slate-400">{p.id}</td>
                    <td className="text-slate-300">{p.edad}</td>
                    <td><span className={imc >= 30 ? "text-rose-300" : imc >= 25 ? "text-amber-300" : "text-emerald-300"}>{imc.toFixed(1)}</span></td>
                    <td className="text-slate-300">{p.grasa}%</td>
                    <td className="text-slate-300">{p.objetivo}</td>
                    <td><Badge tone={estadoTone(p.estado)}>{p.estado}</Badge></td>
                    <td className="text-slate-500">{p.ultima}</td><td><div className="flex gap-2"><button type="button" title="Editar expediente" aria-label={`Editar ${p.nombre}`} className="rounded-lg p-2 text-cyan-300 hover:bg-white/10" onClick={e=>{e.stopPropagation();edit(p);}}><Pencil size={16}/></button><button type="button" title="Eliminar expediente" aria-label={`Eliminar ${p.nombre}`} className="rounded-lg p-2 text-rose-300 hover:bg-rose-500/10" onClick={e=>{e.stopPropagation();setDeleting(p);}}><Trash2 size={16}/></button></div></td>
                  </tr>
                );
              })}
              {!list.length && <tr><td colSpan={9} className="py-12 text-center text-slate-500">Sin resultados</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Modal open={open} onClose={close} title={editing?"Editar expediente":"Nuevo expediente"} wide>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 rounded-xl border border-white/10 p-3">
            <div className="flex items-center gap-4">
              {foto ? <img src={foto} alt="Vista previa de la fotografía" className="h-24 w-24 shrink-0 rounded-xl object-cover" /> : <div className="grid h-24 w-24 shrink-0 place-items-center rounded-xl bg-white/5 text-cyan-300"><ImagePlus size={30}/></div>}
              <div className="min-w-0 flex-1">
                <label className="block text-sm font-medium text-white" htmlFor="patient-photo">Fotografía del paciente (opcional)</label>
                <input id="patient-photo" type="file" accept="image/jpeg,image/png,image/webp" className="mt-2 block w-full text-xs text-slate-300" onChange={e => { void pickPhoto(e.target.files?.[0]); e.currentTarget.value = ""; }}/>
                {reading && <span className="text-xs text-cyan-300">Procesando imagen…</span>}
                {foto && <button type="button" className="mt-2 text-xs text-rose-300" onClick={() => { photoRequest.current++; setFoto(undefined); setReading(false); }}>Quitar fotografía</button>}
                <p className="mt-2 text-xs text-slate-400">Solo imágenes ficticias o sintéticas. Se guardan en esta sesión del navegador, no en el servidor.</p>
              </div>
            </div>
          </div>
          <label className="sm:col-span-2"><span className="mb-1 block text-xs text-slate-400">Nombre completo</span><input className="field" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
          <label><span className="mb-1 block text-xs text-slate-400">Sexo</span>
            <select className="field" value={f.sexo} onChange={(e) => setF({ ...f, sexo: e.target.value as Sex })}><option value="male" className="bg-slate-900">Hombre</option><option value="female" className="bg-slate-900">Mujer</option></select></label>
          {(["edad", "altura", "peso", "grasa", "musculo"] as const).map((k) => (
            <label key={k}><span className="mb-1 block text-xs capitalize text-slate-400">{k === "musculo" ? "Masa muscular (%)" : k === "grasa" ? "Grasa corporal (%)" : k === "altura" ? "Altura (cm)" : k === "peso" ? "Peso (kg)" : "Edad"}</span>
              <input type="number" className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: +e.target.value })} /></label>
          ))}
          <label><span className="mb-1 block text-xs text-slate-400">Estado</span><select className="field" value={status} onChange={e=>setStatus(e.target.value as Patient["estado"])}>{["Nuevo","Activo","En seguimiento","Alta"].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
          <label className="sm:col-span-2"><span className="mb-1 block text-xs text-slate-400">Objetivo</span><input className="field" value={f.objetivo} onChange={(e) => setF({ ...f, objetivo: e.target.value })} /></label>
        </div>
        <div className="mt-6 flex justify-end gap-2"><Btn onClick={close}>Cancelar</Btn><Btn variant="primary" onClick={create} disabled={reading}>{editing?"Guardar cambios":"Crear expediente"}</Btn></div>
      </Modal>
      <Modal open={!!deleting} onClose={()=>setDeleting(null)} title="Eliminar expediente">
        <p className="text-sm text-slate-300">¿Eliminar el expediente de <strong>{deleting?.nombre}</strong>, su fotografía y los registros de demostración vinculados (mediciones, consentimientos y reportes)? Esta acción no se puede deshacer.</p>
        {patients.length<=1&&<p className="mt-3 text-sm text-amber-300">Debe quedar al menos un expediente activo en la demostración. Crea otro antes de eliminar este.</p>}
        <div className="mt-5 flex justify-end gap-2"><Btn onClick={()=>setDeleting(null)}>Cancelar</Btn><Btn variant="danger" disabled={patients.length<=1} onClick={()=>{if(deleting&&deletePatient(deleting.id)){setDeleting(null);toast("Expediente eliminado");}}}>Eliminar</Btn></div>
      </Modal>
    </div>
  );
}

export function ExpedienteDetalle() {
  const { id } = useParams();
  const nav = useNavigate();
  const { patients, select } = useStore();
  const p = patients.find((x) => x.id === id) || patients[0];
  const { fat, mus } = bodyParams(p);
  const imc = imcOf(p.peso, p.altura);
  const data = historial(p);
  const m = [
    ["IMC", imc.toFixed(1), imc >= 25 ? "text-amber-300" : "text-emerald-300"],
    ["Peso", `${p.peso} kg`, "text-white"],
    ["Peso ideal", `${idealWeight(p.altura, p.sexo)} kg`, "text-sky-300"],
    ["Grasa corporal", `${p.grasa}%`, "text-amber-300"],
    ["Masa muscular", `${p.musculo}%`, "text-cyan-300"],
    ["Altura", `${p.altura} cm`, "text-white"],
  ];
  return (
    <div>
      <Link to="/app/expedientes" className="mb-4 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={15} /> Expedientes</Link>
      <div className="grid gap-5 xl:grid-cols-[1.05fr_1fr]">
        <Panel pad={false}>
          <BodyScene className="h-[560px] rounded-2xl" distance={4.5} rotateSpeed={1.2}>
            <BodyModel sex={p.sexo} heightCm={p.altura} weightKg={p.peso} ageYears={p.edad} fat={fat} mus={mus} tone={p.tono} />
          </BodyScene>
        </Panel>
        <div className="space-y-5">
          <Panel>
            <div className="flex flex-wrap items-center gap-4">
              <Avatar name={p.nombre} size={60} photo={p.foto} />
              <div className="flex-1">
                <h1 className="font-display text-2xl font-bold text-white">{p.nombre}</h1>
                <div className="text-sm text-slate-400">{p.id} · {p.edad} años · {p.sexo === "male" ? "Hombre" : "Mujer"} · {p.email}</div>
              </div>
              <Badge tone={estadoTone(p.estado)}>{p.estado}</Badge>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {m.map(([l, v, c]) => (
                <div key={l} className="rounded-xl border border-white/5 bg-white/[0.03] p-3.5">
                  <div className="text-xs text-slate-500">{l}</div>
                  <div className={`font-display text-xl font-bold ${c}`}>{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Btn variant="primary" onClick={() => { select(p.id); nav("/app/vision-3d"); }}><Box size={16} /> Visor 3D</Btn>
              <Btn variant="outline" onClick={() => { select(p.id); nav("/app/analisis"); }}><Sparkles size={16} /> Análisis IA</Btn>
              <Btn variant="outline" onClick={() => { select(p.id); nav("/app/simulador"); }}><SlidersHorizontal size={16} /> Simular</Btn>
            </div>
          </Panel>
          <Panel title="Evolución de peso y grasa">
            <div className="h-[220px]">
              <ResponsiveContainer>
                <AreaChart data={data} margin={{ left: -18, right: 6 }}>
                  <defs>
                    <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity={0.5} /><stop offset="1" stopColor="#22d3ee" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#16314d" strokeDasharray="3 4" />
                  <XAxis dataKey="mes" stroke="#5f7a99" fontSize={12} />
                  <YAxis stroke="#5f7a99" fontSize={12} domain={["auto", "auto"]} />
                  <Tooltip {...chartTip} />
                  <Area type="monotone" dataKey="peso" name="Peso (kg)" stroke="#22d3ee" strokeWidth={2.5} fill="url(#gp)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Notas clínicas">
            <p className="text-sm leading-relaxed text-slate-300">Objetivo: <b className="text-white">{p.objetivo}</b>. Se recomienda déficit calórico moderado, entrenamiento de fuerza 3×/semana y nueva captura corporal en 4 semanas para validar la progresión en el gemelo digital.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
