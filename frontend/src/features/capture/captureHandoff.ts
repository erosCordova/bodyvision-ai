/** Ephemeral, same-tab transfer; never store raw photos in history, web storage or API. */
import type { CaptureReview } from "./captureQuality";

export type StagedCapture = { file: File; review: CaptureReview };
let staged: StagedCapture | null = null;
let stagedProfile = "";

export function stageCaptureForAnalysis(file: File, review: CaptureReview, profileId = ""): void {
  staged = { file, review }; stagedProfile = profileId;
}
export function peekCaptureForAnalysis(profileId?: string): StagedCapture | null {
  return profileId===undefined||profileId===stagedProfile?staged:null;
}
export function consumeCaptureForAnalysis(): StagedCapture | null {
  const captured = staged;
  staged = null; stagedProfile = "";
  return captured;
}
export function discardStagedCapture(): void {
  staged = null; stagedProfile = "";
}
