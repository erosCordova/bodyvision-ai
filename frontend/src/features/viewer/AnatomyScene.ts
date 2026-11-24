import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import { anatomySource } from "./atlasSource";
import { captureOpaqueAtlasPng, type AtlasComparisonDetails } from "./atlasCapture";
import { planAtlasCapture } from "./atlasCaptureResolution";
import { bodyVisualScenario, DEFAULT_REFERENCE_KG } from "./bodyVolume";
import { buildHistoricalComparisonShape, remapHeightBounds, type HistoricalComparisonControls } from "./historicalComparison";
import { SOFT_TISSUE_PROFILE_GLSL, SOFT_TISSUE_PROFILE_VERSION } from "./softTissueProfile";
import { heightScale } from "./bodyStature";
import { atlasPixelRatio } from "./renderBudget";
import { recordRenderCpuSample, summarizeRenderCpuSamples } from "./renderCpuTiming";
import { recordVisibleRafInterval, summarizeRafFrameIntervals } from "./renderFramePacing";
import { eligibleForGeometryLod, isUsefulLod, lodVerticesToRemove, triangleCount, shouldPrepareGeometryLod } from "./geometryLod";
import { estimateRetainedGeometryMemory } from "./geometryMemory";
import { anatomyMeshName, anatomyNameKey } from "./anatomyNames";

export const anatomicalLayers = [
  { id: "skin", label: "Piel", detail: "Superficie corporal", color: "#c68e74" },
  { id: "muscles", label: "Músculos", detail: "Sistema muscular", color: "#b7524d" },
  { id: "skeleton", label: "Esqueleto", detail: "Huesos y cartílagos", color: "#e6dbc7" },
  { id: "arteries", label: "Arterias", detail: "Circulación arterial", color: "#e26a60" },
  { id: "veins", label: "Venas", detail: "Circulación venosa", color: "#6f9cdb" },
  { id: "nerves", label: "Nervios", detail: "Sistema nervioso", color: "#e2cb8b" },
] as const;

export type AnatomicalLayer = (typeof anatomicalLayers)[number]["id"];
export type LayerOpacity = Record<AnatomicalLayer, number>;
export type RenderMode = "realista" | "holograma" | "radiografia";
export type SceneQuality = "alta" | "fluida";
export type SelectedStructure = { name: string; layer: AnatomicalLayer };
export type LayerState = "loading" | "ready" | "error";

const assetSource = anatomySource + "web/public/models/";

/** Soft-tissue GPU morph; visualization only, not a patient-specific model. */
const BODYVOLUME_VERTEX = `
  // Skip deformation work entirely at reference weight.
  if (abs(uBVVolume) > 0.00001) {
    vec3 bvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
    float bvSpan = max(uBVBounds.y - uBVBounds.x, 0.00001);
    float bvHeight = clamp((bvWorld.y - uBVBounds.x) / bvSpan, 0.0, 1.0);
    float bvLateral = abs(bvWorld.x - uBVBounds.z) / bvSpan;
    vec2 bvZones = bvProfile(bvHeight, bvLateral);
    float bvDepthFromCenter = (bvWorld.z - uBVBounds.w) / bvSpan;
    float bvFrontBias = mix(0.86, 1.14, smoothstep(-0.04, 0.055, bvDepthFromCenter));
    float bvScaleX = clamp(1.0 + uBVVolume * uBVStrength * bvZones.x, 0.60, 1.40);
    float bvScaleZ = clamp(1.0 + uBVVolume * uBVStrength * bvZones.y * bvFrontBias, 0.60, 1.40);
    vec3 bvOffset = vec3(
      (bvWorld.x - uBVBounds.z) * (bvScaleX - 1.0), 0.0,
      (bvWorld.z - uBVBounds.w) * (bvScaleZ - 1.0)
    );
    // Convert world-space offsets back to the existing mesh's local geometry.
    vec3 bvAxisX = modelMatrix[0].xyz;
    vec3 bvAxisY = modelMatrix[1].xyz;
    vec3 bvAxisZ = modelMatrix[2].xyz;
    transformed += vec3(
      dot(bvOffset, bvAxisX) / max(dot(bvAxisX, bvAxisX), 0.00001),
      dot(bvOffset, bvAxisY) / max(dot(bvAxisY, bvAxisY), 0.00001),
      dot(bvOffset, bvAxisZ) / max(dot(bvAxisZ, bvAxisZ), 0.00001)
    );
  }
`;

/** First-order normal correction so light follows the changed cross-section. */
const BODYVOLUME_NORMAL = `
  if (abs(uBVVolume) > 0.00001) {
    vec3 bvNormalWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    float bvNormalSpan = max(uBVBounds.y - uBVBounds.x, 0.00001);
    float bvNormalHeight = clamp((bvNormalWorld.y - uBVBounds.x) / bvNormalSpan, 0.0, 1.0);
    float bvNormalLateral = abs(bvNormalWorld.x - uBVBounds.z) / bvNormalSpan;
    vec2 bvNormalZones = bvProfile(bvNormalHeight, bvNormalLateral);
    float bvNormalDepth = (bvNormalWorld.z - uBVBounds.w) / bvNormalSpan;
    float bvNormalBias = mix(0.86, 1.14, smoothstep(-0.04, 0.055, bvNormalDepth));
    float bvNormalXScale = clamp(1.0 + uBVVolume * uBVStrength * bvNormalZones.x, 0.60, 1.40);
    float bvNormalZScale = clamp(1.0 + uBVVolume * uBVStrength * bvNormalZones.y * bvNormalBias, 0.60, 1.40);
    objectNormal.x /= bvNormalXScale;
    objectNormal.z /= bvNormalZScale;
    objectNormal = normalize(objectNormal);
  }
`;

