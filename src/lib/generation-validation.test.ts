import { describe, expect, it } from "vitest";
import { sampleProject } from "./sample-project";
import { validateEvidenceIntegrity, validateStoryIntegrity } from "./generation-validation";

describe("generation integrity checks", () => {
  it("accepts the evidence-linked Attention Is All You Need sample", () => {
    expect(() => validateEvidenceIntegrity(sampleProject.evidence)).not.toThrow();
    expect(() =>
      validateStoryIntegrity(sampleProject.story, sampleProject.evidence, 6),
    ).not.toThrow();
  });

  it("rejects paper claims without a page locator", () => {
    const evidence = structuredClone(sampleProject.evidence);
    delete evidence.claims[0].sourceRefs[0].page;
    expect(() => validateEvidenceIntegrity(evidence)).toThrow(/PDF sayfası eksik/);
  });

  it("rejects invented comparison values", () => {
    const story = structuredClone(sampleProject.story);
    const comparison = story.sections.find((section) => section.visual.type === "comparison");
    if (!comparison || comparison.visual.type !== "comparison") throw new Error("fixture eksik");
    comparison.visual.items[0].value = 999;
    expect(() => validateStoryIntegrity(story, sampleProject.evidence, 6)).toThrow(
      /evidence metrics içinde yok/,
    );
  });
});
