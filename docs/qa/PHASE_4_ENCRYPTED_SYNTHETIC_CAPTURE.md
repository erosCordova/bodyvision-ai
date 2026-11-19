# Fase 4 — Archivo cifrado de capturas ficticias (revisión 19-11-2026)

## Implementado (rama de integración, NO producción)

- Backend FastAPI exclusivamente en `APP_ENV=local|test`, con identidad privada verificada y una `CAPTURE_ENCRYPTION_KEY` Fernet distinta de las claves de sesión/MFA. El modo demo y los entornos no autorizados **no registran** estas rutas.
- Migración Alembic `0017_synthetic_captures`: tabla `synthetic_capture_objects` con RLS por organización/expediente, rol de aplicación limitado a SELECT/INSERT/DELETE, cifrado de bytes (Fernet), SHA-256 del archivo recibido, tamaño, dimensiones, autor, fecha y expiración.
- `POST /api/v1/profiles/{id}/captures`: cuerpo binario `image/png`, máximo **256 KiB** y **1024 × 1024 px**, confirma explícitamente que es ficticio. Requiere permiso de escritura, rol de administrador/especialista y aceptaciones sintéticas **vigentes** de `capture` y `storage` para el mismo expediente. Los consentimientos se bloquean durante la transacción para que una revocación concurrente no permita una escritura tardía.
- El validador solo acepta PNG RGB/RGBA de 8 bits no entrelazado, con bloques `IHDR/IDAT/IEND`, CRC válidos, compresión zlib limitada y ningún bloque accesorio (texto/EXIF, perfiles o animaciones). La interfaz vuelve a codificar las imágenes en canvas y retira metadatos antes de enviarlas.
- `GET /api/v1/profiles/{id}/captures`: metadatos, sin píxeles; `GET /api/v1/profiles/{id}/captures/{id}`: descifra bajo el mismo consentimiento/permiso, verifica SHA-256 y entrega el contenido como **adjunto descargable**, no como imagen embebible pública.
- `DELETE` por captura y `POST /captures/purge-expired`: borrado por usuario de prueba autorizado. La **revocación** de consentimiento de captura o conservación dispara borrado transaccional de los objetos cifrados del expediente. El historial de consentimiento y la auditoría permanecen.
- La caducidad de 7 días impide listar o descargar capturas vencidas. **La eliminación física automática por vencimiento aún no está programada**: se requiere ejecutar la purga bajo un operador confiable; no se debe presentar el TTL como eliminación física garantizada.
- Toda creación, consulta, descarga, borrado y purga auditada se registra dentro de la misma transacción en `security_audit_events`, sin guardar fotografías o nombres originales en ese registro.
- La función se muestra solo en el módulo Captura del **frontend privado de pruebas**, después de la revisión local. Necesita expediente autorizado, las dos aceptaciones ficticias y una confirmación específica de que el archivo no representa a una persona real. Si falta una clave, se rechaza el almacenamiento.

## Validaciones

- Unitarias: PNG mínimo válido, CRC inválido, bloques de metadatos, dimensiones incompatibles, cabeceras alteradas, contenido comprimido desproporcionado.
- Integración PostgreSQL: cifrado real `ciphertext` diferente al PNG original, aislamiento de organizaciones y roles, prohibición sin consentimiento, descarga de bytes exactos para lector autorizado, rechazo al revocar y destrucción de ciphertext, caducidad y purga, no alteración de `measurements`.
- E2E privada: crear expediente ficticio, comprobar bloqueo sin consentimiento, conceder ambas finalidades, subir PNG sintético, ver historial, descargar y borrar.

## Riesgos y límites deliberados

El cifrado de objetos en PostgreSQL **no sustituye una plataforma de almacenamiento clínico** ni su evaluación legal. Solo datos artificiales de prueba. No hay garantía de que una imagen suministrada por terceros sea ficticia: es una declaración del operador y por ello el producto no se abre en producción.

La eliminación de registros de la base no garantiza la eliminación inmediata de copias de seguridad, WAL o bloques remanentes; el proyecto necesita una política institucional de retención, recuperación y eliminación verificable, rotación de claves Fernet y custodia de secretos. No se ha habilitado una purga automática programada ni S3/MinIO. No introducir datos médicos reales.

Sin migrar Neon de producción, fusionar en `main` ni desplegar Render/Vercel hasta aprobar los controles pendientes. El avatar anatómico definitivo permanece sin cambios.
