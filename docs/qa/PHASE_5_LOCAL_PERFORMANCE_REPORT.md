# Fase 5 — informe descargable de rendimiento local y privacidad

## Función entregada

Tras ejecutar voluntariamente un benchmark (cinco inferencias con un mismo
lienzo preparado) o un diagnóstico técnico por etapas sobre el atlas
**exclusivamente sintético**, se habilita «Descargar informe técnico (JSON)».
Este botón crea un Blob JSON **solo en el navegador**, bajo clic explícito.
No realiza llamadas de red, no guarda automáticamente el informe, no conecta
telemetría y no abre permisos para fotografías clínicas.

El JSON tiene versión de esquema fija `1`; su propósito es comparar
una prueba repetible en una computadora o teléfono físico que ejecuta
la aplicación. Incluye: tamaño del archivo de imagen expresado en
dimensiones, estados booleanos de los cuatro criterios de calidad,
detección sí/no, latencia total del primer análisis, métricas del
benchmark caliente solo cuando se ejecutó, y tiempos por etapa/muestras
opcionales de heap JavaScript si el navegador expone la API.

## Privacidad

Se construye un objeto nuevo con **lista positiva de campos**, no
`JSON.stringify` del estado original de React ni de MediaPipe.
Se excluyen expresamente: datos de imagen, bytes, URL `blob:`, nombre
de archivo, coordenadas 3D/2D, landmarks, identidad, cuenta, navegador,
`userAgent`, dirección IP, modelo concreto de teléfono y tokens.
No se recoge hora exacta ni identificador persistente. La descarga
se entrega únicamente al usuario y se revoca su URL temporal.

La propiedad `actualMobileHardwareVerified: false` es intencional:
el navegador no puede demostrar por sí solo que se usó un equipo físico
ni sustituir una evaluación independiente del ensayo. Para validar
el dispositivo, una persona debe probarlo **en el propio equipo** y
documentar esa condición fuera del informe si procede.

## Metodología para pruebas físicas posteriores

1. En un teléfono Android o iOS autorizado, abrir la interfaz ejecutada
   en HTTPS (sin crear un despliegue innecesario para cada cambio).
2. Cargar exclusivamente un atlas ficticio. Comprobar los controles
   de calidad y ejecutar una detección única.
3. Confirmar la naturaleza sintética del ensayo. Ejecutar las cinco
   repeticiones y el diagnóstico de etapas, uno tras otro.
4. Pulsar «Descargar informe técnico (JSON)» y conservar el archivo
   **solo si se quiere**. Repetir en otro dispositivo y comparar en
   particular latencia, presencia de memoria opcional, estabilidad y
   errores. No interpretar diferencias como precisión médica.
5. Documentar manualmente prueba de hardware, consumo térmico, batería,
   picos reales de RAM, compatibilidad con navegador móvil y políticas de
   privacidad. Las métricas automáticas no prueban esos factores.

## Verificación automatizada

- Tests de serialización verifican esquema, valores nulos, redondeo,
  ausencias y exclusión de entradas maliciosas.
- Tests de UI garantizan que no hay exportación antes del consentimiento
  y la medición y que la descarga se activa por el clic del usuario.
- E2E con MediaPipe real sobre el atlas sintético verifica que el JSON
  descargado no incluya imágenes, nombres o landmarks.

No se incrementa automáticamente el porcentaje de fase 5 por crear una
herramienta de medición; siguen faltando pruebas de teléfonos físicos.
