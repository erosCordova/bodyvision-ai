import { useState } from "react";
import { Eye, RotateCw, Shirt } from "lucide-react";
import { Avatar, Panel, PageHead, Range, Toggle } from "../ui";
import { bodyParams, idealWeight, imcOf, useStore } from "../store";
import { BodyScene, type ViewPreset } from "../three/BodyScene";
import man2 from "../assets/img/man2.jpg";
import woman from "../assets/img/woman.jpg";
import { BodyModel, TONES, type Mode } from "../three/BodyModel";

const MODES: { id: Mode; label: string; d: string }[] = [
  { id: "skin", label: "Realista", d: "Piel con subsurface y poros" },
  { id: "muscle", label: "Músculos", d: "Capa muscular fibrosa" },
  { id: "skeleton", label: "Esqueleto", d: "Esqueleto anatómico interactivo" },
  { id: "xray", label: "Rayos X", d: "Hueso bajo la silueta" },
  { id: "thermal", label: "Térmico IA", d: "Mapa de composición" },
  { id: "holo", label: "Holograma", d: "Visualización anatómica" },
  { id: "organs", label: "Órganos", d: "Órganos internos" },
  { id: "arteries", label: "Arterias", d: "Sistema arterial" },
  { id: "veins", label: "Venas", d: "Sistema venoso" },
  { id: "nerves", label: "Nervios", d: "Sistema nervioso" },
  { id: "all", label: "Todas las capas", d: "Atlas completo" },
];
const VIEWS: { id: ViewPreset; label: string }[] = [
  { id: "3q", label: "3/4" }, { id: "front", label: "Frontal" }, { id: "side", label: "Lateral" }, { id: "back", label: "Posterior" },
  { id: "head", label: "Rostro" }, { id: "torso", label: "Torso" }, { id: "legs", label: "Piernas" },
];

export default function Vision3D() {
  const { patient } = useStore();
  return <PatientVision key={patient.id} />;
}

function PatientVision() {
  const { patient: p } = useStore();
  const base = bodyParams(p);
  const [mode, setMode] = useState<Mode>("skin");
  const [view, setView] = useState<ViewPreset>("3q");
  const [tick, setTick] = useState(0);
  const [rot, setRot] = useState(true);
  const [garm, setGarm] = useState(true);
  const [tone, setTone] = useState(p.tono);
  const [dfat, setDfat] = useState(0);
  const [dmus, setDmus] = useState(0);
  const imc = imcOf(p.peso, p.altura);

  return (
    <div>
      <PageHead title="Visión 3D" sub={`Modelo 3D anatómico · ${p.nombre} · ${p.sexo === "male" ? "Hombre" : "Mujer"}, ${p.altura} cm`} />
      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Panel pad={false} className="overflow-hidden">
          <div className="relative">
            <BodyScene className="h-[calc(100vh-190px)] min-h-[560px]" autoRotate={rot} view={view} viewTick={tick} distance={4.5 * Math.max(1, p.altura / 175)}>
              <BodyModel sex={p.sexo} heightCm={p.altura} weightKg={p.peso} ageYears={p.edad} fat={base.fat + dfat} mus={base.mus + dmus} mode={mode} tone={tone} garments={garm} />
            </BodyScene>
            <div className="absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5 rounded-2xl border border-white/10 bg-slate-950/70 p-1.5 backdrop-blur">
              {MODES.map((m) => (
                <button key={m.id} title={m.d} onClick={() => setMode(m.id)} className={`rounded-xl px-3 py-1.5 text-xs font-medium transition ${mode === m.id ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-white/10"}`}>{m.label}</button>
              ))}
            </div>
            <div className="absolute bottom-3 left-1/2 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap justify-center gap-1.5 rounded-2xl border border-white/10 bg-slate-950/70 p-1.5 backdrop-blur">
              {VIEWS.map((v) => (
                <button key={v.id} onClick={() => { setView(v.id); setTick((t) => t + 1); setRot(false); }} className="rounded-xl px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 hover:text-white">{v.label}</button>
              ))}
            </div>
            <div className="absolute right-3 top-3 hidden rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] text-slate-400 backdrop-blur md:block">Arrastra para rotar · rueda para zoom</div>
          </div>
        </Panel>
        <div className="space-y-5">
          <Panel title="Paciente seleccionado">
            <div className="flex items-center gap-3">
              <Avatar name={p.nombre} size={44} photo={p.foto} />
              <div><div className="font-semibold text-white">{p.nombre}</div><div className="text-xs text-slate-400">{p.id} · {p.edad} años</div></div>
            </div>
            <img src={p.foto || (p.sexo==="male"?man2:woman)} alt={p.foto?`Fotografía de referencia de ${p.nombre}`:"Imagen ilustrativa de demostración"} className="mt-3 max-h-64 w-full rounded-xl border border-white/10 object-contain bg-slate-950" />
            {!p.foto&&<p className="mt-1 text-xs text-slate-500">Imagen ilustrativa · sin foto registrada</p>}
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              {[["Edad", `${p.edad} años`], ["Altura", `${p.altura} cm`], ["Peso", `${p.peso} kg`]].map(([label,value]) => <div key={label} className="rounded-lg bg-white/5 p-2"><dt className="text-xs text-slate-400">{label}</dt><dd className="font-semibold text-white">{value}</dd></div>)}
            </dl>
            <p className="mt-3 text-xs text-slate-400">Atlas ajustado de forma orientativa; la fotografía es una referencia, no una reconstrucción facial.</p>
          </Panel>
          <Panel title="Controles">
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-300"><RotateCw size={15} /> Rotación 360° automática</span><Toggle checked={rot} onChange={setRot} label="rotar" /></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-300"><Shirt size={15} /> Prendas</span><Toggle checked={garm} onChange={setGarm} label="prendas" /></div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-slate-300"><Eye size={15} /> Tono de piel</div>
                <div className="flex gap-2">
                  {Object.entries(TONES).map(([k, c]) => (
                    <button key={k} title={k} onClick={() => setTone(k)} className={`h-8 w-8 rounded-full border-2 transition ${tone === k ? "scale-110 border-cyan-300" : "border-transparent"}`} style={{ background: c }} />
                  ))}
                </div>
              </div>
              <Range label="Ajuste de grasa" value={dfat} min={-10} max={20} onChange={setDfat} unit="%" />
              <Range label="Ajuste de masa muscular" value={dmus} min={-5} max={10} onChange={setDmus} unit="%" />
            </div>
          </Panel>
          <Panel title="Datos del modelo">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[["IMC", imc.toFixed(1)], ["Peso", `${(p.peso + dfat * 0.9 + dmus * 0.5).toFixed(1)} kg`], ["Peso ideal", `${idealWeight(p.altura, p.sexo)} kg`], ["Grasa", `${(p.grasa + dfat).toFixed(1)}%`]].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-white/5 bg-white/[0.03] p-3"><dt className="text-xs text-slate-500">{l}</dt><dd className="font-display text-lg font-bold text-white">{v}</dd></div>
              ))}
            </dl>
          </Panel>
          <Panel title="Capacidades del visor">
            <ul className="space-y-2 text-sm text-slate-300">
              {["Atlas anatómico Z-Anatomy", "Rotación 360° y vistas anatómicas", "Escala según la estatura y proporciones orientativas según el peso", "Textura de piel orientativa según la edad", "Simulación ilustrativa de composición corporal"].map((t) => (
                <li key={t} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />{t}</li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}
