# Fases 4–5 — Aislamiento de fotografías efímeras y resultados de pose

Revisión: 19-11-2026. Alcance: demostración ficticia en navegador, sin uso clínico.

## Límite de privacidad implementado

El módulo de Captura no envía las fotografías a la API; revisa localmente formato y calidad y transfiere el objeto `File` a Análisis mediante una referencia efímera de módulo, nunca mediante cookies, almacenamiento del navegador, parámetros URL ni la base de datos.

El trabajo actual refuerza ese límite para el modo privado: la foto preparada se descarta al iniciar una sesión verificada (también después de configurar MFA), cerrar sesión, invalidar el token o expirar la sesión. Esto impide que una fotografía pendiente de análisis de un usuario sea reutilizada por una cuenta que inicie sesión a continuación en la misma pestaña.

Los resultados de MediaPipe también están asociados a la ejecución y fotografía que los originaron. Se invalidan las ejecuciones pendientes cuando cambia el archivo o se desmonta la vista; un resultado o un error tardío no puede sobrescribir la visualización de una imagen posterior.

## Pruebas automatizadas añadidas

- `frontend/tests/private-access.test.tsx`: transferencia efímera antes de iniciar sesión; borrado tras inicio, cierre y revocación del token activo.
- `frontend/tests/poseStaleResults.test.tsx`: promesas de detección controladas para reproducir resultados tardíos después de cambiar fotografía, desmontar el componente y recibir errores.
- Los flujos E2E anteriores comprueban firma de imágenes, decodificación, salida local sin peticiones de escritura y detección real de MediaPipe sobre una imagen sintética sin personas.

## Restricciones que NO resuelve

- No hay almacenamiento privado de fotografías, ni autorización legal de usuarios clínicos, ni enlace de la foto con un expediente. La interfaz de consentimientos se refiere exclusivamente a datos ficticios.
- No existe prueba de eliminación criptográfica de píxeles ya procesados por el navegador, canvas, WebAssembly o decodificadores. La limpieza elimina las referencias de la aplicación, no garantiza borrado seguro de memoria del sistema.
- No se ha validado el rendimiento ni la exactitud biométrica del modelo con personas reales. No estima estatura, peso, IMC, composición corporal o diagnóstico.
- El modo público no habilita almacenamiento, sesiones privadas ni atención a pacientes; antes de permitir imágenes reales hacen falta evaluación de privacidad, almacenamiento cifrado y retención verificable, controles de acceso del servidor, consentimiento jurídicamente válido y aprobación institucional.
