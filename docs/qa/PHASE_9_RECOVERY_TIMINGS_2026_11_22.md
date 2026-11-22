# BodyVision — Mediciones del simulacro de recuperación (Fase 9)

**Alcance:** ensayo PostgreSQL en runner descartable con datos ficticios.
Este documento **no** define ni demuestra RPO/RTO de producción, SLA,
disponibilidad, pérdida ante desastre real ni aceptación operativa.

## Avance implementado

El flujo de CI ya verifica integridad de un dump, restauración a un
PostgreSQL sin red ni volúmenes compartidos, equivalencia de todas las
filas y secuencias, autenticación y recuperación MFA, HTTP y navegador
contra el reemplazo, y recuperación de la pila original.

La nueva herramienta **scripts/ci_recovery_timing.py** toma mediciones
monotónicas en seis instantes comprobados por las etapas anteriores:

1. Respaldo lógico capturado
2. Base principal detenida y confirmada
3. Filas y secuencias de la copia recuperada comprobadas
4. Interfaz HTTP privada y API recuperada en estado ready
5. Recorrido privado de navegador completado satisfactoriamente
6. Aplicación original reiniciada y comprobada

El informe registra cinco intervalos sanitizados en segundos:
- Edad transcurrida entre captura del respaldo y HTTP recuperado
- Tiempo entre detener la base principal y HTTP recuperado
- Tiempo entre detener la base y aceptar el navegador recuperado
- Tiempo desde HTTP recuperado a aceptación del navegador
- Tiempo entre aceptación del navegador y retorno de la pila original

**El tiempo desde el respaldo no es RPO:** el experimento comprueba
coincidencia lógica con la copia tomada, pero no mide pérdida de
escrituras producidas tras ella. **El tiempo hasta HTTP tampoco se
califica como RTO**, pues no hay objetivos aprobados, continuidad
real del servicio, DNS/TLS ni monitorización fuera del mismo host.

Por tanto, el resultado deja rpo_seconds y rto_seconds sin valor,
external_backup_verified=false, service_level_approved=false
y production_ready=false. Se evitan objetivos o velocidades inventadas.

## Protección de datos y condiciones de ejecución

Solo existe con activación explícita de APP_ENV=test, CI=true y
BODYVISION_RESTORE_DRILL=synthetic-only. La herramienta no realiza
peticiones de red ni consulta bases de datos. Su estado temporal se
crea dentro del directorio privado con permisos restrictivos utilizado
por la prueba de restauración; no se adjunta a artefactos ni se conserva
tras la ejecución.

El estado usa únicamente nombre de hito y tiempo monotónico.
Se rechazan etapas fuera de orden, duplicaciones, reloj regresivo,
duración superior a dos horas, JSON con campos inesperados o
repetidos, archivos demasiado grandes, enlaces o cambios durante
la lectura. La escritura es atómica. El error mostrado no expone
rutas, usuarios, credenciales, SQL, filas o capturas.

Los nuevos tests estándares de scripts se ejecutan tanto en
Windows Git Bash como en Linux, además del simulacro completo
del job Docker. El resultado se documenta con identificador y
commit concretos únicamente después de completar la CI.

## Estabilidad de sesión

En paralelo se corrigió la prueba existente de invitaciones que
en ocasiones observaba 201 en vez de la secuencia 401,201.
La renovación compartida puede finalizar por otra consulta antes
del POST y entregar un JWT vigente directamente: ambos órdenes
son admisibles SOLO si la prueba demuestra que el JWT viejo fue
rechazado, hubo una renovación y existe una única invitación.
Se mantiene la prohibición de otros estados y se evita debilitar
la seguridad. Referencia de seguimiento: issue #53.

## Pendientes para cerrar operación

No se ha demostrado pérdida total de host, red y discos, custodia
externa de respaldos y claves, restore PITR, RPO/RTO y SLO acordados,
repetición estadística de tiempos, notificaciones externas,
evaluación de riesgo ni recepción de operación y privacidad.

**Esta entrega no modifica el 92,5 % global (93 % visible).**
El progreso es técnico y sintético; no toca Neon, main,
despliegues o expedientes de personas.
