import { useState } from "react";
import { Download, Plus, Ruler } from "lucide-react";
import { Badge, Btn, PageHead, Panel } from "../ui";
import { imcOf, useStore } from "../store";

export default function Mediciones() {
  const { patient } = useStore();
  return <PatientMeasurements key={patient.id} />;
}

function PatientMeasurements() {
  const { patient, mediciones, addMedicion, toast } = useStore();
  const [f, setF] = useState({ peso: patient.peso, cintura: 88, cadera: 98, pecho: 100, brazo: 33, muslo: 58 });
  const imc = imcOf(f.peso, patient.altura);
  const icc = f.cintura / f.cadera;
  const riesgo = patient.sexo === "male" ? icc > 0.9 : icc > 0.85;
  const grasaEst = patient.sexo === "male" ? 1.2 * imc + 0.23 * patient.edad - 16.2 : 1.2 * imc + 0.23 * patient.edad - 5.4;

  const save = () => {
    addMedicion({ patientId: patient.id, paciente: patient.nombre, fecha: "Hoy", ...f, grasa: +grasaEst.toFixed(1), fuente: "Manual" });
    toast("Medición registrada");
  };
  const csv = () => {
    const rows = [["ID", "Paciente", "Fecha", "Peso", "Cintura", "Cadera", "Pecho", "Brazo", "Muslo", "%Grasa", "Fuente"], ...mediciones.map((m) => [m.id, m.paciente, m.fecha, m.peso, m.cintura, m.cadera, m.pecho, m.brazo, m.muslo, m.grasa, m.fuente])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "mediciones.csv"; a.click(); URL.revokeObjectURL(url);
    toast("CSV descargado");
  };
  const fields: [keyof typeof f, string, string][] = [["peso", "Peso", "kg"], ["cintura", "Cintura", "cm"], ["cadera", "Cadera", "cm"], ["pecho", "Pecho", "cm"], ["brazo", "Brazo", "cm"], ["muslo", "Muslo", "cm"]];

  return (
    <div>
      <PageHead title="Mediciones" sub={`Registro antropométrico · ${patient.nombre}`} actions={<Btn onClick={csv}><Download size={16} /> Exportar CSV</Btn>} />
      <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
        <Panel title={<span className="flex items-center gap-2"><Ruler size={17} className="text-cyan-300" /> Nueva medición</span>}>
          <div className="grid grid-cols-2 gap-3">
            {fields.map(([k, l, u]) => (
              <label key={k}>
                <span className="mb-1 block text-xs text-slate-400">{l} ({u})</span>
                <input type="number" step="0.1" className="field" value={f[k]} onChange={(e) => setF({ ...f, [k]: +e.target.value })} />
              </label>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2 text-center">
            {[["IMC", imc.toFixed(1)], ["ICC", icc.toFixed(2)], ["% Grasa est.", grasaEst.toFixed(1)]].map(([l, v]) => (
              <div key={l} className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
                <div className="text-[11px] text-slate-400">{l}</div>
                <div className="font-display text-lg font-bold text-cyan-200">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-3"><Badge tone={riesgo ? "warn" : "ok"}>{riesgo ? "Riesgo cardiometabólico elevado (ICC)" : "ICC en rango saludable"}</Badge></div>
          <Btn variant="primary" className="mt-5 w-full" onClick={save}><Plus size={16} /> Guardar medición</Btn>
        </Panel>
        <Panel title="Historial de mediciones" pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-500">
                <tr className="[&>th]:px-4 [&>th]:py-3 [&>th]:font-medium"><th>ID</th><th>Paciente</th><th>Fecha</th><th>Peso</th><th>Cintura</th><th>Cadera</th><th>% Grasa</th><th>Fuente</th></tr>
              </thead>
              <tbody>
                {mediciones.map((m) => (
                  <tr key={m.id} className="border-t border-white/5 hover:bg-white/[0.03] [&>td]:px-4 [&>td]:py-3">
                    <td className="text-slate-400">{m.id}</td>
                    <td className="font-medium text-white">{m.paciente}</td>
                    <td className="text-slate-400">{m.fecha}</td>
                    <td>{m.peso} kg</td><td>{m.cintura} cm</td><td>{m.cadera} cm</td><td>{m.grasa}%</td>
                    <td><Badge tone={m.fuente === "Manual" ? "muted" : "info"}>{m.fuente}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
