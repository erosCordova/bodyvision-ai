import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const ORG = "10000000-0000-4000-8000-000000000001";
const PASSWORD = "Browser fixtures only 2026!";

test("administrator downloads the full verifiable audit and checks a saved copy locally", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(ORG);
  await page.getByLabel("Correo electrónico", { exact: true }).fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  const loggingIn = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const session = await (await loggingIn).json() as { token: string };
  const auth = { Authorization: "Bearer " + session.token };
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible();
  for (let index = 0; index < 35; index += 1) {
    expect((await page.request.post("/api/v1/auth/audit/verify", { headers: auth, data: {} })).status()).toBe(200);
  }
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/audit/export"));
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar auditoría verificable" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(response.headers()["x-content-sha256"]);
  const bundle = JSON.parse(bytes.toString("utf8")) as {
    export_id: string; organization_id: string; checkpoint_sequence: number; checkpoint_hash: string;
    generated_at: string; events: { sequence: number; previous_hash: string; event_hash: string; payload: string }[];
  };
  expect(bundle.organization_id).toBe(ORG); expect(bundle.events.length).toBeGreaterThan(30);
  let prior = "0".repeat(64);
  for (const [index, row] of bundle.events.entries()) {
    expect(row.sequence).toBe(index + 1); expect(row.previous_hash).toBe(prior);
    expect(createHash("sha256").update(row.payload, "utf8").digest("hex")).toBe(row.event_hash);
    const payload = JSON.parse(row.payload) as unknown[];
    expect(payload[4]).toBe(ORG); prior = row.event_hash;
  }
  expect(bundle.checkpoint_sequence).toBe(bundle.events.length); expect(bundle.checkpoint_hash).toBe(prior);
  expect(bytes.toString("utf8")).not.toContain(PASSWORD);
  expect(bytes.toString("utf8")).not.toContain("@example.invalid");
  expect(download.suggestedFilename()).toBe(`bodyvision-audit-${bundle.export_id}.json`);
  const input = page.getByLabel("Verificar un archivo de auditoría");
  await input.setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: bytes });
  await expect(page.getByText(/Coincide con la descarga reciente/)).toBeVisible();
  bundle.generated_at = "2026-11-01T00:00:00Z";
  await input.setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)) });
  await expect(page.getByText("El archivo guardado cambió respecto de la descarga comprobada.")).toBeVisible();
  await expect(page.getByText(/Coincide con la descarga reciente/)).toHaveCount(0);
});
