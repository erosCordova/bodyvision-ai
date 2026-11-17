import { useEffect, useRef, useState } from "react";
import { initialShape, type BodyShape } from "./bodyShape";
import type { SceneState, View } from "./BodyScene";
import manifest from "../../../public/models/bodyvision/manifest.json";
import "./viewer.css";

type Controller = Awaited<ReturnType<typeof import("./BodyScene").createBodyScene>>;
const viewNames: [View, string][] = [["front", "Frontal"], ["side", "Lateral"], ["back", "Posterior"], ["perspective", "Perspectiva"]];
export function BodyViewer() {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<Controller | null>(null);
  const [shape, setShape] = useState<BodyShape>(initialShape);
  const [view, setView] = useState<View>("perspective");
  const [wireframe, setWireframe] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [status, setStatus] = useState("Preparando el visor…");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [restart, setRestart] = useState(0);
  const latest = useRef<SceneState>({ shape, wireframe, rotate, view });
  useEffect(() => {
    latest.current = { shape, wireframe, rotate, view };
    controller.current?.apply(latest.current);
  }, [shape, wireframe, rotate, view]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReducedMotion(query.matches); if (query.matches) setRotate(false); };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const started = performance.now();
    setLoaded(false);
    setError("");
    const element = host.current;
    if (!element) return;
    void import("./BodyScene").then(async ({ createBodyScene }) => {
      if (abort.signal.aborted) return;
      const scene = await createBodyScene(element, abort.signal, setStatus, setError);
      if (abort.signal.aborted) { scene.cleanup(); return; }
      controller.current = scene;
      scene.apply(latest.current);
      scene.setView(latest.current.view);
      setLoaded(true);
      setStatus("Modelo 3D listo");
      // Performance mark contains only timing of this synthetic, static model.
      performance.measure("bodyvision-demo-model-load", { start: started, end: performance.now() });
    }).catch(() => {
      if (!abort.signal.aborted) setError("No se pudo abrir el modelo 3D. Comprueba tu conexión y que el navegador tenga aceleración gráfica.");
    });
    return () => { abort.abort(); controller.current?.cleanup(); controller.current = null; };
  }, [restart]);
  const changeView = (next: View) => { setView(next); controller.current?.setView(next); };
  const reset = () => { setShape(initialShape); setWireframe(false); setRotate(false); changeView("perspective"); };
  const field = (key: keyof BodyShape, label: string, unit: string, min: number, max: number) => (
    <div className="body-field">
      <label htmlFor={`body-${key}`}>{label}</label>
      <output htmlFor={`body-${key}`}>{shape[key]} <span>{unit}</span></output>
      <input id={`body-${key}`} type="range" min={min} max={max} step="1" value={shape[key]}
        onChange={e => setShape(previous => ({ ...previous, [key]: Number(e.target.value) }))} />
      <div className="body-range"><span>{min} {unit}</span><span>{max} {unit}</span></div>
    </div>
  );
  return (
    <div className="body-page">
      <header className="body-heading">
        <div><p className="eyebrow">EXPLORACIÓN CORPORAL</p><h1>El cuerpo, en otra dimensión.</h1>
          <p>Explora un modelo humano detallado y observa cambios ilustrativos al mover los controles.</p></div>
        <span className="body-demo-badge">MODELO DE DEMOSTRACIÓN</span>
      </header>
      <div className="body-workbench">
        <section className="body-stage" aria-label="Visor corporal 3D" data-loaded={loaded && !error}>
          <div className="body-stage-top"><span><i /> ESTUDIO 3D</span><span>Superficie · escala en metros</span></div>
          <div className="body-canvas" ref={host} />
          {(!loaded || error) && <div className="body-overlay">
            {error ? <div role="alert"><strong>El visor necesita recargarse</strong><p>{error}</p><button className="secondary-button" onClick={() => setRestart(v => v+1)}>Recargar visor</button></div>
              : <p role="status">{status}</p>}
          </div>}
          <div className="body-stage-bottom"><span>Arrastra para girar · rueda o pellizca para acercar</span><span aria-live="polite">{shape.height} cm</span></div>
          <div className="body-views" role="group" aria-label="Vistas del cuerpo">
            {viewNames.map(([code, label]) => <button key={code} disabled={!loaded || !!error} aria-pressed={view === code} onClick={() => changeView(code)}>{label}</button>)}
          </div>
        </section>
        <aside className="body-panel" aria-label="Controles del modelo">
          <p className="eyebrow">TU ESCENARIO VISUAL</p><h2>Explora las proporciones</h2>
          <p className="body-muted">Los controles solo cambian este modelo. No modifican expedientes ni mediciones.</p>
          {field("height", "Estatura ilustrativa", "cm", 145, 205)}
          {field("weight", "Peso ilustrativo", "kg", 45, 130)}
          {field("definition", "Definición visual", "%", 0, 100)}
          <p className="body-small">La definición es un efecto artístico; no equivale a un porcentaje de músculo o grasa.</p>
          <div className="body-display-options">
            <h3>Visualización</h3>
            <label><input type="checkbox" checked={wireframe} onChange={e => setWireframe(e.target.checked)} /> Mostrar malla</label>
            <label><input type="checkbox" checked={rotate} disabled={reducedMotion} onChange={e => setRotate(e.target.checked)} /> Giro automático</label>
            {reducedMotion && <p className="body-small">El giro está desactivado por tu preferencia de movimiento reducido.</p>}
          </div>
          <button className="secondary-button body-reset" onClick={reset}>Restablecer modelo</button>
        </aside>
      </div>
      <div className="body-limit"><strong>ILUSTRACIÓN HIPOTÉTICA</strong><p>No es predicción médica ni afirmación sobre el cuerpo real. Estatura y peso no determinan por sí solos la forma corporal. Este modelo adulto genérico no está asociado a ningún expediente.</p></div>
      <details className="body-provenance"><summary>Acerca del modelo y su licencia</summary>
        <dl><div><dt>Modelo</dt><dd>MakeHuman / MPFB · adulto genérico · v{manifest.version}</dd></div>
          <div><dt>Piel</dt><dd>Aksel, de Mindfront · materiales adaptados para la web</dd></div>
          <div><dt>Licencia</dt><dd><a href="/models/bodyvision/LICENSE.ASSETS.md" target="_blank" rel="noreferrer">CC0 1.0 · consultar licencia</a></dd></div>
          <div><dt>Geometría</dt><dd>{manifest.triangles.toLocaleString("es-PE")} triángulos · malla con deformaciones de volumen</dd></div>
          <div><dt>Capas disponibles</dt><dd>Superficie y malla. No incluye órganos, músculos internos ni reconstrucción por fotografías.</dd></div>
          <div><dt>Versión del activo</dt><dd>{manifest.created_at} · SHA-256 <code>{manifest.sha256}</code></dd></div>
        </dl>
      </details>
    </div>
  );
}
