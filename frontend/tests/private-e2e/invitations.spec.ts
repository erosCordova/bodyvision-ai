import { expect, test, type Page } from "@playwright/test";

const organization = "10000000-0000-4000-8000-000000000001";
const administratorPassword = "Browser fixtures only 2026!";
const invitationPassword = "Invite synthetic password 2026!";

async function enterAsAdmin(page: Page) {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(organization);
  await page.getByLabel("Correo electrónico", { exact: true })
    .fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(administratorPassword);
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard general" }))
    .toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  await page.getByRole("button", { name: "Gestionar invitaciones ficticias" }).click();
  return page.getByRole("region", { name: "Invitaciones de usuarios ficticios" });
}

async function issueInvitation(page: Page, panel: ReturnType<Page["getByRole"]>, email: string) {
  await panel.getByLabel("Nombre ficticio del invitado").fill("Invitado de validación");
  await panel.getByLabel("Correo ficticio del invitado").fill(email);
  await panel.getByLabel("Confirmar contraseña del administrador")
    .fill(administratorPassword);
  const response = page.waitForResponse(r =>
    r.url().endsWith("/api/v1/auth/invitations") && r.request().method() === "POST",
  );
  await panel.getByRole("button", { name: "Crear invitación ficticia" }).click();
  expect((await response).status()).toBe(201);
  const field = panel.getByLabel("Código de invitación de un solo uso");
  await expect(field).toBeVisible();
  const code = await field.inputValue();
  expect(code).toHaveLength(43);
  await panel.getByRole("button", { name: "Ocultar código definitivamente" }).click();
  await expect(field).toHaveCount(0);
  return code;
}

test("invitation UI: admin creates, revokes and guest accepts once without inheriting profile access",
  async ({ page, browser }) => {
    test.setTimeout(120000);
    const panel = await enterAsAdmin(page);
    const emailRevoked = `revoke.ui.${Date.now()}@example.invalid`;
    const revokedCode = await issueInvitation(page, panel, emailRevoked);
    await panel.getByRole("listitem").filter({ hasText: emailRevoked })
      .getByRole("button", { name: "Revocar invitación" }).click();
    await expect(panel.getByText("Invitación revocada en el servidor.")).toBeVisible();

    const email = `accept.ui.${Date.now()}@example.invalid`;
    const code = await issueInvitation(page, panel, email);
    const isolated = await browser.newContext({ baseURL: new URL(page.url()).origin });
    try {
      const guest = await isolated.newPage();
      await guest.goto("/access");
      await guest.getByText("Tengo una invitación ficticia").click();
      // A revoked one-time invitation never creates the user.
      await guest.getByLabel("Código de invitación ficticia").fill(revokedCode);
      await guest.getByLabel("Crear contraseña de prueba").fill(invitationPassword);
      await guest.getByLabel("Repetir contraseña de prueba").fill(invitationPassword);
      await guest.getByRole("button", { name: "Crear cuenta ficticia con invitación" }).click();
      await expect(guest.getByRole("alert")).toContainText("ya no es válida");
      await guest.getByLabel("Código de invitación ficticia").fill(code);
      await guest.getByLabel("Crear contraseña de prueba").fill(invitationPassword);
      await guest.getByLabel("Repetir contraseña de prueba").fill(invitationPassword);
      const acceptance = guest.waitForResponse(r =>
        r.url().endsWith("/api/v1/auth/invitations/accept") &&
        r.request().method() === "POST" && r.status() === 201,
      );
      await guest.getByRole("button", { name: "Crear cuenta ficticia con invitación" }).click();
      expect((await acceptance).status()).toBe(201);
      await expect(guest.getByText(/Invitación aceptada/)).toBeVisible();
      await expect(guest.getByLabel("Identificador de organización", { exact: true }))
        .toHaveValue(organization);
      await guest.getByLabel("Correo electrónico", { exact: true }).fill(email);
      await guest.getByLabel("Contraseña", { exact: true }).fill(invitationPassword);
      const loginResponse = guest.waitForResponse(r =>
        r.url().endsWith("/api/v1/auth/login") && r.request().method() === "POST",
      );
      await guest.getByRole("button", { name: "Ingresar al espacio privado" }).click();
      const login = await loginResponse;
      expect(login.status()).toBe(200);
      const memberToken = (await login.json() as { token: string }).token;
      await expect(guest.getByRole("heading", { name: "Dashboard general" }))
        .toBeVisible({ timeout: 20000 });
      const tokenlessStorage = await guest.evaluate(() =>
        [localStorage.length, sessionStorage.length, document.cookie]
      );
      expect(tokenlessStorage[0]).toBe(0);
      expect(tokenlessStorage[1]).toBe(0);
      expect(String(tokenlessStorage[2])).not.toContain(code);
      const profile = await guest.request.get(
        "/api/v1/profiles/e6221246-4221-5319-8dfe-f1d0f81977ca",
        { headers: { Authorization: `Bearer ${memberToken}` } },
      );
      expect(profile.status()).toBe(404);
      // The code is single-use even after the account successfully signs in.
      expect((await guest.request.post("/api/v1/auth/invitations/accept", {
        data: { token: code, password: invitationPassword },
      })).status()).toBe(401);
    } finally {
      await isolated.close();
    }
  },
);
