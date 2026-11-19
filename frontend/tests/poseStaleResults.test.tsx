import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PoseReview } from "../src/features/capture/PoseReview";
import { detectPoseOnDevice } from "../src/features/capture/poseInference";
import type { CaptureReview } from "../src/features/capture/captureQuality";
import type { PoseEstimate } from "../src/features/capture/poseInference";

vi.mock("../src/features/capture/poseInference", () => ({
  detectPoseOnDevice: vi.fn(),
  POSE_EDGES: [],
  POSE_MODEL_VERSION: "synthetic-test-pose",
  POSE_SDK_VERSION: "synthetic-test-sdk",
}));

const review: CaptureReview = {
  width: 800, height: 1100, averageBrightness: 125, contrast: 40,
  passed: true,
  checks: [
    { id: "resolution", label: "Resolución", passed: true, detail: "OK" },
    { id: "illumination", label: "Iluminación", passed: true, detail: "OK" },
    { id: "contrast", label: "Contraste", passed: true, detail: "OK" },
    { id: "orientation", label: "Encuadre vertical", passed: true, detail: "OK" },
  ],
};
const noHuman: PoseEstimate = {
  found: false, landmarks: [], visiblePoints: 0, fullBodyReview: false,
  model: "synthetic-test-pose",
};
const person: PoseEstimate = {
  found: true, landmarks: Array.from({ length: 33 }, () => ({
    x: 0.5, y: 0.5, z: 0, visibility: 0.95,
  })),
  visiblePoints: 33, fullBodyReview: true,
  model: "synthetic-test-pose",
};
function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  const NativeURL = URL;
  vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, {
    createObjectURL: vi.fn(() => "blob:synthetic-pose"),
    revokeObjectURL: vi.fn(),
  }));
  vi.mocked(detectPoseOnDevice).mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local pose review isolation", () => {
  it("never applies an old photograph's late pose result to a replacement image", async () => {
    const older = deferred<PoseEstimate>();
    const newer = deferred<PoseEstimate>();
    vi.mocked(detectPoseOnDevice)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    const firstFile = new File(["image1"], "first.png", { type: "image/png" });
    const secondFile = new File(["image2"], "second.png", { type: "image/png" });
    const view = render(<PoseReview file={firstFile} review={review} />);
    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    expect(detectPoseOnDevice).toHaveBeenCalledWith(firstFile);
    view.rerender(<PoseReview file={secondFile} review={review} />);
    expect(screen.getByRole("button", { name: "Detectar pose con IA" })).toBeEnabled();

    await act(async () => { older.resolve(person); await older.promise; });
    expect(screen.queryByText("Pose detectada.")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Puntos corporales detectados por el modelo" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    expect(detectPoseOnDevice).toHaveBeenCalledWith(secondFile);
    await act(async () => { newer.resolve(noHuman); await newer.promise; });
    expect(screen.getByText("No se detectó una pose humana.")).toBeInTheDocument();
  });

  it("ignores both successful and failed inference after unmount", async () => {
    const old = deferred<PoseEstimate>();
    vi.mocked(detectPoseOnDevice).mockReturnValue(old.promise);
    const view = render(
      <PoseReview file={new File(["image"], "test.png", { type: "image/png" })} review={review} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    view.unmount();
    await act(async () => { old.resolve(person); await old.promise; });
    expect(screen.queryByText("Pose detectada.")).not.toBeInTheDocument();

    const aborted = deferred<PoseEstimate>();
    vi.mocked(detectPoseOnDevice).mockReturnValue(aborted.promise);
    const later = render(
      <PoseReview file={new File(["image"], "later.png", { type: "image/png" })} review={review} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Detectar pose con IA" }));
    later.unmount();
    await act(async () => {
      aborted.reject(new Error("Synthetic detector rejected after unmount"));
      await aborted.promise.catch(() => {});
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
