import { afterEach, describe, expect, it, vi } from "vitest";
import { syntheticCapturesApi } from "../src/services/api/syntheticCaptures";
import { poseSummariesApi } from "../src/services/api/poseSummaries";
import { withPrivateSession } from "../src/services/api/privateSessionRequest";
import { onPrivateSessionInvalidated, registerPrivateSessionRefresh } from "../src/services/api/sessionInvalidation";

const A = "a".repeat(48), B = "b".repeat(48);
const PROFILE = "10000000-0000-4000-8000-000000000001";
const ID = "20000000-0000-4000-8000-000000000002";
const capture = {
  id: ID, profile_id: PROFILE, created_by: ID, format: "image/png", original_bytes: 80,
  width: 20, height: 30, sha256_digest: "0".repeat(64), created_at: "2026-11-22T10:00:00Z",
  expires_at: "2026-11-29T10:00:00Z", data_type: "SIMULADO",
};
const draft = { model_revision: "pose_landmarker_lite/float16/1", detected: false,
  threshold: .5, visible_points: 0, core_visible: 0,
  quality_state: "not-detected" as const, capture_passed: false };
const pose = { ...draft, id: ID, profile_id: PROFILE, created_by: ID,
  created_at: "2026-11-22T10:00:00Z", algorithm_revision: "pose-review-summary-v1",
  summary_sha256: "0".repeat(64), origin: "client_reported_browser", data_type: "DERIVADO", synthetic: true };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("private captures and pose after access renewal", () => {
  it("replays the identical PNG Blob only after a rejected bearer and keeps synthetic headers", async () => {
    const stop = registerPrivateSessionRefresh(async () => B);
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(capture, 201));
    vi.stubGlobal("fetch", fetcher);
    const png = new Blob([new Uint8Array(80)], { type: "image/png" });
    try {
      expect(await syntheticCapturesApi(A, PROFILE).create(png)).toEqual(capture);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const [first, next] = fetcher.mock.calls.map(call => call[1] as RequestInit);
      expect(first.body).toBe(png); expect(next.body).toBe(png);
      expect(next).toMatchObject({ method: "POST", cache: "no-store", credentials: "same-origin" });
      expect(next.headers).toEqual({ Authorization: `Bearer ${B}`, "Content-Type": "image/png", "X-Synthetic-Only": "confirmed" });
      expect(next.headers).not.toHaveProperty("X-Workspace-ID");
    } finally { stop(); }
  });

  it.each(["list", "download", "remove", "purgeExpired"] as const)("renews the capture %s operation without changing its target", async operation => {
    const stop = registerPrivateSessionRefresh(async () => B);
    const final = operation === "list" ? json({ items: [capture], total: 1 })
      : operation === "download" ? new Response("synthetic bytes", { headers: { "Content-Type": "image/png" } })
      : operation === "remove" ? new Response(null, { status: 204 })
      : json({ deleted: 0, batch_limit: 100, limit_reached: false });
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(final);
    vi.stubGlobal("fetch", fetcher);
    try {
      const api = syntheticCapturesApi(A, PROFILE);
      if (operation === "list") expect((await api.list()).total).toBe(1);
      if (operation === "download") {
        const file = await api.download(ID);
        expect(file.type).toBe("image/png");
        const contents = await new Promise(resolve => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(file);
        });
        expect(contents).toBe("synthetic bytes");
      }
      if (operation === "remove") await api.remove(ID);
      if (operation === "purgeExpired") expect((await api.purgeExpired()).deleted).toBe(0);
      expect(fetcher.mock.calls[0][0]).toBe(fetcher.mock.calls[1][0]);
      expect((fetcher.mock.calls[1][1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${B}` });
    } finally { stop(); }
  });

  it("retains the pose idempotency key and minimal payload across renewal", async () => {
    const stop = registerPrivateSessionRefresh(async () => B);
    const fetcher = vi.fn().mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json(pose, 201));
    vi.stubGlobal("fetch", fetcher);
    try {
      const result = await poseSummariesApi(A, PROFILE).save({ ...draft, photo: "never sent" } as typeof draft, ID);
      expect(result.id).toBe(ID);
      const [first, second] = fetcher.mock.calls.map(call => call[1] as RequestInit);
      expect(second.body).toBe(first.body);
      expect(JSON.parse(second.body as string)).toEqual({ ...draft, synthetic_confirmed: true });
      expect(second.headers).toMatchObject({ Authorization: `Bearer ${B}`, "Idempotency-Key": ID });
    } finally { stop(); }
  });

  it("cancels one pose query while another capture query completes the same renewal", async () => {
    let release!: (value: string) => void;
    const refresh = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const stop = registerPrivateSessionRefresh(refresh);
    const invalidated = vi.fn(), unsubscribe = onPrivateSessionInvalidated(invalidated);
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) =>
      (init?.headers as Record<string, string>).Authorization === `Bearer ${A}`
        ? json({}, 401) : json({ items: [], total: 0 }));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    try {
      const cancelled = poseSummariesApi(A, PROFILE).list(0, controller.signal).catch(error => error);
      const continuing = syntheticCapturesApi(A, PROFILE).list();
      await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
      controller.abort();
      expect(await cancelled).toMatchObject({ name: "AbortError" });
      release(B);
      expect(await continuing).toEqual({ items: [], total: 0 });
      expect(fetcher.mock.calls.filter(([url]) => url.includes("pose-summaries"))).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(3); expect(invalidated).not.toHaveBeenCalled();
    } finally { stop(); unsubscribe(); }
  });

  it("applies the seven-second pose budget while waiting for shared renewal", async () => {
    vi.useFakeTimers();
    let release!: (value: string) => void;
    const stop = registerPrivateSessionRefresh(() => new Promise<string>(resolve => { release = resolve; }));
    const fetcher = vi.fn().mockResolvedValue(json({}, 401)); vi.stubGlobal("fetch", fetcher);
    try {
      const request = poseSummariesApi(A, PROFILE).list().catch(error => error);
      await vi.advanceTimersByTimeAsync(7000);
      expect(await request).toMatchObject({ name: "AbortError" });
      release(B); await vi.advanceTimersByTimeAsync(0);
      expect(fetcher).toHaveBeenCalledOnce();
    } finally { stop(); }
  });

  it("does not start a request or rotation when cancellation already occurred", async () => {
    const refresh = vi.fn(), stop = registerPrivateSessionRefresh(refresh);
    const send = vi.fn(); const controller = new AbortController(); controller.abort();
    try {
      await expect(withPrivateSession(A, send, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(send).not.toHaveBeenCalled(); expect(refresh).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it.each([403, 409, 500])("never replays a mutation after HTTP %i", async status => {
    const refresh = vi.fn(), stop = registerPrivateSessionRefresh(refresh);
    const fetcher = vi.fn().mockResolvedValue(json({}, status)); vi.stubGlobal("fetch", fetcher);
    try {
      await expect(poseSummariesApi(A, PROFILE).save(draft, ID)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it("never retries an ambiguous network failure while uploading", async () => {
    const refresh = vi.fn(), stop = registerPrivateSessionRefresh(refresh);
    const fetcher = vi.fn().mockRejectedValue(new TypeError("Network unavailable")); vi.stubGlobal("fetch", fetcher);
    try {
      await expect(syntheticCapturesApi(A, PROFILE).create(new Blob(["PNG"]))).rejects.toThrow("Network unavailable");
      expect(fetcher).toHaveBeenCalledOnce(); expect(refresh).not.toHaveBeenCalled();
    } finally { stop(); }
  });

  it("invalidates the rejected successor once and does not loop", async () => {
    const stop = registerPrivateSessionRefresh(async () => B);
    const invalidated = vi.fn(), unsubscribe = onPrivateSessionInvalidated(invalidated);
    const fetcher = vi.fn().mockResolvedValue(json({}, 401)); vi.stubGlobal("fetch", fetcher);
    try {
      await expect(syntheticCapturesApi(A, PROFILE).list()).rejects.toThrow("expiró");
      expect(fetcher).toHaveBeenCalledTimes(2); expect(invalidated).toHaveBeenCalledExactlyOnceWith(B);
    } finally { stop(); unsubscribe(); }
  });
});
