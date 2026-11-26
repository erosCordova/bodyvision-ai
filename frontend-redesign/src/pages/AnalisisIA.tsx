import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Info } from "lucide-react";
import { Badge, Panel, PageHead, chartTip } from "../ui";
import { bodyParams, idealWeight, imcOf, useStore } from "../store";
import { BodyScene, Annotation } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";
import man2 from "../assets/img/man2.jpg";
import woman from "../assets/img/woman.jpg";

export default function AnalisisIA() {
  const { patient: p, mediciones } = useStore();
  const { fat, mus } = bodyParams(p);
  const imc = imcOf(p.peso, p.altura);
  const ideal = idealWeight(p.altura, p.sexo);
  // Only measurements explicitly linked to this record ID; do not match by name.
  const records = mediciones.filter(m => m.patientId === p.id);
  const latest = records[0];
  const fmt=(v:number,unit="")=>Number.isFinite(v)?new Intl.NumberFormat("es-PE",{maximumFractionDigits:1}).format(v)+unit:"—";
  const data = records.filter(m=>Number.isFinite(m.grasa)).slice().reverse().map((m,i)=>({mes:"M"+(i+1),grasa:m.grasa,fecha:m.fecha}));
  const sc = p.altura / 175;
  const radial = Math.min(1.65, Math.max(.65, Math.sqrt(imc/23) * (1+fat*.004+mus*.002)));
  const position = (x:number,y:number,z:number):[number,number,number] => [x*sc*radial,y*sc,z*sc*radial];
  const metrics = [
    ["IMC", imc.toFixed(1), imc >= 25 ? "text-amber-300" : "text-emerald-300"],
    ["Peso de referencia", `${ideal} kg`, "text-sky-300"],
    ["Grasa Corporal", fmt(p.grasa,"%"), "text-amber-300"],
    ["Masa Muscular", fmt(p.musculo,"%"), "text-cyan-300"],
  ];
  const segments = latest ? [
    ["Brazo", latest.brazo], ["Pecho", latest.pecho], ["Cintura", latest.cintura],
    ["Cadera", latest.cadera], ["Muslo", latest.muslo],
  ].filter(([,value])=>Number.isFinite(value)) as [string,number][] : [];
  const insights = [
    `Expediente: ${p.edad} años · ${p.altura} cm · ${p.peso} kg.`,
    `Composición registrada: ${fmt(p.grasa,"%")} de grasa y ${fmt(p.musculo,"%")} de masa muscular.`,
    latest ? "Mediciones vinculadas al expediente disponibles." : "No hay mediciones segmentarias vinculadas a este expediente.",
    "El atlas y sus colores son ilustrativos; no constituyen una medición térmica, diagnóstico ni análisis de la fotografía.",
  ];

  return (
    <div>
      <PageHead title="Análisis con IA" sub={`Informe de composición corporal · ${p.nombre}`} actions={<Badge tone="info">{p.id} · Datos del expediente</Badge>} />
      <div className="grid gap-5 xl:grid-cols-[minmax(200px,260px)_minmax(0,1fr)_minmax(280px,380px)] items-start">
        <div className="min-w-0 space-y-5"><Panel pad={false} className="overflow-hidden">
          <div className="relative flex min-h-[240px] flex-col xl:min-h-[560px]">
            <img key={p.id} src={p.foto || (p.sexo==="male"?man2:woman)} alt={p.foto?`Fotografía registrada de ${p.nombre}`:"Imagen anatómica de referencia"} className={`h-[280px] w-full bg-black xl:h-[560px] ${p.foto?"object-contain":"object-cover object-top"}`} />
            <div className="border-t border-white/5 bg-slate-950/50 p-3">
              <div className="text-sm font-semibold text-white">{p.nombre}</div>
              <div className="mt-1 text-xs text-slate-400">{p.foto ? "Fotografía del expediente" : "Imagen de referencia · sin fotografía registrada"}</div>
            </div>
          </div>
        </Panel><Panel title="Datos del paciente"><dl className="space-y-3 text-sm">{[["Edad",fmt(p.edad," años")],["Estatura",fmt(p.altura," cm")],["Peso",fmt(p.peso," kg")],["IMC",fmt(imc)],["Grasa corporal",fmt(p.grasa,"%")],["Masa muscular",fmt(p.musculo,"%")]].map(([label,value])=><div key={label} className="flex justify-between gap-2 border-b border-white/5 pb-2"><dt className="text-slate-400">{label}</dt><dd className="font-semibold text-white">{value}</dd></div>)}</dl></Panel></div>
        <div className="min-w-0 space-y-5"><Panel pad={false}>
          <BodyScene className="h-[600px] rounded-2xl" distance={4.6 * Math.max(1, sc)} ring="#f59e0b" rotateSpeed={1}>
            <BodyModel key={p.id} sex={p.sexo} heightCm={p.altura} weightKg={p.peso} ageYears={p.edad} fat={fat} mus={mus} mode="thermal" />
            <Annotation position={position(0,1.69,.1)} label="Edad" value={`${p.edad} años`} color="#fb923c" align="left" />
            <Annotation position={position(.1,1.3,.1)} label="Masa muscular total" value={`${p.musculo}%`} color="#22d3ee" />
            <Annotation position={position(.05,1.08,.13)} label="Grasa corporal total" value={`${p.grasa}%`} color="#facc15" align="left" />
            <Annotation position={position(.1,.6,.1)} label="Altura" value={`${p.altura} cm`} color="#34d399" />
          </BodyScene>
        </Panel><Panel title="Historial de composición corporal"><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-slate-400"><tr><th className="pb-2">Fecha</th><th>Peso</th><th>Grasa corporal</th></tr></thead><tbody>{records.filter(m=>Number.isFinite(m.peso)||Number.isFinite(m.grasa)).slice(0,8).map(m=><tr key={m.id} className="border-t border-white/5"><td className="py-2">{m.fecha}</td><td>{fmt(m.peso," kg")}</td><td>{fmt(m.grasa,"%")}</td></tr>)}</tbody></table>{!records.some(m=>Number.isFinite(m.peso)||Number.isFinite(m.grasa))&&<p className="py-3 text-sm text-slate-400">Sin registros de composición corporal</p>}</div></Panel></div>
        <div className="min-w-0 space-y-5">
          <Panel title="Análisis Corporal">
            <div className="grid grid-cols-2 gap-3">
              {metrics.map(([l, v, c]) => (
                <div key={l} className="rounded-xl border border-white/5 bg-white/[0.03] p-3.5">
                  <div className="text-xs text-slate-400">{l}</div>
                  <div className={`font-display text-2xl font-bold ${c}`}>{v}</div>
                </div>
              ))}
            </div>
            <div className="mt-5">
              <div className="mb-1.5 flex justify-between text-[11px] text-slate-400"><span>Bajo</span><span>Mapa ilustrativo (no térmico real)</span><span>Alto</span></div>
              <div className="h-3 rounded-full" style={{ background: "linear-gradient(90deg,#1e3a8a,#0ea5e9,#22c55e,#facc15,#f97316,#dc2626)" }} />
            </div>
          </Panel>
          <Panel title="Medidas por segmentos">
            {segments.length ? <dl className="grid grid-cols-2 gap-2">
              {segments.map(([label, value]) => <div key={label} className="rounded-lg bg-white/5 p-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="text-lg font-semibold text-white">{value} cm</dd></div>)}
            </dl> : <p className="py-5 text-center text-sm text-slate-400">Sin mediciones segmentarias registradas</p>}
          </Panel>
          <Panel title="Tendencia · % Grasa">
            {data.length > 1 ? <><div className="h-[150px]">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ left: -25, right: 10 }}>
                  <XAxis dataKey="mes" stroke="#5f7a99" fontSize={11} /><YAxis stroke="#5f7a99" fontSize={11} domain={["auto", "auto"]} />
                  <Tooltip {...chartTip} /><Line dataKey="grasa" name="Grasa registrada (%)" stroke="#f59e0b" strokeWidth={2.5} dot />
                </LineChart>
              </ResponsiveContainer>
            </div><p className="mt-2 text-xs text-slate-400">Mediciones registradas del expediente.</p></> : <p className="py-5 text-center text-sm text-slate-400">{data.length===1?`Último valor: ${fmt(data[0].grasa,"%")}.`:"Sin mediciones de grasa registradas."}</p>}
          </Panel>
          <Panel title="Resumen del expediente">
            <ul className="space-y-3">
              {insights.map(m => <li key={m} className="flex gap-3 text-sm text-slate-300"><Info size={17} className="mt-0.5 shrink-0 text-sky-300" />{m}</li>)}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
