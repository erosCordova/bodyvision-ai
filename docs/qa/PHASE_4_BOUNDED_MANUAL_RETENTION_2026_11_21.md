# BODYVISION AI — Aceptación de purga manual acotada de capturas ficticias

**Fecha:** 21 de noviembre de 2026  
**Entorno:** rama de desarrollo; solo local/test, capturas sintéticas y cifradas.

## Alcance

El endpoint existente de limpieza manual del expediente, anteriormente
sin límite por solicitud, ahora borra **hasta 100 capturas cifradas
vencidas** por transacción. Emplea el usuario autenticado y la autorización
vigente del expediente; las filas se seleccionan en PostgreSQL mediante
orden estable y \`FOR UPDATE SKIP LOCKED\` para coexistir con el trabajador
de retención independiente. La operación no borra capturas no vencidas.

La respuesta devuelve \`deleted\`, \`batch_limit=100\` y
\`limit_reached\`. El último indica solo que se eliminaron 100:
**no demuestra que resten más**. La interfaz muestra ese matiz e invita
a repetir el lote cuando corresponda, sin automatizar operaciones
destructivas recurrentes. El botón aparece en el archivo privado solo
para quien puede editar el expediente ficticio y tiene los dos
consentimientos vigentes; el servidor vuelve a comprobar permisos.

La operación y el evento \`capture.purge\` se ejecutan en una
**misma transacción**; si la auditoría falla, la base revierte el
borrado. No se registran los bytes ni tokens cifrados en auditoría.

## Evidencia verificada

**CI:** [BODYVISION CI 44972541109](https://github.com/erosCordova/bodyvision-ai/actions/runs/44972541109)  
**SHA funcional:** \`363fe90a76e970791a30a6d087780cea0d4e3b4c\`  
**Resultado:** 295 backend, 272 frontend, 43 navegador público y
8 navegador privado = **618 pruebas de aplicación aprobadas**,
además de Docker y Windows.  
**Retención optativa:** [run 44972541211](https://github.com/erosCordova/bodyvision-ai/actions/runs/44972541211), aprobada.

El test PostgreSQL crea 105 capturas vencidas y dos vigentes:
los lotes devuelven **100**, luego **5**, luego **0**; los dos objetos
vigentes conservan sus ciphertext; el expediente mantiene tres eventos
de auditoría y rechaza lectores sin permiso de edición y organizaciones
ajenas. Un test de fallo transaccional comprueba que un error de
auditoría deja intacta la captura vencida. Playwright comprueba que
el botón de interfaz llama la ruta y presenta correctamente su respuesta.

## Reevaluación y límites

El control adicional se acepta técnicamente: **Fase 4 85 % → 90 %**,
promedio global exacto **90,0 % → 90,5 %**, tablero **91 % redondeado**.
Esta evaluación no equivale a certificación clínica.

La ruta continúa restringida a expedientes ficticios en local/test;
no destruye respaldos, WAL, snapshots, fotos descargadas ni memoria
residual. Tampoco vigila sistemas cuando están apagados. Se necesita
inventario real de copias y claves, políticas legales verificadas y
revisión independiente de privacidad/seguridad antes de admitir fotos
de personas reales. No se modificaron \`main\`, Neon, producción ni el
modelo 3D aprobado.
