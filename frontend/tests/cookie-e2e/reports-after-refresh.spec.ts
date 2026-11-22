import { createHash } from "node:crypto";
import { expect, test, type Download, type Page } from "@playwright/test";

const ORG = "10000000-0000-4000-8000-000000000001";
const SECRET = "Browser fixtures only 2026!";

async function savedBytes(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("La descarga ficticia no pudo leerse.");
  const parts: Buffer[] = [];
  for await (const part of stream) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}

async function cookieAdminLogin(page: Page) {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(ORG);
  await page.getByLabel("Correo electrónico", { exact: true })
    .fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(SECRET);
  const login = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/access/login")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const response = await login;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true }))
    .toBeVisible();
  return (await response.json() as { access_token: string }).access_token;
}

test("F2/F3/F7: rotated cookie JWT protects genuine PDF CSV exports and their audit",
  async ({ page }) => {
    test.setTimeout(90000);
    const original = await cookieAdminLogin(page);
    const refresh = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/access/refresh")
      && response.request().method() === "POST");
    await page.reload();
    const rotation = await refresh;
    expect(rotation.status()).toBe(200);
    const jwt = (await rotation.json() as { access_token: string }).access_token;
    expect(jwt).not.toBe(original);
    await expect(page.getByRole("heading", { name: "Dashboard general", exact: true }))
      .toBeVisible();
    expect((await page.request.get("/api/v1/auth/access/me", {
      headers: { Authorization: `Bearer ${original}` },
    })).status()).toBe(401);
    const auth = { Authorization: `Bearer ${jwt}` };

    const newProfile = await page.request.post("/api/v1/profiles", {
      headers: auth,
      data: { birth_year: 1999, display_name: "JWT informe sintético de integración" },
    });
    expect(newProfile.status()).toBe(201);
    const { id } = await newProfile.json() as { id: string };
    const sources: string[] = [];
    for (const [days, value] of [[20, 70], [2, 72]]) {
      const observation = await page.request.post(`/api/v1/profiles/${id}/measurements`, {
        headers: { ...auth, "Idempotency-Key": crypto.randomUUID() },
        data: {
          metric_code: "weight", value, unit: "kg", method: "manual",
          measured_at: new Date(Date.now() - days * 86400000).toISOString(),
        },
      });
      expect(observation.status()).toBe(201);
      sources.push((await observation.json() as { id: string }).id);
    }

    await page.getByRole("link", { name: "Expedientes", exact: true }).click();
    await page.locator(`a.profile-card[href="/profiles/${id}"]`).click();
    await page.getByRole("button", { name: "Evolución", exact: true }).click();

    const pdfEvent = page.waitForEvent("download");
    const pdfResponse = page.waitForResponse(response =>
      response.url().endsWith("/reports/comparison") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Descargar informe PDF", exact: true }).click();
    const pdfApi = await pdfResponse;
    expect(pdfApi.status()).toBe(200);
    const pdf = await pdfApi.json() as {
      report_id: string; filename: string; sha256: string;
    };
    const pdfDownload = await pdfEvent;
    expect(pdfDownload.suggestedFilename()).toBe(pdf.filename);
    const pdfContent = await savedBytes(pdfDownload);
    expect(pdfContent.subarray(0, 8).toString()).toBe("%PDF-1.4");
    expect(createHash("sha256").update(pdfContent).digest("hex")).toBe(pdf.sha256);
    for (const source of sources) expect(pdfContent.includes(Buffer.from(source))).toBe(true);

    const csvEvent = page.waitForEvent("download");
    const csvResponse = page.waitForResponse(response =>
      response.url().endsWith("/reports/longitudinal") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Descargar historial observado (CSV)" }).click();
    const csvApi = await csvResponse;
    expect(csvApi.status()).toBe(200);
    const csv = await csvApi.json() as {
      export_id: string; filename: string; sha256: string; row_count: number;
    };
    expect(csv.row_count).toBe(2);
    const csvDownload = await csvEvent;
    expect(csvDownload.suggestedFilename()).toBe(csv.filename);
    const csvContent = await savedBytes(csvDownload);
    expect(createHash("sha256").update(csvContent).digest("hex")).toBe(csv.sha256);
    for (const source of sources) expect(csvContent.includes(Buffer.from(source))).toBe(true);

    const audit = await page.request.get("/api/v1/auth/audit?limit=50", { headers: auth });
    expect(audit.status()).toBe(200);
    const auditText = JSON.stringify(await audit.json());
    expect(auditText).toContain(pdf.report_id);
    expect(auditText).toContain(csv.export_id);

    const logout = page.waitForResponse(response =>
      response.url().endsWith("/api/v1/auth/access/logout") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
    expect((await logout).status()).toBe(204);
    expect((await page.request.post(`/api/v1/profiles/${id}/reports/comparison`, {
      headers: auth, data: { initial_id: sources[0], final_id: sources[1] },
    })).status()).toBe(401);
    expect((await page.context().cookies())
      .some(cookie => cookie.name === "bv_private_refresh")).toBe(false);
  });
