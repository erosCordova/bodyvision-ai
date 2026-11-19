# Fase 4 — Archivo cifrado de capturas ficticias (revisión 19-11-2026)

## Implementado (rama de integración, NO producción)

- Backend FastAPI exclusivamente en `APP_ENV=local|test`, con identidad privada verificada y una `CAPTURE_ENCRYPTION_KEY` Fernet distinta de las claves de sesión/MFA. El modo demo y los entornos no autorizados **no registran** estas rutas.
- Migración Alembic `0017_synthetic_captures`: tabla `synthetic_capture_objects` con RLS por organización/expediente, rol de aplicación limitado a SELECT/INSERT/DELETE, cifrado de bytes (Fernet), SHA-256 del archivo recibido, tamaño, dimensiones, autor, fecha y expiración.
- `POST /api/v1/profiles/{id}/captures`: cuerpo binario `image/png`, máximo **256 KiB** y **1024 × 1024 px**, confirma explícitamente que es ficticio. Requiere permiso de escritura, rol de administrador/especialista y aceptaciones sintéticas **vigentes** de `capture` y `storage` para el mismo expediente. Los consentimientos se bloquean durante la transacción para que una revocación concurrente no permita una escritura tardía.
- El validador solo acepta PNG RGB/RGBA de 8 bits no entrelazado, con bloques `IHDR/IDAT/IEND`, CRC válidos, compresión zlib limitada y ningún bloque accesorio (texto/EXIF, perfiles o animaciones). La interfaz vuelve a codificar las imágenes en canvas y retira metadatos antes de enviarlas.
- `GET /api/v1/profiles/{id}/captures`: metadatos, sin píxeles; `GET /api/v1/profiles/{id}/captures/{id}`: descifra bajo el mismo consentimiento/permiso, verifica SHA-256 y entrega el contenido como **adjunto descargable**, no como imagen embebible pública.
- `DELETE` por captura y `POST /captures/purge-expired`: borrado por usuario de prueba autorizado. La **revocación** de consentimiento de captura o conservación dispara borrado transaccional de los objetos cifrados del expediente. El historial de consentimiento y la auditoría permanecen.
- La caducidad de 7 días impide listar o descargar capturas vencidas. La eliminación física automática al vencer la retención se intenta durante el funcionamiento del backend privado de pruebas, en lotes acotados; con el servidor apagado no hay limpieza.
- Toda creación, consulta, descarga, borrado y purga auditada se registra dentro de la misma transacción en `security_audit_events`, sin guardar fotografías o nombres originales en ese registro.
- La función se muestra solo en el módulo Captura del **frontend privado de pruebas**, después de la revisión local. Necesita expediente autorizado, las dos aceptaciones ficticias y una confirmación específica de que el archivo no representa a una persona real. Si falta una clave, se rechaza el almacenamiento.

## Validaciones

- Unitarias: PNG mínimo válido, CRC inválido, bloques de metadatos, dimensiones incompatibles, cabeceras alteradas, contenido comprimido desproporcionado.
- Integración PostgreSQL: cifrado real `ciphertext` diferente al PNG original, aislamiento de organizaciones y roles, prohibición sin consentimiento, descarga de bytes exactos para lector autorizado, rechazo al revocar y destrucción de ciphertext, caducidad y purga, no alteración de `measurements`.
- E2E privada: crear expediente ficticio, comprobar bloqueo sin consentimiento, conceder ambas finalidades, subir PNG sintético, ver historial, descargar y borrar.

## Retención automática y recuperación de claves (migración 0018)

La migración `0018_capture_maintenance` añade una función PostgreSQL estrechamente
limitada: `purge_expired_synthetic_capture_batch(100)`. Se ejecuta únicamente
desde el backend **privado** local/test cuando existen identidad verificada y
`CAPTURE_ENCRYPTION_KEY`. Al iniciar el backend se hace una primera comprobación,
y después se repite cada 900 segundos (ajustable de 60 a 86400). Cada ejecución
borra como máximo diez lotes de cien objetos **ya vencidos** y registra el número
eliminado en `synthetic_capture_maintenance_events`. Los lotes usan bloqueos de
filas y exclusión mutua entre réplicas; no leen ni exponen píxeles.

La función SQL no puede ser invocada desde una conexión HTTP con contexto de
organización o actor. El rol de datos no tiene permiso de lectura del registro
interno de mantenimiento, ni puede purgar objetos vigentes mediante la función.
No se instala `pg_cron` ni un servicio externo y **la limpieza requiere que el
backend privado esté ejecutándose**; si está apagado, los vencidos siguen
inaccesibles, pero el borrado se reanuda al encenderlo. WAL, copias de seguridad
y bloques residuales **no se borran de manera criptográficamente verificable**.

La rotación de Fernet utiliza una clave principal nueva
`CAPTURE_ENCRYPTION_KEY` y un arreglo temporal de anteriores
`CAPTURE_DECRYPTION_KEYS` (JSON de cadenas). El backend **solo cifra nuevas
capturas con la clave principal**; las anteriores solo pueden descifrar.
Para rotar un expediente ficticio autorizado, un administrador privado con
permiso de escritura y aceptaciones vigentes `capture` y `storage` invoca
`POST /api/v1/profiles/{profile_id}/captures/rotate-key` sin cuerpo de foto.
La operación bloquea las capturas de ese expediente, verifica cada SHA-256,
recifra exclusivamente objetos no cifrados con la principal y registra
`capture.rotate`. Si falta una clave, los bytes están alterados o hay más de
5000 objetos, **se revierte la transacción completa**.

Procedimiento seguro: (1) custodiar fuera del repositorio ambas claves;
(2) configurar la principal nueva y la anterior como respaldo de lectura;
(3) rotar los expedientes ficticios autorizados; (4) comprobar integridad y
recuperación de sus capturas con la clave nueva; (5) retirar las antiguas
**solo cuando no quede ningún objeto que dependa de ellas**. El sistema no
realiza aún un inventario global de claves en uso; por tanto, **no retirar
automáticamente** la clave anterior. Las credenciales de cifrado no forman
parte de los datos del expediente ni de la respuesta HTTP.

Pruebas: cifrado y descifrado con claves anteriores, doble rotación idempotente,
error por ausencia de clave o alteración de SHA sin pérdida de ciphertext,
rol de administrador, procedimiento de purga por función limitada,
bloqueo de invocaciones con contexto de tenant y conservación de objetos vigentes.

## Riesgos y límites deliberados

El cifrado de objetos en PostgreSQL **no sustituye una plataforma de almacenamiento clínico** ni su evaluación legal. Solo datos artificiales de prueba. No hay garantía de que una imagen suministrada por terceros sea ficticia: es una declaración del operador y por ello el producto no se abre en producción.

La eliminación de registros de la base no garantiza la eliminación inmediata de copias de seguridad, WAL o bloques remanentes; el proyecto necesita una política institucional de retención, recuperación y eliminación verificable, rotación de claves Fernet y custodia de secretos. La purga limitada depende del backend privado encendido; no existe trabajo externo programado, ni S3/MinIO. No introducir datos médicos reales.

Sin migrar Neon de producción, fusionar en `main` ni desplegar Render/Vercel hasta aprobar los controles pendientes. El avatar anatómico definitivo permanece sin cambios.
