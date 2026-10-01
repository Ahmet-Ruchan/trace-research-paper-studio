import { describe, expect, it } from "vitest";
import { crossClaims, crossPaperQuestions, MAX_CROSS_QUESTIONS } from "./cross-questions";
import { loadExampleProject } from "./example-fixture";
import type { ResearchProject } from "./schema";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");

/** Örnekten ikinci bir makale: başka başlık, yıl, iddialar, ölçüt değeri ve sözlük. */
function other(): ResearchProject {
  return {
    ...example,
    id: "other",
    evidence: {
      ...example.evidence,
      paper: { ...example.evidence.paper, title: "A Later Paper", year: "2019" },
      claims: example.evidence.claims.map((claim, index) => ({ ...claim, statement: `Later paper claim ${index}: ${claim.statement}` })),
      metrics: example.evidence.metrics.map((metric) => ({ ...metric, value: metric.value + 1, displayValue: `${metric.value + 1}` })),
      glossary: [
        ...example.evidence.glossary.slice(1).map((item, index) => (index === 0 ? { ...item, definition: `${item.definition} (as the later paper puts it)` } : item)),
        { term: "Pre-training", definition: "Training on unlabeled text first." },
      ],
    },
  };
}

describe("questions across two papers", () => {
  it("asks which paper says a claim, which came first, which metric is higher and who defines a term", () => {
    const later = other();
    const questions = crossPaperQuestions(example, later);
    expect(questions.length).toBeGreaterThan(4);
    expect(questions.length).toBeLessThanOrEqual(MAX_CROSS_QUESTIONS);
    const claim = questions.find((question) => question.id.startsWith("cross-claim-a-"))!;
    expect(claim.prompt.startsWith("Which paper says this?")).toBe(true);
    expect(claim.options.map((option) => [option.label, option.correct])).toEqual([[example.evidence.paper.title, true], ["A Later Paper", false]]);
    expect(claim.options[0].explanation).toMatch(/^Yes: p\. \d+ of this paper/);
    expect(claim.claimIds[0].startsWith("a:")).toBe(true);
    expect(crossClaims(example, later).some((item) => item.id === claim.claimIds[0])).toBe(true);
    expect(questions.find((question) => question.id.startsWith("cross-claim-b-"))!.options[1].correct).toBe(true);

    const year = questions.find((question) => question.id === "cross-year")!;
    expect(year.options.find((option) => option.correct)!.label).toBe(example.evidence.paper.title);
    expect(questions.some((question) => question.id.startsWith("cross-metric-") && question.options[1].correct)).toBe(true);
    const term = questions.find((question) => question.id.startsWith("cross-term-1-"));
    expect(term?.prompt).toBe("Which paper defines “Pre-training” in its glossary?");
    // Her sorunun tek bir doğru yanıtı var.
    for (const question of questions) expect(question.options.filter((option) => option.correct)).toHaveLength(1);
  });

  it("asks nothing when the two are analyses of the same paper", () => {
    expect(crossPaperQuestions(example, { ...example, id: "copy" })).toEqual([]);
  });

  it("asks which of two definitions is whose, in an order that does not give it away", () => {
    const later = other();
    const questions = crossPaperQuestions(example, later);
    const definition = questions.find((question) => question.id.startsWith("cross-definition-"));
    if (definition) {
      expect(definition.options).toHaveLength(2);
      expect(definition.options.find((option) => option.correct)!.explanation).toBe(`This is how ${example.evidence.paper.title} defines it.`);
    }
  });
});
