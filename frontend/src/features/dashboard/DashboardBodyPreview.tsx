import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { anatomyDisplayName, anatomyMeshName } from "../viewer/anatomyNames";
import { bodyVisualScenario, DEFAULT_REFERENCE_KG } from "../viewer/bodyVolume";
import { BASELINE_HEIGHT_CM, heightScale } from "../viewer/bodyStature";

const MODEL_URLS = {
  male: "/models/anatomy-male.glb",
  female: "/models/anatomy-female.glb",
} as const;

const SYSTEMS = [
  { id: "skin", label: "Piel", color: "#6de7ff" },
  { id: "muscles", label: "Músculos", color: "#ef6676" },
  { id: "skeleton", label: "Esqueleto", color: "#d6e6f6" },
  { id: "organs", label: "Órganos", color: "#ff9278" },
  { id: "vessels", label: "Vasos", color: "#6aaeff" },
  { id: "nerves", label: "Nervios", color: "#f6d277" },
] as const;

type AnatomySystem = (typeof SYSTEMS)[number]["id"];
type ModelSex = keyof typeof MODEL_URLS;
type SystemVisibility = Record<AnatomySystem, boolean>;
type Anthropometry = { bodyWeightKg?: number; statureCm?: number; sex?: string | null };
type PreviewController = {
  setAnthropometry: (weightKg?: number, statureCm?: number) => void;
  setSystems: (visibility: SystemVisibility) => void;
  setAutoRotate: (enabled: boolean) => void;
};

const initialVisibility: SystemVisibility = {
  skin: true, muscles: false, skeleton: false, organs: false, vessels: false, nerves: false,
};

function modelSexFromProfile(value?: string | null): ModelSex {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "f" || normalized.startsWith("female")
    || normalized.startsWith("fem") || normalized === "mujer"
    ? "female" : "male";
}

function materialForSystem(system: AnatomySystem): THREE.Material {
  if (system === "skin") {
    return new THREE.MeshBasicMaterial({
      color: "#63e4ff", wireframe: true, transparent: true, opacity: 0.72,
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    });
  }
  const color = SYSTEMS.find(item => item.id === system)?.color ?? "#8ddff4";
  return new THREE.MeshPhysicalMaterial({
    color, emissive: color, emissiveIntensity: 0.12,
    metalness: 0.12, roughness: 0.5, transparent: true, opacity: 0.82,
    depthWrite: false, side: THREE.DoubleSide,
  });
}

function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
      }
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

