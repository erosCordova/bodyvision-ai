import { expect, test, type Page } from "@playwright/test";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const OUTSIDER_ORGANIZATION = "10000000-0000-4000-8000-000000000002";
const PASSWORD = "Browser fixtures only 2026!";
const EXACT_TIME = "2026-11-05T13:24:35.123456Z";

type Measurement = {
  id: string;
  value: number;
  measured_at: string;
  is_current: boolean;
  supersedes_id: string | null;
  correction_reason: string | null;
  data_type: string;
};

async function signIn(page: Page): Promise<string> {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(ORGANIZATION);
  await page.getByLabel("Correo electrónico", { exact: true })
    .fill("browser.admin@example.invalid");
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith("/api/v1/auth/login")
    && response.request().method() === "POST");
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const session = await response.json() as { token: string };
  await expect(page.getByRole("heading", { name: "Dashboard general", exact: true }))
    .toBeVisible();
  return session.token;
}

// In the legacy private UI the access token is deliberately memory-only.
// A full page reload must require login again; persistence applies to PostgreSQL
// records, NOT to a browser credential or a fake automatic reauthentication.
async function reloadAndReauthenticate(page: Page, profileId: string): Promise<void> {
  await page.reload();
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true }))
    .toBeVisible();
  await signIn(page);
  await page.goto("/profiles/" + profileId);
}

