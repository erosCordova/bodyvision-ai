/** Ephemeral, same-tab transfer; never store raw photos in history, web storage or API. */
import type { CaptureReview } from "./captureQuality";

export type StagedCapture = { file: File; review: CaptureReview };
let staged: StagedCapture | null = null;

export function stageCaptureForAnalysis(file: File, review: CaptureReview): void {
  staged = { file, review };
}
export function peekCaptureForAnalysis(): StagedCapture | null {
  return staged;
}
export function consumeCaptureForAnalysis(): StagedCapture | null {
  const captured = staged;
  staged = null;
  return captured;
}
export function discardStagedCapture(): void {
  staged = null;
}
