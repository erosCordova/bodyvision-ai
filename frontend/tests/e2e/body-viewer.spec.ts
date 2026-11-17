import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });

test("licensed 3D body renders, responds to controls and resets without writes", async ({ page }) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writes.push(request.url()); });
  await page.goto("/body-3d");
  const stage = page.getByRole("region", { name: "Visor corporal 3D", exact: true });
  await expect(stage).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  await expect(page.getByRole("img", { name: /Cuerpo humano 3D/ })).toBeVisible();
  await page.getByLabel("Estatura ilustrativa", { exact: true }).fill("190");
  await expect(page.locator('output[for="body-height"]')).toContainText("190");
  await page.getByLabel("Peso ilustrativo", { exact: true }).fill("105");
  await page.getByRole("button", { name: "Posterior", exact: true }).click();
  await expect(page.getByRole("button", { name: "Posterior", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Mostrar malla", { exact: true }).check();
  await page.getByRole("button", { name: "Restablecer modelo", exact: true }).click();
  await expect(page.locator('output[for="body-height"]')).toContainText("175");
  await expect(page.locator('output[for="body-weight"]')).toContainText("72");
  await expect(page.getByLabel("Mostrar malla", { exact: true })).not.toBeChecked();
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByLabel("Giro automático", { exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/body-viewer-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "test-results/body-viewer-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

test("3D asset failure is actionable and retry recovers", async ({ page }) => {
  await page.route("**/adult-demo.glb.gz", route => route.fulfill({ status: 503, body: "unavailable" }));
  await page.goto("/body-3d");
  await expect(page.getByRole("alert")).toContainText("No se pudo abrir el modelo 3D");
  await page.unroute("**/adult-demo.glb.gz");
  await page.getByRole("button", { name: "Recargar visor", exact: true }).click();
  await expect(page.getByRole("region", { name: "Visor corporal 3D", exact: true })).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
});
