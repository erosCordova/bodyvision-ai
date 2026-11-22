# BodyVision — propuesta de cierre de fase 0

**Estado: preparada para revisión; pendiente de aceptación.**
Fecha: 21 de noviembre de 2026 (America/Lima).
Base revisada: d85c29270935db4d9637d3a149f1a2065347f0d4, rama feature/phase3-auth-security.

## Decisión solicitada

Aprobar el alcance original, el orden de cierre y esta matriz de riesgos.
Se propone a **Eros Córdova** como responsable de producto y de seguimiento
técnico del proyecto individual. La asignación necesita su confirmación.
No se le atribuye una revisión legal, clínica o de seguridad independiente.

Aceptar este plan cierra la planificación de fase 0; no declara terminadas
las demás fases ni autoriza datos reales. No se registra aceptación antes
de recibir una respuesta expresa del responsable de producto.

## Alcance original que se conserva

El [contrato](../requirements/IMPLEMENTATION_SPEC.md) plantea una plataforma
B2B multi-organización para registro, seguimiento y visualización corporal,
en español, sistema métrico y America/Lima. **El uso real sigue siendo el
objetivo**; este documento no lo reduce a una demostración académica.

Comprende expedientes, mediciones versionadas, identidad/permisos,
consentimiento, captura privada, pose, visor anatómico, analítica, reportes,
privacidad, simulación y operación. Estimaciones y simulaciones se separan
de observaciones. No se incluyen diagnóstico, tratamientos o mediciones
inferidas de fotos presentadas como valores observados. Ese posicionamiento
no equivale a una determinación legal de clasificación del producto.

Desarrollo y CI usan datos ficticios. Uso real requiere sus gates posteriores.
Se mantienen las decisiones del usuario: base alojada en **Neon**, nunca en
Render; un único cuerpo anatómico; trabajo en GitHub; despliegues cuando sean
necesarios; **cierre de fases antes de Figma y mejora visual**.

## Seguimiento y evidencia

El 0–9 del tablero y el F1–F10 del contrato se mapean por entregable, no por
número; el piloto F10 es un gate propio. La [auditoría previa](PHASE_0_2_ACCEPTANCE_AUDIT.md)
explica la correspondencia. El 92 % visible es una estimación técnica manual
del entorno actual: 91,5 % exacto. **No mide cobertura del contrato de uso real,
preparación productiva, aceptación formal o precisión clínica.**

