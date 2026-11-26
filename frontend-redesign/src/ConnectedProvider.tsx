import {createContext,useContext,useState,useEffect,useCallback,useRef,type ReactNode} from "react";
import {Ctx,type Store,type Patient,type Medicion} from "./store";
import {request,all,image,json,ApiFailure,type Profile,type Observation,type Metric,type Capture,type Session} from "./api";
type RecordData={profile:Profile;observations:Observation[];captures:Capture[];photo?:string};
type Connection={token:string|null;records:RecordData[];catalog:Metric[];busy:boolean;error:string;login:(email:string,password:string,register:boolean)=>Promise<void>;logout:()=>Promise<void>;refresh:()=>Promise<void>;run:<T>(fn:(token:string)=>Promise<T>)=>Promise<T>;selected:RecordData|undefined};
const ConnectionCtx=createContext<Connection>(null!);
export const useConnection=()=>useContext(ConnectionCtx);
function toPatient(r:RecordData):Patient {
 const p=r.profile, val=(code:string)=>r.observations.find(o=>o.metric_code===code)?.value??NaN;
 const weight=val("weight"), muscle=val("muscle_mass_kg");
 return {id:p.id,nombre:p.display_name||p.display_code,edad:new Date().getFullYear()-p.birth_year,sexo:p.sex==="female"?"female":"male",altura:val("height"),peso:weight,grasa:val("body_fat_pct"),musculo:weight>0?100*muscle/weight:NaN,tono:"medio",objetivo:"No registrado",estado:p.status==="archived"?"Alta":p.status==="restricted"?"En seguimiento":"Activo",ultima:new Date(p.created_at).toLocaleDateString("es-PE"),email:"",foto:r.photo};
}
function toMeasurements(r:RecordData):Medicion[]{
 const fields:Record<string,string>={weight:"peso",waist:"cintura",hip:"cadera",chest:"pecho",arm:"brazo",thigh:"muslo",body_fat_pct:"grasa"};
 const groups=new Map<string,Medicion>();
 for(const o of r.observations){const field=fields[o.metric_code];if(!field)continue;const k=o.measured_at;let m=groups.get(k);if(!m){m={id:o.id,patientId:r.profile.id,paciente:r.profile.display_name||r.profile.display_code,fecha:new Date(k).toLocaleDateString("es-PE"),peso:NaN,cintura:NaN,cadera:NaN,pecho:NaN,brazo:NaN,muslo:NaN,grasa:NaN,fuente:"Manual"};groups.set(k,m);}if(!Number.isFinite((m as any)[field]))(m as any)[field]=o.value;}
 return [...groups.values()];
}
export function ConnectedProvider({children}:{children:ReactNode}){
 const [session,setSession]=useState<Session|null>(null), [user,setUser]=useState<Store["user"]>(null),[records,setRecords]=useState<RecordData[]>([]),[catalog,setCatalog]=useState<Metric[]>([]),[selectedId,setSelectedId]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[toasts,setToasts]=useState<Store["toasts"]>([]);
 const active=useRef<string|null>(null);
 const toast=useCallback((msg:string)=>{const id=Date.now()+Math.random();setToasts(t=>[...t,{id,msg}]);setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),4500);},[]);
 const clear=()=>{active.current=null;setSession(null);setUser(null);setRecords([]);setCatalog([]);setSelectedId("");};
 const run=async<T,>(fn:(token:string)=>Promise<T>):Promise<T>=>{const token=active.current;if(!token)throw Error("Inicia sesión");try{return await fn(token);}catch(e){if(e instanceof ApiFailure&&e.status===401){clear();toast("Sesión caducada. Inicia sesión.");}throw e;}};
 const load=async(token:string)=>{
   const [profiles,metrics]=await Promise.all([all<Profile>("/profiles",token),request<Metric[]>("/metrics/catalog",token)]);
   const result:RecordData[]=[];
   for(let i=0;i<profiles.length;i+=4){result.push(...await Promise.all(profiles.slice(i,i+4).map(async p=>{
     if(!p.synthetic)throw Error("El entorno solo admite expedientes ficticios");
     const observations=await all<Observation>("/profiles/"+p.id+"/measurements",token);
     let captures:Capture[]=[],photo:string|undefined;
     if(p.status==="active"){try{captures=(await request<{items:Capture[]}>("/profiles/"+p.id+"/captures",token)).items;if(captures.length)photo=await image("/profiles/"+p.id+"/captures/"+captures[0].id,token);}catch(e){if(e instanceof ApiFailure&&e.status===401)throw e;}}
     return {profile:p,observations,captures,photo};
   })));}
   if(active.current!==token)return;
   setRecords(result);setCatalog(metrics);setSelectedId(old=>result.some(r=>r.profile.id===old&&r.profile.status==="active")?old:result.find(r=>r.profile.status==="active")?.profile.id||"");
 };
 const refresh=async()=>{setBusy(true);setError("");try{await run(load);}catch(e){setError(e instanceof Error?e.message:String(e));throw e;}finally{setBusy(false);}};
 const login=async(email:string,password:string,register:boolean)=>{
   if(register)await request("/auth/register",undefined,json("POST",{email,password,synthetic_only:true}));
   // The shared LoginInput requires organization_id; sandbox resolves the actual tenant exclusively from verified account credentials.
   const next=await request<Session>("/auth/login",undefined,json("POST",{organization_id:"10000000-0000-4000-8000-000000000001",email,password}));
   active.current=next.token;setBusy(true);setError("");
   try{await load(next.token);if(active.current!==next.token)throw Error("Sesión cancelada");setSession(next);setUser({nombre:email.split("@")[0],email});}
   catch(e){clear();void request("/auth/logout",next.token,{method:"POST"}).catch(()=>{});throw e;}finally{setBusy(false);}
 };
 const logout=async()=>{const token=active.current;clear();if(token)try{await request("/auth/logout",token,{method:"POST"});}catch{toast("Sesión local cerrada; no se confirmó la revocación remota.");}};
 useEffect(()=>{if(!session)return;let last=0;const activity=()=>{const now=Date.now();if(now-last<60000)return;last=now;void run(t=>request("/auth/activity",t,{method:"POST"})).catch(()=>{});};window.addEventListener("pointerdown",activity);window.addEventListener("keydown",activity);return()=>{window.removeEventListener("pointerdown",activity);window.removeEventListener("keydown",activity);};},[session]);
 const patients=records.map(toPatient), selected=records.find(r=>r.profile.id===selectedId),patient=patients.find(p=>p.id===selectedId);
 const disabled=()=>{toast("Operación no habilitada en el servidor de pruebas");return false;};
 const value:Store={user,login:()=>{throw Error("Usa el acceso autenticado");},logout:()=>{void logout();},patients,selectedId,select:id=>{if(records.some(r=>r.profile.id===id&&r.profile.status==="active"))setSelectedId(id);},patient:patient as Patient,mediciones:records.flatMap(toMeasurements),consents:[],reports:[],addPatient:disabled,updatePatient:disabled,deletePatient:disabled,addMedicion:disabled,updateMedicion:disabled,deleteMedicion:disabled,setConsents:disabled,setReports:disabled,toast,toasts};
 return <ConnectionCtx.Provider value={{token:session?.token??null,records,catalog,busy,error,login,logout,refresh,run,selected}}><Ctx.Provider value={value}>{children}</Ctx.Provider></ConnectionCtx.Provider>;
}
