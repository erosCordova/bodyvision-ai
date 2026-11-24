import { useEffect, useRef, useState } from "react";
import type { LayerOpacity, createAnatomyScene } from "../viewer/AnatomyScene";

const opacity: LayerOpacity = {skin:1,muscles:1,skeleton:1,arteries:1,veins:1,nerves:1};

export function DashboardBodyPreview() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createAnatomyScene> | null>(null);
  const [reducedMotion,setReducedMotion] = useState(()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing,setPlaying] = useState(true);

  useEffect(()=>{
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change",update);
    return ()=>preference.removeEventListener("change",update);
  },[]);
  const [ready,setReady] = useState(false);
  const [error,setError] = useState(false);
  const [attempt,setAttempt] = useState(0);

  useEffect(()=>{
    let active=true;
    let dispose: (()=>void) | undefined;
    const element=host.current;
    setReady(false);
    setError(false);
    if(!element) return;
    void import("../viewer/AnatomyScene").then(({createAnatomyScene})=>{
      if(!active) return;
      const controller=createAnatomyScene(element,()=>{},()=>{},(layer,state)=>{
        if(!active || layer!=="skin") return;
        setReady(state==="ready");
        setError(state==="error");
      },()=>{if(active) setError(true);});
      scene.current=controller;
      dispose=controller.dispose;
      // Reuse the atlas exterior geometry, but render ONLY its cyan wireframe.
      // Set mode before loading to avoid ever displaying the solid skin.
      controller.setQuality("fluida");
      controller.setRenderMode("holograma");
      controller.setAutoRotate(false);
      controller.update(new Set(["skin"]),opacity);
    }).catch(()=>{if(active) setError(true);});
    return ()=>{active=false;scene.current=null;dispose?.();};
  },[attempt]);

  useEffect(()=>{
    scene.current?.setDashboardAnimation(ready && !error && playing && !reducedMotion);
  },[ready,error,playing,reducedMotion,attempt]);

  return <div className="enterprise-realbody-preview product-atlas dashboard-hologram" data-loaded={ready&&!error} data-model="anatomy-atlas" data-render-mode="holograma" data-animation={ready&&!error&&playing&&!reducedMotion?"running":"paused"}>
    <div ref={host} className="enterprise-realbody-canvas" />
    {ready && !error && !reducedMotion && <button type="button" className="dashboard-animation-toggle" onClick={()=>setPlaying(value=>!value)} aria-label={playing?"Pausar animación del atlas":"Reanudar animación del atlas"}>{playing?"Ⅱ":"▷"}</button>}
    {(!ready||error) && <div className="enterprise-realbody-status" role={error?"alert":"status"}>
      <strong>{error?"Modelo 3D no disponible":"Cargando modelo anatómico…"}</strong>
      {error && <button type="button" onClick={()=>setAttempt(n=>n+1)}>Reintentar</button>}
    </div>}
    <div className="atlas-credit"><a href="https://www.z-anatomy.com/" target="_blank" rel="noreferrer">Z-Anatomy (CC BY-SA 4.0)</a> · <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" target="_blank" rel="noreferrer">BodyParts3D (CC BY-SA 2.1 JP)</a> · <a href="https://github.com/SeemaBansal1/3d-human-body-anatomy" target="_blank" rel="noreferrer">Fuente del atlas</a></div>
  </div>;
}
