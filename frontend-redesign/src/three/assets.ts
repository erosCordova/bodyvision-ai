import * as THREE from "three";
import bodyMaleUrl from "../assets/models/body_male.bin.gz?url";
import bodyFemaleUrl from "../assets/models/body_female.bin.gz?url";
import headMaleUrl from "../assets/models/head_male.bin.gz?url";
import headFemaleUrl from "../assets/models/head_female.bin.gz?url";
import hairMaleUrl from "../assets/models/hair_male.bin.gz?url";
import hairFemaleUrl from "../assets/models/hair_female.bin.gz?url";
import skeletonUrl from "../assets/models/skeleton.bin.gz?url";

export type Sex = "male" | "female";

export interface Assets {
  sex: Sex;
  sc: number;
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  hair: THREE.BufferGeometry;
  skeleton: THREE.BufferGeometry;
  wFat: Float32Array;
  wMus: Float32Array;
  basePos: Float32Array;
  baseNrm: Float32Array;
}

const geoCache = new Map<string, Promise<THREE.BufferGeometry>>();

async function gunzip(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  const ds = new DecompressionStream("gzip");
  const stream = res.body!.pipeThrough(ds);
  return new Response(stream).arrayBuffer();
}

function parse(buf: ArrayBuffer): THREE.BufferGeometry {
  const dv = new DataView(buf);
  const mn = [0, 1, 2].map((i) => dv.getFloat32(i * 4, true));
  const mx = [0, 1, 2].map((i) => dv.getFloat32(12 + i * 4, true));
  const nv = dv.getUint32(24, true);
  const nt = dv.getUint32(28, true);
  let o = 32;
  const q = new Uint16Array(buf, o, nv * 3);
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < nv * 3; i++) {
    const a = i % 3;
    pos[i] = mn[a] + (q[i] / 65535) * (mx[a] - mn[a]);
  }
  o += Math.ceil((nv * 6) / 4) * 4;
  const n8 = new Int8Array(buf, o, nv * 3);
  const nrm = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const x = n8[i * 3], y = n8[i * 3 + 1], z = n8[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
  }
  o += Math.ceil((nv * 3) / 4) * 4;
  const idx = new Uint32Array(buf.slice(o, o + nt * 12));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function loadGeo(url: string) {
  let p = geoCache.get(url);
  if (!p) {
    p = gunzip(url).then(parse);
    geoCache.set(url, p);
  }
  return p;
}

// ------------------------------------------------------------------ utilidades de regiones
const g = (v: number, c: number, s: number) => Math.exp(-(((v - c) / s) ** 2));
const sm = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

function fatWeight(ux: number, uy: number, nx: number, nz: number, female: boolean) {
  const arm = sm(0.215, 0.26, ux) * sm(0.8, 1.2, uy);
  const tor = 1 - sm(0.2, 0.25, ux);
  const front = 0.4 + 0.6 * Math.max(0, nz);
  const back = 0.3 + 0.7 * Math.max(0, -nz);
  let w = 0;
  w += tor * (female ? 0.8 : 1.0) * g(uy, 1.08, 0.1) * front;
  w += tor * 0.55 * g(uy, 1.14, 0.1) * Math.abs(nx);
  w += tor * (female ? 0.75 : 0.5) * g(uy, 0.97, 0.1);
  w += tor * 0.4 * g(uy, 1.34, 0.09) * front;
  w += tor * 0.4 * g(uy, 1.3, 0.12) * back;
  w += (1 - sm(0.2, 0.26, ux)) * (female ? 0.75 : 0.55) * g(uy, 0.68, 0.17) * (uy < 0.95 ? 1 : 0);
  w += 0.2 * g(uy, 0.3, 0.12) * (ux < 0.2 ? 1 : 0);
  w += arm * 0.45 * (1 - sm(1.42, 1.5, uy));
  return w * (1 - sm(1.44, 1.54, uy));
}

