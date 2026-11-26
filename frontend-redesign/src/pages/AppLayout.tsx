import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Activity, Bell, Box, ChevronDown, FileText, FolderOpen, LayoutDashboard, LogOut, Menu, Ruler, ScanLine, Search, Settings, ShieldCheck, SlidersHorizontal, Sparkles, UserCheck, X, Lock } from "lucide-react";
import { motion } from "framer-motion";
import { Logo, Avatar, Modal, Btn, Toggle } from "../ui";
import { useStore } from "../store";
import {useConnection} from "../ConnectedProvider";

const NAV = [
  { to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/app/expedientes", label: "Expedientes", icon: FolderOpen },
  { to: "/app/mediciones", label: "Mediciones", icon: Ruler },
  { to: "/app/captura", label: "Captura corporal", icon: ScanLine },
  { to: "/app/analisis", label: "Análisis IA", icon: Sparkles },
  { to: "/app/vision-3d", label: "Visión 3D", icon: Box },
  { to: "/app/simulador", label: "Simulador", icon: SlidersHorizontal },
  { to: "/app/analitica", label: "Analítica", icon: Activity },
  { to: "/app/consentimientos", label: "Consentimientos", icon: UserCheck },
  { to: "/app/reportes", label: "Reportes", icon: FileText },
  { to: "/app/administracion", label: "Administración", icon: Settings },
];

const NOTIFS: {t:string;s:string}[] = [];

export default function AppLayout() {
  const { user, logout, patients, patient, select } = useStore();
  const {role}=useConnection();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const [menu, setMenu] = useState(false);
  const [sec, setSec] = useState(false);
  const [twofa, setTwofa] = useState(true);

  const side = (
    <aside className="flex h-full w-[260px] flex-col border-r border-white/5 bg-[#071120] px-4 py-5">
      <button onClick={() => nav("/")} className="mb-7 px-2 text-left">
        <Logo size={32} />
      </button>
      <nav className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {NAV.filter(n=>role==="privacy_officer"?n.to==="/app":n.to!=="/app/administracion"||role==="administrator").map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-xl border px-3.5 py-3 text-[14px] font-semibold transition ${
                isActive ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300 shadow-[0_0_24px_-10px_#22d3ee]" : "border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-100"
              }`
            }
          >
            <n.icon size={18} className="shrink-0 opacity-90" />
            {n.label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-4 border-t border-white/5 pt-4">
        <div className="rounded-xl border border-sky-400/25 bg-sky-400/5 p-3.5">
          <div className="flex items-center gap-2 text-[10.5px] font-bold uppercase tracking-wider text-sky-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_10px_#22d3ee]" />
            Área de trabajo
          </div>
          <div className="mt-1 text-[13px] text-slate-300">BodyVision AI</div>
        </div>
        <button onClick={() => setSec(true)} className="mt-3 flex items-center gap-2 px-1 text-[13px] text-slate-400 hover:text-white">
          <Lock size={14} /> Acceso y seguridad
        </button>
      </div>
    </aside>
  );

  return (
    <div className="flex min-h-screen bg-ink-950">
      <div className="fixed inset-y-0 left-0 z-30 hidden lg:block">{side}</div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0">{side}</div>
          <button className="absolute right-4 top-4 rounded-lg bg-white/10 p-2" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
      )}
      <div className="min-w-0 flex-1 lg:pl-[260px]">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/5 bg-ink-950/80 px-4 py-3 backdrop-blur-xl md:px-8">
          <button className="rounded-lg p-2 text-slate-300 hover:bg-white/10 lg:hidden" onClick={() => setOpen(true)} aria-label="Menú">
            <Menu size={20} />
          </button>
          <div className="relative hidden max-w-sm flex-1 md:block">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input className="field !rounded-xl !py-2 pl-9" placeholder="Buscar expediente, paciente o medición…" onKeyDown={(e) => e.key === "Enter" && nav("/app/expedientes")} />
          </div>
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-xs text-slate-500">Paciente activo</span>
              <select value={patient?.id||""} onChange={(e) => select(e.target.value)} className="field !w-auto !rounded-xl !py-1.5 !text-xs">
                {!patients.some(p=>p.estado==="Activo")&&<option value="">Sin expedientes activos</option>}
                {patients.filter(p=>p.estado==="Activo").map((p) => (
                  <option key={p.id} value={p.id} className="bg-slate-900">
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative">
              <button onClick={() => { setBell(!bell); setMenu(false); }} className="relative rounded-xl border border-white/10 bg-white/5 p-2.5 text-slate-300 hover:text-white" aria-label="Notificaciones">
                <Bell size={17} />
                {NOTIFS.length>0&&<span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-cyan-300" />}
              </button>
              {bell && (
                <div className="panel absolute right-0 mt-2 w-72 p-2">
                  {!NOTIFS.length&&<p className="p-3 text-xs text-slate-400">Sin notificaciones</p>}
                  {NOTIFS.map((n) => (
                    <div key={n.t} className="rounded-lg px-3 py-2.5 hover:bg-white/5">
                      <div className="text-sm text-white">{n.t}</div>
                      <div className="text-xs text-slate-500">{n.s}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button onClick={() => { setMenu(!menu); setBell(false); }} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 py-1.5 pl-1.5 pr-3">
                <Avatar name={user?.nombre || "Usuario"} size={30} />
                <span className="hidden text-sm font-medium text-white sm:block">{user?.nombre}</span>
                <ChevronDown size={14} className="text-slate-400" />
              </button>
              {menu && (
                <div className="panel absolute right-0 mt-2 w-56 p-2">
                  <div className="px-3 py-2 text-xs text-slate-500">{user?.email}</div>
                  <button onClick={() => { setMenu(false); setSec(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-white/5">
                    <ShieldCheck size={15} /> Acceso y seguridad
                  </button>
                  <button onClick={() => { logout(); nav("/login"); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10">
                    <LogOut size={15} /> Cerrar sesión
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <motion.main key={loc.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="px-4 py-6 md:px-8">
          <Outlet />
        </motion.main>
      </div>
      <Modal open={sec} onClose={() => setSec(false)} title="Acceso y seguridad">
        <div className="space-y-4 text-sm">
          <p className="text-sm text-slate-300">Sesión autenticada. El servicio actual solo admite datos de prueba; no introduzcas datos personales o clínicos reales.</p>
          <Btn variant="danger" className="w-full" onClick={() => { logout(); nav("/login"); }}>
            <LogOut size={16} /> Cerrar sesión
          </Btn>
        </div>
      </Modal>
    </div>
  );
}
