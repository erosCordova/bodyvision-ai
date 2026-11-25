// Librería mínima de SDF (campos de distancia con signo) + Surface Nets + exportador binario
import fs from "fs";
import zlib from "zlib";

export const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

export const smin = (a, b, k) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
export const smax = (a, b, k) => -smin(-a, -b, k);

const MARGIN = 0.12;
const M2 = MARGIN * MARGIN;
// envuelve una función con una caja delimitadora para descartar primitivas lejanas
function boxed(fn, c, r) {
  const x0 = c[0] - r, y0 = c[1] - r, z0 = c[2] - r, x1 = c[0] + r, y1 = c[1] + r, z1 = c[2] + r;
  const f = (x, y, z) => {
    const dx = Math.max(x0 - x, 0, x - x1), dy = Math.max(y0 - y, 0, y - y1), dz = Math.max(z0 - z, 0, z - z1);
    const s = dx * dx + dy * dy + dz * dz;
    if (s > M2) return Math.sqrt(s);
    return fn(x, y, z);
  };
  return f;
}

export function ell(c, r, basis) {
  const [cx, cy, cz] = c, [rx, ry, rz] = r;
  const irx = 1 / rx, iry = 1 / ry, irz = 1 / rz;
  const mn = Math.min(rx, ry, rz);
  let fn;
  if (!basis) {
    fn = (x, y, z) => {
      const lx = x - cx, ly = y - cy, lz = z - cz;
      const a = lx * irx, b = ly * iry, d = lz * irz;
      const k0 = Math.sqrt(a * a + b * b + d * d);
      const e = a * irx, f = b * iry, g = d * irz;
      const k1 = Math.sqrt(e * e + f * f + g * g);
      return k1 < 1e-9 ? -mn : (k0 * (k0 - 1)) / k1;
    };
  } else {
    const [X, Y, Z] = basis;
    fn = (x, y, z) => {
      const px = x - cx, py = y - cy, pz = z - cz;
      const lx = px * X[0] + py * X[1] + pz * X[2];
      const ly = px * Y[0] + py * Y[1] + pz * Y[2];
      const lz = px * Z[0] + py * Z[1] + pz * Z[2];
      const a = lx * irx, b = ly * iry, d = lz * irz;
      const k0 = Math.sqrt(a * a + b * b + d * d);
      const e = a * irx, f = b * iry, g = d * irz;
      const k1 = Math.sqrt(e * e + f * f + g * g);
      return k1 < 1e-9 ? -mn : (k0 * (k0 - 1)) / k1;
    };
  }
  return boxed(fn, c, Math.max(rx, ry, rz));
}

// elipsoide orientado a lo largo del eje a->b
export function ellAxis(a, b, t, off, rAlong, rSide, rFront) {
  const c = V.add(V.add(a, V.mul(V.sub(b, a), t)), off || [0, 0, 0]);
  const Y = V.norm(V.sub(b, a));
  const X = V.norm(V.cross(Y, [0, 0, 1]));
  const Z = V.cross(X, Y);
  return ell(c, [rSide, rAlong, rFront], [X, Y, Z]);
}

export const sphere = (c, r) => ell(c, [r, r, r]);

// cono redondeado (iq)
export function rc(a, b, r1, r2) {
  const ba = V.sub(b, a);
  const l2 = V.dot(ba, ba);
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  const sgn = Math.sign(rr);
  const fn = (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const y_ = px * ba[0] + py * ba[1] + pz * ba[2];
    const z_ = y_ - l2;
    const qx = px * l2 - ba[0] * y_, qy = py * l2 - ba[1] * y_, qz = pz * l2 - ba[2] * y_;
    const x2 = qx * qx + qy * qy + qz * qz;
    const y2 = y_ * y_ * l2;
    const z2 = z_ * z_ * l2;
    const k = sgn * rr * rr * x2;
    if (Math.sign(z_) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(y_) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + y_ * rr) * il2 - r1;
  };
  const mid = V.mul(V.add(a, b), 0.5);
  return boxed(fn, mid, V.len(ba) / 2 + Math.max(r1, r2));
}
export const cap = (a, b, r) => rc(a, b, r, r);

