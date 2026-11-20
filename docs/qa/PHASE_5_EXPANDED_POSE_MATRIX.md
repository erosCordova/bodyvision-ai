# Fase 5 — matriz ampliada de robustez de pose sintética

## Alcance

La prueba Playwright `pose quality matrix` se amplía desde las tres
transformaciones previas hasta **ocho escenarios** con inferencia real
MediaPipe Lite en el navegador. Se utiliza **únicamente el atlas anatómico
sintético aprobado**, con captura de sus vistas frontal y lateral izquierda.
La imagen, transformaciones y landmarks permanecen en memoria del navegador;
solo se escribe al artefacto de CI un JSON con etiquetas y resultados técnicos.

| Escenario | Condición sintética | Gate verificable |
| --- | --- | --- |
| Frontal de control | Captura del atlas 3D existente | Registro descriptivo de detección |
| Lateral izquierda | Cámara de vista anatómica lateral | Registro descriptivo sin asumir detección |
| Luz insuficiente | Brillo 18 % | Alerta de iluminación |
| Sobreexposición | Superposición blanca opaca al 94 % | Alerta de iluminación |
| Resolución reducida | 360 × 480 px | Alerta de resolución |
| Recorte inferior | Solo 70 % superior de la captura | Registro de detección y advertencias, sin inventar puntos |
| Reflejo horizontal | Imagen frontal invertida | Registro comparativo del mismo cuerpo |
| Oclusión central | Rectángulo opaco en zona central | Registro sin afirmar recuperación correcta de articulaciones |

## Indicadores

`poseRobustnessReport.ts` agrega: detecciones, ausencia de detección,
fracción de imágenes con detección, casos con advertencias de captura,
estados de revisión, resultados catalogados como «aptos para revisión
visual» pese a que falló el control de captura, e inconsistencias entre la
presencia detectada y la etiqueta presentada.

La última pareja de contadores **debe valer cero**; de lo contrario la
prueba falla. Las condiciones con iluminación extrema o resolución baja
también deben producir su aviso técnico. El reporte registra los
resultados variables de MediaPipe, **sin fijar una cuota artificial de
detecciones**, sensibilidad, especificidad ni un supuesto porcentaje de
precisión anatómica. Una detección puede contener landmarks imprecisos.

El artefacto `test-results/pose-robustness-matrix.json` no contiene fotos,
landmarks, nombres personales ni identificadores físicos de dispositivo.
Los escenarios sintéticos son reproducibles con el modelo y el SDK fijados
en el repositorio; el resultado puede variar con el motor de WebGL, CPU,
navegador y cambios de infraestructura de CI.

## Bloqueos pendientes

Para validar la precisión real faltan corpus autorizados e independientes,
anotación humana de referencia, consentimiento y privacidad aprobados,
ensayos por postura/oclusiones/grupos de dispositivos físicos, latencia,
consumo/temperatura y revisión clínica. No habilita datos de pacientes ni
modifica el personaje anatómico definitivo. Sin despliegues ni cambios en main.
