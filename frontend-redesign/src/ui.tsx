import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { X } from "lucide-react";

export function Logo({ size = 30, text = true, className = "" }: { size?: number; text?: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="48" y2="48">
            <stop stopColor="#67e8f9" />
            <stop offset="1" stopColor="#3b82f6" />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r="21.5" stroke="url(#lg)" strokeWidth="2" opacity=".55" />
        <circle cx="24" cy="12" r="4.2" fill="url(#lg)" />
        <path d="M24 17.5c-4 0-8.5 1.2-12.5 4l1.8 2.6c3-1.7 6-2.4 8.4-2.5V30l-4.6 9.5 3 1.5L24 33l4 7 3-1.5L26.4 30v-8.4c2.4.1 5.4.8 8.4 2.5l1.8-2.6c-4-2.8-8.5-4-12.5-4Z" fill="url(#lg)" />
      </svg>
      {text && (
        <div className="leading-none">
          <div className="font-display text-[17px] font-bold tracking-tight text-white">
            BODY<span className="text-cyan-300">VISION</span> <span className="text-sky-400">AI</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Panel({ title, action, children, className = "", pad = true }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <h3 className="text-[15px] font-semibold text-white">{title}</h3>
          {action}
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

const tones: Record<string, string> = {
  ok: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30",
  warn: "bg-amber-400/10 text-amber-300 border-amber-400/30",
  bad: "bg-rose-400/10 text-rose-300 border-rose-400/30",
  info: "bg-sky-400/10 text-sky-300 border-sky-400/30",
  muted: "bg-slate-400/10 text-slate-300 border-slate-400/20",
};
export function Badge({ tone = "muted", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{children}</span>;
}

export function Btn({ variant = "ghost", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" | "danger" }) {
  const v = {
    primary: "btn-primary",
    ghost: "bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10",
    outline: "border border-cyan-400/40 text-cyan-200 hover:bg-cyan-400/10",
    danger: "bg-rose-500/15 text-rose-300 border border-rose-400/30 hover:bg-rose-500/25",
  }[variant];
  return <button {...p} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${v} ${className}`} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-cyan-400" : "bg-slate-700"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function Range({ label, value, min, max, step = 1, onChange, unit = "", right }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; unit?: string; right?: string }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span className="font-semibold text-cyan-300">{right ?? `${value > 0 && min < 0 ? "+" : ""}${value}${unit}`}</span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}

export function Segmented<T extends string>({ options, value, onChange, className = "" }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`inline-flex rounded-xl border border-white/10 bg-black/30 p-1 ${className}`}>
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${value === o.id ? "bg-cyan-400/90 text-slate-950 shadow" : "text-slate-300 hover:text-white"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const f = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className={`panel panel-glow max-h-[90vh] w-full overflow-auto ${wide ? "max-w-2xl" : "max-w-md"}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
          <h3 className="font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white md:text-[28px]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-slate-400">{sub}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const ini = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  const hue = (name.charCodeAt(0) * 37 + name.length * 19) % 360;
  return (
    <div className="grid shrink-0 place-items-center rounded-full font-semibold text-white" style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue} 70% 45%), hsl(${(hue + 50) % 360} 70% 35%))` }}>
      {ini}
    </div>
  );
}

export const chartTip = {
  contentStyle: { background: "#07111f", border: "1px solid #1d4568", borderRadius: 10, fontSize: 12, color: "#dbe7f5" },
  labelStyle: { color: "#7dd3fc" },
  cursor: { stroke: "#22d3ee33" },
};

export const estadoTone = (e: string) => (e === "Activo" ? "ok" : e === "En seguimiento" ? "info" : e === "Nuevo" ? "warn" : "muted");
