import { describe, expect, it } from "vitest";
import { sampleProject } from "./sample-project";
import { researchProjectSchema } from "./schema";

describe("research project schema", () => {
  it("accepts the bundled evidence-first sample", () => {
    expect(researchProjectSchema.parse(sampleProject).id).toBe("sample-transformer");
  });

  it("keeps every story section connected to a real claim", () => {
    const claimIds = new Set(sampleProject.evidence.claims.map((claim) => claim.id));
    const links = sampleProject.story.sections.flatMap((section) => section.claimIds);
    expect(links.length).toBeGreaterThanOrEqual(sampleProject.story.sections.length);
    expect(links.every((claimId) => claimIds.has(claimId))).toBe(true);
  });

  it("requires every claim to carry at least one source reference", () => {
    expect(sampleProject.evidence.claims.every((claim) => claim.sourceRefs.length > 0)).toBe(true);
  });
});

