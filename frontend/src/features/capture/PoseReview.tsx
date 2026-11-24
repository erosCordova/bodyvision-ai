import { useEffect, useRef, useState } from "react";
import {
  createPoseInferenceSession, detectPoseOnDevice, diagnosePoseOnDevice, poseFailureMessage, POSE_EDGES,
  POSE_MODEL_VERSION, POSE_SDK_VERSION, type PoseEstimate,
} from "./poseInference";
import { assessPoseQuality, isPosePointVisible } from "./poseQuality";
import { formatLocalPoseDuration, localPoseLatencyGuidance } from "./poseLatency";
import {
  POSE_BENCHMARK_RUNS, runPreparedPoseBenchmark, type LocalPoseBenchmark,
} from "./poseDeviceBenchmark";
import type { CaptureReview } from "./captureQuality";
import type { PoseLocalDiagnostic } from "./poseDiagnostics";
import { downloadSyntheticPosePerformanceReport } from "./posePerformanceReport";
import { downloadSyntheticPoseReviewReport } from "./poseReviewReport";
import { privateAuthEnabled } from "../../app/providers/PrivateAuthProvider";
import { PoseSummaryArchive } from "./PoseSummaryArchive";
import "./pose-review.css";

type PoseState = "idle" | "running" | "ready" | "failed";

