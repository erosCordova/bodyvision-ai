import { expect, test } from "@playwright/test";
import { anatomySource } from "../../src/features/viewer/atlasSource";

test("dashboard requests the same anatomical atlas as the full viewer", async ({page}) => {
  const skin = page.waitForRequest(request=>request.url()===anatomySource+"web/public/models/skin.glb");
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Visión corporal 3D"})).toBeVisible();
  await skin;
  const preview=page.locator('[data-model="anatomy-atlas"]');
  await expect(preview).toHaveAttribute("data-loaded","true",{timeout:60000});
  await expect(preview.getByRole("button",{name:"Piel",exact:true})).toHaveAttribute("aria-pressed","true");
  const skeleton=page.waitForRequest(request=>request.url()===anatomySource+"web/public/models/skeleton.glb");
  await preview.getByRole("button",{name:"Huesos",exact:true}).click();
  await skeleton;
  await expect(preview).toHaveAttribute("data-loaded","true",{timeout:60000});
  await expect(preview.getByRole("button",{name:"Huesos",exact:true})).toHaveAttribute("aria-pressed","true");
  await preview.getByRole("button",{name:"Espalda"}).click();
  await expect(page.getByRole("progressbar",{name:"Avance estimado del proyecto"})).toHaveCount(0);
  await page.getByRole("link",{name:/Abrir visor completo/}).click();
  await expect(page).toHaveURL(/\/body-3d$/);
});
