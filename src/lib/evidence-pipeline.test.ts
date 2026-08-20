import { describe, expect, it } from "vitest";
import {
  evidenceCheckpointSchema,
  evidencePassIds,
  mergeEvidenceParts,
  validateEvidencePass,
  type EvidenceCheckpoint,
} from "./evidence-pipeline";
import { validateEvidenceIntegrity } from "./generation-validation";
import { exampleProject } from "./example-fixture";

function checkpointFromSample(): EvidenceCheckpoint {
  const evidence = exampleProject.evidence;
  return {
    version: 1,
    inputFingerprint: "a".repeat(64),
    parts: {
      overview: {
        paper: evidence.paper,
        thesis: evidence.thesis,
        plainSummary: evidence.plainSummary,
        researchQuestion: evidence.researchQuestion,
        glossary: evidence.glossary,
        claims: evidence.claims
          .filter((claim) => ["background", "author-interpretation"].includes(claim.kind))
          .map((claim) => ({ ...claim, id: `overview-${claim.id}` })),
      },
      methods: {
        methods: evidence.methods,
        claims: evidence.claims
          .filter((claim) => claim.kind === "method")
          .map((claim) => ({ ...claim, id: `method-${claim.id}` })),
      },
      results: {
        findings: evidence.findings,
        claims: evidence.claims
          .filter((claim) => claim.kind === "reported-result")
          .map((claim) => ({ ...claim, id: `result-${claim.id}` })),
        metrics: evidence.metrics,
      },
      limitations: {
        limitations: evidence.limitations,
        claims: evidence.claims
          .filter((claim) => claim.kind === "limitation")
          .map((claim) => ({ ...claim, id: `limit-${claim.id}` })),
      },
    },
  };
}

describe("segmented evidence pipeline", () => {
  it("validates and merges all four passes", () => {
    const checkpoint = evidenceCheckpointSchema.parse(checkpointFromSample());
    const sourceIds = new Set(exampleProject.evidence.sources.map((source) => source.id));
    evidencePassIds.forEach((passId) => {
      const part = checkpoint.parts[passId];
      if (!part) throw new Error(`missing ${passId} fixture`);
      validateEvidencePass(passId, part, sourceIds);
    });
    const evidence = mergeEvidenceParts(checkpoint.parts, exampleProject.evidence.sources);
    expect(() => validateEvidenceIntegrity(evidence)).not.toThrow();
    expect(evidence.claims).toHaveLength(exampleProject.evidence.claims.length);
  });

  it("rejects a checkpoint with a different fingerprint format", () => {
    const checkpoint = checkpointFromSample();
    checkpoint.inputFingerprint = "wrong";
    expect(() => evidenceCheckpointSchema.parse(checkpoint)).toThrow();
  });

  it("keeps claim IDs namespaced across parallel passes", () => {
    const checkpoint = checkpointFromSample();
    const methods = checkpoint.parts.methods;
    if (!methods) throw new Error("methods fixture missing");
    methods.claims[0].id = "result-wrong-namespace";
    expect(() => validateEvidencePass("methods", methods, new Set(["paper"]))).toThrow(
      /method-/,
    );
  });
});
