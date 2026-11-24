# Fase 2 — Historial de correcciones paginado sin escanear el expediente completo

**Alcance:** mediciones OBSERVADAS de expedientes ficticios, protegidas por
organización y permiso individual. Ninguna corrección existente se reescribe,
se borra o se convierte en simulación.

## Cambio funcional

El endpoint previo `GET /api/v1/measurements/{id}/versions` primero cargaba
todas las mediciones de un expediente y luego buscaba sucesores en Python. El
coste crecía con **todo** el historial del expediente, incluso cuando el
usuario consultaba una sola medición. La implementación nueva utiliza CTE
recursivas de PostgreSQL en los dos sentidos, ancladas a la medición autorizada.
El índice UNIQUE existente sobre `supersedes_id` permite recorrer las
correcciones sin explorar cadenas de otras mediciones.

Se conserva el endpoint de lista para compatibilidad con clientes anteriores.
La interfaz consulta ahora el nuevo endpoint:

`GET /api/v1/measurements/{id}/versions/page?limit=20&offset=0`

Respuesta `{items,total,limit,offset}`; el tamaño solicitado se limita a
1–50 versiones y los offsets son no negativos. Incluye número total aunque
se consulte una página vacía. La numeración de las versiones se mantiene de
la original a la actual, aun cuando el usuario abra una corrección intermedia.
El componente muestra el total y botones de navegación, con estados de
carga, error, reintento y versión vigente/sustituida.

## Integridad y autorización

1. El servidor **verifica primero** que el usuario pueda consultar la
   medición y su expediente mediante `records.measurement()`, RBAC/RLS y
   `profile_access`. Las mediciones ajenas devuelven 404, nunca información
   sobre la cadena.
2. Todos los pasos recursivos mantienen la organización, el expediente y
   la métrica de la medición inicial; detectan ciclos mediante la ruta de UUID.
3. La respuesta incorpora únicamente la cadena inmutable y el responsable
   autorizado; la lectura emite el evento de auditoría `measurement.read`.
4. No cambia el contrato de creación/corrección ni los mecanismos de
   idempotencia, retención, consentimiento, permisos o auditoría existentes.

## Verificación reproducible

- `backend/tests/integration/test_data_core.py`: 26 versiones consecutivas,
  selección de una corrección intermedia y de la última, páginas de 20/6,
  total exacto incluso con offset vacío, exclusión de otra métrica del mismo
  expediente, 422 para paginación inválida, contrato antiguo y 404 desde otra
  organización.
- `frontend/tests/e2e/data-core.spec.ts`: navegador real, crea 22
  versiones ficticias mediante la API, comprueba números 1–20 y 21–22,
  botones anterior/siguiente y conservación de la secuencia.

Este cambio **no** sustituye la recepción formal independiente del flujo
de expedientes, y no se incrementa el avance de la Fase 2 por una
optimización sin nuevos criterios de aceptación firmados. Se conserva
el porcentaje global de desarrollo técnico estimado en **93 %**.
No se modifica `main`, ni la demo pública, ni se emplean pacientes reales.
