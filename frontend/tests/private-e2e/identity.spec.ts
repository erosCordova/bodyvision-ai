import { expect, test, type Page } from "@playwright/test";

const organization = "10000000-0000-4000-8000-000000000001";
const otherOrganization = "10000000-0000-4000-8000-000000000002";
const password = "Browser fixtures only 2026!";

async function signIn(page: Page, email: string, org = organization, passphrase = password) {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(org);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(passphrase);
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true }))
    .toBeVisible({ timeout: 15000 });
  return response.json() as Promise<{ token: string }>;
}

async function signOut(page: Page) {
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/logout") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  expect((await responsePromise).status()).toBe(204);
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
}

test("private identity, user creation, RLS grants, revocation and logout work together", async ({ page, browser }) => {
  const apiRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/api/v1/")) apiRequests.push(request.url());
  });
  await page.goto("/profiles");
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
  expect(apiRequests.filter(url => /\/profiles|\/analytics/.test(url))).toEqual([]);

  const admin = await signIn(page, "browser.admin@example.invalid");
  await expect(page.getByRole("combobox", { name: "Organización ficticia" })).toBeDisabled();
  await page.getByRole("link", { name: "Expedientes", exact: true }).click();
  // Other private E2E flows may create fictional profiles concurrently.
  // Access checks below assert grants and RLS independently of global row counts.
  await expect(page.getByRole("heading", { name: "Expedientes", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Usuarios y auditoría", exact: true })).toBeVisible();

  const email = `browser.member.${Date.now()}@example.invalid`;
  await page.getByLabel("Nombre ficticio", { exact: true }).fill("Consulta ficticia de navegador");
  await page.getByLabel("Correo ficticio", { exact: true }).fill(email);
  await page.getByLabel("Contraseña de pruebas", { exact: true }).fill(password);
  const accountResponse = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/users") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Crear cuenta ficticia", exact: true }).click();
  const created = await accountResponse;
  expect(created.status()).toBe(201);
  await expect(page.getByRole("status").filter({ hasText: "Cuenta ficticia creada" })).toBeVisible();
  await expect(page.getByLabel("Contraseña de pruebas", { exact: true })).toHaveValue("");
  await expect(page.getByRole("region", { name: "Permisos por expediente" })).toContainText(email);
  const userDirectory = page.getByRole("region", { name: "Directorio de usuarios" });
  await userDirectory.getByRole("searchbox", { name: "Buscar usuario por nombre o correo" }).fill(email);
  await expect(userDirectory.getByText("1 cuenta encontrada", { exact: true })).toBeVisible();
  await userDirectory.getByRole("button", { name: `Seleccionar ${email}`, exact: true }).click();

  const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const memberPage = await memberContext.newPage();
  try {
    const member = await signIn(memberPage, email);
    await memberPage.getByRole("link", { name: "Expedientes", exact: true }).click();
    await expect(memberPage.getByText("Aún no hay expedientes", { exact: true })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Vista de solo lectura" })).toBeDisabled();

    // Test the fixture's known UUID through the actual backend, not intercepted responses.
    // UUID5 matches the first profile created by app.seed.
    const profileId = "e6221246-4221-5319-8dfe-f1d0f81977ca";
    const profilePath = `/api/v1/profiles/${profileId}`;
    const memberHeaders = { Authorization: `Bearer ${member.token}` };
    const beforeGrant = await memberPage.request.get(profilePath, { headers: memberHeaders });
    expect(beforeGrant.status()).toBe(404);

    await page.getByLabel("Expediente del catálogo", { exact: true }).selectOption(profileId);
    await page.getByRole("button", { name: "Conceder permiso", exact: true }).click();
    await expect(page.getByText("Permiso ficticio concedido durante 30 días.", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Permiso concedido", exact: true }).first()).toBeVisible();

    await memberPage.getByRole("link", { name: "Dashboard", exact: true }).click();
    await memberPage.getByRole("link", { name: "Expedientes", exact: true }).click();
    await memberPage.getByRole("link", { name: /Expediente ficticio 01/ }).click();
    await expect(memberPage.getByRole("heading", { name: "Expediente ficticio 01", exact: true })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "+ Registrar medición", exact: true })).toBeDisabled();
    await expect(memberPage.getByRole("button", { name: "Editar referencia", exact: true })).toBeDisabled();
    const forbiddenEdit = await memberPage.request.patch(profilePath, {
      headers: memberHeaders, data: { display_name: "No permitido" },
    });
    expect(forbiddenEdit.status()).toBe(403);

    await page.getByRole("button", { name: "Revocar permiso", exact: true }).click();
    await expect(page.getByText("Permiso revocado. El acceso se bloquea en el servidor inmediatamente.", { exact: true })).toBeVisible();
    const stillAuthenticated = await memberPage.request.get("/api/v1/auth/me", { headers: memberHeaders });
    expect(stillAuthenticated.status()).toBe(200);
    const revokedRead = await memberPage.request.get(profilePath, { headers: memberHeaders });
    expect(revokedRead.status()).toBe(404);
    await memberPage.getByRole("link", { name: "Expedientes", exact: true }).click();
    await expect(memberPage.getByText("Aún no hay expedientes", { exact: true })).toBeVisible();

    await memberPage.getByRole("link", { name: "Administración", exact: true }).click();
    await expect(memberPage.getByRole("heading", { name: "Administración y seguridad", exact: true })).toBeVisible();
    await expect(memberPage.getByLabel("Nombre ficticio", { exact: true })).toHaveCount(0);
    const stored = await memberPage.evaluate(() => [
      ...Object.values(localStorage), ...Object.values(sessionStorage), document.cookie, location.href,
    ].join("\n"));
    expect(stored.includes(member.token)).toBe(false);

    await signOut(memberPage);
    const loggedOut = await memberPage.request.get("/api/v1/auth/me", { headers: memberHeaders });
    expect(loggedOut.status()).toBe(401);
    await memberPage.goBack();
    await expect(memberPage.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();

    const recoverySession = await signIn(memberPage, email);
    const reset = page.getByRole("region", { name: "Restablecer acceso de prueba", exact: true });
    const replacementPassword = "Recovered fictional password 2026!";
    await expect(reset).toContainText(email);
    await reset.getByLabel("Tu contraseña de administrador", { exact: true }).fill(password);
    await reset.getByLabel("Nueva contraseña del usuario", { exact: true }).fill(replacementPassword);
    await reset.getByLabel("Confirmar nueva contraseña", { exact: true }).fill(replacementPassword);
    await reset.getByRole("button", { name: "Restablecer contraseña y revocar sesiones", exact: true }).click();
    await expect(reset.getByRole("status")).toHaveText("Acceso restablecido. Sesiones revocadas: 1.");
    await expect(reset.getByLabel("Tu contraseña de administrador", { exact: true })).toHaveValue("");
    await expect(reset.getByLabel("Nueva contraseña del usuario", { exact: true })).toHaveValue("");
    const recoveredOldToken = await memberPage.request.get("/api/v1/auth/me", {
      headers: { Authorization: `Bearer ${recoverySession.token}` },
    });
    expect(recoveredOldToken.status()).toBe(401);
    await memberPage.getByRole("link", { name: "Expedientes", exact: true }).click();
    await expect(memberPage.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
    const oldPasswordLogin = await memberPage.request.post("/api/v1/auth/login", { data: {
      organization_id: organization, email, password,
    } });
    expect(oldPasswordLogin.status()).toBe(401);
    const enabledSession = await signIn(memberPage, email, organization, replacementPassword);
    const directory = page.getByRole("region", { name: "Directorio de usuarios", exact: true });
    await directory.getByLabel("Confirmar contraseña para cambiar estado", { exact: true }).fill(password);
    await directory.getByRole("button", { name: "Suspender cuenta", exact: true }).click();
    await expect(directory.getByRole("status").filter({ hasText: "Cuenta suspendida." })).toContainText("Sesiones revocadas: 1");
    const suspended = await memberPage.request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${enabledSession.token}` } });
    expect(suspended.status()).toBe(401);
    const blockedLogin = await memberPage.request.post("/api/v1/auth/login", { data: { organization_id: organization, email, password: replacementPassword } });
    expect(blockedLogin.status()).toBe(401);
    await directory.getByLabel("Confirmar contraseña para cambiar estado", { exact: true }).fill(password);
    await directory.getByRole("button", { name: "Reactivar cuenta", exact: true }).click();
    await expect(directory.getByText("Cuenta reactivada. Debe iniciar una sesión nueva.")).toBeVisible();
    const revokedAfterActivation = await memberPage.request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${enabledSession.token}` } });
    expect(revokedAfterActivation.status()).toBe(401);
    await signIn(memberPage, email, organization, replacementPassword);
    await signOut(memberPage);

    // A member of a different organization cannot read the same profile.
    const outsider = await signIn(memberPage, "browser.outsider@example.invalid", otherOrganization);
    const outsideRead = await memberPage.request.get(profilePath, {
      headers: { Authorization: `Bearer ${outsider.token}` },
    });
    expect(outsideRead.status()).toBe(404);
    await memberPage.reload();
    await expect(memberPage.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
  } finally {
    await memberContext.close();
  }

  await page.getByRole("button", { name: "Actualizar", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Permiso revocado", exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Expedientes", exact: true }).click();
  await page.getByRole("button", { name: "+ Nuevo expediente", exact: true }).click();
  await page.getByRole("textbox", { name: "Nombre de referencia (opcional)", exact: true }).fill("Consentimientos ficticios E2E");
  await page.getByRole("button", { name: "Crear expediente", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Consentimientos ficticios E2E", exact: true })).toBeVisible();
  const consents = page.getByRole("region", { name: "Consentimientos por finalidad", exact: true });
  const capture = consents.getByRole("article", { name: "Captura de imágenes", exact: true });
  await expect(capture.getByText("Sin aceptación vigente", { exact: true })).toBeVisible();
  const confirmation = consents.getByRole("checkbox");
  await expect(confirmation).not.toBeChecked();
  await expect(consents.getByRole("button", { name: "Registrar aceptación ficticia", exact: true })).toBeDisabled();
  await confirmation.check();
  await consents.getByRole("button", { name: "Registrar aceptación ficticia", exact: true }).click();
  await expect(capture.getByText("Vigente", { exact: true })).toBeVisible();
  await expect(confirmation).not.toBeChecked();
  await capture.getByRole("button", { name: "Revocar consentimiento de Captura de imágenes", exact: true }).click();
  await expect(capture.getByText("Sin aceptación vigente", { exact: true })).toBeVisible();
  await consents.getByText("Historial de aceptaciones y revocaciones", { exact: true }).click();
  await expect(consents.getByText(/Revocado · Ciclo 1/)).toBeVisible();
  await confirmation.check();
  await consents.getByRole("button", { name: "Registrar aceptación ficticia", exact: true }).click();
  await expect(capture.getByText("Vigente", { exact: true })).toBeVisible();
  await expect(consents.getByText(/Vigente · Ciclo 2/)).toBeVisible();
  await signOut(page);
  const adminLoggedOut = await page.request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(adminLoggedOut.status()).toBe(401);
});

test("own password, active sessions and audit verification work through the real API", async ({ page, browser }) => {
  const admin = await signIn(page, "browser.admin@example.invalid");
  const email = `browser.self.${Date.now()}@example.invalid`;
  const created = await page.request.post("/api/v1/auth/users", {
    headers: { Authorization: `Bearer ${admin.token}` }, data: {
      display_name: "Cuenta de seguridad propia", email, password, role: "member",
    },
  });
  expect(created.status()).toBe(201);
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const own = await context.newPage();
  try {
    const current = await signIn(own, email);
    const other = await own.request.post("/api/v1/auth/login", { data: { organization_id: organization, email, password } });
    expect(other.status()).toBe(200);
    const otherToken = (await other.json() as { token: string }).token;
    await own.getByRole("link", { name: /Acceso y seguridad/ }).click();
    const sessions = own.getByRole("region", { name: "Mis sesiones activas", exact: true });
    await expect(sessions.getByText("2 sesiones activas", { exact: true })).toBeVisible();
    await sessions.getByLabel("Confirmar contraseña para cerrar sesiones", { exact: true }).fill(password);
    await sessions.getByRole("listitem").filter({ hasText: "Otra sesión" }).getByRole("button").click();
    await expect(sessions.getByText("1 sesión activa", { exact: true })).toBeVisible();
    expect((await own.request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${otherToken}` } })).status()).toBe(401);
    expect((await own.request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${current.token}` } })).status()).toBe(200);

    const additional = await own.request.post("/api/v1/auth/login", { data: { organization_id: organization, email, password } });
    expect(additional.status()).toBe(200);
    const additionalToken = (await additional.json() as { token: string }).token;
    await sessions.getByRole("button", { name: "Actualizar sesiones", exact: true }).click();
    await expect(sessions.getByText("2 sesiones activas", { exact: true })).toBeVisible();
    const passwordForm = own.getByRole("region", { name: "Cambiar mi contraseña", exact: true });
    const replacement = "Browser self-service replacement 2026!";
    await passwordForm.getByLabel("Contraseña actual", { exact: true }).fill(password);
    await passwordForm.getByLabel("Mi nueva contraseña", { exact: true }).fill(replacement);
    await passwordForm.getByLabel("Repetir mi nueva contraseña", { exact: true }).fill(replacement);
    await passwordForm.getByRole("button", { name: "Cambiar contraseña y cerrar sesiones", exact: true }).click();
    await expect(own.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
    await expect(own.getByRole("status")).toContainText("Contraseña actualizada");
    for (const token of [current.token, additionalToken]) {
      expect((await own.request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${token}` } })).status()).toBe(401);
    }
    const fresh = await signIn(own, email, organization, replacement);
    await own.getByRole("link", { name: /Acceso y seguridad/ }).click();
    await own.getByLabel("Confirmar contraseña para cerrar sesiones", { exact: true }).fill(replacement);
    await own.getByRole("button", { name: "Cerrar todas mis sesiones, incluida esta", exact: true }).click();
    await expect(own.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
    expect((await own.request.get("/api/v1/auth/me", { headers: { Authorization: `Bearer ${fresh.token}` } })).status()).toBe(401);
  } finally { await context.close(); }
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  const integrity = page.getByRole("region", { name: "Integridad de auditoría", exact: true });
  await integrity.getByRole("button", { name: "Verificar integridad de auditoría", exact: true }).click();
  await expect(integrity.getByRole("status")).toContainText("Cadena íntegra en el punto verificado");
  await signOut(page);
});
