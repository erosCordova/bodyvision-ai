import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const ORG = "10000000-0000-4000-8000-000000000001";
const PASSWORD = "Browser fixtures only 2026!";
const ADMIN = "browser.privacy-admin@example.invalid";
const OFFICER = "browser.privacy-officer@example.invalid";

// Test-only TOTP from the real enrollment response; never log seeds or codes.
function totp(seed: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...seed].map(c => alphabet.indexOf(c).toString(2).padStart(5, "0")).join("");
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map(b => Number.parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

async function login(page: Page, email: string, recoveryCode: string) {
  await page.goto("/access");
  await page.getByLabel("Identificador de organización", { exact: true }).fill(ORG);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Código de verificación (si está activado)").fill(recoveryCode);
  const pending = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/access/login") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ access_token: string; role: string }>;
}

test("MFA privacy officer: create, grant, triage, revoke consent, refresh and deny clinical access", async ({ page }) => {
  await page.goto("/access");
  const credentials = { organization_id: ORG, email: ADMIN, password: PASSWORD };
  const started = await page.request.post("/api/v1/auth/mfa/enrollment", { data: credentials });
  expect(started.status()).toBe(200);
  const secret = new URL((await started.json() as { otpauth_uri: string }).otpauth_uri).searchParams.get("secret")!;
  const confirmed = await page.request.post("/api/v1/auth/mfa/confirm", { data: { ...credentials, code: totp(secret) } });
  expect(confirmed.status()).toBe(200);
  const admin = await confirmed.json() as { token: string; recovery_codes: string[] };
  const auth = { Authorization: "Bearer " + admin.token };
  const profileResponse = await page.request.post("/api/v1/profiles", { headers: auth,
    data: { display_name: "Privacidad ficticia", birth_year: 1995 } });
  expect(profileResponse.status()).toBe(201);
  const profile = await profileResponse.json() as { id: string; display_code: string };
  const consentPath = `/api/v1/auth/profiles/${profile.id}/consents`;
  expect((await page.request.post(consentPath, { headers: auth,
    data: { purpose: "capture", version: "bv-synthetic-v1", confirmed: true } })).status()).toBe(200);
  expect((await page.request.post(`/api/v1/profiles/${profile.id}/privacy-requests`, {
    headers: auth, data: { request_type: "cancellation", synthetic_confirmed: true },
  })).status()).toBe(201);

  await login(page, ADMIN, admin.recovery_codes[0]);
  await page.getByRole("link", { name: "Administración", exact: true }).click();
  await page.getByLabel("Nombre ficticio", { exact: true }).fill("Responsable ficticio");
  await page.getByLabel("Correo ficticio", { exact: true }).fill(OFFICER);
  await page.getByLabel("Tipo de usuario", { exact: true }).selectOption("privacy_officer");
  await page.getByLabel("Contraseña de pruebas", { exact: true }).fill(PASSWORD);
  const pendingCreate = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/users") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Crear cuenta ficticia", exact: true }).click();
  expect((await pendingCreate).status()).toBe(201);
  await page.getByLabel("Buscar expediente por código", { exact: true }).fill(profile.display_code);
  await expect(page.getByLabel("Expediente del catálogo")).toContainText(profile.display_code);
  await page.getByLabel("Expediente del catálogo").selectOption(profile.id);
  await page.getByLabel("Nivel de acceso").selectOption("manage");
  const pendingGrant = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/profile-access/grant"));
  await page.getByRole("button", { name: "Conceder permiso", exact: true }).click();
  expect((await pendingGrant).status()).toBe(200);
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Iniciar sesión", exact: true })).toBeVisible();

  // Complete enrollment through the actual UI, including the one-time code display.
  await page.getByLabel("Identificador de organización", { exact: true }).fill(ORG);
  await page.getByLabel("Correo electrónico", { exact: true }).fill(OFFICER);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar al espacio privado" }).click();
  await page.getByRole("button", { name: "Configurar autenticador" }).click();
  const officerSeed = await page.locator("code.private-mfa-secret").textContent();
  expect(Boolean(officerSeed)).toBe(true);
  await page.getByLabel("Código del autenticador").fill(totp(officerSeed!));
  const enrolled = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/mfa/confirm"));
  await page.getByRole("button", { name: "Activar verificación" }).click();
  const enrollmentResponse = await enrolled;
  expect(enrollmentResponse.status()).toBe(200);
  const officer = await enrollmentResponse.json() as { recovery_codes: string[] };
  await page.getByRole("button", { name: "He guardado mis códigos" }).click();
  await expect(page.getByText("Responsable de privacidad", { exact: true })).toBeVisible();
  // Re-login creates the HttpOnly cookie after the opaque enrollment session.
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  const session = await login(page, OFFICER, officer.recovery_codes[0]);
  expect(session.role).toBe("privacy_officer");
  await expect(page.getByRole("heading", { name: "Solicitudes de privacidad", exact: true })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  await expect(nav.getByRole("link")).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "Privacidad", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar solicitud ficticia" })).toHaveCount(0);
  await expect(page.getByText(profile.display_code + " · Cancelación", { exact: true })).toBeVisible();
  const pendingReview = page.waitForResponse(r => /\/api\/v1\/privacy-requests\/[^/]+\/review$/.test(r.url()));
  await page.getByRole("button", { name: "Iniciar revisión", exact: true }).click();
  const review = await pendingReview;
  expect(review.status()).toBe(200);
  expect((await review.json() as { status: string }).status).toBe("in_review");
  await expect(page.getByText("Revisión administrativa ficticia iniciada. La solicitud no está resuelta.")).toBeVisible();
  await page.getByRole("button", { name: "Consultar consentimientos de " + profile.display_code }).click();
  await expect(page.getByRole("button", { name: "Registrar aceptación ficticia" })).toHaveCount(0);
  await page.getByRole("button", { name: "Revocar consentimiento de Captura de imágenes" }).click();
  await expect(page.getByText("Consentimiento revocado. El historial se conserva.")).toBeVisible();
  const pendingRefresh = page.waitForResponse(r => r.url().endsWith("/api/v1/auth/access/refresh"));
  await page.reload();
  const refresh = await pendingRefresh;
  expect(refresh.status()).toBe(200);
  const refreshed = await refresh.json() as { access_token: string; role: string };
  expect(refreshed.role).toBe("privacy_officer");
  expect((await page.context().cookies()).some(c => c.name === "bv_private_refresh" && c.httpOnly)).toBe(true);
  for (const path of ["/api/v1/profiles", `/api/v1/profiles/${profile.id}/measurements`, "/api/v1/auth/users"]) {
    expect((await page.request.get(path, { headers: { Authorization: "Bearer " + refreshed.access_token } })).status()).toBe(403);
  }
  await page.goto("/profiles");
  await expect(page.getByRole("heading", { name: "Solicitudes de privacidad", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Expedientes", exact: true })).toHaveCount(0);
  await page.goto("/body-3d");
  await expect(page.getByRole("heading", { name: "Solicitudes de privacidad", exact: true })).toBeVisible();
});
