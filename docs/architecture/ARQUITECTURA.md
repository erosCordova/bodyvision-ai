# Arquitectura — F2

Estado: base local; sin flujos sensibles. Navegador → nginx:8080 → FastAPI:8000 → PostgreSQL:5432. Solo nginx publica puerto, ligado a 127.0.0.1. En desarrollo Vite hace proxy a FastAPI.

Alembic es un proceso separado con credencial propietaria. La API recibe el rol `bodyvision_app`, con SELECT de metadatos y permisos mínimos sobre los recursos F2 protegidos por RLS. El pool comprueba conexiones; readiness abre una consulta real con timeout y valida revisión. Liveness no depende de PostgreSQL.

La UI no consulta directamente SQL. El cliente común impone timeout de 7 s, correlation UUID, errores seguros y contratos Zod. React Query controla carga/error/éxito; el estado vacío de expedientes es un aviso de alcance, sin consultar una API aún inexistente.

F1 no incluía tablas de negocio. F2 añade las tablas y políticas RLS/ProfileAccess para datos ficticios; auditoría sensible, auth/MFA y consentimientos se requieren antes de usuarios reales. F2 sigue siendo exclusivamente sintética. Producción y staging rechazados en configuración.

Glosario: observado, derivado, estimación visual, reconstrucción aproximada y simulación serán categorías del dominio. No se muestran insignias sobre health checks porque no son datos corporales.

## Núcleo F2

React Query obtiene resumen, expedientes, catálogo, historial, series y derivadas por API. Formularios react-hook-form/zod; Recharts se carga bajo demanda. Repositorios SQLAlchemy con SQL parametrizado filtran tenant y acceso; servicios validan mediciones y calculan derivadas; PostgreSQL aplica RLS, referencias compuestas e inmutabilidad. Cada solicitud usa una transacción con contexto local y se limpia al terminar. El selector de organización es metadata sintética en sessionStorage, nunca credencial.
