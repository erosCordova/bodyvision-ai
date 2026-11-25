import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { applyDisp, cloneBody, loadAssets, settleNormals, type Assets, type Sex } from "./assets";
import * as M from "./materials";

export type Mode = "skin" | "muscle" | "skeleton" | "xray" | "thermal" | "holo";

export const ReadyContext = createContext<(() => void) | null>(null);

export const TONES: Record<string, string> = {
  claro: "#e2b79c",
  medio: "#c68a64",
  trigueño: "#a96f4c",
  oscuro: "#6f4630",
};

const EYE = { x: 0.0325, y: 1.697, z: 0.0825, r: 0.0125 };

export interface BodyModelProps {
  sex: Sex;
  fat?: number; // puntos porcentuales de grasa respecto a la línea base
  mus?: number; // puntos de masa muscular respecto a la línea base
  mode?: Mode;
  tone?: keyof typeof TONES | string;
  garments?: boolean;
  position?: [number, number, number];
  rotationY?: number;
  highlight?: boolean;
}

function useAssets(sex: Sex) {
  const [a, setA] = useState<Assets | null>(null);
  useEffect(() => {
    let alive = true;
    setA(null);
    loadAssets(sex).then((r) => alive && setA(r));
    return () => {
      alive = false;
    };
  }, [sex]);
  return a;
}

function Eye({ side, sc, iris }: { side: 1 | -1; sc: number; iris: THREE.Texture }) {
  const r = EYE.r * sc;
  const cap = useMemo(() => {
    const rad = r * 0.52;
    const geo = new THREE.CircleGeometry(rad, 48, 0, Math.PI * 2);
    geo.setAttribute("position", geo.attributes.position);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      p.setZ(i, Math.sqrt(Math.max(r * r * 1.01 - x * x - y * y, 0)));
    }
    geo.computeVertexNormals();
    return geo;
  }, [r]);
  return (
    <group position={[side * EYE.x * sc, EYE.y * sc, EYE.z * sc]} rotation={[0, side * 0.04, 0]}>
      <mesh>
        <sphereGeometry args={[r, 40, 28]} />
        <meshPhysicalMaterial color="#f1ebe6" roughness={0.3} clearcoat={1} clearcoatRoughness={0.05} />
      </mesh>
      <mesh geometry={cap}>
        <meshPhysicalMaterial map={iris} roughness={0.3} clearcoat={1} clearcoatRoughness={0.03} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh scale={1.012}>
        <sphereGeometry args={[r * 1.0, 40, 28]} />
        <meshPhysicalMaterial transparent opacity={0.1} roughness={0} metalness={0} envMapIntensity={3} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function BodyModel({
  sex,
  fat = 0,
  mus = 0,
  mode = "skin",
  tone = "medio",
  garments = true,
  position = [0, 0, 0],
  rotationY = 0,
}: BodyModelProps) {
  const assets = useAssets(sex);
  const ready = useContext(ReadyContext);
  const geo = useMemo(() => (assets ? cloneBody(assets) : null), [assets]);
  const cur = useRef({ fat: 0, mus: 0, settled: true, frame: 0 });
  const target = useRef({ fat, mus });
  target.current = { fat, mus };

  const toneHex = TONES[tone as string] || (tone as string);
  const skin = useMemo(() => M.skinMaterial(toneHex), [toneHex]);
  const skinHead = useMemo(() => M.skinMaterial(toneHex, true), [toneHex]);
  const muscle = useMemo(() => M.muscleMaterial(), []);
  const muscleHead = useMemo(() => M.muscleMaterial(true), []);
  const bone = useMemo(() => M.boneMaterial(), []);
  const thermal = useMemo(() => M.thermalMaterial(), []);
  const holo = useMemo(() => M.holoMaterial(1), []);
  const xray = useMemo(() => M.holoMaterial(0.5), []);
  const hair = useMemo(() => M.hairMaterial(sex === "male" ? "#1d1511" : "#2b1a12"), [sex]);
  const sc = sex === "female" ? 0.935 : 1;
  const bottom = useMemo(() => M.garmentMaterial(sex === "male" ? "shorts" : "bikini", sc, sex === "male" ? "#0e1217" : "#12161d"), [sex, sc]);
  const bra = useMemo(() => M.garmentMaterial("bra", sc, "#12161d"), [sc]);
  const iris = useMemo(() => M.irisTexture(sex === "male" ? "#6b4524" : "#5f6f3a"), [sex]);

  useEffect(() => {
    if (assets && geo) {
      applyDisp(geo, assets, cur.current.fat, cur.current.mus);
      ready?.();
    }
  }, [assets, geo, ready]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    thermal.uniforms.uTime.value = t;
    holo.uniforms.uTime.value = t;
    xray.uniforms.uTime.value = t;
    if (!assets || !geo) return;
    const c = cur.current;
    const tg = target.current;
    const df = tg.fat - c.fat, dm = tg.mus - c.mus;
    if (Math.abs(df) > 0.01 || Math.abs(dm) > 0.01) {
      const k = 1 - Math.exp(-dt * 4.5);
      c.fat += df * k;
      c.mus += dm * k;
      c.settled = false;
      c.frame++;
      applyDisp(geo, assets, c.fat, c.mus);
      if (c.frame % 6 === 0) settleNormals(geo);
    } else if (!c.settled) {
      c.fat = tg.fat;
      c.mus = tg.mus;
      applyDisp(geo, assets, c.fat, c.mus);
      settleNormals(geo);
      c.settled = true;
    }
  });

  if (!assets || !geo) return null;

  const showSkinLike = mode === "skin" || mode === "muscle";
  const showBones = mode === "skeleton" || mode === "xray";
  const bodyMat = mode === "skin" ? skin : mode === "muscle" ? muscle : mode === "thermal" ? thermal : mode === "holo" ? holo : xray;
  const headMat = mode === "skin" ? skinHead : mode === "muscle" ? muscleHead : bodyMat;
  const showOuter = mode !== "skeleton";
  const isHolo = mode === "holo" || mode === "xray";

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {showOuter && (
        <mesh geometry={geo} material={bodyMat} castShadow={!isHolo} receiveShadow={!isHolo} frustumCulled={false} renderOrder={isHolo ? 2 : 0} />
      )}
      {showOuter && (
        <mesh geometry={assets.head} material={headMat} castShadow={!isHolo} receiveShadow={!isHolo} frustumCulled={false} renderOrder={isHolo ? 2 : 0} />
      )}
      {mode === "skin" && garments && (
        <>
          <mesh geometry={geo} material={bottom} castShadow receiveShadow frustumCulled={false} />
          {sex === "female" && <mesh geometry={geo} material={bra} castShadow receiveShadow frustumCulled={false} />}
        </>
      )}
      {mode === "skin" && <mesh geometry={assets.hair} material={hair} castShadow receiveShadow frustumCulled={false} />}
      {showBones && (
        <mesh geometry={assets.skeleton} material={bone} scale={sc} castShadow frustumCulled={false} />
      )}
      {showSkinLike && (
        <>
          <Eye side={1} sc={sc} iris={iris} />
          <Eye side={-1} sc={sc} iris={iris} />
        </>
      )}
    </group>
  );
}
