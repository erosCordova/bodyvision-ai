import { expect, test } from "@playwright/test";

test("real local detector saves only a fictional summary and history survives navigation", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/access");
  await page.getByLabel("Identificador de organización").fill("10000000-0000-4000-8000-000000000001");
  await page.getByLabel("Correo electrónico").fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("Browser fixtures only 2026!");
  const login = page.waitForResponse(response => response.url().endsWith("/api/v1/auth/login"));
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const { token } = await (await login).json() as { token: string };
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible({ timeout: 15000 });
  const headers = { Authorization: `Bearer ${token}` };
  const created = await page.request.post("/api/v1/profiles", { headers,
    data: { birth_year: 1997, display_name: "Resumen de pose ficticio" } });
  expect(created.status()).toBe(201);
  const { id } = await created.json() as { id: string };
  for (const purpose of ["pose", "storage"]) {
    expect((await page.request.post(`/api/v1/auth/profiles/${id}/consents`, { headers,
      data: { purpose, version: "bv-synthetic-v1", confirmed: true } })).status()).toBe(200);
  }
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 1100;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 800, 0);
    gradient.addColorStop(0, "#303030"); gradient.addColorStop(1, "#dddddd");
    context.fillStyle = gradient; context.fillRect(0, 0, 800, 1100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  const upload = async () => {
    await page.getByRole("link", { name: "Captura corporal", exact: true }).click();
    await page.getByRole("checkbox", { name: /Confirmo que utilizaré exclusivamente imágenes ficticias/ }).check();
    await page.locator('input[type="file"]').setInputFiles({ name: "patron-ficticio.png",
      mimeType: "image/png", buffer: Buffer.from(encoded, "base64") });
  };
  await upload();
  const detector = page.getByRole("region", { name: "Estimación local de pose con IA", exact: true });
  await detector.getByRole("button", { name: "Detectar pose con IA", exact: true }).click();
  await expect(detector.getByRole("button", { name: "Repetir detección", exact: true })).toBeVisible({ timeout: 45000 });
  const history = page.getByRole("region", { name: "Historial privado de resultados de pose", exact: true });
  await history.getByLabel("Expediente para resultados de pose", { exact: true }).selectOption(id);
  await history.getByRole("checkbox", { name: /Confirmo que el resultado procede/ }).check();
  const post = page.waitForResponse(response => response.url().endsWith(`/profiles/${id}/pose-summaries`)
    && response.request().method() === "POST");
  await history.getByRole("button", { name: "Guardar resultado de pose", exact: true }).click();
  const response = await post; expect(response.status()).toBe(201);
  const body = await response.json() as { id: string; origin: string; data_type: string; synthetic: boolean };
  expect(body.origin).toBe("client_reported_browser"); expect(body.data_type).toBe("DERIVADO");
  expect(body.synthetic).toBe(true);
  const sent = response.request().postDataJSON() as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(["model_revision", "detected", "threshold", "visible_points",
    "core_visible", "quality_state", "capture_passed", "synthetic_confirmed"].sort());
  await expect(history.getByRole("status", { name: "Página de resultados de pose" })).toContainText("1 resúmenes");
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await upload();
  await history.getByLabel("Expediente para resultados de pose", { exact: true }).selectOption(id);
  await expect(history.getByRole("status", { name: "Página de resultados de pose" })).toContainText("1 resúmenes");
  await expect(history.getByRole("button", { name: "Guardar resultado de pose", exact: true })).toBeDisabled();
  page.once("dialog", dialog => dialog.accept());
  await history.getByRole("button", { name: "Eliminar resumen de pose", exact: true }).click();
  await expect(history.getByRole("status", { name: "Página de resultados de pose" })).toContainText("0 resúmenes");
  const measured = await page.request.get(`/api/v1/profiles/${id}/measurements`, { headers });
  expect((await measured.json() as { total: number }).total).toBe(0);
});
