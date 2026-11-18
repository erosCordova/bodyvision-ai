# BODYVISION AI — Fase 3 (fundación de identidad y consentimiento)

## Objetivo y estado

Esta rama contiene **solo la base segura de datos y las políticas del dominio**.
**El nuevo API privado de login solo se activa explícitamente en local/test; no
incorpora cuentas reales ni abre operaciones clínicas.** La demostración pública
permanece sintética y de solo lectura. No fusionar como «seguridad completa».

## Entregas de esta iteración

- Migración `0003_identity_foundation`: usuarios con email y hash de contraseña
  opcionales (los operadores de prueba existentes quedan deshabilitados para
  autenticación), roles por organización, sesiones opacas con digest SHA-256,
  consentimiento versionado por finalidad y auditoría mínima sin payload clínico.
- Políticas de acceso de **denegación por defecto**: un administrador no puede
  consultar un expediente sin un permiso explícito; los miembros no pueden
  modificar expedientes ni ejecutar captura/IA.
- Verificación de contraseña con PBKDF2-HMAC-SHA256 y sal aleatoria, sin guardar
  contraseñas en texto plano. El esquema deberá revisarse frente a los
  requisitos de seguridad vigentes antes de producción.
- Tokens opacos con persistencia solo de hash; el API privado comprueba credenciales,
  crea/revoca sesiones y devuelve el rol verificado. Un selector de organización
  no se acepta como identidad en modo protegido.
- Rol PostgreSQL separado para autenticación; el rol de datos pierde permiso
  para consultar contraseñas cifradas.
- Comprobación de consentimiento por finalidad, vigencia y revocación.
- Nuevas tablas **sin permisos** para `bodyvision_app`. Se establecerá
  posteriormente un rol de base de datos específico para autenticación y
  consentimiento, previa revisión de privilegios.

## Siguiente incremento antes de activar el login

1. Provisionamiento administrativo verificado y recuperación segura de cuentas.
2. Rate limiting distribuido, MFA, renovación y protección contra sesiones robadas.
3. Integración de frontend autenticado y revisión de almacenamiento de sesiones.
4. Controles por expediente en API y políticas RLS, con pruebas de acceso
   cruzado y de consentimiento revocado.
5. Cifrado de datos privados, almacenamiento de capturas con autorización,
   rate limiting, auditoría verificable, revisión legal y respaldo seguro.

## Regla de despliegue

Los cambios se proponen en una **rama de desarrollo**, con solicitud de
cambios en borrador. No se fusionan a `main` ni se publican en Vercel/Render
hasta que se prueben y se apruebe un entregable suficientemente completo.

**Fuente de requisitos:** documentación BODYVISION v3, Fase 3 (Seguridad e
identidad), modelo funcional de usuarios/roles/consentimientos y criterios de
salida; documentación v2, capítulos 4, 11 y 12.

## API de pruebas, sin publicación

En un entorno local o CI aislado con PostgreSQL, las variables
IDENTITY_ENABLED=true y AUTH_DATABASE_URL habilitan un rol de autenticación
separado. No se habilitan en demo, staging ni producción.

- POST /api/v1/auth/login: sesión solo de cuentas ficticias provisionadas.
- GET /api/v1/auth/me: identidad y rol de la sesión activa.
- POST /api/v1/auth/logout: revocación de sesión.

En modo protegido los endpoints de expedientes obtienen organización y actor
de la sesión verificada, no de X-Workspace-ID. Las políticas PostgreSQL RLS
y las concesiones profile_access limitan las filas; los miembros tienen
acceso de lectura, no de edición. El resumen aplica los mismos límites.

Faltan alta verificada, tasa máxima de intentos, MFA, controles del frontend,
auditoría integral y consentimiento en futuras API de captura y pose.
Datos reales no admitidos. No fusionar ni desplegar sin aceptación de fase 3.

## Interfaz privada de pruebas (incremento posterior)

El frontend dispone de formulario de sesión y navegación restringida **solo en
un entorno Vite de desarrollo** con `VITE_ENABLE_PRIVATE_AUTH=true`. El backend
debe ejecutarse en `APP_ENV=local` o `test`, con
`IDENTITY_ENABLED=true` y `AUTH_DATABASE_URL` correspondiente al rol de
autenticación de la base PostgreSQL de pruebas. Las cuentas de prueba deberán
ser provisionadas explícitamente por el administrador de ese entorno.

