import { expect, test, type Page } from "@playwright/test";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const OTHER_ORGANIZATION = "10000000-0000-4000-8000-000000000002";
const PASSWORD = "Browser fixtures only 2026!";

async function signInAsAdministrator(page: Page) {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(ORGANIZATION);
  await page.getByLabel("Correo electrónico", { exact: true })
    .fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  const pending = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/login")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true }))
    .toBeVisible();
  return response.json() as Promise<{ token: string }>;
}

test("F9 private ARCO intake UI: search expediente, submit, de-duplicate, triage and isolate",
  async ({ page }) => {
    test.setTimeout(120_000);
    const session = await signInAsAdministrator(page);
    const headers = { Authorization: "Bearer " + session.token };
    const response = await page.request.post("/api/v1/profiles", {
      headers,
      data: { birth_year: 1995, display_name: "ARCO ficticio " + crypto.randomUUID().slice(0, 8) },
    });
    expect(response.status()).toBe(201);
    const profile = await response.json() as { id: string; display_code: string };

    await page.getByRole("link", { name: "Privacidad", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Solicitudes de privacidad" }))
      .toBeVisible();
    await page.getByRole("searchbox", {
      name: "Buscar expediente por código o referencia",
    }).fill(profile.display_code);
    const selector = page.getByRole("combobox", { name: "Expediente autorizado" });
    await expect(selector).toHaveValue(profile.id);

    const saveResponse = page.waitForResponse(r =>
      r.url().endsWith("/api/v1/profiles/" + profile.id + "/privacy-requests")
      && r.request().method() === "POST");
    await page.getByRole("button", { name: "Registrar solicitud ficticia" }).click();
    const saved = await saveResponse;
    expect(saved.status()).toBe(201);
    const body = await saved.json() as {
      id: string; profile_code: string; status: string; request_type: string;
      received_at: string; review_target_at: string;
    };
    expect(body.profile_code).toBe(profile.display_code);
    expect(body.status).toBe("received");
    expect(body.request_type).toBe("access");
    expect(Date.parse(body.review_target_at) - Date.parse(body.received_at))
      .toBe(7 * 24 * 60 * 60 * 1000);
    const history = page.locator("section.enterprise-panel")
      .filter({ has: page.getByRole("heading", { name: "Mis solicitudes del expediente" }) });
    await expect(history).toContainText(profile.display_code);
    await expect(history).toContainText("Recibida");
    await expect(history).toContainText("Objetivo interno de atención (hora de Lima)");

    const duplicateResponse = page.waitForResponse(r =>
      r.url().endsWith("/api/v1/profiles/" + profile.id + "/privacy-requests")
      && r.request().method() === "POST");
    await page.getByRole("button", { name: "Registrar solicitud ficticia" }).click();
    expect((await duplicateResponse).status()).toBe(409);
    await expect(page.getByRole("alert")).toBeVisible();

    const queue = page.locator("section.enterprise-panel").filter({
      has: page.getByRole("heading", { name: "Cola de revisión administrativa" }),
    });
    const target = queue.getByRole("listitem").filter({ hasText: profile.display_code });
    await expect(target).toContainText("Recibida");
    const pendingReview = page.waitForResponse(r =>
      r.url().endsWith("/api/v1/privacy-requests/" + body.id + "/review")
      && r.request().method() === "POST");
    await target.getByRole("button", { name: "Iniciar revisión" }).click();
    const reviewed = await pendingReview;
    expect(reviewed.status()).toBe(200);
    expect((await reviewed.json() as { review_target_at: string }).review_target_at)
      .toBe(body.review_target_at);
    await expect(queue.getByRole("listitem").filter({
      hasText: profile.display_code,
    })).toContainText("En revisión");
    await expect(history).toContainText("En revisión");
    const statusFilter = queue.getByRole("combobox", { name: "Filtrar solicitudes por estado" });
    await statusFilter.selectOption("received");
    await expect(queue).not.toContainText(profile.display_code);
    await statusFilter.selectOption("in_review");
    await expect(queue).toContainText(profile.display_code);
    await queue.getByRole("checkbox", {
      name: "Solo solicitudes con atención interna atrasada",
    }).check();
    await expect(queue).not.toContainText(profile.display_code);
    await queue.getByRole("checkbox", {
      name: "Solo solicitudes con atención interna atrasada",
    }).uncheck();
    await expect(queue).toContainText(profile.display_code);

    const otherLogin = await page.request.post("/api/v1/auth/login", {
      data: {
        organization_id: OTHER_ORGANIZATION,
        email: "browser.outsider@example.invalid",
        password: PASSWORD,
      },
    });
    expect(otherLogin.status()).toBe(200);
    const outsider = await otherLogin.json() as { token: string };
    const denied = await page.request.get(
      "/api/v1/profiles/" + profile.id + "/privacy-requests",
      { headers: { Authorization: "Bearer " + outsider.token } },
    );
    expect(denied.status()).toBe(404);
  },
);
