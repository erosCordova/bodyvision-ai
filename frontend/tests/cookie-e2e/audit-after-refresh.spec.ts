import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

test("expired audit JWT renews once and delivers one verified download", async ({ page }) => {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill("10000000-0000-4000-8000-000000000001");
  await page.getByLabel("Correo electrónico", { exact: true }).fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("Browser fixtures only 2026!");
  const login = page.waitForResponse(response => response.url().endsWith("/auth/access/login"));
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const loggedIn = await login;
  expect(loggedIn.status()).toBe(200);
  const oldToken = (await loggedIn.json() as { access_token: string }).access_token;
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  const panel = page.getByRole("region", { name: "Exportación de auditoría" });
  const button = panel.getByRole("button", { name: "Descargar auditoría verificable" });
  await expect(button).toBeEnabled();
  // Drain initial reads so the export itself triggers the next refresh.
  await expect(page.getByLabel("Filtrar auditoría", { exact: true })).toBeVisible();
  const rotated = await page.request.post("/api/v1/auth/access/refresh", {
    headers: { Origin: new URL(page.url()).origin, "X-Requested-With": "XMLHttpRequest" },
  });
  expect(rotated.status()).toBe(200);
  expect((await page.request.get("/api/v1/auth/access/me", {
    headers: { Authorization: `Bearer ${oldToken}` },
  })).status()).toBe(401);

  const statuses: number[] = [];
  let refreshes = 0;
  let downloads = 0;
  page.on("response", response => {
    if (response.url().endsWith("/auth/audit/export")) statuses.push(response.status());
    if (response.url().endsWith("/auth/access/refresh")) refreshes += 1;
  });
  page.on("download", () => { downloads += 1; });
  const delivered = page.waitForResponse(response => response.url().endsWith("/auth/audit/export") && response.status() === 200);
  const downloading = page.waitForEvent("download");
  await button.click();
  const response = await delivered;
  const download = await downloading;
  const chunks: Buffer[] = [];
  for await (const chunk of await download.createReadStream()) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(response.headers()["x-content-sha256"]);
  await expect(panel.getByRole("status")).toContainText("eventos comprobados");
  expect([[401, 200], [200]]).toContainEqual(statuses);
  expect(refreshes).toBe(1);
  expect(downloads).toBe(1);
  await panel.getByLabel("Verificar un archivo de auditoría").setInputFiles({
    name: download.suggestedFilename(), mimeType: "application/json", buffer: bytes,
  });
  await expect(panel.getByRole("status")).toContainText("Coincide con la descarga reciente");
});
