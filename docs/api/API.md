# API — F2

OpenAPI completo generado en /api/v1/openapi.json. Prefijo /api/v1. Errores: code, message, details y correlation_id. Fechas ISO con zona, UI America/Lima; valores observados numeric se serializan como números. Listas paginadas con total/limit/offset; catálogo y versiones son colecciones acotadas por su recurso.

Contexto F2: X-Workspace-ID elige solo una organización ficticia local; no es autenticación. Se fija su operador local dentro de la transacción. UUID ajeno o recurso sin ProfileAccess devuelve 404. Sin una sesión real, estos endpoints no deben exponerse fuera de loopback ni usar datos personales.

| Método | Ruta | Función |
|---|---|---|
| GET | /health/live, /health/ready | Proceso, conexión y revisión 0002_data_core |
| GET | /workspaces | Directorio de los dos espacios ficticios |
| GET | /dashboard/summary | Conteos y actividad de mediciones autorizadas desde SQL |
| GET,POST | /profiles | Listar/buscar/paginar; crear expediente mínimo |
| GET,PATCH | /profiles/{id} | Consultar; editar referencia o restringir/habilitar |
| POST | /profiles/{id}/archive | Archivo irreversible por UI en F2, conserva historial |
| GET | /metrics/catalog | Métricas, rangos, métodos, unidad e instrucciones |
| GET,POST | /profiles/{id}/measurements | Historial vigente paginado/filtrado; guardar observado |
| PATCH | /measurements/{id} | Crear una corrección nueva con motivo, nunca editar valor |
| GET | /measurements/{id}/versions | Cadena completa desde cualquier versión |
| GET | /profiles/{id}/analytics/derived | IMC, cintura/cadera y cintura/estatura con fuentes |
| GET | /profiles/{id}/analytics/series | Observadas vigentes por métrica y periodo |

POST/PATCH de mediciones requieren Idempotency-Key UUID. Repetir la misma clave/cuerpo devuelve la misma medición; reutilizar clave con otro cuerpo produce 409. El conflicto OUTLIER_CONFIRMATION_REQUIRED o DUPLICATE_CONFIRMATION_REQUIRED permite repetir con el flag explícito. No se reserva la clave si la solicitud se rechaza.

Fechas futuras, visual_estimate, unidad/método no admitido o instrumento ausente se rechazan con 422. Valores fuera de rango no se corrigen automáticamente. Expediente restringido/archivado no admite registro (409); versión ya corregida produce 409. Transiciones fuera del esquema producen 422; archivar un expediente que no está activo produce 409.

Derivadas: value nullable, formula, source_measurement_ids, as_of, reason y data_type DERIVADO. Cintura/cadera exige referencias con diferencia no mayor de 7 días. Los endpoints de captura/IA/3D no existen aún; no se simulan éxitos ni datos.
