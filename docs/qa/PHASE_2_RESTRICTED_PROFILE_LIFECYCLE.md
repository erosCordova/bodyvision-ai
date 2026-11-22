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
