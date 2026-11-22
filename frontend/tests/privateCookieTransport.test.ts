import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cookieAccessRequest, parseCookieAccess, privateCookieAuthEnabled, refreshCookieOnce,
  waitForPendingCookieRefresh,
} from "../src/services/api/cookieSession";
import {
  registerPrivateSessionRefresh, tryRefreshPrivateSession,
} from "../src/services/api/sessionInvalidation";

const org = "10000000-0000-4000-8000-000000000001";
const user = "a1000000-0000-4000-8000-000000000001";
const token = `${"a".repeat(50)}.${"b".repeat(50)}.${"c".repeat(50)}`;

beforeEach(() => {
  vi.stubEnv("VITE_ENABLE_PRIVATE_AUTH", "true");
  vi.stubEnv("VITE_PRIVATE_COOKIE_AUTH", "true");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("opt-in private cookie transport", () => {
  it("does not work in public demo or unless the second flag is explicit", async () => {
    vi.stubEnv("VITE_PRIVATE_COOKIE_AUTH", "false");
    expect(privateCookieAuthEnabled()).toBe(false);
    await expect(cookieAccessRequest("refresh")).rejects.toThrow("deshabilitado");
  });

  it("deduplicates in-flight refresh requests to avoid cookie replay", async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(success => { resolve = success; }));
    vi.stubGlobal("fetch", fetcher);
    const first = refreshCookieOnce();
    const second = refreshCookieOnce();
    expect(first).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify({
      access_token: token, token_type: "Bearer", organization_id: org,
      user_id: user, role: "member", expires_at: new Date(Date.now() + 600000).toISOString(),
    }), { status: 200 }));
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    const decoded = parseCookieAccess(await a.json());
    expect(decoded).toMatchObject({ kind: "cookie", token, organization_id: org });
    expect((fetcher.mock.calls[0] as unknown[])[0]).toBe("/api/v1/auth/access/refresh");
  });

  it("does not let logout race an unfinished rotation response", async () => {
    let release!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { release = done; }));
    vi.stubGlobal("fetch", fetcher);
    const rotation = refreshCookieOnce();
    const waitForRotation = waitForPendingCookieRefresh();
    let finished = false;
    void waitForRotation.then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release(new Response(null, { status: 401 }));
    await rotation;
    await waitForRotation;
    expect(finished).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects expired and malformed JWT responses", () => {
    const good = {
      access_token: token, token_type: "Bearer", organization_id: org,
      user_id: user, role: "member", expires_at: new Date(Date.now() + 600000).toISOString(),
    };
    expect(() => parseCookieAccess({ ...good, expires_at: "2020-01-01T00:00:00Z" }))
      .toThrow("token de acceso válido");
    expect(() => parseCookieAccess({ ...good, organization_id: "forged-org" }))
      .toThrow("token de acceso válido");
    expect(() => parseCookieAccess({ ...good, token_type: "Cookie" }))
      .toThrow("token de acceso válido");
  });

  it("coalesces simultaneous 401 refresh callbacks without persisting tokens", async () => {
    const callback = vi.fn(async () => token + "-rotated");
    const unregister = registerPrivateSessionRefresh(callback);
    try {
      const [a, b, c] = await Promise.all([
        tryRefreshPrivateSession(token),
        tryRefreshPrivateSession(token),
        tryRefreshPrivateSession(token),
      ]);
      expect(a).toBe(token + "-rotated");
      expect(b).toBe(a);
      expect(c).toBe(a);
      expect(callback).toHaveBeenCalledTimes(1);
    } finally {
      unregister();
    }
    expect(await tryRefreshPrivateSession(token)).toBeNull();
  });
});
