# BodyVision AI — rediseño frontend

Importación íntegra del ZIP realistic-3d-web-frontend. Esta aplicación es un prototipo independiente; su autenticación, expedientes, mediciones y consentimientos son simulados. No utilizar con información real ni como reemplazo de la aplicación autenticada. El frontend operativo sigue en `frontend/`.

Para validar el diseño: `npm ci` y `npm run build` desde este directorio. La conexión con los servicios reales debe reutilizar el control de sesión, permisos y API existentes.

## Modelo anatómico — Z-Anatomy
El ZIP replace-3d-anatomy-model.zip incluye código de visualización pero no los siete GLB. Se recuperan los siete recursos de la distribución de 2.198 estructuras de SeemaBansal1/3d-human-body-anatomy, fijados a la revisión 28912432581accd7a1c62129d55f0e9758221d48 y comprobados con SHA de blob. No se puede confirmar identidad binaria con el ZIP porque no incluía las mallas. Se reutiliza el componente compartido para las vistas 3D del rediseño; no se cambia la autenticación de demostración.
Z-Anatomy (CC BY-SA 4.0), derivado de BodyParts3D © DBCLS; exportación web de SeemaBansal1. El riñón de Lissie Cowley tiene licencia CC BY-NC 4.0; esta versión se destina exclusivamente a demostración educativa no comercial. Ver https://github.com/SeemaBansal1/3d-human-body-anatomy#credits-and-licences.
Atlas de referencia único: no representa una reconstrucción individual, sexo anatómico validado, medición térmica real ni cambios fisiológicos clínicamente validados. La escala simulada es ilustrativa.
