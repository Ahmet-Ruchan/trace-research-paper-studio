import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { readingDrillFor } from "./reading-drill";
import { dueCards, recordReview, reviewCards, reviewForecast } from "./review-queue";
import { REVIEW_INTERVALS_DAYS, addDays, applyReview, describeDue, scheduleFirst } from "./review-schedule";
import { completeStep, recordAnswer, type StudyProgress } from "./study-path";

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const T0 = "2026-09-01T09:00:00.000Z";
const question = example.quiz!.questions[0];
const concept = example.primer!.concepts[0];
const right = { correct: true, attempts: 1, revealed: false };
const wrong = { correct: false, attempts: 1, revealed: true };

describe("review schedule", () => {
  it("moves a remembered card to a longer interval and a missed one back to tomorrow", () => {
    let card = scheduleFirst("q:x", 0, T0);
    expect(card.due).toBe(addDays(T0, 1));
    for (const days of REVIEW_INTERVALS_DAYS.slice(1)) {
      card = applyReview(card, true, T0);
      expect(card.due).toBe(addDays(T0, days));
    }
    // En uzun aralıkta kalıyor.
    expect(applyReview(card, true, T0).due).toBe(addDays(T0, REVIEW_INTERVALS_DAYS.at(-1)!));
    const missed = applyReview(card, false, T0);
    expect(missed).toMatchObject({ box: 0, due: addDays(T0, 1), lapses: 1, last: T0 });
    expect(missed.reviews).toBe(card.reviews + 1);
  });

  it("says when a card comes back in words", () => {
    expect(describeDue(addDays(T0, 1), T0)).toBe("tomorrow");
    expect(describeDue(addDays(T0, 7), T0)).toBe("in 7 days");
    expect(describeDue(T0, T0)).toBe("now");
    // Birkaç dakika önce açılmış bir ekran "3 gün"ü "4 gün" demiyor; birkaç saat kalan kart "yarın".
    expect(describeDue(addDays(T0, 3), addDays(T0, -0.01))).toBe("in 3 days");
    expect(describeDue(addDays(T0, 0.2), T0)).toBe("tomorrow");
  });
});

describe("cards from studying", () => {
  it("turns a read concept into a card for tomorrow", () => {
    const progress = completeStep(undefined, `concept:${concept.id}`, "next", T0);
    expect(progress.reviews).toEqual([expect.objectContaining({ id: `c:${concept.id}`, box: 0, due: addDays(T0, 1) })]);
    // Adımı yeniden bitirmek kartın geçmişini silmiyor.
    const reviewed = recordReview(progress, reviewCards([example], new Map([[example.id, progress]]))[0], true, T0);
    expect(completeStep(reviewed, `concept:${concept.id}`, "next", T0).reviews![0].box).toBe(1);
  });

  it("starts a question known on the first try further out than a missed one", () => {
    expect(recordAnswer(undefined, question, right, T0).reviews![0]).toMatchObject({ id: `q:${question.id}`, box: 1, due: addDays(T0, 3) });
    expect(recordAnswer(undefined, question, wrong, T0).reviews![0]).toMatchObject({ box: 0, due: addDays(T0, 1) });
    // Yeniden yanıtlamak zamanlamayı değiştirmiyor; yeniden yazılmış soru baştan başlıyor.
    const again = recordAnswer(recordAnswer(undefined, question, right, T0), question, wrong, T0);
    expect(again.reviews![0].box).toBe(1);
    const rewritten = { ...question, prompt: `${question.prompt} (rewritten)` };
    expect(recordAnswer(again, rewritten, wrong, T0).reviews!.find((item) => item.id === `q:${question.id}`)!.box).toBe(0);
  });
});

describe("the review queue", () => {
  const other = { ...example, id: "other-paper", evidence: { ...example.evidence, paper: { ...example.evidence.paper, title: "Another paper" } } };
  const drillQuestion = readingDrillFor(example)!.questions[0];
  let first: StudyProgress = recordAnswer(undefined, question, wrong, T0);
  first = recordAnswer(first, example.quiz!.questions[1], wrong, T0);
  first = recordAnswer(first, drillQuestion, right, T0);
  first = completeStep(first, `concept:${concept.id}`, "x", T0);
  const second = completeStep(recordAnswer(undefined, question, wrong, T0), `concept:${concept.id}`, "x", T0);
  const progress = new Map([[example.id, first], [other.id, second]]);
  const tomorrow = addDays(T0, 1);

  it("builds cards from the project's content, dropping what no longer exists", () => {
    const cards = reviewCards([example, other], progress);
    expect(cards.filter((card) => card.projectId === example.id).map((card) => card.review.id).sort()).toEqual(
      [`c:${concept.id}`, `q:${drillQuestion.id}`, `q:${question.id}`, `q:${example.quiz!.questions[1].id}`].sort(),
    );
    const card = cards.find((item) => item.kind === "question" && item.question.id === question.id)!;
    expect(card).toMatchObject({ paperTitle: example.evidence.paper.title, language: example.language });

    const changed = { ...example, quiz: { ...example.quiz!, questions: example.quiz!.questions.map((item, index) => (index === 0 ? { ...item, prompt: "Changed?" } : item)) }, primer: undefined };
    const left = reviewCards([changed], progress).map((item) => item.review.id);
    expect(left).not.toContain(`q:${question.id}`);
    expect(left).not.toContain(`c:${concept.id}`);
    // Kütüphanede olmayan projenin kartı yok.
    expect(reviewCards([example], progress).every((item) => item.projectId === example.id)).toBe(true);
  });

  it("serves due cards oldest first and alternates between papers", () => {
    const cards = reviewCards([example, other], progress);
    expect(dueCards(cards, T0)).toEqual([]);
    const due = dueCards(cards, tomorrow);
    // İlk denemede bilinen alıştırma sorusu üç gün sonra; yarın vadesi gelenler geri kalanlar.
    expect(due.map((card) => card.review.id)).not.toContain(`q:${drillQuestion.id}`);
    expect(due).toHaveLength(5);
    expect(due.slice(0, 4).map((card) => card.projectId)).toEqual([example.id, other.id, example.id, other.id]);
    expect(dueCards(cards, tomorrow, 2)).toHaveLength(2);
  });

  it("forecasts what is due and when the next card comes", () => {
    const cards = reviewCards([example, other], progress);
    expect(reviewForecast(cards, T0)).toEqual({ due: 0, papers: 0, total: 6, nextDue: tomorrow });
    expect(reviewForecast(cards, tomorrow)).toEqual({ due: 5, papers: 2, total: 6, nextDue: addDays(T0, 3) });
  });

  it("writes a review back into the paper's progress", () => {
    const [card] = dueCards(reviewCards([example], progress), tomorrow);
    const next = recordReview(first, card, true, tomorrow);
    const updated = next.reviews!.find((item) => item.id === card.review.id)!;
    expect(updated).toMatchObject({ box: 1, due: addDays(tomorrow, 3), reviews: 1, last: tomorrow });
    expect(next.reviews).toHaveLength(first.reviews!.length);
    expect(dueCards(reviewCards([example], new Map([[example.id, next]])), tomorrow).map((item) => item.key)).not.toContain(card.key);
  });
});
