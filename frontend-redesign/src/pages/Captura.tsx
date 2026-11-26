import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, RotateCcw, Upload, Video } from "lucide-react";
import { Btn, PageHead, Panel } from "../ui";
import { bodyParams, useStore } from "../store";
import { BodyScene } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";
import man2 from "../assets/img/man2.jpg";
import woman from "../assets/img/woman.jpg";

const VIEWS = ["Frontal", "Lateral", "Posterior"];
const PIPE = ["Detectando pose (MediaPipe · 33 puntos)", "Segmentando silueta", "Estimando medidas corporales", "Reconstruyendo malla 3D", "Calculando composición con IA"];

export default function Captura() {
  const { patient, toast } = useStore();
  const [step, setStep] = useState(0);
  const [shots, setShots] = useState<string[]>([]);
  const [cam, setCam] = useState(false);
  const [proc, setProc] = useState(-1);
  const [done, setDone] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const demo = patient.sexo === "male" ? man2 : woman;
  const { fat, mus } = bodyParams(patient);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setCam(false); };
  useEffect(() => stop, []);

  const start = async () => {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setCam(true);
      setTimeout(() => { if (vid.current && stream.current) { vid.current.srcObject = stream.current; vid.current.play(); } }, 50);
    } catch {
      toast("Cámara no disponible: usando imagen de demostración");
    }
  };
  const next = (src: string) => {
    const s = [...shots, src];
    setShots(s);
    if (s.length === 3) { stop(); run(); } else setStep(s.length);
  };
  const capture = () => {
    if (cam && vid.current) {
      const c = document.createElement("canvas");
      c.width = vid.current.videoWidth || 640; c.height = vid.current.videoHeight || 480;
      c.getContext("2d")!.drawImage(vid.current, 0, 0);
      next(c.toDataURL("image/jpeg", 0.7));
    } else next(demo);
  };
  const onFile = (f?: File) => { if (f) next(URL.createObjectURL(f)); };
  const run = () => {
    setProc(0);
    PIPE.forEach((_, i) => setTimeout(() => setProc(i + 1), (i + 1) * 900));
    setTimeout(() => { setDone(true); toast("Reconstrucción 3D completada"); }, PIPE.length * 900 + 300);
  };
  const reset = () => { setShots([]); setStep(0); setProc(-1); setDone(false); };
  const checks = [["Iluminación", "Óptima"], ["Distancia", "2.4 m"], ["Postura", "Correcta"], ["Cuerpo completo", "Detectado"]];

  return (
    <div>
      <PageHead title="Captura corporal" sub="Tres fotografías guiadas para reconstruir el gemelo digital" actions={<Btn onClick={reset}><RotateCcw size={16} /> Reiniciar</Btn>} />
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Panel pad={false}>
          {done ? (
            <BodyScene className="h-[600px] rounded-2xl" distance={4.5} ring="#34d399">
              <BodyModel sex={patient.sexo} heightCm={patient.altura} weightKg={patient.peso} ageYears={patient.edad} fat={fat} mus={mus} tone={patient.tono} mode="holo" />
            </BodyScene>
          ) : (
            <div className="relative grid h-[600px] place-items-center overflow-hidden rounded-2xl bg-black">
              {cam ? <video ref={vid} muted playsInline className="h-full w-full object-cover" /> : <img src={demo} alt="Vista previa" className="h-full w-full object-cover object-top opacity-80" />}
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid meet">
                <g fill="none" stroke="#22d3ee" strokeWidth="2" strokeDasharray="7 6" opacity=".85">
                  <circle cx="200" cy="82" r="36" />
                  <path d="M200 120 C150 126 130 140 126 190 L108 330 M200 120 C250 126 270 140 274 190 L292 330 M158 190 L162 330 L150 560 M242 190 L238 330 L250 560 M162 330 L238 330" />
                </g>
              </svg>
              {proc >= 0 && <div className="scanline" />}
              <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-1.5 text-xs backdrop-blur">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" /> {cam ? "Cámara en vivo" : "Imagen de demostración"} · Vista {VIEWS[Math.min(step, 2)]}
              </div>
              <div className="absolute inset-x-0 bottom-4 flex flex-wrap items-center justify-center gap-3 px-4">
                {proc < 0 && (
                  <>
                    {!cam && <Btn onClick={start}><Video size={16} /> Activar cámara</Btn>}
                    <Btn variant="primary" onClick={capture}><Camera size={16} /> Capturar vista {VIEWS[Math.min(step, 2)].toLowerCase()}</Btn>
                    <Btn onClick={() => file.current?.click()}><Upload size={16} /> Subir foto</Btn>
                    <input ref={file} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
                  </>
                )}
              </div>
            </div>
          )}
        </Panel>
        <div className="space-y-5">
          <Panel title="Vistas requeridas">
            <div className="grid grid-cols-3 gap-3">
              {VIEWS.map((v, i) => (
                <div key={v} className={`relative aspect-[3/4] overflow-hidden rounded-xl border ${i === step && !done ? "border-cyan-400" : "border-white/10"} bg-white/5`}>
                  {shots[i] ? <img src={shots[i]} alt={v} className="h-full w-full object-cover object-top" /> : <div className="grid h-full place-items-center text-xs text-slate-500">{v}</div>}
                  {shots[i] && <CheckCircle2 size={18} className="absolute right-1.5 top-1.5 text-emerald-300" />}
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Control de calidad">
            <ul className="space-y-2.5 text-sm">
              {checks.map(([l, v]) => (
                <li key={l} className="flex items-center justify-between"><span className="flex items-center gap-2 text-slate-300"><CheckCircle2 size={15} className="text-emerald-300" />{l}</span><span className="text-slate-400">{v}</span></li>
              ))}
            </ul>
          </Panel>
          <Panel title="Pipeline de reconstrucción">
            <ul className="space-y-3 text-sm">
              {PIPE.map((p, i) => (
                <li key={p} className={`flex items-center gap-3 ${proc > i ? "text-white" : proc === i ? "text-cyan-200" : "text-slate-500"}`}>
                  {proc > i ? <CheckCircle2 size={16} className="text-emerald-300" /> : proc === i ? <Loader2 size={16} className="animate-spin" /> : <span className="h-4 w-4 rounded-full border border-slate-600" />}
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all duration-700" style={{ width: `${Math.max(0, proc) / PIPE.length * 100}%` }} /></div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
