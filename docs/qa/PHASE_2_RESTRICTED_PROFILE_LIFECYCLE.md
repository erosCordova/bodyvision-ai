# F2 — Restricción y reactivación real del expediente ficticio

## Problema corregido

El expediente marcado `restricted` impedía escribir nuevas mediciones,
pero el endpoint de edición todavía permitía modificar la referencia
mientras el expediente permanecía en modo de solo lectura. La pantalla
también mantenía disponible ese botón, pese a mostrar estado restringido.

Además, el cambio de estado inspeccionaba permisos y estado antes de
actualizar la fila sin mantener un bloqueo exclusivo sobre la misma.
La escritura de mediciones sí utilizaba un bloqueo de fila y podía
intercalarse con ese cambio de estado.

## Implementación

El backend ahora bloquea la fila de `profiles` con `FOR UPDATE OF p`
durante la validación y modificación del estado, en la misma transacción.
Exige que el usuario tenga concesión explícita de escritura y rol
autorizado. Sin perfil visible y autorizado, responde 404; en un
expediente archivado o ante escritura prohibida por restricción, 409.

La **única escritura** permitida en un expediente restringido es la
reactivación con el cuerpo exacto `{"status":"active"}`. No se permite
combinarla con cambio de referencia para eludir el bloqueo. Reactivar no
restaura acceso revocado ni crea concesiones. El expediente archivado
permanece inmutable desde la API.

La interfaz del expediente muestra el estado de solo lectura, deshabilita
«Editar referencia» y nuevas mediciones mientras esté restringido y
solicita confirmación antes de restringir o reactivar. Tras el cambio,
invalida las consultas de expediente, listado y resumen; su historial
permanece visible, sin borrar versiones previas.

## Verificación

- Prueba integrada local con PostgreSQL: bloqueo de mediciones, rechazo
  de edición de referencia y del atajo combinado, lectura preservada,
  reactivación seguida de actualización autorizada y archivado.
- Prueba privada: administrador sin acceso explícito recibe 404,
  usuario de lectura recibe 403 al reactivar, otra organización 404;
  editor con permisos puede restringir, reactivar y registrar una
  medición observada ficticia. La versión anterior no se modifica.
- Playwright real: crea un perfil ficticio, restringe con confirmación
  en la interfaz, verifica botones deshabilitados y rechazo del API,
  reactiva explícitamente y comprueba una medición guardada en el
  historial usando el backend real.

Este incremento corresponde al **ciclo de vida funcional de F2**,
no a aceptación independiente de QA ni uso con datos médicos reales.
No sustituye identidad, consentimiento, almacenamiento privado,
retención en backups ni revisión legal. No requiere modificar el
modelo anatómico ni la plataforma de despliegue.

El tablero conserva provisionalmente **95 % en F2 y 92,5 % global
(93 % visible)** hasta disponer de evidencia de CI y aceptación formal.
No se modifica `main` ni se habilita `production`.

## Evidencia de integración y aceptación sintética — 22-11-2026

El [PR #55](https://github.com/erosCordova/bodyvision-ai/pull/55)
se fusionó en `feature/phase3-auth-security` con el commit
`ab85623c4d4de678d23489977b36b0b73ba050bd`.

La [CI integral #45069987874](https://github.com/erosCordova/bodyvision-ai/actions/runs/45069987874)
aprobó en el commit `8905f7354f218510d63604ae532e3c0a48ac8215`:
**440 backend + 331 frontend + 44 navegador público +
13 navegador privado + 4 navegador cookies = 832 pruebas de aplicación**.
Los trabajos `native-checks`, `windows-scripts` y
`docker-smoke` terminaron con `success`. También aprobaron
migraciones, compilación, restauración PostgreSQL aislada, permisos y
proceso de pruebas en navegador. La
[aceptación independiente de retención #45069987864](https://github.com/erosCordova/bodyvision-ai/actions/runs/45069987864)
terminó con `success`.

La primera ejecución del cambio detectó un cierre JSX faltante; la
siguiente detectó formato Ruff. Posteriormente la nueva prueba
privada precisó un ajuste de limpieza para no borrar mediciones
inmutables y la prueba E2E precisó volver a consultar el servidor
después de una escritura creada fuera de la caché React Query.
Las correcciones se integraron antes del run final aprobado;
no se deshabilitó ningún bloqueo de seguridad.

**Alcance:** se corrigió el estado restringido y se comprobó
autorización/reativación de extremo a extremo con datos ficticios.
No hay firma de QA independiente, consentimiento legal,
autorización para pacientes, custodia externa ni cierre formal
de F2. La estimación de F2 sigue en 95 % y el promedio manual
en 92,5 % (93 % visible). No hubo merge a `main` ni despliegue.
