# F1 — scripts de instalación en Windows con Git Bash

20 de noviembre de 2026 · America/Lima.

## Alcance concreto

La CI añade `windows-scripts` en un runner `windows-latest`, con Python 3.12 y
shell Bash. Ejecuta los mismos helpers de instalación y comprobación que Linux,
sin dependencias Python adicionales. No levanta Docker Desktop ni PostgreSQL
en Windows: la recepción completa de la instalación continúa pendiente.

`setup_local.py` ahora lee y escribe UTF-8 explícito y genera saltos LF incluso
si la plantilla usa CRLF. Así, el resultado no depende de la codificación local
predeterminada de Windows. Conserva la creación exclusiva mediante `O_EXCL` y
nunca regenera un `.env` existente.

## Casos que debe pasar cada sistema

- Preparación real mediante subprocess en una ruta con espacios.
- Dos contraseñas aleatorias distintas, URLs coherentes y plantilla sustituida.
- Ausencia de secretos en salida estándar y errores.
- Un `.env` anterior permanece idéntico byte a byte tras un intento repetido.
- Una plantilla CRLF con caracteres españoles genera UTF-8/LF legible.
- Comprobador HTTP: servicios locales, esquema correcto, fallos y respuestas
  incompatibles, límites, redirecciones y servidor no disponible.
- Conservación SQL: cambios en registros/secuencias detectados, variaciones de
  claves restrict/unrestrict admitidas y copias vacías rechazadas.

Las pruebas crean únicamente directorios temporales y servidores loopback; no
leen ni alteran el `.env` del checkout de trabajo y no contactan Neon. El modo
de archivo `0600` de Unix no acredita ACL privadas de Windows; esta entrega no
promete esa equivalencia.

## Evidencia y criterio de cierre

Consultar en la PR el resultado efectivo de `windows-scripts`, `native-checks`
y `docker-smoke`; los tres deben aprobarse antes de integrar. Esto acredita
portabilidad de los scripts en el Windows del runner, no instalación completa
de BodyVision en el equipo del usuario, funcionamiento de Docker Desktop,
compatibilidad Edge/Safari ni aceptación independiente de QA/operaciones.

La fase 1 permanece en **95 %** y el total en **75 %**. La recepción humana de
Windows/Docker Desktop sigue registrada en el checklist operativo.
