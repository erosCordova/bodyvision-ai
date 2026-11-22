import { expect, test } from "@playwright/test";

// All accounts and the PostgreSQL database are disposable CI fixtures.
const ORGANIZATION = "10000000-0000-4000-8000-000000000002";
const EMAIL = "browser.outsider@example.invalid";
const PASSPHRASE = "Browser fixtures only 2026!";

test("JWT cookie login, reload, refresh rotation, tenant API and logout", async ({ page }) => {
  await page.goto("/profiles");
  // Protected data must remain inaccessible until the cookie restore finishes.
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true }))
    .toBeVisible();

  await page.getByLabel("Identificador de organización", { exact: true }).fill(ORGANIZATION);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(EMAIL);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSPHRASE);

  const loginResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/access/login")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const loggedIn = await loginResponse;
  expect(loggedIn.status()).toBe(200);
  const firstToken = (await loggedIn.json() as { access_token: string }).access_token;
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true }))
    .toBeVisible();

  const refreshCookie = (await page.context().cookies())
    .find(cookie => cookie.name === "bv_private_refresh");
  expect(refreshCookie).toMatchObject({
    httpOnly: true,
    sameSite: "Strict",
    path: "/api/v1/auth/access",
  });
  expect(await page.evaluate(() => document.cookie.includes("bv_private_refresh")))
    .toBe(false);

  const firstIdentity = await page.request.get("/api/v1/auth/access/me", {
    headers: { Authorization: `Bearer ${firstToken}` },
  });
  expect(firstIdentity.status()).toBe(200);
  expect((await firstIdentity.json() as { organization_id: string }).organization_id)
    .toBe(ORGANIZATION);

  const refreshResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/access/refresh")
    && response.request().method() === "POST");
  await page.reload();
  const refreshed = await refreshResponse;
  expect(refreshed.status()).toBe(200);
  const currentToken = (await refreshed.json() as { access_token: string }).access_token;
  expect(currentToken).not.toBe(firstToken);
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true }))
    .toBeVisible();
  expect((await page.request.get("/api/v1/auth/access/me", {
    headers: { Authorization: `Bearer ${firstToken}` },
  })).status()).toBe(401);
  expect((await page.request.get("/api/v1/auth/access/me", {
    headers: { Authorization: `Bearer ${currentToken}` },
  })).status()).toBe(200);

  const tenantData = await page.request.get("/api/v1/workspaces", {
    headers: { Authorization: `Bearer ${currentToken}` },
  });
  expect(tenantData.status()).toBe(200);
  const organizations = (await tenantData.json() as { items: { id: string }[] }).items;
  expect(organizations.map(item => item.id)).toEqual([ORGANIZATION]);

  const logoutResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/access/logout")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  expect((await logoutResponse).status()).toBe(204);
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true }))
    .toBeVisible();

  expect((await page.context().cookies())
    .some(cookie => cookie.name === "bv_private_refresh")).toBe(false);
  expect((await page.request.get("/api/v1/auth/access/me", {
    headers: { Authorization: `Bearer ${currentToken}` },
  })).status()).toBe(401);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true }))
    .toBeVisible();
});
