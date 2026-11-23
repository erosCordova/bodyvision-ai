# F8 — Historial de simulaciones: corte UTC consistente entre páginas

**Fecha:** 23-11-2026. **Entorno:** escenarios ficticios, local/test, PostgreSQL real
en la matriz CI; sin datos personales ni dispositivos clínicos.

## Problema que se resuelve

El exportador CSV leía hasta 2.000 escenarios en páginas ordenadas por
`created_at DESC,id DESC` con `OFFSET`, pero cada petición HTTP creaba
una transacción distinta. Una nueva versión insertada después de obtener
la primera página desplaza el listado y puede provocar filas duplicadas
o un cambio en `total`, impidiendo la descarga completa. El mecanismo
anterior rechazaba el archivo parcial, pero tampoco podía continuar una
exportación de un historial que estuviera en uso.

## Contrato implementado

- El endpoint `GET /api/v1/profiles/{profile_id}/scenarios` obtiene de
  **PostgreSQL** un `clock_timestamp()` antes de paginar y devuelve el
  campo `snapshot_at` con zona horaria explícita.
- Las filas y el `count(*)` aplican exactamente el mismo límite
  `created_at <= :cutoff` además de organización, perfil y RLS.
- El cliente exportador guarda el corte de la primera página, lo
  envía URL-encoded en `snapshot_at` en las restantes y rechaza cualquier
  cambio o desaparición del punto de corte.
- El backend rechaza un corte sin zona, posterior al reloj de la base
  o con más de 30 minutos de antigüedad. No acepta usar un punto de
  corte remoto ilimitado.
- La navegación normal sin `snapshot_at` sigue mostrando nuevos
  escenarios y recibe un corte nuevo en cada solicitud. No se abren
  transacciones duraderas ni se crean tablas, tokens o ficheros nuevos.
- La instancia `demo` conserva su historial vacío y no afirma disponer
  de una instantánea PostgreSQL.

Las demás barreras del exportador permanecen: idempotencia,
privacidad por perfil, datos `SIMULADO` exclusivamente, máximo 2.000
filas, límite de 100 por página, recuento estable, detección de IDs
duplicados y fallo integral sin crear CSV parcial.

## Regresiones

- `backend/tests/integration/test_scenarios.py`: crea tres escenarios,
  captura la primera página y su corte, inserta un cuarto, y demuestra
  que la página siguiente excluye el cuarto y conserva el recuento y
  exactamente los tres IDs originales. Una nueva consulta normal sí
  ve los cuatro. Rechaza timestamp sin zona, futuro y caducado.
- `frontend/tests/scenarioHistoryExport.test.ts`: verifica repetición
  del corte en páginas 2 y 3, rechazo de corte alterado, desaparecido
  o con formato ambiguo, sin resultados parciales.
- `frontend/tests/e2e/body-viewer.spec.ts`: Chromium verifica
  que la exportación integral utiliza el corte devuelto mientras
  mantiene el CSV sintético sin datos identificativos.

Se requiere CI completa y pruebas de PostgreSQL antes de fusionar.

## Garantías y límites de la técnica

Este es un **punto de corte temporal**, no una transacción MVCC
compartida entre llamadas HTTP: en una inserción cuyo inicio de
transacción preceda al corte pero cuyo commit ocurra después, el
`created_at` basado en `now()` podría quedar por debajo del corte.
No es una copia transaccional certificada del historial en presencia
de transacciones pendientes, cambios de reloj arbitrarios ni
restauraciones concurrentes. Al ser escenarios inmutables, las
inserciones ordinarias posteriores al corte dejan de desplazar
páginas; cualquier irregularidad adicional sigue rechazándose
antes de emitir CSV.

Las validaciones morfológicas, consentimiento real, hardware GPU/
teléfonos y aceptación clínica/producto continúan pendientes.
**F8: 95 % técnico manual; global: 93 % estimado** sin incremento
automático. No se modifica `main`, Neon, producción, los datos
guardados ni el modelo anatómico 3D elegido.