function attachBodyVolume(
  material: THREE.Material, layer: AnatomicalLayer,
  volume: { value: number }, bounds: { value: THREE.Vector4 },
) {
  const strength = layer === "skin" ? 1 : layer === "muscles" ? 0.18 : 0;
  // No morph shader for hard anatomical structures, which must remain fixed.
  if (strength === 0) return;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBVVolume = volume;
    shader.uniforms.uBVBounds = bounds;
    shader.uniforms.uBVStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
uniform float uBVVolume;
uniform vec4 uBVBounds;
uniform float uBVStrength;
${SOFT_TISSUE_PROFILE_GLSL}`)
      .replace("#include <beginnormal_vertex>", "#include <beginnormal_vertex>\n" + BODYVOLUME_NORMAL)
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + BODYVOLUME_VERTEX);
  };
  material.customProgramCacheKey = () => SOFT_TISSUE_PROFILE_VERSION + "-strength-" + strength;
}

/**
 * The source is Z-Anatomy / BodyParts3D, processed by SeemaBansal1.
 * Source and derivative geometry have attribution/share-alike obligations.
 * The organ model is intentionally not loaded: it contains a CC BY-NC kidney.
 * This is an educational reference, not a patient-specific or diagnostic model.
 */
function appearance(layer: AnatomicalLayer, name: string) {
  const lower = name.toLowerCase();
  if (layer === "skeleton") {
    if (lower.includes("cartilage")) return { color: "#bbd8db", roughness: 0.39, clearcoat: 0.2 };
    if (lower.includes("teeth")) return { color: "#f0eae0", roughness: 0.26, clearcoat: 0.28 };
    return { color: "#e5dac7", roughness: 0.61, clearcoat: 0.07 };
  }
  if (layer === "muscles") {
    if (lower.includes("tendon")) return { color: "#e2d9cb", roughness: 0.44, clearcoat: 0.2 };
    return { color: "#a8423c", roughness: 0.44, clearcoat: 0.34 };
  }
  if (layer === "arteries") return { color: "#c44445", roughness: 0.36, clearcoat: 0.32 };
  if (layer === "veins") return { color: "#416caa", roughness: 0.39, clearcoat: 0.3 };
  if (layer === "nerves") return { color: "#dfc788", roughness: 0.51, clearcoat: 0.17 };
  if (lower.includes("black") || lower.includes("hair")) return { color: "#33231f", roughness: 0.69, clearcoat: 0.04 };
  if (lower.includes("garment")) return { color: "#394d66", roughness: 0.83, clearcoat: 0.02 };
  if (lower.includes("nail")) return { color: "#e6b9a2", roughness: 0.34, clearcoat: 0.24 };
  if (lower.includes("cornea") || lower.includes("eye")) return { color: "#e3e7e9", roughness: 0.2, clearcoat: 0.5 };
  if (lower.includes("iris")) return { color: "#604330", roughness: 0.3, clearcoat: 0.3 };
  return { color: "#c89578", roughness: 0.56, clearcoat: 0.08 };
}

function releaseRoot(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
}

export function createAnatomyScene(
  host: HTMLDivElement,
  onStatus: (message: string) => void,
  onSelected: (part: SelectedStructure | null) => void,
  onLayerState: (layer: AnatomicalLayer, state: LayerState) => void,
  onError: (message: string) => void,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  // One displayed frame can contain both reference and scenario passes.
  // Reset once per displayed frame, rather than losing the first pass's work.
  renderer.info.autoReset = false;
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Cuerpo humano anatómico 3D. Arrastra para rotar o usa flechas con el lienzo enfocado; más y menos para zoom, Inicio para centrar y Escape para limpiar selección.");
  canvas.setAttribute("aria-keyshortcuts", "ArrowLeft ArrowRight ArrowUp ArrowDown + - Home Escape");
  canvas.tabIndex = 0;
  host.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, 0.02, 100);
  camera.position.set(2.5, 0.9, 3.65);
  scene.add(new THREE.HemisphereLight(0xe9f3ff, 0x17253b, 1.65));
  const key = new THREE.DirectionalLight(0xfff0e5, 2.8);
  key.position.set(3, 5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x91caff, 1.8);
  fill.position.set(-3, 3, -2);
  scene.add(fill);

  const root = new THREE.Group();
  const anatomical = new THREE.Group();
  root.add(anatomical);
  scene.add(root);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = true;
  controls.enableDamping = false;
  controls.minDistance = 0.25;
  controls.maxDistance = 10;
  controls.target.set(0, 0, 0);

  const draco = new DRACOLoader();
  draco.setDecoderPath({ js: dracoWrapperUrl, wasm: dracoWasmUrl });
  draco.setWorkerLimit(2);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const objects = new Map<AnatomicalLayer, THREE.Group>();
  const loading = new Set<AnatomicalLayer>();
  const layerReadyMs: Partial<Record<AnatomicalLayer, number>> = {};
  const settings = new Map<AnatomicalLayer, { visible: boolean; opacity: number }>();
  const assets = new Map<AnatomicalLayer, Set<THREE.Material>>();
  const meshOverlays = new Map<AnatomicalLayer, THREE.MeshBasicMaterial>();
  type LodEntry = { layer: AnatomicalLayer; high: THREE.BufferGeometry; low: THREE.BufferGeometry | null; state: "pending" | "building" | "ready" | "failed" };
  // The high-fidelity geometry always remains available for detailed study and picking.
  const lodEntries = new Map<THREE.Mesh, LodEntry>();
  let lodTimer: number | null = null;
  let lodBusy = false;
  const volume = { value: 0 };
  let referenceVolume = 0;
  let historicalComparison: ReturnType<typeof buildHistoricalComparisonShape> | null = null;
  const massBounds = { value: new THREE.Vector4(0, 2.5, 0, 0) };
  let showWireMesh = false;
  let comparison = false;
  let comparisonDivider = 50;
  let statureCm = 175;
  let mode: RenderMode = "realista";
  let quality: SceneQuality = "alta";
  let interacting = false;
  let disposed = false;
  let contextUnavailable = false;
  let fitted = false;
  let autoRotate = false;
  let dashboardHalo: THREE.Group | null = null;
  let scanElapsed = 0;
  let scanTimestamp: number | null = null;
  let isolated = false;
  let selectedMesh: THREE.Mesh | null = null;
  let selectedLayer: AnatomicalLayer | null = null;
  let previousMaterials: THREE.Material | THREE.Material[] | null = null;
  let pendingFocus: SelectedStructure | null = null;
  let raf = 0;
  let renderedFrames = 0;
  let renderPasses = 0;
  let cpuSubmissionMs: number | null = null;
  const cpuSubmissionSamples: number[] = [];
  const visibleRafIntervals: number[] = [];
  let previousVisibleRafTimestamp: number | null = null;

  const render = () => {
    if (disposed || contextUnavailable) return;
    const started = performance.now();
    renderer.info.reset();
    renderPasses = 0;
    try {
      if (!comparison || canvas.width < 2) {
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, canvas.width, canvas.height);
        renderer.render(scene, camera);
        renderPasses++;
        return;
      }
      // Two render passes of the SAME anatomical mesh, camera and materials.
      // The scissor never permits one scenario to spill into the other.
      const width = canvas.width;
      const height = canvas.height;
      const dividerPx = Math.round(width * comparisonDivider / 100);
      const actualVolume = volume.value;
      const actualY = root.scale.y;
      const boundsMinY = massBounds.value.x;
      const boundsMaxY = massBounds.value.y;
      try {
        renderer.setScissorTest(true);
        renderer.setViewport(0, 0, width, height);
        renderer.setScissor(0, 0, dividerPx, height);
        volume.value = historicalComparison?.radialVariation ?? referenceVolume;
        const baselineY = root.scale.x * (historicalComparison?.statureScale ?? 1);
        const baselineBounds = remapHeightBounds(boundsMinY, boundsMaxY, actualY, baselineY);
        root.scale.y = baselineY;
        massBounds.value.x = baselineBounds.minY;
        massBounds.value.y = baselineBounds.maxY;
        root.updateMatrixWorld(true);
        renderer.render(scene, camera);
        renderPasses++;
        renderer.setScissor(dividerPx, 0, width - dividerPx, height);
        volume.value = actualVolume;
        root.scale.y = actualY;
        massBounds.value.x = boundsMinY;
        massBounds.value.y = boundsMaxY;
        root.updateMatrixWorld(true);
        renderer.render(scene, camera);
        renderPasses++;
      } finally {
        // The left render pass is transient. Leave the interactive scene,
        // shader uniforms and current stature exactly as they were.
        volume.value = actualVolume;
        root.scale.y = actualY;
        massBounds.value.x = boundsMinY;
        massBounds.value.y = boundsMaxY;
        root.updateMatrixWorld(true);
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, width, height);
      }
    } finally {
      // CPU submission time deliberately does not claim GPU completion or FPS.
      cpuSubmissionMs = performance.now() - started;
      recordRenderCpuSample(cpuSubmissionSamples, cpuSubmissionMs);
      renderedFrames++;
    }
  };
  const applyGeometryLod = () => {
    let changed = false;
    for (const [mesh, entry] of lodEntries) {
      // Selected anatomical structures must always keep the original geometry.
      const next = quality === "fluida" && mesh !== selectedMesh && entry.low
        ? entry.low : entry.high;
      if (mesh.geometry === next) continue;
      mesh.geometry = next;
      for (const child of mesh.children) {
        if (child instanceof THREE.Mesh && child.userData.bodyvisionMeshOverlay) {
          child.geometry = next;
        }
      }
      changed = true;
    }
    if (changed) render();
  };
  const queueGeometryLod = () => {
    if (disposed || quality !== "fluida" || lodBusy || lodTimer !== null) return;
    const candidate = [...lodEntries].filter(([mesh, entry]) =>
      shouldPrepareGeometryLod(true, settings.get(entry.layer)?.visible === true,
        mesh.visible, entry.state === "pending"),
    ).sort((a, b) => triangleCount(b[1].high) - triangleCount(a[1].high))[0];
    if (!candidate) return;
    const [, entry] = candidate;
    entry.state = "building";
    lodBusy = true;
    // Yield to the first 3D frame and to input handling. Do not simplify every
    // model eagerly or run heavy mesh processing in the render loop.
    lodTimer = window.setTimeout(() => {
      lodTimer = null;
      void (async () => {
        if (disposed || quality !== "fluida" || settings.get(entry.layer)?.visible !== true) {
          entry.state = "pending";
          return;
        }
        const { SimplifyModifier } = await import("three/addons/modifiers/SimplifyModifier.js");
        if (disposed) return;
        if (settings.get(entry.layer)?.visible !== true) {
          entry.state = "pending";
          return;
        }
        const simplified = await new SimplifyModifier().modify(
          entry.high, lodVerticesToRemove(entry.high),
        );
        if (disposed || settings.get(entry.layer)?.visible !== true) {
          simplified.dispose();
          entry.state = "pending";
          return;
        }
        if (isUsefulLod(entry.high, simplified)) {
          entry.low = simplified;
          entry.state = "ready";
          applyGeometryLod();
        } else {
          simplified.dispose();
          entry.state = "failed";
        }
      })().catch(() => { entry.state = "failed"; }).finally(() => {
        lodBusy = false;
        queueGeometryLod();
      });
    }, 80);
  };
  const resize = (force = false) => {
    if (disposed) return;
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = atlasPixelRatio(bounds.width, bounds.height, window.devicePixelRatio || 1, quality, interacting);
    const currentSize = renderer.getSize(new THREE.Vector2());
    const sizeChanged = currentSize.x !== bounds.width || currentSize.y !== bounds.height;
    const ratioChanged = Math.abs(renderer.getPixelRatio() - ratio) > 0.0001;
    // Avoid submitting duplicate GPU work for ResizeObserver notifications
    // that do not actually change the CSS size or device pixel budget.
    if (!sizeChanged && !ratioChanged && !force) return;
    if (sizeChanged) renderer.setSize(bounds.width, bounds.height, false);
    if (ratioChanged) renderer.setPixelRatio(ratio);
    if (sizeChanged || camera.aspect !== bounds.width / bounds.height) {
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
    }
    render();
  };
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(host);

  const tick = (timestamp: number) => {
    raf = 0;
    if (disposed || contextUnavailable || !autoRotate || document.hidden) return;
    // Count callback spacing only when this rotation actually submits WebGL.
    // Never mistake idle requestAnimationFrame callbacks for rendered frames.
    const before = renderedFrames;
    if (dashboardHalo?.visible) {
      if (scanTimestamp !== null) scanElapsed += Math.min(100, timestamp - scanTimestamp);
      scanTimestamp = timestamp;
      // Eight seconds per round trip, starting at the top of the fitted atlas.
      const progress = (1 + Math.cos(scanElapsed * Math.PI * 2 / 8000)) / 2;
      dashboardHalo.position.y = THREE.MathUtils.lerp(massBounds.value.x, massBounds.value.y, progress);
    }
    // OrbitControls emits "change" and renders through its registered listener.
    // A second synchronous render per animation frame would double GPU work.
    controls.update();
    if (dashboardHalo?.visible && renderedFrames === before) render();
    previousVisibleRafTimestamp = renderedFrames > before
      ? recordVisibleRafInterval(visibleRafIntervals, previousVisibleRafTimestamp, timestamp)
      : null;
    raf = requestAnimationFrame(tick);
  };
  const updateAnimation = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    // A hidden tab, paused rotation or WebGL context loss starts a new
    // observational interval rather than manufacturing a huge frame delay.
    previousVisibleRafTimestamp = null;
    scanTimestamp = null;
    if (autoRotate && !document.hidden && !disposed && !contextUnavailable) raf = requestAnimationFrame(tick);
  };
  const setAutoRotate = (enabled: boolean) => {
    const next = enabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (next !== autoRotate) visibleRafIntervals.length = 0;
    autoRotate = next;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.9;
    updateAnimation();
  };
  // Dashboard-only decorative scanner. It never changes anatomy or measurements.
  const setDashboardAnimation = (enabled: boolean) => {
    const next = enabled && fitted && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (next && !dashboardHalo) {
      dashboardHalo = new THREE.Group();
      dashboardHalo.name = "Dashboard decorative scan halo";
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const radius = Math.max(Math.hypot(size.x, size.z) * 0.58, 0.22);
      const addRing = (tube: number, color: number, opacity: number) => {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius, tube, 8, 96),
          new THREE.MeshBasicMaterial({
            color, transparent: true, opacity, depthWrite: false,
            blending: THREE.AdditiveBlending, toneMapped: false,
          }),
        );
        ring.rotation.x = Math.PI / 2;
        dashboardHalo!.add(ring);
      };
      addRing(0.026, 0x0ea5e9, 0.14);
      addRing(0.013, 0x22d3ee, 0.38);
      addRing(0.004, 0xcffafe, 0.95);
      dashboardHalo.position.set(massBounds.value.z, massBounds.value.y, massBounds.value.w);
      scene.add(dashboardHalo);
    }
    if (dashboardHalo) dashboardHalo.visible = next;
    setAutoRotate(next);
    render();
  };
  const visibilityChange = () => updateAnimation();
  document.addEventListener("visibilitychange", visibilityChange);
  const contextLost = (event: Event) => {
    event.preventDefault();
    contextUnavailable = true;
    updateAnimation();
    onError("Se interrumpió la conexión gráfica. Se intentará recuperar el visor; si el cuerpo no regresa, pulsa «Recargar visor».");
    onStatus("Conexión gráfica interrumpida · esperando recuperación");
  };
  const contextRestored = () => {
    if (disposed) return;
    contextUnavailable = false;
    resize(true); // A restored WebGL context must be explicitly redrawn.
    onError("");
    onStatus("Conexión gráfica restablecida · modelo anatómico disponible");
    updateAnimation();
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextrestored", contextRestored);

  const restoreHighlight = () => {
    if (selectedMesh && previousMaterials) {
      const highlighted = Array.isArray(selectedMesh.material) ? selectedMesh.material : [selectedMesh.material];
      highlighted.forEach(m => m.dispose());
      selectedMesh.material = previousMaterials;
    }
    previousMaterials = null;
    selectedMesh = null;
    selectedLayer = null;
  };
  const showSelection = (mesh: THREE.Mesh | null, layer: AnatomicalLayer | null) => {
    restoreHighlight();
    if (!mesh || !layer) {
      onSelected(null);
      isolated = false;
      applyAll();
      return;
    }
    selectedMesh = mesh;
    selectedLayer = layer;
    previousMaterials = mesh.material;
    const accent = new THREE.Color(0x82caff);
    const highlight = (old: THREE.Material) => {
      const cloned = old.clone();
      cloned.onBeforeCompile = old.onBeforeCompile;
      cloned.customProgramCacheKey = old.customProgramCacheKey;
      if (cloned instanceof THREE.MeshPhysicalMaterial) {
        cloned.emissive.copy(accent);
        cloned.emissiveIntensity = 0.32;
      }
      return cloned;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(highlight) : highlight(mesh.material);
    onSelected({ name: anatomyMeshName(mesh) || "Estructura sin nombre", layer });
    applyGeometryLod();
    applyAll();
  };

  const applyLayer = (layer: AnatomicalLayer) => {
    const group = objects.get(layer);
    if (!group) return;
    const s = settings.get(layer) ?? { visible: false, opacity: 1 };
    group.visible = s.visible;
    group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.userData.bodyvisionMeshOverlay) {
        node.visible = showWireMesh && mode !== "holograma" && (!isolated || node.parent === selectedMesh);
        return;
      }
      node.visible = !isolated || node === selectedMesh;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshPhysicalMaterial)) continue;
        const originalColor = material.userData.baseColor as string | undefined;
        const reference = new THREE.Color(originalColor || anatomicalLayers.find(item => item.id === layer)?.color || "#c8d5e4");
        material.color.copy(mode === "holograma" ? new THREE.Color("#64cfe8") : mode === "radiografia" ? new THREE.Color("#c3e9f7") : reference);
        const wireframe = mode === "holograma";
        const nextOpacity = mode === "radiografia" ? Math.min(s.opacity, 0.26) : mode === "holograma" ? Math.min(s.opacity, 0.83) : s.opacity;
        const transparent = nextOpacity < 1;
        const depthWrite = !transparent;
        // Material uniforms update without recompiling the shader every time.
        // Only variants that affect GPU programs should mark it dirty.
        if (material.wireframe !== wireframe || material.transparent !== transparent ||
            material.depthWrite !== depthWrite) {
          material.wireframe = wireframe;
          material.transparent = transparent;
          material.depthWrite = depthWrite;
          material.needsUpdate = true;
        }
        material.opacity = nextOpacity;
      }
    });
    const wire = meshOverlays.get(layer);
    if (wire) wire.opacity = Math.min(0.46, Math.max(0.12, s.opacity * 0.42));
    // Do not render per layer. The calling operation draws all layers once.
  };
  function applyAll() {
    for (const layer of anatomicalLayers) applyLayer(layer.id);
    render();
  }

  const frameBody = () => {
    const box = new THREE.Box3().setFromObject(anatomical);
    if (box.isEmpty()) return;
    const dimension = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const max = Math.max(dimension.x, dimension.y, dimension.z, 0.01);
    anatomical.position.set(-center.x, -center.y, -center.z);
    const baseScale = 2.5 / max;
    root.scale.set(baseScale, baseScale * heightScale(statureCm), baseScale);
    root.updateMatrixWorld(true);
    const fittedBox = new THREE.Box3().setFromObject(root);
    const fittedCentre = fittedBox.getCenter(new THREE.Vector3());
    massBounds.value.set(fittedBox.min.y, fittedBox.max.y, fittedCentre.x, fittedCentre.z);
    resetCamera();
    fitted = true;
    // Loading a layer performs the final render after applying material state.
  };

  const matchingMesh = (group: THREE.Group, requestedName: string) => {
    const normalized = anatomyNameKey(requestedName);
    let found: THREE.Mesh | null = null;
    group.traverse(obj => {
      if (found || !(obj instanceof THREE.Mesh)) return;
      const name = anatomyNameKey(anatomyMeshName(obj));
      if (normalized && (name === normalized || name.startsWith(normalized))) found = obj;
    });
    return found;
  };

  const focus = (name: string, layer: AnatomicalLayer) => {
    pendingFocus = { name, layer };
    const group = objects.get(layer);
    if (!group) { load(layer); return false; }
    const mesh = matchingMesh(group, name);
    if (!mesh) {
      onStatus("La estructura \"" + name + "\" no se encontró en la malla cargada.");
      pendingFocus = null;
      return false;
    }
    pendingFocus = null;
    showSelection(mesh, layer);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    const dimensions = box.getSize(new THREE.Vector3());
    const radius = Math.max(dimensions.length() * 0.7, 0.09);
    const direction = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    const distance = THREE.MathUtils.clamp(radius * 5.1, 0.4, 3.6);
    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);
    controls.update(); // Selection already rendered, and camera change emits an update.
    return true;
  };

  /** Only allocate the polygon overlay when explicitly requested. Geometry stays shared. */
  const ensureWireOverlays = (layer: AnatomicalLayer, group: THREE.Group) => {
    const wire = meshOverlays.get(layer);
    if (!wire) return;
    const candidates: THREE.Mesh[] = [];
    group.traverse(node => {
      if (!(node instanceof THREE.Mesh) || node.userData.bodyvisionMeshOverlay) return;
      if (!node.children.some(child => child.userData.bodyvisionMeshOverlay)) candidates.push(node);
    });
    for (const node of candidates) {
      const overlay = new THREE.Mesh(node.geometry, wire);
      overlay.userData.bodyvisionMeshOverlay = true;
      overlay.name = "Malla poligonal " + layer;
      overlay.frustumCulled = false;
      overlay.renderOrder = 2;
      node.add(overlay);
    }
  };

  const load = (layer: AnatomicalLayer) => {
    if (disposed || objects.has(layer) || loading.has(layer)) return;
    const startedLoading = performance.now();
    loading.add(layer);
    onLayerState(layer, "loading");
    onStatus("Descargando " + (anatomicalLayers.find(item => item.id === layer)?.label || layer).toLowerCase() + "…");
    loader.load(
      assetSource + layer + ".glb",
      gltf => {
        loading.delete(layer);
        if (disposed) { releaseRoot(gltf.scene); return; }
        const group = gltf.scene;
        const cached = new Map<string, THREE.MeshPhysicalMaterial>();
        const old = new Set<THREE.Material>();
        const wireMaterial = new THREE.MeshBasicMaterial({
          color: "#81e5fa", wireframe: true, transparent: true, opacity: 0.42,
          depthTest: true, depthWrite: false, side: THREE.DoubleSide,
        });
        attachBodyVolume(wireMaterial, layer, volume, massBounds);
        meshOverlays.set(layer, wireMaterial);
        const originalMeshes: THREE.Mesh[] = [];
        group.traverse(node => { if (node instanceof THREE.Mesh) originalMeshes.push(node); });
        for (const node of originalMeshes) {
          node.frustumCulled = false;
          const replace = (material: THREE.Material) => {
            old.add(material);
            const name = material.name || "generic";
            const cacheKey = name;
            let result = cached.get(cacheKey);
            if (!result) {
              const a = appearance(layer, name);
              result = new THREE.MeshPhysicalMaterial({
                color: a.color, roughness: a.roughness, clearcoat: a.clearcoat,
                metalness: 0, side: THREE.DoubleSide,
                polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
              });
              attachBodyVolume(result, layer, volume, massBounds);
              result.userData.baseColor = a.color;
              cached.set(cacheKey, result);
            }
            return result;
          };
          node.material = Array.isArray(node.material) ? node.material.map(replace) : replace(node.material);
        }
        old.forEach(material => material.dispose());
        for (const node of originalMeshes) {
          if (!(node instanceof THREE.SkinnedMesh) && eligibleForGeometryLod(node.geometry)) {
            lodEntries.set(node, { layer, high: node.geometry, low: null, state: "pending" });
          }
        }
        assets.set(layer, new Set([...cached.values(), wireMaterial]));
        objects.set(layer, group);
        anatomical.add(group);
        if (showWireMesh) ensureWireOverlays(layer, group);
        if (!fitted) frameBody();
        applyLayer(layer);
        render();
        // Download + glTF/Draco decoding + CPU scene preparation and first
        // WebGL submission. GPU completion is NOT included in this duration.
        layerReadyMs[layer] = Math.round((performance.now() - startedLoading) * 100) / 100;
        queueGeometryLod();
        onStatus("Modelo anatómico preparado · selecciona una estructura");
        onLayerState(layer, "ready");
        if (pendingFocus?.layer === layer) focus(pendingFocus.name, layer);
      },
      undefined,
      () => {
        loading.delete(layer);
        if (!disposed) {
          onLayerState(layer, "error");
          onStatus("No se pudo descargar una capa. Usa su botón Reintentar.");
        }
      },
    );
  };

  const update = (visible: ReadonlySet<AnatomicalLayer>, opacity: LayerOpacity) => {
    if (disposed) return;
    for (const layer of anatomicalLayers) {
      const id = layer.id;
      settings.set(id, { visible: visible.has(id), opacity: THREE.MathUtils.clamp(opacity[id], 0.1, 1) });
      if (visible.has(id)) load(id);
    }
    if (selectedLayer && !visible.has(selectedLayer)) showSelection(null, null);
    applyAll();
    queueGeometryLod();
  };
  const setRenderMode = (next: RenderMode) => { mode = next; applyAll(); };
  const setWeightVariation = (percent: number, referenceKg = DEFAULT_REFERENCE_KG) => {
    const visual = bodyVisualScenario(referenceKg, percent);
    referenceVolume = visual.referenceRadialVariation;
    volume.value = visual.scenarioRadialVariation;
    render();
  };
  const setStature = (centimeters: number) => {
    statureCm = Number.isFinite(centimeters) ? Math.max(145, Math.min(205, centimeters)) : 175;
    // Keep the same anatomical model, materials and wireframe while
    // rescaling the existing mesh and all loaded internal layers.
    root.scale.y = root.scale.x * heightScale(statureCm);
    root.updateMatrixWorld(true);
    if (fitted) {
      const bounds = new THREE.Box3().setFromObject(root);
      const center = bounds.getCenter(new THREE.Vector3());
      massBounds.value.set(bounds.min.y, bounds.max.y, center.x, center.z);
    }
    render();
  };
  const setMeshOverlay = (enabled: boolean) => {
    showWireMesh = enabled;
    if (enabled) for (const [layer, group] of objects) ensureWireOverlays(layer, group);
    applyAll();
  };
  const setComparisonBaseline = (controls: HistoricalComparisonControls | null) => {
    // This alters only the left pass of the existing WebGL scene; no
    // duplicate avatar or scene is allocated. Null restores the original.
    historicalComparison = controls ? buildHistoricalComparisonShape(controls) : null;
    render();
  };
  const setComparison = (enabled: boolean, divider = comparisonDivider) => {
    comparison = enabled;
    comparisonDivider = Number.isFinite(divider)
      ? THREE.MathUtils.clamp(divider, 15, 85) : 50;
    render();
  };
  const setQuality = (next: SceneQuality) => {
    quality = next;
    applyGeometryLod();
    resize();
    queueGeometryLod();
  };
  const setIsolated = (enabled: boolean) => { isolated = enabled && !!selectedMesh; applyAll(); };
  const resetCamera = () => {
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distance = Math.min(controls.maxDistance, Math.max(
      2.5 / (2 * Math.tan(halfFov) * 0.68),
      1.2 / (2 * Math.tan(halfFov) * Math.max(camera.aspect, 0.2) * 0.82),
    ));
    controls.target.set(0, 0, 0);
    camera.position.set(0.35, 0.08, 1).normalize().multiplyScalar(distance);
    // OrbitControls dispatches one synchronous change event for the new pose;
    // an extra render() here doubles WebGL work on each camera reset.
    controls.update();
  };
  const view = (type: "front" | "back" | "left" | "right") => {
    const dist = camera.position.distanceTo(controls.target);
    const angle = type === "front" ? 0 : type === "back" ? Math.PI : type === "left" ? -Math.PI / 2 : Math.PI / 2;
    camera.position.set(
      controls.target.x + Math.sin(angle) * dist,
      controls.target.y + 0.04 * dist,
      controls.target.z + Math.cos(angle) * dist,
    );
    controls.update(); // The change listener renders the updated camera once.
  };
  const zoom = (factor: number) => {
    const displacement = new THREE.Vector3().subVectors(camera.position, controls.target);
    displacement.multiplyScalar(factor);
    displacement.clampLength(controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(displacement);
    controls.update(); // Do not render again after the change event.
  };
  const clearSelection = () => showSelection(null, null);
  const keyboard = (event: KeyboardEvent) => {
    if (disposed || contextUnavailable || event.ctrlKey || event.altKey || event.metaKey) return;
    const yaw = event.key === "ArrowLeft" ? -Math.PI / 18 :
      event.key === "ArrowRight" ? Math.PI / 18 : 0;
    const pitch = event.key === "ArrowUp" ? -Math.PI / 18 :
      event.key === "ArrowDown" ? Math.PI / 18 : 0;
    if (yaw || pitch) {
      event.preventDefault();
      const displacement = camera.position.clone().sub(controls.target);
      const spherical = new THREE.Spherical().setFromVector3(displacement);
      spherical.theta += yaw;
      spherical.phi = THREE.MathUtils.clamp(spherical.phi + pitch, 0.09, Math.PI - 0.09);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
      camera.lookAt(controls.target);
      controls.update(); // Keyboard rotation is rendered by OrbitControls.
      return;
    }
    switch (event.key) {
      case "+":
      case "=":
        event.preventDefault(); zoom(0.85); break;
      case "-":
      case "_":
        event.preventDefault(); zoom(1.18); break;
      case "Home":
        event.preventDefault(); resetCamera(); break;
      case "Escape":
        event.preventDefault(); clearSelection(); break;
    }
  };

  const raycaster = new THREE.Raycaster();
  const point = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  const activePointers = new Set<number>();
  const finishPointer = (pointerId: number) => {
    if (!activePointers.delete(pointerId) || activePointers.size > 0) return;
    interacting = false;
    resize(); // Restore the selected full-quality resolution after the gesture.
  };
  const cancelGesture = () => {
    down = null;
    if (!activePointers.size) return;
    activePointers.clear();
    interacting = false;
    resize();
  };
  const pointerDown = (event: PointerEvent) => {
    canvas.focus({ preventScroll: true });
    activePointers.add(event.pointerId);
    if (!interacting) {
      interacting = true;
      resize(); // Reduce fragment work immediately, including on touch devices.
    }
    down = activePointers.size === 1
      ? { x: event.clientX, y: event.clientY } : null;
  };
  const pointerUp = (event: PointerEvent) => {
    finishPointer(event.pointerId);
    if (activePointers.size || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) { down = null; return; }
    down = null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    point.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height * 2 - 1));
    raycaster.setFromCamera(point, camera);
    const pickables = [...objects.entries()].filter(([id]) => settings.get(id)?.visible).map(([,group]) => group);
    const hit = raycaster.intersectObjects(pickables, true).find(item => item.object instanceof THREE.Mesh && !item.object.userData.bodyvisionMeshOverlay);
    if (!hit) { clearSelection(); return; }
    let layer: AnatomicalLayer | null = null;
    for (const [id, group] of objects) {
      if (group === hit.object || group.getObjectById(hit.object.id)) { layer = id; break; }
    }
    if (layer) showSelection(hit.object as THREE.Mesh, layer);
  };
  const pointerCancel = (event: PointerEvent) => {
    down = null;
    finishPointer(event.pointerId);
  };
  const pointerWindowUp = (event: PointerEvent) => {
    // OrbitControls may release capture outside the original canvas.
    if (activePointers.has(event.pointerId)) pointerCancel(event);
  };
  const gestureVisibilityChange = () => {
    if (document.hidden) cancelGesture();
  };
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerCancel);
  window.addEventListener("pointerup", pointerWindowUp);
  window.addEventListener("pointercancel", pointerWindowUp);
  window.addEventListener("blur", cancelGesture);
  document.addEventListener("visibilitychange", gestureVisibilityChange);
  canvas.addEventListener("keydown", keyboard);
  controls.addEventListener("change", render);
  resize();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    if (lodTimer !== null) window.clearTimeout(lodTimer);
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", visibilityChange);
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener("webglcontextrestored", contextRestored);
    canvas.removeEventListener("pointerdown", pointerDown);
    canvas.removeEventListener("pointerup", pointerUp);
    canvas.removeEventListener("pointercancel", pointerCancel);
    window.removeEventListener("pointerup", pointerWindowUp);
    window.removeEventListener("pointercancel", pointerWindowUp);
    window.removeEventListener("blur", cancelGesture);
    document.removeEventListener("visibilitychange", gestureVisibilityChange);
    canvas.removeEventListener("keydown", keyboard);
    controls.dispose();
    restoreHighlight();
    if (dashboardHalo) releaseRoot(dashboardHalo);
    for (const group of objects.values()) releaseRoot(group);
    for (const entry of lodEntries.values()) {
      entry.high.dispose();
      entry.low?.dispose();
    }
    lodEntries.clear();
    for (const materials of assets.values()) materials.forEach(m => m.dispose());
    draco.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  const getPerformanceStats = () => {
    const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
    let meshes = 0;
    let overlays = 0;
    const retainedGeometry = new Set<THREE.BufferGeometry>();
    // Report retained (including hidden) layers independently so the largest
    // source of CPU geometry can be identified without loading more models.
    // Buffers shared across layers are counted once globally, but can appear
    // in multiple per-layer figures: those figures are not additive.
    const layerGeometry = anatomicalLayers.flatMap(({ id }) => {
      const group = objects.get(id);
      if (!group) return [];
      let layerMeshes = 0;
      const geometries = new Set<THREE.BufferGeometry>();
      group.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        geometries.add(node.geometry);
        if (node.userData.bodyvisionMeshOverlay) {
          overlays++;
          return;
        }
        layerMeshes++;
        meshes++;
        const lod = lodEntries.get(node);
        if (lod) {
          geometries.add(lod.high);
          if (lod.low) geometries.add(lod.low);
        }
      });
      for (const geometry of geometries) retainedGeometry.add(geometry);
      return [{
        layer: id,
        visible: settings.get(id)?.visible ?? false,
        meshes: layerMeshes,
        ...estimateRetainedGeometryMemory(geometries),
      }];
    });
    const geometryMemory = estimateRetainedGeometryMemory(retainedGeometry);
    const activeLods = [...lodEntries].filter(([mesh, entry]) => entry.low !== null && mesh.geometry === entry.low);
    return {
      mode: quality,
      interacting,
      lodMeshes: activeLods.length,
      lodTrianglesSaved: activeLods.reduce((total, [mesh, entry]) =>
        total + triangleCount(entry.high) - triangleCount(mesh.geometry), 0),
      pixelRatio: renderer.getPixelRatio(),
      bufferWidth: Math.round(buffer.width),
      bufferHeight: Math.round(buffer.height),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      renderPasses,
      renderedFrames,
      cpuSubmissionMs,
      ...summarizeRenderCpuSamples(cpuSubmissionSamples),
      ...summarizeRafFrameIntervals(visibleRafIntervals),
      contextAvailable: !contextUnavailable,
      geometryBuffers: renderer.info.memory.geometries,
      ...geometryMemory,
      textures: renderer.info.memory.textures,
      meshes,
      overlays,
      layerReadyMs: { ...layerReadyMs },
      layerGeometry,
    };
  };
  const retryLayer = (layer: AnatomicalLayer) => { if (settings.get(layer)?.visible) load(layer); };
  let capturingSnapshot = false;
  const capturePng = async (
    portraitForPose = false,
    comparisonDetails?: AtlasComparisonDetails,
  ): Promise<Blob> => {
    if (disposed || contextUnavailable || !canvas.isConnected) {
      throw new Error("Visor 3D no disponible");
    }
    if (comparison && !comparisonDetails) {
      throw new Error("Desactiva la comparación dividida antes de analizar una vista 3D");
    }
    if (!comparison && comparisonDetails) {
      throw new Error("Activa la comparación dividida antes de exportarla.");
    }
    if (capturingSnapshot) throw new Error("Ya se está preparando una captura 3D.");
    const bounds = host.getBoundingClientRect();
    // The preview's <=950k mobile GPU budget is unchanged. On explicit capture,
    // render the SAME avatar geometry and camera again at actual increased
    // WebGL resolution; do not interpolate a previously rasterized low-res PNG.
    const plan = planAtlasCapture(bounds.width, bounds.height, renderer.getPixelRatio());
    capturingSnapshot = true;
    try {
      renderer.setSize(bounds.width, bounds.height, false);
      renderer.setPixelRatio(plan.pixelRatio);
      camera.aspect = bounds.width / bounds.height;
      camera.updateProjectionMatrix();
      render();
      if (Math.min(canvas.width, canvas.height) < 800 ||
          canvas.width * canvas.height > 2_400_000) {
        throw new Error("La captura sintética no alcanzó la resolución requerida.");
      }
      // The 2D matte is applied only to this transient snapshot. The visual
      // WebGL canvas retains transparent backgrounds before and after capture.
      return await captureOpaqueAtlasPng(canvas, portraitForPose, comparisonDetails);
    } finally {
      capturingSnapshot = false;
      // Restore user-selected fluid/high ratio even on a failed PNG export.
      // A new screenshot never changes geometry, materials, zoom or viewpoint.
      resize();
    }
  };
  return { update, focus, clearSelection, setRenderMode, setQuality, setAutoRotate, setDashboardAnimation, setIsolated, setWeightVariation, setStature, setMeshOverlay, resetCamera, view, zoom, capturePng, getPerformanceStats, setComparison, setComparisonBaseline, retryLayer, dispose };
}
