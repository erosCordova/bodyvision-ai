import { expect, test } from "@playwright/test";

const organization = "10000000-0000-4000-8000-000000000001";
const password = "Browser fixtures only 2026!";

test("private capture archives only synthetic PNG after both consents, then deletes it", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/access");
  await page.getByLabel("Identificador de organización").fill(organization);
  await page.getByLabel("Correo electrónico").fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  const loginResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const login = await loginResponse;
  expect(login.status()).toBe(200);
  const token = (await login.json() as { token: string }).token;
  const headers = { Authorization: `Bearer ${token}` };
  const created = await page.request.post("/api/v1/profiles", {
    headers, data: { birth_year: 1998, display_name: "Foto sintética de CI" },
  });
  expect(created.status()).toBe(201);
  const profile = (await created.json() as { id: string }).id;

  await page.getByRole("link", { name: "Captura corporal", exact: true }).click();
  await page.getByRole("checkbox", {
    name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
  }).check();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 1100;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 800, 0);
    gradient.addColorStop(0, "#303030"); gradient.addColorStop(1, "#dddddd");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 1100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "patron-ficticio.png",
    mimeType: "image/png",
    buffer: Buffer.from(encoded, "base64"),
  });
  const region = page.getByRole("region", { name: "Archivo cifrado de imágenes ficticias" });
  await expect(region).toBeVisible();
  await region.getByRole("combobox", { name: "Expediente de captura ficticia" })
    .selectOption(profile);
  await expect(region).toContainText("Antes de guardar, registra las aceptaciones");
  await expect(region.getByRole("button", { name: "Guardar PNG ficticio cifrado" }))
    .toBeDisabled();
  for (const purpose of ["capture", "storage"]) {
    const accepted = await page.request.post(
      `/api/v1/auth/profiles/${profile}/consents`,
      { headers, data: { purpose, version: "bv-synthetic-v1", confirmed: true } },
    );
    expect(accepted.status()).toBe(200);
  }
  // Re-mounting the capture module refreshes the consent query.
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page.getByRole("link", { name: "Captura corporal", exact: true }).click();
  await page.getByRole("checkbox", {
    name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
  }).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "patron-ficticio.png",
    mimeType: "image/png",
    buffer: Buffer.from(encoded, "base64"),
  });
  const privateArchive = page.getByRole("region", { name: "Archivo cifrado de imágenes ficticias" });
  await privateArchive.getByRole("combobox", { name: "Expediente de captura ficticia" })
    .selectOption(profile);
  await expect(privateArchive).toContainText(
    "Aceptaciones ficticias de captura y conservación verificadas",
  );
  await privateArchive.getByRole("checkbox", {
    name: /Confirmo que esta imagen es exclusivamente ficticia/,
  }).check();
  const post = page.waitForResponse(response =>
    response.url().endsWith(`/profiles/${profile}/captures`) &&
    response.request().method() === "POST",
  );
  await privateArchive.getByRole("button", { name: "Guardar PNG ficticio cifrado" }).click();
  const uploaded = await post;
  expect(uploaded.status()).toBe(201);
  expect((await uploaded.json() as { data_type: string }).data_type).toBe("SIMULADO");
  await expect(privateArchive).toContainText("SIMULADO");
  await expect(privateArchive.getByRole("status", { name: "Página del archivo cifrado" }))
    .toContainText("Capturas 1–1 de 1");
  await expect(privateArchive.getByRole("button", { name: "Anterior" })).toBeDisabled();
  await expect(privateArchive.getByRole("button", { name: "Siguiente" })).toBeDisabled();

  const downloadEvent = page.waitForEvent("download");
  await privateArchive.getByRole("button", { name: "Descargar PNG" }).click();
  const file = await downloadEvent;
  expect(file.suggestedFilename()).toBe("captura-ficticia.png");
  await privateArchive.getByRole("button", { name: "Borrar definitivamente" }).click();
  await expect(privateArchive).toContainText("No hay PNG ficticios guardados");
  const purgeResponse = page.waitForResponse(response =>
    response.url().endsWith(`/profiles/${profile}/captures/purge-expired`) &&
    response.request().method() === "POST",
  );
  await privateArchive.getByRole("button", { name: "Eliminar lote de capturas vencidas" }).click();
  const purged = await purgeResponse;
  expect(purged.status()).toBe(200);
  expect(await purged.json()).toEqual({
    deleted: 0, batch_limit: 100, limit_reached: false,
  });
  await expect(privateArchive).toContainText("Lote de limpieza: 0 capturas");
  const count = await page.request.get(`/api/v1/profiles/${profile}/captures`, { headers });
  expect(count.status()).toBe(200);
  expect((await count.json() as { total: number }).total).toBe(0);
  const observed = await page.request.get(
    `/api/v1/profiles/${profile}/measurements`, { headers },
  );
  expect((await observed.json() as { total: number }).total).toBe(0);
});
