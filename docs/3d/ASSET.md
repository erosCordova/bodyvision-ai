# Activo histórico de demostración MakeHuman / MPFB · versión 1.0.0

> **Modelo descartado para la interfaz actual.** El archivo `frontend/public/models/bodyvision/adult-demo.glb.gz` permanece como recurso histórico, pero no se muestra en `/body-3d` ni en la vista previa del dashboard. Ambas vistas utilizan la misma malla de piel del atlas descrita en `docs/3d/PRIMARY_MODEL.md`. No debe volver a conectarse el recurso MPFB a una pantalla pública sin una nueva decisión de diseño.

El recurso histórico usa un activo adulto genérico con superficie anatómica, rostro, manos, pies y textura de piel. No representa a pacientes ni se deriva de sus mediciones. No es una reconstrucción, un modelo clínico, una estimación de composición corporal ni una predicción del aspecto a cierto peso. No hay órganos, músculos internos, landmarks, rig ni captura fotográfica.

## Fuentes verificadas y licencia

Malla base y targets: MakeHuman Community / MPFB2, commit fijo `9de0707fdc88438d7c53a1a2ac7937d9221e2431`:

- https://github.com/makehumancommunity/mpfb2/blob/9de0707fdc88438d7c53a1a2ac7937d9221e2431/src/mpfb/data/3dobjs/base.obj
- https://github.com/makehumancommunity/mpfb2/blob/9de0707fdc88438d7c53a1a2ac7937d9221e2431/LICENSE.md
- https://github.com/makehumancommunity/mpfb2/blob/9de0707fdc88438d7c53a1a2ac7937d9221e2431/LICENSE.ASSETS.md
- Targets en src/mpfb/data/targets/macrodetails/: caucasian-male-young; universal-male-young-averagemuscle-averageweight; universal-male-young-averagemuscle-maxweight; universal-male-young-averagemuscle-minweight; universal-male-young-maxmuscle-averageweight (todos .target.gz).

La cabecera de base.obj declara la liberación explícita CC0 en septiembre de 2020. La licencia global distingue código GPL de los activos CC0. Se ha utilizado solo la malla y datos de targets, sin copiar código MPFB. Se conserva LICENSE.md en MPFB_LICENSE.md y el texto completo CC0 en frontend/public/models/bodyvision/LICENSE.ASSETS.md.

Piel: **Aksel**, autor **Mindfront**, del paquete **skins02**, CC0 según la ficha oficial y la tabla de ese activo:

- https://static.makehumancommunity.org/assets/assetpacks/skins02.html
- https://files2.makehumancommunity.org/asset_packs/skins02/skins02_cc0.zip (ETag observado: 4896344-6160e7915e6c0; 76112708 bytes)
- Archivos originales skins/mindfront_aksel_skin/Aksel_Skin_diffuse.png y Aksel_Skin_NRM.png. Definición del material original conservada en SKIN_SOURCE.mhmat.
- Adaptación: texturas reducidas a 1024 px WebP calidad 88, UV V convertido OBJ→glTF, material PBR web y luz de estudio. No se emplea textura especular original.

## Construcción y entrega

`python scripts/build_body_asset.py INPUT_DIRECTORY` transforma los datos CC0 y genera un GLB estándar glTF 2.0. Quita todos los helpers; triangula la superficie; conserva UV, calcula normales suaves y tres morph targets (incluidas normales). Añade un material opaco de pantalón deportivo ajustado sobre pelvis y muslos superiores. Los ojos se añaden en el visor desde centros anatómicos de helpers, que no se dibujan.

La malla contiene 26756 triángulos, 14517 vértices con costuras UV, escala base 1.75 m, Y arriba. Usa EXT_texture_webp para la textura de piel. No necesita decodificadores de CDN ni llamadas a servicios 3D. El GLB se entrega comprimido con gzip (envoltorio, no formato alternativo), se verifica SHA-256, se descomprime con DecompressionStream y se carga con GLTFLoader. Navegadores sin esta API presentan error recuperable. El manifiesto guarda checksum tanto comprimido como decodificado y de texturas.

Las deformaciones son interpolaciones **artísticas** acotadas de los targets, con una correspondencia de peso meramente ilustrativa. El control de definición NO representa grasa ni músculo medido. Cambiar estatura escala el eje Y del modelo en metros. No se escriben ni se mezclan estos parámetros con tablas observadas. El modelo usa una única apariencia adulta masculina; otras apariencias y calibración antropométrica no están implementadas.

## Interacción, acceso y rendimiento

Vistas frontal/lateral/posterior/perspectiva, órbita acotada sin pan, zoom, giro automático opt-in, reset y malla real. Se respeta movimiento reducido y se pausa la animación con la pestaña oculta. Render bajo demanda cuando el giro está apagado; pixel ratio limitado, 27 mil triángulos, sombras 1024, carga lazy del motor. Se liberan geometrías, materiales, texturas y contexto al desmontar y se trata la pérdida de WebGL. Rendimiento real depende de dispositivo y GPU; no se afirma un FPS mínimo medido. La marca local bodyvision-demo-model-load registra solo duración y no se transmite.

La variante actual es una demostración pública, servida como activo estático sin información personal. El flujo de activos privados, URLs firmadas, comparación de rigs y autenticación permanece pendiente. La alternativa producida en Maya sigue siendo un posible reemplazo futuro: este activo **no se ha creado en Maya**.
