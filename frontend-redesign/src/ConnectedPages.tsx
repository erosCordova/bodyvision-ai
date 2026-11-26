import {useState,type ReactNode} from "react";
import {useNavigate,Link} from "react-router-dom";
import {Plus,Pencil,Archive,Download,Upload,Trash2,RefreshCw} from "lucide-react";
import {Btn,Panel,PageHead,Modal,Badge} from "./ui";
import {useStore} from "./store";
import {useConnection} from "./ConnectedProvider";
import {request,json,saveObservation,image,type Profile,type Observation,type Metric,type Capture} from "./api";


// Re-encode to a small non-interlaced PNG and retain only the mandatory chunks.
// The server independently validates every chunk, CRC, dimensions and payload.
async function syntheticPng(file:File):Promise<Blob>{
 if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>10*1024*1024)throw Error("Selecciona JPG, PNG o WEBP de hasta 10 MB.");
 const bitmap=await createImageBitmap(file);
 try{
  for(const size of [512,384,256,192,128]){
   const canvas=document.createElement("canvas"),scale=Math.min(1,size/Math.max(bitmap.width,bitmap.height));
   canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
   const ctx=canvas.getContext("2d");if(!ctx)throw Error("No se pudo convertir la imagen.");
   ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error("Conversión PNG fallida")),"image/png"));
   const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),parts:Uint8Array[]=[bytes.slice(0,8)];
   for(let i=8;i+12<=bytes.length;){const n=view.getUint32(i),end=i+n+12;if(end>bytes.length)throw Error("PNG inválido");const name=String.fromCharCode(...bytes.slice(i+4,i+8));if(["IHDR","IDAT","IEND"].includes(name))parts.push(bytes.slice(i,end));i=end;if(name==="IEND")break;}
   const result=new Blob(parts,{type:"image/png"});if(result.size<=262144)return result;
  }
  throw Error("No se pudo reducir la imagen a 256 KiB.");
 }finally{bitmap.close();}
}
export async function uploadPhoto(token:string,profileId:string,file:File){const png=await syntheticPng(file);return request("/profiles/"+profileId+"/captures",token,{method:"POST",body:png,headers:{"Content-Type":"image/png","X-Synthetic-Only":"confirmed"}});}

export function useAction(){
 const {refresh,run}=useConnection(),{toast}=useStore();
 const [pending,setPending]=useState(false);
 const action=async(fn:(token:string)=>Promise<unknown>,message:string)=>{
  setPending(true);let saved=false;
  try{await run(fn);saved=true;await refresh();toast(message);return true;}
  catch(e){toast((saved?"Guardado, pero no se pudo recargar: ":"")+(e instanceof Error?e.message:String(e)));if(!saved)try{await refresh();}catch{}return false;}
  finally{setPending(false);}
 };
 return {pending,action};
}
export function NeedPatient({children,complete=false,body=false}:{children:ReactNode;complete?:boolean;body?:boolean}){
 const {patient}=useStore(),{selected,busy,error}=useConnection();
 if(busy)return <Panel>Consultando expedientes en PostgreSQL…</Panel>;
 if(error)return <Panel>{error}</Panel>;
 if(!selected||!patient)return <Panel title="Sin expediente seleccionado"><Link className="text-cyan-300" to="/app/expedientes">Crear o seleccionar expediente</Link></Panel>;
 if(selected.profile.status!=="active")return <Panel title="Expediente no activo">Los expedientes archivados o restringidos no se utilizan para simulación o captura.</Panel>;
 if((complete||body)&&(!["male","female"].includes(selected.profile.sex||"")||![patient.peso,patient.altura,...(complete?[patient.grasa,patient.musculo]:[])].every(Number.isFinite)))return <Panel title="Completa los datos corporales"><p className="mb-3 text-sm text-slate-400">{complete?"Registra peso, estatura, grasa corporal y masa muscular observada mediante instrumento.":"Registra peso y estatura antes de abrir el modelo personalizado."}</p><Link to="/app/mediciones" className="text-cyan-300">Registrar mediciones</Link></Panel>;
 return <>{children}</>;
}
