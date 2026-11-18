import { useEffect, useRef, useState } from "react";
import { initialShape } from "../viewer/bodyShape";

/**
 * Reuses the licensed, textured MakeHuman/MPFB body already shipped by BODYVISION.
 * No SVG silhouette or duplicate proxy figure is rendered in the dashboard.
 */
export function DashboardBodyPreview() {
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("Preparando modelo humano…");

  useEffect(() => {
    const abort = new AbortController();
    const element = host.current;
    if (!element) return;
    let release: (() => void) | undefined;

    const start = async () => {
      const { createBodyScene } = await import("../viewer/BodyScene");
      if (abort.signal.aborted) return;
      const scene = await createBodyScene(
        element,
        abort.signal,
        message => { if (!abort.signal.aborted) setProgress(message); },
        message => { if (!abort.signal.aborted) setError(message); },
      );
      release = scene.cleanup;
      if (abort.signal.aborted) {
        scene.cleanup();
        return;
      }
      scene.apply({
        shape: initialShape,
        wireframe: false,
        rotate: false,
        view: "perspective",
      });
      scene.setView("perspective");
      setLoaded(true);
    };

    void start().catch(() => {
      if (!abort.signal.aborted) setError("No se pudo cargar la vista previa 3D.");
    });
    return () => {
      abort.abort();
      release?.();
    };
  }, []);

  return (
    <div className="enterprise-realbody-preview" data-loaded={loaded && !error}>
      <div ref={host} className="enterprise-realbody-canvas" />
      <div className="enterprise-realbody-tag">MODELO HUMANO 3D</div>
      <div className="enterprise-realbody-foot">MakeHuman / MPFB · superficie con textura realista</div>
      {!loaded && (
        <div className="enterprise-realbody-status" role={error ? "alert" : "status"}>
          <strong>{error ? "Vista previa no disponible" : "Cargando figura humana"}</strong>
          <span>{error || progress}</span>
        </div>
      )}
    </div>
  );
}
