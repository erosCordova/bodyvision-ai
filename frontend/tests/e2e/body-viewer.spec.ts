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
  await page.getByRole("tab", { name: "Recorridos", exact: true }).click();
  await expect(page.getByText("Viaje por el esqueleto", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Restaurar visualización/ }).click();
  await expect(viewport(page)).toHaveAttribute("data-loaded", "true");
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
