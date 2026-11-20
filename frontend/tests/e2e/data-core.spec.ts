import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

test("create, measure, correct, inspect versions, derive and isolate workspaces", async ({
  page,
}) => {
  await page.goto("/profiles");
  await page
    .getByRole("button", { name: "+ Nuevo expediente", exact: true })
    .click();
  await page
    .getByRole("textbox", {
      name: "Nombre de referencia (opcional)",
      exact: true,
    })
    .fill("Expediente ficticio E2E");
  await page
    .getByRole("spinbutton", { name: "Año de nacimiento", exact: true })
    .fill("1995");
  await page
    .getByRole("button", { name: "Crear expediente", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Expediente ficticio E2E", exact: true }),
  ).toBeVisible();
  const profileUrl = page.url();
  await page
    .getByRole("button", { name: "+ Registrar medición", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Valor (kg)", exact: true })
    .fill("72");
  await page
    .getByRole("button", { name: "Guardar medición", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "72 kg", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Corregir", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "Valor (kg)", exact: true })
    .fill("71");
  await page
    .getByRole("textbox", { name: "Motivo de la corrección", exact: true })
    .fill("Corrección ficticia de prueba");
  await page
    .getByRole("button", { name: "Guardar corrección", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("cell", { name: "71 kg", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ver versiones", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Versión 1 · 72 kg", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Versión 2 · 71 kg", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cerrar diálogo", exact: true })
    .click();
  await page
    .getByRole("button", { name: "+ Registrar medición", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Métrica", exact: true })
    .selectOption("height");
  await page
    .getByRole("spinbutton", { name: "Valor (cm)", exact: true })
    .fill("180");
  await page
    .getByRole("button", { name: "Guardar medición", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await expect(page.getByText("21.914")).toBeVisible();
  await expect(page.getByText("DERIVADO", { exact: true })).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await page
    .getByRole("combobox", { name: "Organización ficticia", exact: true })
    .selectOption("10000000-0000-4000-8000-000000000002");
  await page.goto(profileUrl);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Expediente ficticio E2E", exact: true }),
  ).not.toBeVisible();
});

test("correcting a value preserves sub-minute time unless the Lima date is explicitly edited", async ({
  page, request,
}) => {
  const headers = { "X-Workspace-ID": "10000000-0000-4000-8000-000000000001" };
  const created = await request.post("/api/v1/profiles", {
    headers, data: { display_name: "Corrección precisa ficticia", birth_year: 1995 },
  });
  expect(created.status()).toBe(201);
  const profile = await created.json();
  const recorded = await request.post(`/api/v1/profiles/${profile.id}/measurements`, {
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    data: { metric_code: "weight", value: 72, unit: "kg", method: "manual",
      measured_at: "2026-10-01T03:04:56.789123Z" },
  });
  expect(recorded.status()).toBe(201);
  const original = await recorded.json();
  await page.goto(`/profiles/${profile.id}?tab=measurements`);
  await expect(page.getByRole("cell", { name: "72 kg", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Corregir", exact: true }).click();
  await expect(page.getByLabel("Fecha y hora (Lima)")).toHaveValue("2026-09-30T22:04");
  await page.getByRole("spinbutton", { name: "Valor (kg)", exact: true }).fill("71");
  await page.getByRole("textbox", { name: "Motivo de la corrección", exact: true })
    .fill("Ajustar solo el valor ficticio");
  const saving = page.waitForResponse(response => response.request().method() === "PATCH"
    && response.url().endsWith(`/measurements/${original.id}`));
  await page.getByRole("button", { name: "Guardar corrección", exact: true }).click();
  const saved = await saving;
  expect(saved.status()).toBe(201);
  const corrected = await saved.json();
  expect(corrected.measured_at).toBe(original.measured_at);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("cell", { name: "71 kg", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Corregir", exact: true }).click();
  await page.getByLabel("Fecha y hora (Lima)").fill("2026-10-02T10:20");
  await page.getByRole("textbox", { name: "Motivo de la corrección", exact: true })
    .fill("Cambiar expresamente la fecha ficticia");
  const rescheduling = page.waitForResponse(response => response.request().method() === "PATCH"
    && response.url().endsWith(`/measurements/${corrected.id}`));
  await page.getByRole("button", { name: "Guardar corrección", exact: true }).click();
  const rescheduled = await rescheduling;
  expect(rescheduled.status()).toBe(201);
  const final = await rescheduled.json();
  expect(Date.parse(final.measured_at)).toBe(Date.parse("2026-10-02T10:20:00-05:00"));
  const history = await request.get(`/api/v1/measurements/${original.id}/versions`, { headers });
  expect(history.status()).toBe(200);
  const versions = await history.json();
  expect(versions.map((row: { measured_at: string }) => row.measured_at))
    .toEqual([original.measured_at, original.measured_at, final.measured_at]);
  expect(versions.map((row: { value: number }) => row.value)).toEqual([72, 71, 71]);
});

test("seeded dashboard, mobile layout and historical chart", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Dashboard general",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("DATOS FICTICIOS DE DESARROLLO", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Expedientes", exact: true }).click();
  await page.getByRole("searchbox").fill("FICT-01");
  await page.getByRole("link", { name: /Expediente ficticio 01/ }).click();
  await page.getByRole("button", { name: "Evolución", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Periodo", exact: true })
    .selectOption("all");
  await expect(page.getByRole("img", { name: /Gráfico con/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comparar dos fechas" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Medición inicial" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Medición final" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Diferencia de mediciones observadas" }))
    .toContainText("Variación");
  await expect(
    page.getByText("⚑ Atípico confirmado", { exact: true }),
  ).toBeVisible();
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("demo metadata makes all profile editing controls read-only", async ({
  page,
}) => {
  await page.route("**/api/v1/workspaces", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, read_only: true } });
  });
  await page.goto("/profiles");
  await expect(
    page.getByText("DEMOSTRACIÓN · SOLO LECTURA", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Vista de solo lectura", exact: true }),
  ).toBeDisabled();
  await page.getByRole("searchbox").fill("FICT-01");
  await page.getByRole("link", { name: /Expediente ficticio 01/ }).click();
  await expect(
    page.getByRole("button", { name: "+ Registrar medición", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Editar referencia", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Archivar expediente", exact: true }),
  ).toBeDisabled();
});
