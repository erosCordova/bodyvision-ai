import { describe, expect, it } from "vitest";
import { overallProgress, phaseAssessment, reviewedAt } from "../src/features/progress/projectProgress";

describe("BODYVISION project progress assessment", () => {
  it("follows all ten master-document implementation phases", () => {
    expect(phaseAssessment.map(phase => phase.id)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(new Set(phaseAssessment.map(phase => phase.name)).size).toBe(10);
    expect(phaseAssessment.every(phase => phase.progress >= 0 && phase.progress <= 100)).toBe(true);
    expect(phaseAssessment.every(phase => phase.completed && phase.pending && phase.milestone)).toBe(true);
  });
  it("calculates the overall estimate from the phase assessments", () => {
    const average = phaseAssessment.reduce((sum, phase) => sum + phase.progress, 0) / phaseAssessment.length;
    expect(overallProgress).toBe(Math.round(average));
    expect(overallProgress).toBe(68);
    expect(reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
