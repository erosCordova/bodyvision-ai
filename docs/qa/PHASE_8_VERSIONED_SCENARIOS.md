# Fase 8 — Historial de escenarios 3D ficticios, separado de mediciones

Revisión: 2026-11-19. Implementación en `feature/atlas-unified-height-weight` (PR #5).

## Contrato de datos y arquitectura

- Nuevo recurso REST: `/api/v1/profiles/{profile_id}/scenarios` con listado, creación y consulta `/{scenario_id}/versions`.
- Los escenarios se almacenan en **PostgreSQL**, tabla independiente `simulation_scenarios`, con `data_type: SIMULADO`. Jamás escriben en `measurements`, conservando de forma estricta la procedencia `OBSERVADO`.
- Cada instantánea guarda `reference_kg`, `variation_percent`, `stature_cm`, `simulated_kg` calculado en BD, versión del atlas `28912432581accd7a1c62129d55f0e9758221d48`, algoritmo `regional-soft-tissue-v2`, autor ficticio, fecha y, en revisiones, motivo y `prior_version_id`.
- La versión 1 abre una serie. Las nuevas versiones se insertan como registros **append-only** y forman una única cadena. El backend serializa escrituras por expediente y bloquea el intento de crear dos sucesoras de la misma versión.
- Un disparador de PostgreSQL impide `UPDATE` y `DELETE`, incluso con el rol propietario; la función de validación impide encadenar versiones de otro expediente, organización, modelo o algoritmo. El rol de aplicación solo tiene `SELECT` y `INSERT`.
- Las políticas RLS y las funciones existentes de acceso por expediente limitan lecturas/escrituras. Las claves de idempotencia UUID resguardan los reintentos idénticos y rechazan cambios de contenido con la misma clave.

## Integración en el módulo Visión 3D

- Sin sustituir la malla, capas o simulación actual, el usuario elige un **expediente ficticio** y guarda una primera versión de los controles visibles de peso/estatura.
- Las siguientes versiones requieren un motivo. Es posible cargar una versión histórica en el **mismo cuerpo 3D**, inspeccionar su cadena de revisiones y recuperar cualquier etapa sin alterar su origen.
- La sección utiliza la etiqueta `SIMULADO`. El estado `OBSERVADO` permanece exclusivo para mediciones reales/ficticias registradas por el flujo de medidas.
- El enlace desde un expediente ficticio abre el simulador con ese perfil preseleccionado. La opción local original de guardar una comparación en la vista se mantiene.
- Los sitios públicos en modo `demo` son de **solo lectura**: no permiten registrar escenarios, pero pueden consultar registros ficticios existentes.

## Pruebas y límites

Se incorporaron tests de PostgreSQL de encadenamiento, idempotencia, aislamiento entre organizaciones, RLS, inmutabilidad por trigger, validaciones y cierre por archivo. La prueba E2E del atlas verifica el recorrido: guardar v1/v2, recargar, recuperar v2, ver ambas versiones y comprobar **cero mediciones observadas generadas**.

Las migraciones se ejecutan mediante Alembic en los entornos de desarrollo/pruebas antes de declarar la API lista. La versión de esquema exigida por el backend es `0003_simulation_scenarios`. **No se ha migrado Neon ni desplegado esta rama automáticamente**.

### Restricciones deliberadas

1. Sistema de **datos sintéticos exclusivamente**: el selector local de organizaciones no es autenticación real. Se prohíbe el uso clínico o con expedientes auténticos hasta aprobar identidad, RBAC, consentimientos, privacidad, seguridad y operación.
2. Los valores de escenarios no constituyen composición corporal, predicción clínica ni reconstrucción de un paciente. El modelo conserva su forma anatómica educativa de referencia.
3. La lista principal muestra las últimas 20 versiones por expediente; las cadenas individuales consultan el historial completo. En proyectos con miles de escenarios, la paginación explícita y retención requieren desarrollo adicional.
4. Al desplegar en el futuro, migrar Neon de forma controlada y confirmar una copia de seguridad, integridad y recuperación antes de cambiar el backend. No compartir secretos.

## Paginación y exportación CSV de escenarios ficticios (20 noviembre de 2026)

El visor consulta versiones en páginas de 20 mediante el `offset` ya implementado
por la API y permite desplazarse hacia adelante y atrás sin cargar todo el
historial. Al cambiar de expediente o registrar una versión nueva vuelve a la
primera página. La exportación CSV se genera **solo ante una pulsación** y
contiene exclusivamente los 20 registros visibles, numeración de versión,
valores simulados, fecha y versión del modelo/algoritmo. Se excluyen nombres,
notas arbitrarias, IDs personales y datos observados; no hay llamadas de
escritura a la API. La descarga está claramente rotulada como parcial si hay
más registros que los visibles.

Las pruebas de navegador emplean una respuesta de paginación sintética de 25
registros y verifican CSV, desplazamiento y rechazo de texto arbitrario en el
archivo. Los nombres propios, fechas y resultados no acreditan datos reales.
La validación del commit debe confirmarse en CI antes de aumentar el porcentaje.
