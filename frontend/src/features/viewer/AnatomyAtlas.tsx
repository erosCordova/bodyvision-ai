import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  anatomicalLayers, createAnatomyScene,
  type AnatomicalLayer, type LayerOpacity, type RenderMode,
  type SceneQuality, type SelectedStructure, type LayerState,
} from "./AnatomyScene";
import { anatomySource } from "./atlasSource";
import "./anatomy-studio.css";

type AtlasController = ReturnType<typeof createAnatomyScene>;
type AtlasEntry = {
  id: string;
  medical: string;
  common?: string;
  category?: string;
  match: string[];
  summary?: string;
  function?: string;
  location?: string;
  facts?: string[];
  sources?: string[];
  layer: AnatomicalLayer;
};
type AtlasData = { structures?: Omit<AtlasEntry, "layer">[] };
type Panel = "informacion" | "recorridos" | "guia";
type TourStep = { layer: AnatomicalLayer; name: string; title: string; intro: string };
type Tour = { id: string; title: string; description: string; icon: string; steps: TourStep[] };

const initialOpacity: LayerOpacity = {
  skin: 1, muscles: 1, skeleton: 1, arteries: 1, veins: 1, nerves: 1,
};
const quickViews: { name: string; layers: AnatomicalLayer[]; opacities?: Partial<LayerOpacity> }[] = [
  { name: "Cuerpo completo", layers: ["skin"] },
  { name: "Músculos", layers: ["muscles"] },
  { name: "Esqueleto", layers: ["skeleton"] },
  { name: "Sistema vascular", layers: ["arteries", "veins"] },
  { name: "Nervios y huesos", layers: ["nerves", "skeleton"] },
  { name: "Rayos X", layers: ["skin", "skeleton", "arteries", "veins"], opacities: { skin: 0.2 } },
  { name: "Visión interna", layers: ["skin", "muscles", "skeleton", "arteries", "veins", "nerves"], opacities: { skin: 0.18, muscles: 0.5 } },
];
const tours: Tour[] = [
  {
    id: "esqueleto", title: "Viaje por el esqueleto", icon: "◈",
    description: "Desde el cráneo hasta el hueso más largo del cuerpo.",
    steps: [
      { layer: "skeleton", name: "Frontal bone", title: "Hueso frontal", intro: "Comenzamos en la parte anterior del cráneo." },
      { layer: "skeleton", name: "Sternum", title: "Esternón", intro: "La estructura central de la caja torácica." },
      { layer: "skeleton", name: "Humerus", title: "Húmero", intro: "El hueso largo del brazo." },
      { layer: "skeleton", name: "Femur", title: "Fémur", intro: "El hueso principal del muslo." },
    ],
  },
  {
    id: "musculos", title: "Conoce los músculos", icon: "⌁",
    description: "Explora grupos musculares de brazos, torso y piernas.",
    steps: [
      { layer: "muscles", name: "Pectoralis major", title: "Pectoral mayor", intro: "Uno de los músculos grandes del tórax." },
      { layer: "muscles", name: "Biceps brachii", title: "Bíceps braquial", intro: "Músculo de la parte anterior del brazo." },
      { layer: "muscles", name: "Rectus abdominis", title: "Recto abdominal", intro: "Músculo de la pared abdominal anterior." },
      { layer: "muscles", name: "Gastrocnemius", title: "Gastrocnemio", intro: "Músculo superficial de la pantorrilla." },
    ],
  },
  {
    id: "circulacion", title: "Recorrido vascular", icon: "♡",
    description: "Identifica algunos vasos principales.",
    steps: [
      { layer: "arteries", name: "Common carotid artery", title: "Carótida común", intro: "Una arteria que asciende por el cuello." },
      { layer: "arteries", name: "Aorta", title: "Aorta", intro: "La arteria principal de la circulación sistémica." },
      { layer: "arteries", name: "Femoral artery", title: "Arteria femoral", intro: "Arteria importante del muslo." },
      { layer: "veins", name: "Great saphenous vein", title: "Vena safena mayor", intro: "Una vena superficial extensa del miembro inferior." },
    ],
  },
  {
    id: "nervios", title: "Vías nerviosas", icon: "✳",
    description: "Navega por algunos nervios periféricos.",
    steps: [
      { layer: "nerves", name: "Median nerve", title: "Nervio mediano", intro: "Nervio relevante para la sensibilidad y el movimiento de la mano." },
      { layer: "nerves", name: "Ulnar nerve", title: "Nervio cubital", intro: "Recorre la cara interna del brazo hacia la mano." },
      { layer: "nerves", name: "Sciatic nerve", title: "Nervio ciático", intro: "Uno de los nervios principales del miembro inferior." },
    ],
  },
];
const aliases: Record<string, string> = {
  femur: "fémur", frontal: "frontal", sternum: "esternón", humerus: "húmero",
  biceps: "bíceps", muscle: "músculo", muscles: "músculos", nerve: "nervio",
  nerves: "nervios", artery: "arteria", arteries: "arterias", vein: "vena",
  veins: "venas", bone: "hueso", skull: "cráneo", tibia: "tibia", fibula: "peroné",
  radius: "radio", ulna: "cúbito", pelvis: "pelvis", clavicle: "clavícula",
  scapula: "escápula", patella: "rótula", spine: "columna vertebral", hand: "mano",
  foot: "pie", triceps: "tríceps", gastrocnemius: "gemelo", pectoralis: "pectoral",
};
const word = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_.-]/g, " ").trim();
const cleanMesh = (name: string) => name.replace(/\.(l|r)(\.\d+)?$/i, "").replaceAll("_", " ").trim();
const sourceRoot = anatomySource + "content/";

