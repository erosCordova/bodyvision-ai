# F7 — Intervalos personalizados de exportación CSV

En Analítica de un expediente ficticio autenticado, la sección de resumen incorpora «Exportar un intervalo personalizado». Las fechas inicial y final son días civiles inclusivos de America/Lima. El backend usa PostgreSQL para convertir la medianoche inicial y la del día posterior al final a instantes, sin depender de la zona del equipo. El gráfico no cambia; el intervalo se aplica exclusivamente al CSV. El control está disponible incluso si el gráfico del periodo actual está vacío.

Se mantienen los periodos preestablecidos, el cursor de una sola instantánea, las fuentes vigentes, el límite 8 MiB sin truncamiento, la auditoría transaccional, SHA-256 y la firma Ed25519 opcional. Las fechas se devuelven como metadatos y el frontend comprueba correspondencia con la solicitud. La firma vincula los bytes exportados, no un sello externo de cobertura temporal. Fechas imposibles, invertidas, incompletas o futuras son rechazadas; no se admite intervalo en periodos preestablecidos.

Pruebas nuevas: límites exactos de medianoche Lima en PostgreSQL, aislamiento, errores 422, evento de auditoría, selección React con gráfico vacío y rechazo de respuestas con fechas discordantes. Pendiente CI integral. Exclusivamente datos ficticios local/test; no habilita producción.
