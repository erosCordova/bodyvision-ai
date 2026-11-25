import { useEffect, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, Play, RotateCcw } from "lucide-react";
import { Btn, PageHead, Panel, Range, chartTip } from "../ui";
import { bodyParams, imcOf, useStore } from "../store";
import { BodyScene } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";

export default function Simulador() {
  const { patient: p, toast } = useStore();
  const base = bodyParams(p);
  const [dfat, setDfat] = useState(-10);
  const [dmus, setDmus] = useState(5);
  const [weeks, setWeeks] = useState(12);
  const [prog, setProg] = useState(0);
  const raf = useRef<number>(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { setProg(0); }, [p.id]);

  const play = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min((t - t0) / 3500, 1);
      setProg(1 - Math.pow(1 - k, 3));
      if (k < 1) raf.current = requestAnimationFrame(step);
      else toast("Simulación completada");
    };
    raf.current = requestAnimationFrame(step);
  };
  const reset = () => { cancelAnimationFrame(raf.current); setProg(0); };

  const pesoObj = +(p.peso + dfat * 0.9 + dmus * 0.5).toFixed(1);
  const grasaObj = +(p.grasa + dfat).toFixed(1);
  const data = Array.from({ length: weeks + 1 }, (_, w) => {
    const k = 1 - Math.pow(1 - w / weeks, 2);
    return { sem: w, peso: +(p.peso + (pesoObj - p.peso) * k).toFixed(1), grasa: +(p.grasa + dfat * k).toFixed(1) };
  });
  const sc = p.sexo === "female" ? 0.935 : 1;

  return (
    <div>
      <PageHead title="Simulación de cambios" sub={`Proyección corporal · ${p.nombre}`} actions={<><Btn onClick={reset}><RotateCcw size={16} /> Restablecer</Btn><Btn variant="primary" onClick={play}><Play size={16} /> Simular resultado</Btn></>} />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Panel pad={false}>
            <div className="relative">
              <BodyScene className="h-[560px] rounded-2xl" distance={5.6} autoRotate={false} view="front" sparkles>
                <BodyModel sex={p.sexo} heightCm={p.altura} weightKg={p.peso} ageYears={p.edad} fat={base.fat} mus={base.mus} tone={p.tono} position={[-0.75 * sc, 0, 0]} />
                <BodyModel sex={p.sexo} heightCm={p.altura} weightKg={Math.max(25,p.peso + (dfat * .9 + dmus * .5) * prog)} ageYears={p.edad} fat={base.fat + dfat * prog} mus={base.mus + dmus * prog} tone={p.tono} position={[0.75 * sc, 0, 0]} />
              </BodyScene>
              <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-around px-10 text-center">
                <div className="rounded-xl border border-white/10 bg-slate-950/70 px-4 py-2 backdrop-blur"><div className="text-[11px] uppercase tracking-wider text-slate-400">Actual</div><div className="font-display text-lg font-bold text-white">{p.peso} kg · {p.grasa}%</div></div>
                <div className="flex items-center text-cyan-300"><ArrowRight size={26} /></div>
                <div className="rounded-xl border border-cyan-400/40 bg-slate-950/70 px-4 py-2 backdrop-blur"><div className="text-[11px] uppercase tracking-wider text-cyan-300">Simulado · semana {Math.round(weeks * prog)}</div><div className="font-display text-lg font-bold text-white">{(p.peso + (pesoObj - p.peso) * prog).toFixed(1)} kg · {(p.grasa + dfat * prog).toFixed(1)}%</div></div>
              </div>
            </div>
          </Panel>
          <Panel title="Proyección de peso y grasa">
            <div className="h-[220px]">
              <ResponsiveContainer>
                <AreaChart data={data} margin={{ left: -18, right: 6 }}>
                  <defs>
                    <linearGradient id="sp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity={0.45} /><stop offset="1" stopColor="#22d3ee" stopOpacity={0} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#16314d" strokeDasharray="3 4" />
                  <XAxis dataKey="sem" stroke="#5f7a99" fontSize={12} label={{ value: "Semanas", position: "insideBottomRight", offset: -2, fill: "#5f7a99", fontSize: 11 }} />
                  <YAxis stroke="#5f7a99" fontSize={12} domain={["auto", "auto"]} />
                  <Tooltip {...chartTip} />
                  <Area dataKey="peso" name="Peso (kg)" stroke="#22d3ee" strokeWidth={2.5} fill="url(#sp)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Parámetros">
            <div className="space-y-6">
              <Range label="Grasa Corporal" value={dfat} min={-15} max={10} onChange={(v) => { setDfat(v); setProg(1); }} unit="%" />
              <Range label="Masa Muscular" value={dmus} min={-5} max={10} onChange={(v) => { setDmus(v); setProg(1); }} unit="%" />
              <Range label="Plazo" value={weeks} min={4} max={36} onChange={setWeeks} right={`${weeks} semanas`} />
              <div className="flex items-center justify-between rounded-xl border border-cyan-400/25 bg-cyan-400/5 px-4 py-3 text-sm">
                <span className="text-slate-300">Peso objetivo</span>
                <span className="font-display text-xl font-bold text-cyan-200">{pesoObj} kg</span>
              </div>
              <Btn variant="primary" className="w-full !py-3" onClick={play}>Simular Resultado</Btn>
            </div>
          </Panel>
          <Panel title="Resultados proyectados">
            <dl className="space-y-3 text-sm">
              {[["Peso", `${p.peso} → ${pesoObj} kg`], ["Grasa corporal", `${p.grasa}% → ${grasaObj}%`], ["Masa muscular", `${p.musculo}% → ${(p.musculo + dmus).toFixed(1)}%`], ["IMC", `${imcOf(p.peso, p.altura).toFixed(1)} → ${imcOf(pesoObj, p.altura).toFixed(1)}`], ["Ritmo", `${(Math.abs(p.peso - pesoObj) / weeks).toFixed(2)} kg/semana`]].map(([l, v]) => (
                <div key={l} className="flex justify-between border-b border-white/5 pb-2"><dt className="text-slate-400">{l}</dt><dd className="font-semibold text-white">{v}</dd></div>
              ))}
            </dl>
            <p className="mt-4 text-xs leading-relaxed text-slate-500">Simulación orientativa basada en modelos poblacionales. No sustituye el criterio clínico.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
