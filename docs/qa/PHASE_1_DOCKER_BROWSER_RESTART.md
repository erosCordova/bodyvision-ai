# F1 — recepción técnica de la interfaz Docker y persistencia al reiniciar

20 de noviembre de 2026 · America/Lima.

## Cobertura que faltaba

El job nativo probaba la aplicación mediante Vite. Docker construía la interfaz,
consultaba HTTP y ejecutaba pruebas unitarias, pero no navegaba la aplicación
compilada detrás de nginx. Tampoco comprobaba el flujo completo de apagado y
recreación de contenedores conservando el volumen después de registrar datos
desde esa interfaz. El comprobador HTTP no sustituye esas verificaciones.

## Secuencia reproducible en CI

1. Arrancar Docker desde configuración limpia y sembrar solo fixtures sintéticos.
2. Comprobar que la suite aislada no modifica la base de trabajo (PR #31).
3. Navegar la interfaz compilada en `http://127.0.0.1:8080`. La batería inicial de
   siete recorridos se amplía a ocho con la regresión temporal de F2:
   salud/teclado/axe; móvil; recuperación de error de conexión; expediente,
   medición, corrección, versiones, derivadas y aislamiento; gráfico móvil;
   interfaz de solo lectura; tablero de avance.
4. Obtener una copia SQL de datos y secuencias después de esas operaciones.
5. Ejecutar `docker compose --profile test down`, **sin `-v`**, y levantar los
   servicios otra vez con el mismo `.env`. No regenerar credenciales ni repetir
   seed: eso impediría distinguir persistencia de datos recreados.
6. Comprobar salud y comparar la copia SQL posterior mediante el verificador de
   conservación. Solo se excluyen las claves aleatorias restrict/unrestrict.
7. Abrir un navegador nuevo, buscar el expediente creado antes del apagado y
   verificar su observación vigente de **71 kg**, ambas versiones (**72/71 kg**),
   derivada **21.914** con la estatura de **180 cm**, y acceso directo a su ruta.

La configuración `frontend/playwright.docker.config.ts` limita la dirección a
loopback:8080 y usa dos etapas (`before-restart` y `after-restart`). El test de
persistencia solo consulta registros; no vuelve a crearlos. La configuración
nativa no incluye este recorrido dependiente de reinicio.

## Evidencia y aceptación

La CI debe aprobar tanto `native-checks` como `docker-smoke` antes de integrar.
El artefacto `bodyvision-docker-handoff` incluye una captura de las versiones
ficticias conservadas y los traces de fallos si existen. Los dumps temporales no
se imprimen ni se suben. La descripción de la PR registra el run y el resultado
efectivamente obtenidos; este documento describe el protocolo, no inventa resultados.

El cierre humano sigue pendiente: estas comprobaciones de un runner Linux/Chromium
no demuestran instalación independiente en Windows/Docker Desktop, teléfonos
físicos, Safari/iOS ni conformidad del receptor. No son un ensayo de restauración
de backups ni autorizan datos reales. F1 permanece en **95 %** hasta su recepción;
el proyecto conserva **75 % global** y no requiere despliegue por esta entrega.
