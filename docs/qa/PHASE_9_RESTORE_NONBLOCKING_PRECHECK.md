# F9 — Apertura acotada de los respaldos de recuperación sintética

## Alcance

Verificadores offline de respaldos **ficticios y descartables**:
`scripts/verify_restore_manifest.py` (dump personalizado PGDMP y manifiesto JSON)
y `scripts/verify_restored_data.py` (volcados SQL de solo datos anteriores
y posteriores a una restauración). No operan bases ni personas reales.

## Riesgo de carrera y corrección

Un `Path.stat()` correcto no garantiza que la ruta conserve su contenido
hasta `os.open()`. Un proceso con acceso de escritura al directorio puede
renombrar el archivo regular y poner una tubería con el mismo nombre
justo después del prechequeo. Sin `O_NONBLOCK`, la apertura de la FIFO para
lectura puede **quedar esperando un escritor indefinidamente**, antes de
alcanzar el `fstat()` que normalmente rechaza archivos especiales.

Las tres aperturas de lectura incorporan `O_NONBLOCK` cuando el sistema
lo admite, conservando `O_NOFOLLOW`, comprobación del descriptor abierto,
límites, fechas/tamaños, SHA-256 y semántica original de rechazo.
Los archivos normales continúan leyéndose en modo seguro.

## Regresiones

- Sustitución de un PGDMP inicialmente regular por FIFO entre `stat` y `open`.
- Sustitución del manifiesto JSON inicialmente regular por FIFO en la misma ventana.
- Sustitución del SQL restaurado entre `stat` y `open`.

Cada prueba usa una FIFO real en POSIX y observa rechazo del tipo de archivo
**sin abrir un escritor**. En Windows se omiten solo las pruebas POSIX.
Los demás controles (symlink/hardlink, mutaciones durante lectura, integridad,
comparación completa de datos y secuencias) permanecen.

## Criterios de aprobación y límites

Las pruebas pertenecen a `python -m unittest discover -s scripts/tests -v`,
ejecutado por BODYVISION CI en Linux y Windows; el flujo Docker sigue
verificando restauración aislada. No considerar aprobada la integración
hasta consultar el resultado del SHA final en GitHub Actions.

Un hash no es una firma independiente ni certifica procedencia: un atacante
con acceso tanto al respaldo como al manifiesto podría sustituir ambos.
La corrección no asegura PITR, retención externa, cifrado de copias, RPO/RTO,
recuperación productiva ni custodia de claves. No modifica `main`.
F9 se mantiene en **90 %** y avance global en **93 %** a falta de aceptación externa.
