/**
 * Reproducibly copy the version-pinned MediaPipe runtime + Lite task into
 * frontend/public/pose. Fail closed if the official bytes drift.
 * --inspect is for initial hash discovery in an ephemeral CI environment only.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(base, "public", "pose");
const sdk = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/";
const model = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const assets = [
  { path: "vision_bundle.mjs", source: sdk + "vision_bundle.mjs", min: 100000, max: 3000000, sha256: "" },
  { path: "wasm/vision_wasm_internal.js", source: sdk + "wasm/vision_wasm_internal.js", min: 10000, max: 1000000, sha256: "" },
  { path: "wasm/vision_wasm_internal.wasm", source: sdk + "wasm/vision_wasm_internal.wasm", min: 1000000, max: 20000000, sha256: "" },
  { path: "wasm/vision_wasm_nosimd_internal.js", source: sdk + "wasm/vision_wasm_nosimd_internal.js", min: 10000, max: 1000000, sha256: "" },
  { path: "wasm/vision_wasm_nosimd_internal.wasm", source: sdk + "wasm/vision_wasm_nosimd_internal.wasm", min: 1000000, max: 20000000, sha256: "" },
  { path: "pose_landmarker_lite.task", source: model, min: 1000000, max: 12000000, sha256: "" },
];
const inspectOnly = process.argv.includes("--inspect");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fetchVerified(item) {
  let lastError;
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      const response = await fetch(item.source, {
        signal: AbortSignal.timeout(60000), redirect: "error",
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < item.min || bytes.length > item.max)
        throw new Error("Unexpected asset size: " + bytes.length);
      const digest = sha256(bytes);
      if (inspectOnly) {
        process.stdout.write(item.path + " " + bytes.length + " sha256:" + digest + "\n");
      } else if (!item.sha256 || item.sha256 !== digest) {
        throw new Error("SHA-256 mismatch for " + item.path + ": downloaded " + digest);
      }
      return bytes;
    } catch (error) {
      lastError = error;
      if (!inspectOnly && String(error).includes("SHA-256 mismatch")) break;
    }
  }
  throw new Error("MediaPipe asset unavailable or changed (" + item.path + "): " + lastError);
}

for (const item of assets) {
  const destination = join(target, item.path);
  if (!inspectOnly) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error("Missing pinned digest " + item.path);
    try {
      if (sha256(await readFile(destination)) === item.sha256) {
        process.stdout.write("verified cached " + item.path + "\n");
        continue;
      }
    } catch { /* no cached asset */ }
  }
  const bytes = await fetchVerified(item);
  if (!inspectOnly) {
    await mkdir(dirname(destination), { recursive: true });
    const temp = destination + ".tmp";
    await writeFile(temp, bytes);
    await rename(temp, destination);
    process.stdout.write("verified downloaded " + item.path + "\n");
  }
}
