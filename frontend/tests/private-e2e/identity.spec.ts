import { expect, test, type Page } from "@playwright/test";

const organization = "10000000-0000-4000-8000-000000000001";
const otherOrganization = "10000000-0000-4000-8000-000000000002";
const password = "Browser fixtures only 2026!";

async function signIn(page: Page, email: string, org = organization) {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(org);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible();
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
  await expect(page.getByText("Aún no hay expedientes", { exact: true })).toBeVisible();
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
  const account = await created.json() as { id: string };
  await expect(page.getByRole("status").filter({ hasText: "Cuenta ficticia creada" })).toBeVisible();
  await expect(page.getByLabel("Contraseña de pruebas", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Identificador de usuario", { exact: true })).toHaveValue(account.id);

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

    await page.getByLabel("Identificador de expediente", { exact: true }).fill(profileId);
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
  await signOut(page);
  const adminLoggedOut = await page.request.get("/api/v1/auth/me", {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
  expect(adminLoggedOut.status()).toBe(401);
});
