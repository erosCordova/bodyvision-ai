import { useEffect, useRef, useState } from "react";
import type { AnatomicalLayer, LayerOpacity, createAnatomyScene } from "../viewer/AnatomyScene";

const layers: {id: AnatomicalLayer; label: string}[] = [
  {id:"skin",label:"Piel"}, {id:"muscles",label:"Músculos"}, {id:"skeleton",label:"Huesos"},
  {id:"arteries",label:"Arterias"}, {id:"veins",label:"Venas"}, {id:"nerves",label:"Nervios"},
];
const opacity: LayerOpacity = {skin:1,muscles:1,skeleton:1,arteries:1,veins:1,nerves:1};

export function DashboardBodyPreview() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createAnatomyScene> | null>(null);
  const [layer,setLayer] = useState<AnatomicalLayer>("skin");
  const [states,setStates] = useState<Partial<Record<AnatomicalLayer,"loading"|"ready"|"error">>>({});
  const [error,setError] = useState("");
  const [attempt,setAttempt] = useState(0);
  const [initialized,setInitialized] = useState(false);
  useEffect(()=>{
    let active=true;
    const element=host.current;
    setInitialized(false);
    setStates({});
    setError("");
    if(!element) return;
    void import("../viewer/AnatomyScene").then(({createAnatomyScene})=>{
      if(!active) return;
      const controller=createAnatomyScene(element,()=>{},()=>{},(id,state)=>{
        if(active) setStates(previous=>({...previous,[id]:state}));
      },message=>{if(active) setError(message);});
      scene.current=controller;
      controller.setQuality("fluida");
      controller.setAutoRotate(false);
      setInitialized(true);
    }).catch(()=>{if(active) setError("No se pudo abrir el modelo 3D.");});
    return ()=>{active=false;scene.current?.dispose();scene.current=null;};
  },[attempt]);
  useEffect(()=>{
    if(initialized) scene.current?.update(new Set([layer]),opacity);
  },[initialized,layer]);
  const ready=states[layer]==="ready"&&!error;
  const failed=Boolean(error)||states[layer]==="error";
  return <div className="enterprise-realbody-preview product-atlas" data-loaded={ready} data-model="anatomy-atlas">
    <div ref={host} className="enterprise-realbody-canvas" />
    <div className="atlas-layer-controls" role="group" aria-label="Capas del cuerpo en el dashboard">
      {layers.map(item=><button type="button" key={item.id} aria-pressed={layer===item.id}
        onClick={()=>setLayer(item.id)}>{item.label}</button>)}
    </div>
    <div className="atlas-view-controls" role="group" aria-label="Controles de vista 3D">
      <button type="button" disabled={!ready} onClick={()=>scene.current?.view("front")}>Frente</button>
      <button type="button" disabled={!ready} onClick={()=>scene.current?.view("back")}>Espalda</button>
      <button type="button" disabled={!ready} aria-label="Acercar modelo" onClick={()=>scene.current?.zoom(.78)}>+</button>
      <button type="button" disabled={!ready} aria-label="Alejar modelo" onClick={()=>scene.current?.zoom(1.28)}>−</button>
    </div>
    {!ready && <div className="enterprise-realbody-status" role={failed?"alert":"status"}>
      <strong>{failed?"Modelo 3D no disponible":"Cargando modelo anatómico…"}</strong>
      {failed && <button type="button" onClick={()=>{setError("");setAttempt(n=>n+1);}}>Reintentar</button>}
    </div>}
    <div className="atlas-credit"><a href="https://www.z-anatomy.com/" target="_blank" rel="noreferrer">Z-Anatomy</a> · <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" target="_blank" rel="noreferrer">BodyParts3D</a> · <a href="https://github.com/SeemaBansal1/3d-human-body-anatomy" target="_blank" rel="noreferrer">Fuente del atlas</a></div>
  </div>;
}
