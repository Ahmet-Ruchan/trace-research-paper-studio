import { describe, expect, it } from "vitest";
import { buildExam, examPool, gradeExam, isRight, missedToReview } from "./exam";
import { loadExampleProject } from "./example-fixture";
import { addDays } from "./review-schedule";
import type { ResearchProject } from "./schema";
import { recordAnswer } from "./study-path";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const first: ResearchProject = { ...example, id: "first" };
const second: ResearchProject = { ...example, id: "second", evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "A second paper" } } };
const T0 = "2026-09-20T09:00:00.000Z";

describe("the practice exam", () => {
  it("draws from every question of every paper, studied or not, each once", () => {
    const pool = examPool([first, second]);
    const perPaper = pool.filter((item) => item.projectId === "first").length;
    expect(perPaper).toBeGreaterThanOrEqual(example.quiz!.questions.length);
    expect(pool).toHaveLength(perPaper * 2);
    expect(new Set(pool.map((item) => item.key)).size).toBe(pool.length);
  });

  it("mixes the papers so one answer does not give the next away, the same way for the same seed", () => {
    const pool = examPool([first, second]);
    const exam = buildExam(pool, 10, 42);
    expect(exam).toHaveLength(10);
    for (let index = 1; index < exam.length; index += 1) expect(exam[index].projectId).not.toBe(exam[index - 1].projectId);
    expect(buildExam(pool, 10, 42).map((item) => item.key)).toEqual(exam.map((item) => item.key));
    expect(buildExam(pool, 10, 7).map((item) => item.key)).not.toEqual(exam.map((item) => item.key));
    expect(buildExam(pool, 1000, 1)).toHaveLength(pool.length);
  });

  it("counts an answer right only with every correct option and no other", () => {
    const multi = { ...example.quiz!.questions[0], kind: "multi" as const, options: [{ label: "a", correct: true, explanation: "" }, { label: "b", correct: true, explanation: "" }, { label: "c", correct: false, explanation: "" }] };
    expect(isRight(multi, [1, 0])).toBe(true);
    expect(isRight(multi, [0])).toBe(false);
    expect(isRight(multi, [0, 1, 2])).toBe(false);
    expect(isRight(multi, [])).toBe(false);
  });

  it("grades the exam by paper, weakest first, and keeps what was answered", () => {
    const exam = buildExam(examPool([first, second]), 4, 3);
    const answers = new Map<string, number[]>();
    exam.forEach((item, index) => {
      if (index === 3) return;
      const correct = item.question.options.flatMap((option, position) => (option.correct ? [position] : []));
      const wrong = [item.question.options.findIndex((option) => !option.correct)];
      answers.set(item.key, index === 0 ? wrong : correct);
    });
    const result = gradeExam(exam, answers);
    expect(result).toMatchObject({ total: 4, correct: 2, unanswered: 1 });
    expect(result.byPaper.reduce((sum, paper) => sum + paper.total, 0)).toBe(4);
    expect(result.byPaper[0].correct / result.byPaper[0].total).toBeLessThanOrEqual(result.byPaper.at(-1)!.correct / result.byPaper.at(-1)!.total);
    expect(result.items[3]).toMatchObject({ answer: [], right: false });
  });

  it("brings a missed question back tomorrow, as a lapse when it has a card and a new card when not", () => {
    const question = example.quiz!.questions[0];
    const studied = recordAnswer(undefined, question, { correct: true, attempts: 1, revealed: false }, T0);
    expect(studied.reviews![0].box).toBe(1);
    const lapsed = missedToReview(studied, question, addDays(T0, 2));
    expect(lapsed.reviews![0]).toMatchObject({ box: 0, lapses: 1, due: addDays(addDays(T0, 2), 1) });
    const fresh = missedToReview(undefined, example.quiz!.questions[1], T0);
    expect(fresh.reviews).toEqual([expect.objectContaining({ id: `q:${example.quiz!.questions[1].id}`, box: 0, reviews: 0, due: addDays(T0, 1) })]);
    expect(fresh.reviewDays?.[0]).toMatchObject({ reviewed: 1, remembered: 0 });
  });
});
