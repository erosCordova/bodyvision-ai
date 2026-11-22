import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

async function rotateOutsideUi(page: Page) {
  const response = await page.request.post("/api/v1/auth/access/refresh", {
    headers: { Origin: new URL(page.url()).origin, "X-Requested-With": "XMLHttpRequest" },
  });
  expect(response.status()).toBe(200);
}

test("capture upload download deletion and pose save survive real JWT rotation", async ({ page }) => {
  test.setTimeout(120000);
  const organization = "10000000-0000-4000-8000-000000000001";
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(organization);
  await page.getByLabel("Correo electrónico", { exact: true }).fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill("Browser fixtures only 2026!");
  const login = page.waitForResponse(response => response.url().endsWith("/auth/access/login"));
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const authenticated = await login; expect(authenticated.status()).toBe(200);
  const { access_token: originalToken } = await authenticated.json() as { access_token: string };
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible();
  const headers = { Authorization: `Bearer ${originalToken}` };
  const created = await page.request.post("/api/v1/profiles", {
    headers, data: { birth_year: 1998, display_name: "Renovación de captura y pose ficticias" },
  });
  expect(created.status()).toBe(201);
  const { id: profile } = await created.json() as { id: string };
  for (const purpose of ["capture", "storage", "pose"]) {
    expect((await page.request.post(`/api/v1/auth/profiles/${profile}/consents`, {
      headers, data: { purpose, version: "bv-synthetic-v1", confirmed: true },
    })).status()).toBe(200);
  }

  await page.getByRole("link", { name: "Captura corporal", exact: true }).click();
  await page.getByRole("checkbox", { name: /Confirmo que utilizaré exclusivamente imágenes ficticias/ }).check();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 1100;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 800, 0);
    gradient.addColorStop(0, "#303030"); gradient.addColorStop(1, "#dddddd");
    context.fillStyle = gradient; context.fillRect(0, 0, 800, 1100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "renovacion-ficticia.png", mimeType: "image/png", buffer: Buffer.from(encoded, "base64"),
  });
  const archive = page.getByRole("region", { name: "Archivo cifrado de imágenes ficticias" });
  await archive.getByRole("combobox", { name: "Expediente de captura ficticia" }).selectOption(profile);
  await expect(archive).toContainText("Aceptaciones ficticias de captura y conservación verificadas");
  await expect(archive).toContainText("No hay PNG ficticios guardados");
  await archive.getByRole("checkbox", { name: /Confirmo que esta imagen es exclusivamente ficticia/ }).check();

  const status: number[] = [];
  const poseKeys: string[] = [];
  const poseBodies: string[] = [];
  let latestToken = originalToken;
  page.on("response", async response => {
    const request = response.request();
    if (response.url().endsWith(`/profiles/${profile}/captures`) && request.method() === "POST") status.push(response.status());
    if (response.url().endsWith(`/profiles/${profile}/pose-summaries`) && request.method() === "POST") {
      poseKeys.push(request.headers()["idempotency-key"]);
      poseBodies.push(request.postData()!);
    }
    if (response.url().endsWith("/auth/access/refresh") && response.status() === 200) {
      latestToken = (await response.json() as { access_token: string }).access_token;
    }
  });
  await rotateOutsideUi(page);
  const uploaded = page.waitForResponse(response => response.url().endsWith(`/profiles/${profile}/captures`)
    && response.request().method() === "POST" && response.status() === 201);
  await archive.getByRole("button", { name: "Guardar PNG ficticio cifrado" }).click();
  const file = await (await uploaded).json() as { sha256_digest: string };
  await expect(archive.getByRole("status", { name: "Página del archivo cifrado" })).toContainText("Capturas 1–1 de 1");
  expect(status).toEqual([401, 201]);
  expect(await page.locator('input[type="file"]').evaluate((element: HTMLInputElement) => element.files?.length)).toBe(1);

  await rotateOutsideUi(page);
  const downloaded = page.waitForEvent("download");
  await archive.getByRole("button", { name: "Descargar PNG" }).click();
  const stream = await (await downloaded).createReadStream();
  if (!stream) throw new Error("No se recibió el archivo sintético.");
  const hash = createHash("sha256"); for await (const part of stream) hash.update(part);
  expect(hash.digest("hex")).toBe(file.sha256_digest);
  await rotateOutsideUi(page);
  await archive.getByRole("button", { name: "Borrar definitivamente" }).click();
  await expect(archive).toContainText("No hay PNG ficticios guardados");

  await page.getByRole("link", { name: "Ver control de calidad en el módulo de análisis", exact: true }).click();
  const detector = page.getByRole("region", { name: "Estimación local de pose con IA", exact: true });
  await detector.getByRole("button", { name: "Detectar pose con IA", exact: true }).click();
  await expect(detector.getByRole("button", { name: "Repetir detección", exact: true })).toBeVisible({ timeout: 45000 });
  const history = page.getByRole("region", { name: "Historial privado de resultados de pose", exact: true });
  await history.getByRole("combobox", { name: "Expediente para resultados de pose", exact: true }).selectOption(profile);
  await expect(history.getByRole("status", { name: "Página de resultados de pose" })).toContainText("0 resúmenes");
  await history.getByRole("checkbox", { name: /Confirmo que el resultado procede/ }).check();
  await rotateOutsideUi(page);
  await history.getByRole("button", { name: "Guardar resultado de pose", exact: true }).click();
  await expect(history).toContainText("Resumen de pose guardado y auditado");
  await expect(history.getByRole("status", { name: "Página de resultados de pose" })).toContainText("1 resúmenes");
  expect(poseKeys).toHaveLength(2); expect(poseKeys[0]).toBe(poseKeys[1]);
  expect(poseBodies[0]).toBe(poseBodies[1]);
  const sent = JSON.parse(poseBodies[1]) as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(["model_revision", "detected", "threshold", "visible_points",
    "core_visible", "quality_state", "capture_passed", "synthetic_confirmed"].sort());
  const currentHeaders = { Authorization: `Bearer ${latestToken}` };
  const observed = await page.request.get(`/api/v1/profiles/${profile}/measurements`, { headers: currentHeaders });
  expect(observed.status()).toBe(200);
  expect((await observed.json() as { total: number }).total).toBe(0);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(originalToken); expect(storage).not.toContain(latestToken);
});
