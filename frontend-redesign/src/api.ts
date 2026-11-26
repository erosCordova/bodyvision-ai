// Native sandbox API. No credentials or database keys are embedded in the browser.
const ROOT = "https://bodyvision-ai-pruebas-api.onrender.com/api/v1";
export class ApiFailure extends Error { constructor(public status:number,message:string,public code:string=""){super(message);} }
export async function request<T>(path:string,token?:string,init:RequestInit={}):Promise<T>{
 const response=await fetch(ROOT+path,{...init,cache:"no-store",credentials:"omit",signal:AbortSignal.timeout(90000),headers:{"X-Correlation-ID":crypto.randomUUID(),...(token?{Authorization:"Bearer "+token}:{}),...(init.body&&typeof init.body==="string"?{"Content-Type":"application/json"}:{}),...init.headers}});
 if(!response.ok){const e=await response.json().catch(()=>({}));throw new ApiFailure(response.status,e.message||"El servidor rechazó la operación ("+response.status+").",e.code||"");}
 if(response.status===204)return undefined as T;
 return response.json();
}
export async function image(path:string,token:string):Promise<string>{
 const r=await fetch(ROOT+path,{headers:{Authorization:"Bearer "+token},cache:"no-store",signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new ApiFailure(r.status,"Fotografía no disponible.");
 const blob=await r.blob();if(blob.type!=="image/png")throw Error("Formato de imagen inesperado");
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=reject;reader.readAsDataURL(blob);});
}
export type Profile={id:string;display_code:string;display_name:string|null;birth_year:number;sex:string|null;status:"active"|"restricted"|"archived";created_at:string;synthetic:boolean};
export type Observation={id:string;profile_id:string;metric_code:string;value:number;unit:string;measured_at:string;method:"manual"|"device";instrument:string|null;notes:string|null;created_at:string};
export type Metric={code:string;label:string;unit:string;min_value:number;max_value:number;allowed_methods:string[]};
export type Capture={id:string;created_at:string;expires_at:string};
export type Role="administrator"|"specialist"|"member"|"privacy_officer";
export type Account={user_id:string;email:string;display_name:string;role:Role;created_at?:string;organization_id?:string};
export type Session={role:Role;token:string;user_id:string;organization_id:string;expires_at:string};
export type Page<T>={items:T[];total:number};
export async function all<T>(path:string,token:string){let result:T[]=[];for(let offset=0;;offset+=100){const page=await request<Page<T>>(path+(path.includes("?")?"&":"?")+"limit=100&offset="+offset,token);result.push(...page.items);if(result.length>=page.total||!page.items.length)return result;}}
export const json=(method:string,body:unknown):RequestInit=>({method,body:JSON.stringify(body)});
export async function saveObservation(token:string,profileId:string,body:Record<string,unknown>,correction?:string){
 const path=correction?"/measurements/"+correction:"/profiles/"+profileId+"/measurements";
 const payload={...body};const key=crypto.randomUUID();
 for(let attempt=0;attempt<3;attempt++){
  try{return await request<Observation>(path,token,{...json(correction?"PATCH":"POST",payload),headers:{"Idempotency-Key":key}});}
  catch(e){if(!(e instanceof ApiFailure)||!["DUPLICATE_CONFIRMATION_REQUIRED","OUTLIER_CONFIRMATION_REQUIRED"].includes(e.code))throw e;
   const flag=e.code==="DUPLICATE_CONFIRMATION_REQUIRED"?"duplicate_confirmed":"outlier_confirmed";
   if(payload[flag]||!window.confirm(e.message))throw e;payload[flag]=true;}
 }
 throw Error("No se pudo validar la medición.");
}
