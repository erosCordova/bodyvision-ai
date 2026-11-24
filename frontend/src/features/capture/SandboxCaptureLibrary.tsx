import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { usePrivateAuth } from "../../app/providers/PrivateAuthProvider";
import { ProfilePicker } from "../foundation/ModuleControls";
import { prepareSyntheticPng, syntheticCapturesApi, type StoredCapture } from "../../services/api/syntheticCaptures";
import { reviewLocalCapture, type CaptureReview } from "./captureQuality";
import { stageCaptureForAnalysis } from "./captureHandoff";
import { dateTime } from "../../components/ui/States";
import "./sandbox-capture-library.css";

export function SandboxCaptureLibrary({file=null,allowUpload=false,fixedProfileId,onAnalyze}:{file?:File|null;allowUpload?:boolean;fixedProfileId?:string;onAnalyze?:(file:File,review:CaptureReview)=>void|Promise<void>}){
  const {session}=usePrivateAuth();
  const {id,api,readOnly}=useWorkspace();
  const [params]=useSearchParams();
  const navigate=useNavigate();
  const cache=useQueryClient();
  const [chosen,setChosen]=useState(params.get("profile")??"");
  const profileId=fixedProfileId??chosen;
  const [attest,setAttest]=useState(false);
  const [local,setLocal]=useState<File|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [preview,setPreview]=useState<{url:string;item:StoredCapture}|null>(null);
  const generation=useRef(0);
  const effective=file??local;
  const profile=useQuery({queryKey:["profile",id,profileId],queryFn:()=>api.profile(profileId),enabled:!!session&&!!profileId});
  const archive=useQuery({queryKey:["sandbox-images",id,profileId],queryFn:()=>syntheticCapturesApi(session!.token,profileId).list(),enabled:!!session&&profile.isSuccess&&profile.data.status==="active"});
  const writable=!!session&&!readOnly&&profile.data?.status==="active";
  useEffect(()=>{generation.current++;setAttest(false);setLocal(null);setNotice("");setError("");setPreview(null);return()=>{generation.current++;};},[profileId,session?.user_id]);
  useEffect(()=>{setAttest(false);},[file]);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
  async function run(action:()=>Promise<void>){
    if(busy)return;
    const current=++generation.current;
    setBusy(true);setError("");setNotice("");
    try{await action();}catch(e){if(current===generation.current)setError(e instanceof Error?e.message:"No se pudo completar la operación.");}
    finally{setBusy(false);}
  }
  async function save(){
    if(!session||!writable||!effective||!attest||!allowUpload)return;
    const source=effective;
    await run(async()=>{
      const review=await reviewLocalCapture(source);
      if(!review.passed)throw new Error("La imagen no cumple las condiciones básicas de calidad.");
      const png=await prepareSyntheticPng(source);
      await syntheticCapturesApi(session.token,profileId).create(png);
      await cache.invalidateQueries({queryKey:["sandbox-images",id,profileId]});
      setLocal(null);setAttest(false);setNotice("Imagen guardada en el expediente.");
    });
  }
  async function open(item:StoredCapture,analyze:boolean){
    if(!session)return;
    await run(async()=>{
      const blob=await syntheticCapturesApi(session.token,profileId).download(item.id);
      const image=new File([blob],"captura-ficticia.png",{type:"image/png"});
      if(analyze){
        const review=await reviewLocalCapture(image);
        if(onAnalyze)await onAnalyze(image,review);
        else {stageCaptureForAnalysis(image,review);navigate("/analysis?profile="+profileId,{state:{localCaptureReview:review}});}
      }else setPreview({url:URL.createObjectURL(blob),item});
    });
  }
  if(!session)return null;
  return <section className="enterprise-panel bv-capture-library" aria-label="Imágenes del expediente">
    <div className="enterprise-panel-title"><h2>Imágenes del expediente</h2><span>ARCHIVO FICTICIO</span></div>
    {!fixedProfileId&&<fieldset disabled={busy}><ProfilePicker selected={profile.data??null} selectedId={profileId} onChange={setChosen}/></fieldset>}
    {profile.isError&&profileId&&<p role="alert">No se pudo acceder al expediente.</p>}
    {profileId&&profile.isSuccess&&profile.data.status!=="active"&&<p>Expediente restringido o archivado.</p>}
    {writable&&fixedProfileId&&allowUpload&&<label className="enterprise-upload"><strong>Seleccionar imagen</strong><small>JPG, PNG o WebP · hasta 10 MB</small><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{setLocal(e.target.files?.[0]??null);setAttest(false);e.target.value="";}}/></label>}
    {writable&&effective&&allowUpload&&<div className="bv-capture-save"><p>Imagen lista: {effective.name}</p><label className="enterprise-consent"><input type="checkbox" checked={attest} disabled={busy} onChange={e=>setAttest(e.target.checked)}/> Confirmo que la imagen es ficticia y autorizo su conservación temporal.</label><button type="button" className="primary-button" disabled={!attest||busy} onClick={()=>void save()}>Guardar en expediente</button></div>}
    {archive.isPending&&writable&&<p role="status">Consultando imágenes…</p>}
    {archive.isError&&<p role="alert">{archive.error.message}</p>}
    {archive.data&&<><p>{archive.data.total} imágenes guardadas</p>{archive.data.items.length===0&&<p>Este expediente todavía no contiene imágenes.</p>}<div className="bv-capture-list">{archive.data.items.map((item,index)=><article key={item.id}><strong>Captura {archive.data!.total-index}</strong><small>{item.width} × {item.height} px · {dateTime(item.created_at)}</small><div><button type="button" disabled={busy} onClick={()=>void open(item,false)}>Ver imagen</button><button type="button" disabled={busy} onClick={()=>void open(item,true)}>Usar en análisis IA</button>{writable&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm("¿Eliminar esta imagen del expediente?"))void run(async()=>{await syntheticCapturesApi(session.token,profileId).remove(item.id);setPreview(null);await cache.invalidateQueries({queryKey:["sandbox-images",id,profileId]});setNotice("Imagen eliminada.");});}}>Eliminar</button>}</div></article>)}</div></>}
    {preview&&<div className="bv-capture-preview"><img src={preview.url} alt="Imagen ficticia guardada en el expediente"/><button type="button" onClick={()=>setPreview(null)}>Cerrar vista previa</button></div>}
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {profileId&&profile.isSuccess&&<div className="bv-capture-links"><Link to={"/profiles/"+profileId+"?tab=measurements"}>Mediciones</Link><Link to={"/body-3d?panel=grasa&profile="+profileId}>Visor 3D</Link><Link to={"/profiles/"+profileId+"?tab=analytics"}>Evolución</Link></div>}
    <small>Solo imágenes ficticias. Hasta 20 por cuenta, cifradas y disponibles durante 7 días. El atlas utiliza mediciones, no reconstruye el cuerpo a partir de fotografías.</small>
  </section>;
}
