// Definición anatómica procedural (cuerpo, pelo y esqueleto) mediante SDF. Unidades: metros, +Y arriba, +Z frente.
import { V, smin, smax, ell, ellAxis, sphere, rc, cap, loft, U, mirror } from "./sdf.mjs";

export const EYE = { x: 0.0325, y: 1.697, z: 0.0825, r: 0.0125 };

// ---------------------------------------------------------------- mano (piel y hueso)
function handPrims(W, dir, mode) {
  const d = V.norm(dir);
  const inw = [-1, 0, 0];
  const out = [];
  const skin = mode === "skin";
  const rF = skin ? 0.0088 : 0.0046;
  if (skin) {
    out.push(ellAxis(W, V.add(W, V.mul(d, 0.1)), 0.52, [0, 0, 0], 0.058, 0.019, 0.043));
    out.push(ellAxis(W, V.add(W, V.mul(d, 0.1)), 0.35, [0, 0, 0.03], 0.034, 0.02, 0.022)); // eminencia tenar
    out.push(sphere(W, 0.027));
  } else {
    out.push(ell(V.add(W, V.mul(d, 0.012)), [0.016, 0.014, 0.024]));
  }
  const fingers = [
    [0.028, 0.078],
    [0.0095, 0.085],
    [-0.0095, 0.078],
    [-0.027, 0.064],
  ];
  fingers.forEach(([zo, len], idx) => {
    const base = V.add(V.add(W, V.mul(d, 0.098)), [0, 0, zo]);
    const sp = V.norm(V.add(d, [0, 0, zo * 2.2]));
    const c1 = V.norm(V.add(sp, V.mul(inw, 0.35)));
    const c2 = V.norm(V.add(sp, V.mul(inw, 0.9)));
    const p1 = V.add(base, V.mul(sp, len * 0.42));
    const p2 = V.add(p1, V.mul(c1, len * 0.32));
    const p3 = V.add(p2, V.mul(c2, len * 0.26));
    const rr = idx === 3 ? rF * 0.88 : rF;
    out.push(rc(base, p1, rr, rr * 0.92), rc(p1, p2, rr * 0.92, rr * 0.84), rc(p2, p3, rr * 0.84, rr * 0.7));
    if (!skin) out.push(cap(V.add(W, V.mul(d, 0.012)), base, 0.0052));
  });
  // pulgar
  const tb = V.add(V.add(W, V.mul(d, 0.032)), [0, 0, 0.03]);
  const t1 = V.norm(V.add(V.add(V.mul(d, 0.5), [0, 0, 0.9]), V.mul(inw, 0.2)));
  const t2 = V.norm(V.add(V.add(V.mul(d, 0.85), [0, 0, 0.45]), V.mul(inw, 0.4)));
  const tp1 = V.add(tb, V.mul(t1, 0.046));
  const tp2 = V.add(tp1, V.mul(t2, 0.036));
  const rt = skin ? 0.0115 : 0.0062;
  out.push(rc(tb, tp1, rt, rt * 0.9), rc(tp1, tp2, rt * 0.9, rt * 0.78));
  return out;
}

