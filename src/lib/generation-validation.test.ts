import { describe, expect, it } from "vitest";
import { exampleProject } from "./example-fixture";
import { SECTION_BUDGETS } from "./prompts";
import { validateDeepReportIntegrity, validateEvidenceIntegrity, validateStoryIntegrity, validateTechnicalAppendixIntegrity } from "./generation-validation";

describe("generation integrity checks", () => {
  it("accepts the evidence-linked Attention Is All You Need sample", () => {
    expect(() => validateEvidenceIntegrity(exampleProject.evidence)).not.toThrow();
    expect(() =>
      validateStoryIntegrity(exampleProject.story, exampleProject.evidence, SECTION_BUDGETS.story[exampleProject.depth]),
    ).not.toThrow();
    expect(() =>
      validateDeepReportIntegrity(exampleProject.deepReport!, exampleProject.evidence, SECTION_BUDGETS.deepReport[exampleProject.depth]),
    ).not.toThrow();
    expect(() =>
      validateTechnicalAppendixIntegrity(exampleProject.technicalAppendix!, exampleProject.evidence),
    ).not.toThrow();
  });

  it("rejects paper claims without a page locator", () => {
    const evidence = structuredClone(exampleProject.evidence);
    delete evidence.claims[0].sourceRefs[0].page;
    expect(() => validateEvidenceIntegrity(evidence)).toThrow(/missing a PDF page/);
  });

  it("rejects invented comparison values", () => {
    const story = structuredClone(exampleProject.story);
    const comparison = story.sections.find((section) => section.visual.type === "comparison");
    if (!comparison || comparison.visual.type !== "comparison") throw new Error("fixture eksik");
    comparison.visual.items[0].value = 999;
    expect(() => validateStoryIntegrity(story, exampleProject.evidence, SECTION_BUDGETS.story[exampleProject.depth])).toThrow(
      /not in evidence metrics/,
    );
  });
});
