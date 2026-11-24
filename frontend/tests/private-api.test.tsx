import { describe, expect, it, vi } from "vitest";
import { recordsApi } from "../src/services/api/records";

const org = "10000000-0000-4000-8000-000000000001";
const token = "t".repeat(48);
const payload = {
  items: [{ id: org, name: "Centro ficticio" }],
  synthetic: true,
  notice: "Datos ficticios",
  read_only: false,
};

describe("the private API never sends an untrusted workspace selector", () => {
  it("uses only a server-verified bearer token for private requests", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await recordsApi(org, token).workspaces();
      const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(url).toBe("/api/v1/workspaces");
      expect(headers.Authorization).toBe(`Bearer ${token}`);
      expect(headers["X-Workspace-ID"]).toBeUndefined();
      expect(init.cache).toBe("no-store");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("retains the synthetic selector only for the existing public demo", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => { return { ...payload, read_only: true }; },
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      await recordsApi(org).workspaces();
      const headers = (fetcher.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
      expect(headers["X-Workspace-ID"]).toBe(org);
      expect(headers.Authorization).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
