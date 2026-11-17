# Modelo de datos — F1

Implementado: `system_schema_state(singleton boolean PK CHECK true, revision varchar(64) NOT NULL)` con una fila y revisión `0001_foundation`; `alembic_version` administrada por Alembic. Son metadatos globales sin organización ni datos personales. El rol de API solo lee la primera tabla y no lee/escribe versiones Alembic.

No hay tablas de organizaciones, usuarios, expedientes, mediciones o imágenes todavía. Su diseño se tomará de la especificación adjunta. Las tablas de negocio deberán usar organization_id, RLS y acceso por expediente; no se habilitará una ruta de negocio antes de sus pruebas.

Toda medición futura será inmutable, corregida por versión con motivo, método manual/device y trazabilidad. No se guardarán medidas corporales inferidas de imágenes como observadas.
