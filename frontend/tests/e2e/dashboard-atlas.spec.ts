import { expect, test } from "@playwright/test";
import { anatomySource } from "../../src/features/viewer/atlasSource";

test("dashboard renders the pinned atlas as a single holographic mesh without layer controls", async ({page}) => {
  const models:string[]=[];
  page.on("request",request=>{
    if(request.url().includes("/models/") && request.url().endsWith(".glb")) models.push(request.url());
  });
  const expected=anatomySource+"web/public/models/skin.glb";
  const skin=page.waitForRequest(request=>request.url()===expected);
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Visión corporal 3D"})).toBeVisible();
  await skin;
  const preview=page.locator('[data-model="anatomy-atlas"]');
  await expect(preview).toHaveAttribute("data-loaded","true",{timeout:60000});
  await expect(preview).toHaveAttribute("data-render-mode","holograma");
  await expect(preview.locator("canvas")).toHaveCount(1);
  await expect(preview.getByRole("button")).toHaveCount(0);
  await expect(preview.getByRole("group",{name:"Capas del cuerpo en el dashboard"})).toHaveCount(0);
  expect([...new Set(models)]).toEqual([expected]);
  await expect(page.getByRole("progressbar",{name:"Avance estimado del proyecto"})).toHaveCount(0);
  await page.getByRole("link",{name:/Abrir visor completo/}).click();
  await expect(page).toHaveURL(/\/body-3d$/);
});
