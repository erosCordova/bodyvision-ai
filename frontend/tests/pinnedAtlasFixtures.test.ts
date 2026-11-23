import { describe, expect, it, vi } from "vitest";
import {
  FIXTURE_RETRY_DELAYS_MS,
  MAX_FIXTURE_BYTES,
  PINNED_ATLAS_FIXTURES,
  fetchVerifiedGitBlob,
  gitBlobSha1,
  loadPinnedAtlasFixture,
} from "./helpers/pinnedAtlasFixtures";

const TEST_URL = "https://example.invalid/immutable/fake.glb";
const original = Buffer.from("synthetic atlas test bytes only");
const digest = gitBlobSha1(original);

function goodResponse(body = original): Response {
  return new Response(body.toString("utf8"), {
    status: 200,
    headers: { "content-length": String(body.length) },
  });
}

describe("F6 immutable GLB and catalogue fixture acquisition", () => {
  it("preserves the four approved immutable model/catalogue SHA-1 blobs", () => {
    expect(PINNED_ATLAS_FIXTURES).toEqual({
      "web/public/models/skin.glb": "1000d249050112ea014651647d3145e0bde127f8",
      "content/skin.json": "11dd0832e7ea3106559e78aab17f4c184b6e7dfc",
      "web/public/models/skeleton.glb": "89c8d305f3727f31688abcfda2860d2b6d628832",
      "content/skeleton.json": "dcd86e3be0891da8f5fc747ede03a79aa7c1e688",
    });
    expect(gitBlobSha1(original)).toBe(digest);
  });

  it("accepts verified bytes and never retries an intact first response", async () => {
    const request = vi.fn(async (_url: string) => goodResponse());
    const delay = vi.fn(async (_ms: number) => undefined);
    await expect(fetchVerifiedGitBlob(TEST_URL, digest, { request, delay }))
      .resolves.toEqual(original);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(TEST_URL);
    expect(delay).not.toHaveBeenCalled();
  });

  it("recovers from a transient 404, 503 and network failure without replacing the hash", async () => {
    let attempts = 0;
    const request = vi.fn(async () => {
      attempts++;
      if (attempts === 1) return new Response("transient missing", { status: 404 });
      if (attempts === 2) return new Response("temporary rate limit", { status: 503 });
      if (attempts === 3) throw new TypeError("fictional network failure");
      return goodResponse();
    });
    const delay = vi.fn(async (_ms: number) => undefined);
    await expect(fetchVerifiedGitBlob(TEST_URL, digest, { request, delay }))
      .resolves.toEqual(original);
    expect(request).toHaveBeenCalledTimes(4);
    expect(delay.mock.calls.map(([ms]) => ms)).toEqual([...FIXTURE_RETRY_DELAYS_MS]);
  });

  it("fails after four responses without downloading or logging the HTML error page", async () => {
    const request = vi.fn(async () => new Response("private error text", { status: 404 }));
    const delay = vi.fn(async (_ms: number) => undefined);
    await expect(fetchVerifiedGitBlob(TEST_URL, digest, { request, delay }))
      .rejects.toThrow(/reintentos limitados/);
    expect(request).toHaveBeenCalledTimes(4);
    expect(delay).toHaveBeenCalledTimes(3);
  });

  it("accepts verified bytes after transparent transport decompression", async () => {
    const request = vi.fn(async () => new Response(original.toString("utf8"), {
      status: 200,
      headers: { "content-length": "5", "content-encoding": "gzip" },
    }));
    await expect(fetchVerifiedGitBlob(TEST_URL, digest, { request }))
      .resolves.toEqual(original);
  });

  it("rejects tampered bytes immediately, with no retry or content in the error", async () => {
    const request = vi.fn(async () => goodResponse(Buffer.from("altered synthetic bytes")));
    const delay = vi.fn(async (_ms: number) => undefined);
    await expect(fetchVerifiedGitBlob(TEST_URL, digest, { request, delay }))
      .rejects.toThrow(/integridad/);
    expect(request).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it("rejects declared huge files, truncated bodies and missing response bytes", async () => {
    const responses = [
      new Response(original.toString("utf8"), { status: 200, headers: {
        "content-length": String(MAX_FIXTURE_BYTES + 1),
      } }),
      new Response("truncated synthetic bytes", { status: 200, headers: { "content-length": "999" } }),
      new Response(null, { status: 200 }),
    ];
    for (const response of responses) {
      const request = vi.fn(async () => response);
      const delay = vi.fn(async (_ms: number) => undefined);
      await expect(fetchVerifiedGitBlob(TEST_URL, digest, { request, delay }))
        .rejects.toThrow(/integridad/);
      expect(request).toHaveBeenCalledTimes(1);
      expect(delay).not.toHaveBeenCalled();
    }
  });

  it("rejects unexpected atlas paths before any network request", async () => {
    const request = vi.fn(async () => goodResponse());
    await expect(loadPinnedAtlasFixture("content/other.json" as "content/skin.json", {
      request,
    })).rejects.toThrow(/no autorizado/);
    expect(request).not.toHaveBeenCalled();
  });
});
