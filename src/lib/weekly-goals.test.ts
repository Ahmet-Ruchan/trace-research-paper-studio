import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadExampleProject } from "./example-fixture";
import { emptyProfile, profileSchema } from "./profile";
import { countReviewDay, recordReview, reviewCards } from "./review-queue";
import { completeStep, emptyStudyProgress, MAX_REVIEW_DAYS, startOverProgress, studyProgressSchema, visitStep, type StudyProgress } from "./study-path";
import { mergeStudyProgress } from "./study-transfer";
import { cardsPerDay, hasWeeklyGoal, weeklyGoalProgress, weeklyGoalSentence } from "./weekly-goals";

/** Günler yerel: testler sabit bir saat diliminde koşuyor. */
let zone: string | undefined;
beforeEach(() => {
  zone = process.env.TZ;
  process.env.TZ = "Europe/Istanbul";
});
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

const example = loadExampleProject("attention-is-all-you-need.en.trace.json");
const concept = example.primer!.concepts[0];
/** İstanbul saatiyle bir an. */
const at = (day: string, time = "10:00") => new Date(`${day}T${time}:00+03:00`).toISOString();
const learned = () => completeStep(undefined, `concept:${concept.id}`, "next", at("2026-09-20"));
const card = (progress: StudyProgress) => reviewCards([example], new Map([[example.id, progress]]))[0];

describe("reviews day by day", () => {
  it("counts each review on the reader's own day, remembered or not", () => {
    let progress = learned();
    progress = recordReview(progress, card(progress), true, at("2026-09-28", "23:30"));
    progress = recordReview(progress, card(progress), false, at("2026-09-29", "00:30")); // İstanbul'da ertesi gün
    progress = recordReview(progress, card(progress), true, at("2026-09-29", "09:00"));
    expect(progress.reviewDays).toEqual([
      { day: "2026-09-28", reviewed: 1, remembered: 1 },
      { day: "2026-09-29", reviewed: 2, remembered: 1 },
    ]);
    // Kartın kendisi yalnızca son tekrarını biliyor; günler hepsini.
    expect(progress.reviews![0].reviews).toBe(3);
    expect(studyProgressSchema.parse(progress).reviewDays).toHaveLength(2);
  });

  it("keeps the newest days only", () => {
    let days = countReviewDay([], "2025-01-01", true);
    for (let index = 0; index < MAX_REVIEW_DAYS + 5; index += 1) days = countReviewDay(days, new Date(Date.UTC(2025, 0, 2 + index)).toISOString().slice(0, 10), false);
    expect(days).toHaveLength(MAX_REVIEW_DAYS);
    expect(days[0].day > "2025-01-01").toBe(true);
  });

  it("keeps the days reviewed when the reader starts the path over", () => {
    const progress = recordReview(learned(), card(learned()), true, at("2026-09-28"));
    const fresh = startOverProgress(progress, at("2026-09-29"))!;
    expect(fresh).toMatchObject({ done: [], answers: [], reviewDays: progress.reviewDays, reviews: progress.reviews });
    expect(startOverProgress(emptyStudyProgress(at("2026-09-28")), at("2026-09-29"))).toBeUndefined();
  });

  it("merges two devices' days without counting the same file twice", () => {
    const phone: StudyProgress = { ...emptyStudyProgress(at("2026-09-20")), reviewDays: [{ day: "2026-09-28", reviewed: 4, remembered: 3 }, { day: "2026-09-29", reviewed: 1, remembered: 1 }] };
    const laptop: StudyProgress = { ...emptyStudyProgress(at("2026-09-20")), reviewDays: [{ day: "2026-09-29", reviewed: 6, remembered: 2 }] };
    const merged = mergeStudyProgress(phone, laptop, at("2026-09-30"));
    expect(merged.reviewDays).toEqual([{ day: "2026-09-28", reviewed: 4, remembered: 3 }, { day: "2026-09-29", reviewed: 6, remembered: 2 }]);
    expect(mergeStudyProgress(merged, laptop, at("2026-09-30")).reviewDays).toEqual(merged.reviewDays);
  });
});

describe("the weekly learning goal", () => {
  it("is off until the reader sets one, and older profiles read without it", () => {
    const profile = emptyProfile(at("2026-09-01"));
    expect(profile.preferences.weeklyGoals).toEqual({ papers: 0, cards: 0 });
    expect(hasWeeklyGoal(profile.preferences.weeklyGoals)).toBe(false);
    const older: Record<string, unknown> = { ...profile.preferences };
    delete older.weeklyGoals;
    expect(profileSchema.parse({ ...profile, preferences: older }).preferences.weeklyGoals).toEqual({ papers: 0, cards: 0 });
    expect(profileSchema.safeParse({ ...profile, preferences: { ...profile.preferences, weeklyGoals: { papers: -1, cards: 0 } } }).success).toBe(false);
  });

  it("counts the papers finished and the cards reviewed this week, in the reader's week", () => {
    const finishedThisWeek = { ...visitStep(learned(), "finish", at("2026-09-28", "08:00")), reviewDays: [{ day: "2026-09-27", reviewed: 9, remembered: 9 }, { day: "2026-09-28", reviewed: 12, remembered: 10 }, { day: "2026-09-30", reviewed: 11, remembered: 7 }] };
    const finishedLastWeek = { ...visitStep(learned(), "finish", at("2026-09-27", "22:00")), reviewDays: [{ day: "2026-09-29", reviewed: 3, remembered: 3 }] };
    const study = new Map([["a", finishedThisWeek], ["b", finishedLastWeek], ["c", learned()]]);
    const now = new Date(at("2026-09-30", "15:00")); // çarşamba

    const monday = weeklyGoalProgress(study, { papers: 2, cards: 40 }, now, 1);
    expect(monday).toMatchObject({ from: "2026-09-28", to: "2026-10-04", daysLeft: 5 });
    expect(monday.papers).toEqual({ goal: 2, done: 1, finished: [{ projectId: "a", at: at("2026-09-28", "08:00") }] });
    expect(monday.cards).toEqual({ goal: 40, done: 26, remembered: 20 });
    expect(weeklyGoalSentence(monday)).toBe("1 of 2 papers finished and 26 of 40 cards reviewed this week.");
    expect(cardsPerDay(monday)).toEqual({ left: 14, perDay: 3 });

    // Pazar başlayan hafta pazarı da sayıyor.
    const sunday = weeklyGoalProgress(study, { papers: 1, cards: 0 }, now, 0);
    expect(sunday).toMatchObject({ from: "2026-09-27", to: "2026-10-03", daysLeft: 4 });
    expect(sunday.papers.done).toBe(2);
    expect(sunday.cards.done).toBe(35);
    expect(weeklyGoalSentence(sunday)).toBe("2 of 1 paper finished this week: the weekly goal is met.");
    expect(cardsPerDay(sunday)).toBeUndefined();

    // Hedef yoksa yalnızca sayılar.
    expect(weeklyGoalSentence(weeklyGoalProgress(study, { papers: 0, cards: 0 }, now, 1))).toBe("1 paper finished and 26 cards reviewed this week.");
  });
});
