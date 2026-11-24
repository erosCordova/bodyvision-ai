import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import "./private-access.css";

export function SandboxAccessPage() {
  const { session,login,logout }=usePrivateAuth();
  const navigate=useNavigate();
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");
    try{
      await login({organization_id:"10000000-0000-4000-8000-000000000001",email,password});
      setPassword("");navigate("/",{replace:true});
    }catch(cause){setPassword("");setError(cause instanceof Error?cause.message:"No se pudo ingresar.");}
    finally{setBusy(false);}
  }
  return <div className="private-access">
    <div className="private-access-intro"><span className="private-access-brand">BODYVISION <strong>AI</strong></span><h1>Espacio de pruebas</h1><p>Consulta y registra expedientes y mediciones ficticias en una base de datos aislada.</p><p>No introduzcas información personal real.</p></div>
    <main className="private-access-card">
      <p className="eyebrow">ACCESO DE ESPECIALISTA · PRUEBAS</p>
      {session?<><h2>Sesión activa</h2><p>Centro Horizonte (ficticio)</p><Link to="/">Entrar al espacio de trabajo</Link><button type="button" onClick={()=>void logout().then(ok=>{if(!ok)setError("No se confirmó la revocación remota.");})}>Cerrar sesión</button></>:<><h2>Iniciar sesión</h2><form onSubmit={submit}><label>Correo electrónico<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Contraseña<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></label><button type="submit" className="private-access-submit" disabled={busy}>{busy?"Verificando…":"Ingresar"}</button></form></>}
      {error&&<p role="alert">{error}</p>}
      <small>Sesión de cuatro horas, cierre por inactividad. Solo entorno sintético; las funciones privadas de producción no están habilitadas.</small>
    </main>
  </div>;
}
