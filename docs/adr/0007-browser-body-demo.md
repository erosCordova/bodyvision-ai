# ADR 0007 · Visor corporal sin instalaciones para el usuario

Solicitud: visualizar un cuerpo lo más realista posible dentro de BODYVISION y manipular estatura y volumen, sin instalar herramientas de modelado.

Se incorpora una demostración independiente en /body-3d con Three.js y un adaptador React cuyo ciclo de vida libera los recursos de GPU. No se añaden react-three/fiber ni drei: la escena única no necesita otro renderizador React y se mantiene React 18. El motor y el visor son lazy para no incrementar la carga inicial de los expedientes.

Se utiliza geometría humana y targets CC0 MakeHuman/MPFB con textura CC0 Aksel/Mindfront, no un maniquí hecho de primitivas. Procedencia, licencia completa, versión y hashes quedan documentados en docs/3d/ASSET.md y manifest.json. Se informa siempre MODELO DE DEMOSTRACIÓN e ILUSTRACIÓN HIPOTÉTICA. Los únicos objetos hechos con primitivas son los ojos y el escenario de iluminación.

Los controles son locales e ilustrativos y no persisten ni usan mediciones reales. El activo no está producido en Maya y no se presenta como reconstrucción por IA. El acceso productivo, captura, identidad y validación médica siguen fuera de alcance. Esta demostración anticipa una parte del visor; no declara completadas las fases intermedias ni el visor productivo completo.
