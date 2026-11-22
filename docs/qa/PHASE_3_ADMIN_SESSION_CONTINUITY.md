# Fase 3 — continuidad de operaciones administrativas tras renovar JWT

Fecha: 22-11-2026, America/Lima. Base de desarrollo: `a03dc475`.
Ámbito: acceso privado optativo local/test con cuentas ficticias.

## Problema y resultado

Las peticiones de expedientes podían renovar el acceso, pero el transporte de
administración cerraba la sesión ante cualquier 401. Además, el formulario de
invitaciones usaba el JWT como clave React: la renovación desmontaba el panel
y podía perder la respuesta con el código que se muestra una sola vez.

`secureRequest` ahora comparte la renovación en curso, reintenta una sola vez
con el JWT verificado y conserva cuerpo/método. Un 401 final invalida el token
que efectivamente falló; los 403 y demás errores no provocan reintentos.
La API conserva la autorización previa a la mutación. Las sesiones opacas sin
proveedor de renovación continúan fallando de forma cerrada.

El proveedor reconoce hasta 16 predecesores de acceso de la misma sesión en
memoria. Una respuesta tardía puede usar el sucesor ya verificado sin volver a
consumir la cookie. Tokens desconocidos no reciben esa sustitución. La lista se
vacía al cerrar sesión, invalidar, iniciar otra autenticación o confirmar MFA;
no se reutiliza entre identidades. El servidor verifica cada token sucesor.

El panel de invitaciones ahora conserva su instancia durante una renovación y
cambia de instancia cuando cambia organización, usuario o rol. El código y los
campos siguen limitados a memoria; cerrar el panel descarta el código.

## Verificación

- `privateAdminSessionContinuity.test.tsx`: cinco regresiones de renovación,
  conservación del código, cuerpo idéntico, respuestas tardías, olvido tras
  logout/login, rechazo de tokens desconocidos, 403, rechazo final y concurrencia.
- `cookie-e2e/admin-after-refresh.spec.ts`: autenticación y rotación reales de
  cookie contra PostgreSQL; el JWT anterior deja de funcionar, crear una
  invitación devuelve 401 y después 201, se conserva el código y se revoca
  desde la misma interfaz. No intercepta HTTP ni altera el reloj del servidor.
- Las comprobaciones de TypeScript y ESLint pasan localmente. La aceptación
  integral de GitHub Actions se registrará al concluir sobre el commit enviado.

El Chromium local no pudo iniciarse por la restricción de sockets del entorno;
esa ejecución no acredita aceptación de navegador. El caso nuevo se ejecuta
en el job de cookie de CI junto con los flujos existentes.

## Avance

Se conserva **F3 95 % y global 92,5 % exacto / 93 % mostrado**. Esta corrección
no registra aceptación humana ni cierra los pendientes externos. No cambia
Neon, `main`, despliegues o el modelo anatómico.
