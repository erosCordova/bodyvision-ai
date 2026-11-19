import { expect, test } from "@playwright/test";

test("one anatomical 3D viewer updates stature, weight and mesh together", async ({ page }) => {
  await page.goto("/simulation");
  await expect(page.getByRole("heading", { name: "Simulador de peso y estatura" })).toBeVisible();
  const stature = page.getByRole("slider", { name: "Ajustar estatura del modelo anatómico" });
  const weight = page.getByRole("slider", { name: "Aumentar o disminuir peso en el modelo anatómico" });
  await expect(stature).toHaveValue("175");
  await expect(weight).toHaveValue("0");

  await stature.focus();
  await stature.press("End");
  await expect(stature).toHaveValue("205");
  await weight.focus();
  await weight.press("End");
  await expect(weight).toHaveValue("30");

  const overlay = page.getByRole("checkbox", { name: /Superponer malla poligonal/ });
  await overlay.check();
  await expect(overlay).toBeChecked();
  await page.getByRole("button", { name: "Guardar comparación en esta vista" }).click();
  await expect(page.locator(".studio-sim-saved")).toContainText("205 cm");
  await expect(page.locator(".studio-sim-saved")).toContainText("91 kg");

  await page.getByRole("button", { name: "Comparar con el original" }).click();
  await expect(page.getByText("REFERENCIA CORPORAL ORIGINAL")).toBeVisible();
  await page.getByRole("button", { name: "Ver escenario modificado" }).click();
  await page.getByRole("button", { name: "Restaurar valores" }).click();
  await expect(stature).toHaveValue("175");
  await expect(weight).toHaveValue("0");
});
