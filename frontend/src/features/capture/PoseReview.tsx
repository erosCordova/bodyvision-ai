import { useEffect, useRef, useState } from "react";
import {
  detectPoseOnDevice, POSE_EDGES, POSE_MODEL_VERSION,
  POSE_SDK_VERSION, type PoseEstimate,
} from "./poseInference";
import type { CaptureReview } from "./captureQuality";
import "./pose-review.css";

type PoseState = "idle" | "running" | "ready" | "failed";
const VISIBLE_THRESHOLD = 0.5;

export function PoseReview({ file, review }: { file: File; review: CaptureReview }) {
  const alive = useRef(true);
  const [imageUrl, setImageUrl] = useState("");
  const [state, setState] = useState<PoseState>("idle");
  const [estimate, setEstimate] = useState<PoseEstimate | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    alive.current = true;
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => {
      alive.current = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const run = async () => {
    setState("running");
    setFailure("");
    setEstimate(null);
    try {
      const pose = await detectPoseOnDevice(file);
      if (!alive.current) return;
      setEstimate(pose);
      setState("ready");
    } catch {
      if (!alive.current) return;
      setState("failed");
      setFailure(
        "No se pudo ejecutar el detector local. Comprueba la conexión para descargar el modelo, " +
        "la compatibilidad de WebAssembly y vuelve a intentarlo. La imagen no se ha enviado a la API.",
      );
    }
  };
  const showSkeleton = state === "ready" && estimate?.found === true;
  const displayedPoint = (index: number) => {
    const point = estimate?.landmarks[index];
    return point && point.visibility >= VISIBLE_THRESHOLD &&
      point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
  };

  return (
    <section className="enterprise-pose-review" aria-label="Estimación local de pose con IA">
      <div className="enterprise-pose-review-head">
        <div>
          <span className="eyebrow">IA REAL · INFERENCIA EN EL NAVEGADOR</span>
          <h3>MediaPipe Pose Landmarker</h3>
          <p>Detecta hasta 33 puntos de una persona sobre la fotografía cargada, sin enviar
            sus píxeles al servidor. Este resultado no es una medición ni un diagnóstico.</p>
        </div>
        <button type="button" className="primary-button"
          disabled={state === "running"} onClick={() => void run()}>
          {state === "running" ? "Analizando imagen…" :
            state === "ready" ? "Repetir detección" : "Detectar pose con IA"}
        </button>
      </div>
      <p className="enterprise-pose-privacy">
        Descarga inicial de software y pesos: requiere internet. Versión SDK {POSE_SDK_VERSION},
        modelo {POSE_MODEL_VERSION}; ejecución local con CPU, sin guardar imágenes ni coordenadas.
        Utiliza únicamente fotografías ficticias para esta demostración.
      </p>
      {state === "running" && <p role="status">Cargando el modelo y procesando la fotografía localmente…</p>}
      {state === "failed" && <p role="alert" className="enterprise-pose-error">{failure}</p>}
      {state === "ready" && estimate && (
        <div className="enterprise-pose-result" aria-live="polite">
          {estimate.found ? (
            <>
              <p><strong>Pose detectada.</strong> {estimate.visiblePoints} de 33 puntos
                visibles con umbral 0,50.</p>
              <p>{estimate.fullBodyReview
                ? "Hombros, caderas, rodillas y tobillos visibles en la imagen."
                : "Revisa el encuadre: pueden faltar articulaciones del cuerpo completo."}</p>
              {!review.passed && <p>La foto contiene advertencias técnicas de calidad;
                interpreta estos puntos con mayor cautela.</p>}
            </>
          ) : <p><strong>No se detectó una pose humana.</strong> Prueba con una
            fotografía ficticia de cuerpo completo, bien iluminada y sin obstáculos.</p>}
        </div>
      )}
      <div className="enterprise-pose-photo" style={{ aspectRatio: `${review.width} / ${review.height}` }}>
        {imageUrl && <img src={imageUrl} alt="Fotografía local utilizada únicamente para la revisión de pose"/>}
        {showSkeleton && (
          <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Puntos corporales detectados por el modelo" role="img">
            <g stroke="#65e5f8" strokeWidth="0.004" strokeLinecap="round">
              {POSE_EDGES.filter(([a, b]) => displayedPoint(a) && displayedPoint(b))
                .map(([a, b]) => {
                  const first = estimate!.landmarks[a];
                  const second = estimate!.landmarks[b];
                  return <line key={a + "-" + b}
                    x1={first.x} y1={first.y} x2={second.x} y2={second.y}/>;
                })}
            </g>
            <g fill="#fff6b1" stroke="#034057" strokeWidth="0.0017">
              {estimate!.landmarks.map((point, index) => displayedPoint(index) ?
                <circle key={index} cx={point.x} cy={point.y} r="0.006"/> : null)}
            </g>
          </svg>
        )}
      </div>
      {state === "idle" && <p className="enterprise-pose-idle">
        Selecciona «Detectar pose con IA» para iniciar el modelo real. La imagen no se
        analiza automáticamente ni se comparte.
      </p>}
      <p className="enterprise-pose-privacy">
        Verificación visual experimental, no clínica. No estima peso, estatura, IMC,
        grasa corporal ni identidad. No vincula esta fotografía a expedientes.
      </p>
    </section>
  );
}
