# F1 — recepción local asistida en Windows

20 de noviembre de 2026 · America/Lima. Verificación posterior al reinicio: 13:37.

**Resultado: cierre técnico de F1 para desarrollo local con datos ficticios.**
La instalación y el reinicio fueron realizados por el usuario; la revisión
funcional se completó con asistencia del agente desde su Chrome conectado.
No es una firma externa de QA ni una aprobación de producción.

## Evidencia observada y declarada

| Control | Resultado y origen de la evidencia |
|---|---|
| Equipo objetivo | Windows 11 declarado por el usuario; terminal Git Bash y Docker Desktop mostrados durante la sesión |
| Instalación | El usuario ejecutó la receta de copia separada y confirmó su finalización; el agente accedió al servicio real en localhost:8080 |
| Incidencia inicial | El motor Linux estaba cerrado/no disponible. El usuario abrió Docker Desktop y posteriormente la aplicación respondió |
| Expediente | «Prueba Windows F1», año ficticio 1995, accesible en Chrome |
| Cadena previa | Versión original de 72 kg y una corrección del usuario que mantenía 72 kg |
| Corrección asistida | El agente guardó una tercera versión de 71 kg con motivo de prueba; las anteriores permanecieron conservadas |
| Recarga inicial | El navegador volvió a solicitar la página y mostró el vigente de 71 kg y las tres versiones |
| Reinicio | El usuario confirmó detener y arrancar el grupo de BodyVision desde Containers de Docker Desktop. El agente no controla esa aplicación nativa ni observó directamente el clic |
| Comprobación posterior | Tras esa confirmación, el agente recargó la aplicación y abrió las versiones: 72, 72 y 71 kg; la última seguía vigente |
| Salud posterior | /system mostró «API en ejecución», versión 0.2.0, y «Base de datos conectada», esquema 0018_capture_maintenance; hora visible 13:37:33 de Lima |
| Versiones Docker/Compose y commit local | No se recopilaron; no se infieren a partir de la rama solicitada ni de la versión de la API |

Se dejó abierta la vista de versiones como evidencia verificable para el usuario.
La prueba usa solo información ficticia; no se publica el identificador local del
expediente ni capturas con otros proyectos del equipo.

## Qué acredita el cierre

La recepción combina instalación del usuario, recorrido asistido en el entorno
objetivo y consulta efectiva posterior al reinicio que el usuario confirmó.
Complementa los ensayos ya aprobados de checkout limpio, migraciones, aislamiento,
preservación SQL y navegador Docker en CI. Es **recepción asistida**, no ejecución
sin ayuda ni firma independiente de un profesional de QA.

F1 pasa de 95 a 100 % en el seguimiento técnico local: el pendiente de recepción
ya tiene evidencia, con su nivel de asistencia explícito. La aceptación formal de
producto sigue separada y no se inventa una firma. F0, F2 y producción conservan
sus propios criterios pendientes. La suma de diez fases pasa de 755 a 760 y el
avance global redondeado permanece en 76 %.

## Límites que no se presentan como resueltos

- Se detuvo y arrancó el grupo de contenedores: no se verificó un reinicio completo
  de Windows, reinstalación de Docker Desktop ni recreación manual de volúmenes.
- No se ensayó restauración de backups ni pérdida de disco.
- La navegación observada fue Chrome/escritorio; otros navegadores y teléfonos
  físicos mantienen sus pendientes. Los ensayos móviles de CI son emulación.
- La aceptación legal, clínica, de seguridad productiva y las firmas de responsables
  no forman parte de esta recepción sintética.

No se modifica el personaje 3D, los datos alojados en Neon, `main` ni despliegues.
