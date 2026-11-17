import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("live API, keyboard navigation and accessibility", async ({ page }) => {
  await page.goto("/system");
  await expect(page.getByText("✓ API en ejecución")).toBeVisible();
  await expect(page.getByText("✓ Base de datos conectada")).toBeVisible();
  const before = await page.locator(".service-card").first().textContent();
  await page
    .getByRole("button", { name: "Volver a consultar" })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Volver a consultar" }).first(),
  ).toBeEnabled();
  expect(before).toContain("Versión:");
  await page.goto("/system");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Saltar al contenido" }),
  ).toBeFocused();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
});

test("mobile layout has no horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/system");
  await expect(page.getByText("✓ Base de datos conectada")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("readiness failure is visible while liveness remains available", async ({
  page,
}) => {
  await page.route("**/api/v1/health/ready", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"code":"NOT_READY"}',
    }),
  );
  await page.goto("/system");
  await expect(page.getByText("✓ API en ejecución")).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/v1/health/ready");
  await page
    .getByRole("article", { name: "Persistencia y esquema" })
    .getByRole("button")
    .click();
  await expect(page.getByText("✓ Base de datos conectada")).toBeVisible();
});
