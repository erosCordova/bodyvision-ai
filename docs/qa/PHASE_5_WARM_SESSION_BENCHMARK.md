# Fase 5 — sesión efímera para benchmark de pose local

## Problema y cambio implementado

La prueba optativa de cinco ejecuciones (`PoseReview`) utilizaba
`detectPoseOnDevice(file)` en cada muestra: aunque reutilizaba el motor
MediaPipe, validaba, decodificaba y reescalaba la misma fotografía
**cinco veces**. Eso hacía que el tiempo comunicado mezclase decodificación
con inferencia y repetía asignaciones de bitmap y canvas en el dispositivo.

Ahora `createPoseInferenceSession` valida y prepara la imagen ficticia
**una sola vez** a un lienzo con idéntico límite de 1024 píxeles. Cierra
el bitmap grande antes de cargar el motor. `runPreparedPoseBenchmark`
reutiliza ese mismo lienzo en cinco llamadas secuenciales a MediaPipe,
con una cesión al event loop entre cada muestra para permitir la
cancelación. El temporizador solo abarca `detect()` + parseo del
resultado. El tiempo de preparación y la carga inicial no entran en
estas mediciones.

La sesión tiene un método `release` idempotente y el orquestador lo
invoca en `finally`, incluso si el usuario cancela al preparar el
modelo, cambia de fotografía, falla un análisis o se desmonta la vista.
Se descartan resultados obsoletos. La inferencia normal individual
también utiliza una sesión de una sola detección y libera el lienzo al
terminar.

## Alcance y límites

- No cambia modelo, pesos, shaders, landmarks, umbrales, resolución,
  atlas anatómico, geometría, peso/estatura ni servicios remotos.
- No se guardan, exportan ni envían las fotografías ni los tiempos.
- Las pruebas sintéticas verifican una sola apertura y liberación,
  cinco detecciones sobre un lienzo, cancelación al cargar, cancelación
  entre repeticiones, errores parciales y omisión si ya se canceló.
- La medición ahora debe etiquetarse como **latencia de inferencia
  caliente con imagen preparada**, y no como latencia extremo a extremo.
  El primer análisis sigue mostrando el tiempo total incluyendo carga.
- Reducir cinco decodificaciones a una es una optimización de trabajo
  y de ciclo de vida, **no una medición comprobada de RAM, latencia real
  o ahorro energético en un dispositivo físico**. No inventar métricas
  de hardware ni afirmar exactitud clínica.

## Puertas para avanzar

CI completa (tests unitarios, E2E MediaPipe real sobre el atlas,
Docker y pruebas privadas), ensayos manuales consentidos con
**fotografías exclusivamente ficticias** en teléfonos reales, perfiles
de memoria/temperatura y validación clínica y de seguridad pendiente.
No modificar `main`, Vercel, Render ni Neon sin necesidad.
