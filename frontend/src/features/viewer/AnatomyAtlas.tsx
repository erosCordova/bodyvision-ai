import { useEffect, useRef, useState } from "react";
import { anatomicalLayers, createAnatomyScene, type AnatomicalLayer, type LayerOpacity } from "./AnatomyScene";
import "./anatomy.css";

type SceneController = ReturnType<typeof createAnatomyScene>;
const defaultOpacity: LayerOpacity = {
  skeleton: 1, muscles: 0.94, arteries: 1, veins: 1, nerves: 1, skin: 0.35,
};
const presets: { label: string; layers: AnatomicalLayer[] }[] = [
  { label: "Huesos", layers: ["skeleton"] },
  { label: "Músculos", layers: ["muscles"] },
  { label: "Circulación", layers: ["arteries", "veins"] },
  { label: "Sistema nervioso", layers: ["nerves", "skeleton"] },
  { label: "Piel y músculos", layers: ["skin", "muscles"] },
];

export function AnatomyAtlas() {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<SceneController | null>(null);
  const [visible, setVisible] = useState<AnatomicalLayer[]>(["skeleton"]);
  const [opacity, setOpacity] = useState<LayerOpacity>({ ...defaultOpacity });
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState("Preparando el atlas anatómico…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!host.current) return;
    try {
      const scene = createAnatomyScene(host.current, setStatus, setSelected);
      controller.current = scene;
      scene.update(new Set<AnatomicalLayer>(["skeleton"]), defaultOpacity);
      return () => { scene.dispose(); if (controller.current === scene) controller.current = null; };
    } catch {
      setError("No se pudo iniciar WebGL. Abre el atlas en un navegador compatible con aceleración gráfica.");
      return;
    }
  }, []);
  useEffect(() => {
    controller.current?.update(new Set(visible), opacity);
  }, [visible, opacity]);
  const toggle = (id: AnatomicalLayer) => {
    setVisible(current => current.includes(id) ? current.filter(v => v !== id) : [...current, id]);
    setSelected(null);
  };
  const choosePreset = (layers: AnatomicalLayer[]) => {
    setVisible([...layers]);
    setSelected(null);
  };
  return (
    <div className="anatomy-page">
      <header className="anatomy-heading">
        <p className="eyebrow">ATLAS ANATÓMICO INTERACTIVO</p>
        <h1>Explora el interior del cuerpo humano</h1>
        <p>Activa las capas anatómicas, observa las estructuras desde cualquier ángulo y selecciona una pieza para identificarla.</p>
      </header>
      <div className="anatomy-layout">
        <section className="anatomy-stage" aria-label="Escena anatómica tridimensional">
          <div className="anatomy-stage-caption">ATLAS 3D · MODELOS DE REFERENCIA</div>
          <div className="anatomy-canvas" ref={host} />
          {error && <div className="anatomy-error" role="alert">{error}</div>}
          <div className="anatomy-viewport-help">Arrastra para girar · Pellizca o usa la rueda para acercar · Pulsa una pieza para seleccionarla</div>
          <div className="anatomy-status" role="status">{status}</div>
        </section>
        <aside className="anatomy-panel">
          <h2>Capas anatómicas</h2>
          <p>Enciende o apaga cada sistema. Ajusta su transparencia para ver las estructuras interiores.</p>
          <div className="anatomy-presets" role="group" aria-label="Vistas rápidas">
            {presets.map(preset => (
              <button key={preset.label} type="button" onClick={() => choosePreset(preset.layers)}>{preset.label}</button>
            ))}
          </div>
          <div className="anatomy-layers">
            {anatomicalLayers.map(layer => (
              <div className="anatomy-layer" key={layer.id}>
                <label className="anatomy-layer-toggle">
                  <input type="checkbox" checked={visible.includes(layer.id)} onChange={() => toggle(layer.id)} />
                  <span><strong>{layer.label}</strong><small>{layer.detail}</small></span>
                </label>
                {visible.includes(layer.id) && (
                  <div className="anatomy-opacity">
                    <label htmlFor={`anatomy-opacity-${layer.id}`}>Transparencia</label>
                    <input id={`anatomy-opacity-${layer.id}`} type="range" min="10" max="100" step="5"
                      value={Math.round(opacity[layer.id] * 100)}
                      onChange={event => setOpacity(current => ({ ...current, [layer.id]: Number(event.target.value) / 100 }))} />
                    <output>{Math.round(opacity[layer.id] * 100)}% opacidad</output>
                  </div>
                )}
              </div>
            ))}
          </div>
          <button type="button" className="secondary-button anatomy-camera-reset" onClick={() => controller.current?.resetCamera()}>Centrar cámara</button>
          <div className="anatomy-selection" aria-live="polite">
            <strong>Estructura seleccionada</strong>
            <p>{selected || "Selecciona una pieza del cuerpo para conocer su nombre original."}</p>
          </div>
        </aside>
      </div>
      <div className="anatomy-credits">
        <p><strong>Uso educativo, no diagnóstico.</strong> Este atlas contiene geometría anatómica de referencia; no representa la composición corporal de una persona concreta y no cambia automáticamente con los controles de estatura o peso del visor exterior.</p>
        <p>Modelos derivados de <a href="https://www.z-anatomy.com/" target="_blank" rel="noreferrer">Z-Anatomy</a> (CC BY-SA 4.0) y <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" target="_blank" rel="noreferrer">BodyParts3D</a> (CC BY-SA 2.1 JP), preparados para la web por <a href="https://github.com/SeemaBansal1/3d-human-body-anatomy" target="_blank" rel="noreferrer">SeemaBansal1 / Human Anatomy 3D</a>. Los archivos 3D se cargan del repositorio público original y conservan sus condiciones de licencia. La capa de órganos se ha excluido por incluir componentes con restricciones de uso comercial; antes de redistribuir o comercializar otros activos debe revisarse su cadena de licencias.</p>
      </div>
    </div>
  );
}
