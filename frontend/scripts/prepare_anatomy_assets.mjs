/**
 * Download the pinned Open Anatomy model files at build time so the dashboard
 * serves them from the same origin instead of depending on a viewer CDN request.
 * The versioned npm URL is immutable; validate each GLB header and declared size.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(base, "public", "models");
const root = "https://cdn.jsdelivr.net/npm/open-anatomy-3d@0.1.0/models/";
const assets = [
  { path: "anatomy-male.glb", min: 6_000_000, max: 10_000_000 },
  { path: "anatomy-female.glb", min: 6_000_000, max: 10_000_000 },
];

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function validModel(bytes, item) {
  return bytes.length >= item.min
    && bytes.length <= item.max
    && bytes.toString("ascii", 0, 4) === "glTF"
    && bytes.readUInt32LE(4) === 2
    && bytes.readUInt32LE(8) === bytes.length;
}

async function fetchModel(item) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(root + item.path, {
        signal: AbortSignal.timeout(60_000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!validModel(bytes, item)) throw new Error("Invalid GLB payload");
      return bytes;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("Open Anatomy model unavailable (" + item.path + "): " + lastError);
}

for (const item of assets) {
  const destination = join(target, item.path);
  try {
    const cached = await readFile(destination);
    if (validModel(cached, item)) {
      process.stdout.write("verified cached " + item.path + "\n");
      continue;
    }
  } catch { /* download missing or incomplete model */ }

  const bytes = await fetchModel(item);
  await mkdir(dirname(destination), { recursive: true });
  const temp = destination + ".tmp";
  await writeFile(temp, bytes);
  await rename(temp, destination);
  process.stdout.write(
    "verified downloaded " + item.path + " sha256:" + digest(bytes) + "\n",
  );
}
