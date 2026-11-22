# Fases 4 y 5 — captura y pose durante la renovación de acceso

Fecha: 22-11-2026, America/Lima. Base: `5e37f057`.
Ámbito: cuentas ficticias, acceso privado optativo local/test.

## Resultado funcional

Capturas y resúmenes de pose invalidaban inmediatamente la sesión ante un
JWT anterior, mientras administración y expedientes ya podían renovarlo.
Ahora las cuatro familias comparten el mismo mecanismo: una sola renovación
para consultas concurrentes y un único reintento cuando el servidor rechazó
la autorización antes de modificar datos. Cada familia conserva su validación
de respuesta, mensajes y cabeceras específicas.

El PNG se reenvía como el mismo Blob, con declaración ficticia y tipo de
contenido intactos. El resumen conserva exactamente el JSON mínimo y la misma
clave de idempotencia. El estado del formulario de pose depende de organización,
usuario, rol, expediente y detección; una renovación no descarta la operación
pendiente ni su aviso final. Cambiar identidad sí limpia la confirmación.

## Cancelación y fallos

- Cancelar una consulta impide su reintento, incluso si espera una renovación.
  No cancela la renovación compartida que otra consulta todavía necesita.
- El presupuesto de siete segundos del servicio de pose incluye la espera
  por renovación. Un vencimiento no deja una escritura diferida del cliente.
- Los fallos de red, 403, 409 y 500 no repiten operaciones; un resultado
  incierto de subida no se trata como rechazo previo de autorización.
- Un segundo 401 invalida el token que realmente falló y termina el intento.
  Sin un proveedor de renovación se conserva el rechazo de sesiones antiguas.
- La autorización, los consentimientos y la idempotencia del servidor siguen
  siendo necesarios en cada petición. La renovación no concede permisos.

## Evidencia

`privateCapturePoseRenewal.test.ts` contiene 14 casos de PNG, descarga, borrado,
purga, payload de pose, idempotencia, concurrencia, cancelación, plazo y fallos.
Se añaden dos regresiones de formulario a `pose-summary-archive.test.tsx`:
respuesta de guardado conservada durante renovación y limpieza al cambiar usuario.

`cookie-e2e/capture-pose-after-refresh.spec.ts` usa navegador y PostgreSQL reales:
crea un expediente ficticio con aceptaciones por finalidad, invalida el JWT
mediante rotación real de cookie, sube un único PNG, verifica el SHA-256 del
archivo descargado, lo elimina y guarda un resultado del detector local. El
guardado de pose conserva la misma clave/cuerpo entre 401 y 201, muestra el
resultado y no añade mediciones observadas. No intercepta HTTP ni altera relojes.
La clave de cifrado usada en ese job es efímera y no se imprime.

Las 328 pruebas de frontend (64 archivos), TypeScript, ESLint y compilación
de producción aprobaron localmente. La aceptación integral del commit se
registrará al terminar GitHub Actions.
El navegador local no puede iniciarse por las restricciones de sockets del
entorno; esa limitación no se presenta como una prueba de aplicación aprobada.

## Avance y límites

Se mantienen las estimaciones: F4 90 %, F5 90 %, media global **92,5 % exacto /
93 % mostrado**. La entrega corrige continuidad funcional; no cierra privacidad,
retención de copias, corpus independiente, hardware físico o revisión externa.
No modifica Neon ni publica cambios en producción.
