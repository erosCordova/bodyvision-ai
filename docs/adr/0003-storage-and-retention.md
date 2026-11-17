# ADR 0003 — Almacenamiento y privacidad

Default para F4: S3 compatible privado con cifrado en reposo; MinIO local, sin imágenes reales. Versionado de imágenes desactivado para borrado verificable; URLs firmadas cortas, autorización y auditoría. Retención propuesta 12 meses o hasta revocación; landmarks con igual política; difuminado de rostro activo por defecto; eliminar original tras revisión como opción organizacional.

MinIO, correo local MailHog y workers no se arrancan en F1 porque no hay consumidores aún: integrar y validar en sus fases. Proveedor, región, clave KMS/equivalente y transferencias pendientes, sin contratación. No servir originales por rutas públicas permanentes.
