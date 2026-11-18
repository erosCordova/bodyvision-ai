import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { shapeInfluences, type BodyShape } from "./bodyShape";

export type View = "front" | "back" | "side" | "perspective";
export type SceneState = { shape: BodyShape; wireframe: boolean; rotate: boolean; view: View };
type Manifest = { sha256: string; decoded_sha256: string; url: string; eyes: Record<string, number[]> };
export async function createBodyScene(
  host: HTMLDivElement,
  signal: AbortSignal,
  onProgress: (message: string) => void,
  onError: (message: string) => void,
) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 700 ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-label", "Cuerpo humano 3D de demostración. Usa los botones de vista o arrastra para girar.");
  canvas.setAttribute("role", "img");
  host.appendChild(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, 0.05, 30);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.95, 0);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 1.5;
  controls.maxDistance = 6;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI / 2 + 0.18;
  controls.autoRotateSpeed = 0.65;
  const group = new THREE.Group();
  scene.add(group);
  const room = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  room.dispose();
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe6f3ff, 0x182335, 1.3));
  const key = new THREE.DirectionalLight(0xffead7, 3.2);
  key.position.set(2.5, 4, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.5;
  key.shadow.camera.right = key.shadow.camera.top = 1.5;
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xa5d5ff, 2.5);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.15, 80), new THREE.MeshStandardMaterial({ color: 0x18263a, roughness: 0.88, metalness: 0.15 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.007;
  floor.receiveShadow = true;
  scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.81, 0.815, 100), new THREE.MeshBasicMaterial({ color: 0x6d8fba, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.004;
  scene.add(ring);
  const meshes: THREE.Mesh[] = [];
  const textures = new Set<THREE.Texture>();
  let disposed = false;
  let frame = 0;
  let rotating = false;
  let lastTime = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const render = () => {
    if (disposed) return;
    renderer.render(scene, camera);
  };
  const animate = (time: number) => {
    if (disposed || !rotating || document.hidden) { frame = 0; return; }
    controls.update(lastTime ? Math.min((time-lastTime)/1000, 0.05) : 1/60);
    lastTime = time;
    render();
    frame = requestAnimationFrame(animate);
  };
  const resume = () => {
    if (!rotating || document.hidden) { cancelAnimationFrame(frame); frame = 0; lastTime = 0; }
    else if (!frame) frame = requestAnimationFrame(animate);
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  const lost = (event: Event) => { event.preventDefault(); onError("El navegador perdió la conexión gráfica. Puedes volver a cargar el visor."); };
  canvas.addEventListener("webglcontextlost", lost);
  controls.addEventListener("change", render);
  document.addEventListener("visibilitychange", resume);
  const stopMotion = () => { if (reducedMotion.matches) { rotating = false; controls.autoRotate = false; resume(); } };
  reducedMotion.addEventListener("change", stopMotion);
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
    canvas.removeEventListener("webglcontextlost", lost);
    document.removeEventListener("visibilitychange", resume);
    reducedMotion.removeEventListener("change", stopMotion);
    controls.dispose();
    scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry.dispose();
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
          material.dispose();
        }
      }
    });
    textures.forEach((t) => t.dispose());
    environment.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  signal.addEventListener("abort", cleanup, { once: true });
  const apply = (state: SceneState) => {
    const { heightScale, weights } = shapeInfluences(state.shape);
    group.scale.set(1, heightScale, 1);
    meshes.forEach((mesh) => {
      if (mesh.morphTargetInfluences) weights.forEach((w, i) => { mesh.morphTargetInfluences![i] = w; });
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (material instanceof THREE.MeshStandardMaterial) material.wireframe = state.wireframe;
      }
    });
    controls.target.set(0, state.shape.height / 200, 0);
    rotating = state.rotate && !reducedMotion.matches;
    controls.autoRotate = rotating;
    resume();
    render();
  };
  const setView = (view: View) => {
    const distance = window.innerWidth < 700 ? 4.15 : 3.7;
    const angles = { front: 0, back: Math.PI, side: Math.PI/2, perspective: 0.55 };
    camera.position.set(Math.sin(angles[view])*distance, 1.16, Math.cos(angles[view])*distance);
    controls.update();
    render();
  };
  try {
    setView("perspective");
    resize();
    onProgress("Cargando el modelo corporal…");
    const metadata = await fetch("/models/bodyvision/manifest.json", { signal });
    if (!metadata.ok) throw new Error("manifest");
    const manifest: Manifest = await metadata.json();
    const response = await fetch(manifest.url, { signal });
    if (!response.ok) throw new Error("asset");
    const bytes = await response.arrayBuffer();
    // Some static hosts send .glb.gz with Content-Encoding: gzip. Browsers
    // transparently decompress that response, so avoid decompressing twice.
    const input = new Uint8Array(bytes);
    const isGzip = input.length >= 2 && input[0] === 0x1f && input[1] === 0x8b;
    const isGlb = input.length >= 4 && input[0] === 0x67 && input[1] === 0x6c && input[2] === 0x54 && input[3] === 0x46;
    if (!isGzip && !isGlb) throw new Error("asset-format");
    const hashBytes = async (data: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
      .map(v => v.toString(16).padStart(2, "0")).join("");
    let decoded: ArrayBuffer;
    if (isGzip) {
      if (await hashBytes(bytes) !== manifest.sha256) throw new Error("checksum");
      decoded = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
    } else {
      decoded = bytes;
    }
    if (await hashBytes(decoded) !== manifest.decoded_sha256) throw new Error("decoded-checksum");
    const loader = new GLTFLoader();
    const asset = await loader.parseAsync(decoded, "/models/bodyvision/");
    group.add(asset.scene);
    if (disposed || signal.aborted) {
      asset.scene.traverse((node) => { if (node instanceof THREE.Mesh) { node.geometry.dispose(); const materials = Array.isArray(node.material) ? node.material : [node.material]; materials.forEach(m => { for (const value of Object.values(m)) if (value instanceof THREE.Texture) value.dispose(); m.dispose(); }); } });
      throw new DOMException("Aborted", "AbortError");
    }
    onProgress("Preparando materiales e iluminación…");
    const normal = await new THREE.TextureLoader().loadAsync("/models/bodyvision/normal.webp");
    if (disposed || signal.aborted) { normal.dispose(); throw new DOMException("Aborted", "AbortError"); }
    textures.add(normal);
    normal.flipY = false;
    asset.scene.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        meshes.push(node);
        node.castShadow = true;
        node.receiveShadow = true;
        // Morphs can expand beyond the original bounding sphere.
        node.frustumCulled = false;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
          if (material instanceof THREE.MeshStandardMaterial && material.name === "Skin") {
            material.normalMap = normal;
            material.normalScale.set(0.45, 0.45);
            material.envMapIntensity = 0.35;
            material.needsUpdate = true;
          }
        }
      }
    });
    for (const center of Object.values(manifest.eyes)) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 24, 16), new THREE.MeshStandardMaterial({ color: 0xe5e0d8, roughness: 0.28 }));
      eye.position.fromArray(center);
      group.add(eye);
      const iris = new THREE.Mesh(new THREE.SphereGeometry(0.0053, 24, 16), new THREE.MeshStandardMaterial({ color: 0x493424, roughness: 0.38 }));
      iris.scale.set(1, 1, 0.2);
      iris.position.set(center[0], center[1], center[2]+0.0102);
      group.add(iris);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.0024, 16, 12), new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.12 }));
      pupil.scale.set(1, 1, 0.15);
      pupil.position.set(center[0], center[1], center[2]+0.0112);
      group.add(pupil);
    }
    if (signal.aborted) { normal.dispose(); throw new DOMException("Aborted", "AbortError"); }
    render();
    return { apply, setView, cleanup, info: { triangles: renderer.info.render.triangles, loadEnd: performance.now() } };
  } catch (error) {
    cleanup();
    throw error;
  }
}
