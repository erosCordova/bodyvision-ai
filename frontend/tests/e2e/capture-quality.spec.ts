import { expect, test } from "@playwright/test";

test("local capture checks an image and transfers only indicators to analysis", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/capture");
  await expect(page.getByRole("heading", { name: "Captura corporal" })).toBeVisible();
  const input = page.locator('input[type="file"]');
  await expect(input).toBeDisabled();
  await page.getByRole("checkbox", {
    name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
  }).check();
  await expect(input).toBeEnabled();

  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 1100;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createLinearGradient(0, 0, 800, 0);
    gradient.addColorStop(0, "#444444");
    gradient.addColorStop(1, "#dddddd");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 800, 1100);
    return canvas.toDataURL("image/png");
  });
  await input.setInputFiles({
    name: "patron-ficticio.png",
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.split(",")[1], "base64"),
  });

  const review = page.getByRole("region", { name: "Resultados de calidad local" });
  await expect(review).toBeVisible();
  await expect(review).toContainText("800 × 1100 px");
  await expect(review).toContainText("Resolución");
  await expect(review).toContainText("Iluminación");
  await expect(review).toContainText("Contraste");
  await expect(review).toContainText("Encuadre vertical");
  await page.getByRole("link", {
    name: "Ver control de calidad en el módulo de análisis",
  }).click();
  await expect(page.getByRole("heading", { name: "Análisis corporal con IA" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Control de calidad recibido" })).toContainText("4 de 4 criterios cumplidos");
  await expect(page.getByText(/sin subirse a la API ni guardarse en el historial/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Detectar pose con IA" })).toBeVisible();
  await expect(page.getByRole("img", {
    name: "Fotografía local utilizada únicamente para la revisión de pose",
  })).toBeVisible();
  // Fail-closed if a locally bundled runtime asset is missing; no fake landmarks.
  await page.route("**/src/vendor/vision_bundle.mjs*",
    route => route.abort());
  await page.getByRole("button", { name: "Detectar pose con IA" }).click();
  await expect(page.getByRole("alert")).toContainText("No se pudo ejecutar el detector local");
  await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
    .toHaveCount(0);
  await page.getByRole("button", { name: "Descartar fotografía del análisis" }).click();
  await expect(page.getByRole("button", { name: "Detectar pose con IA" })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("capture rejects a disguised image without uploading it", async ({ page }) => {
  await page.goto("/capture");
  await page.getByRole("checkbox", {
    name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
  }).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "falso.png",
    mimeType: "image/png",
    buffer: Buffer.from("THIS IS NOT A REAL PNG FILE", "utf8"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "El contenido del archivo no corresponde al formato declarado",
  );
  await expect(page.getByRole("link", {
    name: "Ver control de calidad en el módulo de análisis",
  })).toHaveCount(0);
});

test("capture refuses a compressed 64 MP PNG before decoding or transferring", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/capture");
  await page.getByRole("checkbox", {
    name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
  }).check();
  const header = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0x1f, 0x40, 0, 0, 0x1f, 0x40,
  ]);
  await page.locator('input[type="file"]').setInputFiles({
    name: "cabecera-grande-ficticia.png",
    mimeType: "image/png",
    buffer: header,
  });
  await expect(page.getByRole("alert")).toContainText(
    "Las dimensiones de la fotografía exceden los límites de análisis local",
  );
  await expect(page.getByRole("link", {
    name: "Ver control de calidad en el módulo de análisis",
  })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("camera requires consent and reports a denied permission without uploading", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => { throw new Error("camera denied"); } },
    });
  });
  const writes: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/capture");
  const open = page.getByRole("button", { name: "Abrir cámara local" });
  await expect(open).toBeDisabled();
  await page.getByRole("checkbox", {
    name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
  }).check();
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page.getByRole("alert")).toContainText("No se pudo acceder a la cámara");
  expect(writes).toEqual([]);
});

test("self-hosted MediaPipe executes real inference on a synthetic no-person image", async ({ page }) => {
  test.setTimeout(120000);
  const thirdPartyRequests: string[] = [];
  page.on("request", request => {
    if (/cdn\.jsdelivr\.net|storage\.googleapis\.com|unpkg\.com/.test(request.url())) {
      thirdPartyRequests.push(request.url());
    }
  });
  await page.goto("/capture");
  await page.getByRole("checkbox", {
    name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
  }).check();
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 1100;
    const context = canvas.getContext("2d")!;
    const sky = context.createLinearGradient(0, 0, 0, 1100);
    sky.addColorStop(0, "#7aa7dd");
    sky.addColorStop(1, "#dec9a3");
    context.fillStyle = sky;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "paisaje-sintetico-sin-personas.png",
    mimeType: "image/png",
    buffer: Buffer.from(encoded, "base64"),
  });
  await page.getByRole("link", { name: "Ver control de calidad en el módulo de análisis" }).click();
  const modelRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("pose_landmarker_lite.task")) modelRequests.push(request.url());
  });
  await page.getByRole("button", { name: "Detectar pose con IA" }).click();
  await expect(page.getByText(/No se detectó una pose humana/)).toBeVisible({ timeout: 90000 });
  await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
    .toHaveCount(0);
  await expect(page.getByText("Resultado técnico: Sin detección")).toBeVisible();
  await page.getByRole("button", { name: "Repetir detección" }).click();
  await expect(page.getByText(/No se detectó una pose humana/)).toBeVisible({ timeout: 90000 });
  expect(modelRequests.length, "Repeated analysis should reuse the local model instance").toBe(1);
  expect(thirdPartyRequests).toEqual([]);
});
