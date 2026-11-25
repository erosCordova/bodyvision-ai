import { surfaceNets, writeBin, readBin, writePNG } from "./sdf.mjs";
import { makeBody, makeHair, makeSkeleton } from "./models.mjs";

const [, , cmd, ...args] = process.argv;

if (cmd === "bake") {
  const [what, sex, hStr, outDir = "src/assets/models"] = args;
  const h = parseFloat(hStr);
  const t0 = Date.now();
  console.log(`bake ${what} ${sex} h=${h}`);
  let sdf, min, max;
  if (what === "head") { sdf = makeBody(sex); const sc = sex === "female" ? 0.935 : 1; min = [-0.1 * sc, 1.54 * sc, -0.12 * sc]; max = [0.1 * sc, 1.82 * sc, 0.14 * sc]; }
  else if (what === "body") { sdf = makeBody(sex); min = [-0.5, -0.02, -0.17]; max = [0.5, 1.82, 0.25]; }
  else if (what === "hair") { sdf = makeHair(sex); min = [-0.15, 1.3, -0.22]; max = [0.15, 1.82, 0.16]; }
  else { sdf = makeSkeleton(); min = [-0.5, -0.02, -0.17]; max = [0.5, 1.82, 0.25]; }
  const mesh = surfaceNets(sdf, min, max, h);
  writeBin(`${outDir}/${what === "skeleton" ? "skeleton" : what + "_" + sex}.bin`, mesh);
  console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (cmd === "preview") {
  // preview out.png view(front|side|back|head|torso|hand) file:colorHex ...
  const [out, view, ...files] = args;
  const meshes = files.map((f) => { const [p, c] = f.split(":"); const m = readBin(p); const cc = parseInt(c || "d9a68a", 16); m.col = [(cc >> 16) & 255, (cc >> 8) & 255, cc & 255]; return m; });
  const W = 700, H = 760;
  const views = {
    front: { cx: 0, cy: 0.9, s: 400, ax: 0 },
    back: { cx: 0, cy: 0.9, s: 400, ax: Math.PI },
    side: { cx: 0, cy: 0.9, s: 400, ax: Math.PI / 2 },
    head: { cx: 0, cy: 1.67, s: 3200, ax: 0 },
    headside: { cx: 0, cy: 1.67, s: 3200, ax: Math.PI / 2 },
    torso: { cx: 0, cy: 1.2, s: 1400, ax: 0 },
    hand: { cx: 0.4, cy: 0.85, s: 3000, ax: 0 },
    legs: { cx: 0, cy: 0.5, s: 900, ax: 0 },
  };
  const v = views[view];
  const zb = new Float32Array(W * H).fill(-1e9);
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { img[i * 3] = 14; img[i * 3 + 1] = 22; img[i * 3 + 2] = 38; }
  const ca = Math.cos(v.ax), sa = Math.sin(v.ax);
  const L = [0.35, 0.55, 0.75];
  const ll = Math.hypot(...L);
  for (const m of meshes) {
    for (let i = 0; i < m.nv; i++) {
      const x = m.P[i * 3], y = m.P[i * 3 + 1], z = m.P[i * 3 + 2];
      const nxv = m.N[i * 3], nyv = m.N[i * 3 + 1], nzv = m.N[i * 3 + 2];
      const rx = x * ca + z * sa, rz = -x * sa + z * ca;
      const rnx = nxv * ca + nzv * sa, rnz = -nxv * sa + nzv * ca;
      const px = Math.round(W / 2 + (rx - v.cx) * v.s), py = Math.round(H / 2 - (y - v.cy) * v.s);
      const lam = Math.max(0, (rnx * L[0] + nyv * L[1] + rnz * L[2]) / ll);
      const rim = Math.pow(1 - Math.max(0, rnz), 3) * 0.25;
      const b = 0.18 + 0.85 * lam + rim;
      const rad = v.s > 1000 ? 4 : 2;
      for (let dy = -rad; dy <= rad; dy++)
        for (let dx = -rad; dx <= rad; dx++) {
          const X = px + dx, Y = py + dy;
          if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
          const k = Y * W + X;
          if (rz > zb[k]) {
            zb[k] = rz;
            for (let c = 0; c < 3; c++) img[k * 3 + c] = Math.min(255, m.col[c] * b);
          }
        }
    }
  }
  writePNG(out, W, H, img);
  console.log("png", out);
}
