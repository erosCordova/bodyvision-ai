import * as THREE from "three";

const NOISE = /* glsl */ `
float h31(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vn(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y), f.z);
}
`;

interface PatchOpts {
  key: string;
  height?: string; // GLSL: float h = ...; usa 'p' (vec3 objeto)
  bump?: number;
  albedo?: string;
  sss?: number;
  discard?: string;
  offset?: number;
  uniforms?: Record<string, THREE.IUniform>;
  uniformDecl?: string;
}

function patch(mat: THREE.MeshPhysicalMaterial, o: PatchOpts) {
  mat.customProgramCacheKey = () => o.key;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, o.uniforms || {});
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vObjPos;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvObjPos = position;\n${o.offset ? `transformed += objectNormal * ${o.offset.toFixed(5)};` : ""}`
      );
    let f = shader.fragmentShader.replace(
      "#include <common>",
      `#include <common>\nvarying vec3 vObjPos;\n${o.uniformDecl || ""}\n${NOISE}`
    );
    if (o.discard) f = f.replace("#include <clipping_planes_fragment>", `#include <clipping_planes_fragment>\n{ vec3 q = vObjPos / uScale; ${o.discard} }`);
    if (o.albedo) f = f.replace("#include <color_fragment>", `#include <color_fragment>\n{ vec3 p = vObjPos; ${o.albedo} }`);
    if (o.height) {
      f = f.replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  vec3 p = vObjPos;
  ${o.height}
  float fade = clamp(2.2 / length(vViewPosition), 0.0, 1.0);
  vec2 dH = vec2(dFdx(h), dFdy(h)) * ${(o.bump ?? 1).toFixed(3)} * fade;
  vec3 sX = normalize(dFdx(-vViewPosition)); vec3 sY = normalize(dFdy(-vViewPosition));
  vec3 R1 = cross(sY, normal); vec3 R2 = cross(normal, sX);
  float det = dot(sX, R1);
  vec3 grad = sign(det) * (dH.x * R1 + dH.y * R2);
  normal = normalize(abs(det) * normal - grad);
}`
      );
    }
    if (o.sss) {
      f = f.replace(
        "#include <opaque_fragment>",
        `{
  float ndv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
  float fr = pow(1.0 - ndv, 2.6);
  outgoingLight += vec3(0.62, 0.14, 0.07) * fr * ${o.sss.toFixed(3)};
  outgoingLight += diffuseColor.rgb * vec3(0.055, 0.016, 0.01) * ${(o.sss * 4).toFixed(3)};
}
#include <opaque_fragment>`
      );
    }
    shader.fragmentShader = f;
  };
}

export function skinMaterial(tone: string, polygonOffset = false) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(tone),
    vertexColors: true,
    roughness: 0.56,
    metalness: 0,
    sheen: 0.7,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color("#ff9d86"),
    clearcoat: 0.18,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.85,
    specularIntensity: 0.7,
  });
  if (polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -3;
    m.polygonOffsetUnits = -3;
  }
  patch(m, {
    key: "skin",
    sss: 0.2,
    albedo: `float bl = vn(p*30.0); float bl2 = vn(p*8.0 + 3.1); diffuseColor.rgb *= 0.9 + 0.13*bl + 0.07*bl2;
             diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(1.06,0.93,0.92), smoothstep(0.55,0.8,vn(p*14.0+7.0)));`,
    height: `float h = vn(p*260.0)*0.5 + vn(p*110.0)*0.3 + vn(p*45.0)*0.2;`,
    bump: 0.55,
  });
  return m;
}

