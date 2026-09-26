import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { numbersIn, untracedLearningNumbers } from "./learning-numbers";
import { validateProjectObject } from "./plugin-validator-entry";
import type { Interactive, ResearchProject } from "./schema";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");

function withInteractives(interactives: Interactive[]): ResearchProject {
  return { ...structuredClone(example), interactives };
}

const playground = () => structuredClone(example.interactives!.find((item) => item.kind === "formula-playground")!) as Extract<Interactive, { kind: "formula-playground" }>;
const simulation = () => structuredClone(example.interactives!.find((item) => item.id === "sim-attention")!) as Extract<Interactive, { kind: "mechanism-simulation" }>;
const table = () => structuredClone(example.interactives!.find((item) => item.kind === "dataset-explorer")!) as Extract<Interactive, { kind: "dataset-explorer" }>;

describe("numbers in the learning layer", () => {
  it("reads numbers the way papers and languages write them", () => {
    expect(numbersIn("d_k = 64 and h = 8")).toEqual(expect.arrayContaining([64, 8]));
    expect(numbersIn("2.3 · 10^19 FLOP")).toContain(2.3e19);
    expect(numbersIn("3.3×10^{18}")).toContain(3.3e18);
    expect(numbersIn("ε = 10^{-9}")).toContain(1e-9);
    // Türkçe ondalık virgül ve İngilizce binlik ayırıcı ikisi de okunuyor.
    expect(numbersIn("dropout 0,1")).toContain(0.1);
    expect(numbersIn("4,000 warmup steps")).toContain(4000);
    expect(numbersIn("28%")).toEqual(expect.arrayContaining([28, 0.28]));
    // Kaynakça işareti bir değer değil.
    expect(numbersIn("GNMT + RL [38] 24.6")).toEqual([24.6]);
  });

  it("finds every number of the shipped example in its evidence", () => {
    expect(untracedLearningNumbers(example)).toEqual([]);
    expect(untracedLearningNumbers(loadExampleProject("attention-is-all-you-need.trace.json"))).toEqual([]);
  });

  it("does not let a playground call an invented setting the paper's value", () => {
    const item = playground();
    item.parameters[0] = { ...item.parameters[0], paperValue: 777, max: 1024 };
    expect(untracedLearningNumbers(withInteractives([item]))).toEqual([`interactives.${item.id}.${item.parameters[0].name}.paperValue: 777 is not in the evidence`]);
  });

  it("does not let a table row carry a number the evidence does not have", () => {
    const item = table();
    item.rows = [...item.rows, { cells: ["Invented baseline", 31.7, 5e18] }];
    expect(untracedLearningNumbers(withInteractives([item]))).toEqual([
      `interactives.${item.id}.bleu: 31.7 is not in the evidence`,
      `interactives.${item.id}.flops: 5000000000000000000 is not in the evidence`,
    ]);
  });

  it("accepts made-up simulation values only when the simulation says so", () => {
    const marked = simulation();
    expect(marked.illustrative).toBe(true);
    expect(untracedLearningNumbers(withInteractives([marked]))).toEqual([]);
    const unmarked = { ...marked, illustrative: undefined };
    expect(untracedLearningNumbers(withInteractives([unmarked])).join(" ")).toMatch(/sim-attention\.frames\[1\]\.grid: 8\.1, 2\.1/);
  });

  it("holds a worked example's starting numbers and a hyperparameter's paper value to the same rule", () => {
    const project = structuredClone(example);
    project.derivations![0].numericExample = { setup: "Take d_k = 37 and two keys.", walkthrough: ["√37 ≈ 6.08"], result: "6.08" };
    project.applicationGuide!.hyperparameters[0].paperValue = "768";
    expect(untracedLearningNumbers(project)).toEqual([
      `derivations.${project.derivations![0].id}.numericExample.setup: 37 is not in the evidence`,
      `applicationGuide.${project.applicationGuide!.hyperparameters[0].name}.paperValue: 768 is not in the evidence`,
    ]);
    project.derivations![0].numericExample.illustrative = true;
    expect(untracedLearningNumbers(project)).toHaveLength(1);
  });

  it("is part of the strict check an agent runs before delivering", () => {
    const item = playground();
    item.parameters[0] = { ...item.parameters[0], paperValue: 777, max: 1024 };
    const project = withInteractives([...example.interactives!.filter((entry) => entry.id !== item.id), item]);
    expect(validateProjectObject(project).ok).toBe(true);
    const strict = validateProjectObject(project, { requireDepthBlocks: true });
    expect(strict.ok).toBe(false);
    if (!strict.ok) expect(strict.issues.join(" ")).toContain("777 is not in the evidence");
  });
});
