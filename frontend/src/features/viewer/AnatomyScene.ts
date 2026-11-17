import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

export const anatomicalLayers = [
  { id: "skeleton", label: "Esqueleto", detail: "Estructura ósea" },
  { id: "muscles", label: "Músculos", detail: "Músculos superficiales y profundos" },
  { id: "arteries", label: "Arterias", detail: "Sistema arterial" },
  { id: "veins", label: "Venas", detail: "Sistema venoso" },
  { id: "nerves", label: "Nervios", detail: "Sistema nervioso periférico" },
  { id: "skin", label: "Piel", detail: "Superficie corporal" },
] as const;

export type AnatomicalLayer = (typeof anatomicalLayers)[number]["id"];
export type LayerOpacity = Record<AnatomicalLayer, number>;

/**
 * Z-Anatomy / BodyParts3D derivatives exported by SeemaBansal1.
 * Model data is subject to CC BY-SA and upstream component licences.
 * Do not remove attribution and do not use this educational atlas for diagnosis.
 * Organs are deliberately excluded because the source includes a CC BY-NC kidney.
 */
const source = "https://raw.githubusercontent.com/SeemaBansal1/3d-human-body-anatomy/main/web/public/models/";

export function createAnatomyScene(
  host: HTMLDivElement,
  onStatus: (message: string) => void,
  onSelected: (name: string | null) => void,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.25 : 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const canvas = renderer.domElement;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Atlas anatómico tridimensional: arrastra para girar, pulsa una estructura para identificarla");
  host.append(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 100);
  camera.position.set(2.6, 1.4, 3.4);
  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = true;
  controls.enableDamping = false;
  controls.minDistance = 0.35;
  controls.maxDistance = 9;
  controls.target.set(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x28364b, 2));
  const key = new THREE.DirectionalLight(0xfff0e1, 2.5);
  key.position.set(3, 5, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa7d0ff, 1.2);
  rim.position.set(-2, 2, -3);
  scene.add(rim);

  const world = new THREE.Group();
  const layersRoot = new THREE.Group();
  scene.add(world);
  world.add(layersRoot);
  const loaded = new Map<AnatomicalLayer, THREE.Group>();
  const loading = new Set<AnatomicalLayer>();
  const desired = new Map<AnatomicalLayer, { visible: boolean; opacity: number }>();
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  let disposed = false;
  let fitted = false;

  const render = () => { if (!disposed) renderer.render(scene, camera); };
  const resize = () => {
    if (disposed) return;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  controls.addEventListener("change", render);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const click = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const active = [...loaded.values()].filter(layer => layer.visible);
    const hit = raycaster.intersectObjects(active, true)[0];
    onSelected(hit?.object.name || null);
  };
  canvas.addEventListener("click", click);

  const setAppearance = (id: AnatomicalLayer) => {
    const group = loaded.get(id);
    if (!group) return;
    const state = desired.get(id) ?? { visible: false, opacity: 1 };
    group.visible = state.visible;
    group.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.opacity = state.opacity;
          material.transparent = state.opacity < 1;
          material.depthWrite = state.opacity >= 1;
          material.needsUpdate = true;
        }
      }
    });
    render();
  };

  const fit = () => {
    const box = new THREE.Box3().setFromObject(layersRoot);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const longest = Math.max(size.x, size.y, size.z, 0.01);
    layersRoot.position.set(-center.x, -center.y, -center.z);
    world.scale.setScalar(2.3 / longest);
    controls.target.set(0, 0, 0);
    camera.position.set(2.6, 1.1, 3.3);
    controls.update();
    fitted = true;
    render();
  };

  const load = (id: AnatomicalLayer) => {
    if (disposed || loading.has(id) || loaded.has(id)) return;
    loading.add(id);
    onStatus("Cargando " + anatomicalLayers.find(layer => layer.id === id)?.label.toLowerCase() + "…");
    loader.load(
      source + id + ".glb",
      gltf => {
        loading.delete(id);
        if (disposed) return;
        const group = gltf.scene;
        group.traverse(node => {
          if (!(node instanceof THREE.Mesh)) return;
          node.frustumCulled = false;
          node.material = Array.isArray(node.material)
            ? node.material.map(material => material.clone())
            : node.material.clone();
        });
        loaded.set(id, group);
        layersRoot.add(group);
        if (!fitted) fit();
        setAppearance(id);
        onStatus("Capas anatómicas listas para explorar");
      },
      undefined,
      () => {
        loading.delete(id);
        if (!disposed) onStatus("No se pudo cargar " + id + ". Verifica tu conexión e inténtalo de nuevo.");
      },
    );
  };

  const update = (visible: ReadonlySet<AnatomicalLayer>, opacity: LayerOpacity) => {
    for (const layer of anatomicalLayers) {
      const id = layer.id;
      desired.set(id, { visible: visible.has(id), opacity: Math.max(0.1, Math.min(1, opacity[id])) });
      if (visible.has(id) && !loaded.has(id)) load(id);
      setAppearance(id);
    }
  };
  const resetCamera = () => {
    camera.position.set(2.6, 1.1, 3.3);
    controls.target.set(0, 0, 0);
    controls.update();
    render();
  };
  resize();
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    canvas.removeEventListener("click", click);
    controls.dispose();
    for (const group of loaded.values()) {
      group.traverse(node => {
        if (!(node instanceof THREE.Mesh)) return;
        node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
      });
    }
    draco.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  return { update, resetCamera, dispose };
}