function musWeight(ux: number, uy: number, nx: number, nz: number) {
  const arm = sm(0.215, 0.26, ux);
  const tor = 1 - sm(0.2, 0.25, ux);
  const front = Math.max(0, nz);
  const back = Math.max(0, -nz);
  let w = 0;
  w += tor * 0.9 * g(uy, 1.36, 0.07) * (0.3 + 0.7 * front);
  w += 0.9 * g(ux, 0.2, 0.06) * g(uy, 1.45, 0.07);
  w += arm * 0.8 * g(uy, 1.27, 0.1);
  w += arm * 0.4 * g(uy, 1.0, 0.1);
  w += tor * 0.7 * g(uy, 1.28, 0.1) * (0.3 + 0.7 * back);
  w += tor * 0.35 * g(uy, 1.15, 0.08) * (0.3 + 0.7 * front);
  w += (1 - arm) * 0.9 * g(uy, 0.68, 0.15) * (0.5 + 0.5 * front) * (uy < 0.95 ? 1 : 0);
  w += (1 - arm) * 0.5 * g(uy, 0.33, 0.1) * (0.4 + 0.6 * back);
  w += tor * 0.7 * g(uy, 0.93, 0.07) * back;
  void nx;
  return w * (1 - sm(1.46, 1.55, uy));
}

// multiplicadores de color de piel por región (vertex colors)
function skinMul(ux: number, uy: number, uz: number, nz: number, male: boolean, out: number[]) {
  let r = 1, gg = 1, b = 1;
  const mix = (t: number, mr: number, mg: number, mb: number) => {
    t = Math.min(Math.max(t, 0), 1);
    r += (mr - r) * t; gg += (mg - gg) * t; b += (mb - b) * t;
  };
  // labios
  const lip = g(ux, 0, 0.022) * g(uy, 1.62, 0.011) * (uz > 0.07 ? 1 : 0);
  mix(lip * 1.4, 0.82, 0.5, 0.52);
  // cejas
  const eb = Math.exp(-(((ux - 0.031) / 0.03) ** 2) - ((uy - 1.7185) / 0.0075) ** 2) * (uz > 0.06 ? 1 : 0);
  mix(eb * 1.6, 0.34, 0.27, 0.24);
  // ojeras / órbitas
  mix(g(ux, 0.031, 0.02) * g(uy, 1.688, 0.012) * 0.35 * (uz > 0.06 ? 1 : 0), 0.9, 0.82, 0.84);
  // mejillas
  mix(g(ux, 0.048, 0.03) * g(uy, 1.655, 0.03) * 0.5 * (uz > 0.04 ? 1 : 0), 1.0, 0.86, 0.86);
  // orejas
  mix(g(ux, 0.081, 0.012) * g(uy, 1.685, 0.03) * 0.7, 1.0, 0.82, 0.78);
  // barba (sombra)
  if (male && uz > 0.0 && uy < 1.652 && uy > 1.572) {
    const stub = sm(1.572, 1.598, uy) * (1 - sm(1.636, 1.652, uy) * 0.5) * (1 - lip) * sm(0.0, 0.03, uz);
    mix(stub * 0.55, 0.78, 0.76, 0.78);
  }
  // pezones
  const nipC = male ? [0.093, 1.348] : [0.053, 1.332];
  const dn = Math.hypot(ux - nipC[0], uy - nipC[1]);
  mix((1 - sm(0.008, 0.015, dn)) * (nz > 0.3 ? 1 : 0) * 0.8, 0.78, 0.6, 0.58);
  // codos y rodillas
  mix(g(ux, 0.31, 0.03) * g(uy, 1.165, 0.04) * 0.4, 0.95, 0.84, 0.82);
  mix(g(ux, 0.095, 0.045) * g(uy, 0.5, 0.04) * 0.35, 0.97, 0.88, 0.86);
  out[0] = r; out[1] = gg; out[2] = b;
}

function heatOf(ux: number, uy: number, uz: number, wf: number) {
  const core = Math.exp(-((ux / 0.26) ** 2)) * Math.exp(-(((uy - 1.2) / 0.34) ** 2));
  const head = Math.exp(-(((uy - 1.66) / 0.1) ** 2)) * 0.9;
  const n = Math.sin(ux * 41 + uy * 23 + uz * 17) * Math.sin(uy * 29 - uz * 31) * 0.05;
  const armGrad = ux > 0.2 ? -0.12 * (1 - uy) : 0;
  let h = 0.28 + 0.52 * core + 0.3 * head + wf * 0.16 + n + armGrad + Math.max(0, uy - 0.2) * 0.04;
  h -= Math.max(0, 0.3 - uy) * 0.4;
  return Math.min(Math.max(h, 0), 1);
}

