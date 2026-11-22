# Fase 8 — Exportación íntegra y controlada de escenarios ficticios

**Alcance:** historial de escenarios SIMULADOS del mismo expediente,
local/test y demostración con datos ficticios. No son mediciones OBSERVADAS
ni predicciones clínicas. No se modifica el atlas 3D ni su geometría.

## Función entregada

El botón **Exportar historial completo CSV** está junto al control existente
de **Exportar página CSV**, que continúa exportando únicamente los registros
visibles. La nueva opción consulta la API autorizada de escenarios desde el
offset cero, pagina de 20 en 20, muestra progreso y descarga un único CSV
solo cuando se recibió y verificó el historial íntegro.

El formato conserva la lista de campos permitidos: `SIMULADO`, versión,
peso de referencia, cambio porcentual, peso hipotético, estatura, fecha UTC,
revisión del modelo y revisión del algoritmo. No contiene IDs, nombres,
notas, autores, identificadores de organización, ni mediciones observadas.
No genera escrituras en PostgreSQL ni altera escenarios existentes.

## Límites de integridad y seguridad

- El máximo permitido es **2.000 versiones por descarga**. Un historial más
  grande se rechaza antes de leer más páginas, manteniendo la exportación
  por páginas como alternativa. No hay petición ilimitada.
- El primer resultado fija `total` y `limit`; todas las páginas siguientes
  deben coincidir, continuar exactamente desde el offset esperado y traer
  el número exacto de elementos. Si cambia el historial durante la lectura,
  llega una página incompleta o hay IDs repetidos, **no se descarga CSV parcial**.
- Cada versión debe pertenecer al expediente seleccionado y ser `SIMULADO`.
  Los campos numéricos, fecha y revisiones cumplen la validación estricta
  del constructor CSV; se excluye cualquier texto libre que pueda introducir
  fórmulas de hoja de cálculo.
- La descarga se cancela al cambiar de expediente, desmontar el componente
  o pulsar **Cancelar exportación**. Una solicitud HTTP ya iniciada puede
  terminar, pero no se ejecutan páginas adicionales ni se genera archivo.
- No se guardan copias en el navegador ni se utiliza storage persistente.
  El API sigue verificando identidad y permisos por expediente en cada página.
  No se confía en un selector de organización como autenticación.

## Pruebas

- `frontend/tests/scenarioHistoryExport.test.ts`: 45 versiones completas,
  progreso y paginación; cambios de total, faltantes, duplicados, perfil
  ajeno, cancelación, historial vacío, exceso de límite y tipo de dato.
- `frontend/tests/e2e/body-viewer.spec.ts`: 25 filas en dos páginas
  ficticias, descarga real por navegador, formato y ausencia de texto libre
  e IDs; se conserva el flujo anterior de exportar solo la página.
- La aceptación debe confirmarse mediante CI de backend, frontend y Docker;
  ninguna prueba sintética sustituye revisión clínica ni validación física.
