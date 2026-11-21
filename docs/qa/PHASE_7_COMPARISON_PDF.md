# Fase 7 — informe de comparación imprimible en PDF

## Alcance implementado

En **Expedientes → Evolución → Comparar dos fechas** se puede preparar una
vista A4 imprimible y usar **Imprimir → Guardar como PDF** en el navegador.
Se trata de una exportación iniciada por el usuario, **no** de un PDF generado,
almacenado, firmado ni auditado por el servidor.

La función se habilita únicamente para expedientes identificados como
**ficticios/sintéticos**. La selección parte de los registros OBSERVADO vigentes
de un único expediente y una sola métrica, obtenidos por las rutas autorizadas
existentes. No combina perfiles, mediciones sustituidas o escenarios de simulación.
No se hace ninguna solicitud de API adicional al imprimir.

Cada informe conserva:
- Código del expediente sintético y métrica con unidad.
- Fecha local de preparación (zona America/Lima).
- Fecha, valor e ID íntegro de cada una de las dos mediciones.
- Variación absoluta y porcentual, indicando si la base cero impide calcular %.
- Aclaración expresa de procedencia observada, ausencia de firma/auditoría de
  exportación y prohibición de interpretación clínica.

La impresión usa un componente aislado fuera de la estructura visual de la
aplicación y reglas `@media print` que ocultan la interfaz ordinaria.
Los valores se interpolan mediante React, sin HTML no confiable. La vista
temporal se desmonta al cerrarse el diálogo de impresión.

## Pruebas

- Referencias a los registros originales, cronología y variación exacta.
- Bloqueo de expedientes reales, mediciones de otra persona, otra métrica
  y versiones antiguas.
- División por cero, fechas erróneas, duplicación y datos no finitos.
- Apertura local del diálogo de impresión, separación de la página e
  imposibilidad de exportar perfiles no ficticios.

## Pendiente para producción

Este documento imprimible NO es un informe médico certificado. Antes de admitir
datos personales se requieren revisión legal de exportación, consentimiento y
base jurídica, autorización granular de descarga, evento de auditoría
servidor, firmas/sello verificables, política de retención, pruebas de
navegadores e impresión física y protección de archivos guardados por usuario.

**Evaluación técnica manual:** Fase 7 de 60 a 70 % después de CI aprobada,
por implementación de informe PDF local y pruebas de procedencia. El avance
global de diez fases igualmente ponderadas pasaría de 72 a 73 %. Esto no
certifica preparación para producción y no habilita datos de personas reales.
