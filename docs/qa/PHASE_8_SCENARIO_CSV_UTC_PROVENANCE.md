# Fase 8 — Fecha UTC inequívoca en exportaciones de escenarios ficticios

**Fecha:** 23 de noviembre de 2026. Alcance: simulaciones ficticias, sin
datos personales ni alteraciones al modelo anatómico 3D.

## Hallazgo

El CSV de historial de simulaciones transforma `created_at` en
`fecha_utc` con `new Date(...).toISOString()`. La validación anterior
solo comprobaba que el resultado fuera numéricamente finito: un timestamp
sin zona se interpretaba **según el reloj local del navegador**. Una
fecha incompleta o inexistente podía normalizarse silenciosamente.
Dos equipos podrían producir diferentes instantes UTC a partir del
mismo texto sin zona, lo cual contradice la trazabilidad del historial.

## Contrato implementado

La exportación `buildSyntheticScenarioCsv` exige en cada fila:

- Fecha ISO completa `AAAA-MM-DDTHH:mm:ss`, con segundos.
- Zona horaria explícita `Z` o desfase `±HH:MM` de hasta 14 horas,
  sin permitir desplazamientos fuera de ese rango.
- Día civil real, con validación independiente contra la fecha ISO;
  rechaza febrero 29 de año no bisiesto y días imposibles como abril 31.
- Hora `00:00:00` a `23:59:59`; no acepta hora 24, segundos 60 ni
  cadenas locales ambiguas, fechas sin hora o texto libre.
- Los timestamps aceptados se normalizan a ISO UTC con milisegundos,
  sin depender de la zona horaria del ordenador del usuario.

El cambio se realiza **solo en la serialización del CSV**. No reescribe
escenarios guardados, cronologías inmutables, revisiones, mallas ni el
renderizador. El CSV conserva las columnas y la política estricta de
campos autorizados; nunca contiene IDs de personas ni notas libres.

## Pruebas sintéticas

`frontend/tests/scenarioCsv.test.ts` comprueba conversiones positivas y
negativas de huso, fecha de año bisiesto, rechazo de zona ausente,
fecha reducida, día imposible, hora 24 y desfases extremos.

`frontend/tests/scenarioHistoryExport.test.ts` introduce una fecha sin
zona en la última de tres páginas y verifica **rechazo íntegro sin
generar un CSV parcial**, manteniendo la paginación autorizada.

El PR debe pasar la matriz de CI Linux/Windows/Docker y navegador.

## Límites

Una zona escrita en un registro no prueba que el reloj original
estuviese sincronizado o que el evento físico ocurrió en ese momento.
No valida precisión de simulación ni antropometría de usuarios reales.
La aceptación funcional independiente y pruebas en hardware siguen
pendientes. F8 permanece en 95 % y el global estimado en 93 %; no
hay cambios a `main`, Neon, producción ni al único modelo 3D.
