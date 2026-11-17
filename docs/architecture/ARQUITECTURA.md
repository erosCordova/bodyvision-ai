# Arquitectura — F1

Estado: base local; sin flujos sensibles. Navegador → nginx:8080 → FastAPI:8000 → PostgreSQL:5432. Solo nginx publica puerto, ligado a 127.0.0.1. En desarrollo Vite hace proxy a FastAPI.

Alembic es un proceso separado con credencial propietaria. La API solo recibe el rol `bodyvision_app`, al que se concede SELECT de metadatos de esquema. El pool comprueba conexiones; readiness abre una consulta real con timeout y valida revisión. Liveness no depende de PostgreSQL.

La UI no consulta directamente SQL. El cliente común impone timeout de 7 s, correlation UUID, errores seguros y contratos Zod. React Query controla carga/error/éxito; el estado vacío de expedientes es un aviso de alcance, sin consultar una API aún inexistente.

No hay tablas de negocio ni datos de personas en F1. RLS, ProfileAccess, auditoría sensible, auth/MFA y consentimientos se incorporarán antes de abrir recursos de negocio a usuarios reales. F2 sigue siendo exclusivamente sintética. Producción y staging rechazados en configuración.

Glosario: observado, derivado, estimación visual, reconstrucción aproximada y simulación serán categorías del dominio. No se muestran insignias sobre health checks porque no son datos corporales.
