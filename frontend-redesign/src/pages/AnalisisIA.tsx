import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ImagePlus, Info } from "lucide-react";
import { Badge, Panel, PageHead, chartTip } from "../ui";
import { bodyParams, idealWeight, imcOf, useStore } from "../store";
import { BodyScene, Annotation } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";

export default function AnalisisIA() {
  const { patient: p, mediciones } = useStore();
  const { fat, mus } = bodyParams(p);
  const imc = imcOf(p.peso, p.altura);
  const ideal = idealWeight(p.altura, p.sexo);
  // Only measurements explicitly linked to this record ID; do not match by name.
  const records = mediciones.filter(m => m.patientId === p.id);
  const latest = records.find(m=>[m.brazo,m.pecho,m.cintura,m.cadera,m.muslo].some(Number.isFinite));
  const data = [...(Number.isFinite(p.grasa)?[{ mes: "Expediente", grasa: p.grasa }]:[]), ...records.filter(m=>Number.isFinite(m.grasa)).slice().reverse().map((m, i) => ({ mes: "M" + (i + 1), grasa: m.grasa }))];
  const sc = p.altura / 175;
  const radial = Math.min(1.65, Math.max(.65, Math.sqrt(imc/23) * (1+fat*.004+mus*.002)));
  const position = (x:number,y:number,z:number):[number,number,number] => [x*sc*radial,y*sc,z*sc*radial];
  const metrics = [
    ["IMC", imc.toFixed(1), imc >= 25 ? "text-amber-300" : "text-emerald-300"],
    ["Peso de referencia", `${ideal} kg`, "text-sky-300"],
    ["Grasa Corporal", Number.isFinite(p.grasa)?`${p.grasa}%`:"No registrado", "text-amber-300"],
    ["Masa Muscular", Number.isFinite(p.musculo)?`${p.musculo.toFixed(1)}%`:"No registrado", "text-cyan-300"],
  ];
  const segments = latest ? [
    ["Brazo", latest.brazo], ["Pecho", latest.pecho], ["Cintura", latest.cintura],
    ["Cadera", latest.cadera], ["Muslo", latest.muslo],
  ] as const : [];
  const insights = [
    `Expediente: ${p.edad} años · ${p.altura} cm · ${p.peso} kg.`,
    `Composición registrada: ${Number.isFinite(p.grasa)?p.grasa+"% de grasa":"grasa no registrada"} y ${Number.isFinite(p.musculo)?p.musculo.toFixed(1)+"% de masa muscular":"masa muscular no registrada"}.`,
    latest ? "Mediciones vinculadas al expediente disponibles." : "No hay mediciones segmentarias vinculadas a este expediente.",
    "El atlas y sus colores son ilustrativos; no constituyen una medición térmica, diagnóstico ni análisis de la fotografía.",
  ];

  return (
    <div>
      <PageHead title="Análisis con IA" sub={`Informe de composición corporal · ${p.nombre}`} actions={<Badge tone="info">{p.id} · Datos del expediente</Badge>} />
      <div className="grid gap-5 xl:grid-cols-[260px_1fr_380px]">
        <Panel pad={false} className="overflow-hidden">
          <div className="relative flex min-h-[240px] flex-col xl:min-h-[560px]">
            {p.foto ? <img key={p.id} src={p.foto} alt={`Fotografía registrada de ${p.nombre}`} className="h-[280px] w-full bg-black object-contain xl:h-[560px]" /> :
              <div className="flex min-h-[240px] flex-1 flex-col items-center justify-center gap-3 p-5 text-center text-slate-400">
                <ImagePlus size={32} className="text-slate-500" />
                <span className="text-sm">Sin fotografía registrada</span>
              </div>}
            <div className="border-t border-white/5 bg-slate-950/50 p-3">
              <div className="text-sm font-semibold text-white">{p.nombre}</div>
              <div className="mt-1 text-xs text-slate-400">{p.foto ? "Fotografía del expediente" : p.id}</div>
            </div>
          </div>
        </Panel>
        <Panel pad={false}>
          <BodyScene className="h-[600px] rounded-2xl" distance={4.6 * Math.max(1, sc)} ring="#f59e0b" rotateSpeed={1}>
            <BodyModel key={p.id} sex={p.sexo} heightCm={p.altura} weightKg={p.peso} ageYears={p.edad} fat={fat} mus={mus} mode="thermal" />
            <Annotation position={position(0,1.69,.1)} label="Edad" value={`${p.edad} años`} color="#fb923c" align="left" />
            <Annotation position={position(.1,1.3,.1)} label="Masa muscular total" value={`${p.musculo}%`} color="#22d3ee" />
            <Annotation position={position(.05,1.08,.13)} label="Grasa corporal total" value={`${p.grasa}%`} color="#facc15" align="left" />
            <Annotation position={position(.1,.6,.1)} label="Altura" value={`${p.altura} cm`} color="#34d399" />
          </BodyScene>
        </Panel>
        <div className="space-y-5">
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
              {segments.filter(([,value])=>Number.isFinite(value)).map(([label, value]) => <div key={label} className="rounded-lg bg-white/5 p-3"><dt className="text-xs text-slate-400">{label}</dt><dd className="text-lg font-semibold text-white">{value} cm</dd></div>)}
            </dl> : <p className="py-5 text-center text-sm text-slate-400">Sin mediciones segmentarias registradas</p>}
          </Panel>
          <Panel title="Tendencia · % Grasa">
            {data.length > 1 ? <><div className="h-[150px]">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ left: -25, right: 10 }}>
                  <XAxis dataKey="mes" stroke="#5f7a99" fontSize={11} /><YAxis stroke="#5f7a99" fontSize={11} domain={["auto", "auto"]} />
                  <Tooltip {...chartTip} /><Line dataKey="grasa" name="Grasa registrada / estimada (%)" stroke="#f59e0b" strokeWidth={2.5} dot />
                </LineChart>
              </ResponsiveContainer>
            </div><p className="mt-2 text-xs text-slate-400">M: medición registrada; grasa estimada en Mediciones.</p></> : <p className="py-5 text-center text-sm text-slate-400">{Number.isFinite(p.grasa)?`Último valor: ${p.grasa}%.`:"Grasa no registrada."} Registra mediciones para ver la evolución.</p>}
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
