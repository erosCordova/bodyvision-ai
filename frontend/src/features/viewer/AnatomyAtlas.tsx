import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "../../app/providers/WorkspaceProvider";
import { DataTypeBadge } from "../../components/ui/DataTypeBadge";
import { dateTime } from "../../components/ui/States";
import { Link, useNavigate } from "react-router-dom";
import {
  anatomicalLayers, createAnatomyScene,
  type AnatomicalLayer, type LayerOpacity, type RenderMode,
  type SceneQuality, type SelectedStructure, type LayerState,
} from "./AnatomyScene";
import { anatomyRevision, anatomySource } from "./atlasSource";
import { bodyVolumeScenario } from "./bodyVolume";
import { BASELINE_HEIGHT_CM } from "./bodyStature";
import { preferredAtlasQuality } from "./renderBudget";
import { reviewLocalCapture } from "../capture/captureQuality";
import { stageCaptureForAnalysis } from "../capture/captureHandoff";
import { anatomyDisplayName, anatomyNameKey } from "./anatomyNames";
import { buildSyntheticScenarioCsv } from "./scenarioCsv";
import { sampledMorphClamping } from "./morphLimits";
import { scenarioCompatibilityReason } from "./scenarioCompatibility";
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
type Panel = "informacion" | "recorridos" | "guia" | "simulacion";
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
  return [entry.medical, anatomyDisplayName(entry.medical), entry.common || "", entry.category || "", ...entry.match, ...Object.entries(aliases)
    .filter(([en]) => word(entry.medical + " " + (entry.common || "")).includes(word(en)))
    .map(([, es]) => es)];
}
function matches(entry: AtlasEntry, query: string) {
  const normalized = word(query);
  return candidateNames(entry).some(name => word(name).includes(normalized));
}
function findFromMesh(entries: AtlasEntry[], part: SelectedStructure | null) {
  if (!part) return null;
  const target = anatomyNameKey(part.name);
  return entries.find(e => e.layer === part.layer && e.match.some(name => anatomyNameKey(name) === target))
    || entries.find(e => e.layer === part.layer && candidateNames(e).some(name => anatomyNameKey(name) === target))
    || null;
}

