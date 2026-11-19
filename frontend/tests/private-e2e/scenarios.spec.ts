import { expect, test, type Page } from "@playwright/test";

const organization = "10000000-0000-4000-8000-000000000001";
const outsiderOrganization = "10000000-0000-4000-8000-000000000002";
const password = "Browser fixtures only 2026!";
const adminEmail = "browser.admin@example.invalid";

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});
test.setTimeout(120000);

async function signIn(page: Page, email: string, passphrase = password) {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(organization);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(passphrase);
  const response = page.waitForResponse(result =>
    result.url().endsWith("/api/v1/auth/login") && result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const login = await response;
  expect(login.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true })).toBeVisible();
  return (await login.json()) as { token: string };
}

async function simulationPanel(page: Page, profileId: string) {
  await page.getByRole("link", { name: "Visión 3D", exact: true }).click();
  await page.getByRole("button", { name: "Peso y estatura", exact: true }).click();
  const history = page.getByRole("region", { name: "Historial de escenarios simulados" });
  const profiles = history.getByRole("combobox", { name: "Expediente ficticio para escenarios" });
  await expect(profiles.locator(`option[value="${profileId}"]`)).toHaveCount(1);
  await profiles.selectOption(profileId);
  await expect(history).toContainText("Historial registrado");
  return history;
}

test("anonymous visitors cannot mount private viewer or request profile data", async ({ page }) => {
  const privateCalls: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/api/v1/profiles")) {
      privateCalls.push(request.url());
    }
  });
  await page.goto("/body-3d?panel=simulacion");
  await expect(page).toHaveURL(/[/]access$/);
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Historial de escenarios simulados" })).toHaveCount(0);
  expect(privateCalls).toEqual([]);
});

test("private 3D UI saves immutable versions; member sees only granted scenarios", async ({ page, browser }) => {
  const admin = await signIn(page, adminEmail);
  const auth = { Authorization: `Bearer ${admin.token}` };
  const profileResponse = await page.request.post("/api/v1/profiles", {
    headers: auth, data: { birth_year: 1997, display_name: "Escenario 3D ficticio E2E" },
  });
  expect(profileResponse.status()).toBe(201);
  const profileId = (await profileResponse.json() as { id: string }).id;
  const path = `/api/v1/profiles/${profileId}/scenarios`;
  const history = await simulationPanel(page, profileId);
  const variation = page.getByRole("slider", {
    name: "Aumentar o disminuir peso en el modelo anatómico",
  });
  const stature = page.getByRole("slider", { name: "Ajustar estatura del modelo anatómico" });

  await variation.fill("20");
  await stature.fill("180");
  const firstResponse = page.waitForResponse(response =>
    response.url().endsWith(path) && response.request().method() === "POST",
  );
  await history.getByRole("button", { name: "Crear escenario versionado" }).click();
  const firstSaved = await firstResponse;
  expect(firstSaved.status()).toBe(201);
  const first = await firstSaved.json() as { id: string; data_type: string; version: number };
  expect(first.data_type).toBe("SIMULADO");
  expect(first.version).toBe(1);
  await expect(history.getByRole("status")).toContainText("Versión 1 registrada");
  await expect(history.getByRole("list", { name: "Versiones de simulación guardadas" })).toContainText("v1");

  await variation.fill("-10");
  await history.getByRole("textbox", { name: /Motivo de nueva versión/ })
    .fill("Ajuste ficticio de composición");
  const secondResponse = page.waitForResponse(response =>
    response.url().endsWith(path) && response.request().method() === "POST",
  );
  await history.getByRole("button", { name: "Guardar siguiente versión" }).click();
  const secondSaved = await secondResponse;
  expect(secondSaved.status()).toBe(201);
  const second = await secondSaved.json() as { id: string; version: number; series_id: string };
  expect(second.version).toBe(2);
  await expect(history.getByRole("status")).toContainText("Versión 2 registrada");

  await page.getByRole("link", { name: "Panel principal", exact: true }).click();
  const reopened = await simulationPanel(page, profileId);
  await expect(reopened.getByRole("list", { name: "Versiones de simulación guardadas" }))
    .toContainText("v2");
  await reopened.getByRole("button", { name: "Ver versiones" }).first().click();
  await expect(reopened.getByLabel("Cadena de versiones del escenario")).toContainText("v1");
  await expect(reopened.getByLabel("Cadena de versiones del escenario")).toContainText("v2");

  const email = `scenario.member.${Date.now()}@example.invalid`;
  const createdUser = await page.request.post("/api/v1/auth/users", {
    headers: auth,
    data: { display_name: "Lector ficticio de escenario", email, password, role: "member" },
  });
  expect(createdUser.status()).toBe(201);
  const userId = (await createdUser.json() as { id: string }).id;
  const outsiderLogin = await page.request.post("/api/v1/auth/login", {
    data: {
      organization_id: outsiderOrganization,
      email: "browser.outsider@example.invalid",
      password,
    },
  });
  expect(outsiderLogin.status()).toBe(200);
  const outsiderToken = (await outsiderLogin.json() as { token: string }).token;
  expect((await page.request.get(path, {
    headers: { Authorization: `Bearer ${outsiderToken}` },
  })).status()).toBe(404);

  const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const memberPage = await memberContext.newPage();
    const member = await signIn(memberPage, email);
    const memberAuth = { Authorization: `Bearer ${member.token}` };
    expect((await memberPage.request.get(path, { headers: memberAuth })).status()).toBe(404);
    const granted = await page.request.post("/api/v1/auth/profile-access/grant", {
      headers: auth, data: { profile_id: profileId, user_id: userId, access_level: "read" },
    });
    expect(granted.status()).toBe(200);
    const accessible = await memberPage.request.get(path, { headers: memberAuth });
    expect(accessible.status()).toBe(200);
    expect((await accessible.json() as { total: number }).total).toBe(2);

    const memberHistory = await simulationPanel(memberPage, profileId);
    await expect(memberHistory.getByRole("list", { name: "Versiones de simulación guardadas" }))
      .toContainText("v2");
    await expect(memberHistory.getByRole("button", { name: "Crear escenario versionado" }))
      .toBeDisabled();
    const forbidden = await memberPage.request.post(path, {
      headers: { ...memberAuth, "Idempotency-Key": crypto.randomUUID() },
      data: { reference_kg: 70, variation_percent: 0, stature_cm: 175 },
    });
    expect([403, 404]).toContain(forbidden.status());

    const revoked = await page.request.post("/api/v1/auth/profile-access/revoke", {
      headers: auth, data: { profile_id: profileId, user_id: userId },
    });
    expect(revoked.status()).toBe(200);
    expect((await memberPage.request.get(path, { headers: memberAuth })).status()).toBe(404);
  } finally {
    await memberContext.close();
  }
  const observations = await page.request.get(
    `/api/v1/profiles/${profileId}/measurements`, { headers: auth },
  );
  expect(observations.status()).toBe(200);
  expect((await observations.json() as { total: number }).total).toBe(0);
});
