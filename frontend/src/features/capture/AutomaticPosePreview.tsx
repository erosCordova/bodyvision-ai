import { useEffect, useState } from "react";
import { detectPoseOnDevice, poseFailureMessage, POSE_EDGES, type PoseEstimate } from "./poseInference";
import "./automatic-pose.css";

/** Local, consented fictional capture preview; no image or landmarks sent to API. */
export function AutomaticPosePreview({file}:{file:File}){
  const [url,setUrl]=useState("");
  const [result,setResult]=useState<PoseEstimate|null>(null);
  const [error,setError]=useState("");
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    let current=true;
    const image=URL.createObjectURL(file);setUrl(image);setResult(null);setError("");
    const timer=window.setTimeout(()=>void detectPoseOnDevice(file,()=>current).then(pose=>{if(current)setResult(pose);}).catch(cause=>{if(current)setError(poseFailureMessage(cause));}),0);
    return()=>{current=false;window.clearTimeout(timer);URL.revokeObjectURL(image);};
  },[file,retry]);
  return <section className="bv-auto-pose" aria-label="Detección automática de cuerpo">
    <strong>Detección corporal IA</strong>
    {url&&<div className="bv-auto-pose-image"><img src={url} alt="Captura ficticia para detectar pose"/>{result?.found&&<svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Puntos detectados"><g stroke="#4de5f6" strokeWidth=".004" fill="none">{POSE_EDGES.map(([a,b])=>{const x=result.landmarks[a],y=result.landmarks[b];return x&&y&&x.visibility>=.5&&y.visibility>=.5?<line key={a+"-"+b} x1={x.x} y1={x.y} x2={y.x} y2={y.y}/>:null;})}</g>{result.landmarks.map((point,i)=>point.visibility>=.5?<circle key={i} cx={point.x} cy={point.y} r=".006" fill="#d1fbff"/>:null)}</svg>}</div>}
    {error?<><p role="alert">{error}</p><button type="button" onClick={()=>setRetry(n=>n+1)}>Reintentar detección</button></>:result?<p role="status">{result.found?`Cuerpo detectado · ${result.visiblePoints}/33 puntos visibles`:"No se detectó una pose humana. Usa una imagen de cuerpo completo."}</p>:<p role="status">Detectando cuerpo automáticamente…</p>}
    <small>La detección de pose no calcula el porcentaje de grasa corporal.</small>
  </section>;
}
