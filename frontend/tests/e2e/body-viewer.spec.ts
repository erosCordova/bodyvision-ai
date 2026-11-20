import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { anatomySource } from "../../src/features/viewer/atlasSource";
import { summarizeSyntheticPoseMatrix, type SyntheticPoseObservation } from "../../src/features/capture/poseRobustnessReport";

test.use({ launchOptions: {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
} });
test.setTimeout(90000);
const assets = new Map<string, Buffer>();
const hashes: Record<string, string> = {
  skin: "1000d249050112ea014651647d3145e0bde127f8",
  skeleton: "89c8d305f3727f31688abcfda2860d2b6d628832",
};
test.beforeAll(async () => {
  test.setTimeout(90000);
  await Promise.all(["skin", "skeleton"].flatMap(layer =>
    [`web/public/models/${layer}.glb`, `content/${layer}.json`].map(async path => {
      const response = await fetch(anatomySource + path, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Could not download pinned test asset: ${path}`);
      const body = Buffer.from(await response.arrayBuffer());
      if (path.endsWith(".glb")) {
        const hash = createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
        expect(hash).toBe(hashes[layer]);
      }
      assets.set(path, body);
    })
  ));
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

test("regional weight changes are reversible on the same shaded 3D body, including polygon mesh", async ({ page }) => {
  test.setTimeout(110000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && /THREE\\.|WebGL|shader/i.test(message.text())) errors.push(message.text());
  });
  await sourceFixtures(page);
  await page.goto("/body-3d?panel=simulacion");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  // Fix geometry quality for pixel comparisons: Auto/Fluida may replace
  // meshes asynchronously with LOD geometry between screenshots.
  const stableQuality = page.getByRole("button", { name: "Alta", exact: true });
  await stableQuality.click();
  await expect(stableQuality).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator(".studio-canvas canvas");
  const slider = page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" });
  await slider.fill("0");
  const reference = await canvas.screenshot();
  await slider.fill("30");
  const heavier = await canvas.screenshot();
  expect(heavier.equals(reference), "Increasing weight must alter the same avatar's contours").toBe(false);
  await slider.fill("-30");
  const lighter = await canvas.screenshot();
  expect(lighter.equals(reference), "Decreasing weight must alter the same avatar's contours").toBe(false);
  expect(lighter.equals(heavier), "Positive and negative weight scenarios should be visually distinct").toBe(false);
  await slider.fill("0");
  // WebGL paints asynchronously after React handles slider changes.
  // Poll the actual pixels instead of taking a potentially stale first frame.
  await expect.poll(async () => (await canvas.screenshot()).equals(reference), {
    timeout: 10000, intervals: [100, 250, 500],
    message: "Returning to 0% must restore the original shaded atlas",
  }).toBe(true);
  const restored = await canvas.screenshot();
  await slider.fill("25");
  await page.getByRole("button", { name: "Malla 3D", exact: true }).click();
  const mesh = await canvas.screenshot();
  expect(mesh.equals(restored), "The original model's polygon overlay follows the regional volume shader").toBe(false);
  await page.getByRole("button", { name: "Malla 3D", exact: true }).click();
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("versioned fictitious 3D scenarios persist across visits without creating observations", async ({ page }) => {
  test.setTimeout(120000);
  const response = await page.request.post("/api/v1/profiles", {
    data: { birth_year: 1997, display_name: "Prueba ficticia de escenarios 3D" },
  });
  expect(response.status()).toBe(201);
  const profileId = (await response.json()).id as string;
  await sourceFixtures(page);
  await page.goto(`/body-3d?panel=simulacion&profile=${profileId}`);
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const section = page.getByRole("region", { name: "Historial de escenarios simulados" });
  await expect(section.getByRole("combobox", { name: "Expediente ficticio para escenarios" }))
    .toHaveValue(profileId);
  await section.getByRole("button", { name: "Crear escenario versionado" }).click();
  await expect(section).toContainText("Versión 1 registrada como SIMULADO");
  await page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" })
    .fill("20");
  await section.getByRole("textbox", { name: /Motivo de nueva versión/ })
    .fill("Escenario aumentado para comparación ficticia");
  await section.getByRole("button", { name: "Guardar siguiente versión" }).click();
  await expect(section).toContainText("Versión 2 registrada como SIMULADO");
  await expect(section.getByRole("list", { name: "Versiones de simulación guardadas" }).locator("li"))
    .toHaveCount(2);

  await page.reload();
  const restored = page.getByRole("region", { name: "Historial de escenarios simulados" });
  await expect(restored.getByRole("list", { name: "Versiones de simulación guardadas" }).locator("li"))
    .toHaveCount(2);
  await restored.getByRole("button", { name: "Cargar en 3D" }).first().click();
  await expect(page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" }))
    .toHaveValue("20");
  await restored.getByRole("button", { name: "Ver versiones" }).first().click();
  const chain = restored.getByLabel("Cadena de versiones del escenario");
  await expect(chain).toContainText("v1");
  await expect(chain).toContainText("v2");

  const observed = await page.request.get(`/api/v1/profiles/${profileId}/measurements`);
  expect(observed.ok()).toBe(true);
  expect((await observed.json()).total).toBe(0);
  const historical = await page.request.get(`/api/v1/profiles/${profileId}/scenarios`);
  expect(historical.ok()).toBe(true);
  const history = await historical.json();
  expect(history.total).toBe(2);
  expect(history.items.every((row: { data_type: string }) => row.data_type === "SIMULADO"))
    .toBe(true);
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
  await expect(result).toContainText("Pose detectada.", { timeout: 90000 });
  await expect(result).toContainText("de 33 puntos");
  await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
    .toBeVisible();
  await expect(page.getByRole("list", { name: "Visibilidad por zonas corporales" }))
    .toBeVisible();
  const threshold = page.getByRole("slider", { name: "Umbral de visibilidad de landmarks" });
  await expect(threshold).toHaveValue("0.5");
  await threshold.fill("0.9");
  await expect(page.getByText(/visibles con umbral 0,90/)).toBeVisible();
  await page.getByRole("checkbox", { name: "Mostrar conexiones" }).uncheck();
  await page.getByRole("checkbox", { name: "Mostrar puntos detectados" }).uncheck();
  await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
    .toHaveCount(0);
  await page.getByRole("checkbox", { name: "Mostrar puntos detectados" }).check();
  await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
    .toBeVisible();
  // This is real model output on the existing licensed synthetic 3D model, not mocked points.
  console.log("Local MediaPipe pose detected on the synthetic BODYVISION anatomical atlas");
  expect(externalPoseRequests).toEqual([]);
  await page.screenshot({ path: "test-results/pose-synthetic-anatomical-body.png", fullPage: true });
});

test("3D simulation opens the same avatar snapshot in local AI pose analysis", async ({ page }) => {
  test.setTimeout(150000);
  await sourceFixtures(page);
  await page.goto("/simulation");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  await page.getByRole("slider", { name: "Ajustar estatura del modelo anatómico" }).fill("185");
  const analyze = page.getByRole("button", { name: "Analizar esta vista 3D con IA" });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect(page).toHaveURL(/\/analysis$/);
  await expect(page.getByRole("region", { name: "Control de calidad recibido" })).toBeVisible();
  await expect(page.getByRole("img", {
    name: "Fotografía local utilizada únicamente para la revisión de pose",
  })).toBeVisible();
  await page.getByRole("button", { name: "Detectar pose con IA" }).click();
  await expect(page.getByRole("region", { name: "Estimación local de pose con IA" }))
    .toContainText("Pose detectada.", { timeout: 90000 });
  await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
    .toBeVisible();
});

test("real local pose matrix records front, lateral, lighting, occlusion and crop of synthetic atlas", async ({ page }) => {
  test.setTimeout(300000);
  await sourceFixtures(page);
  await page.goto("/body-3d");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  const front64 = (await page.locator(".studio-canvas canvas").screenshot()).toString("base64");
  await page.getByRole("button", { name: "Izquierda", exact: true }).click();
  const side64 = (await page.locator(".studio-canvas canvas").screenshot()).toString("base64");

  const unexpectedWrites: string[] = [];
  page.on("request", request => {
    if (/^(POST|PUT|PATCH|DELETE)$/.test(request.method()) &&
        new URL(request.url()).pathname.startsWith("/api/")) {
      unexpectedWrites.push(request.url());
    }
  });
  await page.goto("/capture");
  const observations: SyntheticPoseObservation[] = [];
  const variants = [
    "frontal-control", "lateral-left", "low-light", "overexposed",
    "reduced-resolution", "lower-body-cropped", "horizontal-mirror", "central-occlusion",
  ] as const;
  for (const [i, condition] of variants.entries()) {
    if (i > 0) {
      await page.getByRole("navigation", { name: "Navegación principal" })
        .getByRole("link", { name: "Captura corporal" }).click();
    }
    await page.getByRole("checkbox", {
      name: /Confirmo que utilizaré exclusivamente imágenes ficticias/,
    }).check();
    const base64 = await page.evaluate(async ({ front, side, scenario }) => {
      const source = new Image();
      source.src = "data:image/png;base64," + (scenario === "lateral-left" ? side : front);
      await source.decode();
      const canvas = document.createElement("canvas");
      canvas.width = scenario === "reduced-resolution" ? 360 : source.naturalWidth;
      canvas.height = scenario === "reduced-resolution" ? 480 :
        scenario === "lower-body-cropped" ? Math.round(source.naturalHeight * 0.70) :
        source.naturalHeight;
      const context = canvas.getContext("2d")!;
      if (scenario === "low-light") context.filter = "brightness(0.18)";
      if (scenario === "horizontal-mirror") {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }
      if (scenario === "lower-body-cropped") {
        context.drawImage(source, 0, 0, source.naturalWidth, canvas.height,
          0, 0, canvas.width, canvas.height);
      } else {
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
      }
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.filter = "none";
      if (scenario === "overexposed") {
        context.fillStyle = "rgba(255,255,255,0.94)";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (scenario === "central-occlusion") {
        context.fillStyle = "#111925";
        context.fillRect(canvas.width * 0.25, canvas.height * 0.22,
          canvas.width * 0.50, canvas.height * 0.62);
      }
      return canvas.toDataURL("image/png").split(",")[1];
    }, { front: front64, side: side64, scenario: condition });
    await page.locator('input[type="file"]').setInputFiles({
      name: condition + "-atlas-sintetico.png",
      mimeType: "image/png",
      buffer: Buffer.from(base64, "base64"),
    });
    const capture = page.getByRole("region", { name: "Resultados de calidad local" });
    await expect(capture).toBeVisible();
    // Read the actual quality controls, not an assumed outcome from the scenario name.
    const failedChecks = await capture.locator("li").evaluateAll(items => items
      .map(item => item.querySelector("strong")?.textContent?.trim() ?? "")
      .filter(label => label.startsWith("!"))
      .map(label => label.replace(/^!\s*/, "")));
    if (condition === "low-light" || condition === "overexposed") {
      expect(failedChecks).toContain("Iluminación");
    }
    if (condition === "reduced-resolution") {
      expect(failedChecks).toContain("Resolución");
    }
    await page.getByRole("link", { name: "Ver control de calidad en el módulo de análisis" }).click();
    await page.getByRole("button", { name: "Detectar pose con IA" }).click();
    const result = page.getByRole("region", { name: "Estimación local de pose con IA" });
    await expect(result).toContainText(/Pose detectada\.|No se detectó una pose humana/, { timeout: 90000 });
    const detected = (await result.getByText("Pose detectada.").count()) > 0;
    const resultLabel = (await result.locator(".enterprise-pose-quality strong").innerText())
      .replace("Resultado técnico:", "").trim();
    expect([
      "Sin detección", "Puntos insuficientes", "Requiere revisión",
      "Visible para revisión visual",
    ]).toContain(resultLabel);
    const quality = resultLabel as SyntheticPoseObservation["quality"];
    if (!detected) {
      await expect(result.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
        .toHaveCount(0);
    }
    if (failedChecks.length > 0) {
      expect(quality, "Una captura con avisos no debe declararse lista para revisión")
        .not.toBe("Visible para revisión visual");
    }
    const observed: SyntheticPoseObservation = {
      condition, detected, quality, capturePassed: failedChecks.length === 0, failedChecks,
    };
    observations.push(observed);
    console.log("BODYVISION synthetic pose matrix " + JSON.stringify(observed));
  }
  const summary = summarizeSyntheticPoseMatrix(observations);
  expect(summary.total).toBe(8);
  expect(summary.failedCaptureReviewable).toBe(0);
  expect(summary.inconsistentDetection).toBe(0);
  expect(summary.failedCapture).toBeGreaterThanOrEqual(3);
  expect(unexpectedWrites).toEqual([]);
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/pose-robustness-matrix.json", JSON.stringify({
    source: "pinned synthetic anatomical 3D atlas, frontal and left-side views",
    imageType: "synthetic only",
    dataTransfer: "browser memory; local observations in disposable CI report",
    modelProvenance: "same-origin verified MediaPipe Lite",
    observations,
    summary,
    limitation: "descriptive gate checks on synthetic screenshots, not clinical precision or accuracy",
  }, null, 2));
});

test("mobile atlas uses a bounded GPU pixel budget and lazy polygon overlays on the same body", async ({ page }) => {
  test.setTimeout(100000);
  await page.setViewportSize({ width: 390, height: 844 });
  await sourceFixtures(page);
  await page.goto("/body-3d");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const fluid = page.getByRole("button", { name: "Fluida", exact: true });
  const high = page.getByRole("button", { name: "Alta", exact: true });
  await expect(fluid).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Detalles", exact: true }).click();
  const panel = page.getByLabel("Diagnóstico de renderizado");
  await expect(panel).toContainText("Mallas: 0");
  const pixels = async () => page.locator(".studio-canvas canvas").evaluate(
    (canvas: HTMLCanvasElement) => ({ count: canvas.width * canvas.height, width: canvas.width, height: canvas.height })
  );
  const low = await pixels();
  expect(low.count).toBeLessThanOrEqual(970000);
  await expect(panel).toContainText("Resolución:");
  await page.getByRole("button", { name: "Cerrar diagnóstico" }).click();
  await high.click();
  await expect(high).toHaveAttribute("aria-pressed", "true");
  const detailed = await pixels();
  expect(detailed.count).toBeGreaterThanOrEqual(low.count);
  expect(detailed.count).toBeLessThanOrEqual(2550000);
  const canvas = page.locator(".studio-canvas canvas");
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.down();
  const duringGesture = await pixels();
  expect(duringGesture.count, "A gesture should temporarily reduce GPU fragment work")
    .toBeLessThan(detailed.count);
  await page.mouse.up();
  const restored = await pixels();
  expect(restored.count, "The chosen high-quality resolution must be restored")
    .toBe(detailed.count);
  await page.getByRole("button", { name: "Malla 3D", exact: true }).click();
  await page.getByRole("button", { name: "Detalles", exact: true }).click();
  await expect(panel).not.toContainText("Mallas: 0");
  await page.getByRole("button", { name: "Cerrar diagnóstico" }).click();
  await page.getByRole("button", { name: "Malla 3D", exact: true }).click();
  await expect(page.getByRole("button", { name: "Malla 3D", exact: true })).toHaveAttribute("aria-pressed", "false");
  // The skin's one and only original canvas is preserved across both modes.
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
});

// Regression coverage: the same anatomy canvas works without pointer-only controls.
test("atlas quality automatically follows viewport changes until manually overridden", async ({ page }) => {
  test.setTimeout(110000);
  await page.setViewportSize({ width: 390, height: 844 });
  await sourceFixtures(page);
  await page.goto("/body-3d");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const auto = page.getByRole("button", { name: "Auto", exact: true });
  const high = page.getByRole("button", { name: "Alta", exact: true });
  const fluid = page.getByRole("button", { name: "Fluida", exact: true });
  await expect(auto).toHaveAttribute("aria-pressed", "true");
  await expect(fluid).toHaveAttribute("aria-pressed", "true");
  await page.setViewportSize({ width: 1330, height: 860 });
  await expect(high).toHaveAttribute("aria-pressed", "true");
  await fluid.click();
  await expect(auto).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 1330, height: 860 });
  await expect(fluid).toHaveAttribute("aria-pressed", "true");
  await auto.click();
  await expect(high).toHaveAttribute("aria-pressed", "true");
});

test("fluid quality builds a true geometric LOD and restores the original anatomical mesh in high quality", async ({ page }) => {
  test.setTimeout(120000);
  await sourceFixtures(page);
  await page.goto("/body-3d");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByRole("button", { name: "Fluida", exact: true }).click();
  await page.getByRole("button", { name: "Detalles", exact: true }).click();
  const panel = page.getByLabel("Diagnóstico de renderizado");
  await expect.poll(async () => {
    const line = await panel.getByText(/LOD geométrico:/).innerText();
    return Number(line.match(/LOD geométrico: ([0-9]+) mallas/)?.[1] ?? 0);
  }, { timeout: 35000, message: "A visible large anatomical mesh should become genuinely simpler" })
    .toBeGreaterThan(0);
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Alta", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Detalles", exact: true }).click();
  await expect(page.getByLabel("Diagnóstico de renderizado")).toContainText("LOD geométrico: 0 mallas simplificadas");
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
});

test("anatomical canvas accepts keyboard rotation, zoom, and responds to a simulated context interruption", async ({ page }) => {
  test.setTimeout(110000);
  await sourceFixtures(page);
  await page.goto("/body-3d");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const canvas = page.getByRole("img", { name: /Cuerpo humano anatómico 3D/ });
  await canvas.focus();
  await expect(canvas).toBeFocused();
  const before = await canvas.screenshot();
  await canvas.press("ArrowRight");
  const rotated = await canvas.screenshot();
  expect(before.equals(rotated), "Right arrow should rotate the original atlas camera").toBe(false);
  await canvas.press("+");
  const zoomed = await canvas.screenshot();
  expect(rotated.equals(zoomed), "Plus key should zoom the original atlas camera").toBe(false);
  await canvas.press("Home");
  await canvas.press("Escape");
  await canvas.evaluate(node => node.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
  await expect(viewport(page).getByRole("alert")).toContainText("Se interrumpió la conexión gráfica");
  await canvas.evaluate(node => node.dispatchEvent(new Event("webglcontextrestored")));
  await expect(viewport(page).getByRole("alert")).toHaveCount(0);
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true");
  // The events above test UI recovery; actual GPU driver recovery requires real-device validation.
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
});

test("split reference and scenario share one 3D canvas and block ambiguous pose captures", async ({ page }) => {
  test.setTimeout(110000);
  await sourceFixtures(page);
  await page.goto("/body-3d?panel=simulacion");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  const canvas = page.locator(".studio-canvas canvas");
  const slider = page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" });
  await slider.fill("20");
  const modified = await canvas.screenshot();
  const compare = page.getByRole("button", { name: "Comparar lado a lado", exact: true });
  await compare.click();
  await expect(page.getByLabel("Comparación dividida del mismo modelo 3D")).toBeVisible();
  await expect(page.getByRole("button", { name: "Analizar esta vista 3D con IA" })).toBeDisabled();
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
  const divided = await canvas.screenshot();
  expect(modified.equals(divided), "The left portion must show the original reference").toBe(false);
  const divider = page.getByRole("slider", { name: "Mover separación entre referencia y escenario" });
  await divider.fill("70");
  const moved = await canvas.screenshot();
  expect(divided.equals(moved), "Moving the divider must change how the same mesh is rendered").toBe(false);
  await expect(page.locator(".studio-compare-divider")).toHaveCSS("left", /70%|[0-9]+px/);
  await page.getByRole("slider", { name: "Ajustar estatura del modelo anatómico" }).fill("195");
  await expect(page.getByLabel("Comparación dividida del mismo modelo 3D")).toContainText("195 cm");
  await page.screenshot({ path: "test-results/anatomy-split-comparison.png", fullPage: true });
  await page.getByRole("button", { name: "Cerrar comparación dividida" }).click();
  await expect(page.getByRole("button", { name: "Analizar esta vista 3D con IA" })).toBeEnabled();
  await expect(page.getByLabel("Comparación dividida del mismo modelo 3D")).toHaveCount(0);
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
});

test("live diagnostics count both comparison passes without drawing idle frames or exporting body data", async ({ page }) => {
  test.setTimeout(110000);
  await sourceFixtures(page);
  await page.goto("/body-3d?panel=simulacion");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByRole("button", { name: "Detalles", exact: true }).click();
  const panel = page.getByLabel("Diagnóstico de renderizado");
  await expect(panel).toContainText("Pasadas por fotograma: 1");
  const downloadStats = async (filename: string) => {
    const pending = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Descargar diagnóstico", exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe("bodyvision-render-diagnostics.json");
    await download.saveAs(filename);
    return JSON.parse(readFileSync(filename, "utf8"));
  };
  const single = await downloadStats("test-results/render-single.json");
  expect(single.drawCalls).toBeGreaterThan(0);
  expect(single.triangles).toBeGreaterThan(0);
  expect(single.cpuSubmissionMs).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(single.cpuSubmissionMs)).toBe(true);
  // Wait for two diagnostic refreshes: reading statistics must leave the scene idle.
  await page.waitForTimeout(2200);
  await expect(panel).toHaveAttribute("data-rendered-frames", String(single.renderedFrames));
  await page.getByRole("button", { name: "Comparar lado a lado", exact: true }).click();
  await expect(panel).toContainText("Pasadas por fotograma: 2");
  const split = await downloadStats("test-results/render-split.json");
  // Both unmodified states have identical visible geometry; both passes count.
  expect(split.drawCalls).toBe(single.drawCalls * 2);
  expect(split.triangles).toBe(single.triangles * 2);
  expect(split.meshes).toBe(single.meshes);
  expect(split.geometryBuffers).toBe(single.geometryBuffers);
  expect(Object.keys(split).sort()).toEqual([
    "schemaVersion", "anatomyRevision", "capturedAt", "mode", "interacting", "pixelRatio",
    "bufferWidth", "bufferHeight", "drawCalls", "triangles", "renderPasses",
    "renderedFrames", "cpuSubmissionMs", "contextAvailable", "geometryBuffers",
    "textures", "meshes", "overlays", "lodMeshes", "lodTrianglesSaved", "timingScope",
  ].sort());
  await page.getByRole("button", { name: "Cerrar comparación dividida" }).click();
  await expect(panel).toContainText("Pasadas por fotograma: 1");
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
  await panel.getByRole("button", { name: "Cerrar diagnóstico" }).click();
  await expect(panel).toHaveCount(0);
});
