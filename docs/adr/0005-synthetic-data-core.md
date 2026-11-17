# ADR 0005 — Núcleo de datos ficticios antes de identidad

Aceptado para F2, 2026-11-17. Se mantiene la secuencia de fases solicitada: el núcleo de datos se desarrolla antes de identidad. Por ello F2 solo funciona con las dos organizaciones ficticias creadas en la migración, un operador ficticio por organización y APP_ENV local/test. Producción y staging siguen bloqueados. El selector X-Workspace-ID no es identidad ni autorización de usuario, y no se presentará como tal.

Cada transacción limita organization_id y actor_id mediante set_config local. Los repositorios filtran organización y acceso por expediente, y PostgreSQL aplica RLS usando un rol sin BYPASSRLS. Una función de directorio retorna solamente los nombres/UUID de los dos espacios ficticios; no permite consultar expedientes. Las funciones SECURITY DEFINER fijan search_path y no reciben SQL dinámico.

Las mediciones se tipan OBSERVADO con método manual/device. Triggers y privilegios SQL impiden sobrescritura/borrado; un sucesor único y su motivo forman la cadena. Un trigger retira la vigencia de la versión anterior de manera atómica. Los reintentos se serializan por Idempotency-Key y comparan el hash de la solicitud. El estado de vigencia es metadata: los valores, fechas, métodos y responsable nunca cambian.

El catálogo se replica por organización. Validación de unidad/rango/método/fecha en servicio y BD; confirmación explícita de duplicados y atípicos en servicio. Derivadas calculadas desde versiones vigentes con fórmula, fuentes, corte temporal y motivo si falta información. No se ofrece interpretación clínica ni clasificación IMC en F2. La clasificación informativa, si se incorpora, requerirá su referencia y textos revisados.

La carga de fixtures es explícita mediante make seed: 5 expedientes por organización, seis meses de datos con huecos, una corrección y un atípico. Repetir no duplica ni sobrescribe. No hay imágenes ni consentimientos aparentes: sus procesos se implementarán en F3–F5.

Transición obligatoria en F3: reemplazar el selector como contexto de confianza por organización/usuario derivados de sesión verificada; MFA, RBAC, sesiones, consentimientos y auditoría append-only. Las pruebas RLS actuales no equivalen a esa matriz de autenticación.
