import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoseReview } from "../src/features/capture/PoseReview";
import { createPoseInferenceSession, detectPoseOnDevice, diagnosePoseOnDevice } from "../src/features/capture/poseInference";
import type { CaptureReview } from "../src/features/capture/captureQuality";
import type { PoseEstimate } from "../src/features/capture/poseInference";

vi.mock("../src/features/capture/poseInference", () => ({
  detectPoseOnDevice: vi.fn(),
  createPoseInferenceSession: vi.fn(),
  diagnosePoseOnDevice: vi.fn(),
  POSE_EDGES: [],
  POSE_MODEL_VERSION: "synthetic-only-model",
  POSE_SDK_VERSION: "synthetic-only-sdk",
}));

const review: CaptureReview = {
  width: 900, height: 1200, averageBrightness: 128, contrast: 46, passed: true,
  checks: [
    { id: "resolution", label: "Resolución", passed: true, detail: "OK" },
    { id: "illumination", label: "Iluminación", passed: true, detail: "OK" },
    { id: "contrast", label: "Contraste", passed: true, detail: "OK" },
    { id: "orientation", label: "Orientación", passed: true, detail: "OK" },
  ],
};
const notFound: PoseEstimate = {
  found: false, landmarks: [], visiblePoints: 0, fullBodyReview: false,
  model: "synthetic-only-model",
};
function pendingSession() {
  let resolve!: (session: { detect: () => PoseEstimate; release: () => void }) => void;
  const promise = new Promise<{ detect: () => PoseEstimate; release: () => void }>(
    res => { resolve = res; },
  );
  return { promise, resolve };
}
beforeEach(() => {
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, {
    createObjectURL: vi.fn(() => "blob:synthetic-benchmark"),
    revokeObjectURL: vi.fn(),
  }));
  vi.mocked(detectPoseOnDevice).mockReset();
  vi.mocked(createPoseInferenceSession).mockReset();
  vi.mocked(diagnosePoseOnDevice).mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("five-run synthetic benchmark UI", () => {
  it("requires explicit synthetic-image confirmation and reports only in-memory results", async () => {
    vi.mocked(detectPoseOnDevice).mockResolvedValue(notFound);
    const detect = vi.fn(() => notFound);
    const release = vi.fn();
    vi.mocked(createPoseInferenceSession).mockResolvedValue({ detect, release });
    const image = new File(["fictional"], "synthetic.png", { type: "image/png" });
    render(<PoseReview file={image} review={review} />);
    expect(screen.queryByRole("region", { name: "Evaluación repetible de rendimiento de pose" }))
      .not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    await screen.findByText("No se detectó una pose humana.");
    const start = screen.getByRole("button", { name: "Medir rendimiento (5 repeticiones)" });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que esta imagen es ficticia/ }));
    expect(start).toBeEnabled();
    fireEvent.click(start);
    await waitFor(() => expect(detect).toHaveBeenCalledTimes(5));
    expect(detectPoseOnDevice).toHaveBeenCalledOnce();
    expect(createPoseInferenceSession).toHaveBeenCalledOnce();
    expect(createPoseInferenceSession).toHaveBeenCalledWith(image);
    expect(release).toHaveBeenCalledOnce();
    const report = await screen.findByLabelText("Resumen de rendimiento local");
    expect(report).toHaveTextContent("Ejecuciones completadas: 5/5");
    expect(report).toHaveTextContent("Errores: 0");
    expect(report).toHaveTextContent("Poses detectadas: 0");
    expect(report).toHaveTextContent("P95:");
    expect(screen.getByRole("button", { name: "Medir rendimiento (5 repeticiones)" }))
      .toBeEnabled();
    expect(detectPoseOnDevice).toHaveBeenLastCalledWith(image);
  });

  it("allows canceling a running evaluation and drops late image inference", async () => {
    const stalled = pendingSession();
    const detect = vi.fn(() => notFound);
    const release = vi.fn();
    vi.mocked(detectPoseOnDevice).mockResolvedValueOnce(notFound);
    vi.mocked(createPoseInferenceSession).mockReturnValueOnce(stalled.promise);
    render(<PoseReview file={new File(["fictional"], "synthetic.png", { type: "image/png" })}
      review={review} />);
    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    await screen.findByText("No se detectó una pose humana.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que esta imagen es ficticia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Medir rendimiento (5 repeticiones)" }));
    await waitFor(() => expect(createPoseInferenceSession).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Cancelar prueba" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Prueba cancelada");
    await act(async () => {
      stalled.resolve({ detect, release });
      await stalled.promise;
    });
    await waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(detect).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Resumen de rendimiento local")).not.toBeInTheDocument();
    expect(detectPoseOnDevice).toHaveBeenCalledOnce();
  });

  it("shows separate technical stages and optional JS heap only after explicit consent", async () => {
    vi.mocked(detectPoseOnDevice).mockResolvedValue(notFound);
    vi.mocked(diagnosePoseOnDevice).mockResolvedValue({
      validationMs: 1, preparationMs: 20, modelWaitMs: 4,
      inferenceMs: 50, cleanupMs: 1, totalMs: 76,
      modelCachedAtStart: true, detected: false,
      jsHeapBeforeBytes: null, jsHeapAfterBytes: null,
    });
    const image = new File(["fictional"], "test.png", { type: "image/png" });
    render(<PoseReview file={image} review={review} />);
    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    await screen.findByText("No se detectó una pose humana.");
    const button = screen.getByRole("button", { name: "Diagnosticar etapas (1 ejecución)" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que esta imagen es ficticia/ }));
    fireEvent.click(button);
    const report = await screen.findByLabelText("Etapas de inferencia local");
    expect(diagnosePoseOnDevice).toHaveBeenCalledOnce();
    expect(diagnosePoseOnDevice).toHaveBeenCalledWith(image);
    expect(report).toHaveTextContent("Preparación de imagen:");
    expect(report).toHaveTextContent("Inferencia:");
    expect(report).toHaveTextContent("Heap JavaScript antes: No disponible");
    expect(report).toHaveTextContent("Heap JavaScript después: No disponible");
  });

  it("discards a canceled late technical diagnosis instead of showing stale image timings", async () => {
    vi.mocked(detectPoseOnDevice).mockResolvedValue(notFound);
    let resolve!: (result: Awaited<ReturnType<typeof diagnosePoseOnDevice>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof diagnosePoseOnDevice>>>(
      done => { resolve = done; },
    );
    vi.mocked(diagnosePoseOnDevice).mockReturnValue(pending);
    render(<PoseReview file={new File(["fictional"], "test.png", { type: "image/png" })}
      review={review} />);
    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    await screen.findByText("No se detectó una pose humana.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que esta imagen es ficticia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Diagnosticar etapas (1 ejecución)" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar diagnóstico" }));
    await act(async () => {
      resolve({
        validationMs: 1, preparationMs: 3, modelWaitMs: 2,
        inferenceMs: 5, cleanupMs: 1, totalMs: 12,
        modelCachedAtStart: true, detected: false,
        jsHeapBeforeBytes: null, jsHeapAfterBytes: null,
      });
      await pending;
    });
    expect(screen.queryByLabelText("Etapas de inferencia local")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Diagnóstico cancelado");
  });
});
