import { describe, expect, it } from "vitest";
import { exampleProject } from "./example-fixture";
import { researchProjectSchema } from "./schema";

describe("research project schema", () => {
  it("accepts the shipped flagship project", () => {
    expect(researchProjectSchema.parse(exampleProject).id).toBe("attention-is-all-you-need");
  });

  it("keeps every story section connected to a real claim", () => {
    const claimIds = new Set(exampleProject.evidence.claims.map((claim) => claim.id));
    const links = exampleProject.story.sections.flatMap((section) => section.claimIds);
    expect(links.length).toBeGreaterThanOrEqual(exampleProject.story.sections.length);
    expect(links.every((claimId) => claimIds.has(claimId))).toBe(true);
  });

  it("requires every claim to carry at least one source reference", () => {
    expect(exampleProject.evidence.claims.every((claim) => claim.sourceRefs.length > 0)).toBe(true);
  });
});