export function AnatomyAtlas() {
  const navigate = useNavigate();
  const { id: workspaceId, api, readOnly } = useWorkspace();
  const queryClient = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<AtlasController | null>(null);
  const [panel, setPanel] = useState<Panel>(() => new URLSearchParams(window.location.search).get("panel") === "simulacion" ? "simulacion" : "informacion");
  const [visible, setVisible] = useState<AnatomicalLayer[]>(["skin"]);
  const [opacity, setOpacity] = useState<LayerOpacity>({ ...initialOpacity });
  const [mode, setMode] = useState<RenderMode>("realista");
  const [meshOverlay, setMeshOverlay] = useState(false);
  const [referenceKg, setReferenceKg] = useState(70);
  const [weightVariation, setWeightVariation] = useState(0);
  const [statureCm, setStatureCm] = useState(BASELINE_HEIGHT_CM);
  const [baselinePreview, setBaselinePreview] = useState(false);
  const [comparison, setComparison] = useState(false);
  const [comparisonDivider, setComparisonDivider] = useState(50);
  const [historicalBaseline, setHistoricalBaseline] = useState<{
    id: string; version: number; reference_kg: number; variation_percent: number;
    stature_cm: number; simulated_kg: number;
  } | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [savedScenario, setSavedScenario] = useState<{ baseKg: number; delta: number; statureCm: number } | null>(null);
  const [scenarioProfileId, setScenarioProfileId] = useState(
    () => new URLSearchParams(window.location.search).get("profile") ?? "",
  );
  const [scenarioParentId, setScenarioParentId] = useState("");
  const [scenarioRevisionNote, setScenarioRevisionNote] = useState("");
  const [scenarioVersionId, setScenarioVersionId] = useState("");
  const [scenarioOffset, setScenarioOffset] = useState(0);
  const [scenarioExportError, setScenarioExportError] = useState("");
  const [scenarioCompatibilityError, setScenarioCompatibilityError] = useState("");
  const [scenarioNotice, setScenarioNotice] = useState("");
  const syntheticProfiles = useQuery({
    queryKey: ["simulation-profile-options", workspaceId],
    queryFn: () => api.profiles("", 0),
    enabled: panel === "simulacion",
  });
  const linkedProfile = useQuery({
    queryKey: ["simulation-linked-profile", workspaceId, scenarioProfileId],
    queryFn: () => api.profile(scenarioProfileId),
    enabled: panel === "simulacion" && !!scenarioProfileId,
  });
  const scenarioHistory = useQuery({
    queryKey: ["simulation-history", workspaceId, scenarioProfileId, scenarioOffset],
    queryFn: () => api.scenarios(scenarioProfileId, scenarioOffset),
    enabled: panel === "simulacion" && !!scenarioProfileId,
  });
  const scenarioVersions = useQuery({
    queryKey: ["simulation-versions", workspaceId, scenarioProfileId, scenarioVersionId],
    queryFn: () => api.scenarioVersions(scenarioProfileId, scenarioVersionId),
    enabled: panel === "simulacion" && !!scenarioProfileId && !!scenarioVersionId,
  });
  const saveVersion = useMutation({
    mutationFn: () => api.saveScenario(scenarioProfileId, {
      reference_kg: referenceKg,
      variation_percent: weightVariation,
      stature_cm: statureCm,
      ...(scenarioParentId ? {
        prior_version_id: scenarioParentId,
        revision_note: scenarioRevisionNote.trim(),
      } : {}),
    }, crypto.randomUUID()),
    onSuccess: async scenario => {
      setScenarioParentId(scenario.id);
      setScenarioOffset(0);
      setScenarioRevisionNote("");
      setScenarioNotice(`Versión ${scenario.version} registrada como SIMULADO. Las mediciones observadas no se modificaron.`);
      await queryClient.invalidateQueries({ queryKey: ["simulation-history", workspaceId, scenarioProfileId] });
      await queryClient.invalidateQueries({ queryKey: ["simulation-versions", workspaceId, scenarioProfileId] });
    },
  });
  const downloadScenarioPage = () => {
    const page = scenarioHistory.data;
    if (!page || page.items.length === 0 || scenarioHistory.isFetching) return;
    setScenarioExportError("");
    let url: string | null = null;
    try {
      const csv = buildSyntheticScenarioCsv(page.items);
      url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "bodyvision-escenarios-simulados-pagina.csv";
      link.click();
      const finishedUrl = url;
      window.setTimeout(() => URL.revokeObjectURL(finishedUrl), 1500);
    } catch {
      if (url) URL.revokeObjectURL(url);
      setScenarioExportError("No se pudo generar el CSV de escenarios sintéticos.");
    }
  };
  const simulatedWeight = bodyVolumeScenario(referenceKg, weightVariation).simulatedKg;
  const morphClamping = useMemo(
    () => sampledMorphClamping(referenceKg, weightVariation),
    [referenceKg, weightVariation],
  );
  const [qualityPreference, setQualityPreference] = useState<SceneQuality | "auto">("auto");
  const [recommendedQuality, setRecommendedQuality] = useState<SceneQuality>(() => preferredAtlasQuality(
    window.innerWidth,
    window.matchMedia("(pointer: coarse)").matches,
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
  ));
  const quality = qualityPreference === "auto" ? recommendedQuality : qualityPreference;
  const [renderStats, setRenderStats] = useState<ReturnType<AtlasController["getPerformanceStats"]> | null>(null);
  const diagnosticsOpen = renderStats !== null;
  const [spin, setSpin] = useState(false);
  const [isolated, setIsolated] = useState(false);
  const [showMarker, setShowMarker] = useState(true);
  const [selected, setSelected] = useState<SelectedStructure | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<AtlasEntry | null>(null);
  const [search, setSearch] = useState("");
  const [activeSearchResult, setActiveSearchResult] = useState(0);
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
    const pointer = window.matchMedia("(pointer: coarse)");
    const refresh = () => setRecommendedQuality(preferredAtlasQuality(
      window.innerWidth, pointer.matches,
      (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    ));
    window.addEventListener("resize", refresh);
    pointer.addEventListener("change", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      pointer.removeEventListener("change", refresh);
    };
  }, []);
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
          return previous.match.some(name => anatomyNameKey(name) === anatomyNameKey(part.name)) ? previous : null;
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
  useEffect(() => controller.current?.setWeightVariation(baselinePreview ? 0 : weightVariation, referenceKg), [weightVariation, referenceKg, baselinePreview, restart]);
  useEffect(() => controller.current?.setStature(baselinePreview ? BASELINE_HEIGHT_CM : statureCm), [statureCm, baselinePreview, restart]);
  useEffect(() => controller.current?.setMeshOverlay(meshOverlay), [meshOverlay, restart]);
  useEffect(() => controller.current?.setComparisonBaseline(historicalBaseline ? {
    referenceKg: historicalBaseline.reference_kg,
    variationPercent: historicalBaseline.variation_percent,
    statureCm: historicalBaseline.stature_cm,
  } : null), [historicalBaseline, restart]);
  useEffect(() => controller.current?.setComparison(comparison, comparisonDivider), [comparison, comparisonDivider, restart]);
  useEffect(() => {
    if (!diagnosticsOpen) return;
    // Reading counters does not draw another frame or create an animation loop.
    const timer = window.setInterval(() => {
      if (!document.hidden) setRenderStats(controller.current?.getPerformanceStats() ?? null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [diagnosticsOpen, restart]);
  useEffect(() => {
    const changed = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  const identified = useMemo(() => findFromMesh(entries, selected) || selectedEntry, [entries, selected, selectedEntry]);
  const downloadRenderStats = () => {
    const stats = controller.current?.getPerformanceStats();
    if (!stats) return;
    // Explicit allowlist: no image, profile, weight, height or device fingerprint.
    const report = {
      schemaVersion: 1,
      anatomyRevision,
      capturedAt: new Date().toISOString(),
      ...stats,
      timingScope: "CPU command submission only; excludes GPU completion, FPS and clinical assessment",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "bodyvision-render-diagnostics.json";
    link.click();
    // Leave time for the browser to acquire the download before releasing it.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const results = useMemo(() => search.trim().length < 2 ? [] : entries
    .filter(entry => matches(entry, search)).slice(0, 9), [search, entries]);
  const activeResultIndex = Math.min(activeSearchResult, Math.max(results.length - 1, 0));
  const runningTour = tour && tours.find(item => item.id === tour.id);
  const currentStep = runningTour && tour ? runningTour.steps[tour.step] : null;

  const openEntry = (entry: AtlasEntry) => {
    setPanel("informacion");
    setSearch("");
    setActiveSearchResult(0);
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
  const openSimulation = () => {
    setPanel("simulacion");
    setTour(null);
    setVisible(["skin"]);
    setOpacity({ ...initialOpacity });
    setMode("realista");
    setIsolated(false);
    controller.current?.clearSelection();
    controller.current?.resetCamera();
  };
  const toggleMesh = () => {
    if (mode === "holograma") setMode("realista");
    setMeshOverlay(value => !value);
  };
  const fixHistoricalReference = (row: {
    id: string; version: number; reference_kg: number; variation_percent: number;
    stature_cm: number; simulated_kg: number; model_revision: string;
    algorithm_revision: string; data_type: "SIMULADO";
  }) => {
    const reason = scenarioCompatibilityReason(row);
    if (reason) { setScenarioCompatibilityError(reason); return; }
    setScenarioCompatibilityError("");
    setHistoricalBaseline({
      id: row.id, version: row.version,
      reference_kg: row.reference_kg,
      variation_percent: row.variation_percent,
      stature_cm: row.stature_cm,
      simulated_kg: row.simulated_kg,
    });
    setBaselinePreview(false);
    setComparison(true);
    setVisible(["skin"]);
    setOpacity({ ...initialOpacity });
    setMode("realista");
  };
  const restoreHistoryScenario = (row: {
    id: string; reference_kg: number; variation_percent: number; stature_cm: number;
    model_revision: string; algorithm_revision: string; data_type: "SIMULADO";
  }) => {
    const reason = scenarioCompatibilityReason(row);
    if (reason) { setScenarioCompatibilityError(reason); return; }
    setScenarioCompatibilityError("");
    setReferenceKg(row.reference_kg);
    setWeightVariation(row.variation_percent);
    setStatureCm(row.stature_cm);
    setScenarioParentId(row.id);
    setScenarioRevisionNote("");
    setScenarioNotice("Escenario histórico recuperado sobre el mismo cuerpo 3D. Se requiere un motivo para guardar la siguiente versión.");
    setBaselinePreview(false);
    setComparison(false);
    setVisible(["skin"]);
    setOpacity({ ...initialOpacity });
    setMode("realista");
  };
  const resetSimulation = () => {
    setReferenceKg(70);
    setWeightVariation(0);
    setStatureCm(BASELINE_HEIGHT_CM);
    setBaselinePreview(false);
    setComparison(false);
    setHistoricalBaseline(null);
    setSavedScenario(null);
  };
  const analyzeCurrentAvatar = async () => {
    if (captureBusy || comparison || !controller.current || layerStates.skin !== "ready" ||
      !visible.includes("skin") || error) return;
    setCaptureBusy(true);
    setCaptureError("");
    let captureStage: "render" | "validate" | "handoff" = "render";
    try {
      const snapshot = await controller.current.capturePng(true);
      if (snapshot.size > 10 * 1024 * 1024) {
        throw new Error("El archivo de la captura 3D excede 10 MB.");
      }
      captureStage = "validate";
      const file = new File([snapshot], "modelo-3d-sintetico.png", { type: "image/png" });
      const review = await reviewLocalCapture(file);
      captureStage = "handoff";
      stageCaptureForAnalysis(file, review);
      setCaptureBusy(false);
      navigate("/analysis", { state: { localCaptureReview: review, source: "atlas-synthetic" } });
    } catch (cause) {
      const code = captureStage === "render" ? "BV-3D-CAPTURE" :
        captureStage === "validate" ? "BV-3D-VALIDATION" : "BV-3D-HANDOFF";
      // The synthetic scene contains no patient images. Limit console
      // diagnostics to a stage and JS error message; no bytes/landmarks.
      const reason = cause instanceof Error ? cause.message : "error desconocido";
      console.warn("[BodyVision synthetic atlas]", code, reason);
      const action = captureStage === "render"
        ? "Prueba a ampliar la vista 3D o cambiar a calidad Alta."
        : captureStage === "validate"
          ? "La imagen 3D no superó la validación local; restaura la vista y reintenta."
          : "No se pudo abrir el análisis local. Vuelve a intentarlo.";
      setCaptureError(`No se completó la captura sintética (${code}). ${action}`);
      setCaptureBusy(false);
    }
  };
  const downloadCurrentAvatar = async (exportComparison = false) => {
    if (captureBusy || comparison !== exportComparison || !controller.current ||
      layerStates.skin !== "ready" || !visible.includes("skin") || error) return;
    setCaptureBusy(true);
    setCaptureError("");
    let objectUrl: string | null = null;
    try {
      const png = await controller.current.capturePng(false, exportComparison ? {
        referenceKg: historicalBaseline?.simulated_kg ?? referenceKg,
        referenceCm: historicalBaseline?.stature_cm ?? BASELINE_HEIGHT_CM,
        scenarioKg: simulatedWeight, scenarioCm: statureCm,
      } : undefined);
      if (png.type !== "image/png" || png.size === 0 || png.size > 10 * 1024 * 1024) {
        throw new Error("La captura PNG 3D no tiene un formato o tamaño válido.");
      }
      // Export ONLY the existing synthetic atlas. No upload, external request,
      // personal file name, duplicate mesh, or persistence in browser storage.
      objectUrl = URL.createObjectURL(png);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = exportComparison ? "bodyvision-comparacion-3d-sintetica.png" : "bodyvision-atlas-3d-sintetico.png";
      link.click();
      const finishedUrl = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(finishedUrl), 1500);
    } catch {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setCaptureError("No se pudo descargar la imagen 3D ficticia. Comprueba la vista y vuelve a intentarlo.");
    } finally {
      setCaptureBusy(false);
    }
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
            aria-controls="studio-search-results"
            aria-expanded={search.trim().length >= 2}
            aria-activedescendant={search.trim().length >= 2 && results.length ? "studio-search-result-" + activeResultIndex : undefined}
            onChange={event => { setSearch(event.target.value); setActiveSearchResult(0); }}
            onKeyDown={event => {
              if (event.key === "Escape" && search) {
                event.preventDefault();
                setSearch("");
                setActiveSearchResult(0);
              } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && results.length) {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveSearchResult(value => (value + direction + results.length) % results.length);
              } else if (event.key === "Enter" && results.length) {
                event.preventDefault();
                openEntry(results[activeResultIndex]);
              }
            }} />
          {search && <button aria-label="Limpiar búsqueda" onClick={() => { setSearch(""); setActiveSearchResult(0); }}>×</button>}
          {search.trim().length >= 2 && (
            <div id="studio-search-results" className="studio-search-results" role="listbox" aria-label="Resultados anatómicos">
              {results.map((entry, index) => (
                <button key={entry.layer + entry.id} id={"studio-search-result-" + index} role="option"
                  aria-selected={index === activeResultIndex}
                  onMouseEnter={() => setActiveSearchResult(index)}
                  onClick={() => openEntry(entry)}>
                  <span>{anatomyDisplayName(entry.medical)}</span><small>{anatomicalLayers.find(l => l.id === entry.layer)?.label}</small>
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
            <button onClick={() => { applyPreset(quickViews[0]); setMode("realista"); setSpin(false); resetSimulation(); setMeshOverlay(false); }}>↺ Restaurar visualización</button>
          </div>
        </aside>

        <section className="studio-viewport" aria-label="Visor anatómico 3D a pantalla completa" data-loaded={!error && visible.some(layer => layerStates[layer] === "ready")}>
          <div className="studio-canvas" ref={host} />
          {comparison && !error && (
            <div className="studio-compare" aria-label="Comparación dividida del mismo modelo 3D">
              <div className="studio-compare-divider" style={{ left: `${comparisonDivider}%` }} />
              <span className="studio-compare-before">{historicalBaseline
                ? `HISTÓRICO v${historicalBaseline.version} · ${historicalBaseline.simulated_kg} kg / ${historicalBaseline.stature_cm} cm`
                : `REFERENCIA · ${referenceKg} kg / ${BASELINE_HEIGHT_CM} cm`}</span>
              <span className="studio-compare-after">ESCENARIO · {simulatedWeight} kg / {statureCm} cm</span>
              <span className="studio-compare-caption">Dos estados del mismo cuerpo · comparación gráfica, no clínica</span>
              {historicalBaseline && (
                <span className="studio-compare-delta" aria-label="Diferencias visuales frente a la versión histórica">
                  Diferencia frente a v{historicalBaseline.version}:{" "}
                  {simulatedWeight - historicalBaseline.simulated_kg >= 0 ? "+" : ""}
                  {(simulatedWeight - historicalBaseline.simulated_kg).toFixed(1)} kg ·{" "}
                  {statureCm - historicalBaseline.stature_cm >= 0 ? "+" : ""}
                  {statureCm - historicalBaseline.stature_cm} cm
                </span>
              )}
            </div>
          )}
          <div className="studio-view-top">
            <span><i /> {weightVariation !== 0 || statureCm !== BASELINE_HEIGHT_CM ? (baselinePreview ? "REFERENCIA CORPORAL ORIGINAL" : "SIMULACIÓN DE PESO Y ESTATURA · MISMO MODELO 3D") : "EXPLORACIÓN ANATÓMICA EN TIEMPO REAL"}</span>
            <span>CUERPO HUMANO · MODELO EDUCATIVO</span>
          </div>
          {renderStats && <aside className="studio-render-info" aria-label="Diagnóstico de renderizado" data-rendered-frames={renderStats.renderedFrames}>
            <strong>Diagnóstico de visualización</strong>
            <span>Resolución: {renderStats.bufferWidth} × {renderStats.bufferHeight} píxeles</span>
            <span>Geometrías: {renderStats.meshes} · Mallas: {renderStats.overlays}</span>
            <span>Operaciones gráficas: {renderStats.drawCalls} · Triángulos: {renderStats.triangles.toLocaleString("es-PE")}</span>
            <span>LOD geométrico: {renderStats.lodMeshes} mallas simplificadas · {renderStats.lodTrianglesSaved.toLocaleString("es-PE")} triángulos reducidos</span>
            <span>Pasadas por fotograma: {renderStats.renderPasses}</span>
            <span>Preparación CPU: {renderStats.cpuSubmissionMs === null ? "Sin muestra" : renderStats.cpuSubmissionMs.toFixed(2) + " ms"}</span>
            <span>Recursos gráficos: {renderStats.geometryBuffers} geometrías · {renderStats.textures} texturas</span>
            <span>Conexión gráfica: {renderStats.contextAvailable ? "Disponible" : "Interrumpida"}</span>
            <small>Último fotograma completo. El tiempo CPU no mide la GPU ni los FPS. Se actualiza al interactuar, sin animar el cuerpo.</small>
            <button onClick={downloadRenderStats}>Descargar diagnóstico</button>
            <button onClick={() => setRenderStats(null)} aria-label="Cerrar diagnóstico">Cerrar</button>
          </aside>}
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
              <strong>{anatomyDisplayName(identified?.medical || cleanMesh(selected.name))}</strong>
              <button onClick={() => { controller.current?.clearSelection(); setSelectedEntry(null); setIsolated(false); }}>×</button>
            </div>
          )}
          {(weightVariation !== 0 || statureCm !== BASELINE_HEIGHT_CM) && (
            <div className="studio-weight-indicator" role="status" style={comparison ? { display: "none" } : undefined}>
              <span>SIMULACIÓN HIPOTÉTICA · NO CLÍNICA</span>
              <strong>{baselinePreview ? referenceKg : simulatedWeight} kg · {baselinePreview ? BASELINE_HEIGHT_CM : statureCm} cm <small>{baselinePreview ? "Referencia" : "Escenario"}</small></strong>
              <p>{baselinePreview ? "Vista base temporal" : (weightVariation > 0 ? "+" : "") + weightVariation + "% frente a la referencia"}</p>
            </div>
          )}
          <div className="studio-viewport-help">Arrastra o usa un dedo para rotar · Pellizca para zoom · Con teclado: flechas, + / −, Inicio y Esc</div>
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
              <button className={qualityPreference === "auto" ? "active" : ""} aria-pressed={qualityPreference === "auto"}
                title="Adaptar la calidad a la pantalla y al dispositivo" onClick={() => { setQualityPreference("auto"); setRenderStats(null); }}>Auto</button>
              <button className={quality === "alta" ? "active" : ""} aria-pressed={quality === "alta"} onClick={() => { setQualityPreference("alta"); setRenderStats(null); }}>Alta</button>
              <button className={quality === "fluida" ? "active" : ""} aria-pressed={quality === "fluida"} onClick={() => { setQualityPreference("fluida"); setRenderStats(null); }}>Fluida</button>
              <button aria-pressed={!!renderStats} onClick={() => setRenderStats(current =>
                current ? null : controller.current?.getPerformanceStats() ?? null)}>Detalles</button>
            </div>
            <div className="studio-dock-group">
              <span>HERRAMIENTAS</span>
              <button className={meshOverlay ? "active" : ""} aria-pressed={meshOverlay} onClick={toggleMesh} title="Superponer malla poligonal sobre la anatomía">Malla 3D</button>
              <button className={showMarker ? "active" : ""} aria-pressed={showMarker} onClick={() => setShowMarker(v => !v)}>Etiqueta</button>
              <button className={spin ? "active" : ""} aria-pressed={spin} disabled={reducedMotion} onClick={() => setSpin(v => !v)}>Giro</button>
              <button className={panel === "simulacion" ? "active" : ""} aria-pressed={panel === "simulacion"} onClick={openSimulation}>Peso y estatura</button>
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
            <button role="tab" aria-selected={panel === "simulacion"} className={panel === "simulacion" ? "active" : ""} onClick={openSimulation}>Simulación</button>
          </div>
          <div className="studio-right-content">
            {panel === "simulacion" && (
              <div className="studio-simulation">
                <p className="studio-eyebrow">SIMULACIÓN · SOBRE EL MODELO 3D</p>
                <h2>Simulador de peso y estatura</h2>
                <p className="studio-sim-lead">Modifica la estatura y el peso hipotéticos sobre el mismo cuerpo anatómico 3D. La malla, las capas y la navegación permanecen integradas.</p>
                <div className="studio-sim-values">
                  <div><span>REFERENCIA ILUSTRATIVA</span><strong>{referenceKg} <small>kg</small></strong></div>
                  <div><span>PESO HIPOTÉTICO</span><strong>{simulatedWeight} <small>kg</small></strong></div>
                   <div><span>ESTATURA DE REFERENCIA</span><strong>{BASELINE_HEIGHT_CM} <small>cm</small></strong></div>
                   <div><span>ESTATURA HIPOTÉTICA</span><strong>{statureCm} <small>cm</small></strong></div>
                </div>
                <label className="studio-sim-number">
                  Peso de referencia (solo demostración)
                  <div><input type="number" min="40" max="200" step="1" value={referenceKg} onChange={event => setReferenceKg(Math.max(40, Math.min(200, Number(event.target.value) || 40)))} /><span>kg</span></div>
                </label>
                <label className="studio-sim-slider">
                  <span>Variación hipotética del peso <strong>{weightVariation > 0 ? "+" : ""}{weightVariation}%</strong></span>
                  <input type="range" aria-label="Aumentar o disminuir peso en el modelo anatómico"
                    min="-30" max="30" step="1" value={weightVariation}
                    onChange={event => {
                      setWeightVariation(Number(event.target.value));
                      setBaselinePreview(false);
                      setVisible(previous => previous.includes("skin") ? previous : ["skin", ...previous]);
                      setOpacity(previous => ({ ...previous, skin: 1 }));
                      setMode("realista");
                    }} />
                  <span className="studio-sim-limits"><small>−30% · menor volumen</small><small>+30% · mayor volumen</small></span>
                </label>
                <div className="studio-sim-presets" role="group" aria-label="Escenarios rápidos de volumen">
                  <span>Escenarios visuales rápidos</span>
                  <div className="studio-sim-preset-buttons">
                    {([
                      { label: "Menor volumen −15%", delta: -15 },
                      { label: "Referencia 0%", delta: 0 },
                      { label: "Mayor volumen +15%", delta: 15 },
                    ] as const).map(preset => (
                      <button key={preset.delta} type="button" aria-pressed={weightVariation === preset.delta}
                        onClick={() => {
                          setWeightVariation(preset.delta);
                          setBaselinePreview(false);
                          setVisible(previous => previous.includes("skin") ? previous : ["skin", ...previous]);
                          setOpacity(previous => ({ ...previous, skin: 1 }));
                          setMode("realista");
                        }}>{preset.label}</button>
                    ))}
                  </div>
                  <small>Escenarios ilustrativos, no recomendaciones de peso.</small>
                </div>
                <label className="studio-sim-slider">
                   <span>Estatura del mismo modelo 3D <strong>{statureCm} cm</strong></span>
                   <input type="range" aria-label="Ajustar estatura del modelo anatómico"
                     min="145" max="205" step="1" value={statureCm}
                     onChange={event => {
                       setStatureCm(Number(event.target.value));
                       setBaselinePreview(false);
                     }} />
                   <span className="studio-sim-limits"><small>145 cm · más bajo</small><small>205 cm · más alto</small></span>
                 </label>
                 <div className="studio-sim-presets" role="group" aria-label="Estaturas rápidas del modelo">
                   <span>Estatura visual rápida</span>
                   <div className="studio-sim-preset-buttons">
                     {([
                       { label: "Baja 155 cm", height: 155 },
                       { label: "Referencia 175 cm", height: BASELINE_HEIGHT_CM },
                       { label: "Alta 195 cm", height: 195 },
                     ] as const).map(preset => (
                       <button type="button" key={preset.height} aria-pressed={statureCm === preset.height}
                         onClick={() => {
                           setStatureCm(preset.height);
                           setBaselinePreview(false);
                         }}>{preset.label}</button>
                     ))}
                   </div>
                   <small>El mismo cuerpo se escala verticalmente; no predice proporciones individuales.</small>
                 </div>
                 <div className="studio-sim-state" role="status" aria-label="Diferencia hipotética frente a la referencia">
                   <span className="studio-sim-state-icon" aria-hidden="true">↔</span>
                   <div>
                     <strong>Diferencia del escenario frente a la referencia</strong>
                     <p>Peso: {simulatedWeight >= referenceKg ? "+" : ""}{Math.round((simulatedWeight - referenceKg) * 10) / 10} kg
                       {" · "}Estatura: {statureCm >= BASELINE_HEIGHT_CM ? "+" : ""}{statureCm - BASELINE_HEIGHT_CM} cm</p>
                     <small>Solo visualización ficticia; estas cifras no representan una predicción de salud.</small>
                   </div>
                 </div>
                 {visible.includes("skin") && morphClamping.regions.length > 0 && (
                   <p className="studio-sim-warning" role="status"
                     aria-label="Límite gráfico de deformación">
                     Límite visual alcanzado: algunas regiones del cuerpo 3D ya no
                     aumentan de tamaño proporcionalmente. No representa una
                     predicción de cambios corporales reales.
                   </p>
                 )}
                 {!visible.includes("skin") && <div className="studio-sim-no-skin" role="status">
                <p>La piel está oculta. Activa la superficie corporal para ver el cambio de volumen.</p>
                <button onClick={() => {
                  setVisible(previous => ["skin", ...previous.filter(layer => layer !== "skin")]);
                  setOpacity(previous => ({ ...previous, skin: 1 }));
                  setMode("realista");
                }}>Mostrar piel deformable</button>
              </div>}
              <div className="studio-sim-state">
                  <span className="studio-sim-state-icon">{weightVariation > 0 ? "↗" : weightVariation < 0 ? "↘" : "◈"}</span>
                  <div><strong>{weightVariation === 0 ? "Modelo corporal de referencia" : weightVariation > 0 ? "Incremento visual de volumen" : "Reducción visual de volumen"}</strong>
                    <p>El volumen cambia suavemente en abdomen, pecho, caderas y piernas; el rostro, las manos y los pies mantienen su forma original. La estatura escala verticalmente el mismo atlas. Son efectos gráficos ilustrativos, no clínicos.</p></div>
                </div>
                <div className="studio-sim-mesh">
                  <label><input type="checkbox" checked={meshOverlay} onChange={toggleMesh} />
                    <span><strong>Superponer malla poligonal</strong><small>Visualiza triángulos y topología sobre el modelo deformado.</small></span>
                  </label>
                </div>
                <div className="studio-sim-actions">
                  <button className={baselinePreview ? "active" : ""} aria-pressed={baselinePreview}
                    disabled={comparison}
                    onClick={() => setBaselinePreview(value => !value)}>{baselinePreview ? "Ver escenario modificado" : "Comparar con el original"}</button>
                  <button className={comparison ? "active" : ""} aria-pressed={comparison}
                    onClick={() => { setBaselinePreview(false); setComparison(value => !value); }}>
                    {comparison ? "Cerrar comparación dividida" : "Comparar lado a lado"}
                  </button>
                  {historicalBaseline && (
                    <button type="button" onClick={() => setHistoricalBaseline(null)}>
                      Quitar referencia histórica
                    </button>
                  )}
                  <button onClick={() => setSavedScenario({ baseKg: referenceKg, delta: weightVariation, statureCm })}>Guardar comparación en esta vista</button>
                  <button onClick={resetSimulation}>Restaurar valores</button>
                  <button type="button" onClick={() => void downloadCurrentAvatar()}
                    disabled={captureBusy || comparison || layerStates.skin !== "ready" || !visible.includes("skin") || !!error}>
                    {captureBusy ? "Preparando captura…" : "Descargar imagen 3D (PNG)"}
                  </button>
                  {comparison && (
                    <button type="button" onClick={() => void downloadCurrentAvatar(true)}
                      disabled={captureBusy || layerStates.skin !== "ready" || !visible.includes("skin") || !!error}>
                      {captureBusy ? "Preparando comparación…" : "Descargar comparación (PNG)"}
                    </button>
                  )}
                  <button type="button" onClick={() => void analyzeCurrentAvatar()}
                    disabled={captureBusy || comparison || layerStates.skin !== "ready" || !visible.includes("skin") || !!error}>
                    {captureBusy ? "Preparando captura 3D…" : "Analizar esta vista 3D con IA"}
                  </button>
                </div>
                {comparison && <label className="studio-sim-slider studio-comparison-control">
                  <span>Posición de la comparación <strong>{comparisonDivider}%</strong></span>
                  <input type="range" min="15" max="85" step="5"
                    aria-label="Mover separación entre referencia y escenario"
                    value={comparisonDivider} onChange={event => setComparisonDivider(Number(event.target.value))}/>
                  <small>Izquierda: referencia · Derecha: escenario. Se renderizan dos estados del mismo modelo, sin duplicarlo.</small>
                </label>}
                {comparison && <p className="studio-sim-disclaimer">Para analizar esta vista con IA, cierra la comparación dividida: el detector local debe recibir una sola figura.</p>}
                {captureError && <p role="alert" className="studio-sim-disclaimer">{captureError}</p>}
                <p className="studio-sim-lead">Esta prueba utiliza exclusivamente una imagen del cuerpo anatómico ficticio del atlas. La copia local para IA lleva un fondo neutro opaco para evitar que la transparencia se interprete como oscuridad; el visor original no cambia. No identifica personas ni reconstruye cuerpos reales.</p>
                {savedScenario && <div className="studio-sim-saved" role="status">
                  <strong>Referencia visual guardada</strong>
                  <p>Base {savedScenario.baseKg} kg / {BASELINE_HEIGHT_CM} cm → escenario {Math.round(savedScenario.baseKg * (1 + savedScenario.delta / 100) * 10) / 10} kg / {savedScenario.statureCm} cm.</p>
                  <button onClick={() => { setReferenceKg(savedScenario.baseKg); setWeightVariation(savedScenario.delta); setStatureCm(savedScenario.statureCm); setBaselinePreview(false); }}>Recuperar escenario</button>
                </div>}
                <section className="studio-scenario-history" aria-label="Historial de escenarios simulados">
                  <div className="studio-scenario-history-head">
                    <div>
                      <p className="studio-eyebrow">HISTORIAL VERSIONADO · SOLO DATOS FICTICIOS</p>
                      <h3>Escenarios 3D por expediente</h3>
                    </div>
                    <DataTypeBadge type="SIMULADO" />
                  </div>
                  <p>Las versiones se guardan por separado de las mediciones observadas. Cada versión conserva su autor, fecha y relación con la anterior.</p>
                  <label className="studio-sim-number">
                    Expediente de prueba
                    <select aria-label="Expediente ficticio para escenarios" value={scenarioProfileId}
                      onChange={event => {
                        setScenarioProfileId(event.target.value);
                        setScenarioCompatibilityError("");
                        setHistoricalBaseline(null);
                        setComparison(false);
                        setScenarioOffset(0);
                        setScenarioExportError("");
                        setScenarioParentId("");
                        setScenarioVersionId("");
                        setScenarioRevisionNote("");
                        setScenarioNotice("");
                        saveVersion.reset();
                      }}>
                      <option value="">Seleccionar expediente ficticio</option>
                      {linkedProfile.data && !syntheticProfiles.data?.items.some(row => row.id === linkedProfile.data?.id) && (
                        <option value={linkedProfile.data.id}>{linkedProfile.data.display_name || linkedProfile.data.display_code}</option>
                      )}
                      {syntheticProfiles.data?.items.map(profile => (
                        <option key={profile.id} value={profile.id}>{profile.display_name || profile.display_code}</option>
                      ))}
                    </select>
                  </label>
                  {syntheticProfiles.isError && <p role="alert">No se pudo cargar la lista de expedientes ficticios.</p>}
                  {linkedProfile.isError && scenarioProfileId && <p role="alert">El expediente seleccionado no está disponible en este espacio de trabajo.</p>}
                  {scenarioProfileId && linkedProfile.data && (
                    <>
                      <p className="studio-sim-lead">Expediente: {linkedProfile.data.display_code} · {linkedProfile.data.status === "active" ? "Activo" : "Solo lectura"}</p>
                      {scenarioParentId && (
                        <label className="studio-sim-number">
                          Motivo de nueva versión (mínimo 5 caracteres)
                          <input type="text" maxLength={200} value={scenarioRevisionNote}
                            placeholder="Por ejemplo: ajustar el escenario de peso"
                            onChange={event => setScenarioRevisionNote(event.target.value)} />
                        </label>
                      )}
                      <div className="studio-sim-actions">
                        <button type="button" disabled={readOnly || linkedProfile.data.status !== "active" ||
                            saveVersion.isPending || !!(scenarioParentId && scenarioRevisionNote.trim().length < 5)}
                          onClick={() => { setScenarioNotice(""); saveVersion.mutate(); }}>
                          {saveVersion.isPending ? "Guardando versión…" :
                            scenarioParentId ? "Guardar siguiente versión" : "Crear escenario versionado"}
                        </button>
                        {scenarioParentId && <button type="button" onClick={() => {
                          setScenarioParentId(""); setScenarioRevisionNote(""); setScenarioNotice("");
                        }}>Comenzar otro escenario</button>}
                      </div>
                      {readOnly && <p className="studio-sim-lead">La demostración pública permite consultar el historial, pero no registrar cambios.</p>}
                      {saveVersion.isError && <p role="alert">{saveVersion.error.message}</p>}
                      {scenarioNotice && <p role="status" className="studio-sim-success">{scenarioNotice}</p>}
                      <div className="studio-scenario-records">
                        <h4>Historial registrado</h4>
                        {scenarioHistory.data && scenarioHistory.data.total > 0 && (
                          <div className="studio-scenario-page-toolbar">
                            <span role="status" aria-label="Página del historial simulado">
                              Versiones {scenarioHistory.data.offset + 1}–{scenarioHistory.data.offset + scenarioHistory.data.items.length}
                              {" de "}{scenarioHistory.data.total} · solo SIMULADO
                            </span>
                            <button type="button" onClick={downloadScenarioPage}
                              disabled={scenarioHistory.isFetching || scenarioHistory.data.items.length === 0}>
                              Exportar página CSV
                            </button>
                          </div>
                        )}
                        {scenarioExportError && <p role="alert">{scenarioExportError}</p>}
                        {scenarioCompatibilityError && <p role="alert">{scenarioCompatibilityError}</p>}
                        {scenarioHistory.isPending && <p>Cargando versiones…</p>}
                        {scenarioHistory.isError && <p role="alert">No se pudo consultar el historial de simulaciones.</p>}
                        {scenarioHistory.data?.items.length === 0 && <p>Aún no hay escenarios registrados.</p>}
                        {scenarioHistory.data && <ol aria-label="Versiones de simulación guardadas">
                          {scenarioHistory.data.items.map(row => (
                            <li key={row.id}>
                              <div>
                                <strong>Escenario {row.series_id.slice(0, 8)} · v{row.version}</strong>
                                <span>{row.simulated_kg} kg · {row.stature_cm} cm · {dateTime(row.created_at)}</span>
                                {row.revision_note && <small>{row.revision_note}</small>}
                                {scenarioCompatibilityReason(row) && <small className="studio-scenario-compatibility-warning">
                                  {scenarioCompatibilityReason(row)}
                                </small>}
                              </div>
                              <div className="studio-scenario-row-actions">
                                <button type="button" disabled={!!scenarioCompatibilityReason(row)}
                                  onClick={() => restoreHistoryScenario(row)}>Cargar en 3D</button>
                                <button type="button" disabled={!!scenarioCompatibilityReason(row)}
                                  aria-pressed={historicalBaseline?.id === row.id}
                                  onClick={() => fixHistoricalReference(row)}>
                                  Fijar como referencia
                                </button>
                                <button type="button" onClick={() => setScenarioVersionId(row.id)}>Ver versiones</button>
                              </div>
                            </li>
                          ))}
                        </ol>}
                        {!!scenarioHistory.data && scenarioHistory.data.total > 20 && (
                          <nav className="studio-scenario-pagination" aria-label="Páginas de escenarios simulados">
                            <button type="button" disabled={scenarioOffset === 0 || scenarioHistory.isFetching}
                              onClick={() => setScenarioOffset(offset => Math.max(0, offset - 20))}>
                              Anteriores 20
                            </button>
                            <button type="button"
                              disabled={scenarioHistory.isFetching ||
                                scenarioOffset + scenarioHistory.data.limit >= scenarioHistory.data.total}
                              onClick={() => setScenarioOffset(offset => offset + 20)}>
                              Siguientes 20
                            </button>
                          </nav>
                        )}
                        {!!scenarioHistory.data && scenarioHistory.data.total > 0 &&
                          <small>El CSV contiene únicamente la página visible; no incluye nombres, notas, identificadores de personas ni mediciones observadas.</small>}
                      </div>
                      {!!scenarioVersionId && <div className="studio-sim-saved" aria-label="Cadena de versiones del escenario">
                        <strong>Cadena de versiones</strong>
                        <button type="button" onClick={() => setScenarioVersionId("")}>Cerrar historial</button>
                        {scenarioVersions.isPending && <p>Consultando versiones…</p>}
                        {scenarioVersions.isError && <p role="alert">No se pudo recuperar la cadena de versiones.</p>}
                        {scenarioVersions.data?.map(row => (
                          <div className="studio-scenario-chain-row" key={row.id}>
                            <div>
                              <strong>Versión {row.version} · SIMULADO</strong>
                              <span>{row.simulated_kg} kg · {row.stature_cm} cm · {dateTime(row.created_at)}</span>
                              {scenarioCompatibilityReason(row) && <small className="studio-scenario-compatibility-warning">
                                {scenarioCompatibilityReason(row)}
                              </small>}
                            </div>
                            <div className="studio-scenario-row-actions">
                              <button type="button" disabled={!!scenarioCompatibilityReason(row)}
                                onClick={() => restoreHistoryScenario(row)}>
                                Cargar v{row.version} en 3D
                              </button>
                              <button type="button" disabled={!!scenarioCompatibilityReason(row)}
                                aria-pressed={historicalBaseline?.id === row.id}
                                onClick={() => fixHistoricalReference(row)}>
                                Fijar v{row.version} como referencia
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>}
                    </>
                  )}
                </section>
                <p className="studio-sim-disclaimer"><strong>SIMULACIÓN NO VALIDADA.</strong> Los kg y los cm son valores hipotéticos; la deformación 3D no calcula grasa, masa muscular, proporciones anatómicas reales ni predice la apariencia de una persona. No modifica mediciones, expedientes ni reportes.</p>
              </div>
            )}
            {panel === "informacion" && (
              identified ? (
                <div className="studio-info">
                  <p className="studio-eyebrow">FICHA ANATÓMICA</p>
                  <h2>{anatomyDisplayName(identified.medical)}</h2>
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
                  <p className="studio-original-note">Algunos nombres frecuentes se muestran en español; las descripciones originales y términos no revisados conservan el idioma del catálogo fuente.</p>
                  <div className="studio-info-actions">
                    <button onClick={() => setIsolated(value => !value)}>{isolated ? "Mostrar todas las piezas" : "Aislar estructura"}</button>
                    <button onClick={() => { controller.current?.clearSelection(); setSelectedEntry(null); setIsolated(false); }}>Cerrar ficha</button>
                  </div>
                </div>
              ) : selected ? (
                <div className="studio-info"><p className="studio-eyebrow">ESTRUCTURA 3D</p><h2>{anatomyDisplayName(cleanMesh(selected.name))}</h2>
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
