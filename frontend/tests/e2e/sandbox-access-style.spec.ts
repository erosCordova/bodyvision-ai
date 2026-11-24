import { expect,test } from "@playwright/test";
test("sandbox access switches registration forms and keeps password controls accessible",async({page})=>{
  test.skip(process.env.VITE_ENABLE_SANDBOX_AUTH!=="true","requires sandbox frontend");
  await page.setViewportSize({width:390,height:844});
  await page.goto("/access");
  await expect(page.getByRole("heading",{name:"Bienvenido de nuevo"})).toBeVisible();
  await page.getByRole("button",{name:"Crear cuenta",exact:true}).first().click();
  await expect(page.getByRole("heading",{name:"Crea tu cuenta"})).toBeVisible();
  await page.getByLabel("Contraseña",{exact:true}).fill("test-password-123");
  await page.getByRole("button",{name:"Mostrar contraseña",exact:true}).click();
  await expect(page.getByLabel("Contraseña",{exact:true})).toHaveAttribute("type","text");
  await expect(page.getByLabel("Usaré exclusivamente expedientes ficticios.")).toBeVisible();
  await page.getByRole("button",{name:"Iniciar sesión",exact:true}).first().click();
  await expect(page.getByLabel("Contraseña",{exact:true})).toHaveValue("");
});
