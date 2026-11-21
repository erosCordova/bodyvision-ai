# Recuperación MFA sobre PostgreSQL restaurado

## Alcance

La ampliación de `backend/tests/recovery_acceptance.py` utiliza una
tercera cuenta ficticia con rol administrador, distinta de las cuentas
de los recorridos privados anteriores. Antes del respaldo, configura
TOTP mediante la API, genera ocho códigos de recuperación y consume
uno de ellos. La sesión resultante ya tiene verificación MFA.

La clave de cifrado MFA es externa al dump y distinta de la clave de
capturas. La semilla del autenticador y los códigos necesarios para
simular al usuario permanecen en el archivo temporal privado del
runner, sin artefactos publicados y con limpieza ante éxito o fallo.
El backup conserva las semillas cifradas, verificadores, marcas de
consumo, contadores antirrepetición, sesiones y auditoría; la igualdad
de sus filas se comprueba antes de operar sobre el reemplazo.

| Control sobre la instancia recuperada | Resultado exigido |
|---|---|
| Sesión anterior con MFA | Puede consultar el expediente autorizado |
| Contraseña sin segundo factor | 401 `MFA_CODE_REQUIRED`, sin token |
| Código consumido antes del backup | 401 `MFA_CODE_INVALID` |
| TOTP con la clave externa correcta | Login y sesión autorizada |
| Repetición del mismo TOTP | 401 `MFA_CODE_INVALID` |
| Código de recuperación no consumido | Login válido; su repetición falla |
| Clave MFA ausente | Configuración con MFA habilitado rechazada al iniciar |
| Clave MFA incorrecta | Login TOTP falla con 500 y sin token |
| Acceso SQL de los roles de aplicación | No leen semillas cifradas ni verificadores directamente |
| Reemplazo del factor | Semilla nueva y sesiones anteriores revocadas |
| Confirmación del nuevo factor | Ocho códigos nuevos y sesión funcional |
| Código antiguo que seguía sin usar | Rechazado después del reemplazo |
| Auditoría tras las operaciones | Cadena válida y eventos comprobados |

La prueba utiliza el reloj real. Si la restauración termina dentro del
mismo intervalo que la confirmación original, genera un TOTP del siguiente
paso dentro de la ventana de deriva +1 ya admitida por la implementación.
No cambia el reloj ni los criterios de verificación. El mismo código se
reenvía para comprobar que su contador ya aceptado impide reutilizarlo.

## Validación y límites

La comprobación complementaria local sobre dos clústeres descartables
aprobó preparación, restauración, comparación de filas y recorrido MFA.
Las 143 pruebas unitarias aprobaron, incluidas cinco nuevas restricciones
de configuración y redacción de errores. El job `docker-smoke` de
[CI 44939248415](https://github.com/erosCordova/bodyvision-ai/actions/runs/44939248415)
aprobó el commit `0eba8fd7ae21bcc20db08d1c2bfe0cb11e91a5f9`
sobre PostgreSQL 15. Su log contiene
`synthetic_recovered_mfa_verified` y
`synthetic_recovered_application_verify_verified`; la instalación
original volvió a estar saludable después. El bloque de reposición
duró 27 segundos en ese runner, sin establecer un RTO.
La ejecución integral terminó con **success** en Windows, pruebas nativas
y Docker: **562 pruebas de aplicación** aprobadas (275 backend,
243 frontend, 36 navegador público y 8 privado), además de los controles
de scripts y restauración. Este entregable se valora manualmente en
**5 puntos de fase**: Fase 9 **80 % → 85 %**. La suma de diez fases
pasa de 860 a 865 y la media de **86,0 % a 86,5 %**; el tablero
muestra **87 %** por redondeo. No se modifica la valoración de otras fases.

Se mantienen los límites del laboratorio: FastAPI TestClient con
conexiones LOGIN reales y roles limitados. La aceptación MFA aquí registrada
no incluía frontend ni HTTP por socket; esa ampliación posterior consta
en `PHASE_9_RECOVERED_HTTP_UI.md`. No demuestra custodia productiva de claves,
recuperación sin contraseña/códigos/clave, revisión independiente de
seguridad, PITR, pérdida del host ni un RPO/RTO. No se modifican bases
alojadas, despliegues, el modelo 3D ni datos de personas.
