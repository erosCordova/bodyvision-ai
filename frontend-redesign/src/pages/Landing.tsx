import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Activity, ArrowRight, BarChart3, Box, Brain, Camera, Check, ChevronDown, Cloud, Cpu, Database, Layers, Menu, Monitor, Play, Server, ShieldCheck, Smartphone, Sparkles, X, Zap } from "lucide-react";
import { Logo, Segmented } from "../ui";
import { BodyScene } from "../three/BodyScene";
import { BodyModel, type Mode } from "../three/BodyModel";
import type { Sex } from "../three/assets";
import man from "../assets/img/man.jpg";
import man2 from "../assets/img/man2.jpg";
import woman from "../assets/img/woman.jpg";

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-60px" }} transition={{ duration: 0.6, delay }}>
      {children}
    </motion.div>
  );
}

const MODES: { id: Mode; label: string }[] = [
  { id: "skin", label: "Realista" },
  { id: "muscle", label: "Músculos" },
  { id: "skeleton", label: "Esqueleto" },
  { id: "xray", label: "Rayos X" },
  { id: "thermal", label: "Mapa IA" },
  { id: "holo", label: "Holograma" },
];

const FEATURES = [
  { i: Camera, t: "Captura corporal guiada", d: "Fotografías frontal, lateral y posterior con detección de pose en tiempo real y control de calidad automático." },
  { i: Box, t: "Reconstrucción 3D realista", d: "Malla anatómica de alta resolución con piel, musculatura y esqueleto interactivo. Rotación 360° y cortes por capas." },
  { i: Brain, t: "Análisis con IA", d: "IMC, peso ideal, grasa y masa muscular segmentada por regiones con mapas térmicos y recomendaciones." },
  { i: Zap, t: "Simulador de cambios", d: "Proyecta pérdida de grasa o ganancia muscular y visualiza el antes y después sobre el modelo 3D del paciente." },
  { i: BarChart3, t: "Analítica y reportes", d: "Evolución por paciente y cohortes, reportes PDF/CSV y tableros listos para tu consulta o gimnasio." },
  { i: ShieldCheck, t: "Privacidad y consentimientos", d: "Gestión de consentimientos, cifrado de extremo a extremo y registro de auditoría conforme a RGPD." },
];

const PHASES = [
  { n: 1, t: "MVP Base", d: "Auth, Dashboard, expedientes", s: "Completado", c: "bg-emerald-400" },
  { n: 2, t: "Captura y Análisis", d: "MediaPipe, mediciones", s: "En proceso", c: "bg-amber-400" },
  { n: 3, t: "Simulación Avanzada", d: "Cambios corporales 3D", s: "Q3 2025", c: "bg-sky-400" },
  { n: 4, t: "IA Predictiva", d: "Resultados personalizados", s: "Q4 2025", c: "bg-violet-400" },
  { n: 5, t: "App Móvil y Despliegue", d: "iOS · Android · Cloud", s: "2026", c: "bg-fuchsia-400" },
];

const PLANS = [
  { n: "Starter", p: "29", d: "Para profesionales independientes", f: ["Hasta 50 expedientes", "Captura y mediciones", "Visor 3D básico", "Reportes CSV"], hl: false },
  { n: "Pro", p: "89", d: "Consultas y clínicas en crecimiento", f: ["Expedientes ilimitados", "Análisis IA + mapa térmico", "Simulador de cambios 3D", "Reportes PDF personalizados", "Soporte prioritario"], hl: true },
  { n: "Enterprise", p: "Contacto", d: "Cadenas de gimnasios y hospitales", f: ["SSO y roles avanzados", "API y webhooks", "Despliegue on-premise / cloud", "SLA 99.9% y onboarding"], hl: false },
];

