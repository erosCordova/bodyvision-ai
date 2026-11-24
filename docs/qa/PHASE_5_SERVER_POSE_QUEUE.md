# F5: Cola de pose en servidor (solo datos ficticios)

La migración 0033 agrega trabajos persistentes con reclamación SKIP LOCKED,
arrendamiento de 90 s, token de fencing, hasta tres intentos con backoff,
resultado mínimo y revisión humana. Un trabajo depende de una captura cifrada;
el borrado de la captura y la revocación de cualquiera de las tres finalidades
eliminan el trabajo. API y revisión requieren permisos explícitos.

El motor Python usa MediaPipe Pose Landmarker Lite con el SHA-256 fijado en el
repositorio. El proceso hijo recibe solo PNG en memoria y no hereda credenciales.
No guarda coordenadas, imágenes, circunferencias ni resultados diagnósticos.
El rol NOLOGIN bodyvision_pose_worker recibe exclusivamente tres funciones de
trabajo; el operador local debe provisionar una cuenta de servicio distinta que
pueda asumir ese rol, sin roles API/auth, permisos elevados ni acceso general.

## Activación privada pendiente de aceptación

La API requiere SERVER_POSE_QUEUE_ENABLED=true además de identidad y captura
cifrada en local/test. El trabajador separado usa APP_ENV=local o test,
POSE_WORKER_DATABASE_URL, POSE_WORKER_MODEL_PATH, CAPTURE_ENCRYPTION_KEY
y, si aplica, CAPTURE_DECRYPTION_KEYS. Nunca usar credenciales de migración o
Neon. El modelo es el mismo archivo task verificado por prepare_pose_assets.mjs.
La ejecución es python -m app.workers.server_pose en el entorno del trabajador.
Requiere un entorno de dependencias nativas MediaPipe, NumPy y Pillow dedicado;
su resolución bloqueada, auditoría y prueba de inferencia real en CI siguen
pendientes. No se descargan paquetes o modelos automáticamente en ejecución.

La prueba SQL utiliza un adaptador controlado para verificar persistencia,
aislamiento, cifrado, fencing y revisión sin simular una validación de IA real.
Las pruebas unitarias prueban validación de resultados y checksum. Pendiente:
retención específica de trabajos al caducar consentimiento, prueba de
reintentos simultáneos, evaluación física/independiente y activación operativa.
La aceptación visual de prueba no alimenta todavía el atlas.
