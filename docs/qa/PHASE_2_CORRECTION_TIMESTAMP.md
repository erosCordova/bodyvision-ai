# F2 — conservar el instante de observación al corregir un valor

20 de noviembre de 2026 · America/Lima.

## Problema reproducido

La API admite segundos y microsegundos en `measured_at`. El formulario muestra
fecha y hora de Lima con precisión de minutos. Antes reconstruía siempre el
timestamp añadiendo `:00-05:00`, incluso si el usuario solo corregía el peso.

Ejemplo ficticio: `2026-10-01T03:04:56.789123Z` aparece en el campo como
`2026-09-30T22:04`. Cambiar 72 kg a 71 kg enviaba erróneamente
`2026-09-30T22:04:00-05:00`: desplazaba la observación 56.789123 segundos.
El original seguía conservado en la cadena, pero la nueva versión cambiaba
silenciosamente una fecha que el usuario no había editado.

## Comportamiento corregido

- Si el campo conserva el mismo minuto local que mostraba al abrir, la corrección
  reenvía la cadena completa recibida de la API. No la reconstruye mediante `Date`,
  que perdería la precisión superior a milisegundos.
- Si se cambia ese campo, se envía la nueva fecha/minuto de Lima con segundos 00,
  manteniendo el comportamiento del control existente.
- Una medición nueva continúa usando la precisión de minutos del formulario.
- La API, las migraciones y las observaciones ya guardadas no se modifican.

## Evidencia de regresión

La prueba de formulario reprodujo dos fallos con el código anterior (UTC y offset
de Lima, con cambio de día); los casos de fecha editada y registro nuevo ya pasaban.
Con el cambio pasan los cuatro casos. Solo se simulan el transporte y el contenedor
modal; el recorrido Playwright usa el formulario, API y PostgreSQL reales.

El nuevo E2E crea por API una medición ficticia con microsegundos y la corrige desde
la UI sin tocar la fecha. Comprueba que el timestamp persistido coincide exactamente
con el original. Después cambia expresamente la fecha desde el formulario y verifica
la cadena de tres versiones: valores `[72, 71, 71]`, los dos primeros instantes iguales
y el último igual a la nueva hora elegida. Se ejecuta en nativo y en la UI Docker
compilada porque ambos reutilizan `data-core.spec.ts`.

Integrar únicamente tras aprobar los tres jobs: Windows, nativo y Docker. La PR
registra el run y los resultados efectivamente observados.

## Revisión del avance

F1 conserva 95 % con recepción Windows/Docker Desktop pendiente. Esta entrega revisa
el núcleo ya implementado de F2, sin declarar cerradas sus fases anteriores: añade
una corrección de trazabilidad temporal demostrable y su aceptación automatizada
en API/UI. La preparación para identidad ya se encuentra implementada y probada en
la rama privada de desarrollo. La estimación técnica manual de F2 pasa de 90 a 95 %,
dejando pendiente la recepción funcional independiente. La suma pasa de 750 a 755:
la media redondeada de diez fases pasa de 75 a 76 %. No es una certificación ni una
consecuencia automática del número de tests o commits.

El cierre formal F1/F2 y la habilitación para personas reales permanecen pendientes.
No se altera el personaje 3D, la base alojada en Neon, `main` ni los despliegues.