const FAQ = [
  ["¿Qué precisión tiene el análisis corporal?", "Las mediciones derivadas de la reconstrucción 3D alcanzan un 98.7% de concordancia frente a antropometría manual en nuestras validaciones internas."],
  ["¿Necesito equipo especial para capturar?", "No. Basta con la cámara de un teléfono o webcam y 3 fotografías guiadas. El sistema comprueba iluminación, distancia y postura."],
  ["¿Cómo se protegen los datos de mis pacientes?", "Cifrado AES-256 en reposo y TLS 1.3 en tránsito, consentimientos explícitos por paciente y registro de auditoría completo."],
  ["¿Puedo integrarlo con mi sistema actual?", "Sí. La API REST (FastAPI) y los webhooks permiten integrar expedientes, mediciones y reportes con tu software."],
];

export default function Landing() {
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>("skin");
  const [sex, setSex] = useState<Sex>("male");
  const [fat, setFat] = useState(0);
  const [menu, setMenu] = useState(false);
  const [faq, setFaq] = useState(0);
  const links = [["caracteristicas", "Características"], ["visor", "Visor 3D"], ["arquitectura", "Arquitectura"], ["fases", "Roadmap"], ["precios", "Precios"], ["faq", "FAQ"]];

  return (
    <div className="relative overflow-x-hidden bg-ink-950">
      {/* NAV */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5">
          <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            <Logo size={34} />
          </button>
          <nav className="hidden items-center gap-7 text-sm text-slate-300 lg:flex">
            {links.map(([id, l]) => (
              <button key={id} onClick={() => go(id)} className="transition hover:text-cyan-300">
                {l}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={() => nav("/login")} className="hidden text-sm text-slate-200 hover:text-white sm:block">
              Iniciar sesión
            </button>
            <button onClick={() => nav("/login")} className="btn-primary rounded-xl px-4 py-2 text-sm">
              Solicitar demo
            </button>
            <button className="rounded-lg p-2 text-slate-300 lg:hidden" onClick={() => setMenu(!menu)} aria-label="Menú">
              {menu ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
        {menu && (
          <div className="flex flex-col gap-1 border-t border-white/5 px-5 py-3 lg:hidden">
            {links.map(([id, l]) => (
              <button key={id} onClick={() => { go(id); setMenu(false); }} className="py-2 text-left text-slate-200">
                {l}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* HERO */}
      <section className="relative pt-24">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="pointer-events-none absolute -left-40 top-20 h-[500px] w-[500px] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="pointer-events-none absolute -right-40 top-40 h-[500px] w-[500px] rounded-full bg-indigo-500/15 blur-[120px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-8 px-5 pb-16 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3.5 py-1.5 text-xs font-medium uppercase tracking-widest text-cyan-200">
                <Sparkles size={13} /> Análisis · Simulación · Transformación
              </span>
              <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight text-white md:text-6xl xl:text-7xl">
                Tu cuerpo, <span className="text-grad">en 3D y con IA</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
                BodyVision AI reconstruye el cuerpo de tus pacientes en un gemelo digital anatómico, analiza su composición con inteligencia artificial y simula cómo cambiará su físico, semana a semana.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button onClick={() => nav("/login")} className="btn-primary flex items-center gap-2 rounded-xl px-6 py-3.5 text-[15px]">
                  Probar la plataforma <ArrowRight size={17} />
                </button>
                <button onClick={() => go("visor")} className="flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 text-[15px] text-white transition hover:bg-white/10">
                  <Play size={16} className="text-cyan-300" /> Ver visor 3D
                </button>
              </div>
              <div className="mt-10 grid max-w-lg grid-cols-3 gap-4">
                {[["247+", "Expedientes"], ["98.7%", "Precisión"], ["< 2 min", "Por análisis"]].map(([v, l]) => (
                  <div key={l}>
                    <div className="font-display text-2xl font-bold text-white">{v}</div>
                    <div className="text-xs text-slate-400">{l}</div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
          <Reveal delay={0.15}>
            <div className="panel panel-glow relative overflow-hidden rounded-3xl">
              <BodyScene className="h-[560px] md:h-[660px]" distance={5.4} autoRotate rotateSpeed={1.4}>
                <BodyModel sex={sex} mode={mode} fat={fat} mus={fat < 0 ? -fat * 0.35 : 0} />
              </BodyScene>
              <div className="absolute left-4 top-4 flex flex-col gap-2">
                <Segmented value={sex} onChange={setSex} options={[{ id: "male", label: "Hombre" }, { id: "female", label: "Mujer" }]} />
              </div>
              <div className="floaty absolute right-4 top-4 hidden rounded-xl border border-cyan-400/30 bg-slate-950/70 px-3.5 py-2.5 backdrop-blur sm:block">
                <div className="text-[10px] uppercase tracking-wider text-cyan-300">IA · en vivo</div>
                <div className="font-display text-lg font-bold text-white">{(24 + fat).toFixed(1)}% grasa</div>
              </div>
              <div className="absolute inset-x-3 bottom-3 space-y-3 rounded-2xl border border-white/10 bg-slate-950/70 p-3 backdrop-blur">
                <div className="flex flex-wrap gap-1.5">
                  {MODES.map((m) => (
                    <button key={m.id} onClick={() => setMode(m.id)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${mode === m.id ? "bg-cyan-400 text-slate-950" : "bg-white/5 text-slate-300 hover:bg-white/10"}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-300">
                  <span className="w-24 shrink-0">Simular grasa</span>
                  <input type="range" className="flex-1" min={-12} max={22} value={fat} onChange={(e) => setFat(+e.target.value)} />
                  <span className="w-10 text-right font-semibold text-cyan-300">{fat > 0 ? "+" : ""}{fat}%</span>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* LOGOS / TRUST */}
      <section className="border-y border-white/5 bg-white/[0.02] py-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-12 gap-y-4 px-5 text-sm text-slate-400">
          <span className="text-xs uppercase tracking-widest text-slate-500">Tecnología de confianza</span>
          {["React + Three.js", "FastAPI · Python", "PostgreSQL", "MediaPipe Pose", "Autodesk Maya", "RGPD · HIPAA ready"].map((t) => (
            <span key={t} className="font-display font-medium text-slate-300">{t}</span>
          ))}
        </div>
      </section>

      {/* HOW */}
      <section className="mx-auto max-w-7xl px-5 py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-4xl font-bold text-white">De una foto a un <span className="text-grad">gemelo digital</span></h2>
          <p className="mt-4 text-slate-400">Cuatro pasos, sin hardware especializado.</p>
        </Reveal>
        <div className="mt-14 grid gap-5 md:grid-cols-4">
          {[[Camera, "1. Captura", "3 fotografías guiadas con la cámara del móvil o webcam."], [Layers, "2. Reconstrucción", "Pose, silueta y malla 3D anatómica en segundos."], [Brain, "3. Análisis IA", "Composición corporal, mapa térmico y recomendaciones."], [Zap, "4. Simulación", "Proyecta resultados y compáralos con el estado actual."]].map(([I, t, d], i) => {
            const Icon = I as typeof Camera;
            return (
              <Reveal key={String(t)} delay={i * 0.08}>
                <div className="panel relative h-full p-6">
                  <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
                    <Icon size={22} />
                  </div>
                  <h3 className="font-display text-lg font-semibold text-white">{String(t)}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{String(d)}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* FEATURES */}
      <section id="caracteristicas" className="relative border-y border-white/5 bg-gradient-to-b from-ink-900 to-ink-950 py-24">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-widest text-cyan-300">Plataforma completa</div>
            <h2 className="mt-3 font-display text-4xl font-bold text-white">Todo lo que necesitas para una consulta de nueva generación</h2>
          </Reveal>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.t} delay={(i % 3) * 0.07}>
                <div className="panel group h-full p-6 transition hover:-translate-y-1 hover:border-cyan-400/40">
                  <f.i className="mb-4 text-cyan-300" size={26} />
                  <h3 className="font-display text-lg font-semibold text-white">{f.t}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* VISOR + RESULTS */}
      <section id="visor" className="mx-auto max-w-7xl px-5 py-24">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <Reveal>
            <div className="grid grid-cols-2 gap-4">
              <div className="relative overflow-hidden rounded-2xl border border-white/10">
                <img src={man2} alt="Paciente hombre" className="h-[420px] w-full object-cover object-top" />
                <div className="scanline" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 to-transparent" />
                <div className="absolute bottom-3 left-3 text-xs"><span className="rounded bg-cyan-400/90 px-2 py-0.5 font-semibold text-slate-950">Escaneando…</span></div>
              </div>
              <div className="mt-10 overflow-hidden rounded-2xl border border-white/10">
                <img src={woman} alt="Paciente mujer" className="h-[420px] w-full object-cover object-top" />
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="text-xs font-semibold uppercase tracking-widest text-cyan-300">Resultados y beneficios</div>
            <h2 className="mt-3 font-display text-4xl font-bold text-white">Experiencia premium para tus pacientes</h2>
            <p className="mt-4 text-slate-400">Un modelo 3D que se ve y se comporta como el paciente real aumenta la adherencia y la motivación.</p>
            <ul className="mt-8 space-y-4">
              {["Análisis corporal de precisión", "Simulación visual avanzada", "Experiencia premium con visor 3D interactivo", "Tecnología de vanguardia: IA + Pose + Anatomía 3D", "Aplicación multiplataforma web y móvil"].map((t) => (
                <li key={t} className="flex items-center gap-3 text-slate-200">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><Check size={14} /></span>
                  {t}
                </li>
              ))}
            </ul>
            <button onClick={() => nav("/login")} className="btn-primary mt-9 inline-flex items-center gap-2 rounded-xl px-6 py-3">
              Explorar la demo <ArrowRight size={16} />
            </button>
          </Reveal>
        </div>
      </section>

      {/* ARQUITECTURA */}
      <section id="arquitectura" className="border-y border-white/5 bg-ink-900 py-24">
        <div className="mx-auto max-w-7xl px-5">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-4xl font-bold text-white">Arquitectura del sistema</h2>
            <p className="mt-4 text-slate-400">Moderna, modular y lista para escalar.</p>
          </Reveal>
          <div className="mt-14 grid items-center gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr]">
            {[[Monitor, "Usuario", "Web / Móvil"], [Layers, "Frontend", "React + Three.js"], [Zap, "API FastAPI", "Python"], [Database, "PostgreSQL", "Base de datos"]].flatMap(([I, t, s], i) => {
              const Icon = I as typeof Monitor;
              const card = (
                <Reveal key={String(t)} delay={i * 0.08}>
                  <div className="panel p-5 text-center">
                    <Icon className="mx-auto mb-3 text-cyan-300" size={30} />
                    <div className="font-display font-semibold text-white">{String(t)}</div>
                    <div className="text-xs text-slate-400">{String(s)}</div>
                  </div>
                </Reveal>
              );
              return i < 3 ? [card, <ArrowRight key={"a" + i} className="mx-auto hidden text-cyan-400 md:block" />] : [card];
            })}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {[[Activity, "MediaPipe", "Pose IA"], [Cpu, "Maya 3D", "Modelado"], [Sparkles, "Simulador", "IA avanzada"], [Cloud, "Analytics", "Big Data"]].map(([I, t, s]) => {
              const Icon = I as typeof Monitor;
              return (
                <div key={String(t)} className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4 text-center">
                  <Icon className="mx-auto mb-2 text-sky-300" size={22} />
                  <div className="text-sm font-semibold text-white">{String(t)}</div>
                  <div className="text-xs text-slate-400">{String(s)}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3 text-sm text-slate-300">
            {[[Server, "Despliegue en contenedores"], [ShieldCheck, "Cifrado y auditoría"], [Smartphone, "Apps iOS / Android"]].map(([I, t]) => {
              const Icon = I as typeof Monitor;
              return (
                <div key={String(t)} className="flex items-center justify-center gap-2 rounded-xl bg-white/[0.03] py-3"><Icon size={16} className="text-cyan-300" />{String(t)}</div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FASES */}
      <section id="fases" className="mx-auto max-w-7xl px-5 py-24">
        <Reveal className="max-w-2xl">
          <div className="text-xs font-semibold uppercase tracking-widest text-cyan-300">Roadmap</div>
          <h2 className="mt-3 font-display text-4xl font-bold text-white">Fases de desarrollo</h2>
        </Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-5">
          {PHASES.map((p, i) => (
            <Reveal key={p.n} delay={i * 0.07}>
              <div className="panel h-full p-5">
                <div className={`mb-4 grid h-10 w-10 place-items-center rounded-xl font-display text-lg font-bold text-slate-950 ${p.c}`}>{p.n}</div>
                <div className="font-display font-semibold text-white">{p.t}</div>
                <div className="mt-1 text-sm text-slate-400">{p.d}</div>
                <div className="mt-4 text-xs font-medium text-cyan-300">{p.s}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* PRECIOS */}
      <section id="precios" className="border-t border-white/5 bg-gradient-to-b from-ink-950 to-ink-900 py-24">
        <div className="mx-auto max-w-6xl px-5">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-4xl font-bold text-white">Planes simples y transparentes</h2>
            <p className="mt-4 text-slate-400">14 días de prueba gratuita. Sin tarjeta.</p>
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-3">
            {PLANS.map((p, i) => (
              <Reveal key={p.n} delay={i * 0.08}>
                <div className={`panel relative h-full p-7 ${p.hl ? "panel-glow !border-cyan-400/50 md:-translate-y-3" : ""}`}>
                  {p.hl && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-cyan-400 px-3 py-1 text-[11px] font-bold uppercase text-slate-950">Más popular</span>}
                  <div className="font-display text-xl font-semibold text-white">{p.n}</div>
                  <div className="mt-1 text-sm text-slate-400">{p.d}</div>
                  <div className="my-6 font-display text-4xl font-bold text-white">{p.p === "Contacto" ? "A medida" : <>${p.p}<span className="text-base font-normal text-slate-400"> /mes</span></>}</div>
                  <ul className="space-y-3 text-sm text-slate-300">
                    {p.f.map((f) => (
                      <li key={f} className="flex items-center gap-2"><Check size={15} className="text-cyan-300" />{f}</li>
                    ))}
                  </ul>
                  <button onClick={() => nav("/login")} className={`mt-8 w-full rounded-xl py-3 text-sm font-semibold ${p.hl ? "btn-primary" : "border border-white/15 bg-white/5 text-white hover:bg-white/10"}`}>
                    {p.p === "Contacto" ? "Hablar con ventas" : "Empezar prueba"}
                  </button>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-5 py-24">
        <Reveal><h2 className="text-center font-display text-4xl font-bold text-white">Preguntas frecuentes</h2></Reveal>
        <div className="mt-10 space-y-3">
          {FAQ.map(([q, a], i) => (
            <div key={q} className="panel overflow-hidden">
              <button onClick={() => setFaq(faq === i ? -1 : i)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium text-white">
                {q}
                <ChevronDown size={18} className={`shrink-0 text-cyan-300 transition ${faq === i ? "rotate-180" : ""}`} />
              </button>
              {faq === i && <div className="px-5 pb-5 text-sm leading-relaxed text-slate-400">{a}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 pb-20">
        <div className="panel panel-glow relative mx-auto max-w-5xl overflow-hidden px-8 py-14 text-center">
          <img src={man} alt="" className="absolute inset-0 h-full w-full object-cover opacity-15" />
          <div className="relative">
            <h2 className="font-display text-4xl font-bold text-white">El futuro del análisis corporal</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-300">Tu cuerpo, en tus manos. Descubre BodyVision AI con una consulta de demostración completa.</p>
            <button onClick={() => nav("/login")} className="btn-primary mt-8 inline-flex items-center gap-2 rounded-xl px-8 py-3.5">
              Acceder a la demo <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5 py-10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 text-sm text-slate-500">
          <Logo size={26} />
          <span>© 2025 BodyVision AI · Versión 1.0.0 · Datos y pacientes ficticios con fines de demostración.</span>
        </div>
      </footer>
    </div>
  );
}
