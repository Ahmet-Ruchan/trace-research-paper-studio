import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { learningHealth, playgroundFlatness, restatesItself, spareQuestion } from "./learning-health";
import type { Interactive } from "./schema";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
type Playground = Extract<Interactive, { kind: "formula-playground" }>;
const playground = example.interactives!.find((item): item is Playground => item.kind === "formula-playground" && Boolean(item.chart))!;

describe("learning health", () => {
  it("finds the one real gap in the shipped example: a section no question checks", () => {
    const health = learningHealth(example);
    expect(health.uncheckedSections.map((section) => section.id)).toEqual(["story-training"]);
    expect(health).toMatchObject({ missingBlocks: [], flatPlaygrounds: [], restatingSteps: [], unusedConcepts: [], findings: 1 });
    expect(health.quiz!.uncovered).toEqual([]);
  });

  it("offers a question to rewrite only when no other section would lose its only question", () => {
    const health = learningHealth(example);
    const spare = spareQuestion(health, example.quiz!.questions.map((question) => question.id))!;
    expect(spare).toBeDefined();
    for (const section of health.sections) {
      if (section.questionIds.includes(spare)) expect(section.questionIds.length, section.id).toBeGreaterThan(1);
    }
    const lonely = { sections: [{ id: "a", title: "A", claimIds: [], questionIds: ["q1"] }] };
    expect(spareQuestion(lonely, ["q1"])).toBeUndefined();
  });

  it("says what the quiz never asks about, among the kinds the evidence has", () => {
    const methodOnly = example.evidence.claims.find((claim) => claim.kind === "method")!.id;
    const quiz = { ...example.quiz!, questions: example.quiz!.questions.map((question) => ({ ...question, claimIds: [methodOnly] })) };
    const health = learningHealth({ ...example, quiz });
    expect(health.quiz!.uncovered).toEqual(["reported-result", "author-interpretation", "limitation"]);
    // Artık hiçbir soru hikâye bölümleriyle iddia paylaşmıyorsa bölümler de sorusuz.
    expect(health.uncheckedSections.length).toBeGreaterThan(1);
  });

  it("catches a playground whose sliders change nothing, and a chart that draws a flat line", () => {
    expect(playgroundFlatness(playground)).toBeUndefined();
    const constant = { ...playground, outputs: playground.outputs.map((output) => ({ ...output, formula: "2 * pi" })) };
    expect(playgroundFlatness(constant)).toBe("outputs");
    const other = playground.parameters.find((parameter) => parameter.name !== playground.chart!.xParam);
    if (other) {
      const offAxis = { ...playground, outputs: playground.outputs.map((output) => ({ ...output, formula: `${other.name} * 2` })) };
      expect(playgroundFlatness(offAxis)).toBe("chart");
    }
    expect(learningHealth({ ...example, interactives: [constant] }).flatPlaygrounds).toEqual([{ id: constant.id, title: constant.title, reason: "outputs" }]);
  });

  it("flags a derivation step whose rationale only repeats its reading", () => {
    expect(restatesItself({ plain: "Divide by the square root of d_k", rationale: "divide by the square root of d_k." })).toBe(true);
    expect(restatesItself({ plain: "Divide by the square root of d_k", rationale: "We divide by the square root of d_k" })).toBe(true);
    expect(restatesItself({ plain: "Divide by the square root of d_k", rationale: "The dot product's variance grows with d_k, so dividing by its square root brings it back to 1." })).toBe(false);
    const [first, ...rest] = example.derivations!;
    const lazy = { ...first, steps: first.steps.map((step, index) => (index === 1 ? { ...step, rationale: step.plain } : step)) };
    expect(learningHealth({ ...example, derivations: [lazy, ...rest] }).restatingSteps).toEqual([{ derivationId: first.id, title: first.title, stepIds: [first.steps[1].id] }]);
  });

  it("lists a concept nothing uses, but not one a used concept builds on", () => {
    const primer = example.primer!;
    const orphan = { ...primer.concepts[0], id: "orphan", term: "Kolmogorov complexity", claimIds: [], prerequisiteIds: [] };
    const base = { ...primer.concepts[0], id: "base", term: "Measure theory", claimIds: [], prerequisiteIds: [] };
    const used = { ...primer.concepts[1], prerequisiteIds: [...primer.concepts[1].prerequisiteIds, "base"] };
    const concepts = [...primer.concepts.map((concept) => (concept.id === used.id ? used : concept)), orphan, base];
    expect(learningHealth({ ...example, primer: { ...primer, concepts } }).unusedConcepts).toEqual([{ id: "orphan", term: "Kolmogorov complexity" }]);
  });

  it("names the blocks the depth asks for, without also blaming the sections for a missing quiz", () => {
    const health = learningHealth({ ...example, quiz: undefined });
    expect(health.missingBlocks).toEqual(["quiz"]);
    expect(health.uncheckedSections).toEqual([]);
    expect(health.quiz).toBeUndefined();
  });
});