- El token opaco se mantiene **solo en memoria React**; no se copia a
  almacenamiento local, sessionStorage, URL, cookies ni caché de React Query.
- La organización y los permisos se obtienen de la sesión del servidor. Las
  peticiones autenticadas envían `Authorization: Bearer` sin
  `X-Workspace-ID`; el selector sintético solo sigue funcionando en demo.
- Antes de login, las rutas de expedientes están bloqueadas y no inician
  solicitudes privadas. Una sesión caducada se descarta también en frontend.
- Los miembros de solo lectura no reciben controles de edición, además de
  la comprobación de permisos obligatoria del backend.
- El cierre de sesión revoca el token remotamente. Si falla la revocación,
  se borra la sesión local y se informa de que el token podría seguir vigente
  hasta caducar.

La compilación pública, incluso si recibe la variable, no puede activar
esta modalidad porque exige `import.meta.env.DEV`. El acceso público de
demostración permanece únicamente con datos ficticios. Falta un flujo
completo de alta controlada, MFA, recuperación y limitación de intentos, y
la revisión integral de privacidad y seguridad antes de usar datos reales.

## Restricción de proveedor de base de datos

Toda base de datos **alojada** de BODYVISION debe estar en Neon. Render
puede servir el backend, pero no PostgreSQL ni archivos de base de datos.
El PostgreSQL de Docker en CI o desarrollo es desechable y no constituye
un alojamiento de datos. La base persistente en Neon nunca recibe datos
personales reales mientras no se aprueben seguridad y privacidad.


## Límite transaccional de intentos de inicio de sesión

La migración `0005_login_throttle` añade `auth_login_attempts` a la base
PostgreSQL de pruebas. Nunca se almacena la dirección de correo en texto
plano en esa tabla, sino un digest SHA-256 con alcance de organización;
el digest es **seudónimo**, no una anonimización irreversible.

- Se permiten cinco intentos por cuenta y organización durante una ventana
  de quince minutos. El sexto intento recibe HTTP 429, incluso si la
  contraseña es correcta, hasta la expiración del bloqueo.
- Se contabilizan los intentos **antes** de verificar la contraseña mediante
  una función PostgreSQL atómica con `SECURITY DEFINER`. El incremento
  se confirma en una transacción distinta y no desaparece cuando falla el
  inicio de sesión. Esto permite compartir el límite entre instancias.
- El contador se limpia únicamente después de autenticar las credenciales,
  comprobar un rol asignado y crear la sesión dentro de la misma transacción.
- El rol de autenticación no puede leer ni modificar directamente la tabla:
  solo tiene permiso para ejecutar las funciones controladas.
- Correo u organización inexistentes reciben el mismo error de credenciales
  inválidas que una contraseña equivocada, hasta alcanzar el umbral.

**Alcance y límites:** la medida reduce ataques repetidos contra una misma
identidad; no sustituye un límite global por dirección de origen, protección
contra ataques distribuidos a múltiples correos, MFA ni observabilidad. Un
tercero podría provocar bloqueos de una cuenta conocida. Es un control
provisional para cuentas sintéticas; se requiere revisión antiautomatización
antes de aceptar usuarios reales. No aplicar esta migración a la base
pública de demostración de Neon sin plan de migración y aprobación.


## Alta controlada y auditoría (incremento de fase 3)

Migración `0006_private_user_admin` — **exclusiva de local/CI con cuentas y
expedientes ficticios**. La aplicación pública continúa con `0002_data_core`
en Neon y no expone endpoints privados.

- `POST /api/v1/auth/users`: únicamente un **administrador con sesión
  verificada** crea cuentas de tipo `member` o `specialist`, con correo del
  dominio reservado `example.invalid`. No permite elevar a administrador,
  no acepta identificadores de organización del cliente y no crea accesos a
  expedientes por defecto. La contraseña se almacena exclusivamente como hash
  con sal, no se devuelve en la respuesta.
- `GET /api/v1/auth/audit`: exclusivamente administradores; hasta cincuenta
  eventos, limitados a la organización derivada de su propia sesión.
- Se registran `auth.login`, `auth.logout`, `admin.user_provisioned` y
  denegaciones de alta o consulta de auditoría, con actor, correlación y
  resultado, pero **sin contraseñas, tokens ni cuerpos de solicitud**.
