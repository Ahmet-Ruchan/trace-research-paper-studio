import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadExampleProject } from "./example-fixture";
import {
  applyLearningBlock,
  buildLearningPrompt,
  describeLearningGaps,
  learningBlockIds,
  learningBlockSpec,
  learningBlocksFor,
  missingLearningBlocks,
  validateLearningBlock,
  type LearningBlockId,
  type LearningContext,
} from "./learning-generation";
import { openAiJsonSchema } from "./openai-structured";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const context: LearningContext = {
  evidence: example.evidence,
  depth: "deep",
  language: "en",
  audience: "student",
  technicalAppendix: example.technicalAppendix,
};

/** Modelin döndüreceği biçimde, örnek projenin blokları. */
const answers: Record<LearningBlockId, unknown> = {
  primer: example.primer,
  quiz: example.quiz,
  derivations: { derivations: example.derivations },
  interactives: { interactives: example.interactives },
  applicationGuide: example.applicationGuide,
};

describe("learning layer generation", () => {
  it("writes the blocks each depth requires, those that need the technical appendix last", () => {
    expect(learningBlocksFor("concise")).toEqual(["primer"]);
    expect(learningBlocksFor("standard")).toEqual(["primer", "quiz", "derivations"]);
    expect(learningBlocksFor("deep")).toEqual(["primer", "quiz", "derivations", "interactives", "applicationGuide"]);
  });

  it("lists what a project still lacks", () => {
    expect(missingLearningBlocks(example)).toEqual([]);
    expect(missingLearningBlocks({ depth: "standard", primer: example.primer, derivations: [] })).toEqual(["quiz", "derivations"]);
  });

  it("accepts the shipped example's blocks as a model answer", () => {
    for (const block of learningBlockIds) {
      const parsed = learningBlockSpec(block).schema.parse(answers[block]);
      expect(() => validateLearningBlock(block, parsed, context), block).not.toThrow();
    }
    expect(applyLearningBlock("derivations", answers.derivations)).toEqual({ derivations: example.derivations });
    expect(applyLearningBlock("interactives", answers.interactives)).toEqual({ interactives: example.interactives });
  });

  it("gives every block a schema the strict structured-output providers accept", () => {
    for (const block of learningBlockIds) {
      const { schema } = learningBlockSpec(block);
      expect(() => z.toJSONSchema(schema), block).not.toThrow();
      expect(() => openAiJsonSchema(schema), block).not.toThrow();
    }
  });

  it("rejects a block that cites a claim the evidence does not have", () => {
    const quiz = structuredClone(example.quiz!);
    quiz.questions[0].claimIds = ["claim-invented"];
    expect(() => validateLearningBlock("quiz", quiz, context)).toThrow(/claim-invented/);
  });

  it("keeps a rejected claim out of the prompt and out of the answer", () => {
    const rejected = example.quiz!.questions[0].claimIds[0];
    const withReview = { ...context, rejectedClaimIds: [rejected] };
    expect(buildLearningPrompt("quiz", withReview)).not.toContain(`"id":"${rejected}"`);
    expect(buildLearningPrompt("quiz", context)).toContain(`"id":"${rejected}"`);
    expect(() => validateLearningBlock("quiz", example.quiz, withReview)).toThrow(/a reviewer rejected/);
  });

  it("refuses a derivation step that only restates its formula", () => {
    const derivations = structuredClone(example.derivations!);
    derivations[0].steps[1].rationale = derivations[0].steps[1].plain;
    expect(() => validateLearningBlock("derivations", { derivations }, context)).toThrow(/only restates the formula/);
  });

  it("refuses a playground whose formula would break before the reader touches it", () => {
    const interactives = structuredClone(example.interactives!);
    const playground = interactives.find((item) => item.kind === "formula-playground")!;
    if (playground.kind !== "formula-playground") throw new Error("expected a playground");
    playground.outputs[0].formula = "eval(1)";
    expect(() => validateLearningBlock("interactives", { interactives }, context)).toThrow(/invalid formula/);
  });

  it("shows the technical appendix only to the blocks built on it, so derivations can point at an equation", () => {
    const equationId = example.technicalAppendix!.equations[0].id;
    expect(buildLearningPrompt("derivations", context)).toContain(`"id":"${equationId}"`);
    expect(buildLearningPrompt("interactives", context)).toContain(`"id":"${equationId}"`);
    expect(buildLearningPrompt("primer", context)).not.toContain("Technical appendix");
  });

  it("asks for an amount that grows with the depth, in the reader's language", () => {
    expect(buildLearningPrompt("quiz", { ...context, depth: "standard" })).toContain("5–8 questions");
    expect(buildLearningPrompt("quiz", context)).toContain("8–12 questions");
    expect(buildLearningPrompt("primer", { ...context, language: "pt-BR" })).toContain("Brazilian Portuguese");
  });

  it("says in one sentence what is missing and where to add it", () => {
    expect(describeLearningGaps([])).toBeUndefined();
    expect(describeLearningGaps([
      { block: "quiz", reason: "The model's answer did not pass the checks twice." },
      { block: "interactives", reason: "The model's answer did not pass the checks twice." },
    ])).toBe(
      "The learning layer is incomplete: the quiz and the interactive explorations could not be written. The model's answer did not pass the checks twice. Everything else is complete; the missing parts can be added from the Lab.",
    );
  });
});
