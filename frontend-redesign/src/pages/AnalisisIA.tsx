import { Line, LineChart, PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Badge, Panel, PageHead, chartTip } from "../ui";
import { bodyParams, historial, idealWeight, imcOf, useStore } from "../store";
import { BodyScene, Annotation } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";
import man2 from "../assets/img/man2.jpg";
import woman from "../assets/img/woman.jpg";

export default function AnalisisIA() {
  const { patient: p } = useStore();
  const { fat, mus } = bodyParams(p);
  const imc = imcOf(p.peso, p.altura);
  const ideal = idealWeight(p.altura, p.sexo);
  const data = historial(p);
  const sc = p.sexo === "female" ? 0.935 : 1;
  const metrics = [
    ["IMC", imc.toFixed(1), imc >= 25 ? "text-amber-300" : "text-emerald-300"],
    ["Peso Ideal", `${ideal} kg`, "text-sky-300"],
    ["Grasa Corporal", `${p.grasa}%`, "text-amber-300"],
    ["Masa Muscular", `${p.musculo}%`, "text-cyan-300"],
  ];
  const seg = [
    { r: "Brazos", v: 60 + p.musculo - p.grasa * 0.3 },
    { r: "Tronco", v: 70 - p.grasa * 0.8 + p.musculo * 0.3 },
    { r: "Piernas", v: 62 + p.musculo * 0.5 - p.grasa * 0.2 },
    { r: "Core", v: 66 - p.grasa * 0.7 + p.musculo * 0.4 },
    { r: "Espalda", v: 64 + p.musculo * 0.4 - p.grasa * 0.3 },
  ].map((s) => ({ ...s, v: Math.round(Math.max(25, Math.min(98, s.v))) }));
  const insights = [
    imc >= 25 ? { t: "warn", m: `IMC ${imc.toFixed(1)}: ${(p.peso - ideal).toFixed(1)} kg sobre el peso ideal.` } : { t: "ok", m: "IMC dentro del rango saludable." },
    p.grasa > (p.sexo === "male" ? 25 : 32) ? { t: "bad", m: "Porcentaje de grasa elevado: priorizar déficit calórico y cardio de baja intensidad." } : { t: "ok", m: "Porcentaje de grasa en rango aceptable." },
    { t: "info", m: "Asimetría postural leve detectada (hombro derecho +1.2 cm)." },
    { t: "info", m: `Proyección: ${Math.max(2, Math.round((p.grasa - 18) * 0.8))}% menos grasa en 12 semanas con el plan sugerido.` },
  ];
  const Ico = { ok: CheckCircle2, warn: AlertTriangle, bad: AlertTriangle, info: Info } as const;
  const col = { ok: "text-emerald-300", warn: "text-amber-300", bad: "text-rose-300", info: "text-sky-300" } as const;

  return (
    <div>
      <PageHead title="Análisis con IA" sub={`Informe de composición corporal · ${p.nombre}`} actions={<Badge tone="ok">Confianza del modelo 98.7%</Badge>} />
      <div className="grid gap-5 xl:grid-cols-[260px_1fr_380px]">
        <Panel pad={false} className="hidden overflow-hidden xl:block">
          <div className="relative h-full min-h-[560px]">
            <img src={p.sexo === "male" ? man2 : woman} alt="Fotografía del paciente" className="absolute inset-0 h-full w-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-transparent to-transparent" />
            <div className="absolute bottom-3 left-3 text-xs text-slate-300">Fotografía original · vista frontal</div>
          </div>
        </Panel>
        <Panel pad={false}>
          <BodyScene className="h-[600px] rounded-2xl" distance={4.6} ring="#f59e0b" rotateSpeed={1}>
            <BodyModel sex={p.sexo} heightCm={p.altura} weightKg={p.peso} ageYears={p.edad} fat={fat} mus={mus} mode="thermal" />
            <Annotation position={[0.0 * sc, 1.69 * sc, 0.1 * sc]} label="Cabeza" value="36.8 °C" color="#fb923c" align="left" />
            <Annotation position={[0.1 * sc, 1.3 * sc, 0.1 * sc]} label="Masa muscular" value={`${p.musculo}%`} color="#22d3ee" />
            <Annotation position={[0.05 * sc, 1.08 * sc, 0.13 * sc]} label="Grasa visceral" value={`${(p.grasa * 0.32).toFixed(1)}%`} color="#facc15" align="left" />
            <Annotation position={[0.1 * sc, 0.6 * sc, 0.1 * sc]} label="Piernas" value="Equilibrado" color="#34d399" />
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
              <div className="mb-1.5 flex justify-between text-[11px] text-slate-400"><span>Frío</span><span>Mapa térmico de grasa</span><span>Caliente</span></div>
              <div className="h-3 rounded-full" style={{ background: "linear-gradient(90deg,#1e3a8a,#0ea5e9,#22c55e,#facc15,#f97316,#dc2626)" }} />
            </div>
          </Panel>
          <Panel title="Composición por segmentos">
            <div className="h-[200px]">
              <ResponsiveContainer>
                <RadarChart data={seg}>
                  <PolarGrid stroke="#1d4568" />
                  <PolarAngleAxis dataKey="r" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                  <Radar dataKey="v" stroke="#22d3ee" fill="#22d3ee" fillOpacity={0.3} />
                  <Tooltip {...chartTip} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Tendencia · % Grasa">
            <div className="h-[110px]">
              <ResponsiveContainer>
                <LineChart data={data} margin={{ left: -30, right: 6 }}>
                  <XAxis dataKey="mes" stroke="#5f7a99" fontSize={11} /><YAxis stroke="#5f7a99" fontSize={11} domain={["auto", "auto"]} />
                  <Tooltip {...chartTip} /><Line dataKey="grasa" stroke="#f59e0b" strokeWidth={2.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Hallazgos de la IA">
            <ul className="space-y-3">
              {insights.map((i) => {
                const I = Ico[i.t as keyof typeof Ico];
                return <li key={i.m} className="flex gap-3 text-sm text-slate-300"><I size={17} className={`mt-0.5 shrink-0 ${col[i.t as keyof typeof col]}`} />{i.m}</li>;
              })}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
