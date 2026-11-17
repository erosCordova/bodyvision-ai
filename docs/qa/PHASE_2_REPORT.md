# BODYVISION AI — Fase 2

Estado: implementación completa en verificación. No se declara cerrado el gate hasta que GitHub Actions termine correctamente. Solo datos ficticios, sin piloto ni producción.

Implementado: dos organizaciones locales, operadores y ProfileAccess; expedientes paginados/búsqueda/creación/edición/restricción/archivo; catálogo con unidades y métodos; mediciones observadas con validación backend y DB; correcciones inmutables, historial de versiones, confirmación de atípicos y duplicados e idempotencia; IMC y razones con fórmula/fuentes; dashboard desde SQL, historial y gráficos con huecos sin interpolación; insignias OBSERVADO/DERIVADO, errores con referencia y reintento. Toda escritura procede de un formulario y llama a la API.

Verificación local ejecutada: PostgreSQL 15.18 real; 40 pruebas backend aprobadas, 11 frontend; Ruff, ESLint, TypeScript y build. Alembic upgrade/downgrade/reapply aplicados; seed crea 10 expedientes y una segunda ejecución crea 0. npm audit: 0 avisos conocidos. Navegador y contenedores se comprobarán remotamente como en F1.

La secuencia Playwright cubre crear un expediente, guardar peso, corregirlo con motivo, ver ambas versiones, guardar estatura, consultar IMC y ocultar el expediente al cambiar de organización. El segundo escenario revisa móvil, huecos/atípico y axe; se conservan los tres escenarios de F1.

Limitaciones: el selector de organización es un mecanismo local ficticio, no autenticación. Identidad/MFA, acceso de usuarios reales, permisos por sesión, consentimiento, auditoría sensible y gate productivo granular siguen en F3. No hay imágenes, pose, 3D, simulaciones, reportes ni ARCO. Los permisos SQL/RLS de F2 no autorizan uso real. Visual/manual y matriz de otros navegadores siguen pendientes. El visor 3D se mantiene para su fase, sin prometer una reconstrucción corporal.

Evidencia local: docs/qa/evidence/phase2. Commit y ejecución remota se añadirán al finalizar las comprobaciones.
