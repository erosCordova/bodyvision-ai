import { expect, test } from "@playwright/test";

test.use({ launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] } });
test.setTimeout(90000);

test("dashboard displays the textured person instead of the old line silhouette", async ({ page }) => {
  const errors: string[] = [];
  const requested: string[] = [];
  page.on("request", request => requested.push(request.url()));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  const card = page.getByRole("region", { name: "Exploración anatómica" });
  await expect(card.getByRole("heading", { name: "Exploración corporal" })).toBeVisible();
  await expect(card.locator(".enterprise-realbody-preview")).toHaveAttribute("data-loaded", "true", { timeout: 60000 });
  const body = card.locator(".enterprise-realbody-canvas canvas");
  await expect(body).toBeVisible();
  await expect(body).toHaveAttribute("aria-label", /Cuerpo humano anatómico 3D/);
  expect(requested.some(url => url.endsWith("/web/public/models/skin.glb"))).toBe(true);
  expect(requested.some(url => url.includes("adult-demo.glb.gz"))).toBe(false);
  await expect(card.locator("svg")).toHaveCount(0);
  const pixels = await body.screenshot();
  expect(pixels.length, "The actual 3D model should render on the dashboard").toBeGreaterThan(10000);
  await expect(card.getByRole("link", { name: /Explorar cuerpo 3D/ })).toHaveAttribute("href", "/body-3d");
  expect(errors).toEqual([]);
  await page.screenshot({ path: "test-results/dashboard-realbody-desktop.png", fullPage: true });
});
