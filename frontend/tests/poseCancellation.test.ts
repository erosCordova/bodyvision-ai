import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPoseInferenceSession, detectPoseOnDevice, diagnosePoseOnDevice } from "../src/features/capture/poseInference";
import { validatePoseImageFile } from "../src/features/capture/poseInputValidation";
import { preparePoseFrame } from "../src/features/capture/poseFrame";

// Stop stale work at genuine asynchronous I/O/bitmap boundaries, without
// importing MediaPipe or loading images from disk into the unit tests.
vi.mock("../src/features/capture/poseInputValidation", () => ({
  validatePoseImageFile: vi.fn(),
}));
vi.mock("../src/features/capture/poseFrame", () => ({
  preparePoseFrame: vi.fn(),
}));

const file = new File(["fictional-only"], "ficticio.png", { type: "image/png" });

beforeEach(() => {
  vi.mocked(validatePoseImageFile).mockReset();
  vi.mocked(preparePoseFrame).mockReset();
  vi.mocked(validatePoseImageFile).mockResolvedValue(undefined);
});

describe("cancel obsolete MediaPipe work before synchronous detection", () => {
  it("does not even validate an image when the UI request is already obsolete", async () => {
    await expect(createPoseInferenceSession(file, () => false))
      .rejects.toThrow(/ya no está activo/);
    expect(validatePoseImageFile).not.toHaveBeenCalled();
    expect(preparePoseFrame).not.toHaveBeenCalled();
  });

  it("avoids image decode if cancellation happens while validating a header", async () => {
    let active = true;
    vi.mocked(validatePoseImageFile).mockImplementation(async () => { active = false; });
    await expect(createPoseInferenceSession(file, () => active))
      .rejects.toThrow(/ya no está activo/);
    expect(validatePoseImageFile).toHaveBeenCalledOnce();
    expect(preparePoseFrame).not.toHaveBeenCalled();
  });

  it("releases prepared pixels and skips MediaPipe when a file changes during decode", async () => {
    let active = true;
    const release = vi.fn();
    vi.mocked(preparePoseFrame).mockImplementation(async () => {
      active = false;
      return { canvas: document.createElement("canvas"), release };
    });
    await expect(createPoseInferenceSession(file, () => active))
      .rejects.toThrow(/ya no está activo/);
    expect(preparePoseFrame).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("applies the same abort guard to one-shot detection", async () => {
    await expect(detectPoseOnDevice(file, () => false))
      .rejects.toThrow(/ya no está activo/);
    expect(validatePoseImageFile).not.toHaveBeenCalled();
    expect(preparePoseFrame).not.toHaveBeenCalled();
  });

  it("closes its image canvas if a technical diagnosis is canceled during preparation", async () => {
    let active = true;
    const release = vi.fn();
    vi.mocked(preparePoseFrame).mockImplementation(async () => {
      active = false;
      return { canvas: document.createElement("canvas"), release };
    });
    await expect(diagnosePoseOnDevice(file, () => active))
      .rejects.toThrow(/ya no está activo/);
    expect(release).toHaveBeenCalledOnce();
  });
});
