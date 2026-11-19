# Fase 6 — LOD geométrico verificable (19-11-2026)

## Alcance implementado

- El visor usa el mismo **atlas anatómico 3D** que ya estaba aprobado. No se ha añadido un segundo cuerpo ni se han reemplazado los recursos licenciados del repositorio.
- En modo **Alta**, cada estructura conserva su `BufferGeometry` original.
- En modo **Fluida**, las estructuras grandes, indexadas, estáticas y con un único grupo de material pueden recibir una copia simplificada mediante `SimplifyModifier` de **Three.js r187 / Meshoptimizer**.
- La geometría reducida se genera después de la primera representación, de una en una y bajo demanda. El modelo completo queda en memoria, de modo que el regreso a Alta es reversible.
- Para preservar exactitud de selección, la estructura activa recupera la geometría completa aunque el resto del atlas permanezca en Fluida.
- Se excluyen estructuras pequeñas (menos de 3 000 triángulos), geometrías con múltiples grupos de materiales, mallas esqueléticas y geometrías con atributos de morph. Se exige preservar normal/UV cuando existen y ahorrar al menos un 10 % de triángulos antes de aceptar un resultado.
- El mismo mesh y las mismas capas/escena/cámara/materiales siguen usándose. Las superposiciones de malla poligonal referencian la geometría activa sin duplicar personajes.
- La descarga técnica del diagnóstico puede incluir `lodMeshes` y `lodTrianglesSaved` como contadores agregados, **nunca** imágenes, expediente, peso o estatura.

## Pruebas y evidencia

Última CI confirmada: [GitHub Actions #44548865511](https://github.com/erosCordova/bodyvision-ai/actions/runs/44548865511), con **125 pruebas aprobadas**: 50 backend, 50 frontend y 25 navegador. Arranque limpio Docker aprobado.

La regresión de navegador `fluid quality builds a true geometric LOD and restores the original anatomical mesh in high quality` comprueba contra el atlas remoto con versión fijada que:

1. El modo Fluida obtiene al menos una malla realmente simplificada.
2. El visor mantiene un único canvas y un solo atlas anatómico.
3. Al regresar a Alta no queda ninguna malla de detalle reducido activa.

La prueba unitaria de geometría demuestra reducción de polígonos en una esfera indexada sin perder normales, UV ni modificar la geometría fuente. Las pruebas anteriores siguen cubriendo malla, simulación de peso, estatura, comparación y análisis local.

## Límites y pendientes

Este LOD es **geométrico**, distinto del presupuesto temporal de píxeles aplicado durante gestos. No se ha demostrado todavía incremento de FPS ni reducción de tiempo GPU. Simplificar en el hilo principal tiene un coste de preparación que debe medirse en móviles modestos; antes de uso de producción se recomienda precalcular variantes, o trasladar su generación a un worker y evaluar memoria/energía/temperatura.

El resultado no supone validación anatómica, precisión clínica, fidelidad morfológica para diferentes pesos/estaturas ni pruebas con teléfonos físicos. Deben evaluarse estos extremos y mantener visible el carácter ilustrativo de las modificaciones corporales.
