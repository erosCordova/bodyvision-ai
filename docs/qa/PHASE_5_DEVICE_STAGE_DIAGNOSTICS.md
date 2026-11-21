# Fase 5 — diagnóstico técnico de rendimiento por etapas

## Implementación

El módulo `poseDiagnostics.ts` define un informe **solo en memoria**, con
los intervalos registrados mediante `performance.now()` por una única
ejecución voluntaria sobre una imagen **sintética**: validación de formato
y dimensiones, preparación y decodificación, disponibilidad del modelo,
inferencia, limpieza y tiempo total.

Tras confirmar que la imagen es ficticia, la interfaz ofrece
**«Diagnosticar etapas (1 ejecución)»** además del benchmark de cinco
detecciones. No inicia automáticamente ni altera los resultados del
análisis principal. Mientras se ejecuta impide una evaluación paralela;
el usuario puede cancelar la visualización de sus resultados.
El bitmap grande se libera antes de preparar el modelo, y el canvas
de análisis siempre se libera mediante `finally`. El objeto de
diagnóstico conserva solo tiempos y si se detectó pose; **no conserva
coordenadas, imágenes, capturas, identificadores ni nombres de equipo**.

## Memoria

Se consulta `performance.memory.usedJSHeapSize` **solo cuando
el navegador la expone**. Este campo es una API no estandarizada,
normalmente ausente en Firefox/Safari y navegadores móviles. Mide
una instantánea aproximada de **heap de JavaScript**, no la RAM del
dispositivo, memoria del proceso, WebAssembly ni GPU. Sus diferencias
antes/después no prueban ahorro, pico ni eficiencia energética.
En caso de campo ausente, inexacto o inválido, se presenta
«No disponible»; nunca se fabrican valores. Ni los valores ni las
imágenes se guardan o se envían.

La cifra «Modelo listo» indica el tiempo transcurrido esperando la
instancia del detector y puede incluir descarga, inicialización o
simplemente recuperación de una instancia ya creada. Se muestra
explícitamente si existía una instancia en caché al comenzar;
**eso no verifica que estuviera completamente lista**.

## Validación y límites

- Tests deterministas de duración por etapa, relojes anómalos y
  ausencia de API de heap.
- Tests de interfaz: consentimiento, reporte y cancelación con
  descarte de resultados tardíos.
- Test de navegador real: analizar el atlas sintético y ejecutar el
  diagnóstico mediante acción explícita.
- Las pruebas en CI no sustituyen mediciones en teléfonos reales.
  Rendimiento, batería, temperatura y corpus anotado independiente
  siguen pendientes. No constituye validación clínica ni autoriza
  imágenes reales.

Sin cambios en personaje 3D definitivo, base de datos, ramas de
producción ni despliegues.
