# Fase 3 — Invitaciones completas desde la interfaz privada

## Alcance y límites

Se conecta la API de invitaciones ya implementada en la migración
`0025_synthetic_invitations` con dos recorridos de la aplicación de
**desarrollo/pruebas exclusivamente**. Solo se permiten direcciones de
`example.invalid`, organizaciones ficticias y credenciales sintéticas.
No se enviarán correos, no se incorporarán personas reales y no hay
despliegue productivo.

## Recorrido del administrador

Desde **Administración y seguridad**, el administrador autenticado abre
«Gestionar invitaciones ficticias», introduce nombre, correo, rol
`member` o `specialist` y confirma **su propia contraseña**. La API
genera un código de 43 caracteres válido durante 48 horas. El código
se muestra una sola vez y vive únicamente en el estado React de la
página: no se almacena en `localStorage`, `sessionStorage`, URL ni
historial. El administrador puede ocultarlo definitivamente o revocar
la invitación. La lista paginada muestra estados sin devolver códigos.

No se puede invitar a un administrador ni seleccionar una organización
desde una cabecera editable; las operaciones usan el bearer de sesión
verificada y el servidor comprueba rol, organización y contraseña.

## Recorrido del invitado

En **Acceso seguro**, el enlace «Tengo una invitación ficticia» permite
introducir un código recibido por un canal de prueba y definir la
contraseña propia. La petición de aceptación no adjunta JWT ni cookies;
el código se envía únicamente en el JSON del POST. El backend consume
el código en una transacción, crea la cuenta y devuelve organización y
rol sin iniciar sesión.

Tras aceptar, la persona debe realizar **un login separado**. La
aceptación **no concede permisos de expedientes**; para operar requiere
autorización individual vigente y los consentimientos pertinentes.

## Pruebas y cierre

- `frontend/tests/privateInvitations.test.tsx`: contrato de creación,
  presentación única, revocación, dominio permitido, secret-free storage,
  validación de rechazo y aceptación anónima sin cookies.
- `frontend/tests/private-e2e/invitations.spec.ts`: navegador real
  en el entorno PostgreSQL sintético; admin crea/revoca, invitación
  revocada no funciona, segunda invitación se consume, cuenta inicia
  sesión, acceso a expediente no concedido se rechaza y el código
  consumido no puede reutilizarse.
- `backend/tests/integration/test_user_invitations.py` mantiene los
  controles SQL de expiración, aislamiento, simultaneidad, auditoría y
  privilegios; las pruebas frontend no sustituyen esos controles.

La validación de CI queda registrada en la ejecución específica del
commit. **No se declara aprobación de identidad legal**, custodia
externa de claves, MFA real, firma de producto o privacidad para
expedientes auténticos. No se fusiona ni despliega por este bloque.
