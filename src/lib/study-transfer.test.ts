import { describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { completeStep, recordAnswer, type StudyExplanation, type StudyProgress } from "./study-path";
import { mergeStudyProgress, readStudyTransfer, studyTransferFile, studyTransferFileName } from "./study-transfer";

const english = loadExampleProject("attention-is-all-you-need.en.trace.json");
const [q1, q2] = english.quiz!.questions;
const T = (day: number) => `2026-09-${String(day).padStart(2, "0")}T10:00:00.000Z`;
const explanation = (target: string, day: number): StudyExplanation => ({ target, at: T(day), text: `On day ${day}`, model: "m", covered: [], missed: [], misstated: 0, unsupported: 0, total: 1, sig: "s" });

describe("carrying study progress between devices", () => {
  it("writes a file for this paper and reads it back only for the same paper", () => {
    const progress = completeStep(undefined, "start", "concept:softmax", T(1));
    const file = JSON.parse(JSON.stringify(studyTransferFile(english, progress, T(2))));
    expect(readStudyTransfer(file, english)).toEqual({ ok: true, progress });
    expect(readStudyTransfer(file, { id: "another" })).toEqual({ ok: false, reason: "other-paper", paperTitle: english.evidence.paper.title });
    expect(readStudyTransfer({ ...file, kind: "something-else" }, english)).toEqual({ ok: false, reason: "invalid" });
    expect(readStudyTransfer({ ...file, progress: { version: 1 } }, english)).toEqual({ ok: false, reason: "invalid" });
    expect(studyTransferFileName(english)).toBe("attention-is-all-you-need.trace-progress.json");
  });

  it("merges instead of overwriting: every step done on either device, the latest answer, the most reviewed card", () => {
    // Telefonda: başlangıç ve soru 1 yanlış; dizüstünde: bir kavram, soru 1 sonra doğru, soru 2.
    let phone: StudyProgress = completeStep(undefined, "start", "x", T(1));
    phone = recordAnswer(phone, q1, { correct: false, attempts: 2, revealed: true }, T(1));
    phone = { ...phone, explanations: [explanation("story:a", 1)] };
    let laptop: StudyProgress = completeStep(undefined, "concept:softmax", "y", T(3));
    laptop = recordAnswer(laptop, q1, { correct: true, attempts: 1, revealed: false }, T(4));
    laptop = recordAnswer(laptop, q2, { correct: true, attempts: 1, revealed: false }, T(4));
    laptop = { ...laptop, reviews: laptop.reviews!.map((review) => (review.id === `q:${q1.id}` ? { ...review, reviews: 3, box: 3, last: T(5) } : review)), explanations: [explanation("story:a", 5)] };

    const merged = mergeStudyProgress(phone, laptop, T(9));
    expect(merged.done).toEqual(["start", "concept:softmax"]);
    expect(merged.answers.find((answer) => answer.id === q1.id)).toMatchObject({ correct: true, attempts: 1 });
    expect(merged.answers).toHaveLength(2);
    expect(merged.reviews!.find((review) => review.id === `q:${q1.id}`)).toMatchObject({ reviews: 3, box: 3 });
    expect(merged.explanations!.map((item) => item.text)).toEqual(["On day 1", "On day 5"]);
    expect(merged.startedAt).toBe(T(1));
    expect(merged.current).toBe(laptop.current);
    expect(merged.updatedAt).toBe(T(9));
    // Aynı dosyayı iki kez yüklemek bir şey eklemiyor.
    const twice = mergeStudyProgress(merged, laptop, T(10));
    expect({ ...twice, updatedAt: merged.updatedAt }).toEqual(merged);
    expect(mergeStudyProgress(undefined, laptop, T(9))).toEqual({ ...laptop, updatedAt: T(9) });
  });

  it("keeps the explanation limits and the earliest finish", () => {
    const many = (offset: number) => Array.from({ length: 4 }, (_, index) => explanation("story:a", offset + index));
    const left: StudyProgress = { ...completeStep(undefined, "start", "x", T(1)), explanations: many(1), finishedAt: T(8) };
    const right: StudyProgress = { ...completeStep(undefined, "start", "x", T(2)), explanations: many(10), finishedAt: T(6) };
    const merged = mergeStudyProgress(left, right, T(20));
    expect(merged.explanations!.map((item) => item.at)).toEqual([T(4), T(10), T(11), T(12), T(13)]);
    expect(merged.finishedAt).toBe(T(6));
  });
});