// perfil elíptico a lo largo de Y (torso) con interpolación suave
export function loft(keys, ytop, ybot) {
  const N = 512;
  const ys = keys.map((k) => k[0]);
  const tab = [];
  const ch = (idx, i) => keys.map((k) => k[idx]);
  const chans = [1, 2, 3].map((c) => keys.map((k) => k[c]));
  const eval1 = (vals, y) => {
    let i = 0;
    while (i < ys.length - 2 && y > ys[i + 1]) i++;
    const y0 = ys[i], y1 = ys[i + 1];
    const t = Math.min(Math.max((y - y0) / (y1 - y0), 0), 1);
    const tan = (j) => {
      const a = Math.max(j - 1, 0), b = Math.min(j + 1, ys.length - 1);
      return (vals[b] - vals[a]) / (ys[b] - ys[a]);
    };
    const m0 = tan(i) * (y1 - y0), m1 = tan(i + 1) * (y1 - y0);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * vals[i] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * vals[i + 1] + (t3 - t2) * m1;
  };
  void ch;
  const lo = ys[0], hi = ys[ys.length - 1];
  for (let i = 0; i <= N; i++) {
    const y = lo + ((hi - lo) * i) / N;
    tab.push([eval1(chans[0], y), eval1(chans[1], y), eval1(chans[2], y)]);
  }
  const ym = (ytop + ybot) / 2, hh = (ytop - ybot) / 2;
  const fn = (x, y, z) => {
    const u = Math.min(Math.max((y - lo) / (hi - lo), 0), 1) * N;
    const i = Math.min(Math.floor(u), N - 1), f = u - i;
    const A = tab[i], B = tab[i + 1];
    const a = A[0] + (B[0] - A[0]) * f, b = A[1] + (B[1] - A[1]) * f, zc = A[2] + (B[2] - A[2]) * f;
    const px = x / a, pz = (z - zc) / b;
    const k0 = Math.hypot(px, pz);
    const k1 = Math.hypot(px / a, pz / b);
    const d2 = (k1 < 1e-9 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1) * 0.93;
    const dy = Math.abs(y - ym) - hh;
    return Math.min(Math.max(d2, dy), 0) + Math.hypot(Math.max(d2, 0), Math.max(dy, 0));
  };
  fn.sample = (y) => {
    const u = Math.min(Math.max((y - lo) / (hi - lo), 0), 1) * N;
    const i = Math.min(Math.floor(u), N - 1), f = u - i;
    const A = tab[i], B = tab[i + 1];
    return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
  };
  return fn;
}

export const U = (list, k) => (x, y, z) => {
  let d = list[0](x, y, z);
  for (let i = 1; i < list.length; i++) d = smin(d, list[i](x, y, z), k);
  return d;
};
export const mirror = (f) => (x, y, z) => f(Math.abs(x), y, z);

