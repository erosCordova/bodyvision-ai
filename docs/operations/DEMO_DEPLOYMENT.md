# Demostración en Vercel + Render

Destino: frontend estático Vercel, servicio web Render Free con PostgreSQL privado efímero y API read-only. No se modifica la base de otros proyectos. No es producción, ni un piloto con datos reales.

- Docker de demo: infra/demo/Dockerfile, contexto raíz del repositorio.
- APP_ENV=demo, DEBUG=false; PORT provisto por Render.
- Inicio: python -m app.demo_runtime. No requiere variables de contraseñas del usuario.
- Salud: /api/v1/health/ready valida la conexión y migración; /api/v1/health/live valida proceso.
- Modelo de datos: mismas migraciones/RLS y fixtures de F2; el acceso de lectura se confirma con /api/v1/workspaces (read_only=true).
- Escrituras HTTP: 403 DEMO_READ_ONLY; conexiones PostgreSQL read-only además del guard de API.
- Reinicio: regenera las fixtures; nunca debe usarse para conservar datos de personas.
- Vercel: raíz frontend, npm ci, npm run build, salida dist, Node22, VITE_DEPLOYMENT_MODE=demo.
- Rewrites y cabeceras en frontend/vercel.json: /api/ se dirige al servicio Render; las rutas de la interfaz usan index.html.

Las instancias gratuitas pueden detenerse por inactividad y tardar en responder al primer acceso. Se mantiene el estado de carga y se permite hasta 90s en el cliente de demo.

## Publicación verificada · 17 noviembre 2026

- Interfaz: https://bodyvision-ai.vercel.app/
- API: https://bodyvision-ai-demo-api.onrender.com/api/v1/health/ready
- Render: srv-dbu7kdvf3r2c73bikou0, plan Free, Oregon; despliegue dep-dbu7koivtthc73f3233g live.
- Vercel: prj_0gC6oFcTO6F2g5TBf5HfIOUBuC83; despliegue inicial dpl_jqJJXjNEUf48jSvMm1wi9HZi2gQR READY.
- Fuente inicial: e78b5fa914ad4a37b189810d1657941368c97296. CI verde: https://github.com/erosCordova/bodyvision-ai/actions/runs/44121028632
- Salud a través del proxy Vercel: HTTP 200, database=connected, schema_revision=0002_data_core.
- Navegación real en Chrome: resumen con 5 expedientes activos, 21 mediciones vigentes en 30 días y 1 corrección; aviso de solo lectura visible.
- Validación previa: 46 pruebas backend y 11 frontend; CI incluye navegador y Docker.
- Los datos son ficticios y efímeros. El modo staging/production sigue bloqueado hasta completar autenticación y privacidad.
