import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test("private comparison downloads a server PDF with source IDs and committed audit", async ({ page }) => {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true })
    .fill("10000000-0000-4000-8000-000000000001");
  await page.getByLabel("Correo electrónico", { exact: true }).fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("Browser fixtures only 2026!");
  const loginResponse = page.waitForResponse(response => response.url().endsWith("/auth/login"));
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const { token } = await (await loginResponse).json() as { token: string };
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible();
  const auth = { Authorization: `Bearer ${token}` };
  const created = await page.request.post("/api/v1/profiles", {
    headers: auth, data: { birth_year: 1997, display_name: "Informe ficticio PDF" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  const sourceIds: string[] = [];
  for (const [days, value] of [[30, 70], [1, 77]]) {
    const result = await page.request.post(`/api/v1/profiles/${id}/measurements`, {
      headers: { ...auth, "Idempotency-Key": crypto.randomUUID() },
      data: { metric_code: "weight", value, unit: "kg", method: "manual",
        measured_at: new Date(Date.now() - days * 86400000).toISOString() },
    });
    expect(result.status()).toBe(201);
    sourceIds.push((await result.json() as { id: string }).id);
  }
  await page.goto(`/profiles/${id}`);
  await page.getByRole("button", { name: "Evolución", exact: true }).click();
  const downloadEvent = page.waitForEvent("download");
  const responseEvent = page.waitForResponse(response => response.url().endsWith("/reports/comparison"));
  await page.getByRole("button", { name: "Descargar informe PDF", exact: true }).click();
  const response = await responseEvent;
  expect(response.status()).toBe(200);
  const report = await response.json() as { report_id: string; sha256: string; filename: string };
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(report.filename);
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Missing PDF download");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(0, 8).toString()).toBe("%PDF-1.4");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(report.sha256);
  for (const source of sourceIds) expect(bytes.includes(Buffer.from(source))).toBe(true);
  const audit = await page.request.get("/api/v1/auth/audit?limit=50", { headers: auth });
  expect(audit.status()).toBe(200);
  expect(JSON.stringify(await audit.json())).toContain(report.report_id);
});
