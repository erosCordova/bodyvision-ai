import { useEffect, useRef, useState } from "react";
import { createAnatomyScene, type AnatomicalLayer, type LayerOpacity } from "../viewer/AnatomyScene";

/**
 * The dashboard previews the exact same atlas skin mesh used in /body-3d.
 * Never load the retired MakeHuman/MPFB figure on this public surface.
 */
export function DashboardBodyPreview() {
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("Preparando modelo anatómico…");

  useEffect(() => {
    const element = host.current;
    if (!element) return;

    let release: (() => void) | undefined;
    try {
      const scene = createAnatomyScene(
        element,
        setProgress,
        () => {},
        (layer, state) => {
          if (layer !== "skin") return;
          if (state === "ready") { setLoaded(true); setError(""); }
          if (state === "error") setError("No se pudo cargar el modelo anatómico. Recarga la página para reintentar.");
        },
        setError,
      );
      release = scene.dispose;
      const opacity: LayerOpacity = {
        skin: 1,
        muscles: 1,
        skeleton: 1,
        arteries: 1,
        veins: 1,
        nerves: 1,
      };
      scene.update(new Set<AnatomicalLayer>(["skin"]), opacity);
      scene.setRenderMode("realista");
    } catch {
      setError("No se pudo iniciar la vista previa 3D. Comprueba la aceleración gráfica.");
    }
    return () => release?.();
  }, []);

  return (
    <div className="enterprise-realbody-preview" data-loaded={loaded && !error}>
      <div ref={host} className="enterprise-realbody-canvas" />
      <div className="enterprise-realbody-tag">MODELO ANATÓMICO 3D</div>
      <div className="enterprise-realbody-foot">Mismo cuerpo 3D que el visor anatómico</div>
      {!loaded && (
        <div className="enterprise-realbody-status" role={error ? "alert" : "status"}>
          <strong>{error ? "Vista previa no disponible" : "Cargando figura humana"}</strong>
          <span>{error || progress}</span>
        </div>
      )}
    </div>
  );
}
