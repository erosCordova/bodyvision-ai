# Fase 3 — Bloque funcional: frontend JWT de acceso + refresh HttpOnly

**Alcance:** local/test, usuarios y expedientes **ficticios** exclusivamente.
No se autoriza producción, información personal real ni validación clínica.

## Activación separada del modo legado

El frontend conserva por defecto el sistema anterior de tokens opacos en
memoria para preservar las rutas y pruebas existentes. El modo nuevo exige
**ambas banderas** en el servidor de desarrollo Vite:

```ini
VITE_ENABLE_PRIVATE_AUTH=true
VITE_PRIVATE_COOKIE_AUTH=true
```

El backend de pruebas debe tener `identity_enabled` y
`jwt_access_enabled` activados, la clave JWT externa configurada
y las migraciones correctas. Los ajustes de servidor no se modifican
por este PR. En builds de producción de Vite, `privateAuthEnabled()` y
`privateCookieAuthEnabled()` permanecen **desactivados**.

## Recorrido completo en el frontend

1. **Inicio de sesión:** `POST /api/v1/auth/access/login` con
   credenciales ficticias, `credentials: same-origin` y cabecera
   `X-Requested-With: XMLHttpRequest`. El navegador añade `Origin` en
   solicitudes POST del mismo origen; JavaScript no intenta falsificarlo.
2. **Credenciales protegidas:** la cookie de refresh la establece el servidor
   con `HttpOnly`, `SameSite=Strict` y el path de autenticación. Ninguna
   operación JavaScript la lee. El JWT corto `access_token` vive **solo en
   React RAM**, nunca en `localStorage`, `sessionStorage`, rutas, logs
   o una caché persistente.
3. **Restauración tras recarga:** la página privada muestra
   «Restaurando sesión privada de pruebas…» hasta que responde
   `POST /api/v1/auth/access/refresh`. Si la cookie falta o caducó,
   se ofrece el formulario; no se realizan consultas de expedientes.
4. **Uso de la API:** un bearer JWT se envía a cada ruta protegida.
   Nunca se adjunta `X-Workspace-ID` a peticiones privadas.
   Ante un 401 se hace **un único refresh y un reintento**
   del mismo endpoint. Las llamadas concurrentes comparten refresh;
   no se consume dos veces el token rotatorio.
5. **Renovación preventiva:** se programa 30 segundos antes de la expiración
   del JWT; si falla se borra sesión local y cachés, también la captura
   ficticia aún no procesada. Se valida que usuario, organización y rol
   no cambien durante una renovación de sesión.
6. **Cierre y concurrencia:** si hay una rotación de cookie pendiente,
   el cierre espera su respuesta antes de enviar logout, para no revocar el
   token anterior mientras queda un sucesor válido. Se prueba la carrera
   refresh/logout además de los reintentos 401.
   **Cierre:** `POST /api/v1/auth/access/logout` usa solo cookie protegida
   y cabeceras anti-CSRF. La sesión, caché y captura en RAM se limpian
   antes de confirmar el cierre remoto. Si la red falla, se muestra la
   advertencia existente sobre posible sesión remota aún vigente.

El flujo MFA de **configuración inicial** puede emitir una sesión opaca
según el contrato actual. El frontend no simula que esa respuesta crea
una cookie de refresh: deja la sesión opaca temporalmente y el próximo
login normal puede usar el modo cookie. Esta transición se mantiene
explícita hasta que se unifique el endpoint backend de MFA.

## Tests y responsabilidad de integración

- `frontend/tests/privateCookieAuth.test.tsx`: restore, inicio, logout
  HttpOnly, un retry de API tras 401, rechazo de refresh que cambia rol,
  revocación y ausencia de credenciales persistentes.
- `frontend/tests/privateCookieTransport.test.ts`: desactivación por flags,
  transporte, validación, y *singleflight* de refresh concurrente.
- Tests legados del provider, `recordsApi`, MFA y demo deben seguir pasando.
- La rama de Arena [PR #40](https://github.com/erosCordova/bodyvision-ai/pull/40)
  implementa revocación de familia/replay en backend; este PR de ChatGPT
  se puede revisar aparte, pero **no se declara end-to-end aprobado**
  hasta correr pruebas integradas con la versión de Arena.

Se exige CI completa, revisión de seguridad y prueba HTTP real de cookies
en el entorno privado de pruebas antes de fusionar al producto. Este
bloque no representa formalmente un aumento porcentual del proyecto.

## Brechas que NO se cierran aquí

«Recordarme», cierre por inactividad, modal de reidentificación, invitación
por correo real, recuperación de contraseñas fuera del flujo de pruebas,
multitenencia con personas reales, seguridad del proxy TLS que termina HTTPS,
dispositivos físicos, capturas/custodia externas, observabilidad y auditoría
independientes y habilitación productiva continúan fuera del alcance. Nunca
se debe inferir aprobación legal, clínica ni operación real por pasar CI.
