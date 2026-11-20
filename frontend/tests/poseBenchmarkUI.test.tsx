import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoseReview } from "../src/features/capture/PoseReview";
import { detectPoseOnDevice } from "../src/features/capture/poseInference";
import type { CaptureReview } from "../src/features/capture/captureQuality";
import type { PoseEstimate } from "../src/features/capture/poseInference";

vi.mock("../src/features/capture/poseInference", () => ({
  detectPoseOnDevice: vi.fn(),
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
function pendingPose() {
  let resolve!: (pose: PoseEstimate) => void;
  const promise = new Promise<PoseEstimate>(res => { resolve = res; });
  return { promise, resolve };
}
beforeEach(() => {
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, {
    createObjectURL: vi.fn(() => "blob:synthetic-benchmark"),
    revokeObjectURL: vi.fn(),
  }));
  vi.mocked(detectPoseOnDevice).mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("five-run synthetic benchmark UI", () => {
  it("requires explicit synthetic-image confirmation and reports only in-memory results", async () => {
    vi.mocked(detectPoseOnDevice).mockResolvedValue(notFound);
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
    await waitFor(() => expect(detectPoseOnDevice).toHaveBeenCalledTimes(6));
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
    const stalled = pendingPose();
    vi.mocked(detectPoseOnDevice)
      .mockResolvedValueOnce(notFound)
      .mockReturnValueOnce(stalled.promise);
    render(<PoseReview file={new File(["fictional"], "synthetic.png", { type: "image/png" })}
      review={review} />);
    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    await screen.findByText("No se detectó una pose humana.");
    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que esta imagen es ficticia/ }));
    fireEvent.click(screen.getByRole("button", { name: "Medir rendimiento (5 repeticiones)" }));
    await waitFor(() => expect(detectPoseOnDevice).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar prueba" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Prueba cancelada");
    await act(async () => { stalled.resolve(notFound); await stalled.promise; });
    expect(screen.queryByLabelText("Resumen de rendimiento local")).not.toBeInTheDocument();
    expect(detectPoseOnDevice).toHaveBeenCalledTimes(2);
  });
});