test("F2 real UI and PostgreSQL: create, correct, preserve UTC microseconds, archive and isolate",
  async ({ page }) => {
    test.setTimeout(120_000);
    const token = await signIn(page);
    const headers = { Authorization: "Bearer " + token };
    const reference = "F2 aceptación técnica " + crypto.randomUUID().slice(0, 8);

    await page.getByRole("link", { name: "Expedientes", exact: true }).click();
    await page.getByRole("button", { name: "+ Nuevo expediente", exact: true }).click();
    await page.getByRole("textbox", { name: "Nombre de referencia (opcional)" })
      .fill(reference);
    await page.getByRole("spinbutton", { name: "Año de nacimiento" }).fill("1997");
    const creation = page.waitForResponse(response =>
      response.url().endsWith("/api/v1/profiles") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Crear expediente", exact: true }).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    const { id: profileId } = await created.json() as { id: string };
    await expect(page.getByRole("heading", { name: reference, exact: true })).toBeVisible();

    // Edit the reference through the page, not by manipulating a mocked React query.
    await page.getByRole("button", { name: "Editar referencia", exact: true }).click();
    const editedName = reference + " editado";
    await page.getByRole("textbox", { name: "Nombre de referencia", exact: true })
      .fill(editedName);
    await page.getByRole("button", { name: "Guardar referencia" }).click();
    await expect(page.getByRole("heading", { name: editedName, exact: true })).toBeVisible();
    await reloadAndReauthenticate(page, profileId);
    await expect(page.getByRole("heading", { name: editedName, exact: true })).toBeVisible();

    // Create an observed measurement from the actual form, including API audit.
    await page.getByRole("button", { name: "+ Registrar medición", exact: true }).click();
    await page.getByRole("spinbutton", { name: "Valor (kg)" }).fill("72");
    const firstPost = page.waitForResponse(response =>
      response.url().endsWith("/api/v1/profiles/" + profileId + "/measurements")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "Guardar medición", exact: true }).click();
    const firstResponse = await firstPost;
    expect(firstResponse.status()).toBe(201);
    const first = await firstResponse.json() as Measurement;
    expect(first.data_type).toBe("OBSERVADO");
    expect(first.is_current).toBe(true);
    await expect(page.getByRole("table", {
      name: /Mediciones observadas vigentes/,
    })).toContainText("72 kg");

    // An independent high-precision source exercises a subtle UI regression:
    // datetime-local edits only display minutes; an unchanged time must preserve
    // exact seconds and microseconds that the API originally stored.
    const key = crypto.randomUUID();
    const preciseInput = {
      metric_code: "weight",
      value: 73,
      unit: "kg",
      method: "manual",
      measured_at: EXACT_TIME,
    };
    const precisePost = await page.request.post(
      "/api/v1/profiles/" + profileId + "/measurements",
      { headers: { ...headers, "Idempotency-Key": key }, data: preciseInput },
    );
    expect(precisePost.status()).toBe(201);
    const precise = await precisePost.json() as Measurement;
    expect(precise.is_current).toBe(true);
    const repeatedPost = await page.request.post(
      "/api/v1/profiles/" + profileId + "/measurements",
      { headers: { ...headers, "Idempotency-Key": key }, data: preciseInput },
    );
    expect(repeatedPost.status()).toBe(201);
    expect((await repeatedPost.json() as Measurement).id).toBe(precise.id);

    const invalid = await page.request.post(
      "/api/v1/profiles/" + profileId + "/measurements",
      { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        data: { ...preciseInput, value: 9999 } },
    );
    expect(invalid.status()).toBe(422);

    await reloadAndReauthenticate(page, profileId);
    await page.getByRole("button", { name: "Mediciones", exact: true }).click();
    const table = page.getByRole("table", { name: /Mediciones observadas vigentes/ });
    await expect(table).toContainText("73 kg");
    const originalRow = table.getByRole("row").filter({ hasText: "73 kg" });
    await originalRow.getByRole("button", { name: "Corregir", exact: true }).click();

    // The invalid edit is rejected in the form BEFORE any PATCH can be sent.
    await page.getByRole("spinbutton", { name: "Valor (kg)" }).fill("74");
    await page.getByRole("textbox", { name: "Motivo de la corrección" }).fill("no");
    await page.getByRole("button", { name: "Guardar corrección" }).click();
    await expect(page.getByRole("alert")).toContainText("al menos 5 caracteres");

    await page.getByRole("textbox", { name: "Motivo de la corrección" })
      .fill("Lectura ficticia corregida tras revisar el origen.");
    const correctionResponse = page.waitForResponse(response =>
      response.url().endsWith("/api/v1/measurements/" + precise.id)
      && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "Guardar corrección" }).click();
    const correctedHttp = await correctionResponse;
    expect(correctedHttp.status()).toBe(201);
    const corrected = await correctedHttp.json() as Measurement;
    expect(corrected.id).not.toBe(precise.id);
    expect(corrected.supersedes_id).toBe(precise.id);
    expect(corrected.value).toBe(74);
    expect(corrected.measured_at).toBe(precise.measured_at);
    expect(corrected.correction_reason).toContain("Lectura ficticia");

    const historyResponse = await page.request.get(
      "/api/v1/measurements/" + corrected.id + "/versions",
      { headers },
    );
    expect(historyResponse.status()).toBe(200);
    const versions = await historyResponse.json() as Measurement[];
    expect(versions).toHaveLength(2);
    expect(versions.map(row => row.id)).toEqual([precise.id, corrected.id]);
    expect(versions.map(row => row.is_current)).toEqual([false, true]);
    expect(versions.map(row => row.measured_at))
      .toEqual([precise.measured_at, precise.measured_at]);
    expect(versions[0].value).toBe(73);
    expect(versions[1].value).toBe(74);

    // The table must show the current version while the history retains both.
    await reloadAndReauthenticate(page, profileId);
    await page.getByRole("button", { name: "Mediciones", exact: true }).click();
    const afterCorrection = page.getByRole("table", {
      name: /Mediciones observadas vigentes/,
    });
    await expect(afterCorrection).toContainText("74 kg");
    await expect(afterCorrection).not.toContainText("73 kg");
    await afterCorrection.getByRole("row").filter({ hasText: "74 kg" })
      .getByRole("button", { name: "Ver versiones" }).click();
    await expect(page.getByRole("heading", { name: "Versión 1 · 73 kg" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Versión 2 · 74 kg" })).toBeVisible();
    await expect(page.getByText("Sustituida", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar diálogo", exact: true }).click();

    // Archive is explicit and irreversible from this UI: no data is lost,
    // but writes must be refused on both the form and the real API.
    await page.getByRole("button", { name: "Resumen", exact: true }).click();
    page.once("dialog", dialog => { void dialog.accept(); });
    const archiveResponse = page.waitForResponse(response =>
      response.url().endsWith("/api/v1/profiles/" + profileId + "/archive"));
    await page.getByRole("button", { name: "Archivar expediente" }).click();
    expect((await archiveResponse).status()).toBe(200);
    await reloadAndReauthenticate(page, profileId);
    await expect(page.getByRole("heading", { name: editedName, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Registrar medición" })).toBeDisabled();
    await page.getByRole("button", { name: "Mediciones", exact: true }).click();
    await expect(page.getByRole("table", {
      name: /Mediciones observadas vigentes/,
    })).toContainText("74 kg");
    await expect(page.getByRole("button", { name: "Corregir" }).first())
      .toBeDisabled();

    const deniedWrite = await page.request.patch(
      "/api/v1/measurements/" + corrected.id,
      { headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
        data: { ...preciseInput, value: 75,
          correction_reason: "El expediente ya está archivado." } },
    );
    expect(deniedWrite.status()).toBe(409);
    expect((await deniedWrite.json() as { code: string }).code).toBe("CONFLICT");

    // A different tenant has no authority to read even a fictional identifier.
    const outsider = await page.request.post("/api/v1/auth/login", {
      data: {
        organization_id: OUTSIDER_ORGANIZATION,
        email: "browser.outsider@example.invalid",
        password: PASSWORD,
      },
    });
    expect(outsider.status()).toBe(200);
    const outsiderToken = (await outsider.json() as { token: string }).token;
    const foreign = { Authorization: "Bearer " + outsiderToken };
    expect((await page.request.get("/api/v1/profiles/" + profileId,
      { headers: foreign })).status()).toBe(404);
    expect((await page.request.get(
      "/api/v1/measurements/" + corrected.id + "/versions",
      { headers: foreign })).status()).toBe(404);
    expect((await page.request.get(
      "/api/v1/profiles/" + profileId + "/measurements",
      { headers: foreign })).status()).toBe(404);

    // The original authenticated author retains read access to the history.
    const stillReadable = await page.request.get(
      "/api/v1/measurements/" + corrected.id + "/versions", { headers },
    );
    expect(stillReadable.status()).toBe(200);
    expect((await stillReadable.json() as Measurement[]).length).toBe(2);
  });
