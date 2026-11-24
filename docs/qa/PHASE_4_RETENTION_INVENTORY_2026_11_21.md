# Fase 4: inventario de capturas cifradas vencidas — 21-11-2026

## Alcance implementado

El panel privado de Administración → Estado del servicio ofrece una
consulta de solo lectura llamada "Comprobar capturas vencidas".
Solo responde a administradores autenticados local/test con archivo
sintético cifrado habilitado. La muestra usa PostgreSQL real;
requiere simultáneamente RLS y una concesión explícita de lectura
vigente al expediente del actor. No se leen bytes de imagen ni se
descifran capturas, tampoco se ejecuta mantenimiento.

Campos: ámbito de permisos de expedientes accesibles de la misma
organización, fecha de consulta, contador de vencidos (máximo 1000),
indicador de recuento acotado, fecha del vencimiento más antiguo
y marca inmutable de que NO hubo purga. No se devuelven UUID de
expedientes, nombres, hashes de imágenes ni ciphertext.

## Aceptación reproducible

Las pruebas de integración en PostgreSQL incluyen:
1. sesión ausente, roles sin permiso y selector de organización falsificado;
2. administrador con cero concesiones: inventario de otros expedientes oculto;
3. permiso explícito: aparece exactamente una captura vencida,
   pero no una vigente;
4. permiso revocado: la captura desaparece del ámbito consultado;
5. no se modifica ni elimina ninguna de las dos capturas sintéticas;
6. el recuento 1001 se publica como "al menos 1000", no como un
   total falsamente exacto; sin muestra, no se inventa una fecha.

Las pruebas frontend validan botón voluntario, respuesta acotada,
advertencias de visibilidad y que no se imprimen tokens en pantalla.
Se conserva el resto del ciclo de mantenimiento y seguridad.

CI integral https://github.com/erosCordova/bodyvision-ai/actions/runs/44971391963
(commit 3fba6a0368bdf255d2358f728dd39e225a63206b) con
**293 backend + 272 frontend + 43 públicas + 8 privadas =
616 pruebas de aplicación aprobadas**; Windows y Docker aprobados.
Retención independiente también aprobada:
https://github.com/erosCordova/bodyvision-ai/actions/runs/44971391969

## Estado y limitaciones

Se acepta el criterio de inventario privado verificable y se ajusta
**Fase 4: 80 → 85 %**. El promedio exacto de diez fases se ajusta
**89,5 → 90,0 %**; el indicador mostrado sigue en 90 %.

No hay borrado verificable de WAL, snapshots, backups, descargas
o réplicas externas. Cero registros para el administrador nunca
certifica cero para toda la organización. No se otorga autorización
legal para fotografía clínica ni para operar con datos de personas.
Esta entrega no modifica despliegues públicos, Neon ni main.