export function muscleMaterial(polygonOffset = false) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#a3282a"),
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.8,
    clearcoatRoughness: 0.28,
    sheen: 0.4,
    sheenColor: new THREE.Color("#ff6a5a"),
    envMapIntensity: 1.1,
  });
  if (polygonOffset) {
    m.polygonOffset = true;
    m.polygonOffsetFactor = -3;
    m.polygonOffsetUnits = -3;
  }
  patch(m, {
    key: "muscle",
    sss: 0.3,
    albedo: `float s = vn(p*vec3(260.0,16.0,260.0));
             float s2 = vn(p*vec3(90.0,7.0,90.0)+4.0);
             vec3 dark = vec3(0.34,0.04,0.05); vec3 light = vec3(0.92,0.3,0.26);
             diffuseColor.rgb = mix(dark, light, clamp(s*0.65 + s2*0.45, 0.0, 1.0)) * 0.9;
             float tend = (1.0-smoothstep(0.0,0.035,abs(p.y-0.5))) + (1.0-smoothstep(0.0,0.03,abs(p.y-0.12))) + (1.0-smoothstep(0.0,0.03,abs(p.y-1.17)))*step(0.22,abs(p.x));
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9,0.8,0.7), clamp(tend,0.0,1.0)*0.75);`,
    height: `float h = vn(p*vec3(520.0,28.0,520.0))*0.6 + vn(p*vec3(150.0,10.0,150.0))*0.4;`,
    bump: 1.4,
  });
  return m;
}

export function boneMaterial() {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color("#e6dac0"),
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.35,
    clearcoatRoughness: 0.45,
    sheen: 0.3,
    sheenColor: new THREE.Color("#fff2d6"),
    envMapIntensity: 1.1,
  });
  patch(m, {
    key: "bone",
    sss: 0.04,
    albedo: `diffuseColor.rgb *= 0.82 + 0.28*vn(p*55.0) ; diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.93,0.82,0.66), vn(p*9.0)*0.6);`,
    height: `float h = vn(p*320.0)*0.6 + vn(p*80.0)*0.4;`,
    bump: 0.5,
  });
  return m;
}

export function hairMaterial(color: string) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.48,
    metalness: 0.1,
    sheen: 1,
    sheenColor: new THREE.Color("#8a6a55"),
    sheenRoughness: 0.35,
    clearcoat: 0.3,
    clearcoatRoughness: 0.4,
    envMapIntensity: 0.9,
  });
  patch(m, {
    key: "hair",
    albedo: `diffuseColor.rgb *= 0.75 + 0.5*vn(p*vec3(300.0,40.0,300.0));`,
    height: `float h = vn(p*vec3(260.0,35.0,260.0))*0.6 + vn(p*vec3(90.0,15.0,90.0))*0.4;`,
    bump: 0.8,
  });
  return m;
}

export type GarmentKind = "shorts" | "bra" | "bikini";

export function garmentMaterial(kind: GarmentKind, scale: number, color: string) {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.78,
    metalness: 0,
    sheen: 1,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color("#2b3a4d"),
    envMapIntensity: 0.6,
    side: THREE.DoubleSide,
  });
  const discard: Record<GarmentKind, string> = {
    shorts: `float hem = 0.655 - 0.02*q.z/0.1; if (abs(q.x) > 0.2 || q.y > 0.985 || q.y < hem) discard;`,
    bikini: `float hem = 0.64 + 0.03*smoothstep(0.0,0.1,-q.z); if (abs(q.x) > 0.2 || q.y > 0.985 || q.y < hem) discard;`,
    bra: `bool strap = false;
          float top = 1.405 - 0.03*(1.0-smoothstep(0.0,0.05,abs(q.x)))*step(0.0,q.z);
          if (abs(q.x) > 0.19 || q.y < 1.262 || (q.y > top && !strap)) discard;`,
  };
  patch(m, {
    key: "garment-" + kind,
    discard: discard[kind],
    offset: 0.0036,
    uniforms: { uScale: { value: scale } },
    uniformDecl: "uniform float uScale;",
    albedo:
      kind === "shorts"
        ? `vec3 q = p / uScale; diffuseColor.rgb *= 0.8 + 0.4*vn(p*900.0); if (q.y > 0.945) diffuseColor.rgb = vec3(0.16,0.18,0.21)*(0.8+0.4*vn(p*600.0));`
        : kind === "bikini"
        ? `diffuseColor.rgb *= 0.8 + 0.4*vn(p*900.0); vec3 q = p / uScale; if (q.y > 0.95) diffuseColor.rgb = vec3(0.2,0.22,0.27);`
        : `diffuseColor.rgb *= 0.8 + 0.4*vn(p*900.0);`,
    height: `float h = vn(p*vec3(1100.0,1100.0,1100.0))*0.6 + (0.5+0.5*sin(p.x*2200.0))*0.2 + (0.5+0.5*sin(p.y*2200.0))*0.2;`,
    bump: 0.6,
  });
  return m;
}

