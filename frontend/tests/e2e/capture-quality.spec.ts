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
  await expect(page.getByText(/nunca se transfirió la fotografía/)).toBeVisible();
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
