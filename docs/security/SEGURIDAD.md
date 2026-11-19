# Seguridad — F1

Implementado: roles SQL propietario/API separados, sin credencial propietaria en el contenedor de API; credenciales aleatorias locales; dependencias Python con hashes y npm con lockfile; imágenes Docker por digest consultado al registro; API/UI no root; red privada de servicios; loopback como única publicación; cabeceras de navegador en nginx; logs permitidos por lista cerrada; correlation UUID; CORS y hosts explícitos; modo debug y entornos no locales bloqueados.

Pendiente de F3+: identidad/MFA, RBAC/ProfileAccess/RLS en tablas de negocio, refresh rotatorio, rate limits, auditoría append-only, pruebas IDOR/CSRF, cifrado de campos sensibles y gate granular R11. TLS, cifrado de discos/backups, gestor de secretos, WAF y revisión externa pendientes de F9. Docker local usa HTTP limitado al host y no se presenta como producción segura.

El formato de logs omite excepciones crudas porque pueden incorporar parámetros o credenciales SQL. Uvicorn se lanza sin access logs y nginx access_log está desactivado. No activar logging de SQL ni middleware que registre cuerpos. Swagger es documentación local, no un endpoint público de producción.

Modelo de amenazas inicial: suplantación → identidad/MFA F3; alteración de datos → rol mínimo actual y versionado F2; repudio → auditoría F3; revelación → sin recursos personales ahora y autorización por recurso F3; denegación → timeouts actuales, rate limits/cuotas posteriores; elevación → credenciales SQL separadas y pruebas de rol. No equivale a un STRIDE completo o pentest.

## Actualización F2

Se añadieron filtros por tenant/expediente y RLS en siete tablas de negocio, con pruebas SQL directas usando rol limitado; inmutabilidad mediante privilegios y triggers; idempotencia y restricciones de catálogo. El selector local de espacios ficticios NO es autenticación y se permite exclusivamente porque no hay datos personales y staging/producción siguen bloqueados. No debe reutilizarse como mecanismo de confianza en F3.

## Incremento privado F3 (0012)

La rama de identidad añade autenticación optativa local/test, permisos por expediente,
consentimientos ficticios, soporte administrativo, cambio de contraseña propia y
revocación de sesiones. El usuario solo puede gestionar sesiones de su propia cuenta.
Los cambios de contraseña revocan todas las sesiones activas y comparten el bloqueo
de usuario con la emisión de tokens para impedir accesos con verificadores anteriores.

Todos los eventos existentes y nuevos reciben secuencia y hashes por organización.
Las cabeceras y eventos permanecen inaccesibles directamente para ambos roles
operativos. La verificación es administrativa y detecta alteraciones o borrados
frente a la cabecera conservada. El propietario de base puede reconstruir ambos:
no se afirma protección contra un administrador de base con privilegios completos.
Véase [ADR 0008](../adr/0008-account-security-audit-chain.md). MFA y el cierre del gate
de privacidad siguen pendientes; el modo privado continúa bloqueado en producción.
