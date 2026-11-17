# ADR 0006 — Vista pública ficticia, separada de producción

17 de noviembre de 2026. El usuario solicita visualizar la entrega en Vercel y Render antes de F3. Se añade APP_ENV=demo sin habilitar staging/production ni usar APP_ENV=local como bypass de los gates.

La API demo rechaza POST/PATCH/PUT/DELETE con 403 DEMO_READ_ONLY antes de procesar el cuerpo, deshabilita Swagger interactivo y configura conexiones SQL read-only. La UI obtiene read_only del servidor y deshabilita creación/edición/corrección/archivo. Los datos son las fixtures ficticias de F2. No se implementa todavía identidad ni se afirma que esto sea un producto desplegado para uso real.

La única base Free Render Postgres del espacio ya está ocupada por otro proyecto. Para una visualización sin contratar otra base ni modificar proyectos ajenos, un servicio web Free dedicado ejecuta PostgreSQL15 y FastAPI con un supervisor sin root. PostgreSQL escucha solo en 127.0.0.1; no se publica como servicio TCP externo. Contraseñas aleatorias por arranque permanecen en memoria/entorno de los procesos; no se entregan al frontend ni se guardan en Git. El proceso API recibe solo su conexión limitada.

La BD de esta demo es efímera: se inicializa, migra y siembra en cada instancia/reinicio. No hay almacenamiento de información de personas y no debe reutilizarse para un piloto. Al detenerse el supervisor se apaga primero API y luego PostgreSQL. Un fallo de cualquiera detiene la instancia completa. Límites 20 conexiones/16MB shared_buffers para el servicio Free de 512MB.

Vercel aloja solo la aplicación estática y reescribe /api hacia la URL HTTPS verificada de Render, sin incorporar credenciales de BD. La SPA admite navegación directa. El timeout demo contempla el arranque en frío gratuito; el modo local mantiene 7s. La configuración de producción continúa bloqueada hasta sus gates.

El uso real requerirá F3, una BD persistente separada, controles legales/operativos y una nueva decisión de despliegue. Esta excepción es exclusiva de la visualización ficticia y no modifica las garantías ni el alcance productivo de F1/F2.