function processBody(geo: THREE.BufferGeometry, sc: number, sex: Sex) {
  const pos = geo.attributes.position.array as Float32Array;
  const nrm = geo.attributes.normal.array as Float32Array;
  const idx = geo.index!.array as Uint32Array;
  const keep: number[] = [];
  const cutY = 1.555 * sc;
  for (let t = 0; t < idx.length; t += 3) {
    const cy = (pos[idx[t] * 3 + 1] + pos[idx[t + 1] * 3 + 1] + pos[idx[t + 2] * 3 + 1]) / 3;
    if (cy < cutY) keep.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(keep), 1));
  const nv = pos.length / 3;
  const wFat = new Float32Array(nv), wMus = new Float32Array(nv);
  for (let i = 0; i < nv; i++) {
    const ux = Math.abs(pos[i * 3]) / sc, uy = pos[i * 3 + 1] / sc;
    wFat[i] = fatWeight(ux, uy, nrm[i * 3], nrm[i * 3 + 2], sex === "female");
    wMus[i] = musWeight(ux, uy, nrm[i * 3], nrm[i * 3 + 2]) * (sex === "female" ? 0.8 : 1);
  }
  return { wFat, wMus };
}

function addVertexAttrs(geo: THREE.BufferGeometry, sc: number, sex: Sex, wFat?: Float32Array) {
  const pos = geo.attributes.position.array as Float32Array;
  const nrm = geo.attributes.normal.array as Float32Array;
  const nv = pos.length / 3;
  const col = new Float32Array(nv * 3);
  const heat = new Float32Array(nv);
  const tmp = [1, 1, 1];
  for (let i = 0; i < nv; i++) {
    const ux = Math.abs(pos[i * 3]) / sc, uy = pos[i * 3 + 1] / sc, uz = pos[i * 3 + 2] / sc;
    skinMul(ux, uy, uz, nrm[i * 3 + 2], sex === "male", tmp);
    col[i * 3] = tmp[0]; col[i * 3 + 1] = tmp[1]; col[i * 3 + 2] = tmp[2];
    heat[i] = heatOf(ux, uy, uz, wFat ? wFat[i] : 0.3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aHeat", new THREE.BufferAttribute(heat, 1));
}

const assetCache = new Map<Sex, Promise<Assets>>();

export function loadAssets(sex: Sex): Promise<Assets> {
  let p = assetCache.get(sex);
  if (!p) {
    const sc = sex === "female" ? 0.935 : 1;
    const urls = sex === "female" ? [bodyFemaleUrl, headFemaleUrl, hairFemaleUrl] : [bodyMaleUrl, headMaleUrl, hairMaleUrl];
    p = Promise.all([loadGeo(urls[0]), loadGeo(urls[1]), loadGeo(urls[2]), loadGeo(skeletonUrl)]).then(([b, h, hr, sk]) => {
      const body = b.clone();
      const head = h.clone();
      const { wFat, wMus } = processBody(body, sc, sex);
      addVertexAttrs(body, sc, sex, wFat);
      addVertexAttrs(head, sc, sex);
      return {
        sex, sc, body, head, hair: hr, skeleton: sk, wFat, wMus,
        basePos: (body.attributes.position.array as Float32Array).slice(),
        baseNrm: (body.attributes.normal.array as Float32Array).slice(),
      } as Assets;
    });
    assetCache.set(sex, p);
  }
  return p;
}

// geometría de cuerpo independiente (para comparar varias instancias)
export function cloneBody(a: Assets): THREE.BufferGeometry {
  const c = a.body.clone();
  c.setAttribute("position", new THREE.BufferAttribute(a.basePos.slice(), 3));
  c.setAttribute("normal", new THREE.BufferAttribute(a.baseNrm.slice(), 3));
  return c;
}

const K_FAT = 0.0016, K_FAT_NEG = 0.0011, K_MUS = 0.0013;

export function applyDisp(geo: THREE.BufferGeometry, a: Assets, fat: number, mus: number) {
  const pos = geo.attributes.position.array as Float32Array;
  const base = a.basePos, n = a.baseNrm;
  const kf = fat >= 0 ? K_FAT : K_FAT_NEG;
  for (let i = 0; i < a.wFat.length; i++) {
    const d = fat * kf * a.wFat[i] + mus * K_MUS * a.wMus[i];
    pos[i * 3] = base[i * 3] + n[i * 3] * d;
    pos[i * 3 + 1] = base[i * 3 + 1] + n[i * 3 + 1] * d;
    pos[i * 3 + 2] = base[i * 3 + 2] + n[i * 3 + 2] * d;
  }
  geo.attributes.position.needsUpdate = true;
}

export function settleNormals(geo: THREE.BufferGeometry) {
  geo.computeVertexNormals();
}
