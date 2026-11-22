# ADR 0009 — transición de contraseñas a Argon2id

Estado: implementación para validación local/CI ficticia; no habilita producción.
Implementa la elección de contraseña del ADR 0002. JWT/refresh y los demás
componentes de identidad conservan sus pendientes; este ADR no los reemplaza.

## Política y compatibilidad

Las contraseñas nuevas usan argon2-cffi 25.1.0 con Argon2id versión 19,
64 MiB, tres iteraciones, cuatro hilos, salt aleatoria de 16 bytes y salida
de 32 bytes. Los parámetros son explícitos y el formato PHC admitido está
acotado antes de verificar, para no ejecutar valores de memoria/CPU tomados
de un hash corrupto. Dos operaciones KDF simultáneas por proceso limitan la
memoria del KDF; no se afirma un límite de RAM total o entre procesos.

Se conserva la verificación estricta de contraseñas PBKDF2 históricas.
El rehash ocurre después de completar la autenticación, incluido MFA cuando
corresponde, o tras confirmar la inscripción de un factor con contraseña válida.
No se intenta convertir un hash sin conocer la contraseña ni se fuerzan
restablecimientos masivos de las cuentas existentes.

Los códigos aleatorios de recuperación MFA mantienen el formato PBKDF2 que
exigen sus tablas y funciones. Su generador se separa del de contraseñas;
la compatibilidad de códigos existentes queda probada.

## Atomicidad y privilegios

La migración 0023 actualiza solo la admisión de nuevos hashes en alta de
usuario, cambio propio y restablecimiento administrado. Preserva sus restantes
validaciones, bloqueos y privilegios. Una función restringida al rol auth
verifica sesión, organización ficticia, cuenta y hash previo bajo bloqueo de
usuario, realiza compare-and-swap y añade auth.password_rehashed.

La actualización, la sesión provisional, el contador MFA y la auditoría
confirman en la misma transacción. Un fallo impide entregar token y revierte
todo. Reexpresar el mismo secreto no revoca otras sesiones legítimas; cambiar
realmente la contraseña conserva el comportamiento de revocación existente.
La auditoría no incluye contraseñas, hashes ni salts. El rol de datos no puede
ejecutar el actualizador de contraseñas.

## Reversión

Backend y esquema deben actualizarse de forma coordinada: tras 0023 se
rechazan nuevos hashes PBKDF2 en los escritores de contraseñas.

El downgrade revierte funciones y revisión de esquema sin modificar hashes
persistidos. **No convierte Argon2id a PBKDF2**. Un backend antiguo que solo
entienda PBKDF2 no puede autenticar hashes Argon2id: una reversión requiere
mantener el verificador compatible, una corrección hacia delante o restaurar
un respaldo verificado según el plan operativo. La reversión DDL no demuestra
compatibilidad automática con versiones anteriores de la aplicación.

## Fuentes y evidencia

Se usa la [API oficial de argon2-cffi](https://argon2-cffi.readthedocs.io/en/stable/api.html)
para hash/verificación. Los parámetros de la política coinciden con el perfil
documentado de memoria baja; su capacidad productiva concurrente aún requiere
medición. Ambos lockfiles agregan argon2-cffi y sus bindings con hashes, sin
cambiar las versiones previamente fijadas.

La aceptación integral se registrará tras CI. Las pruebas específicas cubren
legacy y PHC, rechazo de parámetros abusivos antes del KDF, preservación de
recuperación MFA, actualización única, MFA correcto, sesión anterior válida,
hash obsoleto rechazado, rol de datos y rollback por fallo real del trigger
de auditoría. No se modifica Neon ni se procesa información de personas reales.
