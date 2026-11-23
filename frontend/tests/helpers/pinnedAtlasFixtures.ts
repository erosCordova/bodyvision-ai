/** Read-only, immutable third-party fixtures for browser acceptance tests only.
 * Never changes the selected anatomical model, its catalogue, or app runtime.
 */
import { createHash } from "node:crypto";
import { anatomySource } from "../../src/features/viewer/atlasSource";

export const PINNED_ATLAS_FIXTURES = {
  "web/public/models/skin.glb": "1000d249050112ea014651647d3145e0bde127f8",
  "content/skin.json": "11dd0832e7ea3106559e78aab17f4c184b6e7dfc",
  "web/public/models/skeleton.glb": "89c8d305f3727f31688abcfda2860d2b6d628832",
  "content/skeleton.json": "dcd86e3be0891da8f5fc747ede03a79aa7c1e688",
} as const;

export const MAX_FIXTURE_BYTES = 128 * 1024 * 1024;
export const FIXTURE_RETRY_DELAYS_MS = [400, 1200, 2500] as const;
const REQUEST_TIMEOUT_MS = 18_000;

type RequestAsset = (url: string, init: { signal: AbortSignal }) => Promise<Response>;
type Delay = (milliseconds: number) => Promise<void>;

class IntegrityFailure extends Error {}

export function gitBlobSha1(body: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${body.byteLength}\0`)
    .update(body)
    .digest("hex");
}

async function boundedBody(response: Response): Promise<Buffer> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_FIXTURE_BYTES)) {
    throw new IntegrityFailure("Invalid asset size");
  }
  if (!response.body) throw new IntegrityFailure("Missing asset body");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FIXTURE_BYTES) throw new IntegrityFailure("Asset exceeds limit");
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (!size || (declared !== null && Number(declared) !== size)) {
    // GitHub raw sometimes supplies a transfer-specific content-length;
    // if it does, its advertised byte count must agree with the body.
    throw new IntegrityFailure("Incomplete asset");
  }
  return Buffer.concat(chunks, size);
}

/** Retry transient HTTP/network failure, but NEVER retry or accept a bad hash.
 * No fixture bytes, response body, URL credentials or raw transport details
 * are logged, even after exhaustion.
 */
export async function fetchVerifiedGitBlob(
  url: string,
  expectedGitBlobSha1: string,
  options: { request?: RequestAsset; delay?: Delay } = {},
): Promise<Buffer> {
  if (!/^[0-9a-f]{40}$/.test(expectedGitBlobSha1)) {
    throw new IntegrityFailure("Invalid pinned Git blob digest");
  }
  const request = options.request ?? ((input, init) => fetch(input, init));
  const delay = options.delay ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt <= FIXTURE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await request(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("Remote fixture temporarily unavailable");
      }
      const body = await boundedBody(response);
      if (gitBlobSha1(body) !== expectedGitBlobSha1) {
        throw new IntegrityFailure("Pinned fixture digest mismatch");
      }
      return body;
    } catch (error) {
      if (error instanceof IntegrityFailure) {
        throw new Error("La integridad del recurso anatómico de prueba no coincide.");
      }
      if (attempt >= FIXTURE_RETRY_DELAYS_MS.length) {
        throw new Error("No se pudo obtener el recurso anatómico de prueba tras reintentos limitados.");
      }
      await delay(FIXTURE_RETRY_DELAYS_MS[attempt]);
    }
  }
  throw new Error("El recurso anatómico de prueba no está disponible.");
}

export async function loadPinnedAtlasFixture(
  path: keyof typeof PINNED_ATLAS_FIXTURES,
  options: { request?: RequestAsset; delay?: Delay } = {},
): Promise<Buffer> {
  const digest = PINNED_ATLAS_FIXTURES[path];
  if (!digest) throw new Error("Recurso anatómico no autorizado para las pruebas.");
  return fetchVerifiedGitBlob(anatomySource + path, digest, options);
}