// ---------------------------------------------------------------- CUERPO
export function makeBody(sex) {
  const F = sex === "female";
  const P = F
    ? {
        scale: 0.935, shW: 0.176, mus: 0.55, pec: 0.4, breast: 1, abs: 0.35, glute: 1.18, thigh: 1.08, armR: 0.86, neck: [0.048, 0.043], legR: 1.0,
        torso: [[0.84, 0.15, 0.095, 0], [0.92, 0.15, 0.095, 0], [0.98, 0.166, 0.1, 0], [1.05, 0.152, 0.093, 0], [1.12, 0.126, 0.082, 0], [1.2, 0.13, 0.084, 0], [1.28, 0.139, 0.089, 0], [1.36, 0.147, 0.092, 0], [1.44, 0.15, 0.086, 0], [1.49, 0.135, 0.078, 0], [1.53, 0.088, 0.064, 0], [1.58, 0.05, 0.05, 0]],
      }
    : {
        scale: 1, shW: 0.203, mus: 1, pec: 1, breast: 0, abs: 1, glute: 1, thigh: 1, armR: 1, neck: [0.052, 0.047], legR: 1,
        torso: [[0.84, 0.15, 0.098, 0], [0.92, 0.15, 0.098, 0], [1.0, 0.152, 0.098, 0], [1.08, 0.146, 0.092, 0], [1.13, 0.141, 0.09, 0], [1.2, 0.149, 0.094, 0], [1.28, 0.164, 0.1, 0], [1.36, 0.179, 0.104, 0], [1.44, 0.186, 0.098, 0], [1.49, 0.17, 0.085, 0], [1.53, 0.1, 0.07, 0], [1.58, 0.058, 0.058, 0]],
      };
  const m = P.mus;
  const torso = loft(P.torso, 1.58, 0.86);
  const sy = (y) => torso.sample(y);
  const S = [P.shW, 1.445, 0];
  const E = V.add(S, [0.095, -0.275, -0.012]);
  const Wr = V.add(E, [0.075, -0.245, 0.03]);
  const T = [0.098, 0.9, 0.0], K = [0.093, 0.5, 0.005], A = [0.088, 0.09, -0.005];

  // --- base (k grande)
  const base = [
    torso,
    ell([0, 0.955, -0.003], [F ? 0.165 : 0.158, 0.115, 0.105]),
    rc(T, K, 0.083 * P.thigh, 0.054),
    rc(K, A, 0.05, 0.031),
    rc(A, [0.088, 0.2, 0.0], 0.035, 0.032),
    ell([0.09, 0.042, 0.052], [0.043, 0.042, 0.118]),
    ell([0.088, 0.058, -0.038], [0.034, 0.052, 0.042]),
    rc(S, E, 0.05 * P.armR, 0.039 * P.armR),
    rc(E, Wr, 0.042 * P.armR, 0.026),
    sphere(S, 0.046 * (F ? 0.9 : 1)),
    rc([0, 1.5, -0.012], [0, 1.625, -0.004], P.neck[0], P.neck[1]),
  ];
  // glúteos
  const glute = ell([0.058, 0.915, -0.076], [0.07 * P.glute, 0.088 * P.glute, 0.062 * P.glute]);
  base.push(glute);
  const baseU = U(base, 0.055);
  const skullU = U([ell([0, 1.696, -0.01], [0.081, 0.106, 0.102]), ell([0, 1.63, 0.02], [0.054, 0.058, 0.07])], 0.035);

  // --- músculos (k medio)
  const mus = [];
  const pecC = F ? 0.4 : 1;
  mus.push(ell([0.09, 1.355, 0.07], [0.09 * pecC + 0.01, 0.062 * (0.5 + pecC * 0.5), 0.05 * pecC + 0.01]));
  mus.push(ell([0.085, 1.4, 0.062], [0.08 * pecC + 0.01, 0.04, 0.04 * pecC + 0.01]));
  if (F) mus.push(ell([0.052, 1.335, 0.067], [0.058 * P.breast, 0.06 * P.breast, 0.054 * P.breast]));
  mus.push(ell([sy(1.16)[0] - 0.026, 1.16, 0.0], [0.03 * m + 0.012, 0.1, 0.07 + 0.008 * m]));
  mus.push(ell([sy(1.29)[0] - 0.055, 1.29, -0.06], [0.055 * m + 0.02, 0.13, 0.045 + 0.005 * m]));
  mus.push(ell([0.032, 1.13, -0.078], [0.032, 0.125, 0.03 * m + 0.01]));
  mus.push(rc([0.04, 1.535, -0.02], [0.165, 1.466, 0.0], 0.014, 0.026));
  mus.push(ell([0.08, 1.468, -0.048], [0.08, 0.032, 0.03 + 0.008 * m]));
  mus.push(ell(V.add(S, [0.012, -0.005, 0.002]), [0.05 * (0.7 + m * 0.3), 0.082, 0.056 * (0.7 + m * 0.3)]));
  mus.push(ellAxis(S, E, 0.5, [0, 0, 0.016], 0.088, 0.036 * m + 0.012, 0.04 * m + 0.008));
  mus.push(ellAxis(S, E, 0.42, [0.004, 0, -0.02], 0.095, 0.036 * m + 0.01, 0.034 * m + 0.01));
  mus.push(ellAxis(E, Wr, 0.24, [0.012, 0, 0.018], 0.11, 0.03 * m + 0.014, 0.03 * m + 0.012));
  mus.push(ellAxis(E, Wr, 0.3, [-0.01, 0, -0.004], 0.115, 0.032 * m + 0.012, 0.034 * m + 0.01));
  mus.push(ellAxis(T, K, 0.46, [0.006, 0, 0.022], 0.19, 0.066 * m + 0.012, 0.058 * m + 0.012));
  mus.push(ellAxis(T, K, 0.46, [0.034, 0, 0.0], 0.18, 0.04 * m + 0.012, 0.056 * m + 0.01));
  mus.push(ellAxis(T, K, 0.32, [-0.034, 0, -0.004], 0.17, 0.042 * m + 0.01, 0.05 * m + 0.01));
  mus.push(ellAxis(T, K, 0.4, [0, 0, -0.034], 0.19, 0.064 * m + 0.01, 0.048 * m + 0.01));
  mus.push(ellAxis(K, A, 0.26, [-0.012, 0, -0.034], 0.125, 0.034 * m + 0.01, 0.04 * m + 0.008));
  mus.push(ellAxis(K, A, 0.28, [0.016, 0, -0.028], 0.115, 0.03 * m + 0.008, 0.034 * m + 0.008));
  mus.push(ellAxis(K, A, 0.22, [0.014, 0, 0.026], 0.12, 0.022, 0.024));
  mus.push(ell([0.095, 0.5, 0.045], [0.026, 0.03, 0.02])); // rótula
  mus.push(ell([0.082, 1.52, 0.035], [0.012, 0.05, 0.016], [[1, 0, 0], [0.25, 0.97, 0], [0, 0, 1]])); // esternocleidomastoideo
  const musU = U(mus, 0.03);

  // --- abdominales (k fino)
  const absList = [];
  [1.255, 1.185, 1.115, 1.045].forEach((y, i) => {
    const zf = sy(y)[1] + sy(y)[2];
    absList.push(ell([0.031, y, zf - 0.013], [0.03, 0.036, 0.016 * P.abs + 0.004]));
    void i;
  });
  const absU = U(absList, 0.006);

  // --- cabeza y detalles (k fino)
  const det = [
    ell([0, 1.6, 0.082], [0.02, 0.018, 0.019]), // mentón
    ell([0.043, 1.666, 0.062], [0.02, 0.019, 0.02]), // pómulo
    rc([0, 1.703, 0.093], [0, 1.664, 0.119], 0.0075, 0.0105), // nariz
    ell([0.015, 1.659, 0.104], [0.009, 0.0095, 0.011]),
    ell([0.032, 1.714, 0.083], [0.032, 0.008, 0.012]), // ceja
    ell([0.048, 1.628, -0.006], [0.014, 0.022, 0.024]), // ángulo mandibular
    ell([0.081, 1.685, -0.012], [0.0075, 0.03, 0.02]), // oreja
    ell([0, 1.627, 0.093], [0.023, 0.007, 0.014]), // labio superior
    ell([0, 1.613, 0.091], [0.021, 0.008, 0.015]), // labio inferior
    ell([0, 1.652, 0.074], [0.024, 0.03, 0.026]), // región maxilar
  ];
  const detU = U(det, 0.014);
  const carve = ell([EYE.x, EYE.y, EYE.z + 0.012], [0.02, 0.0095, 0.015]);
  const eyeBulge = ell([EYE.x, EYE.y + 0.003, EYE.z - 0.003], [0.024, 0.018, 0.02]);

  // --- manos y pies (k fino)
  const hands = U(handPrims(Wr, [0.2, -1, 0.12], "skin"), 0.006);
  const toes = [];
  for (let i = 0; i < 5; i++) {
    const x = 0.07 + i * 0.0115;
    const r = i === 0 ? 0.0115 : 0.0085 - i * 0.0004;
    const z0 = 0.15, z1 = i === 0 ? 0.205 : 0.19 - i * 0.012;
    toes.push(cap([x, 0.0125, z0], [x, 0.0115, z1], r));
  }
  const feet = U(toes, 0.006);

  const side = (x, y, z) => {
    let d = smin(baseU(x, y, z), skullU(x, y, z), 0.014);
    d = smin(d, musU(x, y, z), 0.03);
    d = smin(d, absU(x, y, z), 0.02);
    d = smin(d, detU(x, y, z), 0.012);
    d = smin(d, hands(x, y, z), 0.014);
    d = smin(d, feet(x, y, z), 0.012);
    return d;
  };
  const pair = mirror(side);
  const nose = (x, y, z) => smin(pair(x, y, z), eyeBulge(Math.abs(x), y, z), 0.012);
  const sdf = (x, y, z) => {
    let d = nose(x, y, z);
    d = smax(d, -carve(Math.abs(x), y, z), 0.005);
    return d;
  };
  const s = P.scale;
  const scaled = (x, y, z) => sdf(x / s, y / s, z / s) * s;
  scaled.scale = s;
  return scaled;
}