export function PoseReview({ file, review, autoRun=false }: { file: File; review: CaptureReview; autoRun?:boolean }) {
  const alive = useRef(true);
  const requestSequence = useRef(0);
  // Prevent repeated taps from allocating overlapping MediaPipe input sessions.
  const poseInFlight = useRef<number | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [state, setState] = useState<PoseState>("idle");
  const [analysisSerial, setAnalysisSerial] = useState(0);
  const [estimate, setEstimate] = useState<PoseEstimate | null>(null);
  const [failure, setFailure] = useState("");
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [benchmarkConfirmed, setBenchmarkConfirmed] = useState(false);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState(0);
  const [benchmarkResult, setBenchmarkResult] = useState<LocalPoseBenchmark | null>(null);
  const [benchmarkError, setBenchmarkError] = useState("");
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [diagnosticResult, setDiagnosticResult] = useState<PoseLocalDiagnostic | null>(null);
  const [diagnosticError, setDiagnosticError] = useState("");
  const [visibilityThreshold, setVisibilityThreshold] = useState(0.5);
  const [showPoints, setShowPoints] = useState(true);
  const [showConnections, setShowConnections] = useState(true);

  useEffect(() => {
    alive.current = true;
    // Any in-flight pose estimate belongs only to the image that started it.
    requestSequence.current += 1;
    poseInFlight.current = null;
    setState("idle");
    setEstimate(null);
    setFailure("");
    setElapsedMs(null);
    setBenchmarkConfirmed(false);
    setBenchmarkRunning(false);
    setBenchmarkProgress(0);
    setBenchmarkResult(null);
    setBenchmarkError("");
    setDiagnosticRunning(false);
    setDiagnosticResult(null);
    setDiagnosticError("");
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => {
      alive.current = false;
      requestSequence.current += 1;
      poseInFlight.current = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const run = async () => {
    if (poseInFlight.current !== null || benchmarkRunning || diagnosticRunning) return;
    const requestId = ++requestSequence.current;
    poseInFlight.current = requestId;
    const inputFile = file;
    const current = () => alive.current && requestId === requestSequence.current;
    setState("running");
    setFailure("");
    setEstimate(null);
    setElapsedMs(null);
    setBenchmarkResult(null);
    setBenchmarkProgress(0);
    setBenchmarkError("");
    setDiagnosticResult(null);
    setDiagnosticError("");
    const start = performance.now();
    try {
      const pose = await detectPoseOnDevice(inputFile, current);
      if (!alive.current || requestId !== requestSequence.current) return;
      setEstimate(pose);
      setAnalysisSerial(previous => previous + 1);
      setElapsedMs(Math.max(0, performance.now() - start));
      setState("ready");
    } catch (cause) {
      if (!alive.current || requestId !== requestSequence.current) return;
      setState("failed");
      setFailure(poseFailureMessage(cause));
    } finally {
      // Do not release a newer photograph's lock when an old request settles.
      if (poseInFlight.current === requestId) poseInFlight.current = null;
    }
  };
  useEffect(()=>{if(!autoRun)return;const timer=window.setTimeout(()=>void run(),0);return()=>window.clearTimeout(timer);},[file,autoRun]);
  const runBenchmark = async () => {
    if (!benchmarkConfirmed || benchmarkRunning || diagnosticRunning || state !== "ready") return;
    const requestId = ++requestSequence.current;
    const inputFile = file;
    const current = () => alive.current && requestId === requestSequence.current;
    setBenchmarkRunning(true);
    setBenchmarkResult(null);
    setBenchmarkProgress(0);
    setBenchmarkError("");
    try {
      const result = await runPreparedPoseBenchmark(
        () => createPoseInferenceSession(inputFile, current),
        current,
        completed => setBenchmarkProgress(completed),
        { yieldBeforeRun: () => new Promise<void>(resolve => window.setTimeout(resolve, 0)) },
      );
      if (current() && result) setBenchmarkResult(result);
    } catch {
      if (current()) setBenchmarkError("No se pudo completar la prueba local de rendimiento.");
    } finally {
      if (current()) setBenchmarkRunning(false);
    }
  };
  const cancelBenchmark = () => {
    requestSequence.current += 1;
    setBenchmarkRunning(false);
    setBenchmarkProgress(0);
    setBenchmarkResult(null);
    setBenchmarkError("Prueba cancelada. Se descartarán los resultados pendientes.");
  };
  const runDiagnostic = async () => {
    if (!benchmarkConfirmed || benchmarkRunning || diagnosticRunning || state !== "ready") return;
    const requestId = ++requestSequence.current;
    const inputFile = file;
    const current = () => alive.current && requestId === requestSequence.current;
    setDiagnosticRunning(true);
    setDiagnosticResult(null);
    setDiagnosticError("");
    try {
      const data = await diagnosePoseOnDevice(inputFile, current);
      if (alive.current && requestId === requestSequence.current) setDiagnosticResult(data);
    } catch {
      if (alive.current && requestId === requestSequence.current) {
        setDiagnosticError("No se pudo completar el diagnóstico técnico local.");
      }
    } finally {
      if (alive.current && requestId === requestSequence.current) setDiagnosticRunning(false);
    }
  };
  const cancelDiagnostic = () => {
    requestSequence.current += 1;
    setDiagnosticRunning(false);
    setDiagnosticResult(null);
    setDiagnosticError("Diagnóstico cancelado; se descartará el resultado pendiente.");
  };
  const elapsedLabel = (value: number | null) =>
    value === null ? "No disponible" : formatLocalPoseDuration(value);
  const heapLabel = (value: number | null) =>
    value === null ? "No disponible" : (value / 1024 / 1024).toFixed(1).replace(".", ",") + " MiB";
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
          disabled={state === "running" || benchmarkRunning || diagnosticRunning} onClick={() => void run()}>
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
      {state === "ready" && <section className="enterprise-pose-benchmark"
        aria-label="Evaluación repetible de rendimiento de pose">
        <h4>Evaluación de rendimiento en este dispositivo</h4>
        <p>Prepara una sola vez la imagen sintética y repite {POSE_BENCHMARK_RUNS}
          veces la inferencia local con el mismo lienzo. No vuelve a decodificar
          la fotografía en cada repetición. Solo mide este navegador;
          no guarda ni envía imágenes, resultados o tiempos.</p>
        <label><input type="checkbox" checked={benchmarkConfirmed}
          disabled={benchmarkRunning}
          onChange={event => setBenchmarkConfirmed(event.target.checked)}/>
          Confirmo que esta imagen es ficticia y autorizo las pruebas locales adicionales.
        </label>
        <button type="button" disabled={!benchmarkConfirmed || benchmarkRunning || diagnosticRunning}
          onClick={() => void runBenchmark()}>
          {benchmarkRunning ? "Midiendo rendimiento…" : "Medir rendimiento (5 repeticiones)"}
        </button>
        <div className="enterprise-pose-technical">
          <button type="button" disabled={!benchmarkConfirmed || benchmarkRunning || diagnosticRunning}
            onClick={() => void runDiagnostic()}>
            {diagnosticRunning ? "Diagnosticando etapas…" : "Diagnosticar etapas (1 ejecución)"}
          </button>
          {diagnosticRunning && <button type="button" onClick={cancelDiagnostic}>
            Cancelar diagnóstico
          </button>}
          {diagnosticError && <p role="alert">{diagnosticError}</p>}
          {diagnosticResult && <div aria-label="Etapas de inferencia local">
            <p><strong>Validación:</strong> {elapsedLabel(diagnosticResult.validationMs)}.
              {" "}<strong>Preparación de imagen:</strong> {elapsedLabel(diagnosticResult.preparationMs)}.
              {" "}<strong>Modelo listo:</strong> {elapsedLabel(diagnosticResult.modelWaitMs)}.
              {" "}<strong>Inferencia:</strong> {elapsedLabel(diagnosticResult.inferenceMs)}.
              {" "}<strong>Limpieza:</strong> {elapsedLabel(diagnosticResult.cleanupMs)}.
              {" "}<strong>Total:</strong> {elapsedLabel(diagnosticResult.totalMs)}.</p>
            <p>Motor ya en caché al inicio: {diagnosticResult.modelCachedAtStart ? "Sí" : "No"}.
              {" "}Detección de pose en este ensayo: {diagnosticResult.detected ? "Sí" : "No"}.</p>
            <p>Heap JavaScript antes: {heapLabel(diagnosticResult.jsHeapBeforeBytes)}.
              {" "}Heap JavaScript después: {heapLabel(diagnosticResult.jsHeapAfterBytes)}.</p>
            <small>La memoria mostrada, cuando existe, es solo heap JavaScript; no mide
              memoria física, WASM, GPU ni consumo máximo. No permite calcular
              ahorro de RAM y puede no estar disponible. Resultado efímero,
              exclusivamente de este navegador; no se envía ni se guarda.</small>
          </div>}
        </div>
        {(benchmarkResult || diagnosticResult) && benchmarkConfirmed && (
          <div className="enterprise-pose-report" aria-label="Informe técnico local">
            <button type="button"
              disabled={benchmarkRunning || diagnosticRunning || state !== "ready" || !estimate}
              onClick={() => {
                if (!estimate || state !== "ready" || !benchmarkConfirmed) return;
                downloadSyntheticPosePerformanceReport({
                  capture: review,
                  detected: estimate.found,
                  singleRunMs: elapsedMs,
                  benchmark: benchmarkResult,
                  diagnostic: diagnosticResult,
                });
              }}>
              Descargar informe técnico (JSON)
            </button>
            <small>Descarga manual en este dispositivo, sin fotografía, coordenadas,
              nombre del archivo ni identificadores personales. No se envía a la API.
              Los datos solo se guardan si eliges descargarlos; no certifica
              rendimiento de un teléfono físico ni calidad clínica.</small>
          </div>
        )}
        {benchmarkRunning && <>
          <button type="button" className="enterprise-pose-benchmark-cancel"
            onClick={cancelBenchmark}>Cancelar prueba</button>
          <p role="status">Pruebas completadas:
            {" "}{benchmarkProgress}/{POSE_BENCHMARK_RUNS}.</p>
        </>}
        {benchmarkError && <p role="alert">{benchmarkError}</p>}
        {benchmarkResult && <div className="enterprise-pose-benchmark-result"
          aria-label="Resumen de rendimiento local">
          <p><strong>Mediana:</strong> {benchmarkResult.medianMs === null
            ? "No disponible" : formatLocalPoseDuration(benchmarkResult.medianMs)}.
            {" "}<strong>P95:</strong> {benchmarkResult.p95Ms === null
              ? "No disponible" : formatLocalPoseDuration(benchmarkResult.p95Ms)}.</p>
          <p><strong>Ejecuciones completadas:</strong> {benchmarkResult.successful}/{benchmarkResult.attempts}.
            {" "}<strong>Errores:</strong> {benchmarkResult.failed}.
            {" "}<strong>Poses detectadas:</strong> {benchmarkResult.detected}.</p>
          <small>Medidas solo de inferencia con una imagen ya preparada, sin
            decodificación, preparación de lienzo ni carga del modelo en los tiempos.
            Con cinco muestras, el P95 es el tiempo más alto; no representa
            un valor garantizado ni precisión clínica. No se mide memoria ni temperatura.</small>
        </div>}
      </section>}
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
            <button type="button" className="enterprise-pose-review-download"
              onClick={() => downloadSyntheticPoseReviewReport({
                capture: review, pose: estimate, quality, threshold: visibilityThreshold,
              })}>
              Descargar resumen de revisión de pose (JSON)
            </button>
            <small>El resumen no contiene fotografía, coordenadas, nombres ni identificadores.</small>
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
      {privateAuthEnabled() && <PoseSummaryArchive runSerial={analysisSerial}
        summary={state === "ready" && estimate && quality ? {
          model_revision: POSE_MODEL_VERSION, detected: estimate.found,
          threshold: visibilityThreshold, visible_points: quality.visiblePoints,
          core_visible: quality.coreVisible, quality_state: quality.state, capture_passed: review.passed,
        } : null} />}
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
                <circle key={index} data-pose-index={index} cx={point.x * review.width} cy={point.y * review.height}
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
