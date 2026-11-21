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
  const search = page.getByRole("textbox", { name: "Buscar estructura anatómica", exact: true });
  await search.fill("fémur");
  await expect(page.getByRole("option", { name: /Fémur/i }).first()).toBeVisible();
  // Keep the English catalogue term searchable without displaying it as the UI label.
  await search.fill("femur");
  await page.getByRole("option", { name: /Fémur/i }).first().click();
  await expect(page.getByRole("heading", { name: /Fémur/i })).toBeVisible();
  await expect(page.locator(".studio-selected-tag")).toContainText("Fémur");
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

test("anatomical search supports keyboard selection in Spanish without a mouse", async ({ page }) => {
  await sourceFixtures(page);
  await page.goto("/body-3d");
  const input = page.getByRole("textbox", { name: "Buscar estructura anatómica", exact: true });
  await input.fill("fémur");
  await expect(page.getByRole("option", { name: /Fémur/i }).first()).toBeVisible();
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { selected: true })).toHaveCount(1);
  await input.press("Enter");
  await expect(page.getByRole("heading", { name: /Fémur/i })).toBeVisible();
  await expect(input).toHaveValue("");
  await input.fill("femur");
  await input.press("Escape");
  await expect(input).toHaveValue("");
  await expect(page.getByRole("listbox", { name: "Resultados anatómicos" })).toHaveCount(0);
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

