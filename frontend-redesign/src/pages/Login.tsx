import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck, User } from "lucide-react";
import { Logo, Btn } from "../ui";
import { useConnection } from "../ConnectedProvider";
import { BodyScene } from "../three/BodyScene";
import { BodyModel } from "../three/BodyModel";

type Mode = "login" | "register" | "recover";

export default function Login() {
  const nav = useNavigate();
  const { login } = useConnection();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();setErr("");setOk("");
    if(!/^\S+@\S+\.\S+$/.test(email))return setErr("Ingresa un correo electrónico válido.");
    if(mode==="recover")return setErr("Recuperación de contraseña no disponible.");
    if(mode==="register"&&pass.length<12)return setErr("La contraseña debe tener al menos 12 caracteres.");
    if(mode==="register"&&!window.confirm("El servicio actual solo admite datos e imágenes de prueba. No ingreses información personal o clínica real. ¿Aceptas continuar?"))return;
    setLoading(true);try{await login(email.trim(),pass,mode==="register");nav("/app",{replace:true});}catch(e){setErr(e instanceof Error?e.message:"No se pudo iniciar sesión.");}finally{setLoading(false);}
  };

  return (
    <div className="grid min-h-screen bg-ink-950 lg:grid-cols-2">
      <div className="relative flex flex-col justify-center px-6 py-10 sm:px-14">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-40" />
        <button onClick={() => nav("/")} className="absolute left-6 top-6 flex items-center gap-2 text-sm text-slate-400 hover:text-white sm:left-14">
          <ArrowLeft size={16} /> Volver al inicio
        </button>
        <div className="relative mx-auto w-full max-w-md">
          <div className="mb-8 flex justify-center">
            <Logo size={52} className="flex-col !gap-3 text-center [&_div]:text-[26px]" />
          </div>
          <div className="panel panel-glow p-7 sm:p-8">
            <h1 className="font-display text-2xl font-bold text-white">
              {mode === "login" ? "Accede a tu cuenta" : mode === "register" ? "Crea tu cuenta" : "Recupera tu acceso"}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {mode === "login" ? "Plataforma de análisis corporal inteligente." : mode === "register" ? "Crea tu cuenta." : "Recuperación no disponible."}
            </p>
            <form onSubmit={submit} className="mt-6 space-y-4">
              {false && mode === "register" && (
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-400">Nombre completo</span>
                  <div className="relative">
                    <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input className="field pl-9" value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Nombre Apellido" />
                  </div>
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs text-slate-400">Correo electrónico</span>
                <div className="relative">
                  <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input className="field pl-9" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@ejemplo.com" autoComplete="email" />
                </div>
              </label>
              {mode !== "recover" && (
                <label className="block">
                  <span className="mb-1.5 block text-xs text-slate-400">Contraseña</span>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input className="field px-9" type={show ? "text" : "password"} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
                    <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white" aria-label="Mostrar contraseña">
                      {show ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>
              )}
              {mode === "login" && (
                <div className="flex items-center justify-between text-xs">
                  <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                    <input type="checkbox" checked={false} disabled className="h-4 w-4 accent-cyan-400" />
                    Recordarme (no disponible)
                  </label>
                  <button type="button" onClick={() => setMode("recover")} className="text-cyan-300 hover:underline">
                    ¿Olvidaste tu contraseña?
                  </button>
                </div>
              )}
              {err && <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>}
              {ok && <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{ok}</div>}
              <Btn type="submit" variant="primary" className="w-full !py-3" disabled={loading}>
                {loading ? "Verificando…" : mode === "login" ? "Iniciar Sesión" : mode === "register" ? "Crear cuenta" : "Enviar enlace"}
              </Btn>
            </form>
            <p className="mt-5 text-center text-sm text-slate-400">
              {mode === "login" ? (
                <>
                  ¿No tienes cuenta?{" "}
                  <button onClick={() => setMode("register")} className="font-medium text-cyan-300 hover:underline">
                    Regístrate
                  </button>
                </>
              ) : (
                <button onClick={() => setMode("login")} className="font-medium text-cyan-300 hover:underline">
                  Ya tengo cuenta · Iniciar sesión
                </button>
              )}
            </p>
          </div>
          <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-slate-500">
            <ShieldCheck size={14} className="text-cyan-300" /> Acceso a tu cuenta
          </p>
        </div>
      </div>
      <div className="relative hidden overflow-hidden lg:block">
        <BodyScene className="absolute inset-0 h-full w-full" distance={5.4} autoRotate rotateSpeed={1.2} sparkles={false}><BodyModel sex="male" mode="holo" /></BodyScene>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/20 to-transparent" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950/90 via-transparent to-transparent" />
        <div className="absolute bottom-14 left-12 right-12">
          <div className="panel panel-glow max-w-md p-5">
            <div className="text-xs uppercase tracking-widest text-cyan-300">Análisis · Simulación · Transformación</div>
            <p className="mt-2 font-display text-2xl font-semibold leading-snug text-white">Tu cuerpo, en tus manos.</p>
            <p className="mt-1 text-sm text-slate-300">Visualización anatómica 3D y simulación orientativa de cambios corporales.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