export function DashboardBodyPreview({ bodyWeightKg, statureCm, sex }: Anthropometry) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<PreviewController | null>(null);
  const systemsRef = useRef<SystemVisibility>(initialVisibility);
  const [visibleSystems, setVisibleSystems] = useState<SystemVisibility>(initialVisibility);
  const [selectedStructure, setSelectedStructure] = useState("");
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const anthropometryRef = useRef({ bodyWeightKg, statureCm });
  const modelSex = modelSexFromProfile(sex);

  useEffect(() => {
    systemsRef.current = visibleSystems;
    controller.current?.setSystems(visibleSystems);
  }, [visibleSystems]);

  useEffect(() => {
    anthropometryRef.current = { bodyWeightKg, statureCm };
    controller.current?.setAnthropometry(bodyWeightKg, statureCm);
  }, [bodyWeightKg, statureCm]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    controller.current?.setAutoRotate(ready && playing && !reducedMotion);
  }, [ready, playing, reducedMotion]);

  useEffect(() => {
    let disposed = false;
    let frame = 0;
    let modelRoot: THREE.Group | null = null;
    let modelBounds: THREE.Box3 | null = null;
    let modelCenter: THREE.Vector3 | null = null;
    let modelBaseScale = 1;
    const systemRoots = new Map<AnatomySystem, THREE.Object3D>();
    const materials = new Map<AnatomySystem, THREE.Material>();
    const hostElement = host.current;
    setReady(false);
    setError(false);
    setSelectedStructure("");
    if (!hostElement) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true, antialias: true, powerPreference: "low-power",
      });
    } catch {
      setError(true);
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    hostElement.replaceChildren(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x9ec9e8, 1.1));
    const keyLight = new THREE.DirectionalLight(0xc8f3ff, 1.8);
    keyLight.position.set(-2.5, 3.2, 4);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(0x24c9f3, 1.2, 7);
    rimLight.position.set(1.7, 1.3, -1.8);
    scene.add(rimLight);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
    camera.position.set(0, 0.95, 3.15);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2.05;
    controls.maxDistance = 5.2;
    controls.target.set(0, 0.91, 0);
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.26;

    const resize = () => {
      const width = Math.max(1, hostElement.clientWidth);
      const height = Math.max(1, hostElement.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(hostElement);
    resize();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onClick = (event: MouseEvent) => {
      if (!modelRoot) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObject(modelRoot, true).find(item => {
        const system = item.object.userData.openAnatomySystem as AnatomySystem | undefined;
        return system !== undefined && systemsRef.current[system];
      });
      if (hit) setSelectedStructure(anatomyDisplayName(anatomyMeshName(hit.object)));
    };
    renderer.domElement.addEventListener("click", onClick);

    const applyAnthropometry = (weightKg?: number, heightCm?: number) => {
      if (!modelRoot || !modelBounds || !modelCenter) return;
      const heightFactor = heightScale(heightCm ?? BASELINE_HEIGHT_CM);
      const weightFactor = 1 + bodyVisualScenario(weightKg ?? DEFAULT_REFERENCE_KG, 0).referenceRadialVariation;
      const scaleXz = modelBaseScale * weightFactor;
      const scaleY = modelBaseScale * heightFactor;
      modelRoot.scale.set(scaleXz, scaleY, scaleXz);
      modelRoot.position.set(
        -modelCenter.x * scaleXz,
        -modelBounds.min.y * scaleY,
        -modelCenter.z * scaleXz,
      );
      const focusY = 0.9 * heightFactor;
      controls.target.set(0, focusY, 0);
      camera.position.set(0, focusY + 0.07, 3.15 * Math.max(heightFactor, weightFactor));
      camera.lookAt(controls.target);
      controls.update();
      renderer.render(scene, camera);
    };
    const applySystems = (visibility: SystemVisibility) => {
      systemsRef.current = visibility;
      for (const [id, group] of systemRoots) group.visible = visibility[id];
      renderer.render(scene, camera);
    };
    controller.current = {
      setAnthropometry: applyAnthropometry,
      setSystems: applySystems,
      setAutoRotate: enabled => { controls.autoRotate = enabled; },
    };

    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager);
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.load(MODEL_URLS[modelSex], gltf => {
      if (disposed) {
        disposeModel(gltf.scene);
        return;
      }
      modelRoot = gltf.scene;
      modelRoot.updateMatrixWorld(true);
      modelBounds = new THREE.Box3().setFromObject(modelRoot);
      const size = modelBounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y < 0.05) {
        setError(true);
        return;
      }
      modelCenter = modelBounds.getCenter(new THREE.Vector3());
      modelBaseScale = 1.75 / size.y;

      modelRoot.traverse(object => {
        const match = SYSTEMS.find(system => object.name.trim().toLowerCase() === system.id);
        if (match && !systemRoots.has(match.id)) systemRoots.set(match.id, object);
      });
      if (!systemRoots.has("skin")) {
        setError(true);
        return;
      }

      const originalMaterials = new Set<THREE.Material>();
      for (const system of SYSTEMS) {
        const group = systemRoots.get(system.id);
        if (!group) continue;
        group.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            originalMaterials.add(material);
          }
          let material = materials.get(system.id);
          if (!material) {
            material = materialForSystem(system.id);
            materials.set(system.id, material);
          }
          object.material = material;
          object.userData.openAnatomySystem = system.id;
          object.renderOrder = system.id === "skin" ? 8 : 3;
        });
        group.visible = systemsRef.current[system.id];
      }
      originalMaterials.forEach(material => material.dispose());
      const currentAnthropometry = anthropometryRef.current;
      scene.add(modelRoot);
      applyAnthropometry(currentAnthropometry.bodyWeightKg, currentAnthropometry.statureCm);
      controls.target.set(0, 0.9 * heightScale(currentAnthropometry.statureCm ?? BASELINE_HEIGHT_CM), 0);
      controls.update();
      renderer.render(scene, camera);
      setReady(true);
    }, undefined, () => {
      if (!disposed) setError(true);
    });

    const animate = () => {
      if (disposed) return;
      frame = window.requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    frame = window.requestAnimationFrame(animate);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      controller.current = null;
      materials.forEach(material => material.dispose());
      if (modelRoot) disposeModel(modelRoot);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [attempt, modelSex]);

  return <div className="enterprise-realbody-preview product-atlas dashboard-hologram"
    data-loaded={ready && !error} data-model="anatomy-atlas" data-source="MervinR07/open-anatomy-3d"
    data-sex={modelSex}
    data-animation={ready && playing && !reducedMotion ? "running" : "paused"}>
    <div ref={host} className="enterprise-realbody-canvas" role="group" aria-label="Visor anatómico 3D interactivo" />
    <div className="atlas-layer-controls" style={{ left: 64, right: 58 }} aria-label="Sistemas anatómicos">
      {SYSTEMS.map(system => <button key={system.id} type="button"
        aria-pressed={visibleSystems[system.id]}
        onClick={() => setVisibleSystems(current => ({ ...current, [system.id]: !current[system.id] }))}>
        {system.label}
      </button>)}
    </div>
    {selectedStructure && <div className="enterprise-realbody-tag" aria-live="polite">{selectedStructure}</div>}
    {ready && !error && !reducedMotion && <button type="button" className="dashboard-animation-toggle"
      onClick={() => setPlaying(value => !value)}
      aria-label={playing ? "Pausar rotación del modelo" : "Reanudar rotación del modelo"}>
      {playing ? "Ⅱ" : "▷"}
    </button>}
    {(!ready || error) && <div className="enterprise-realbody-status" role={error ? "alert" : "status"}>
      <strong>{error ? "Modelo Anatomy no disponible" : "Cargando Anatomy 3D…"}</strong>
      {error && <span>Comprueba la conexión e inténtalo de nuevo.</span>}
      {error && <button type="button" onClick={() => setAttempt(value => value + 1)}>Reintentar</button>}
    </div>}
    <div className="atlas-credit">
      BodyParts3D © DBCLS · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>
      {" · "}Adaptación visual BODYVISION · <a href="https://github.com/MervinR07/open-anatomy-3d" target="_blank" rel="noreferrer">Open Anatomy 3D</a>
    </div>
  </div>;
}