test("quick volume scenarios update the same avatar and remain reversible", async ({ page }) => {
  await sourceFixtures(page);
  await page.goto("/body-3d?panel=simulacion");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const slider = page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" });
  await page.getByRole("button", { name: "Mayor volumen +15%" }).click();
  await expect(slider).toHaveValue("15");
  await expect(page.getByRole("button", { name: "Mayor volumen +15%" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Menor volumen −15%" }).click();
  await expect(slider).toHaveValue("-15");
  await page.getByRole("button", { name: "Referencia 0%" }).click();
  await expect(slider).toHaveValue("0");
  await expect(page.getByRole("button", { name: "Referencia 0%" })).toHaveAttribute("aria-pressed", "true");
  const visualLimit = page.getByRole("status", { name: "Límite gráfico de deformación" });
  await expect(visualLimit).toHaveCount(0);
  const referenceKg = page.getByRole("spinbutton", { name: "Peso de referencia (solo demostración)" });
  await referenceKg.fill("200");
  await slider.fill("30");
  await expect(visualLimit).toContainText("Límite visual alcanzado");
  await expect(visualLimit).toContainText("No representa una");
  await slider.fill("0");
  await expect(visualLimit).toHaveCount(0);
  await referenceKg.fill("70");
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
});

test("height presets update the avatar and the hypothetical differences", async ({ page }) => {
  await sourceFixtures(page);
  await page.goto("/body-3d?panel=simulacion");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const height = page.getByRole("slider", { name: "Ajustar estatura del modelo anatómico" });
  const details = page.getByRole("status", { name: "Diferencia hipotética frente a la referencia" });
  await page.getByRole("button", { name: "Alta 195 cm" }).click();
  await expect(height).toHaveValue("195");
  await expect(details).toContainText("Estatura: +20 cm");
  await page.getByRole("button", { name: "Baja 155 cm" }).click();
  await expect(height).toHaveValue("155");
  await expect(details).toContainText("Estatura: -20 cm");
  await page.getByRole("button", { name: "Referencia 175 cm" }).click();
  await expect(height).toHaveValue("175");
  await expect(details).toContainText("Estatura: +0 cm");
  await page.getByRole("button", { name: "Mayor volumen +15%" }).click();
  await expect(details).toContainText("Peso: +10.5 kg");
  await page.getByRole("button", { name: "Restaurar valores" }).click();
  await expect(details).toContainText("Peso: +0 kg");
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
});

test("reference-weight editing deforms one 3D avatar and split view preserves the matching baseline", async ({ page }) => {
  test.setTimeout(110000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await sourceFixtures(page);
  await page.goto("/body-3d?panel=simulacion");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  const highQuality = page.getByRole("button", { name: "Alta", exact: true });
  await highQuality.click();
  await expect(highQuality).toHaveAttribute("aria-pressed", "true");
  const canvas = page.locator(".studio-canvas canvas");
  const weight = page.getByRole("spinbutton", { name: "Peso de referencia (solo demostración)" });
  const variation = page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" });
  // High-quality meshes and GPU uploads can settle after the button responds.
  // Establish a stable original frame before comparing restoration pixels.
  let base = await canvas.screenshot();
  await expect.poll(async () => {
    const next = await canvas.screenshot();
    const stable = next.equals(base);
    base = next;
    return stable;
  }, { timeout: 10000, message: "Original shaded atlas must settle" }).toBe(true);
  await weight.fill("110");
  await expect(weight).toHaveValue("110");
  await expect.poll(async () => !(await canvas.screenshot()).equals(base), {
    timeout: 10000,
    message: "Changing reference weight must change real rendered pixels",
  }).toBe(true);
  const alteredReference = await canvas.screenshot();
  await variation.fill("20");
  await page.getByRole("button", { name: "Comparar lado a lado" }).click();
  const comparison = page.getByLabel("Comparación dividida del mismo modelo 3D");
  await expect(comparison).toContainText("REFERENCIA · 110 kg");
  await expect(comparison).toContainText("ESCENARIO · 132 kg");
  await page.getByRole("slider", { name: "Mover separación entre referencia y escenario" }).fill("70");
  await expect(comparison).toBeVisible();
  await page.getByRole("button", { name: "Cerrar comparación dividida" }).click();
  await page.getByRole("button", { name: "Restaurar valores" }).click();
  await expect(weight).toHaveValue("70");
  await expect(variation).toHaveValue("0");
  // The dedicated regional-morph test above verifies exact 0% pixel restoration.
  // Here, compare against the 110kg screenshot to ensure reverting the reference
  // causes a new visual render, even after split-view WebGL viewport changes.
  await expect.poll(async () => !(await canvas.screenshot()).equals(alteredReference), {
    timeout: 10000,
    message: "Restoring reference weight must visibly undo the 110kg avatar",
  }).toBe(true);
  await expect(page.getByRole("button", { name: "Comparar lado a lado" }))
    .toHaveAttribute("aria-pressed", "false");
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
  // Establish the reference only after the high-quality resize and its WebGL
  // paint settle. aria-pressed confirms React state, not the rendered pixels.
  let reference = await canvas.screenshot();
  await expect.poll(async () => {
    const next = await canvas.screenshot();
    const settled = next.equals(reference);
    reference = next;
    return settled;
  }, { timeout: 10000, message: "The 0% reference must settle before changing weight" }).toBe(true);
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

test("synthetic history pages and CSV export never include observed records or arbitrary notes", async ({ page }) => {
  const saved = await page.request.post("/api/v1/profiles", {
    data: { birth_year: 1997, display_name: "Caso ficticio de paginación de simulaciones" },
  });
  expect(saved.status()).toBe(201);
  const profileId = (await saved.json() as { id: string }).id;
  const scenarioUrl = `/api/v1/profiles/${profileId}/scenarios`;
  const pagesRequested: number[] = [];
  await page.route(`**${scenarioUrl}?**`, async route => {
    const requestUrl = new URL(route.request().url());
    const offset = Number(requestUrl.searchParams.get("offset") ?? 0);
    pagesRequested.push(offset);
    const items = Array.from({ length: offset === 20 ? 5 : 20 }, (_, index) => ({
      id: crypto.randomUUID(),
      series_id: crypto.randomUUID(), profile_id: profileId,
      prior_version_id: null, version: 1,
      reference_kg: 70, variation_percent: 15, stature_cm: 175, simulated_kg: 80.5,
      model_revision: offset === 20 && index === 0 ? "0".repeat(40) : "28912432581accd7a1c62129d55f0e9758221d48",
      algorithm_revision: "regional-soft-tissue-v2",
      revision_note: "=HYPERLINK(\"danger\")", created_by: crypto.randomUUID(),
      created_at: "2026-11-20T13:00:00Z", data_type: "SIMULADO",
    }));
    await route.fulfill({ json: { items, offset, total: 25, limit: 20 } });
  });
  await sourceFixtures(page);
  await page.goto(`/body-3d?panel=simulacion&profile=${profileId}`);
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const history = page.getByRole("region", { name: "Historial de escenarios simulados" });
  await expect(history.getByRole("status", { name: "Página del historial simulado" }))
    .toContainText("Versiones 1–20 de 25");
  // A stored snapshot can be the left baseline of a split rendering of
  // the current synthetic scenario, with no additional model instance.
  await history.getByRole("button", { name: "Fijar como referencia" }).first().click();
  const comparison = page.getByLabel("Comparación dividida del mismo modelo 3D");
  await expect(comparison).toContainText("HISTÓRICO v1 · 80.5 kg / 175 cm");
  await expect(history.getByRole("button", { name: "Fijar como referencia" }).first())
    .toHaveAttribute("aria-pressed", "true");
  const height = page.getByRole("slider", { name: "Ajustar estatura del modelo anatómico" });
  await height.fill("195");
  await expect(comparison).toContainText("HISTÓRICO v1 · 80.5 kg / 175 cm");
  await expect(comparison).toContainText("ESCENARIO · 70 kg / 195 cm");
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
  await page.getByRole("button", { name: "Quitar referencia histórica" }).click();
  await expect(comparison).toContainText("REFERENCIA · 70 kg / 175 cm");
  await page.getByRole("button", { name: "Cerrar comparación dividida" }).click();
  const exportButton = history.getByRole("button", { name: "Exportar página CSV" });
  const firstDownload = page.waitForEvent("download");
  await exportButton.click();
  const firstFile = await firstDownload;
  expect(firstFile.suggestedFilename()).toBe("bodyvision-escenarios-simulados-pagina.csv");
  const csv = readFileSync((await firstFile.path())!, "utf8");
  expect(csv).toContain("SIMULADO");
  expect(csv).toContain("80.5");
  expect(csv).not.toContain("HYPERLINK");
  expect(csv).not.toContain(profileId);
  expect(csv).not.toContain("OBSERVADO");
  expect(csv.trim().split("\n")).toHaveLength(21);
  await history.getByRole("button", { name: "Siguientes 20" }).click();
  await expect(history.getByRole("status", { name: "Página del historial simulado" }))
    .toContainText("Versiones 21–25 de 25");
  const items = history.getByRole("list", { name: "Versiones de simulación guardadas" });
  await expect(items).toHaveCount(1);
  const incompatible = items.locator("li").first();
  await expect(incompatible).toContainText("El modelo anatómico usado para guardar esta versión es diferente");
  await expect(incompatible.getByRole("button", { name: "Cargar en 3D" })).toBeDisabled();
  await expect(incompatible.getByRole("button", { name: "Fijar como referencia" })).toBeDisabled();
  await expect(items.locator("li").nth(1).getByRole("button", { name: "Cargar en 3D" }))
    .toBeEnabled();
  await expect(history.getByRole("button", { name: "Siguientes 20" })).toBeDisabled();
  await history.getByRole("button", { name: "Anteriores 20" }).click();
  await expect(history.getByRole("status", { name: "Página del historial simulado" }))
    .toContainText("Versiones 1–20 de 25");
  expect(pagesRequested).toEqual(expect.arrayContaining([0, 20, 0]));
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
  await expect(chain).toContainText("Versión 1");
  await expect(chain).toContainText("Versión 2");
  await chain.getByRole("button", { name: "Cargar v1 en 3D" }).click();
  await expect(page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" }))
    .toHaveValue("0");
  await chain.getByRole("button", { name: "Cargar v2 en 3D" }).click();
  await expect(page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" }))
    .toHaveValue("20");
  await chain.getByRole("button", { name: "Fijar v1 como referencia" }).click();
  const historicalSplit = page.getByLabel("Comparación dividida del mismo modelo 3D");
  await expect(historicalSplit).toContainText("HISTÓRICO v1 · 70 kg / 175 cm");
  await expect(historicalSplit).toContainText("ESCENARIO · 84 kg / 175 cm");
  await expect(page.getByLabel("Diferencias visuales frente a la versión histórica"))
    .toContainText("Diferencia frente a v1: +14.0 kg · +0 cm");
  await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
  await expect(chain.getByRole("button", { name: "Fijar v1 como referencia" }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Quitar referencia histórica" }).click();
  await expect(historicalSplit).toContainText("REFERENCIA · 70 kg / 175 cm");

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
  await page.getByRole("textbox", { name: "Buscar estructura anatómica", exact: true }).fill("fémur");
  await expect(page.getByRole("option", { name: /Fémur/i }).first()).toBeVisible();
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
  // The export is generated only by this click and contains no photo or landmarks.
  const poseReportDownload = page.waitForEvent("download");
  await result.getByRole("button", { name: "Descargar resumen de revisión de pose (JSON)" }).click();
  const poseReport = await poseReportDownload;
  expect(poseReport.suggestedFilename()).toBe("bodyvision-revision-pose-sintetica.json");
  const poseReportFile = await poseReport.path();
  expect(poseReportFile).not.toBeNull();
  const reportJson = readFileSync(poseReportFile!, "utf8");
  const reviewReport = JSON.parse(reportJson) as Record<string, unknown>;
  expect(reviewReport).toMatchObject({
    schemaVersion: 1,
    reportKind: "bodyvision-synthetic-pose-review",
    clinicalAccuracyValidated: false,
    containsPhoto: false,
    containsLandmarks: false,
    containsIdentifiers: false,
    pose: { detected: true },
  });
  expect(reportJson).not.toMatch(/atlas-anatomico-sintetico|data:image|fileName|"landmarks":|rawLandmarks|userAgent|deviceId/i);

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

test("3D studio exports the existing synthetic avatar as a valid PNG without API writes", async ({ page }) => {
  test.setTimeout(110000);
  await sourceFixtures(page);
  const writes: string[] = [];
  page.on("request", request => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/simulation");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const exportButton = page.getByRole("button", { name: "Descargar imagen 3D (PNG)" });
  await expect(exportButton).toBeEnabled();
  const pendingDownload = page.waitForEvent("download");
  await exportButton.click();
  const downloaded = await pendingDownload;
  expect(downloaded.suggestedFilename()).toBe("bodyvision-atlas-3d-sintetico.png");
  const filePath = await downloaded.path();
  expect(filePath).not.toBeNull();
  const pngBytes = readFileSync(filePath!);
  expect([...pngBytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(pngBytes.length).toBeGreaterThan(5000);
  await expect(page.getByRole("button", { name: "Analizar esta vista 3D con IA" })).toBeEnabled();
  await page.getByRole("button", { name: "Comparar lado a lado" }).click();
  await expect(exportButton).toBeDisabled();
  await expect(page.getByRole("button", { name: "Analizar esta vista 3D con IA" })).toBeDisabled();
  const compareButton = page.getByRole("button", { name: "Descargar comparación (PNG)" });
  await expect(compareButton).toBeEnabled();
  const pendingComparison = page.waitForEvent("download");
  await compareButton.click();
  const comparisonFile = await pendingComparison;
  expect(comparisonFile.suggestedFilename()).toBe("bodyvision-comparacion-3d-sintetica.png");
  const comparisonPath = await comparisonFile.path();
  expect(comparisonPath).not.toBeNull();
  const bytes = readFileSync(comparisonPath!);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  // The annotated export retains the source aspect ratio and adds a
  // 96-pixel legend beneath it; it is not the portrait-only AI handoff.
  expect(bytes.readUInt32BE(16)).toBe(pngBytes.readUInt32BE(16));
  expect(bytes.readUInt32BE(20)).toBe(pngBytes.readUInt32BE(20) + 96);
  expect(writes).toEqual([]);
});

test("3D simulation opens the same avatar snapshot in local AI pose analysis", async ({ page }) => {
  test.setTimeout(150000);
  await sourceFixtures(page);
  await page.goto("/simulation");
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  // Regression: expanding the long simulation form must not silently turn
  // a ~740px 3D scene into a >2500px tall canvas that cannot be captured.
  const atlasHeight = await page.locator(".studio-canvas canvas").evaluate(
    element => element.getBoundingClientRect().height,
  );
  expect(atlasHeight, "3D viewport should be bounded independently of simulator controls").toBeLessThan(950);
  const scrollable = await page.locator(".studio-right-content").evaluate(
    element => element.scrollHeight > element.clientHeight,
  );
  expect(scrollable, "simulation controls should scroll inside the right panel").toBe(true);
  await page.getByRole("button", { name: "Frente", exact: true }).click();
  await page.getByRole("slider", { name: "Ajustar estatura del modelo anatómico" }).fill("185");
  const analyze = page.getByRole("button", { name: "Analizar esta vista 3D con IA" });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expect(page).toHaveURL(/\/analysis$/);
  const captureReview = page.getByRole("region", { name: "Control de calidad recibido" });
  await expect(captureReview).toBeVisible();
  await expect(captureReview).toContainText("4 de 4 criterios cumplidos");
  await expect(page.getByRole("img", {
    name: "Fotografía local utilizada únicamente para la revisión de pose",
  })).toBeVisible();
  await page.getByRole("button", { name: "Detectar pose con IA" }).click();
  await expect(page.getByRole("region", { name: "Estimación local de pose con IA" }))
    .toContainText("Pose detectada.", { timeout: 90000 });
  await expect(page.getByRole("img", { name: "Puntos corporales detectados por el modelo" }))
    .toBeVisible();
  // Extra diagnostic is explicit and runs on this same approved fictitious atlas.
  await page.getByRole("checkbox", { name: /Confirmo que esta imagen es ficticia/ }).check();
  await page.getByRole("button", { name: "Diagnosticar etapas (1 ejecución)" }).click();
  const stages = page.getByLabel("Etapas de inferencia local");
  await expect(stages).toBeVisible({ timeout: 90000 });
  await expect(stages).toContainText("Preparación de imagen:");
  await expect(stages).toContainText("Heap JavaScript antes:");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Descargar informe técnico (JSON)" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("bodyvision-rendimiento-local-sintetico.json");
  const saved = await download.path();
  expect(saved).not.toBeNull();
  const report = JSON.parse(readFileSync(saved!, "utf8")) as Record<string, unknown>;
  expect(report).toMatchObject({
    schemaVersion: 1,
    reportKind: "bodyvision-local-pose-performance",
    actualMobileHardwareVerified: false,
    containsPhoto: false,
    containsLandmarks: false,
    capture: { qualityPassed: true },
    pose: { detected: true },
  });
  const exported = JSON.stringify(report);
  expect(exported).not.toMatch(/atlas-anatomico|modelo-3d-sintetico|blob:|fileName|rawLandmarks|base64|userAgent|deviceId/i);
  expect(report.stageDiagnostic).not.toBeNull();
});

test("real local pose matrix tests atlas variants and a well-lit no-person control", async ({ page }) => {
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
    "negative-no-person",
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
      // Independent negative control: passes basic capture-quality rules, but
      // contains no human figure. This prevents a matrix made only of
      // rejected captures from giving vacuous safety evidence.
      if (scenario === "negative-no-person") {
        const canvas = document.createElement("canvas");
        canvas.width = 800;
        canvas.height = 1100;
        const context = canvas.getContext("2d")!;
        const background = context.createLinearGradient(0, 0, 0, canvas.height);
        background.addColorStop(0, "#405f87");
        background.addColorStop(1, "#dfba93");
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png").split(",")[1];
      }
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
    if (condition === "negative-no-person") {
      expect(failedChecks, "El control negativo debe superar la calidad básica").toEqual([]);
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
    if (condition === "negative-no-person") {
      expect(detected, "Una imagen sintética sin cuerpo no debe mostrar pose").toBe(false);
      expect(quality).toBe("Sin detección");
    }
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
  expect(summary.total).toBe(9);
  expect(summary.notDetected).toBeGreaterThanOrEqual(1);
  expect(summary.failedCapture).toBeLessThan(summary.total);
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


/**
 * Real Chromium mobile-viewport/touch emulation, not a physical device test.
 * In particular, a GPU-budgeted mobile WebGL capture is less than the 720px
 * photographic preflight threshold: it must visibly retain that warning
 * instead of claiming a quality-assured image. No invented pose outcomes.
 */
test.describe("mobile touch emulation (not real phone hardware)", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  test("touch simulation retains GPU limits, quality warnings and local MediaPipe flow", async ({ page }) => {
    test.setTimeout(180000);
    const scriptErrors: string[] = [];
    const unauthorizedWrites: string[] = [];
    page.on("pageerror", error => scriptErrors.push(error.message));
    page.on("request", request => {
      if (/^(POST|PUT|PATCH|DELETE)$/.test(request.method()) &&
          new URL(request.url()).pathname.startsWith("/api/")) {
        unauthorizedWrites.push(request.url());
      }
    });
    await sourceFixtures(page);
    await page.goto("/simulation");
    await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
    const mobileCapabilities = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      touch: navigator.maxTouchPoints,
      coarse: matchMedia("(pointer: coarse)").matches,
      dpr: devicePixelRatio,
    }));
    expect(mobileCapabilities.width).toBe(390);
    expect(mobileCapabilities.scrollWidth).toBeLessThanOrEqual(392);
    expect(mobileCapabilities.touch).toBeGreaterThan(0);
    expect(mobileCapabilities.coarse).toBe(true);
    expect(mobileCapabilities.dpr).toBe(2);
    await expect(page.getByRole("button", { name: "Fluida", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    const canvas = page.locator(".studio-canvas canvas");
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toBeVisible();
    const pixelCount = await canvas.evaluate((element: HTMLCanvasElement) =>
      element.width * element.height);
    expect(pixelCount, "GPU surface in mobile fluid mode remains below its pixel budget")
      .toBeLessThanOrEqual(970000);

    await page.getByRole("button", { name: "Frente", exact: true }).tap();
    const weight = page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" });
    await weight.fill("15");
    await expect(page.locator(".studio-weight-indicator")).toContainText("+15%");
    await page.getByRole("button", { name: "Malla 3D", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Malla 3D", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Malla 3D", exact: true }).tap();
    await expect(canvas).toHaveCount(1);

    // Rotating the device does not switch away from low-fill-rate rendering.
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole("button", { name: "Fluida", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(viewport(page)).toHaveAttribute("data-loaded", "true");
    await page.getByRole("button", { name: "Frente", exact: true }).tap();

    // An explicit snapshot re-renders the SAME 3D mesh at actual higher GPU
    // resolution. The fluid on-screen canvas never remains in capture mode.
    await page.getByRole("button", { name: "Analizar esta vista 3D con IA" }).tap();
    await expect(page).toHaveURL(/\/analysis$/);
    const capture = page.getByRole("region", { name: "Control de calidad recibido" });
    await expect(capture).toBeVisible();
    // A flat darker matte is composited only onto the synthetic handoff PNG;
    // the real 3D model and all four independent quality gates stay unchanged.
    await expect(capture).toContainText("4 de 4 criterios cumplidos");
    const checks = await capture.locator("li strong").allTextContents();
    expect(checks.map(text => text.trim())).toEqual([
      "✓ Resolución", "✓ Iluminación", "✓ Contraste", "✓ Encuadre vertical",
    ]);
    await expect(capture).toContainText("Ambos lados tienen al menos 720 píxeles.");
    const image = page.getByRole("img", {
      name: "Fotografía local utilizada únicamente para la revisión de pose",
    });
    await expect(image).toBeVisible();
    const realDimensions = await image.evaluate((el: HTMLImageElement) => ({
      width: el.naturalWidth, height: el.naturalHeight,
    }));
    expect(Math.min(realDimensions.width, realDimensions.height))
      .toBeGreaterThanOrEqual(800);
    expect(realDimensions.width * realDimensions.height).toBeLessThanOrEqual(2_400_000);

    // The local model runs nevertheless; record only an honest detect/no-detect
    // outcome, never fabricated landmarks or a clinical quality claim.
    await page.getByRole("button", { name: "Detectar pose con IA" }).tap();
    const pose = page.getByRole("region", { name: "Estimación local de pose con IA" });
    await expect(pose).toContainText(/Pose detectada\.|No se detectó una pose humana/, {
      timeout: 90000,
    });
    await page.getByRole("checkbox", { name: /Confirmo que esta imagen es ficticia/ }).check();
    await page.getByRole("button", { name: "Diagnosticar etapas (1 ejecución)" }).tap();
    const stages = page.getByLabel("Etapas de inferencia local");
    await expect(stages).toBeVisible({ timeout: 90000 });
    await expect(stages).toContainText("Heap JavaScript");
    // Verify navigating back does not leave the real-time GPU surface in
    // high-resolution capture mode; preserve the fluid preview budget.
    await page.goto("/simulation");
    await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
    const restoredPixels = await page.locator(".studio-canvas canvas")
      .evaluate((element: HTMLCanvasElement) => element.width * element.height);
    expect(restoredPixels).toBeLessThanOrEqual(970000);
    await expect(page.getByRole("button", { name: "Fluida", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    expect(scriptErrors).toEqual([]);
    expect(unauthorizedWrites).toEqual([]);
  });

  test("repeated mobile synthetic captures after orientation changes never reuse obsolete pose results", async ({ page }) => {
    test.setTimeout(180000);
    const scriptErrors: string[] = [];
    page.on("pageerror", error => scriptErrors.push(error.message));
    await sourceFixtures(page);
    await page.goto("/simulation");
    await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });

    // First, the unchanged atlas is rendered at the center of a portrait UI.
    await page.getByRole("button", { name: "Frente", exact: true }).tap();
    await page.getByRole("button", { name: "Analizar esta vista 3D con IA" }).tap();
    await expect(page).toHaveURL(/\/analysis$/);
    const quality = page.getByRole("region", { name: "Control de calidad recibido" });
    await expect(quality).toContainText("4 de 4 criterios cumplidos");
    await page.getByRole("button", { name: "Detectar pose con IA" }).tap();
    const pose = page.getByRole("region", { name: "Estimación local de pose con IA" });
    await expect(pose).toContainText(/Pose detectada\.|No se detectó una pose humana/, {
      timeout: 90000,
    });
    await page.getByRole("button", { name: "Repetir detección" }).tap();
    await expect(pose).toContainText(/Pose detectada\.|No se detectó una pose humana/, {
      timeout: 90000,
    });

    // Return to the same anatomically shaded body. A landscape-to-portrait
    // change must not preserve a previous capture surface or pose estimate.
    await page.goto("/simulation");
    await expect(viewport(page)).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator(".studio-canvas canvas")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Frente", exact: true }).tap();
    await expect(page.locator(".studio-canvas canvas")).toHaveCount(1);
    await page.getByRole("button", { name: "Analizar esta vista 3D con IA" }).tap();
    await expect(page).toHaveURL(/\/analysis$/);
    await expect(quality).toContainText("4 de 4 criterios cumplidos");
    expect(await page.getByRole("img", {
      name: "Fotografía local utilizada únicamente para la revisión de pose",
    }).evaluate((image: HTMLImageElement) => Math.min(image.naturalWidth, image.naturalHeight)))
      .toBeGreaterThanOrEqual(800);
    await expect(page.getByRole("button", { name: "Detectar pose con IA" })).toBeEnabled();
    await page.getByRole("button", { name: "Detectar pose con IA" }).tap();
    await expect(pose).toContainText(/Pose detectada\.|No se detectó una pose humana/, {
      timeout: 90000,
    });
    expect(scriptErrors).toEqual([]);
  });

});
