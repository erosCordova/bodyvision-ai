import { expect, test } from "@playwright/test";

const org = "10000000-0000-4000-8000-000000000001";
const profiles = Array.from({ length: 13 }, (_, i) => ({
  id: "10000000-0000-4000-8001-" + String(i+1).padStart(12,"0"),
  organization_id: org, display_code: "UI-" + String(i+1).padStart(2,"0"),
  display_name: "Expediente interfaz " + String(i+1).padStart(2,"0"),
  birth_year: 1990, sex: null, status: "active",
  created_at: "2026-01-01T00:00:00Z", synthetic: true,
}));

test("measurement and report selectors can reach records beyond the first page", async ({page}) => {
  // Controlled synthetic pagination fixture; API authorization has separate integration tests.
  await page.route("**/api/v1/profiles?*", async route => {
    const url=new URL(route.request().url());
    const search=url.searchParams.get("search") ?? "";
    const offset=Number(url.searchParams.get("offset") ?? 0);
    const limit=Number(url.searchParams.get("limit") ?? 12);
    const filtered=profiles.filter(p=>p.display_name.includes(search));
    await route.fulfill({json:{items:filtered.slice(offset,offset+limit),offset,limit,total:filtered.length}});
  });
  await page.goto("/measurements");
  const pagination=page.getByRole("navigation",{name:"Páginas de expedientes de mediciones"});
  await expect(pagination).toContainText("1–12 de 13");
  await pagination.getByRole("button",{name:"Siguiente"}).click();
  await expect(page.getByRole("link",{name:/Expediente interfaz 13/})).toBeVisible();
  await page.getByLabel("Buscar expediente").fill("01");
  await expect(pagination).toContainText("1–1 de 1");
  await page.getByRole("navigation",{name:"Navegación principal"}).getByRole("link",{name:"Reportes"}).click();
  const reportPages=page.getByRole("navigation",{name:"Páginas de expedientes del informe"});
  await reportPages.getByRole("button",{name:"Siguiente"}).click();
  await expect(page.getByLabel("Expediente ficticio").locator("option")).toContainText(["Seleccionar expediente","Expediente interfaz 13"]);
  await page.getByLabel("Buscar expediente").fill("01");
  await expect(reportPages).toContainText("1–1 de 1");
});

test("reports block printing and CSV after a failed load and provide retry", async ({page}) => {
  const profile=profiles[0];
  await page.route("**/api/v1/profiles?*",route=>route.fulfill({json:{items:[profile],total:1,limit:12,offset:0}}));
  await page.route("**/api/v1/profiles/"+profile.id,route=>route.fulfill({json:profile}));
  await page.route("**/api/v1/profiles/"+profile.id+"/measurements?*",route=>route.fulfill({
    status:503,json:{code:"TEST_FAILURE",message:"Fallo sintético de conexión"},
  }));
  await page.route("**/api/v1/profiles/"+profile.id+"/analytics/derived",route=>route.fulfill({json:[]}));
  await page.goto("/reports");
  await page.getByLabel("Expediente ficticio").selectOption(profile.id);
  await expect(page.getByRole("alert")).toContainText("Fallo sintético de conexión");
  await expect(page.getByRole("button",{name:"Exportar registros visibles (CSV)"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Imprimir vista previa"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Reintentar",exact:true})).toBeVisible();
});

test("mobile navigation keeps account entry accessible", async ({page}) => {
  await page.setViewportSize({width:375,height:812});
  await page.goto("/measurements");
  await page.getByRole("link",{name:"Acceso",exact:true}).click();
  await expect(page).toHaveURL(/\/access$/);
  await page.getByRole("link",{name:/Entrar a la demostración/}).click();
  await expect(page.getByRole("heading",{name:"Dashboard general"})).toBeVisible();
});