// ---------------------------------------------------------------- PELO
export function makeHair(sex) {
  const F = sex === "female";
  const t = F ? 0.014 : 0.0115;
  const capE = ell([0, 1.7, -0.012], [0.081 + t, 0.108 + t, 0.102 + t]);
  const hl = (x, y, z) => ((z > 0 ? 1.7 + 0.5 * z : 1.7 + 0.95 * z) - y) * 0.9 + (Math.abs(x) > 0.065 ? -(Math.abs(x) - 0.065) * 0.5 : 0);
  const parts = [capE];
  if (F) {
    parts.push(ell([0, 1.57, -0.098], [0.094, 0.17, 0.05]));
    parts.push(ell([0, 1.72, -0.02], [0.092, 0.095, 0.105]));
  } else {
    parts.push(ell([0, 1.745, 0.0], [0.082, 0.065, 0.1])); // volumen superior
  }
  const hu = U(parts, 0.03);
  const f = (x, y, z) => smax(hu(x, y, z), hl(x, y, z), 0.012);
  const s = F ? 0.935 : 1;
  const scaled = (x, y, z) => f(x / s, y / s, z / s) * s;
  return scaled;
}

// ---------------------------------------------------------------- ESQUELETO (en escala masculina)
const SPINE_Z = [[1.62, 0.005], [1.53, -0.022], [1.42, -0.045], [1.3, -0.052], [1.18, -0.04], [1.06, -0.03], [0.96, -0.05]];
export const spineZ = (y) => {
  if (y >= SPINE_Z[0][0]) return SPINE_Z[0][1];
  for (let i = 0; i < SPINE_Z.length - 1; i++) {
    const [y0, z0] = SPINE_Z[i], [y1, z1] = SPINE_Z[i + 1];
    if (y <= y0 && y >= y1) { const t = (y0 - y) / (y0 - y1); return z0 + (z1 - z0) * (t * t * (3 - 2 * t)); }
  }
  return SPINE_Z[SPINE_Z.length - 1][1];
};

