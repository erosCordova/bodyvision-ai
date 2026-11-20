import { expect, test } from "@playwright/test";

test("the compiled Docker UI retains corrected observations and original versions after restart", async ({
  page, request,
}, testInfo) => {
  const live = await request.get("/api/v1/health/live");
  expect(live.ok()).toBe(true);
  expect((await live.json()).environment).toBe("local");

  await page.goto("/profiles");
  await page.getByRole("searchbox").fill("Expediente ficticio E2E");
  const profile = page.getByRole("link", { name: /Expediente ficticio E2E/ });
  await expect(profile).toHaveCount(1);
  await profile.click();
  await expect(page.getByRole("heading", { name: "Expediente ficticio E2E", exact: true }))
    .toBeVisible();
  const profileUrl = page.url();
  await page.getByRole("button", { name: "Mediciones", exact: true }).click();
  await expect(page.getByRole("cell", { name: "71 kg", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "72 kg", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Ver versiones", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Versión 1 · 72 kg", exact: true }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Versión 2 · 71 kg", exact: true }))
    .toBeVisible();
  await testInfo.attach("versiones-conservadas-docker", {
    body: await page.screenshot({ fullPage: true }), contentType: "image/png",
  });
  await page.getByRole("button", { name: "Cerrar diálogo", exact: true }).click();
  await page.getByRole("button", { name: "Resumen", exact: true }).click();
  await expect(page.getByText("21.914", { exact: true })).toBeVisible();
  await expect(page.getByText("DERIVADO", { exact: true })).toBeVisible();
  // Re-open the persisted route directly, exercising nginx's SPA fallback.
  await page.goto(profileUrl);
  await expect(page.getByRole("heading", { name: "Expediente ficticio E2E", exact: true }))
    .toBeVisible();
});
