# F6 — Robustez de la CI del atlas anatómico fijado (23-11-2026)

## Problema reproducido

En la segunda ejecución del PR #83, la suite `body-viewer.spec.ts`
abortó casi 30 pruebas de navegador por un fallo transitorio al descargar
`content/skin.json` desde GitHub Raw. El fixture **sí existe** en la
revisión anatómica inmutable
`28912432581accd7a1c62129d55f0e9758221d48` y el cambio de código
del visor no había provocado el fallo.

Una obtención fallida del catálogo bloqueaba antes del primer test
cualquier aceptación F6/F8, ocasionando repeticiones largas de CI.

## Entrega

Se crea el helper de **pruebas**, sin cambios a la aplicación:
`frontend/tests/helpers/pinnedAtlasFixtures.ts`.

- Los dos GLB originales y sus dos catálogos JSON están restringidos
  a un listado exacto de cuatro rutas de la revisión fija.
- Se comprueba el **SHA-1 de objeto Git completo** de cada descarga
  (`blob <bytes>\\0` + contenido), incluida la de cada catálogo JSON.
  Si la respuesta no corresponde, se falla inmediatamente; nunca se
  acepta el contenido distinto ni se cambia de modelo.
- La descarga tolera hasta tres reintentos tras un HTTP transitorio,
  404 de CDN o error de transporte. Esperas acotadas: 400, 1200 y
  2500 ms, con un máximo de 18 segundos por solicitud.
- Las respuestas exitosas se leen en streaming con un límite de 128 MiB
  por archivo; contenido vacío, ilegible, excesivo o digest diferente
  se rechazan. La cabecera `Content-Length` puede describir los bytes
  *comprimidos* del transporte, de modo que no se exige su igualdad con
  el cuerpo descomprimido, pero **sí** el hash de los bytes finales.
- Nunca se registran cuerpos, credenciales ni excepciones detalladas
  del transporte en los mensajes de error del helper.
- El `beforeAll` de `body-viewer.spec.ts` usa este helper y conserva
  la interceptación de rutas, con un solo atlas/canvas y sin escrituras
  HTTP. No se agrega dependencia a la aplicación en producción.

## Pruebas sintéticas sin red

`frontend/tests/pinnedAtlasFixtures.test.ts` verifica: cuatro hashes
fijos, respuesta íntegra en el primer intento, recuperación ante 404/
503/error de red, límite de cuatro intentos, rechazo inmediato por
digest, tamaño excesivo, ausencia de bytes, error por path no autorizado
y tolerancia al `Content-Length` previo a descompresión.

CI integral Linux/Chromium/Windows/Docker requerida antes de
fusionar la propuesta. Una respuesta remota persistente o una
modificación real del modelo **siguen bloqueando**, correctamente.

## Límites

Esta estrategia reduce fallos pasajeros del servicio de distribución,
pero **no sustituye** una copia independiente con garantías de custodia,
una licencia del atlas ni pruebas físicas. Los SHA-1 de objetos Git se
usan para fijar bytes de *fixtures de pruebas*, no como firma clínica
ni como garantía de seguridad del software en producción. Los resultados
no certifican FPS/GPU, precisión morfológica ni consentimiento.
F6 permanece en 90 % y el avance global estimado en 93 %.
