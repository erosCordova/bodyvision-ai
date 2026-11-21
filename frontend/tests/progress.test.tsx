import { describe, expect, it } from "vitest";
import { overallProgress, phaseAssessment, reviewedAt } from "../src/features/progress/projectProgress";
import { phaseClosureAudit, closedWithFormalAcceptance } from "../src/features/progress/phaseClosureAudit";

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
    // Follow live, documented phase evidence instead of freezing any milestone.
    // The calculation above is the only source for the displayed total.
    expect(phaseAssessment.find(phase => phase.id === 5)?.completed).toContain("MediaPipe");
    const production = phaseAssessment.find(phase => phase.id === 9)!;
    expect(production.completed).toContain("Restauración lógica");
    expect(production.completed).toContain("datos sintéticos");
    expect(production.completed).toContain("44806178898");
    expect(production.pending).toContain("respaldos productivos/PITR");
    expect(production.pending).toContain("RPO/RTO");
    expect(reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("phase 0–2 acceptance gates", () => {
  it("requires separate technical and human acceptance instead of changing percentages", () => {
    expect(phaseClosureAudit.map(entry => entry.phaseId)).toEqual([0, 1, 2]);
    expect(phaseClosureAudit.map(entry => entry.technical)).toEqual([
      "pending", "verified", "verified",
    ]);
    expect(closedWithFormalAcceptance).toBe(0);
    expect(phaseClosureAudit.every(entry => entry.formalAcceptance === "pending")).toBe(true);
    expect(phaseClosureAudit.filter(entry => entry.phaseId !== 1)
      .every(entry => entry.owner.includes("por confirmar"))).toBe(true);
    expect(phaseClosureAudit[1].operationalReception).toBe("assisted");
    expect(phaseAssessment.find(phase => phase.id === 1)?.progress).toBe(100);
    expect(phaseClosureAudit[0].mappedExecutionPhase).toContain("F1–F10");
    expect(phaseClosureAudit[1].mappedExecutionPhase).toContain("F1");
    expect(phaseClosureAudit[2].mappedExecutionPhase).toContain("F2");
  });

  it("has unique criterion IDs and honest evidence URLs for every verified gate", () => {
    const checks = phaseClosureAudit.flatMap(entry => entry.checks);
    expect(new Set(checks.map(entry => entry.id)).size).toBe(checks.length);
    for (const gate of phaseClosureAudit) {
      if (gate.operationalReception === "assisted") {
        expect(gate.checks.every(entry => entry.state === "verified")).toBe(true);
      } else {
        expect(gate.checks.some(entry => entry.state === "pending")).toBe(true);
      }
    }
    for (const check of checks) {
      expect(check.requirement.length).toBeGreaterThan(10);
      if (check.state === "verified") {
        expect(check.evidence?.url).toMatch(/^https:\/\/github\.com\/erosCordova\/bodyvision-ai\//);
      } else {
        expect(check.pendingReason).toBeTruthy();
      }
      if (check.evidence) {
        expect(check.evidence.url.startsWith("https://github.com/erosCordova/bodyvision-ai/"))
          .toBe(true);
      }
    }
  });
});
