import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { curveShape, nextStepChoices, playgroundPredictions } from "./predictions";
import type { Interactive } from "./schema";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
type Playground = Extract<Interactive, { kind: "formula-playground" }>;
const playground = (id: string) => example.interactives!.find((item): item is Playground => item.id === id && item.kind === "formula-playground")!;

describe("the shape of a curve", () => {
  it("names the five shapes a reader can predict", () => {
    expect(curveShape([1, 2, 3, 5, 8])).toBe("rises");
    expect(curveShape([8, 5, 3, 2, 1])).toBe("falls");
    expect(curveShape([2, 2.001, 2, 2.002, 2])).toBe("flat");
    expect(curveShape([1, 3, 5, 3, 1])).toBe("peak");
    expect(curveShape([5, 3, 1, 3, 5])).toBe("valley");
    // Aynı değerde bekleyen parçalar yönü değiştirmiyor.
    expect(curveShape([1, 2, 2, 2, 3])).toBe("rises");
  });

  it("stays silent on a curve it cannot describe in one of those words", () => {
    expect(curveShape([1, 3, 1, 3, 1])).toBeUndefined();
    expect(curveShape([1, 2])).toBeUndefined();
    expect(curveShape([1, null, null, null, 2])).toBeUndefined();
  });
});

describe("predicting a playground", () => {
  it("asks what the scaled and unscaled weights do, and the answer is the paper's point", () => {
    const predictions = playgroundPredictions(playground("play-scaling"))!;
    expect(predictions).toMatchObject({ xParam: "d_k", min: 1, max: 512 });
    expect(predictions.questions.map((question) => [question.id, question.kind === "shape" ? question.answer : question.answer])).toEqual([
      ["shape:p_unscaled", "rises"],
      ["shape:p_scaled", "flat"],
    ]);
    // İki eğri d_k = 1'de değiyor: "kesişiyor mu" sorusu belirsiz olurdu, sorulmuyor.
    expect(predictions.questions.some((question) => question.kind === "cross")).toBe(false);
  });

  it("asks whether the two costs cross, and finds where: n = d, as in Table 1", () => {
    const predictions = playgroundPredictions(playground("play-complexity"))!;
    const cross = predictions.questions.find((question) => question.kind === "cross")!;
    expect(cross).toMatchObject({ answer: true, at: 512 });
    expect(predictions.questions.filter((question) => question.kind === "shape").map((question) => question.kind === "shape" && question.answer)).toEqual(["rises", "rises"]);
  });

  it("asks nothing when there is no chart to reveal", () => {
    expect(playgroundPredictions({ ...playground("play-scaling"), chart: undefined })).toBeUndefined();
  });
});

describe("predicting the next step of a derivation", () => {
  const derivation = example.derivations!.find((item) => item.id === "deriv-scaling")!;

  it("offers the true next step among later steps of the same derivation", () => {
    for (let shown = 1; shown < derivation.steps.length - 1; shown += 1) {
      const choices = nextStepChoices(derivation, shown)!;
      expect(choices.correctId).toBe(derivation.steps[shown].id);
      expect(choices.options.map((option) => option.id)).toContain(choices.correctId);
      expect(choices.options.length).toBeGreaterThanOrEqual(2);
      expect(choices.options.length).toBeLessThanOrEqual(3);
      // Adaylar görünen adımlardan değil, sonrakilerden: hepsi doğru cümle, yalnızca sırası farklı.
      for (const option of choices.options) expect(option.position, option.id).toBeGreaterThan(shown);
      expect(new Set(choices.options.map((option) => option.text)).size).toBe(choices.options.length);
    }
  });

  it("asks the same way every time, and not at the last step", () => {
    expect(nextStepChoices(derivation, 1)).toEqual(nextStepChoices(derivation, 1));
    expect(nextStepChoices(derivation, derivation.steps.length - 1)).toBeUndefined();
    expect(nextStepChoices(derivation, derivation.steps.length)).toBeUndefined();
  });
});
