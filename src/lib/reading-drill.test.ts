import { describe, expect, it } from "vitest";
import { rereadSections } from "@/visuals/teaching/quiz";
import { loadExampleProject } from "./example-fixture";
import { READING_DRILL_TITLE, readingDrill, readingDrillFor } from "./reading-drill";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");

describe("reading drill", () => {
  const drill = readingDrillFor(example)!;
  const claims = new Map(example.evidence.claims.map((claim) => [claim.id, claim]));

  it("asks six questions in turn: what kind of statement, which quote, which number", () => {
    expect(drill.title).toBe(READING_DRILL_TITLE);
    expect(drill.questions.map((question) => question.id.split("-")[1])).toEqual(["kind", "quote", "number", "kind", "quote", "number"]);
  });

  it("asks the same questions every time the same project is opened", () => {
    expect(readingDrillFor(example)).toEqual(drill);
    expect(readingDrill(example.evidence, { seed: "another-project" })?.questions.map((question) => question.id)).not.toEqual(drill.questions.map((question) => question.id));
  });

  it("marks exactly one option right, and that option is true by construction", () => {
    for (const question of drill.questions) {
      const right = question.options.filter((option) => option.correct);
      expect(right, question.id).toHaveLength(1);
      expect(new Set(question.options.map((option) => option.label)).size, question.id).toBe(question.options.length);
      const [, type, ...rest] = question.id.split("-");
      const id = rest.join("-");
      if (type === "kind") {
        expect(right[0].explanation).toContain({ "reported-result": "measured", "author-interpretation": "interpretation", method: "built or did", background: "Background", limitation: "boundary" }[claims.get(id)!.kind]);
      }
      if (type === "quote") expect(right[0].label).toBe(`“${claims.get(id)!.sourceRefs[0].excerpt.trim()}”`);
      if (type === "number") expect(right[0].label).toBe(example.evidence.metrics.find((metric) => metric.id === id)!.displayValue);
    }
  });

  it("starts with the distinction that matters most: measured or interpreted", () => {
    expect(claims.get(drill.questions[0].id.replace("drill-kind-", ""))!.kind).toBe("author-interpretation");
    expect(claims.get(drill.questions[3].id.replace("drill-kind-", ""))!.kind).toBe("reported-result");
  });

  it("leaves out claims a reviewer rejected, even as wrong options", () => {
    const rejected = example.evidence.claims.filter((claim) => claim.kind === "author-interpretation").map((claim) => claim.id);
    const reviewed = { ...example, claimReviews: Object.fromEntries(rejected.map((id) => [id, { status: "rejected" as const, by: "Ada", at: "2026-09-01T00:00:00.000Z" }])) };
    const text = JSON.stringify(readingDrillFor(reviewed));
    for (const id of rejected) {
      expect(text).not.toContain(`"${id}"`);
      expect(text).not.toContain(claims.get(id)!.statement);
    }
  });

  it("stays out of the way when the evidence is too thin to ask three questions", () => {
    const thin = { ...example.evidence, claims: example.evidence.claims.slice(0, 1), metrics: [] };
    expect(readingDrill(thin, { seed: "x" })).toBeUndefined();
  });

  it("points a question at the story sections that use the same claims, in story order", () => {
    const question = drill.questions[1];
    const sections = rereadSections(question, example.story.sections);
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.length).toBeLessThanOrEqual(2);
    for (const section of sections) expect(section.claimIds.some((id) => question.claimIds.includes(id))).toBe(true);
    const order = example.story.sections.map((section) => section.id);
    expect(sections.map((section) => order.indexOf(section.id))).toEqual([...sections.map((section) => order.indexOf(section.id))].sort((a, b) => a - b));
  });
});
