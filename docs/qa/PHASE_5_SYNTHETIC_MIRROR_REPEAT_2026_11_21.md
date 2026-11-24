# BODYVISION AI — Fase 5: robustez de pose por reflejo y repetición (21-11-2026)

## Problema que se evalúa

La matriz existente comprueba detección y avisos de captura sobre nueve variantes
del mismo cuerpo anatómico 3D, incluido un control negativo sin persona.
No informa si la posición de los puntos del modelo cambia de manera inesperada
al invertir la imagen o al repetir la inferencia sobre la misma imagen.

Se amplía el recorrido E2E **con MediaPipe real en Chromium** sin añadir
corpus de personas, imágenes nuevas, APIs, credenciales ni almacenamiento.
Se usan exclusivamente las capturas sintéticas que ya generaba el atlas fijado.

## Nuevas mediciones y límites

1. **Reflejo horizontal:** se toman los landmarks *visibles* del caso frontal
   y del mismo caso invertido, y se emparejan los 33 índices MediaPipe con
   su pareja izquierda/derecha (la nariz se compara consigo misma).
   Después de reflejar la coordenada X, se calcula la diferencia euclidiana
   normalizada a la diagonal de la imagen. Se comunican cantidad de puntos
   comparables, cobertura, mediana y P95.
2. **Repetición del frontal:** la UI ejecuta por segunda vez el detector local
   sobre el mismo archivo ficticio. Debe conservar su decisión de detección.
   Se comparan las posiciones de landmarks comunes sin transformación,
   produciendo mediana y P95 descriptivos.
3. **Muestra insuficiente:** con menos de ocho puntos comparables, la mediana y
   P95 son `null`. La falta de detección nunca se rellena con puntos
   inventados. Los valores inválidos y los índices duplicados se rechazan.
4. **Privacidad:** las coordenadas se leen de los círculos SVG ya mostrados
   en la vista y se usan solo durante el recorrido transitorio de Playwright.
   El JSON de CI contiene recuentos y métricas agregadas, nunca
   fotografías, landmarks, coordenadas, nombres, identificadores personales
   o información del dispositivo. Se conservan las pruebas anteriores de
   aviso de captura y control negativo sin persona.
5. **Regresión matemática:** unit tests verifican los 33 emparejamientos,
   reflejo exacto (diferencia nula), perturbaciones, resultados vacíos,
   cobertura parcial, índices repetidos y valores no finitos.

## Interpretación

Esta es una prueba de **estabilidad técnica** del detector bajo dos
transformaciones sintéticas, **NO** precisión, exactitud, robustez en el
mundo real, sensibilidad/especificidad clínica ni localización respecto a
una anotación de referencia. Dos estimaciones equivocadas pueden coincidir;
una diferencia grande puede aparecer por la incertidumbre del modelo.
No se utiliza un umbral médico ni se promociona una captura con avisos
a un estado apto. El P95 se calcula sobre puntos, no sobre una población
representativa.

Los resultados de MediaPipe pueden variar por navegador, hardware o
versión del motor. Los hallazgos deben examinarse junto con el gate de
captura, no usarse automáticamente para tomar decisiones sobre personas.

## Puertas de aceptación

**Aceptación técnica aprobada el 21-11-2026 (hora de Lima).**
La [CI integral 44965518513](https://github.com/erosCordova/bodyvision-ai/actions/runs/44965518513)
del commit `337d0c8a99d890a5b4dc40d2ffe036c928e7497d` terminó con
`success`: **278 tests backend, 268 frontend, 43 navegador público
(incluida la inferencia real de reflejo/repetición) y 8 privado**;
597 pruebas de aplicación en total, además de Windows, Docker,
migraciones y controles de dependencias. La
[aceptación de retención 44965518523](https://github.com/erosCordova/bodyvision-ai/actions/runs/44965518523)
también aprobó. El artefacto `bodyvision-browser-evidence` conserva
`test-results/pose-robustness-matrix.json` con agregados, no puntos.

Con esta aceptación técnica adicional se revisa **manualmente** la Fase 5
de **85 % a 90 %** y el promedio de diez fases de **88,0 % a 88,5 %**,
representado como **89 %** en el tablero. No se considera una validación
clínica, antropométrica, de exactitud o de rendimiento en dispositivos reales.
El cierre al 100 % sigue condicionado a corpus consentido y autorizado,
anotaciones humanas, ensayos físicos y revisión independiente. La ejecución
de la CI no garantiza ausencia absoluta de defectos y no justifica
habilitar fotografías reales.
