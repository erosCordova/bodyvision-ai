# BODYVISION AI — Revisión del avance por evidencia (20-11-2026)

## Cambios de criterio registrados

Las cifras son **estimaciones manuales** del alcance técnico, ponderando las
10 fases del tablero 0–9 por igual. No equivalen a firmas, autorización para
personas reales, cumplimiento legal, ni exactitud médica.

| Fase | Antes | Después | Nueva evidencia incorporada |
|---|---:|---:|---|
| 3 · Seguridad e identidad | 75 % | 80 % | Alta de administrador **ficticio** mediante procedimiento local exclusivo: revisión de contraseña, rol único, auditoría encadenada; paso «Backend quality and migrations» aprobado en la ejecución nativa [44825096346](https://github.com/erosCordova/bodyvision-ai/actions/runs/44825096346) |
| 8 · Simulación | 80 % | 85 % | Modelo 3D compartido, comparación histórica, trazabilidad técnica, PNG, matriz de 960 combinaciones **sintéticas**, advertencia de saturación y pruebas integrales aprobadas [44823204295](https://github.com/erosCordova/bodyvision-ai/actions/runs/44823204295) |

No se ha cambiado ninguna de las demás fases. La suma sube **10 puntos
porcentuales de fase** (dos mejoras de 5); al dividir por diez, el promedio
pasa de 76,5 % a **77,5 %**, que el dashboard redondea a **78 %**.

## Criterios que permanecen sin cerrar

- **Fase 3:** la identidad legal del primer administrador real **no** está
  verificada; no existe recuperación externa de cuentas ni custodia/rotación
  aprobada de todas las claves. La API privada permanece restringida a
  local/test y sigue prohibido usar expedientes reales.
- **Fase 8:** no se ha contrastado la morfología sintética con escáneres o
  cohortes autorizadas ni con teléfonos físicos de referencia. Las
  simulaciones son ilustraciones, no predicciones médicas.
- Las fases 0 y 2 necesitan aceptación expresa de responsables humanos;
  ningún éxito de CI sustituye esas aprobaciones.

## Evidencia reproducible

El soporte técnico figura en
`backend/tests/integration/test_first_admin_bootstrap.py`,
`frontend/tests/morphologyMatrix.test.ts`,
`frontend/tests/morphLimits.test.ts`,
`frontend/tests/e2e/body-viewer.spec.ts` y sus documentos de QA
correspondientes. El gate nativo de `44825096346` aprobó las pruebas de
backend, aunque esa ejecución global no es «success» por un conflicto entre
la restricción loopback del alta y el hostname interno de Docker. El commit
posterior deja el alta sobre loopback y excluye esa prueba positiva del
contenedor; una ejecución CI integral nueva debe aprobarse para cerrar
la regresión final. No confundir ese hecho con una aprobación completa previa.

No se ha modificado `main`, la base alojada ni la demo pública.

## Incremento de identidad tras cierre de rotación MFA local

La Fase 3 se actualiza de **80 % a 85 %** tras la aceptación técnica
del procedimiento fuera de línea que recifra todas las semillas ficticias,
verifica la clave nueva y registra auditoría en una transacción PostgreSQL.
El commit de la implementación superó los jobs
`native-checks`, `windows-scripts` y `docker-smoke` en
[GitHub Actions 44827504437](https://github.com/erosCordova/bodyvision-ai/actions/runs/44827504437).
También se corrigió la documentación que antes decía que no había ningún
procedimiento de rotación.

El resto de fases no varía: el promedio pasa de **77,5 % a 78,0 %**, por lo
que el porcentaje **global visible continúa en 78 %**. No es un
certificado de seguridad, custodia de claves, aprobación clínica ni
autorización de usuarios reales. Se mantienen como gates pendientes la
identidad legal, recuperación asistida, respaldo/custodia externos y
pruebas de recuperación ante desastre.


## Fase 4: historial cifrado paginado, total correcto y revocación

La Fase 4 pasa de **70 % a 75 %** según la estimación manual de
alcance técnico (diez fases con igual ponderación). El archivo privado
cifrado ahora ofrece navegación paginada, total íntegro de capturas
ficticias no caducadas, respuesta HTTP no almacenable y regresiones de
autorización/consentimiento. La prueba con 57 filas sintéticas
(56 vigentes y 1 vencida) y la prueba de interfaz fueron aprobadas
en [GitHub Actions 44830333880](https://github.com/erosCordova/bodyvision-ai/actions/runs/44830333880).

Con +5 puntos para una sola de diez fases, el promedio global exacto
pasa de **78,0 % a 78,5 %**, mostrado como **79 %** por redondeo.
Este incremento *no* representa una prueba clínica ni la eliminación
irreversible de copias de seguridad, descargas, WAL o snapshots.
Permanece prohibida la subida de fotografías de personas reales.


## Fase 4: mantenimiento autónomo local de capturas vencidas

Con la ejecución integral [44833432116](https://github.com/erosCordova/bodyvision-ai/actions/runs/44833432116)
aprobada, la Fase 4 pasa de **75 % a 80 %**. Se comprobó que un
proceso separado y optativo limpia ciphertext vencido con PostgreSQL
activo, **aunque el backend esté detenido**; usa el rol de datos
`bodyvision_app`, bloques limitados y un contexto `synthetic-only`,
sin acceso a píxeles ni rutas HTTP. La ejecución también verifica que
no elimina la captura vigente y que la API vuelve a un estado saludable.

La media de las diez fases pasa de **78,5 % a 79,0 %**: el porcentaje
global visible **permanece en 79 %**. No corresponde ajustar otras fases.
Siguen pendientes las operaciones cuando Docker/la base estén apagados,
la custodia de copias y claves, el borrado de backups/WAL y todas las
aprobaciones para uso real o clínico.
