import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { LONG_TERM_BOX, learningStats, localDays } from "./learning-stats";
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
    expect(stats.week.map((day) => day.day)).toEqual(localDays(now).map((day) => day.day));
    // Bugün vadesi geçmişler de sayılıyor; hafta toplamı kartlardan fazla olamaz.
    expect(stats.week.reduce((total, day) => total + day.due, 0)).toBeLessThanOrEqual(stats.totals.cards);
    expect(stats.week[0].due).toBeGreaterThanOrEqual(stats.totals.due);
  });

  it("counts days on the reader's own clock, not in UTC", () => {
    const zone = process.env.TZ;
    try {
      // Auckland'da 2026-09-27 yaz saatine geçilen gün: 23 saat.
      process.env.TZ = "Pacific/Auckland";
      const late = "2026-09-26T13:00:00.000Z"; // Auckland'da 27 Eylül, 01:00
      const days = localDays(late, 2);
      expect(days.map((day) => day.day)).toEqual(["2026-09-27", "2026-09-28"]);
      expect(days[0]).toMatchObject({ start: "2026-09-26T12:00:00.000Z", end: "2026-09-27T11:00:00.000Z" });
      // Los Angeles'ta akşam beşte UTC günü bitiyor ama okuyucunun günü sürüyor.
      process.env.TZ = "America/Los_Angeles";
      const evening = "2026-10-02T00:30:00.000Z"; // Los Angeles'ta 1 Ekim, 17:30
      expect(localDays(evening, 1)[0]).toMatchObject({ day: "2026-10-01", start: "2026-10-01T07:00:00.000Z", end: "2026-10-02T07:00:00.000Z" });
      // Aynı gece geç saatte vadesi gelen kart "bugün"de, UTC'ye göre yarında olurdu.
      let progress: StudyProgress | undefined = recordAnswer(undefined, q1, { correct: false, attempts: 2, revealed: true }, "2026-09-30T06:00:00.000Z");
      progress = { ...progress, reviews: progress.reviews!.map((review) => ({ ...review, due: "2026-10-02T05:00:00.000Z" })) };
      const week = learningStats([english], new Map([[english.id, progress]]), evening).week;
      expect(week[0]).toMatchObject({ day: "2026-10-01", due: 1 });
      expect(week[1].due).toBe(0);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
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
        env: { ...process.env, TRACE_DATA_DIR: join(workspace, "data"), TZ: "America/Los_Angeles" },
      });
      expect(run.status).toBe(0);
      const report = JSON.parse(run.stdout) as {
        totals: Record<string, number>;
        cardsByNextReview: Array<{ inDays: number; cards: number }>;
        hardest: Array<{ kind: string; forgotten: number }>;
        papers: unknown[];
        timeZone: string;
        week: Array<{ day: string; due: number }>;
      };
      // Günler makinenin saatine göre; ajan hangi saat dilimi olduğunu görüyor.
      expect(report.timeZone).toBe("America/Los_Angeles");
      expect(report.week).toHaveLength(7);
      expect(report.totals).toMatchObject({ reviews: 6, remembered: 4, cards: 3, finished: 1, started: 1 });
      expect(report.cardsByNextReview.map((item) => item.inDays)).toEqual([1, 3, 7, 16, 35, 90]);
      expect(report.hardest).toMatchObject([{ kind: "concept", forgotten: 2 }]);
      expect(report.papers).toHaveLength(2);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
