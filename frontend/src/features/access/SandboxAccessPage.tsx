import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePrivateAuth, waitForSandboxReady, PrivateAuthError } from "../../app/providers/PrivateAuthProvider";
import "./sandbox-access.css";

const AtlasPreview = lazy(() => import("../dashboard/DashboardBodyPreview").then(module => ({default:module.DashboardBodyPreview})));

function AccessIcon({name}:{name:"mail"|"lock"|"eye"|"eye-off"|"arrow"|"shield"|"check"|"scan"}) {
  const paths={mail:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/></>,lock:<><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/></>,eye:<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,"eye-off":<><path d="m3 3 18 18M10 5.2c.7-.1 1.3-.2 2-.2 6.5 0 10 7 10 7a18 18 0 0 1-3 3.8M6.5 6.5C3.5 8.6 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.5 4.5-1.2"/></>,arrow:<><path d="M4 12h15m-6-6 6 6-6 6"/></>,shield:<><path d="m12 3 8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/></>,check:<path d="m5 12 4 4L19 6"/>,scan:<><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M3 12h18"/></>};
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function AccessVisual(){
  const [wide,setWide]=useState(()=>window.matchMedia("(min-width: 901px)").matches);
  useEffect(()=>{const mq=window.matchMedia("(min-width: 901px)");const change=()=>setWide(mq.matches);mq.addEventListener("change",change);return()=>mq.removeEventListener("change",change);},[]);
  return <div className="bv-access-visual"><div className="bv-access-orbits" aria-hidden="true"><i/><i/><i/></div>{wide&&<Suspense fallback={<div className="bv-access-model-status">Cargando atlas…</div>}><AtlasPreview/></Suspense>}</div>;
}

export function SandboxAccessPage() {
  const { session,login,logout }=usePrivateAuth();
  const navigate=useNavigate();
  const [register,setRegister]=useState(false);
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [confirmation,setConfirmation]=useState("");
  const [showPassword,setShowPassword]=useState(false);
  const [showConfirmation,setShowConfirmation]=useState(false);
  const [synthetic,setSynthetic]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy)return;
    setError("");setNotice("");
    if(register && (password!==confirmation || password.length<12 || !synthetic)){
      setError("Confirma la contraseña (mínimo 12 caracteres) y el uso de datos ficticios.");return;
    }
    setBusy(true);
    try{
      if(register){
        await waitForSandboxReady();
        const response=await fetch("/api/v1/auth/register",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email.trim(),password,synthetic_only:synthetic})});
        if(!response.ok){
          if(response.status===429)throw new Error("Demasiados intentos. Inténtalo más tarde.");
          if(response.status===409)throw new Error("No se pudo crear la cuenta. Si ya tienes una, inicia sesión.");
          throw new Error("No se pudo completar el registro. Revisa los datos.");
        }
        setRegister(false);setPassword("");setConfirmation("");setSynthetic(false);setShowPassword(false);setShowConfirmation(false);
        setNotice("Cuenta creada. Inicia sesión con tus credenciales.");
        return;
      }
      await login({organization_id:"10000000-0000-4000-8000-000000000001",email:email.trim(),password});
      setPassword("");navigate("/",{replace:true});
    }catch(cause){if(cause instanceof PrivateAuthError && cause.code==="INVALID_CREDENTIALS"){setPassword("");setConfirmation("");}setError(cause instanceof TypeError?"No hay conexión con el servicio de pruebas. Inténtalo nuevamente.":cause instanceof Error?cause.message:"No se pudo ingresar.");}
    finally{setBusy(false);}
  }
  function switchMode(next:boolean){
    if(busy)return;
    setRegister(next);setPassword("");setConfirmation("");setSynthetic(false);setShowPassword(false);setShowConfirmation(false);setError("");setNotice("");
  }
  return <div className="bv-access">
    <header className="bv-access-top">
      <div className="bv-access-brand"><span className="bv-access-mark"><AccessIcon name="scan"/></span><div>BODYVISION <strong>AI</strong><small>Plataforma de análisis corporal</small></div></div>
      <span className="bv-access-environment"><i/> Entorno de pruebas</span>
    </header>
    <div className="bv-access-layout">
      <section className="bv-access-showcase" aria-label="BodyVision AI">
        <div className="bv-access-hero-copy"><p className="bv-access-kicker">ANÁLISIS CORPORAL INTELIGENTE</p><h1>El cuerpo humano,<br/>en otra dimensión<span>.</span></h1><p>Explora la anatomía 3D, la composición corporal y su evolución en un solo espacio.</p></div>
        <AccessVisual/>
        <div className="bv-access-visual-caption"><span><AccessIcon name="scan"/> Atlas anatómico interactivo</span><span>MODELO EDUCATIVO</span></div>
      </section>
      <main className="bv-access-card">
        {session?<><div className="bv-access-card-icon"><AccessIcon name="shield"/></div><h2>Sesión activa</h2><p className="bv-access-subtitle">Tu espacio de trabajo está listo.</p><Link className="bv-access-primary" to="/">Abrir dashboard <AccessIcon name="arrow"/></Link><button type="button" className="bv-access-switch" onClick={()=>void logout().then(ok=>{if(!ok)setError("No se confirmó la revocación remota.");})}>Cerrar sesión</button></>:<>
          <div className="bv-access-tabs" role="group" aria-label="Tipo de acceso"><button type="button" disabled={busy} aria-pressed={!register} onClick={()=>switchMode(false)}>Iniciar sesión</button><button type="button" disabled={busy} aria-pressed={register} onClick={()=>switchMode(true)}>Crear cuenta</button></div>
          <div className="bv-access-card-icon"><AccessIcon name={register?"shield":"lock"}/></div>
          <h2>{register?"Crea tu cuenta":"Bienvenido de nuevo"}</h2>
          <p className="bv-access-subtitle">{register?"Configura tu espacio de pruebas personal.":"Ingresa para continuar en tu espacio de trabajo."}</p>
          <form className="bv-access-form" onSubmit={submit}>
            <label htmlFor="bv-email">Correo electrónico</label><div className="bv-access-field"><AccessIcon name="mail"/><input id="bv-email" type="email" autoComplete="username" required maxLength={254} placeholder="correo@ejemplo.com" value={email} onChange={e=>setEmail(e.target.value)}/></div>
            <label htmlFor="bv-password">Contraseña</label><div className="bv-access-field"><AccessIcon name="lock"/><input id="bv-password" type={showPassword?"text":"password"} autoComplete={register?"new-password":"current-password"} required minLength={register?12:1} maxLength={128} placeholder={register?"Al menos 12 caracteres":"Introduce tu contraseña"} value={password} onChange={e=>setPassword(e.target.value)}/><button type="button" className="bv-access-eye" aria-label={showPassword?"Ocultar contraseña":"Mostrar contraseña"} onClick={()=>setShowPassword(v=>!v)}><AccessIcon name={showPassword?"eye-off":"eye"}/></button></div>
            {register&&<><div className="bv-access-password-rule" aria-live="polite"><span className={password.length>=12?"valid":""}><AccessIcon name="check"/> Mínimo 12 caracteres</span></div><label htmlFor="bv-confirmation">Confirmar contraseña</label><div className="bv-access-field"><AccessIcon name="lock"/><input id="bv-confirmation" type={showConfirmation?"text":"password"} autoComplete="new-password" required minLength={12} maxLength={128} placeholder="Repite tu contraseña" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/><button type="button" className="bv-access-eye" aria-label={showConfirmation?"Ocultar confirmación":"Mostrar confirmación"} onClick={()=>setShowConfirmation(v=>!v)}><AccessIcon name={showConfirmation?"eye-off":"eye"}/></button></div>
            <label className="bv-access-consent"><input type="checkbox" required checked={synthetic} onChange={e=>setSynthetic(e.target.checked)}/><span>Usaré exclusivamente expedientes ficticios.</span></label></>}
            {notice&&<p className="bv-access-message success" role="status">{notice}</p>}
            {error&&<p className="bv-access-message error" role="alert">{error}</p>}
            <button type="submit" className="bv-access-primary" disabled={busy}>{busy?<><span className="bv-access-spinner"/> Procesando…</>:<>{register?"Registrarme":"Ingresar"} <AccessIcon name="arrow"/></>}</button>
          </form>
          <div className="bv-access-bottom"><span>{register?"¿Ya tienes cuenta?":"¿No tienes cuenta?"}</span><button type="button" className="bv-access-switch" disabled={busy} onClick={()=>switchMode(!register)}>{register?"Iniciar sesión":"Crear cuenta"}</button></div>
        </>}
        {session&&error&&<p className="bv-access-message error" role="alert">{error}</p>}
        <div className="bv-access-security"><AccessIcon name="shield"/><span>{register?"Usa un correo de pruebas y una contraseña exclusiva. No se verifica el correo.":"Acceso protegido · Solo datos ficticios"}</span></div>
      </main>
    </div>
    <footer className="bv-access-footer"><span>© BODYVISION AI</span><span>Entorno educativo · No apto para uso clínico</span></footer>
  </div>;
}
