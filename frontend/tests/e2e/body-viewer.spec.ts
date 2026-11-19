import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { anatomySource } from "../../src/features/viewer/atlasSource";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
test.setTimeout(90000);
const assets = new Map<string, Buffer>();
const hashes: Record<string, string> = {
  skin: "1000d249050112ea014651647d3145e0bde127f8",
  skeleton: "89c8d305f3727f31688abcfda2860d2b6d628832",
};
test.beforeAll(async () => {
  for (const layer of ["skin", "skeleton"]) {
    for (const path of [`web/public/models/${layer}.glb`, `content/${layer}.json`]) {
      const response = await fetch(anatomySource + path, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Could not download pinned test asset: ${path}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (path.endsWith(".glb")) {
        const hash = createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
        expect(hash).toBe(hashes[layer]);
      }
      assets.set(path, body);
    }
  }
});
async function sourceFixtures(page: Page) {
  await page.route(anatomySource + "**", async route => {
    const path = route.request().url().slice(anatomySource.length);
    const body = assets.get(path);
    if (body) await route.fulfill({ body, contentType: path.endsWith(".json") ? "application/json" : "model/gltf-binary" });
    else if (path.endsWith(".json")) await route.fulfill({ json: { structures: [] } });
    else await route.fulfill({ status: 404, body: "No test fixture for this layer" });
  });
}
const viewport = (page: Page) => page.getByRole("region", { name: "Visor anatómico 3D a pantalla completa", exact: true });

test("real atlas meshes render, layers and tours respond without writing data", async ({ page }) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && message.text().includes("THREE.")) errors.push(message.text()); });
  page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(request.url()); });
  await sourceFixtures(page);
  await page.goto("/body-3d");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await expect(page.getByRole("img", { name: /Cuerpo humano anatómico 3D/ })).toBeVisible();
  await page.getByRole("button", { name: "Espalda", exact: true }).click();
  await page.getByRole("button", { name: "Acercar", exact: true }).click();
  await page.getByRole("button", { name: "Esqueleto", exact: true }).click();
  await expect(page.getByLabel("Opacidad de Esqueleto", { exact: true })).toBeVisible();
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByLabel("Opacidad de Esqueleto", { exact: true }).fill("60");
  await page.getByRole("textbox", { name: "Buscar estructura anatómica", exact: true }).fill("femur");
  await page.getByRole("option", { name: /Femur/i }).first().click();
  await expect(page.getByRole("heading", { name: /Femur/i })).toBeVisible();
  await expect(page.locator(".studio-selected-tag")).toContainText("Femur");
  await expect(viewport(page)).not.toContainText("no se encontró");
  await page.getByRole("button", { name: "Aislar estructura", exact: true }).click();
  await page.getByRole("tab", { name: "Recorridos", exact: true }).click();
  await expect(page.getByText("Viaje por el esqueleto", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Restaurar visualización/ }).click();
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true");
  await page.getByRole("button", { name: "Peso y estatura", exact: true }).click();
  await page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico", exact: true }).fill("15");
  await expect(page.locator(".studio-weight-indicator")).toContainText("+15%");
  await page.getByRole("button", { name: "Malla 3D", exact: true }).click();
  await expect(page.getByRole("button", { name: "Malla 3D", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Malla 3D", exact: true }).click();
  await page.getByRole("button", { name: "Comparar con el original", exact: true }).click();
  await expect(page.getByRole("button", { name: "Ver escenario modificado", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Restaurar valores", exact: true }).click();
  await expect(page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico", exact: true })).toHaveValue("0");
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByRole("button", { name: "Giro", exact: true })).toBeDisabled();
  await page.screenshot({ path: "test-results/anatomy-atlas-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/anatomy-atlas-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("weight morph and polygon overlay change the rendered 3D canvas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /THREE\.|WebGL|shader/i.test(message.text())) errors.push(message.text());
  });
  await sourceFixtures(page);
  await page.goto("/body-3d?panel=simulacion");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const canvas = page.locator(".studio-canvas canvas");
  const slider = page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" });
  await expect(canvas).toBeVisible();
  await slider.fill("0");
  const before = await canvas.screenshot();
  await slider.fill("30");
  await expect(page.locator(".studio-weight-indicator")).toContainText("+30%");
  const after = await canvas.screenshot();
  expect(after.equals(before), "The 3D surface should visibly deform at +30%").toBe(false);
  const stature = page.getByRole("slider", { name: "Ajustar estatura del modelo anatómico" });
  await stature.fill("205");
  await expect(page.locator(".studio-weight-indicator")).toContainText("205 cm");
  const taller = await canvas.screenshot();
  expect(taller.equals(after), "The same 3D mesh should become taller").toBe(false);
  await page.getByRole("button", { name: "Guardar comparación en esta vista" }).click();
  await expect(page.locator(".studio-sim-saved")).toContainText("205 cm");
  await page.getByRole("button", { name: "Comparar con el original" }).click();
  await expect(page.locator(".studio-weight-indicator")).toContainText("175 cm");
  await page.getByRole("button", { name: "Ver escenario modificado" }).click();
  await page.getByRole("button", { name: "Malla 3D", exact: true }).click();
  const withWireframe = await canvas.screenshot();
  expect(withWireframe.equals(after), "The polygon mesh must render onto the same model").toBe(false);
  await page.getByRole("button", { name: "Malla 3D", exact: true }).click();
  await page.getByRole("button", { name: "Esqueleto", exact: true }).click();
  await expect(page.getByText(/La piel está oculta/)).toBeVisible();
  await slider.fill("20");
  await expect(page.getByRole("checkbox", { name: /Piel/ })).toBeChecked();
  await expect(page.getByText(/La piel está oculta/)).not.toBeVisible();
  await expect(page.locator(".studio-weight-indicator")).toContainText("+20%");
  await page.getByRole("button", { name: "Restaurar valores" }).click();
  await expect(stature).toHaveValue("175");
  await expect(slider).toHaveValue("0");
  expect(errors).toEqual([]);
});

test("a failed anatomical layer can be retried", async ({ page }) => {
  await sourceFixtures(page);
  const skinUrl = anatomySource + "web/public/models/skin.glb";
  await page.route(skinUrl, route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/body-3d");
  await expect(page.getByRole("alert")).toContainText("No se pudo cargar piel");
  await page.unroute(skinUrl);
  await page.getByRole("button", { name: "Reintentar piel", exact: true }).click();
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
});

test("a browser without WebGL gets an actionable error and keeps the catalogue", async ({ page }) => {
  await sourceFixtures(page);
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (type.startsWith("webgl") || type === "experimental-webgl") return null;
      return Reflect.apply(getContext, this, [type, ...args]);
    } as typeof getContext;
  });
  await page.goto("/body-3d");
  await expect(page.getByRole("alert")).toContainText("Este navegador no pudo iniciar el visor 3D");
  await expect(page.getByRole("button", { name: "Recargar visor", exact: true })).toBeVisible();
  await expect(viewport(page)).toHaveAttribute("data-loaded", "false");
  await page.getByRole("textbox", { name: "Buscar estructura anatómica", exact: true }).fill("femur");
  await expect(page.getByRole("option", { name: /Femur/i }).first()).toBeVisible();
});

test("self-hosted pose model analyses a screenshot of the licensed synthetic anatomical body", async ({ page }) => {
  test.setTimeout(150000);
  await sourceFixtures(page);
  await page.goto("/body-3d");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  const syntheticBody = await page.locator(".studio-canvas canvas").screenshot();
  const externalPoseRequests: string[] = [];
  let inAnalysis = false;
  page.on("request", request => {
    if (inAnalysis && /cdn\.jsdelivr\.net|storage\.googleapis\.com/.test(request.url())) {
      externalPoseRequests.push(request.url());
    }
  });

  await page.goto("/capture");
  await page.getByRole("checkbox", {
    name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
  }).check();
  await page.locator('input[type="file"]').setInputFiles({
    name: "atlas-anatomico-sintetico.png",
    mimeType: "image/png",
    buffer: syntheticBody,
  });
  await expect(page.getByRole("region", { name: "Resultados de calidad local" })).toBeVisible();
  await page.getByRole("link", { name: "Ver control de calidad en el módulo de análisis" }).click();
  inAnalysis = true;
  await page.getByRole("button", { name: "Detectar pose con IA" }).click();
  const result = page.getByRole("region", { name: "Estimación local de pose con IA" });
  await expect(result).toContainText(/Pose detectada|No se detectó una pose humana/, { timeout: 90000 });
  const detected = await result.getByText(/Pose detectada/).count();
  if (detected > 0) {
    await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
      .toBeVisible();
  } else {
    await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
      .toHaveCount(0);
  }
  // The model's real output, including no-detection, is an acceptable test observation.
  console.log("Local pose result on synthetic anatomical atlas: " +
    (detected > 0 ? "33-landmark pose detected" : "no pose detected"));
  expect(externalPoseRequests).toEqual([]);
  await page.screenshot({ path: "test-results/pose-synthetic-anatomical-body.png", fullPage: true });
});
