import { useState } from "react";
import { Download, Plus, Ruler, Pencil, Trash2 } from "lucide-react";
import { Badge, Btn, PageHead, Panel, Modal } from "../ui";
import { imcOf, useStore, type Medicion } from "../store";

export default function Mediciones() {
  const { patient } = useStore();
  return <PatientMeasurements key={patient.id} />;
}

function PatientMeasurements() {
  const { patient, mediciones, addMedicion, updateMedicion, deleteMedicion, toast } = useStore();
  const empty = { peso: patient.peso, cintura: 0, cadera: 0, pecho: 0, brazo: 0, muslo: 0 };
  const [f, setF] = useState(empty);
  const [editing,setEditing]=useState<Medicion|null>(null);
  const [deleting,setDeleting]=useState<Medicion|null>(null);
  const records=mediciones.filter(m=>m.patientId===patient.id);
  const edit=(m:Medicion)=>{setEditing(m);setF({peso:m.peso,cintura:m.cintura,cadera:m.cadera,pecho:m.pecho,brazo:m.brazo,muslo:m.muslo});};
  const reset=()=>{setEditing(null);setF(empty);};
  const imc = imcOf(f.peso, patient.altura);
  const icc = f.cadera>0&&f.cintura>0 ? f.cintura / f.cadera : NaN;
  const riesgo = patient.sexo === "male" ? icc > 0.9 : icc > 0.85;
  const grasaEst = patient.sexo === "male" ? 1.2 * imc + 0.23 * patient.edad - 16.2 : 1.2 * imc + 0.23 * patient.edad - 5.4;

  const save = () => {
    if(Object.values(f).some(v=>!Number.isFinite(v)||v<=0)||f.peso>350||f.peso<25||[f.cintura,f.cadera,f.pecho,f.brazo,f.muslo].some(v=>v>350))return toast("Completa todas las medidas con valores válidos");
    const m:Omit<Medicion,"id">={patientId:patient.id,paciente:patient.nombre,fecha:editing?.fecha??new Date().toLocaleDateString("es-PE"),...f,grasa:Math.max(0,Math.min(100,+grasaEst.toFixed(1))),fuente:"Manual"};
    if(editing?updateMedicion(editing.id,m):addMedicion(m)){toast(editing?"Medición actualizada":"Medición registrada");reset();}
  };
  const csv = () => {
    const rows = [["ID", "Paciente", "Fecha", "Peso", "Cintura", "Cadera", "Pecho", "Brazo", "Muslo", "%Grasa", "Fuente"], ...records.map((m) => [m.id, m.paciente, m.fecha, m.peso, m.cintura, m.cadera, m.pecho, m.brazo, m.muslo, m.grasa, m.fuente])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(v=>{const x=String(v);return '"' + (/^[=+\-@]/.test(x)?"\'"+x:x).replaceAll('"','""') + '"';}).join(",")).join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "mediciones.csv"; a.click(); URL.revokeObjectURL(url);
    toast("CSV descargado");
  };
  const fields: [keyof typeof f, string, string][] = [["peso", "Peso", "kg"], ["cintura", "Cintura", "cm"], ["cadera", "Cadera", "cm"], ["pecho", "Pecho", "cm"], ["brazo", "Brazo", "cm"], ["muslo", "Muslo", "cm"]];

  return (
    <div>
      <PageHead title="Mediciones" sub={`Registro antropométrico · ${patient.nombre}`} actions={<Btn onClick={csv}><Download size={16} /> Exportar CSV</Btn>} />
      <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
        <Panel title={<span className="flex items-center gap-2"><Ruler size={17} className="text-cyan-300" /> {editing?"Editar medición":"Nueva medición"}</span>}>
          <div className="grid grid-cols-2 gap-3">
            {fields.map(([k, l, u]) => (
              <label key={k}>
                <span className="mb-1 block text-xs text-slate-400">{l} ({u})</span>
                <input type="number" step="0.1" className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: +e.target.value })} />
              </label>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            {[["IMC", imc.toFixed(1)], ["ICC", Number.isFinite(icc)?icc.toFixed(2):"—"], ["% Grasa est.", grasaEst.toFixed(1)]].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
                <div className="text-[11px] text-slate-400">{l}</div>
                <div className="font-display text-lg font-bold text-cyan-200">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3"><Badge tone={riesgo ? "warn" : "ok"}>{!Number.isFinite(icc)?"Completa cintura y cadera":riesgo?"ICC elevado (orientativo)":"ICC de referencia"}</Badge></div>
          <Btn variant="primary" className="mt-5 w-full" onClick={save}><Plus size={16} /> {editing?"Guardar cambios":"Guardar medición"}</Btn>{editing&&<Btn className="mt-2 w-full" onClick={reset}>Cancelar edición</Btn>}
        </Panel>
        <Panel title="Historial de mediciones" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>ID</th><th>Paciente</th><th>Fecha</th><th>Peso</th><th>Cintura</th><th>Cadera</th><th>% Grasa</th><th>Fuente</th><th>Acciones</th></tr>
              </thead>
              <tbody>
                {records.map((m) => (
                  <tr key={m.id} className="border-t border-white/5 hover:bg-white/[0.03] [&>td]:px-4 [&>td]:py-3">
                    <td className="text-slate-400">{m.id}</td>
                    <td className="font-medium text-white">{m.paciente}</td>
                    <td className="text-slate-400">{m.fecha}</td>
                    <td>{m.peso} kg</td><td>{m.cintura} cm</td><td>{m.cadera} cm</td><td>{m.grasa}%</td>
                    <td><Badge tone={m.fuente === "Manual" ? "muted" : "info"}>{m.fuente}</Badge></td><td><div className="flex gap-2"><button title="Editar" aria-label="Editar medición" className="p-2 text-cyan-300" onClick={()=>edit(m)}><Pencil size={16}/></button><button title="Eliminar" aria-label="Eliminar medición" className="p-2 text-rose-300" onClick={()=>setDeleting(m)}><Trash2 size={16}/></button></div></td>
                  </tr>
                ))}
                {!records.length&&<tr><td colSpan={9} className="py-10 text-center text-slate-400">Sin mediciones de este expediente</td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Modal open={!!deleting} onClose={()=>setDeleting(null)} title="Eliminar medición"><p className="text-sm text-slate-300">¿Eliminar la medición {deleting?.id} de {patient.nombre}?</p><div className="mt-5 flex justify-end gap-2"><Btn onClick={()=>setDeleting(null)}>Cancelar</Btn><Btn variant="danger" onClick={()=>{if(deleting&&deleteMedicion(deleting.id)){if(editing?.id===deleting.id)reset();setDeleting(null);toast("Medición eliminada");}}}>Eliminar</Btn></div></Modal>
    </div>
  );
}
