# Modelo de datos — F2

Revisión Alembic 0002_data_core sobre 0001_foundation. Metadatos globales: system_schema_state y alembic_version. Tablas de negocio con organization_id, claves externas compuestas y RLS: organizations (su id es tenant), users (referencias de operador ficticio), profiles, profile_access, metric_catalog, measurements e idempotency_keys.

Profiles usa código BV aleatorio único por organización, nombre opcional, año de nacimiento, sexo opcional y estados active/restricted/archived. Datos mínimos; no se registra correo, dirección o documento de personas. Un acceso manage se crea para el operador local al crear el expediente.

Measurements guarda numeric(8,2), unidad, fecha con zona, método manual/device, instrumento obligatorio para device, responsable, notas, supersedes_id único, motivo, is_current y confirmación de atípico. El trigger impide UPDATE de valores y DELETE, valida catálogo y transición de versiones. El trigger posterior al INSERT cambia exclusivamente is_current del predecesor.

Índice parcial de series por organización/expediente/métrica/fecha cuando is_current. Idempotency-Key se vincula a usuario/organización, endpoint, hash de solicitud y measurement_id. Dos envíos simultáneos con la misma clave usan un advisory transaction lock.

has_profile_access es una función SECURITY DEFINER de SQL fijo. Las políticas de measurements exigen acceso al expediente, además del tenant. El rol bodyvision_app solo lee metadatos de esquema, organizaciones, usuarios y catálogo; inserta datos permitidos; actualiza únicamente referencia/estado de expediente y la metadata is_current de mediciones. No puede borrar mediciones ni cambiar sus valores.

El rol propietario se reserva para migraciones y fixtures sintéticos. RLS no se fuerza sobre el propietario; API y pruebas directas usan un rol sin BYPASSRLS. F3 sustituirá el contexto sintético por sesión autenticada y ampliará los usuarios con sus campos de identidad.
