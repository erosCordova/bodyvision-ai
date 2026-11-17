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
- Rewrites y cabeceras en frontend/vercel.json cuando se obtenga la URL real del servicio.

Las instancias gratuitas pueden detenerse por inactividad y tardar en responder al primer acceso. Se mantiene el estado de carga y se permite hasta 90s en el cliente de demo. Las URL y el resultado de verificación se registrarán tras el despliegue real.
