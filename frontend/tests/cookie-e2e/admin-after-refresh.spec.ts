import { expect, test } from "@playwright/test";

test("expired administrative JWT renews once and preserves the created invitation code", async ({ page }) => {
  const password = "Browser fixtures only 2026!";
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill("10000000-0000-4000-8000-000000000001");
  await page.getByLabel("Correo electrónico", { exact: true }).fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  const login = page.waitForResponse(response => response.url().endsWith("/auth/access/login"));
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const loggedIn = await login;
  expect(loggedIn.status()).toBe(200);
  const oldToken = (await loggedIn.json() as { access_token: string }).access_token;
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  await page.getByRole("button", { name: "Gestionar invitaciones ficticias" }).click();
  const panel = page.getByRole("region", { name: "Invitaciones de usuarios ficticios" });
  await expect(panel.getByText("Consultando invitaciones…")).toHaveCount(0);
  const email = `refresh.invite.${Date.now()}@example.invalid`;
  await panel.getByLabel("Nombre ficticio del invitado").fill("Invitado tras renovación");
  await panel.getByLabel("Correo ficticio del invitado").fill(email);
  await panel.getByLabel("Confirmar contraseña del administrador").fill(password);

  // Real backend rotation invalidates the browser's in-memory JWT without
  // intercepting HTTP or changing the database clock. The next POST must fail
  // authorization before any mutation, refresh once, then create exactly once.
  const rotated = await page.request.post("/api/v1/auth/access/refresh", {
    headers: { Origin: new URL(page.url()).origin, "X-Requested-With": "XMLHttpRequest" },
  });
  expect(rotated.status()).toBe(200);
  expect((await page.request.get("/api/v1/auth/access/me", {
    headers: { Authorization: `Bearer ${oldToken}` },
  })).status()).toBe(401);

  const statuses: number[] = [];
  let refreshes = 0;
  page.on("response", response => {
    if (response.url().endsWith("/auth/invitations") && response.request().method() === "POST") statuses.push(response.status());
    if (response.url().endsWith("/auth/access/refresh")) refreshes += 1;
  });
  await panel.getByRole("button", { name: "Crear invitación ficticia" }).click();
  const code = panel.getByLabel("Código de invitación de un solo uso");
  await expect(code).toBeVisible();
  expect((await code.inputValue()).length).toBe(43);
  await expect(panel.getByLabel("Confirmar contraseña del administrador")).toHaveValue("");
  // A shared refresh can finish before the invitation POST. Both valid
  // sequences must have exactly one renewal and one successful creation.
  // The invalidated old JWT has already been rejected above by the API.
  expect([[401, 201], [201]]).toContainEqual(statuses);
  // Both permitted interleavings must authorize exactly one successful
  // mutation. In particular, never tolerate a second 201 or a 403 bypass.
  expect(statuses.filter(status => status === 201)).toHaveLength(1);
  expect(statuses.every(status => status === 401 || status === 201)).toBe(true);
  expect(refreshes).toBe(1);
  const record = panel.getByRole("listitem").filter({ hasText: email });
  await expect(record).toHaveCount(1);
  await record.getByRole("button", { name: "Revocar invitación", exact: true }).click();
  await expect(record).toContainText("Revocada");
  await expect(code).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Usuarios y auditoría", exact: true })).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain(oldToken);
  expect(storage).not.toContain(password);
});
