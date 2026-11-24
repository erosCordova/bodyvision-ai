import { expect, test } from "@playwright/test";
import { overallProgress } from "../../src/features/progress/projectProgress";

test("project phases show an explained progress estimate", async ({ page }) => {
  await page.goto("/progress");
  await expect(page.getByRole("heading", { name: "Progreso de implementación" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Avance estimado del proyecto" })).toHaveAttribute("aria-valuenow", String(overallProgress));
  await expect(page.locator(".project-phase-card")).toHaveCount(10);
  const audit = page.getByRole("region", { name: "Auditoría de cierre de fases 0 a 2" });
  await expect(audit).toBeVisible();
  await expect(audit.locator(".project-acceptance-card")).toHaveCount(3);
  await expect(audit.getByText("Aceptación de producto:", { exact: false })).toHaveCount(3);
  await expect(audit.getByText(/Aceptación de producto: Aprobada expresamente/)).toHaveCount(2);
  await expect(audit.getByText(/Aceptación de producto: Pendiente/)).toHaveCount(1);
  await expect(audit.getByRole("link", { name: "Abrir matriz completa" })).toHaveAttribute("rel", "noopener noreferrer");
  await expect(audit.getByText(/F1–F10/)).toBeVisible();
  await expect(page.getByText(/Estimación manual/).first()).toBeVisible();
  await page.getByRole("link", { name: "BODYVISION AI" }).first().click();
  await expect(page.getByRole("heading", { name: "Dashboard general" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Avance estimado del proyecto" })).toHaveCount(0);
});
