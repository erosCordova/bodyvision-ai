import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls, Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { ReadyContext } from "./BodyModel";

export type ViewPreset = "3q" | "front" | "side" | "back" | "head" | "torso" | "legs";

function CameraRig({ view, dist, tick }: { view: ViewPreset; dist: number; tick: number }) {
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (n: string, f: () => void) => void; removeEventListener: (n: string, f: () => void) => void } | null;
  const camera = useThree((s) => s.camera);
  const goal = useRef<{ pos: THREE.Vector3; tgt: THREE.Vector3 } | null>(null);
  useEffect(() => {
    const d = dist;
    const P: Record<ViewPreset, [number[], number[]]> = {
      "3q": [[d * 0.32, 1.2, d * 0.95], [0, 0.92, 0]],
      front: [[0, 1.15, d], [0, 0.92, 0]],
      side: [[d, 1.15, 0], [0, 0.92, 0]],
      back: [[0, 1.15, -d], [0, 0.92, 0]],
      head: [[0.25, 1.72, 1.35], [0, 1.68, 0]],
      torso: [[0.2, 1.3, 2.3], [0, 1.25, 0]],
      legs: [[0.3, 0.6, 3.0], [0, 0.5, 0]],
    };
    const [p, t] = P[view];
    goal.current = { pos: new THREE.Vector3(...p), tgt: new THREE.Vector3(...t) };
  }, [view, dist, tick]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => (goal.current = null);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);
  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 3.2);
    camera.position.lerp(g.pos, k);
    controls.target.lerp(g.tgt, k);
    controls.update();
    if (camera.position.distanceTo(g.pos) < 0.01) goal.current = null;
  });
  return null;
}

function Platform({ ring }: { ring: string }) {
  const scan = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    const t = (s.clock.elapsedTime * 0.35) % 1;
    if (scan.current) {
      scan.current.scale.setScalar(0.35 + t * 0.9);
      (scan.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.7;
    }
  });
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.003}>
        <circleGeometry args={[1.6, 96]} />
        <meshBasicMaterial color="#06111f" />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001}>
        <ringGeometry args={[1.0, 1.012, 128]} />
        <meshBasicMaterial color={ring} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={0.001}>
        <ringGeometry args={[1.28, 1.282, 128]} />
        <meshBasicMaterial color={ring} transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh ref={scan} rotation-x={-Math.PI / 2} position-y={0.002}>
        <ringGeometry args={[0.97, 1.0, 96]} />
        <meshBasicMaterial color={ring} transparent opacity={0.5} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Annotation({ position, label, value, color = "#22d3ee", align = "right" }: { position: [number, number, number]; label: string; value: string; color?: string; align?: "left" | "right" }) {
  return (
    <group position={position}>
      <mesh>
        <sphereGeometry args={[0.012, 16, 12]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <Html center={false} style={{ pointerEvents: "none", transform: `translate(${align === "right" ? "14px" : "calc(-100% - 14px)"}, -50%)` }} zIndexRange={[20, 0]}>
        <div className="flex items-center gap-2 whitespace-nowrap rounded-md border bg-slate-950/80 px-2.5 py-1.5 text-[11px] backdrop-blur" style={{ borderColor: color + "88" }}>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          <span className="text-slate-300">{label}</span>
          <span className="font-semibold text-white">{value}</span>
        </div>
      </Html>
    </group>
  );
}

interface SceneProps {
  children: ReactNode;
  autoRotate?: boolean;
  view?: ViewPreset;
  viewTick?: number;
  distance?: number;
  ring?: string;
  sparkles?: boolean;
  className?: string;
  bg?: string;
  minDistance?: number;
  maxDistance?: number;
  rotateSpeed?: number;
}

export function BodyScene({
  children,
  autoRotate = true,
  view = "3q",
  viewTick = 0,
  distance = 4.4,
  ring = "#22d3ee",
  sparkles = true,
  className = "",
  bg = "#050c18",
  minDistance = 1.1,
  maxDistance = 7,
  rotateSpeed = 1.1,
}: SceneProps) {
  const [ready, setReady] = useState(false);
  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: bg }}>
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 28, position: [distance * 0.32, 1.2, distance * 0.95], near: 0.05, far: 60 }}
        gl={{ antialias: false, powerPreference: "high-performance", toneMapping: THREE.NoToneMapping }}
      >
        <color attach="background" args={[bg]} />
        <fog attach="fog" args={[bg, 7, 15]} />
        <hemisphereLight args={["#9bb8ff", "#1a0f0a", 0.35]} />
        <directionalLight
          position={[2.6, 3.6, 3.2]}
          intensity={2.6}
          color="#fff0e2"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-1.4}
          shadow-camera-right={1.4}
          shadow-camera-top={2.2}
          shadow-camera-bottom={-0.2}
          shadow-camera-near={0.5}
          shadow-camera-far={10}
          shadow-bias={-0.0003}
          shadow-normalBias={0.012}
        />
        <directionalLight position={[-3.5, 2.6, -3]} intensity={2.4} color="#4cc2ff" />
        <directionalLight position={[3.5, 1.2, -2.5]} intensity={1.1} color="#7a8bff" />
        <Suspense fallback={null}>
          <Environment resolution={256} frames={1}>
            <Lightformer form="rect" intensity={3.5} color="#fff3e8" position={[-3, 4, 4]} scale={[6, 3, 1]} target={[0, 1, 0]} />
            <Lightformer form="rect" intensity={1.4} color="#7fc4ff" position={[5, 2, 2]} scale={[3, 5, 1]} target={[0, 1, 0]} />
            <Lightformer form="ring" intensity={2.2} color="#22d3ee" position={[0, 3, -5]} scale={5} target={[0, 1, 0]} />
            <Lightformer form="rect" intensity={1.3} color="#ffffff" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[8, 8, 1]} />
          </Environment>
        </Suspense>
        <ReadyContext.Provider value={() => setReady(true)}>
          <Suspense fallback={null}>{children}</Suspense>
        </ReadyContext.Provider>
        <Platform ring={ring} />
        <ContactShadows position={[0, 0.002, 0]} opacity={0.75} scale={5} blur={2.4} far={1.8} resolution={512} color="#000814" />
        {sparkles && <Sparkles count={70} scale={[3.2, 2.6, 3.2]} position={[0, 1, 0]} size={2.2} speed={0.25} opacity={0.6} color={ring} />}
        <OrbitControls
          makeDefault
          target={[0, 0.92, 0]}
          enablePan={false}
          enableDamping
          dampingFactor={0.07}
          autoRotate={autoRotate}
          autoRotateSpeed={rotateSpeed}
          minDistance={minDistance}
          maxDistance={maxDistance}
          minPolarAngle={0.35}
          maxPolarAngle={Math.PI / 2 + 0.2}
        />
        <CameraRig view={view} dist={distance} tick={viewTick} />
        <EffectComposer multisampling={4} enableNormalPass={false}>
          <Bloom intensity={0.7} luminanceThreshold={0.9} luminanceSmoothing={0.25} mipmapBlur />
          <Vignette offset={0.25} darkness={0.75} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      </Canvas>
      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#050c18]/85 text-sm text-cyan-200">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400/20 border-t-cyan-300" />
          Reconstruyendo modelo anatómico…
        </div>
      )}
    </div>
  );
}