const VERT = /* glsl */ `
attribute float aHeat;
varying vec3 vN; varying vec3 vV; varying float vHeat; varying float vY; varying vec3 vP;
void main(){
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  vV = -mv.xyz; vHeat = aHeat; vY = position.y; vP = position;
  gl_Position = projectionMatrix * mv;
}`;

export function thermalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vHeat; varying float vY; varying vec3 vP;
uniform float uTime;
vec3 ramp(float t){
  vec3 c0=vec3(0.04,0.06,0.45), c1=vec3(0.0,0.62,0.95), c2=vec3(0.1,0.85,0.45), c3=vec3(0.98,0.92,0.15), c4=vec3(1.0,0.5,0.05), c5=vec3(0.86,0.06,0.1);
  if(t<0.2) return mix(c0,c1,t/0.2);
  if(t<0.4) return mix(c1,c2,(t-0.2)/0.2);
  if(t<0.6) return mix(c2,c3,(t-0.4)/0.2);
  if(t<0.8) return mix(c3,c4,(t-0.6)/0.2);
  return mix(c4,c5,(t-0.8)/0.2);
}
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float l = 0.62 + 0.38*dot(n, normalize(vec3(0.4,0.6,0.7)));
  float fr = pow(1.0 - clamp(dot(n,v),0.0,1.0), 2.5);
  float t = clamp(vHeat + 0.04*sin(vY*60.0 - uTime*2.0), 0.0, 1.0);
  vec3 col = ramp(t) * l + fr * vec3(0.4,0.7,1.0) * 0.45;
  float sweep = exp(-pow((vY - (fract(uTime*0.18)*2.0 - 0.1))*10.0, 2.0));
  col += sweep * vec3(0.5,0.9,1.0) * 0.5;
  gl_FragColor = vec4(col, 1.0);
}`,
  });
}

export function holoMaterial(opacity = 1, color = "#27c8ff") {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: opacity }, uColor: { value: new THREE.Color(color) } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
varying vec3 vN; varying vec3 vV; varying float vHeat; varying float vY; varying vec3 vP;
uniform float uTime; uniform float uOpacity; uniform vec3 uColor;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float fr = pow(1.0 - abs(dot(n,v)), 2.2);
  float lines = smoothstep(0.86, 1.0, sin(vY*210.0)*0.5+0.5) * 0.4;
  float grid = smoothstep(0.93, 1.0, sin(vP.x*150.0)*0.5+0.5) * 0.12;
  float sweep = exp(-pow((vY - (fract(uTime*0.2)*2.0 - 0.1))*12.0, 2.0));
  float a = (fr*0.95 + lines + grid + sweep*0.8 + 0.07) * uOpacity;
  vec3 col = mix(uColor, vec3(0.8,0.97,1.0), fr*0.6 + sweep*0.6);
  gl_FragColor = vec4(col * a, a);
}`,
  });
}

export function irisTexture(base: string, ring = "#241a12") {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, "#050505");
  g.addColorStop(0.2, "#050505");
  g.addColorStop(0.24, "#1b120a");
  g.addColorStop(0.3, base);
  g.addColorStop(0.7, base);
  g.addColorStop(0.92, ring);
  g.addColorStop(1, "#0d0a08");
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  // fibras
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = 34 + Math.random() * 20, r1 = 70 + Math.random() * 50;
    x.strokeStyle = `rgba(${Math.random() > 0.5 ? "255,225,170" : "20,10,5"},${0.05 + Math.random() * 0.12})`;
    x.lineWidth = 1 + Math.random() * 1.5;
    x.beginPath();
    x.moveTo(128 + Math.cos(a) * r0, 128 + Math.sin(a) * r0);
    x.lineTo(128 + Math.cos(a) * r1, 128 + Math.sin(a) * r1);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
