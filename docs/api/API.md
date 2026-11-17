# API — F1

Prefijo `/api/v1`. OpenAPI generado por FastAPI en `/api/v1/openapi.json`. Todos los endpoints actuales son de infraestructura local.

| Método | Ruta | Éxito | Error |
|---|---|---|---|
| GET | /health/live | 200, status alive, versión, fase, entorno, checked_at UTC | 500 seguro |
| GET | /health/ready | 200, status ready, conexión, revisión, checked_at UTC | 503 NOT_READY si falla conexión, tabla o revisión |

Errores de aplicación: `{code, message, details, correlation_id}`. Ruta desconocida 404 NOT_FOUND. Validación 422 UNPROCESSABLE_ENTITY. Correlation ID solo acepta UUID; entradas arbitrarias se reemplazan. Se devuelve X-Correlation-ID y Cache-Control no-store. Un hostname inválido es rechazado por el middleware de borde con 400 (antes del contrato de aplicación).

No existen endpoints de auth, expedientes o captura en esta fase. La API nunca registra la URL, query string, cuerpo, encabezado de autorización, IP o agente de usuario. Timestamp de salud no procede de la base; la revisión y conectividad sí se verifican en PostgreSQL.