export function makeSkeleton() {
  const central = [];
  const paired = [];
  // cráneo
  const skull = [
    ell([0, 1.7, -0.006], [0.071, 0.087, 0.091]),
    ell([0, 1.66, 0.048], [0.05, 0.042, 0.045]),
    ell([0.052, 1.667, 0.052], [0.014, 0.012, 0.014]),
    ell([0.065, 1.69, -0.01], [0.01, 0.03, 0.04]),
  ];
  const skullU = U(skull, 0.02);
  const jaw = U([rc([0.066, 1.655, -0.012], [0.05, 1.615, 0.04], 0.0075, 0.008), rc([0.05, 1.615, 0.04], [0.0, 1.606, 0.074], 0.008, 0.011), rc([0.066, 1.655, -0.012], [0.062, 1.625, -0.012], 0.01, 0.009)], 0.01);
  const teethU = ell([0, 1.632, 0.062], [0.032, 0.007, 0.02]);
  const teethL = ell([0, 1.617, 0.06], [0.03, 0.007, 0.02]);
  const orbit = ell([0.03, 1.685, 0.074], [0.017, 0.015, 0.02]);
  const nasal = ell([0.0, 1.655, 0.088], [0.009, 0.016, 0.02]);
  const head = (x, y, z) => {
    let d = smin(skullU(Math.abs(x), y, z), jaw(Math.abs(x), y, z), 0.008);
    d = smin(d, teethU(x, y, z), 0.004);
    d = smin(d, teethL(x, y, z), 0.004);
    d = smax(d, -orbit(Math.abs(x), y, z), 0.006);
    d = smax(d, -nasal(x, y, z), 0.004);
    return d;
  };
  central.push(head);

  // columna
  const vert = [];
  const addV = (y, w, hh) => {
    const z = spineZ(y);
    vert.push(ell([0, y, z], [w, hh, w * 0.78]));
    vert.push(cap([0, y + 0.003, z - w * 0.7], [0, y - 0.012, z - w * 0.7 - 0.028], 0.0055));
    vert.push(cap([0, y, z - w * 0.5], [0.04 + w, y + 0.002, z - w * 0.9 - 0.012], 0.0045));
    vert.push(cap([0, y, z - w * 0.5], [-0.04 - w, y + 0.002, z - w * 0.9 - 0.012], 0.0045));
  };
  for (let i = 0; i < 7; i++) addV(1.605 - i * 0.0133, 0.0125 + i * 0.0006, 0.0055);
  for (let i = 0; i < 12; i++) addV(1.505 - i * 0.0245, 0.0165 + i * 0.0006, 0.0098);
  for (let i = 0; i < 5; i++) addV(1.21 - i * 0.03, 0.022 + i * 0.001, 0.0125);
  vert.push(ell([0, 0.985, spineZ(1.0) - 0.02], [0.044, 0.07, 0.024], [[1, 0, 0], [0, 0.96, -0.28], [0, 0.28, 0.96]]));
  vert.push(cap([0, 0.925, -0.075], [0, 0.88, -0.062], 0.008));
  const spine = U(vert, 0.003);
  central.push(spine);

  // esternón
  central.push(U([rc([0, 1.508, 0.046], [0, 1.4, 0.092], 0.011, 0.012), rc([0, 1.4, 0.092], [0, 1.31, 0.087], 0.012, 0.007)], 0.004));

  // costillas
  const ribA = [0.062, 0.088, 0.11, 0.126, 0.139, 0.148, 0.153, 0.153, 0.149, 0.141, 0.13, 0.12];
  const ribB = [0.04, 0.055, 0.067, 0.074, 0.078, 0.08, 0.08, 0.078, 0.075, 0.07, 0.062, 0.055];
  const ribs = [];
  for (let i = 0; i < 12; i++) {
    const yb = 1.505 - 0.0245 * i;
    const A = ribA[i], B = ribB[i];
    const zc = spineZ(yb) + B * 0.82;
    const drop = Math.min(0.045 + 0.012 * i, 0.125);
    const end = i < 7 ? 0.9 : i < 10 ? 0.86 : 0.5;
    const pts = [];
    const n = 18;
    for (let s = 0; s <= n; s++) {
      const phi = (s / n) * end * Math.PI;
      pts.push([A * Math.sin(phi) + 0.014, yb - drop * Math.pow(Math.sin(phi / 2), 2), zc - B * Math.cos(phi)]);
    }
    if (i < 10) {
      const last = pts[pts.length - 1];
      pts.push([0.014, last[1] - 0.01, zc + B * 1.0]);
    }
    const w = i < 2 ? 0.0065 : 0.0058;
    for (let s = 0; s < pts.length - 1; s++) ribs.push(rc(pts[s], pts[s + 1], w, w));
  }
  paired.push(U(ribs, 0.002));

  // clavícula + escápula
  paired.push(U([rc([0.014, 1.505, 0.05], [0.09, 1.52, 0.046], 0.009, 0.0075), rc([0.09, 1.52, 0.046], [0.175, 1.497, -0.005], 0.0075, 0.009)], 0.004));
  paired.push(ell([0.1, 1.395, -0.087], [0.058, 0.075, 0.009], [[0.94, 0.0, -0.34], [0, 1, 0], [0.34, 0, 0.94]]));
  paired.push(rc([0.07, 1.455, -0.1], [0.185, 1.485, -0.025], 0.008, 0.012));

  // pelvis
  const pel = [];
  pel.push(ell([0.115, 1.0, -0.02], [0.02, 0.066, 0.09], [[0.9, 0, -0.43], [0, 1, 0], [0.43, 0, 0.9]]));
  pel.push(rc([0.02, 0.87, 0.074], [0.072, 0.875, 0.04], 0.009, 0.011));
  pel.push(rc([0.072, 0.875, 0.04], [0.08, 0.86, -0.03], 0.011, 0.016));
  pel.push(ell([0.075, 0.875, -0.045], [0.02, 0.025, 0.025]));
  pel.push(ell([0.04, 0.98, -0.075], [0.03, 0.06, 0.02]));
  pel.push(sphere([0.087, 0.91, 0.002], 0.03));
  paired.push(U(pel, 0.01));

  // pierna
  const leg = [];
  leg.push(sphere([0.087, 0.906, 0.0], 0.0245));
  leg.push(cap([0.087, 0.906, 0.0], [0.126, 0.872, -0.008], 0.0145));
  leg.push(rc([0.12, 0.868, 0.0], [0.096, 0.505, 0.012], 0.0175, 0.0165));
  leg.push(ell([0.096, 0.488, 0.0], [0.047, 0.03, 0.036]));
  leg.push(ell([0.095, 0.5, 0.047], [0.021, 0.026, 0.01])); // rótula
  leg.push(ell([0.092, 0.47, 0.006], [0.042, 0.012, 0.034]));
  leg.push(rc([0.091, 0.465, 0.012], [0.088, 0.1, -0.004], 0.0165, 0.0125));
  leg.push(ell([0.074, 0.07, -0.005], [0.012, 0.022, 0.014]));
  leg.push(rc([0.126, 0.465, -0.004], [0.116, 0.078, -0.02], 0.0075, 0.009));
  leg.push(ell([0.09, 0.052, -0.032], [0.026, 0.026, 0.042]));
  leg.push(ell([0.09, 0.036, 0.03], [0.032, 0.02, 0.04]));
  for (let i = 0; i < 5; i++) {
    const x = 0.074 + i * 0.0105;
    leg.push(cap([x, 0.034, 0.05], [x, 0.016, 0.135], 0.0058));
    leg.push(cap([x, 0.014, 0.138], [x, 0.011, 0.182 - i * 0.009], 0.0048));
  }
  paired.push(U(leg, 0.004));

  // brazo
  const S = [0.203, 1.445, 0];
  const E = V.add(S, [0.095, -0.275, -0.012]);
  const Wr = V.add(E, [0.075, -0.245, 0.03]);
  const arm = [];
  arm.push(sphere(V.add(S, [-0.012, -0.004, 0]), 0.022));
  arm.push(rc(V.add(S, [-0.008, -0.01, 0]), V.add(E, [0, 0.005, 0]), 0.0135, 0.0125));
  arm.push(ell(E, [0.024, 0.02, 0.022]));
  arm.push(rc(V.add(E, [0.0, -0.008, -0.012]), V.add(Wr, [-0.004, 0.0, -0.016]), 0.0095, 0.0075));
  arm.push(rc(V.add(E, [0.006, -0.008, 0.012]), V.add(Wr, [0.004, 0.0, 0.01]), 0.0075, 0.011));
  arm.push(...handPrims(Wr, [0.2, -1, 0.12], "bone"));
  paired.push(U(arm, 0.004));

  const all = U(paired, 0.01);
  const sdf = (x, y, z) => {
    let d = all(Math.abs(x), y, z);
    for (const c of central) d = Math.min(d, c(x, y, z));
    return d;
  };
  return sdf;
}
