import { lstatSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

const statePath = process.env.BODYVISION_RECOVERY_STATE!;
const info = lstatSync(statePath);
if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 16384) {
  throw new Error("Unsafe private recovery state");
}
const state = z.object({
  profile: z.string().uuid(), account_password: z.string().min(12),
  browser_code: z.string().length(32), browser_second_code: z.string().length(32),
}).parse(JSON.parse(readFileSync(statePath, "utf8")));
const organization = "10000000-0000-4000-8000-000000000001";
const foreignOrganization = "10000000-0000-4000-8000-000000000002";

async function signIn(page: Page, code?: string) {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true })
    .fill(code ? organization : foreignOrganization);
  await page.getByLabel("Correo electrónico", { exact: true })
    .fill(code ? "recovery.mfa@example.invalid" : "recovery.outsider@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(state.account_password);
  if (code) await page.getByLabel("Código de verificación (si está activado)", { exact: true }).fill(code);
  const response = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/login") &&
    r.request().method() === "POST");
  await page.getByRole("button", { name: "Ingresar al espacio privado", exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const { token } = await result.json() as { token: string };
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible();
  return token;
}

async function openProfile(page: Page) {
  await page.getByRole("link", { name: "Expedientes", exact: true }).click();
  await page.locator(`a[href="/profiles/${state.profile}"]`).click();
  await expect(page.getByRole("heading", { name: "Expediente ficticio 01", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mediciones", exact: true }).click();
}

async function signOut(page: Page, token: string) {
  const response = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/logout") &&
    r.request().method() === "POST");
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  expect((await response).status()).toBe(204);
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
  const denied = await page.request.get(`/api/v1/profiles/${state.profile}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(denied.status()).toBe(401);
}

test("private interface operates over the restored database through real HTTP", async ({ page }) => {
  let token = "";
  await test.step("MFA sign-in", async () => { token = await signIn(page, state.browser_code); });
  await test.step("Read recovered measurements", async () => {
    await openProfile(page);
    await expect(page.getByRole("cell", { name: "70.25 kg", exact: true })).toBeVisible();
  });
  await test.step("Write from interface", async () => {
    await page.getByRole("button", { name: "+ Registrar medición", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Valor (kg)", exact: true }).fill("70.35");
    const date = new Date(Date.now() - 3 * 3600000);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric",
      month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date);
    const value = (type: string) => parts.find(part => part.type === type)!.value;
    await page.getByLabel("Fecha y hora (Lima)", { exact: true })
      .fill(`${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`);
    const saved = page.waitForResponse(r => r.url().endsWith(`/profiles/${state.profile}/measurements`) &&
      r.request().method() === "POST");
    await page.getByRole("button", { name: "Guardar medición", exact: true }).click();
    expect((await saved).status()).toBe(201);
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByRole("cell", { name: "70.35 kg", exact: true })).toBeVisible();
  });
  await test.step("Logout revokes bearer", async () => { await signOut(page, token); });
  await test.step("Reauthenticate and read persisted write", async () => {
    token = await signIn(page, state.browser_second_code);
    await openProfile(page);
    await expect(page.getByRole("cell", { name: "70.35 kg", exact: true })).toBeVisible();
    await signOut(page, token);
  });
  await test.step("Foreign organization remains isolated", async () => {
    token = await signIn(page);
    await page.getByRole("link", { name: "Expedientes", exact: true }).click();
    await expect(page.getByText("Aún no hay expedientes", { exact: true })).toBeVisible();
    const denied = await page.request.get(`/api/v1/profiles/${state.profile}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(denied.status()).toBe(404);
    await signOut(page, token);
  });
});
