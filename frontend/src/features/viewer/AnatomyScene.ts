import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import dracoWrapperUrl from "three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js?url";
import dracoWasmUrl from "three/examples/jsm/libs/draco/gltf/draco_decoder.wasm?url";
import { anatomySource } from "./atlasSource";
import { bodyVolumeScenario, DEFAULT_REFERENCE_KG } from "./bodyVolume";
import { heightScale } from "./bodyStature";
import { atlasPixelRatio } from "./renderBudget";
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

/** GPU morph for illustrative soft-tissue volume changes, not calibrated to kg. */
const BODYVOLUME_VERTEX = `
  vec3 bvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float bvHeight = clamp((bvWorld.y - uBVBounds.x) / max(uBVBounds.y - uBVBounds.x, 0.00001), 0.0, 1.0);
  float bvTorso = smoothstep(0.31, 0.46, bvHeight) * (1.0 - smoothstep(0.70, 0.83, bvHeight));
  float bvHip = smoothstep(0.23, 0.33, bvHeight) * (1.0 - smoothstep(0.45, 0.56, bvHeight));
  float bvLeg = smoothstep(0.10, 0.18, bvHeight) * (1.0 - smoothstep(0.37, 0.49, bvHeight));
  float bvZone = clamp(max(bvTorso, max(bvHip * 0.85, bvLeg * 0.30)), 0.0, 1.0);
  // Fade over the arms: they should not move outwards with the abdominal volume.
  float bvArmFade = 1.0 - smoothstep(0.34, 0.57, abs(bvWorld.x - uBVBounds.z));
  float bvAmount = uBVVolume * uBVStrength * bvZone * bvArmFade;
  vec3 bvOffset = vec3(
    (bvWorld.x - uBVBounds.z) * bvAmount * 1.06, 0.0,
    (bvWorld.z - uBVBounds.w) * bvAmount * 1.12
  );
  vec3 bvAxisX = modelMatrix[0].xyz;
  vec3 bvAxisY = modelMatrix[1].xyz;
  vec3 bvAxisZ = modelMatrix[2].xyz;
  transformed += vec3(
    dot(bvOffset, bvAxisX) / max(dot(bvAxisX, bvAxisX), 0.00001),
    dot(bvOffset, bvAxisY) / max(dot(bvAxisY, bvAxisY), 0.00001),
    dot(bvOffset, bvAxisZ) / max(dot(bvAxisZ, bvAxisZ), 0.00001)
  );
`;
function attachBodyVolume(
  material: THREE.Material, layer: AnatomicalLayer,
  volume: { value: number }, bounds: { value: THREE.Vector4 },
) {
  const strength = layer === "skin" ? 1 : layer === "muscles" ? 0.18 : 0;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBVVolume = volume;
    shader.uniforms.uBVBounds = bounds;
    shader.uniforms.uBVStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uBVVolume;\nuniform vec4 uBVBounds;\nuniform float uBVStrength;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\n" + BODYVOLUME_VERTEX);
  };
  material.customProgramCacheKey = () => "bodyvision-volume-1-strength-" + strength;
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
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Cuerpo humano anatómico 3D. Arrastra para rotar; pulsa una estructura para seleccionarla.");
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
  const settings = new Map<AnatomicalLayer, { visible: boolean; opacity: number }>();
  const assets = new Map<AnatomicalLayer, Set<THREE.Material>>();
  const meshOverlays = new Map<AnatomicalLayer, THREE.MeshBasicMaterial>();
  const volume = { value: 0 };
  const massBounds = { value: new THREE.Vector4(0, 2.5, 0, 0) };
  let showWireMesh = false;
  let statureCm = 175;
  let mode: RenderMode = "realista";
  let quality: SceneQuality = "alta";
  let disposed = false;
  let fitted = false;
  let autoRotate = false;
  let isolated = false;
  let selectedMesh: THREE.Mesh | null = null;
  let selectedLayer: AnatomicalLayer | null = null;
  let previousMaterials: THREE.Material | THREE.Material[] | null = null;
  let pendingFocus: SelectedStructure | null = null;
  let raf = 0;

  const render = () => { if (!disposed) renderer.render(scene, camera); };
  const resize = () => {
    if (disposed) return;
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = atlasPixelRatio(bounds.width, bounds.height, window.devicePixelRatio || 1, quality);
    if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
    renderer.setSize(bounds.width, bounds.height, false);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
    render();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);

  const tick = () => {
    raf = 0;
    if (disposed || !autoRotate || document.hidden) return;
    // OrbitControls emits "change" and renders through its registered listener.
    // A second synchronous render per animation frame would double GPU work.
    controls.update();
    raf = requestAnimationFrame(tick);
  };
  const updateAnimation = () => {
    cancelAnimationFrame(raf);
    raf = 0;
    if (autoRotate && !document.hidden && !disposed) raf = requestAnimationFrame(tick);
  };
  const setAutoRotate = (enabled: boolean) => {
    autoRotate = enabled && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 0.9;
    updateAnimation();
  };
  const visibilityChange = () => updateAnimation();
  document.addEventListener("visibilitychange", visibilityChange);
  const contextLost = (event: Event) => { event.preventDefault(); onError("El navegador perdió la conexión gráfica. Recarga el visor para volver a abrir el modelo."); };
  canvas.addEventListener("webglcontextlost", contextLost);

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
        material.wireframe = mode === "holograma";
        material.opacity = mode === "radiografia" ? Math.min(s.opacity, 0.26) : mode === "holograma" ? Math.min(s.opacity, 0.83) : s.opacity;
        material.transparent = material.opacity < 1;
        material.depthWrite = material.opacity >= 1;
        material.needsUpdate = true;
      }
    });
    const wire = meshOverlays.get(layer);
    if (wire) wire.opacity = Math.min(0.46, Math.max(0.12, s.opacity * 0.42));
    render();
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
    render();
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
    controls.update();
    render();
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
        assets.set(layer, new Set([...cached.values(), wireMaterial]));
        objects.set(layer, group);
        anatomical.add(group);
        if (showWireMesh) ensureWireOverlays(layer, group);
        if (!fitted) frameBody();
        applyLayer(layer);
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
  };
  const setRenderMode = (next: RenderMode) => { mode = next; applyAll(); };
  const setWeightVariation = (percent: number) => {
    volume.value = bodyVolumeScenario(DEFAULT_REFERENCE_KG, percent).radialVariation;
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
  const setQuality = (next: SceneQuality) => { quality = next; resize(); };
  const setIsolated = (enabled: boolean) => { isolated = enabled && !!selectedMesh; applyAll(); };
  const resetCamera = () => {
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const distance = Math.min(controls.maxDistance, Math.max(
      2.5 / (2 * Math.tan(halfFov) * 0.68),
      1.2 / (2 * Math.tan(halfFov) * Math.max(camera.aspect, 0.2) * 0.82),
    ));
    controls.target.set(0, 0, 0);
    camera.position.set(0.35, 0.08, 1).normalize().multiplyScalar(distance);
    controls.update();
    render();
  };
  const view = (type: "front" | "back" | "left" | "right") => {
    const dist = camera.position.distanceTo(controls.target);
    const angle = type === "front" ? 0 : type === "back" ? Math.PI : type === "left" ? -Math.PI / 2 : Math.PI / 2;
    camera.position.set(
      controls.target.x + Math.sin(angle) * dist,
      controls.target.y + 0.04 * dist,
      controls.target.z + Math.cos(angle) * dist,
    );
    controls.update();
    render();
  };
  const zoom = (factor: number) => {
    const displacement = new THREE.Vector3().subVectors(camera.position, controls.target);
    displacement.multiplyScalar(factor);
    displacement.clampLength(controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(displacement);
    controls.update();
    render();
  };
  const clearSelection = () => showSelection(null, null);

  const raycaster = new THREE.Raycaster();
  const point = new THREE.Vector2();
  let down: { x: number; y: number } | null = null;
  const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
  const pointerUp = (event: PointerEvent) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) { down = null; return; }
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
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointerup", pointerUp);
  controls.addEventListener("change", render);
  resize();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", visibilityChange);
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener("pointerdown", pointerDown);
    canvas.removeEventListener("pointerup", pointerUp);
    controls.dispose();
    restoreHighlight();
    for (const group of objects.values()) releaseRoot(group);
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
    for (const group of objects.values()) group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      if (node.userData.bodyvisionMeshOverlay) overlays++;
      else meshes++;
    });
    return {
      mode: quality,
      pixelRatio: renderer.getPixelRatio(),
      bufferWidth: Math.round(buffer.width),
      bufferHeight: Math.round(buffer.height),
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      meshes,
      overlays,
    };
  };
  const retryLayer = (layer: AnatomicalLayer) => { if (settings.get(layer)?.visible) load(layer); };
  const capturePng = async (): Promise<Blob> => {
    if (disposed || !canvas.isConnected) throw new Error("Visor 3D no disponible");
    // Capture immediately after a fresh render. This preserves the existing
    // single scene, camera, mesh and shader without enabling a costly persistent
    // WebGL drawing buffer or introducing another character.
    render();
    return new Promise<Blob>((resolve, reject) => {
      try {
        canvas.toBlob(blob => {
          if (blob && blob.size > 0) resolve(blob);
          else reject(new Error("No se pudo generar la captura 3D"));
        }, "image/png");
      } catch {
        reject(new Error("El navegador bloqueó la captura de esta vista"));
      }
    });
  };
  return { update, focus, clearSelection, setRenderMode, setQuality, setAutoRotate, setIsolated, setWeightVariation, setStature, setMeshOverlay, resetCamera, view, zoom, capturePng, getPerformanceStats, retryLayer, dispose };
}
