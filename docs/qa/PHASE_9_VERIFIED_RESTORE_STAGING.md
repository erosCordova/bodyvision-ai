# F9 — Fijar la copia verificada que realmente se restaura (23-11-2026)

## Hallazgo técnico

Un manifiesto SHA-256 validado antes de `pg_restore` no garantiza por sí
solo que la **misma ruta original** siga conteniendo los mismos bytes cuando
el restaurador vuelve a abrirla. El ensayo CI tenía dos restauraciones que
consumían el archivo de trabajo en `/tmp`, aun después de validarlo.

## Nuevo contrato de recuperación sintética

El nuevo `scripts/stage_verified_restore.py` requiere explícitamente:

- `APP_ENV=test`, `CI=true`, `BODYVISION_RESTORE_DRILL=synthetic-only`.
- Respaldo PGDMP legible y manifiesto de la prueba íntegro.
- Directorio de salida preexistente, privado, sin symlinks y propiedad del
  usuario actual con permisos de propietario exclusivamente (POSIX).
- Destino nuevo `O_CREAT|O_EXCL`, permisos `0600`, límite 128 MiB.
- Lectura del origen `O_NOFOLLOW|O_NONBLOCK` cuando el sistema lo admite,
  comprobación `fstat` de descriptor regular con un solo enlace y
  verificación de estabilidad de tamaño/mtime/ctime durante la copia.
- **Segunda verificación del SHA-256 y longitud sobre la copia privada**,
  contra el mismo manifiesto, antes de permitirla como entrada al restaurador.
- Si falla cualquier control, la copia parcial se elimina sin imprimir rutas,
  contraseñas, hashes, filas o contenido de expedientes.

La CI guarda la copia en un subdirectorio privado de recuperación creado
por `mktemp -d`, elimina el archivo original y hace que ambos
`pg_restore` (base test y reemplazo completo de pila) lean **solo**
`$recovery_state/verified.dump`. Antes del segundo uso comprueba de
nuevo el manifiesto contra esa copia. Los archivos se destruyen al
terminar el job, incluso si éste falla.

## Pruebas

`scripts/tests/test_stage_verified_restore.py` comprueba:

1. La copia se mantiene íntegra después de eliminar el archivo original.
2. La fuente alterada entre preflight y apertura no se acepta.
3. El respaldo dañado no genera una copia aceptable.
4. Un destino existente nunca es sobrescrito ni eliminado por el error.
5. Un directorio compartido/no privado falla en POSIX.
6. La sustitución por FIFO en la ventana de apertura no bloquea (POSIX).
7. El CLI exige entorno test/CI sintético y no imprime nombres ni bytes.

El job Linux del flujo integral ejecuta además recuperación de PostgreSQL
real en contenedores efímeros, compara tablas/secuencias y prueba HTTP y
Chromium sobre la base recuperada. Se requiere CI verde del PR para la
integración a la rama de desarrollo.

## Límites y criterios no cerrados

Una copia `0600` en un directorio `0700` protege frente a otros usuarios
del host, **no** contra un atacante que ya controle el mismo UID, root
o el ejecutor CI. El manifiesto SHA-256 no es una firma independiente y
no demuestra procedencia. La operación es descartable y ficticia:
no sustituye PITR, réplicas, KMS, cifrado externo, retención de backups,
ensayo real de RPO/RTO, revisión jurídica ni recepción operativa.

**F9 permanece en 90 % técnico manual y el global en 93 %.**
No se fusiona `main` ni se activa producción.
