import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import type { Sex } from "./assets";
import * as M from "./materials";

export type Mode = "skin" | "muscle" | "skeleton" | "xray" | "thermal" | "holo";
export const ReadyContext = createContext<(() => void) | null>(null);
export const TONES: Record<string, string> = {
  claro: "#e2b79c", medio: "#c68a64", trigueño: "#a96f4c", oscuro: "#6f4630",
};

export interface BodyModelProps {
  sex: Sex;
  fat?: number;
  mus?: number;
  mode?: Mode;
  tone?: keyof typeof TONES | string;
  garments?: boolean;
  position?: [number, number, number];
  rotationY?: number;
  highlight?: boolean;
}

// Open Anatomy 3D / BodyParts3D (CC BY 4.0). Same pinned atlas as BodyVision's current viewer.
// The build prepares the original GLBs; no synthetic fallback geometry is used.
const URLS: Record<Sex, string> = {
  male: import.meta.env.BASE_URL + "models/anatomy-male.glb",
  female: import.meta.env.BASE_URL + "models/anatomy-female.glb",
};
type Layer = "skin" | "muscles" | "skeleton";
type AtlasPart = { layer: Layer; geometry: THREE.BufferGeometry; key: string };
function atlasParts(root: THREE.Object3D, sex: Sex): AtlasPart[] {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  const height = bounds.getSize(new THREE.Vector3()).y;
  if (!Number.isFinite(height) || height <= 0) throw new Error("Atlas anatómico sin dimensiones válidas");
  const scale = (sex === "female" ? 1.75 * 0.935 : 1.75) / height;
  const normalization = new THREE.Matrix4().makeScale(scale, scale, scale)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const parts: AtlasPart[] = [];
  root.traverse(group => {
    const layer = group.name.trim().toLowerCase();
    if (layer !== "skin" && layer !== "muscles" && layer !== "skeleton") return;
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry.clone().applyMatrix4(
        normalization.clone().multiply(object.matrixWorld),
      );
      if (layer === "skin") {
        const p = geometry.getAttribute("position");
        const heat = new Float32Array(p.count);
        for (let i = 0; i < p.count; i++) {
          // Illustrative color ramp only; not a thermal measurement or clinical estimate.
          const y = p.getY(i) / (sex === "female" ? 0.935 : 1);
          const x = p.getX(i);
          heat[i] = THREE.MathUtils.clamp(0.23 + 0.65 * Math.exp(-((y - 1.24) ** 2 / 0.19 + x ** 2 / 0.07)), 0, 1);
        }
        geometry.setAttribute("aHeat", new THREE.BufferAttribute(heat, 1));
      }
      parts.push({ layer, geometry, key: object.uuid });
    });
  });
  if (!parts.some(p => p.layer === "skin")) throw new Error("Atlas sin capa de piel");
  return parts;
}

export function BodyModel({
  sex, fat = 0, mus = 0, mode = "skin", tone = "medio", garments = true,
  position = [0, 0, 0], rotationY = 0,
}: BodyModelProps) {
  const { scene } = useGLTF(URLS[sex], true);
  const parts = useMemo(() => atlasParts(scene, sex), [scene, sex]);
  const ready = useContext(ReadyContext);
  const group = useRef<THREE.Group>(null);
  const sc = sex === "female" ? 0.935 : 1;
  const skin = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: TONES[tone] || tone, roughness: 0.72, metalness: 0.02,
  }), [tone]);
  const materials = useMemo(() => ({
    muscle: new THREE.MeshPhysicalMaterial({color: "#a84b47", roughness: 0.65}),
    skeleton: new THREE.MeshPhysicalMaterial({color: "#e2dfcd", roughness: 0.65}),
    holo: new THREE.MeshBasicMaterial({color: "#63e4ff", wireframe: true, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide}),
    xray: new THREE.MeshBasicMaterial({color: "#63e4ff", wireframe: true, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide}),
    thermal: M.thermalMaterial(),
    bottom: M.garmentMaterial(sex === "male" ? "shorts" : "bikini", sc, "#12161d"),
    bra: M.garmentMaterial("bra", sc, "#12161d"),
  }), [sex, sc]);
  useEffect(() => { ready?.(); }, [ready, parts]);
  useEffect(() => () => parts.forEach(p => p.geometry.dispose()), [parts]);
  useEffect(() => () => skin.dispose(), [skin]);
  useEffect(() => () => Object.values(materials).forEach(m => m.dispose()), [materials]);
  useFrame((state, dt) => {
    materials.thermal.uniforms.uTime.value = state.clock.elapsedTime;
    if (group.current) {
      // Atlas has no patient-specific morph targets. Smooth radial change is illustrative.
      const radial = THREE.MathUtils.clamp(1 + fat * 0.006 + mus * 0.003, 0.8, 1.25);
      const k = 1 - Math.exp(-dt * 4.5);
      group.current.scale.x = THREE.MathUtils.lerp(group.current.scale.x, radial, k);
      group.current.scale.z = THREE.MathUtils.lerp(group.current.scale.z, radial, k);
    }
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <group ref={group}>
        {parts.map(part => {
          const layer = part.layer;
          if (layer === "muscles" && mode !== "muscle") return null;
          if (layer === "skeleton" && mode !== "skeleton" && mode !== "xray") return null;
          if (layer === "skin" && (mode === "skeleton" || mode === "muscle")) return null;
          const material = layer === "muscles" ? materials.muscle : layer === "skeleton" ? materials.skeleton
            : mode === "holo" ? materials.holo : mode === "xray" ? materials.xray : mode === "thermal" ? materials.thermal : skin;
          const wire = layer === "skin" && (mode === "holo" || mode === "xray");
          return <group key={part.key}>
            <mesh geometry={part.geometry} material={material} castShadow={!wire} receiveShadow={!wire} renderOrder={wire ? 8 : 0} />
            {layer === "skin" && mode === "skin" && garments && <>
              <mesh geometry={part.geometry} material={materials.bottom} castShadow receiveShadow />
              {sex === "female" && <mesh geometry={part.geometry} material={materials.bra} castShadow receiveShadow />}
            </>}
          </group>;
        })}
      </group>
    </group>
  );
}
