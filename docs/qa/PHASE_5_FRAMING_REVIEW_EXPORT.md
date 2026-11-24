# Fase 5: indicadores de encuadre y resumen local de pose

20 de noviembre de 2026 — implementación en la rama privada
`feature/phase3-auth-security`.

## Función incorporada

Al revisar una fotografía **ficticia** con MediaPipe Lite, BODYVISION
sigue informando el número de landmarks visibles y las zonas corporales.
Ahora también advierte, de forma prudente, cuando los ocho puntos principales
tienen un orden vertical claramente invertido, están muy cerca del límite
de la fotografía o su extensión vertical es demasiado pequeña para una
revisión cómoda. Solo se aplican estos controles cuando los ocho puntos
principales son visibles. Una alerta reduce el estado a «Requiere revisión»;
**no corrige** puntos, no calcula diagnóstico y no afirma precisión de IA.

Desde el panel de revisión se puede **descargar voluntariamente** un
`bodyvision-revision-pose-sintetica.json` con la versión del esquema,
el modelo local utilizado, la presencia/ausencia de pose, el estado de
revisión, la visibilidad agregada por zona, el umbral y el resultado de
los cuatro controles de captura. Se crea en el propio navegador y no se
envía a la API. El constructor usa una lista cerrada de campos; no
serializa la fotografía, coordenadas, archivo original, nombres,
tokens, identificadores ni texto libre introducido por el usuario.

## Pruebas y limitaciones

- `frontend/tests/poseQuality.test.ts`: inversión vertical, borde de
  imagen y cuerpo demasiado pequeño sobre datos sintéticos.
- `frontend/tests/poseReviewReport.test.ts`: estructura del informe,
  ausencia de coordenadas/datos arbitrarios y no generación de puntos
  cuando no se detecta figura humana.
- `frontend/tests/e2e/body-viewer.spec.ts`: recorrido real sobre el
  atlas anatómico ficticio, incluida descarga del informe JSON sin
  datos personales ni coordenadas. El resultado debe verificarse en CI.

Las comprobaciones geométricas usan criterios heurísticos de vista
vertical; para personas tumbadas, acrobacias o cámaras giradas podrían
generar alertas legítimas aunque la detección sea correcta. No son
mediciones clínicas ni un clasificador entrenado para juzgar posturas.
El archivo no ha sido verificado en móviles físicos y su origen
ficticio depende del flujo de demostración.

**Sin cambios de porcentaje:** Fase 5 sigue en 65 % y el avance global
en 76 % en la evaluación manual hasta disponer de un corpus autorizado,
etiquetas independientes, protocolos de precisión y pruebas por dispositivo.
No habilita datos reales, no sustituye consentimiento, seguridad ni
aprobación clínica; no requiere despliegue ni cambia el avatar seleccionado.