- Ambas operaciones acceden a PostgreSQL a través de funciones
  `SECURITY DEFINER` de alcance restringido. Los roles de aplicación y
  autenticación no pueden leer ni escribir directamente las tablas de
  auditoría ni de límites de intentos.
- Para crear el primer administrador de un entorno de pruebas hace falta un
  procedimiento de bootstrap separado con una identidad migradora confiable.
  No existe autorregistro de administradores ni cuentas activas por defecto.
- Las pruebas confirman rechazo de cuentas duplicadas, correos no sintéticos,
  elevación de rol, lectura sin permiso y aislamiento entre organizaciones.

**Pendiente antes de producción:** bootstrap auditado de administradores,
política de contraseñas revisada, MFA, protección distribuida por IP/cliente,
revocación remota garantizada en condiciones de red adversas, verificación
legal, consentimientos completos, auditoría de acceso a cada expediente y
pruebas de intrusión. Este registro es una **auditoría parcial de identidad**,
no una auditoría clínica completa. Neon sigue siendo el único proveedor
admitido para bases alojadas; PostgreSQL de Docker/CI es de uso temporal.

## Panel de administración privada (interfaz de pruebas)

La ruta existente `/administration` conserva la presentación informativa
en la demo pública; únicamente Vite en modo desarrollo con
`VITE_ENABLE_PRIVATE_AUTH=true` muestra la pantalla funcional de pruebas.

La pantalla consume `POST /api/v1/auth/users` y `GET /api/v1/auth/audit`
mediante `Authorization: Bearer`, sin aceptar selectores de organización ni
almacenar el token en el navegador. Solo administradores autenticados ven
el formulario de alta y la tabla de los últimos treinta eventos. Los otros
roles ven un aviso de acceso restringido y no solicitan datos de auditoría.

Los datos de entrada se limitan a usuarios ficticios con correo
`@example.invalid`. Tras crear la cuenta se limpia la contraseña del
formulario y se actualiza el registro de auditoría. El frontend no puede
sustituir la autorización del backend: las operaciones siguen verificando
sesión, organización y rol dentro de PostgreSQL.

Aún pendiente: flujo auditado de primer administrador, concesión y revocación
de permisos por expediente, recuperación segura, MFA, auditoría de operaciones
clínicas y conformidad de privacidad. No habilitar sobre datos personales.


## Auditoría transaccional de expedientes (incremento 0007)

La migración `0007_profile_audit` crea la función
`record_private_profile_event`, concedida exclusivamente al rol de la API
de datos. El backend autentica cada solicitud y configura actor y organización
dentro de una transacción PostgreSQL. Las operaciones auditadas emiten
un evento de acceso permitido **en esa misma transacción**; si la función de
auditoría falla, la operación sobre el expediente no se confirma.

Se registran únicamente identificador del expediente, organización, actor,
acción, correlación, hora y resultado; nunca valores clínicos, contraseñas,
tokens, nombres o contenido de las solicitudes. Las acciones cubiertas son:
listado/consulta/creación/actualización/archivo de expedientes;
listado/consulta/alta/corrección de mediciones; y lecturas analíticas.

La función verifica de nuevo que se trata de una identidad ficticia activa,
que el expediente pertenece a la organización y que existe una concesión
vigente de acceso. Las escrituras además requieren rol administrativo o de
especialista y acceso `write` o `manage`. Un administrador no puede consultar
un expediente sin permiso explícito. Las pruebas comprueban que las lecturas,
actualizaciones y consultas de métricas originan un evento, y que los
intentos rechazados no se registran como accesos permitidos.

**Limitaciones pendientes:** esta versión todavía no registra por separado
cada acceso denegado a expedientes, cambios de permisos ni exportaciones
de información; tampoco completa la política de retención del registro.
Las denegaciones deben registrarse en una transacción independiente para
que no desaparezcan con el rollback de la operación fallida. Antes de
incorporar información personal real se requiere auditoría integral,
consentimientos verificables, revisión independiente y medidas de privacidad.

El despliegue público sobre Neon permanece en la revisión
`0002_data_core`: esta migración está destinada únicamente a la base
PostgreSQL desechable de desarrollo y CI. Render nunca aloja datos.
