import { Component, useEffect, useMemo, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { ATTRIBUTION, type AnatomySystem } from "open-anatomy-3d";
import maleModelUrl from "open-anatomy-3d/models/anatomy-male.glb?url";
import femaleModelUrl from "open-anatomy-3d/models/anatomy-female.glb?url";
import { AnatomyViewer, type AnatomyPin } from "../../vendor/open-anatomy-3d-react";
import "../../vendor/open-anatomy-3d-react/styles.css";
import { anatomyDisplayName } from "../viewer/anatomyNames";
import { bodyVisualScenario, DEFAULT_REFERENCE_KG } from "../viewer/bodyVolume";
import { BASELINE_HEIGHT_CM, heightScale } from "../viewer/bodyStature";

const MODEL_URLS = { male: maleModelUrl, female: femaleModelUrl } as const;
const SYSTEMS: Array<{ id: AnatomySystem; label: string }> = [
  { id: "skin", label: "Piel" },
  { id: "skeleton", label: "Esqueleto" },
  { id: "muscles", label: "Músculos" },
  { id: "joints", label: "Articulaciones" },
  { id: "organs", label: "Órganos" },
  { id: "vessels", label: "Vasos" },
  { id: "nerves", label: "Nervios" },
];
type LayerVisibility = Record<AnatomySystem, boolean>;
type Anthropometry = { bodyWeightKg?: number; statureCm?: number; sex?: string | null };
const INITIAL_LAYERS: LayerVisibility = {
  skin: true, skeleton: false, muscles: false, joints: false, organs: false, vessels: false, nerves: false,
};

function modelSexFromProfile(value?: string | null): "male" | "female" {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "f" || normalized.startsWith("female")
    || normalized.startsWith("fem") || normalized === "mujer" ? "female" : "male";
}

interface ViewerBoundaryProps {
  children: ReactNode;
  onError: (error: Error, info: ErrorInfo) => void;
}
interface ViewerBoundaryState { failed: boolean }
class ViewerBoundary extends Component<ViewerBoundaryProps, ViewerBoundaryState> {
  state: ViewerBoundaryState = { failed: false };
  static getDerivedStateFromError(): ViewerBoundaryState { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { this.props.onError(error, info); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function DashboardBodyPreview({ bodyWeightKg, statureCm, sex }: Anthropometry) {
  const [visibleSystems, setVisibleSystems] = useState<LayerVisibility>(INITIAL_LAYERS);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const modelSex = modelSexFromProfile(sex);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => { setSelectedKey(null); }, [modelSex]);

  const modelScale = useMemo(() => {
    const scaleY = heightScale(statureCm ?? BASELINE_HEIGHT_CM);
    // The atlas is a visual reference; weight changes only adjust its width.
    const scaleRadial = 1 + bodyVisualScenario(bodyWeightKg ?? DEFAULT_REFERENCE_KG, 0).referenceRadialVariation;
    return [scaleRadial, scaleY, scaleRadial] as [number, number, number];
  }, [bodyWeightKg, statureCm]);
  const focus = useMemo(() => [0, 0.92 * modelScale[1], 0] as [number, number, number], [modelScale]);
  const cameraDistance = 3.55 * Math.max(modelScale[0], modelScale[1]);
  const pins = useMemo<AnatomyPin[]>(() => {
    if (!selectedKey) return [];
    return [{ key: selectedKey, color: "#69eaff" }];
  }, [selectedKey]);

  const toggleSystem = (id: AnatomySystem) => {
    setVisibleSystems(current => ({ ...current, [id]: !current[id] }));
  };
  const retry = () => {
    setReady(false);
    setError(false);
    setAttempt(value => value + 1);
  };

  return <div className="enterprise-realbody-preview product-atlas dashboard-hologram"
    data-loaded={ready && !error} data-model="anatomy-atlas" data-source="MervinR07/open-anatomy-3d"
    data-sex={modelSex}
    data-animation={ready && playing && !reducedMotion ? "running" : "paused"}>
    <ViewerBoundary key={attempt} onError={() => { setReady(false); setError(true); }}>
      <AnatomyViewer
        className="bv-open-anatomy-viewer"
        sex={modelSex}
        layers={visibleSystems}
        modelUrls={MODEL_URLS}
        modelScale={modelScale}
        focus={focus}
        cameraDistance={cameraDistance}
        autoRotate={playing && !reducedMotion}
        pins={pins}
        onStructureClick={(key) => setSelectedKey(current => current === key ? null : key)}
        onReadyChange={setReady}
        hoverHint="Clic para ver la estructura"
        showSexToggle={false}
        showLayerToggles={false}
        showRotateControl={false}
        showZoomControls
        hoverColor="#b8f5ff"
        highlightColor="#5ce2ff"
      />
    </ViewerBoundary>

    <div className="atlas-layer-controls" role="group" aria-label="Sistemas anatómicos">
      {SYSTEMS.map(system => <button key={system.id} type="button"
        aria-pressed={visibleSystems[system.id]}
        onClick={() => toggleSystem(system.id)}>
        {system.label}
      </button>)}
    </div>
    {ready && !error && !reducedMotion && <button type="button" className="dashboard-animation-toggle"
      onClick={() => setPlaying(value => !value)}
      aria-label={playing ? "Pausar rotación del modelo" : "Reanudar rotación del modelo"}>
      {playing ? "Ⅱ" : "▷"}
    </button>}
    {(!ready || error) && <div className="enterprise-realbody-status" role={error ? "alert" : "status"}>
      <strong>{error ? "No se pudo cargar el visor anatómico" : "Cargando atlas anatómico…"}</strong>
      {error && <span>El visor 3D no pudo iniciarse en este navegador.</span>}
      {error && <button type="button" onClick={retry}>Reintentar</button>}
    </div>}
    <details className="atlas-credit atlas-attribution">
      <summary>Fuentes y licencias</summary>
      <p>{ATTRIBUTION}</p>
      <p>Adaptación visual holográfica para BODYVISION AI. Las medidas solo ajustan la escala ilustrativa del modelo.</p>
      <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Licencia CC BY 4.0</a>
      {" · "}<a href="https://github.com/MervinR07/open-anatomy-3d" target="_blank" rel="noreferrer">Proyecto Open Anatomy 3D</a>
    </details>
    {selectedKey && <span className="sr-only" aria-live="polite">Estructura seleccionada: {anatomyDisplayName(selectedKey)}</span>}
  </div>;
}
