# ADR 0001 — Fundación local y fuente de requisitos

Aceptado para desarrollo, 2026-11-17. Se usa el texto adjunto como contrato más reciente y los PDF como referencias. Backend Python FastAPI, frontend React18/TS estricto/Vite, PostgreSQL15, SQLAlchemy2/Alembic. No se mantiene la consulta inicial sobre Java como una restricción ante este stack explícito posterior.

F1 no abre rutas con datos de personas. El bloqueo de staging/production es total hasta incorporar controles de identidad, privacidad, legales y operación; el gate granular R11 queda pendiente de F3. La UI muestra salud real y estado vacío de alcance, sin dashboard simulado. Las dependencias se resuelven en lockfiles; bases de imagen verificadas por digest de manifiesto. No se afirma haber construido imágenes hasta ejecutarlo.