La [CI 44979515758](https://github.com/erosCordova/bodyvision-ai/actions/runs/44979515758)
aprobó 647 pruebas de aplicación, Windows y Docker del código revisado.
No se han repetido esas suites por preparar este documento.

## Diferencias verificadas que siguen pendientes

Aprobar el plan no aprueba estas diferencias como sustitutos del objetivo.
Cada una requiere implementación o una decisión técnica específica y sus pruebas.

| Área | Estado revisado | Cierre pendiente | Fuente |
|---|---|---|---|
| Identidad | Argon2id para contraseñas nuevas, compatibilidad/actualización PBKDF2 tras autenticación completa y sesiones opacas revocables | JWT/refresh, invitación y recuperación objetivo | [Código](../../backend/app/core/identity.py), [sesiones](../../backend/app/services/auth_sessions.py), [ADR](../adr/0002-identity-tenancy.md) |
| Roles | Administrator, specialist y member ficticios | Matriz completa del contrato y función de privacidad | [Código](../../backend/app/core/identity.py), contrato |
| Captura | PNG sintético cifrado en PostgreSQL y retención | Objetos privados, formatos y ciclo de vida objetivo | [API](../../backend/app/api/routes/synthetic_captures.py), [ADR](../adr/0003-storage-and-retention.md) |
| Pose | MediaPipe en navegador; resúmenes declarados por cliente | Cola/worker y evaluación independiente del objetivo | [Inferencia](../../frontend/src/features/capture/poseInference.ts), [API](../../backend/app/api/routes/pose_summaries.py) |
| Privacidad | Consentimiento/revocación ficticios y producción bloqueada | Solicitudes del titular y revisión profesional; borrar capturas no equivale al flujo ARCO completo | [Routers](../../backend/app/main.py), [borrador](../legal/LEGAL.md) |
| 3D y simulación | Atlas único, LOD, pruebas sintéticas y recursos CPU | GPU/dispositivos físicos y referencias morfológicas autorizadas | [Visor](../../frontend/src/features/viewer/AnatomyScene.ts), [seguimiento](../../frontend/src/features/progress/projectProgress.ts) |
| Reportes | PDF/CSV auditados y descarga de 2.007 fuentes probada | Autenticidad externa, persistencia final y recepción | [Aceptación](PHASE_7_COMPLETE_LONG_HISTORY_2026_11_21.md) |
| Operación | Restauración y vigilancia local probadas | Custodia/respaldos y supervisión externos, carga y objetivos medidos | [Prioridades](PHASE_COMPLETION_PRIORITY.md), [configuración](../../backend/app/core/config.py) |

La fila de identidad incorpora la implementación posterior del
[ADR 0009](../adr/0009-argon2-password-transition.md). Este avance técnico
no registra aceptación del plan ni resuelve JWT/refresh o la matriz de roles.
La [CI 44982522816](https://github.com/erosCordova/bodyvision-ai/actions/runs/44982522816) aprobó ese avance en
`06336d08ceb719b51c465b6cc15d8b17f6e9a973`: 661 pruebas de aplicación,
Windows y Docker; el porcentaje de las fases no cambia.

## Responsables propuestos

Eros asume seguimiento de producto, prioridades y coordinación técnica,
**si lo confirma**. La asistencia de implementación automatizada no se
presenta como una firma de ingeniería independiente.

Eros coordinará la designación de revisores para QA, seguridad/privacidad/legal,
validación de IA/3D y dispositivos, y operación/custodia **antes de cerrar
los gates que los necesitan**. Asignar seguimiento no sustituye esas revisiones.
No se declara que ya existan especialistas asignados o aprobaciones externas.
Este plan no autoriza contratación, pagos o contactos a terceros.

## Matriz de riesgos para revisar

Probabilidad e impacto son valoraciones iniciales de planificación, no
frecuencias observadas ni aceptación del riesgo residual. Responsable de
seguimiento propuesto en todas las filas: Eros. Cada gate conserva el revisor
especializado que corresponda.

| ID | Riesgo | Probabilidad / impacto | Tratamiento y criterio | Gate |
|---|---|---|---|---|
| RSK-01 | Interpretar 92 % como cumplimiento real | Alta / alto | Mantener matriz de diferencias y evidencias por requisito | Producto/ingeniería |
| RSK-02 | Confundir numeraciones y piloto | Media / alto | Mapear por entregables y mantener F10 separado | Producto/QA |
| RSK-03 | Admitir datos sensibles prematuramente | Media / alto | Conservar bloqueo hasta revisar identidad, privacidad y go-live | Seguridad/privacidad |
| RSK-04 | Cambiar identidad, storage o cola sin decidirlo explícitamente | Alta / alto | Implementar objetivo o resolver mediante ADR específico y validación | Ingeniería/seguridad |
| RSK-05 | Acceso entre organizaciones/expedientes | Media / alto | RLS, permisos y regresiones en todos los endpoints objetivo | Seguridad/QA |
| RSK-06 | Confundir purga activa con borrado de copias | Media / alto | Inventario, política y ensayo de retención fuera de la base activa | Privacidad/operación |
| RSK-07 | Perder claves, acceso MFA o respaldos | Media / alto | Custodia separada y recuperación externa probada | Seguridad/operación |
| RSK-08 | Reescribir auditoría y su cabecera | Media / alto | Anclaje externo y verificación independiente | Seguridad |
| RSK-09 | Interpretar pose/atlas/simulación como anatomía validada | Media / alto | Rotulado, separación y referencias autorizadas evaluadas | Dominio/QA |
| RSK-10 | Sustituir hardware físico por emulación | Alta / medio | Medir GPU y dispositivos objetivo y conservar resultados | QA/ingeniería |
| RSK-11 | Confundir CI o restauración local con producción lista | Media / alto | Revisión, carga, secretos, supervisión y RPO/RTO medidos | Operación/seguridad |
| RSK-12 | Retrasar funcionalidad con rediseños | Media / medio | Interfaz actual durante cierre; Figma después | Producto |

## Salida de fase 0

Alcance, diferencias, tratamientos y responsables propuestos quedan preparados
para revisión. Falta aprobar este documento y confirmar el responsable de
producto/seguimiento, o indicar correcciones. Hasta entonces la fase 0 sigue
pendiente, con estimación de 85 %; el global se mantiene en 92 % redondeado.

Aceptar la planificación no resuelve las diferencias técnicas ni los gates
especializados. La siguiente recepción funcional es la del núcleo de
expedientes y mediciones. Identidad, storage, cola de pose y privacidad
mantienen sus brechas explícitas hasta implementarlas o resolverlas.
