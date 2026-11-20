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

## Comparación visual con una versión histórica (20 noviembre de 2026)

El historial incorpora «Fijar como referencia». Esta acción utiliza el peso
simulado y la estatura de una versión autorizada en el panel izquierdo y
conserva los controles del escenario actual en el derecho. Son **dos pasadas
de la misma malla WebGL**, sin crear personajes duplicados, alterar mediciones
observadas o reescribir filas históricas. La opción «Quitar referencia
histórica» devuelve el comportamiento original; cambiar de expediente o
restaurar los controles limpia la referencia anterior. El PNG comparativo usa
las etiquetas y medidas de la versión fijada.

Se añaden pruebas del cálculo histórico y del flujo de selección, cambio de
estatura y reversión. El alcance es estrictamente **educativo y sintético**;
la comparación visual no determina composición corporal ni un resultado
médico. Su aprobación depende de la ejecución correspondiente de CI.

## Recuperación directa y contraste de revisiones de una misma serie

Cada fila de la cadena de versiones ofrece «Cargar vN en 3D» y «Fijar vN
como referencia» sin volver a una página anterior del listado. El usuario
puede cargar una versión como escenario activo y fijar otra como línea base
visual, con una diferencia calculada de kg y cm. El mismo objeto anatómico
se dibuja en dos pasadas; la operación no crea ni edita mediciones observadas
ni altera la cadena append-only. La cifra calculada es una diferencia aritmética
de parámetros ficticios, nunca un indicador de salud ni de composición real.
Incluye prueba de navegador con dos revisiones reales en PostgreSQL de test.


## Coherencia de las regiones con estaturas históricas diferentes

El renderizado WebGL del lado izquierdo ahora ajusta temporalmente también
los límites verticales uniformes del shader, con el mismo factor de estatura
que la geometría, antes de la primera pasada. El estado de los límites,
la escala, el volumen, el scissor y el viewport se restaura antes de dibujar
el lado derecho, incluso ante una excepción. Esto evita que una versión
histórica de 155 cm herede inadvertidamente los límites de deformación
regional del escenario actual de 205 cm. Se incorporaron pruebas de escalado
y reversibilidad de rangos sintéticos; no hay ninguna evaluación anatómica
individual ni validación clínica.
