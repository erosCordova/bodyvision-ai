# Rediseño visual total — BODYVISION AI (v0.3.0)

Sistema de diseño de primer nivel: canvas profundo con auroras cian/violeta,
superficies de vidrio, tipografía Inter local y un set de iconos SVG propio.
Todo el workspace (resumen, expedientes, mediciones, captura, análisis, 3D,
evolución, reportes, privacidad y administración) consume el mismo sistema.

## Fundamentos

- **Tokens** (`src/styles/tokens.css`): paleta canvas `#070d18`, superficies
  `surface-1…4`, líneas translúcidas, texto `text-1/2/3`, acentos
  `--cyan #3AE2FB` y `--violet #A78BFA`, gradiente de marca
  `--grad-brand` (cian → azul → violeta), radios `r-xs…r-xl`, sombras y
  resplandores, anillo de foco `--ring`, curvas `--ease-spring`.
  Se conservan alias heredados (`--panel`, `--border`, `--muted`…) para que el
  CSS de funcionalidades los herede sin cambios estructurales.
- **Iconografía** (`src/components/ui/Icon.tsx`): set SVG de trazo 1.7
  (retícula 24 px, `currentColor`) para navegación, KPIs, estados, alertas y
  acciones. Reemplaza los glifos de texto (`▤`, `⌁`, `◇`…).
- **Marca** (`src/components/ui/Logo.tsx` y `public/favicon.svg`): hexágono-apertura
  con figura humana y línea de escaneo; wordmark con gradiente.
- **Base global** (`src/styles/app.css`): reset, fondo ambiental auroral,
  selección, scrollbars, foco visible con halo, botones primarios con brillo
  de marca y secundarios con desenfoque.
- **Workspace de datos** (`src/styles/data.css`): paneles con realce superior,
  KPIs con cifras tabulares y elevación al pasar el puntero, tablas con hover,
  pestañas segmentadas, modal con entrada animada y barra de progreso de marca,
  insignias con punto luminoso (OBSERVADO / DERIVADO / SIMULADO).
- **Shell enterprise** (`src/styles/enterprise.css`): sidebar fija de vidrio con
  línea luminosa lateral, navegación agrupada (Seguimiento / Evaluación /
  Configuración) con chips de icono y estado activo con gradiente; topbar
  pegada con migas de pan, selector de organización con chevron propio y
  avatar con gradiente; banner de datos ficticios; historial y atajos del
  dashboard con microinteracciones; impresión limpia (sin cromo).
- **Acceso sandbox** (`src/features/access/sandbox-access.css`): portada de
  producto: escena con atlas 3D, órbitas, tarjeta de vidrio con brillo superior
  y CTA con gradiente de marca. Se mantiene la semántica y los roles
  accesibles existentes.

## Compatibilidad

- Sin cambios en rutas, contratos de API, nombres accesibles, `aria-*` ni roles
  usados por las pruebas; los textos de la interfaz se conservan.
- `data-core.test.tsx`: el panel de evolución queda abierto por defecto (decisión
  de producto previa); la expectativa obsoleta sobre «Explorar evolución» se
  actualizó a la región de evolución visible, y el error de 503 se acota a la
  región KPI (el catálogo del módulo también falla con el mismo stub).
- `setup.ts` incorpora un stub de `matchMedia` para jsdom.
- `measurementForm.test.tsx` usa `textbox` (el campo es `type="text"` con
  coma decimal española); `privacyOfficerLayout.test.tsx` completa su mock de
  `PrivateAuthProvider` (`sessionRequired`, `sandboxAuthEnabled`).

## Verificación (este checkout)

- `npm run test`: **402/402** (antes 395; 7 en fallo).
- `npm run lint`: limpio (`--max-warnings 0`).
- `npm run typecheck`: limpio. `npm run build`: OK.
- CSS validado con postcss. Vista previa local: `vite preview` (ver `vite.config.ts`,
  `preview.allowedHosts`).

Nota: el atlas anatómico 3D real requiere `public/pose` (se genera con
`scripts/prepare_pose_assets.mjs`, pin SHA-256) y la API en `:8000`; sin ellos,
la interfaz degrada con estados de error diseñados, no con pantallas rotas.
