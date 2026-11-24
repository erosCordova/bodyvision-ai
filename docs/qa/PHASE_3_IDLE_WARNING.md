# Fase 3 — Aviso anticipado de cierre por inactividad

En el espacio privado de desarrollo/pruebas, la sesión se revoca
tras **15 minutos sin actividad humana**, según PostgreSQL. El
frontend no autoriza sesiones ni altera este límite: únicamente
muestra un aviso cuando quedan menos de **dos minutos**.

La advertencia tiene una acción «Continuar trabajando» que se trata
como entrada humana. Solo si aún no venció el límite la interfaz envía
el heartbeat autenticado por bearer a `POST /api/v1/auth/activity`.
Si el servidor rechaza la sesión con 401, se elimina el token de RAM,
se descartan capturas en espera y se cierra el espacio privado. El
click tardío tras superar los 15 minutos no puede reactivar la sesión.

Un evento `focus`, la recuperación de una pestaña oculta, el refresh
rotatorio y las peticiones periódicas **no se consideran actividad**;
pueden mostrar el aviso o confirmar que la sesión venció, pero no
renuevan el período de inactividad. Si el usuario continúa escribiendo
o utilizando el ratón, se oculta la advertencia y el heartbeat sigue
acotado a una vez por minuto. La advertencia no incluye datos de
expedientes y no se muestra en la demostración pública.

**Regresiones:** `frontend/tests/privateIdleSession.test.tsx`
comprueba aviso sin heartbeat, continuación con heartbeat, cambio
de sesión tras vencimiento e imposibilidad de reactivación tardía.
Todas las sesiones y pruebas usan datos sintéticos.

**Criterio de salida:** frontend lint/tests/build, pruebas del
backend y navegador privado y Docker aprobados en CI. No representa
una política de sesiones para producción; aún falta evaluación externa
de seguridad y diseño configurable para cada organización.
