import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import "./private-access.css";

export function SandboxAccessPage() {
  const { session,login,logout }=usePrivateAuth();
  const navigate=useNavigate();
  const [register,setRegister]=useState(false);
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [confirmation,setConfirmation]=useState("");
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
        const response=await fetch("/api/v1/auth/register",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:email.trim(),password,synthetic_only:synthetic})});
        if(!response.ok){
          if(response.status===429)throw new Error("Demasiados intentos. Inténtalo más tarde.");
          if(response.status===409)throw new Error("No se pudo crear la cuenta. Si ya tienes una, inicia sesión.");
          throw new Error("No se pudo completar el registro. Revisa los datos.");
        }
        setRegister(false);setPassword("");setConfirmation("");setSynthetic(false);
        setNotice("Cuenta creada. Inicia sesión con tus credenciales.");
        return;
      }
      await login({organization_id:"10000000-0000-4000-8000-000000000001",email:email.trim(),password});
      setPassword("");navigate("/",{replace:true});
    }catch(cause){setPassword("");setConfirmation("");setError(cause instanceof Error?cause.message:"No se pudo ingresar.");}
    finally{setBusy(false);}
  }
  return <div className="private-access">
    <div className="private-access-intro"><span className="private-access-brand">BODYVISION <strong>AI</strong></span><h1>Tu espacio de pruebas</h1><p>Crea tu cuenta y explora expedientes y mediciones ficticias en un espacio aislado.</p><p>Tu cuenta empieza con un expediente de composición corporal.</p></div>
    <main className="private-access-card">
      <p className="eyebrow">ACCESO DE ESPECIALISTA · PRUEBAS</p>
      {session?<><h2>Sesión activa</h2><p>Espacio de pruebas</p><Link to="/">Entrar al espacio de trabajo</Link><button type="button" onClick={()=>void logout().then(ok=>{if(!ok)setError("No se confirmó la revocación remota.");})}>Cerrar sesión</button></>:<>
        <h2>{register?"Crear cuenta":"Iniciar sesión"}</h2>
        <form onSubmit={submit}>
          <label>Correo electrónico<input type="email" autoComplete="username" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}/></label>
          <label>Contraseña<input type="password" autoComplete={register?"new-password":"current-password"} required minLength={register?12:1} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)}/></label>
          {register&&<><label>Confirmar contraseña<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><label><input type="checkbox" required checked={synthetic} onChange={e=>setSynthetic(e.target.checked)}/> Usaré exclusivamente expedientes ficticios.</label><small>Usa un correo de pruebas y una contraseña exclusiva de al menos 12 caracteres. No se verifica la propiedad del correo.</small></>}
          <button type="submit" className="private-access-submit" disabled={busy}>{busy?"Procesando…":register?"Registrarme":"Ingresar"}</button>
        </form>
        <button type="button" disabled={busy} onClick={()=>{setRegister(!register);setPassword("");setConfirmation("");setError("");setNotice("");}}>{register?"Ya tengo cuenta · Iniciar sesión":"¿No tienes cuenta? Crear cuenta"}</button>
      </>}
      {notice&&<p role="status">{notice}</p>}
      {error&&<p role="alert">{error}</p>}
      <small>Solo entorno sintético; las funciones privadas de producción no están habilitadas.</small>
    </main>
  </div>;
}
