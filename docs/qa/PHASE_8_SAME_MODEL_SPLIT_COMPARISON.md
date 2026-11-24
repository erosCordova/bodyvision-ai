# Fase 8 — comparación en vivo del mismo modelo 3D

El módulo Visión 3D permite una comparación gráfica dividida con una **única
instancia del atlas humano**, una sola cámara, materiales, selección y lienzo
WebGL. No se añade otro personaje ni se intercambia la anatomía.

Funcionamiento:

1. En **Simulación**, modifica la variación hipotética de peso y/o la estatura.
2. Pulsa **Comparar lado a lado**. La referencia original (175 cm y el peso de
   referencia configurado) ocupa la parte izquierda y el escenario modificado
   aparece en la derecha.
3. Mueve el separador (15–85 %) para inspeccionar distintas zonas. El mismo
   modelo se dibuja dos veces con recorte de WebGL `scissor`, alternando los
   valores de escala y volumen y restaurándolos inmediatamente después.
   La cámara y la posición se comparten para alinear ambos estados.
4. Cierra la comparación para tomar una captura de pose con MediaPipe:
   la vista dividida se bloquea expresamente para no confundir el detector
   con dos estados corporales.
5. El control previo de **Comparar con el original** sigue disponible para
   alternar estados completos, evitando conflictos mientras hay un separador
   activo.

Limitaciones: no se estiman tejidos reales ni pérdida/ganancia de grasa.
Las medidas, deformaciones y proporciones son **hipotéticas y educativas**.
El render dividido tiene dos pasadas GPU, por lo que puede ser más costoso
en móviles; se conserva la selección automática de calidad Alta/Fluida.
No se persisten fotografías, registros médicos ni simulaciones en servidor.

Validaciones automáticas: un único lienzo antes y después, cambios visuales
de la comparación y del separador, cambio de estatura, bloqueo de captura
dividida y restablecimiento del análisis al salir del modo.