function candidateNames(entry: AtlasEntry) {
  return [entry.medical, entry.common || "", entry.category || "", ...entry.match, ...Object.entries(aliases)
    .filter(([en]) => word(entry.medical + " " + (entry.common || "")).includes(word(en)))
    .map(([, es]) => es)];
}
function matches(entry: AtlasEntry, query: string) {
  const normalized = word(query);
  return candidateNames(entry).some(name => word(name).includes(normalized));
}
function findFromMesh(entries: AtlasEntry[], part: SelectedStructure | null) {
  if (!part) return null;
  const target = word(cleanMesh(part.name));
  return entries.find(e => e.layer === part.layer && e.match.some(name => word(cleanMesh(name)) === target))
    || entries.find(e => e.layer === part.layer && candidateNames(e).some(name => word(name) === target))
    || null;
}

export function AnatomyAtlas() {
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<AtlasController | null>(null);
  const [visible, setVisible] = useState<AnatomicalLayer[]>(["skin"]);
  const [opacity, setOpacity] = useState<LayerOpacity>({ ...initialOpacity });
  const [mode, setMode] = useState<RenderMode>("realista");
  const [quality, setQuality] = useState<SceneQuality>("alta");
  const [spin, setSpin] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [showMarker, setShowMarker] = useState(true);
  const [selected, setSelected] = useState<SelectedStructure | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<AtlasEntry | null>(null);
  const [panel, setPanel] = useState<Panel>("informacion");
  const [search, setSearch] = useState("");
  const [entries, setEntries] = useState<AtlasEntry[]>([]);
  const [contentReady, setContentReady] = useState(false);
  const [status, setStatus] = useState("Inicializando el cuerpo humano 3D…");
  const [error, setError] = useState("");
  const [layerStates, setLayerStates] = useState<Partial<Record<AnatomicalLayer, LayerState>>>({});
  const [restart, setRestart] = useState(0);
  const [tour, setTour] = useState<{ id: string; step: number } | null>(null);
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState("Escribe el nombre de un músculo, hueso, vaso o nervio para explorar su información anatómica.");
  const [voice, setVoice] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setReducedMotion(query.matches); if (query.matches) setSpin(false); };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!host.current) return;
    setError("");
    setLayerStates({});
    setStatus("Inicializando el cuerpo humano 3D…");
    try {
      const scene = createAnatomyScene(host.current, setStatus, part => {
        setSelected(part);
        setIsolated(false);
        setSelectedEntry(previous => {
          if (!part || !previous || previous.layer !== part.layer) return null;
          return previous.match.some(name => word(cleanMesh(name)) === word(cleanMesh(part.name))) ? previous : null;
        });
      }, (layer, state) => setLayerStates(previous => ({ ...previous, [layer]: state })), setError);
      controller.current = scene;
      return () => { scene.dispose(); if (controller.current === scene) controller.current = null; };
    } catch {
      setError("Este navegador no pudo iniciar el visor 3D. Comprueba que admita WebGL y tenga aceleración gráfica, o prueba otro navegador.");
      setStatus("Visor 3D no disponible en este navegador");
      return;
    }
  }, [restart]);

  useEffect(() => {
    const abort = new AbortController();
    Promise.allSettled(anatomicalLayers.map(async layer => {
      const response = await fetch(sourceRoot + layer.id + ".json", { signal: abort.signal });
      if (!response.ok) throw new Error(layer.id);
      const data = await response.json() as AtlasData;
      return (data.structures || []).map(entry => ({ ...entry, layer: layer.id }));
    })).then(outcomes => {
      if (abort.signal.aborted) return;
      setEntries(outcomes.flatMap(item => item.status === "fulfilled" ? item.value : []));
      setContentReady(true);
    });
    return () => abort.abort();
  }, []);

  useEffect(() => controller.current?.update(new Set(visible), opacity), [visible, opacity, restart]);
  useEffect(() => controller.current?.setRenderMode(mode), [mode, restart]);
  useEffect(() => controller.current?.setQuality(quality), [quality, restart]);
  useEffect(() => controller.current?.setAutoRotate(spin), [spin, restart]);
  useEffect(() => controller.current?.setIsolated(isolated), [isolated, restart]);
  useEffect(() => {
    const changed = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  const identified = useMemo(() => findFromMesh(entries, selected) || selectedEntry, [entries, selected, selectedEntry]);
  const results = useMemo(() => search.trim().length < 2 ? [] : entries
    .filter(entry => matches(entry, search)).slice(0, 9), [search, entries]);
  const runningTour = tour && tours.find(item => item.id === tour.id);
  const currentStep = runningTour && tour ? runningTour.steps[tour.step] : null;

  const openEntry = (entry: AtlasEntry) => {
    setPanel("informacion");
    setSearch("");
    setTour(null);
    setSelectedEntry(entry);
    setIsolated(false);
    setVisible(previous => previous.includes(entry.layer) ? previous : [...previous, entry.layer]);
    if (entry.match[0]) controller.current?.focus(entry.match[0], entry.layer);
  };
  const toggleLayer = (layer: AnatomicalLayer) => {
    setVisible(previous => previous.includes(layer) ? previous.filter(id => id !== layer) : [...previous, layer]);
    setTour(null);
  };
  const applyPreset = (preset: typeof quickViews[number]) => {
    setVisible([...preset.layers]);
    setOpacity({ ...initialOpacity, ...preset.opacities });
    setIsolated(false);
    setSelectedEntry(null);
    setTour(null);
    controller.current?.clearSelection();
    if (preset.name === "Rayos X") setMode("radiografia");
    else if (mode === "radiografia") setMode("realista");
    controller.current?.resetCamera();
  };
  const focusStep = (id: string, index: number) => {
    const chosen = tours.find(item => item.id === id);
    const step = chosen?.steps[index];
    if (!step) return;
    setTour({ id, step: index });
    setPanel("recorridos");
    setIsolated(false);
    setVisible([step.layer]);
    const entry = entries.find(e => e.layer === step.layer &&
      (matches(e, step.name) || e.match.some(name => word(name).includes(word(step.name)))));
    setSelectedEntry(entry || null);
    if (entry?.match[0]) controller.current?.focus(entry.match[0], entry.layer);
    else controller.current?.focus(step.name, step.layer);
  };
  const ask = (event: React.FormEvent) => {
    event.preventDefault();
    const text = question.trim();
    if (!text) return;
    if (/(dolor|enfermedad|diagn[oó]stico|tratamiento|medicina|síntomas|sintomas)/i.test(text)) {
      setReply("Esta guía explica anatomía, pero no diagnostica enfermedades ni indica tratamientos. Para consultas de salud, acude a un profesional.");
      return;
    }
    const found = entries.find(entry => candidateNames(entry)
      .some(name => name.length >= 3 && word(text).includes(word(name))))
      || entries.find(entry => matches(entry, text.replace(/^(d[oó]nde est[aá]|qu[eé] es|qu[eé] hace|mu[eé]strame|busca|el|la|los|las)\s*/i, "").trim()));
    if (!found) {
      setReply("No encontré una coincidencia en los datos del atlas. Prueba con el nombre de una estructura, por ejemplo: fémur, bíceps o nervio ciático.");
      return;
    }
    setReply(found.medical + ": " + (found.summary || found.function || "Estructura disponible en el atlas.") +
      " La información original está en inglés; consulta las fuentes de la ficha.");
    openEntry(found);
    setPanel("guia");
  };
  const speak = () => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    if (!voice) return;
    const utterance = new SpeechSynthesisUtterance(reply);
    utterance.lang = "en-US";
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (root.current?.requestFullscreen) void root.current.requestFullscreen();
  };

  return (
    <div className="studio-root" ref={root}>
      <header className="studio-header">
        <div className="studio-brand">
          <Link to="/" className="studio-back" title="Volver al resumen">←</Link>
          <span className="studio-brand-mark">B</span>
          <div><strong>BODYVISION <em>AI</em></strong><small>ATLAS ANATÓMICO INTERACTIVO</small></div>
        </div>
        <div className="studio-search-wrap">
          <span aria-hidden="true">⌕</span>
          <input aria-label="Buscar estructura anatómica" placeholder="Buscar estructuras, músculos, huesos, nervios…" value={search}
            onChange={event => setSearch(event.target.value)} />
          {search && <button aria-label="Limpiar búsqueda" onClick={() => setSearch("")}>×</button>}
          {search.trim().length >= 2 && (
            <div className="studio-search-results" role="listbox" aria-label="Resultados anatómicos">
              {results.map(entry => (
                <button key={entry.layer + entry.id} role="option" aria-selected="false" onClick={() => openEntry(entry)}>
                  <span>{entry.medical}</span><small>{anatomicalLayers.find(l => l.id === entry.layer)?.label}</small>
                </button>
              ))}
              {!results.length && <p>{contentReady ? "Sin resultados en las capas disponibles" : "Cargando catálogo anatómico…"}</p>}
            </div>
          )}
        </div>
        <div className="studio-header-actions">
          <span className="studio-online"><i /> Referencia 3D</span>
          <button onClick={toggleFullscreen} title="Pantalla completa">{isFullscreen ? "Salir de pantalla completa" : "⛶ Pantalla completa"}</button>
          <Link to="/" className="studio-to-dashboard">Panel principal</Link>
        </div>
      </header>

      <div className="studio-main">
        <aside className="studio-left" aria-label="Controles del atlas anatómico">
          <div className="studio-left-title">
            <p>EXPLORADOR CORPORAL</p>
            <h1>Capas del cuerpo</h1>
            <span>Activa los sistemas que deseas explorar.</span>
          </div>
          <div className="studio-layer-list">
            {anatomicalLayers.map(layer => (
              <div className={"studio-layer-card" + (visible.includes(layer.id) ? " is-active" : "")} key={layer.id}>
                <label>
                  <span className="studio-layer-dot" style={{ background: layer.color }} />
                  <span className="studio-layer-label"><strong>{layer.label}</strong><small>{layer.detail}</small></span>
                  <input type="checkbox" checked={visible.includes(layer.id)} onChange={() => toggleLayer(layer.id)} />
                </label>
                {visible.includes(layer.id) && layerStates[layer.id] === "loading" && <p className="studio-layer-status" role="status">Cargando {layer.label.toLowerCase()}…</p>}
                {visible.includes(layer.id) && layerStates[layer.id] === "error" && <div className="studio-layer-status" role="alert"><p>No se pudo cargar {layer.label.toLowerCase()}.</p><button onClick={() => controller.current?.retryLayer(layer.id)}>Reintentar {layer.label.toLowerCase()}</button></div>}
                {visible.includes(layer.id) && (
                  <div className="studio-slider">
                    <span>Opacidad</span>
                    <input aria-label={"Opacidad de " + layer.label} type="range" min="10" max="100" step="5"
                      value={Math.round(opacity[layer.id] * 100)}
                      onChange={e => setOpacity(previous => ({ ...previous, [layer.id]: Number(e.target.value) / 100 }))} />
                    <output>{Math.round(opacity[layer.id] * 100)}%</output>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="studio-left-section">
            <div className="studio-section-title"><strong>VISTAS RÁPIDAS</strong><span>07</span></div>
            <div className="studio-preset-grid">
              {quickViews.map(preset => <button key={preset.name} onClick={() => applyPreset(preset)}>{preset.name}</button>)}
            </div>
          </div>
          <div className="studio-left-section studio-left-footer">
            <p>Modelo anatómico de referencia. No corresponde a pacientes ni expedientes clínicos.</p>
            <button onClick={() => { applyPreset(quickViews[0]); setMode("realista"); setSpin(false); }}>↺ Restaurar visualización</button>
          </div>
        </aside>

        <section className="studio-viewport" aria-label="Visor anatómico 3D a pantalla completa" data-loaded={!error && visible.some(layer => layerStates[layer] === "ready")}>
          <div className="studio-canvas" ref={host} />
          <div className="studio-view-top">
            <span><i /> EXPLORACIÓN ANATÓMICA EN TIEMPO REAL</span>
            <span>CUERPO HUMANO · MODELO EDUCATIVO</span>
          </div>
          <div className="studio-view-angles" role="group" aria-label="Cambiar ángulo">
            <button onClick={() => controller.current?.view("front")}>Frente</button>
            <button onClick={() => controller.current?.view("back")}>Espalda</button>
            <button onClick={() => controller.current?.view("left")}>Izquierda</button>
            <button onClick={() => controller.current?.view("right")}>Derecha</button>
          </div>
          {error && <div className="studio-overlay-error" role="alert"><p>{error}</p><button onClick={() => setRestart(value => value + 1)}>Recargar visor</button></div>}
          {showMarker && selected && (
            <div className="studio-selected-tag">
              <span>ESTRUCTURA SELECCIONADA</span>
              <strong>{identified?.medical || cleanMesh(selected.name)}</strong>
              <button onClick={() => { controller.current?.clearSelection(); setSelectedEntry(null); setIsolated(false); }}>×</button>
            </div>
          )}
          <div className="studio-viewport-help">Arrastra para rotar · Rueda para acercar · Selecciona una estructura</div>
          <div className="studio-view-status" role="status">{status}</div>
          <div className="studio-zoom">
            <button aria-label="Acercar" onClick={() => controller.current?.zoom(0.78)}>+</button>
            <button aria-label="Alejar" onClick={() => controller.current?.zoom(1.28)}>−</button>
            <button aria-label="Centrar el cuerpo" onClick={() => controller.current?.resetCamera()}>⌖</button>
          </div>
          <div className="studio-dock" aria-label="Herramientas de visualización 3D">
            <div className="studio-dock-group">
              <span>APARIENCIA</span>
              {([["realista", "Realista"], ["holograma", "Holograma"], ["radiografia", "Rayos X"]] as const).map(([key, title]) => (
                <button key={key} className={mode === key ? "active" : ""} aria-pressed={mode === key} onClick={() => setMode(key)}>{title}</button>
              ))}
            </div>
            <div className="studio-dock-group">
              <span>RENDIMIENTO</span>
              <button className={quality === "alta" ? "active" : ""} aria-pressed={quality === "alta"} onClick={() => setQuality("alta")}>Alta</button>
              <button className={quality === "fluida" ? "active" : ""} aria-pressed={quality === "fluida"} onClick={() => setQuality("fluida")}>Fluida</button>
            </div>
            <div className="studio-dock-group">
              <span>HERRAMIENTAS</span>
              <button className={showMarker ? "active" : ""} aria-pressed={showMarker} onClick={() => setShowMarker(v => !v)}>Etiqueta</button>
              <button className={spin ? "active" : ""} aria-pressed={spin} disabled={reducedMotion} onClick={() => setSpin(v => !v)}>Giro</button>
              <button onClick={() => controller.current?.resetCamera()}>Restablecer</button>
            </div>
          </div>
        </section>

        <aside className="studio-right" aria-label="Información y guía anatómica">
          <div className="studio-right-head"><span>LABORATORIO DE ANATOMÍA</span><strong>Explora y aprende</strong></div>
          <div className="studio-tabs" role="tablist" aria-label="Panel de exploración">
            <button role="tab" aria-selected={panel === "informacion"} className={panel === "informacion" ? "active" : ""} onClick={() => setPanel("informacion")}>Información</button>
            <button role="tab" aria-selected={panel === "recorridos"} className={panel === "recorridos" ? "active" : ""} onClick={() => setPanel("recorridos")}>Recorridos</button>
            <button role="tab" aria-selected={panel === "guia"} className={panel === "guia" ? "active" : ""} onClick={() => setPanel("guia")}>Guía</button>
          </div>
          <div className="studio-right-content">
            {panel === "informacion" && (
              identified ? (
                <div className="studio-info">
                  <p className="studio-eyebrow">FICHA ANATÓMICA</p>
                  <h2>{identified.medical}</h2>
                  {identified.common && <p className="studio-subtitle">{identified.common}</p>}
                  <p className="studio-info-layer">{anatomicalLayers.find(l => l.id === identified.layer)?.label} · {identified.category || "Estructura anatómica"}</p>
                  {identified.summary && <section><h3>Descripción original</h3><p>{identified.summary}</p></section>}
                  {identified.function && <section><h3>Función</h3><p>{identified.function}</p></section>}
                  {identified.location && <section><h3>Ubicación</h3><p>{identified.location}</p></section>}
                  {!!identified.facts?.length && <section><h3>Datos de interés</h3>{identified.facts.slice(0, 2).map(fact => <p key={fact}>{fact}</p>)}</section>}
                  {!!identified.sources?.length && <section><h3>Fuentes de referencia</h3><div className="studio-source-links">
                    {identified.sources.slice(0, 4).filter(link => link.startsWith("https://")).map((link, index) => (
                      <a href={link} key={link} target="_blank" rel="noreferrer">Ver fuente {index + 1} ↗</a>
                    ))}
                  </div></section>}
                  <p className="studio-original-note">Las fichas heredadas del atlas original se presentan en inglés mientras se prepara una revisión terminológica en español.</p>
                  <div className="studio-info-actions">
                    <button onClick={() => setIsolated(value => !value)}>{isolated ? "Mostrar todas las piezas" : "Aislar estructura"}</button>
                    <button onClick={() => { controller.current?.clearSelection(); setSelectedEntry(null); setIsolated(false); }}>Cerrar ficha</button>
                  </div>
                </div>
              ) : selected ? (
                <div className="studio-info"><p className="studio-eyebrow">ESTRUCTURA 3D</p><h2>{cleanMesh(selected.name)}</h2>
                  <p className="studio-subtitle">La malla se encuentra disponible, pero no tiene una ficha descriptiva asociada en el catálogo.</p>
                  <button onClick={() => setIsolated(value => !value)}>{isolated ? "Mostrar todas" : "Aislar estructura"}</button>
                </div>
              ) : (
                <div className="studio-empty-info">
                  <div className="studio-empty-symbol">✦</div>
                  <h2>Descubre el cuerpo humano</h2>
                  <p>Selecciona un hueso, músculo, nervio o vaso del modelo para consultar su descripción, función, ubicación y fuentes.</p>
                  <div className="studio-stats">
                    <div><strong>06</strong><span>Capas anatómicas</span></div>
                    <div><strong>{contentReady ? entries.length : "…"}</strong><span>Fichas disponibles</span></div>
                  </div>
                  <button onClick={() => setPanel("recorridos")}>Explorar recorridos →</button>
                </div>
              )
            )}
            {panel === "recorridos" && (
              <div className="studio-tours">
                <p className="studio-eyebrow">EXPLORACIÓN PASO A PASO</p>
                <h2>Recorridos anatómicos</h2>
                {runningTour && currentStep && (
                  <div className="studio-tour-player">
                    <span>{runningTour.title.toUpperCase()}</span>
                    <small>PASO {tour!.step + 1} DE {runningTour.steps.length}</small>
                    <h3>{currentStep.title}</h3>
                    <p>{currentStep.intro}</p>
                    <div className="studio-tour-actions">
                      <button disabled={tour!.step === 0} onClick={() => focusStep(runningTour.id, tour!.step - 1)}>Anterior</button>
                      <button disabled={tour!.step === runningTour.steps.length - 1} onClick={() => focusStep(runningTour.id, tour!.step + 1)}>Siguiente</button>
                      <button onClick={() => setTour(null)}>Salir</button>
                    </div>
                  </div>
                )}
                <div className="studio-tours-list">{tours.map(item => (
                  <button key={item.id} onClick={() => focusStep(item.id, 0)}>
                    <span className="studio-tour-symbol">{item.icon}</span>
                    <span><strong>{item.title}</strong><small>{item.description}</small><em>{item.steps.length} paradas</em></span>
                    <span>→</span>
                  </button>
                ))}</div>
                <p className="studio-original-note">Estos recorridos emplean las capas y estructuras disponibles. Algunas piezas del atlas original pueden no coincidir con el nombre de búsqueda.</p>
              </div>
            )}
            {panel === "guia" && (
              <div className="studio-assistant">
                <p className="studio-eyebrow">CONSULTA EDUCATIVA</p>
                <h2>Guía anatómica</h2>
                <p>Busca una estructura por su nombre y abre su ficha. La guía utiliza el catálogo del atlas; no es un modelo médico de inteligencia artificial.</p>
                <div className="studio-assistant-answer"><span>GUÍA BODYVISION</span><p>{reply}</p></div>
                <form onSubmit={ask}>
                  <label htmlFor="studio-ask">Pregunta por una estructura</label>
                  <textarea id="studio-ask" value={question} rows={3} placeholder="Ej.: ¿Dónde está el fémur?" onChange={e => setQuestion(e.target.value)} />
                  <button type="submit" disabled={!contentReady}>Buscar en el atlas</button>
                </form>
                <div className="studio-assistant-voice">
                  <label><input type="checkbox" checked={voice} onChange={e => { setVoice(e.target.checked); window.speechSynthesis?.cancel(); }} /> Habilitar lectura en voz</label>
                  <button disabled={!voice} onClick={speak}>Escuchar respuesta</button>
                </div>
                <p className="studio-original-note">Esta función no interpreta síntomas, no realiza diagnósticos ni sustituye una consulta médica.</p>
              </div>
            )}
          </div>
          <div className="studio-right-foot">Z-Anatomy · BodyParts3D · <a href="https://github.com/SeemaBansal1/3d-human-body-anatomy" target="_blank" rel="noreferrer">Repositorio fuente ↗</a></div>
        </aside>
      </div>

      <footer className="studio-footer">
        <span>BODYVISION AI · ATLAS DE REFERENCIA · NO APTO PARA DIAGNÓSTICO</span>
        <span>Modelos: <a href="https://www.z-anatomy.com/" target="_blank" rel="noreferrer">Z-Anatomy (CC BY-SA 4.0)</a> · <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/" target="_blank" rel="noreferrer">BodyParts3D (CC BY-SA 2.1 JP)</a> · adaptación web: SeemaBansal1. Sin capa de órganos por restricciones de licencia.</span>
      </footer>
    </div>
  );
}
