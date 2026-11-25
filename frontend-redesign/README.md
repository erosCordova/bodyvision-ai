# BodyVision AI — rediseño frontend

Importación íntegra del ZIP realistic-3d-web-frontend. Esta aplicación es un prototipo independiente; su autenticación, expedientes, mediciones y consentimientos son simulados. No utilizar con información real ni como reemplazo de la aplicación autenticada. El frontend operativo sigue en `frontend/`.

Para validar el diseño: `npm ci` y `npm run build` desde este directorio. La conexión con los servicios reales debe reutilizar el control de sesión, permisos y API existentes.

## Modelo anatómico
El componente 3D compartido utiliza los mismos GLB de Open Anatomy 3D (versión 0.1.0) que el visor existente. BodyParts3D © DBCLS, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); [Open Anatomy 3D](https://github.com/MervinR07/open-anatomy-3d). Adaptación de materiales y escala por BODYVISION. Las variaciones de forma y los colores térmicos son ilustrativos; no son mediciones clínicas ni reconstrucciones individuales.
