import { expect, test } from "@playwright/test";
import { overallProgress } from "../../src/features/progress/projectProgress";

test("project phases show an explained progress estimate", async ({ page }) => {
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Progreso de implementación" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Avance estimado del proyecto" })).toHaveAttribute("aria-valuenow", String(overallProgress));
  await expect(page.locator(".project-phase-card")).toHaveCount(10);
  await expect(page.getByText(/Estimación manual/).first()).toBeVisible();
  await page.getByRole("link", { name: "BODYVISION AI" }).first().click();
  await expect(page.getByRole("progressbar", { name: "Avance estimado del proyecto" })).toBeVisible();
});
