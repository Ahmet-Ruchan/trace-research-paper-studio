import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { LONG_TERM_BOX, learningStats } from "./learning-stats";
import { recordReview, reviewCards } from "./review-queue";
import { addDays } from "./review-schedule";
import { completeStep, recordAnswer, studyFileToJson, type StudyProgress } from "./study-path";

const english = loadExampleProject("attention-is-all-you-need.en.trace.json");
const second = { ...english, id: "second", evidence: { ...english.evidence, paper: { ...english.evidence.paper, title: "A second paper" } } };
const T0 = "2026-09-01T09:00:00.000Z";
const [q1, q2] = english.quiz!.questions;

/** İki makale: birinde iki soru ve bir kavram çalışılmış, kartlar birkaç kez tekrarlanmış; öteki bitirilmiş. */
function library() {
  let first: StudyProgress | undefined = recordAnswer(undefined, q1, { correct: true, attempts: 1, revealed: false }, T0);
  first = recordAnswer(first, q2, { correct: true, attempts: 2, revealed: false }, T0);
  first = completeStep(first, `concept:${english.primer!.concepts[0].id}`, "next", T0);
  // Soru 1 üç kez hatırlanıyor; kavram iki kez unutuluyor, bir kez hatırlanıyor.
  const cardOf = (progress: StudyProgress, id: string) => reviewCards([english], new Map([[english.id, progress]])).find((card) => card.review.id === id)!;
  let at = T0;
  for (let round = 0; round < 3; round += 1) {
    at = addDays(at, 10);
    first = recordReview(first, cardOf(first, `q:${q1.id}`), true, at);
  }
  const concept = `c:${english.primer!.concepts[0].id}`;
  first = recordReview(first, cardOf(first, concept), false, addDays(T0, 2));
  first = recordReview(first, cardOf(first, concept), false, addDays(T0, 3));
  first = recordReview(first, cardOf(first, concept), true, addDays(T0, 4));
  first = {
    ...first,
    explanations: [
      { target: "story:story-attention", at: T0, text: "first", model: "m", covered: ["claim-method-05"], missed: [], misstated: 1, unsupported: 0, total: 2, sig: "s" },
      { target: "story:story-attention", at: addDays(T0, 7), text: "second", model: "m", covered: ["claim-method-05", "claim-interpretation-01"], missed: [], misstated: 0, unsupported: 0, total: 2, sig: "s" },
      { target: "story:story-intro", at: T0, text: "once", model: "m", covered: [], missed: [], misstated: 0, unsupported: 0, total: 1, sig: "s" },
    ],
  };
  const finished: StudyProgress = { ...completeStep(undefined, "start", "finish", T0), finishedAt: addDays(T0, 1) };
  return new Map<string, StudyProgress>([[english.id, first], ["second", finished]]);
}

describe("learning statistics", () => {
  const now = addDays(T0, 30);
  const stats = learningStats([english, second], library(), now);

  it("counts recalls exactly: every review, and the ones remembered", () => {
    expect(stats.totals).toMatchObject({ reviews: 6, remembered: 4, cards: 3, answered: 2, firstTry: 1, finished: 1, started: 1 });
    const paper = stats.papers.find((item) => item.project.id === english.id)!;
    expect(paper.recalls).toEqual({ reviews: 6, remembered: 4 });
    expect(paper.checks).toEqual({ answered: 2, firstTry: 1 });
    expect(paper.steps.done).toBe(1);
    expect(paper.status).toBe("started");
  });

  it("shows how long each card is kept, and which cards are kept long-term", () => {
    // Soru 1: 1. kutudan üç hatırlamayla 4. kutuya; soru 2: 0. kutu; kavram: iki unutuş, bir hatırlama → 1. kutu.
    expect(stats.boxes).toEqual([1, 1, 0, 0, 1, 0]);
    expect(stats.totals.longTerm).toBe(stats.boxes.slice(LONG_TERM_BOX).reduce((a, b) => a + b, 0));
    expect(LONG_TERM_BOX).toBe(3);
  });

  it("lists the cards forgotten most, and the week ahead", () => {
    expect(stats.hardest.map((card) => [card.review.id, card.review.lapses])).toEqual([[`c:${english.primer!.concepts[0].id}`, 2]]);
    expect(stats.week).toHaveLength(7);
    expect(stats.week[0].day).toBe(now.slice(0, 10));
    // Bugün vadesi geçmişler de sayılıyor; hafta toplamı kartlardan fazla olamaz.
    expect(stats.week.reduce((total, day) => total + day.due, 0)).toBeLessThanOrEqual(stats.totals.cards);
    expect(stats.week[0].due).toBeGreaterThanOrEqual(stats.totals.due);
  });

  it("says what explaining a section again added", () => {
    expect(stats.explanationGain).toEqual({ sections: 1, before: 1, after: 2, total: 2 });
    expect(stats.papers.find((item) => item.project.id === english.id)!.explanations).toEqual({ sections: 2, again: 1 });
  });

  it("leaves out papers never studied, and reads nothing but the study record", () => {
    const empty = learningStats([english], new Map(), now);
    expect(empty.papers).toEqual([]);
    expect(empty.totals.cards).toBe(0);
    expect(empty.boxes.every((count) => count === 0)).toBe(true);
  });
});

describe("learning statistics for agents", () => {
  it("prints the same counts from the library's study record", () => {
    const root = fileURLToPath(new URL("../..", import.meta.url));
    const workspace = mkdtempSync(join(tmpdir(), "trace-progress-"));
    try {
      mkdirSync(join(workspace, "data", "library"), { recursive: true });
      writeFileSync(join(workspace, "data", "library", "english.trace.json"), JSON.stringify(english));
      writeFileSync(join(workspace, "data", "library", "second.trace.json"), JSON.stringify(second));
      writeFileSync(join(workspace, "data", "library", "study.json"), JSON.stringify(studyFileToJson(library())));
      const run = spawnSync(process.execPath, [join(root, "plugins/trace-paper-studio/skills/trace-paper-studio/scripts/trace-agent.mjs"), "progress"], {
        encoding: "utf8",
        env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data") },
      });
      expect(run.status).toBe(0);
      const report = JSON.parse(run.stdout) as { totals: Record<string, number>; cardsByNextReview: Array<{ inDays: number; cards: number }>; hardest: Array<{ kind: string; forgotten: number }>; papers: unknown[] };
      expect(report.totals).toMatchObject({ reviews: 6, remembered: 4, cards: 3, finished: 1, started: 1 });
      expect(report.cardsByNextReview.map((item) => item.inDays)).toEqual([1, 3, 7, 16, 35, 90]);
      expect(report.hardest).toMatchObject([{ kind: "concept", forgotten: 2 }]);
      expect(report.papers).toHaveLength(2);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