// ---------------------------------------------------------------- Surface Nets
export function surfaceNets(sdf, min, max, h, log = console.log) {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  const id = (i, j, k) => i + nx * (j + ny * k);
  const B = 8;
  const R = B * h * 0.87 * 1.7 + 0.03;
  let evald = 0;
  for (let k0 = 0; k0 < nz; k0 += B)
    for (let j0 = 0; j0 < ny; j0 += B)
      for (let i0 = 0; i0 < nx; i0 += B) {
        const i1 = Math.min(i0 + B, nx), j1 = Math.min(j0 + B, ny), k1 = Math.min(k0 + B, nz);
        const cx = min[0] + ((i0 + i1 - 1) / 2) * h, cy = min[1] + ((j0 + j1 - 1) / 2) * h, cz = min[2] + ((k0 + k1 - 1) / 2) * h;
        const d = sdf(cx, cy, cz);
        if (Math.abs(d) > R) {
          for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) F[id(i, j, k)] = d;
        } else {
          for (let k = k0; k < k1; k++)
            for (let j = j0; j < j1; j++)
              for (let i = i0; i < i1; i++) {
                F[id(i, j, k)] = sdf(min[0] + i * h, min[1] + j * h, min[2] + k * h);
                evald++;
              }
        }
      }
  log(`  grid ${nx}x${ny}x${nz}, evaluadas ${evald}`);

  const cellV = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = F[id(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = E[e][0], b = E[e][1];
          if (cv[a] < 0 === cv[b] < 0) continue;
          const t = cv[a] / (cv[a] - cv[b]);
          const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1;
          const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1;
          sx += ax + (bx - ax) * t; sy += ay + (by - ay) * t; sz += az + (bz - az) * t;
          n++;
        }
        cellV[id(i, j, k)] = pos.length / 3;
        pos.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
      }
  const tris = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    tris.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const s0 = F[id(i, j, k)] < 0;
        if (s0 !== F[id(i + 1, j, k)] < 0)
          quad(cellV[id(i, j - 1, k - 1)], cellV[id(i, j, k - 1)], cellV[id(i, j, k)], cellV[id(i, j - 1, k)]);
        if (s0 !== F[id(i, j + 1, k)] < 0)
          quad(cellV[id(i - 1, j, k - 1)], cellV[id(i, j, k - 1)], cellV[id(i, j, k)], cellV[id(i - 1, j, k)]);
        if (s0 !== F[id(i, j, k + 1)] < 0)
          quad(cellV[id(i - 1, j - 1, k)], cellV[id(i, j - 1, k)], cellV[id(i, j, k)], cellV[id(i - 1, j, k)]);
      }
  const nv = pos.length / 3;
  log(`  vértices ${nv}, triángulos ${tris.length / 3}`);

  // proyección a la superficie + normales por gradiente
  const P = new Float32Array(pos);
  const N = new Float32Array(nv * 3);
  const eps = h * 0.4;
  const grad = (x, y, z) => {
    const gx = sdf(x + eps, y, z) - sdf(x - eps, y, z);
    const gy = sdf(x, y + eps, z) - sdf(x, y - eps, z);
    const gz = sdf(x, y, z + eps) - sdf(x, y, z - eps);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  };
  for (let v = 0; v < nv; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z);
      if (Math.abs(d) < 1e-5) break;
      const g = grad(x, y, z);
      const step = Math.max(Math.min(d, h * 0.8), -h * 0.8);
      x -= g[0] * step; y -= g[1] * step; z -= g[2] * step;
    }
    const g = grad(x, y, z);
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    N[v * 3] = g[0]; N[v * 3 + 1] = g[1]; N[v * 3 + 2] = g[2];
  }
  const T = new Uint32Array(tris);
  for (let t = 0; t < T.length; t += 3) {
    const a = T[t] * 3, b = T[t + 1] * 3, c = T[t + 2] * 3;
    const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const n = V.cross(e1, e2);
    const s = n[0] * (N[a] + N[b] + N[c]) + n[1] * (N[a + 1] + N[b + 1] + N[c + 1]) + n[2] * (N[a + 2] + N[b + 2] + N[c + 2]);
    if (s < 0) { const tmp = T[t + 1]; T[t + 1] = T[t + 2]; T[t + 2] = tmp; }
  }
  return { P, N, T };
}

// ---------------------------------------------------------------- binario
export function writeBin(file, { P, N, T }) {
  const nv = P.length / 3, nt = T.length / 3;
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], P[i * 3 + a]); mx[a] = Math.max(mx[a], P[i * 3 + a]); }
  const posBytes = Math.ceil((nv * 6) / 4) * 4;
  const nrmBytes = Math.ceil((nv * 3) / 4) * 4;
  const buf = Buffer.alloc(32 + posBytes + nrmBytes + nt * 12);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let a = 0; a < 3; a++) { dv.setFloat32(a * 4, mn[a], true); dv.setFloat32(12 + a * 4, mx[a], true); }
  dv.setUint32(24, nv, true); dv.setUint32(28, nt, true);
  let o = 32;
  for (let i = 0; i < nv * 3; i++) {
    const a = i % 3;
    const q = Math.round(((P[i] - mn[a]) / (mx[a] - mn[a] || 1)) * 65535);
    dv.setUint16(o + i * 2, q, true);
  }
  o += posBytes;
  for (let i = 0; i < nv * 3; i++) dv.setInt8(o + i, Math.round(Math.max(-1, Math.min(1, N[i])) * 127));
  o += nrmBytes;
  for (let i = 0; i < nt * 3; i++) dv.setUint32(o + i * 4, T[i], true);
  fs.mkdirSync(file.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  fs.writeFileSync(file, buf);
  console.log(`  -> ${file} ${(buf.length / 1e6).toFixed(2)} MB`);
}

export function readBin(file) {
  const b = fs.readFileSync(file);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const mn = [0, 1, 2].map((a) => dv.getFloat32(a * 4, true));
  const mx = [0, 1, 2].map((a) => dv.getFloat32(12 + a * 4, true));
  const nv = dv.getUint32(24, true), nt = dv.getUint32(28, true);
  const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
  let o = 32;
  for (let i = 0; i < nv * 3; i++) { const a = i % 3; P[i] = mn[a] + (dv.getUint16(o + i * 2, true) / 65535) * (mx[a] - mn[a]); }
  o += Math.ceil((nv * 6) / 4) * 4;
  for (let i = 0; i < nv * 3; i++) N[i] = dv.getInt8(o + i) / 127;
  return { P, N, nv, nt };
}

// ---------------------------------------------------------------- PNG
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = crcT[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}
