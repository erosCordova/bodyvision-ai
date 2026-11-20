import { useEffect, useRef, useState } from "react";
import {
  detectPoseOnDevice, POSE_EDGES, POSE_MODEL_VERSION,
  POSE_SDK_VERSION, type PoseEstimate,
} from "./poseInference";
import { assessPoseQuality, isPosePointVisible } from "./poseQuality";
import { formatLocalPoseDuration, localPoseLatencyGuidance } from "./poseLatency";
import type { CaptureReview } from "./captureQuality";
import "./pose-review.css";

type PoseState = "idle" | "running" | "ready" | "failed";

export function PoseReview({ file, review }: { file: File; review: CaptureReview }) {
  const alive = useRef(true);
  const requestSequence = useRef(0);
  const [imageUrl, setImageUrl] = useState("");
  const [state, setState] = useState<PoseState>("idle");
  const [estimate, setEstimate] = useState<PoseEstimate | null>(null);
  const [failure, setFailure] = useState("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [visibilityThreshold, setVisibilityThreshold] = useState(0.5);
  const [showPoints, setShowPoints] = useState(true);
  const [showConnections, setShowConnections] = useState(true);

  useEffect(() => {
    alive.current = true;
    // Any in-flight pose estimate belongs only to the image that started it.
    requestSequence.current += 1;
    setState("idle");
    setEstimate(null);
    setFailure("");
    setElapsedMs(null);
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => {
      alive.current = false;
      requestSequence.current += 1;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const run = async () => {
    const requestId = ++requestSequence.current;
    const inputFile = file;
    setState("running");
    setFailure("");
    setEstimate(null);
    setElapsedMs(null);
    const start = performance.now();
    try {
      const pose = await detectPoseOnDevice(inputFile);
      if (!alive.current || requestId !== requestSequence.current) return;
      setEstimate(pose);
      setElapsedMs(Math.max(0, performance.now() - start));
      setState("ready");
    } catch {
      if (!alive.current || requestId !== requestSequence.current) return;
      setState("failed");
      setFailure(
        "No se pudo ejecutar el detector local. Comprueba que esta versión incluya los archivos verificados, " +
        "la compatibilidad de WebAssembly y vuelve a intentarlo. La imagen no se ha enviado a la API.",
      );
    }
  };
  const quality = state === "ready" && estimate
    ? assessPoseQuality(estimate, review, visibilityThreshold) : null;
  const showSkeleton = state === "ready" && estimate?.found === true;
  const displayedPoint = (index: number) =>
    isPosePointVisible(estimate?.landmarks[index], visibilityThreshold);

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
        Motor y modelo incluidos en esta versión de BODYVISION. SDK {POSE_SDK_VERSION},
        modelo {POSE_MODEL_VERSION}; ejecución local con CPU, sin guardar imágenes ni coordenadas.
        Utiliza únicamente fotografías ficticias para esta demostración.
      </p>
      {state === "running" && <p role="status">Cargando el modelo y procesando la fotografía localmente…</p>}
      {state === "ready" && elapsedMs !== null && <div className="enterprise-pose-privacy"
        role="status" aria-label="Duración de inferencia local">
        <strong>Tiempo total local: {formatLocalPoseDuration(elapsedMs)}.</strong>{" "}
        {localPoseLatencyGuidance(elapsedMs)} La medición incluye lectura, decodificación,
        carga del modelo si es la primera ejecución e inferencia; no se guarda ni se envía.
      </div>}
      {state === "failed" && <p role="alert" className="enterprise-pose-error">{failure}</p>}
      {state === "ready" && estimate && quality && (
        <div className="enterprise-pose-result" aria-live="polite">
          {estimate.found ? (
            <>
              <p><strong>Pose detectada.</strong> {quality.visiblePoints} de 33 puntos
                visibles con umbral {visibilityThreshold.toFixed(2).replace(".", ",")}.</p>
              <p>{quality.coreVisible} de {quality.coreTotal} puntos clave visibles
                en hombros, caderas, rodillas y tobillos.</p>
              <p>{quality.state === "reviewable"
                ? "Puntos y condiciones suficientes para una revisión visual experimental."
                : "Hay limitaciones de visibilidad o captura; revisa el detalle antes de interpretar la imagen."}</p>
            </>
          ) : <p><strong>No se detectó una pose humana.</strong> Prueba con una
            fotografía ficticia de cuerpo completo, bien iluminada y sin obstáculos.</p>}
          <div className="enterprise-pose-quality" aria-label="Indicadores de revisión de pose">
            <strong>Resultado técnico: {quality.label}</strong>
            <small>Indicador heurístico de visibilidad y encuadre; no es precisión ni
              probabilidad diagnóstica de la IA.</small>
            {quality.warnings.length > 0 && <ul aria-label="Advertencias de pose">
              {quality.warnings.map((warning, index) => <li key={index}>{warning}</li>)}
            </ul>}
          </div>
          {estimate.found && <div className="enterprise-pose-groups" role="list"
            aria-label="Visibilidad por zonas corporales">
            {quality.groups.map(group => <div role="listitem" key={group.id}
              className={"enterprise-pose-group state-" + group.state}>
              <span>{group.label}</span>
              <strong>{group.visible}/{group.total}</strong>
              <small>{group.state === "visible" ? "Visible" :
                group.state === "partial" ? "Parcial" : "No visible"}</small>
            </div>)}
          </div>}
        </div>
      )}
      {showSkeleton && <div className="enterprise-pose-controls" role="group"
        aria-label="Ajustes de superposición de pose">
        <label>
          <span>Umbral de visibilidad: {visibilityThreshold.toFixed(2).replace(".", ",")}</span>
          <input type="range" min="0.3" max="0.9" step="0.05"
            aria-label="Umbral de visibilidad de landmarks"
            value={visibilityThreshold}
            onChange={event => setVisibilityThreshold(Number(event.target.value))}/>
        </label>
        <label><input type="checkbox" checked={showPoints}
          onChange={event => setShowPoints(event.target.checked)}/> Mostrar puntos detectados</label>
        <label><input type="checkbox" checked={showConnections}
          onChange={event => setShowConnections(event.target.checked)}/> Mostrar conexiones</label>
      </div>}
      <div className="enterprise-pose-photo" style={{ aspectRatio: `${review.width} / ${review.height}` }}>
        {imageUrl && <img src={imageUrl} alt="Fotografía local utilizada únicamente para la revisión de pose"/>}
        {showSkeleton && (showPoints || showConnections) && (
          <svg viewBox={`0 0 ${review.width} ${review.height}`}
            aria-label="Puntos corporales detectados por el modelo" role="img">
            {showConnections && <g stroke="#65e5f8"
              strokeWidth={Math.max(2, Math.min(review.width, review.height) * 0.004)}
              strokeLinecap="round">
              {POSE_EDGES.filter(([a, b]) => displayedPoint(a) && displayedPoint(b))
                .map(([a, b]) => {
                  const first = estimate!.landmarks[a];
                  const second = estimate!.landmarks[b];
                  return <line key={a + "-" + b}
                    x1={first.x * review.width} y1={first.y * review.height}
                    x2={second.x * review.width} y2={second.y * review.height}/>;
                })}
            </g>}
            {showPoints && <g fill="#fff6b1" stroke="#034057"
              strokeWidth={Math.max(1, Math.min(review.width, review.height) * 0.0017)}>
              {estimate!.landmarks.map((point, index) => displayedPoint(index) ?
                <circle key={index} cx={point.x * review.width} cy={point.y * review.height}
                  r={Math.max(3, Math.min(review.width, review.height) * 0.006)}/> : null)}
            </g>}
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
