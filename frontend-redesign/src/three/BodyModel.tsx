import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Sex } from "./assets";
import * as M from "./materials";

export type Mode = "skin" | "muscle" | "skeleton" | "xray" | "thermal" | "holo" | "organs" | "arteries" | "veins" | "nerves" | "all";
export const ReadyContext = createContext<(() => void) | null>(null);
export const TONES: Record<string, string> = { claro:"#e2b79c", medio:"#c68a64", trigueño:"#a96f4c", oscuro:"#6f4630" };
export interface BodyModelProps {
  sex: Sex; fat?:number; mus?:number; mode?:Mode; tone?:string; garments?:boolean;
  position?:[number,number,number]; rotationY?:number; highlight?:boolean;
}

const COLORS = {skeleton:"#e8dfc9",muscles:"#c94f45",organs:"#d9725f",arteries:"#ef4444",veins:"#3b82f6",nerves:"#f5c542",skin:"#eab391"} as const;
type Layer = keyof typeof COLORS;
const LAYERS = Object.keys(COLORS) as Layer[];
const VIEWS:Record<Mode,Layer[]> = {
 skin:["skin"], muscle:["muscles"], skeleton:["skeleton"], xray:["skeleton","organs","arteries","veins","skin"],
 thermal:["skin"], holo:["skin"], organs:["organs"], arteries:["arteries"], veins:["veins"], nerves:["nerves"], all:LAYERS,
};
const url=(layer:Layer)=>import.meta.env.BASE_URL+"models/zanatomy/"+layer+".glb";
const draco=import.meta.env.BASE_URL+"draco/";

// Flatten the original exported meshes in world coordinates, using one shared
// anatomical reference for every layer. Merge only for preview performance.
function geometryFor(root:THREE.Object3D, transform:THREE.Matrix4, layer:Layer){
  const pieces:THREE.BufferGeometry[]=[];
  root.updateMatrixWorld(true);
  root.traverse(object=>{
    if(!(object instanceof THREE.Mesh)||!object.geometry?.getAttribute("position"))return;
    let g=object.geometry.clone();
    if(g.index){const unindexed=g.toNonIndexed();g.dispose();g=unindexed;}
    for(const key of Object.keys(g.attributes))if(key!=="position"&&key!=="normal")g.deleteAttribute(key);
    if(!g.getAttribute("normal"))g.computeVertexNormals();
    g.clearGroups();
    g.applyMatrix4(transform.clone().multiply(object.matrixWorld));
    pieces.push(g);
  });
  const merged=mergeGeometries(pieces,false);
  pieces.forEach(g=>g.dispose());
  if(!merged)throw new Error("Capa anatómica vacía: "+layer);
  if(layer==="skin"){
    const p=merged.getAttribute("position"), heat=new Float32Array(p.count);
    for(let i=0;i<p.count;i++)heat[i]=THREE.MathUtils.clamp(.23+.65*Math.exp(-((p.getY(i)-1.24)**2/.19+p.getX(i)**2/.07)),0,1);
    merged.setAttribute("aHeat",new THREE.BufferAttribute(heat,1));
  }
  return merged;
}

export function BodyModel({sex,fat=0,mus=0,mode="skin",tone="medio",garments=true,position=[0,0,0],rotationY=0}:BodyModelProps){
  const wanted=VIEWS[mode];
  const keys=useMemo(()=>Array.from(new Set<Layer>(["skin","skeleton",...VIEWS[mode]])),[mode]);
  const gltfs=useGLTF(keys.map(url),draco);
  const ready=useContext(ReadyContext);
  const group=useRef<THREE.Group>(null);
  const parts=useMemo(()=>{
    const roots=new Map(keys.map((key,i)=>[key,gltfs[i].scene]));
    const skin=roots.get("skin")!;
    const box=new THREE.Box3().setFromObject(skin);
    const height=box.getSize(new THREE.Vector3()).y;
    if(!(height>0))throw Error("Atlas sin dimensiones válidas");
    const center=box.getCenter(new THREE.Vector3());
    const s=1.75/height;
    const transform=new THREE.Matrix4().makeScale(s,s,s).multiply(new THREE.Matrix4().makeTranslation(-center.x,-box.min.y,-center.z));
    return keys.map(layer=>({layer,geometry:geometryFor(roots.get(layer)!,transform,layer)}));
  },[gltfs,keys]);
  const materials=useMemo(()=>{
    const standard=Object.fromEntries(LAYERS.map(layer=>[layer,new THREE.MeshStandardMaterial({color:layer==="skin"?(TONES[tone]||tone):COLORS[layer],roughness:layer==="skin"?.78:layer==="skeleton"?.8:.5,metalness:.02,emissive:new THREE.Color(COLORS[layer]).multiplyScalar(.06),emissiveIntensity:.35})])) as Record<Layer,THREE.MeshStandardMaterial>;
    return {standard,thermal:M.thermalMaterial(),holo:new THREE.MeshBasicMaterial({color:"#63e4ff",wireframe:true,transparent:true,opacity:.72,depthWrite:false,side:THREE.DoubleSide}),xray:new THREE.MeshBasicMaterial({color:"#63e4ff",wireframe:true,transparent:true,opacity:.23,depthWrite:false,side:THREE.DoubleSide}),bottom:M.garmentMaterial(sex==="male"?"shorts":"bikini",1,"#12161d"),bra:M.garmentMaterial("bra",1,"#12161d")};
  },[tone,sex]);
  useEffect(()=>{ready?.();},[ready,parts]);
  useEffect(()=>()=>parts.forEach(p=>p.geometry.dispose()),[parts]);
  useEffect(()=>()=>{Object.values(materials.standard).forEach(m=>m.dispose());materials.thermal.dispose();materials.holo.dispose();materials.xray.dispose();materials.bottom.dispose();materials.bra.dispose();},[materials]);
  useFrame((state,dt)=>{
    materials.thermal.uniforms.uTime.value=state.clock.elapsedTime;
    if(group.current){
      const radial=THREE.MathUtils.clamp(1+fat*.006+mus*.003,.8,1.25), k=1-Math.exp(-dt*4.5);
      group.current.scale.x=THREE.MathUtils.lerp(group.current.scale.x,radial,k);
      group.current.scale.z=THREE.MathUtils.lerp(group.current.scale.z,radial,k);
    }
  });
  return <group position={position} rotation={[0,rotationY,0]}>
    <group ref={group}>
      {parts.filter(p=>wanted.includes(p.layer)).map(({layer,geometry})=>{
        const wire=layer==="skin"&&(mode==="holo"||mode==="xray"||mode==="all");
        const material=layer==="skin"?(mode==="holo"?materials.holo:wire?materials.xray:mode==="thermal"?materials.thermal:materials.standard.skin):materials.standard[layer];
        return <group key={layer}>
          <mesh geometry={geometry} material={material} castShadow={!wire} receiveShadow={!wire} renderOrder={wire?8:0}/>
          {layer==="skin"&&mode==="skin"&&garments&&<><mesh geometry={geometry} material={materials.bottom} castShadow receiveShadow/>{sex==="female"&&<mesh geometry={geometry} material={materials.bra} castShadow receiveShadow/>}</>}
        </group>;
      })}
    </group>
  </group>;
}
