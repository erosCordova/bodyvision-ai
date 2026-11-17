# ADR 0004 — 3D y operación futura

Modelo GLB licenciado con evidencia; luego demo; luego maniquí procedural etiquetado. Maya es herramienta de producción, no motor web. Prohibida activación productiva de activos sin evidencia comercial. No se incorpora geometría ni modelo IA en F1.

Cola futura PostgreSQL jobs+SKIP LOCKED, interfaz migrable a Redis/SQS. F1 solo logs JSON y checks de salud. OTel/Prometheus/Sentry, storage/mail, runbooks, Terraform del proveedor escogido y CI/CD de despliegue con aprobación quedan diferidos a fases dependientes; no se crean recursos externos vacíos que aparenten operación productiva.
