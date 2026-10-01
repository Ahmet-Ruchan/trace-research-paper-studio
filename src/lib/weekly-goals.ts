import type { Preferences } from "./profile";
import type { StudyProgress } from "./study-path";
import { addDaysLocal, dayKey, startOfWeek } from "./work-log";

/**
 * Haftalık öğrenme hedefi: "bu hafta 2 makale bitir, 40 kart tekrar et".
 *
 * Günlük hedef çalışılan süreyi ölçüyor; bu hedef ne öğrenildiğini. Sayılar
 * çalışma kaydından (`study.json`): haftanın içinde bitirilen makaleler
 * (`finishedAt`) ve gün gün tekrar edilen kartlar (`reviewDays`). Günler ve
 * hafta yerel saatle, haftanın ilk günü profildeki gibi.
 */

export type WeeklyGoals = Preferences["weeklyGoals"];

export type WeeklyGoalProgress = {
  /** Haftanın ilk ve son günü, "YYYY-MM-DD". */
  from: string;
  to: string;
  /** Bugün dahil haftanın kalan günleri. */
  daysLeft: number;
  papers: { goal: number; done: number; finished: Array<{ projectId: string; at: string }> };
  cards: { goal: number; done: number; remembered: number };
};

export function weeklyGoalProgress(study: ReadonlyMap<string, StudyProgress>, goals: WeeklyGoals, now: Date, weekStart: 0 | 1): WeeklyGoalProgress {
  const first = startOfWeek(now, weekStart);
  const from = dayKey(first);
  const to = dayKey(addDaysLocal(first, 6));
  const inWeek = (day: string) => day >= from && day <= to;
  const finished: WeeklyGoalProgress["papers"]["finished"] = [];
  let reviewed = 0;
  let remembered = 0;
  for (const [projectId, progress] of study) {
    if (progress.finishedAt && inWeek(dayKey(new Date(progress.finishedAt)))) finished.push({ projectId, at: progress.finishedAt });
    for (const day of progress.reviewDays ?? []) {
      if (!inWeek(day.day)) continue;
      reviewed += day.reviewed;
      remembered += day.remembered;
    }
  }
  finished.sort((left, right) => left.at.localeCompare(right.at));
  const today = dayKey(now);
  let daysLeft = 0;
  for (let day = 0; day < 7; day += 1) if (dayKey(addDaysLocal(first, day)) >= today) daysLeft += 1;
  return { from, to, daysLeft, papers: { goal: goals.papers, done: finished.length, finished }, cards: { goal: goals.cards, done: reviewed, remembered } };
}

export const hasWeeklyGoal = (goals: WeeklyGoals) => goals.papers > 0 || goals.cards > 0;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Okuyucuya tek cümle: "1 of 2 papers finished and 23 of 40 cards reviewed this week." */
export function weeklyGoalSentence(progress: WeeklyGoalProgress) {
  const parts: string[] = [];
  if (progress.papers.goal) parts.push(`${progress.papers.done} of ${plural(progress.papers.goal, "paper", "papers")} finished`);
  if (progress.cards.goal) parts.push(`${progress.cards.done} of ${plural(progress.cards.goal, "card", "cards")} reviewed`);
  if (!parts.length) return `${plural(progress.papers.done, "paper", "papers")} finished and ${plural(progress.cards.done, "card", "cards")} reviewed this week.`;
  const met = (!progress.papers.goal || progress.papers.done >= progress.papers.goal) && (!progress.cards.goal || progress.cards.done >= progress.cards.goal);
  return `${parts.join(" and ")} this week${met ? ": the weekly goal is met" : ""}.`;
}

/** Kalan kartlar günlere bölünce: "17 cards to go, about 6 a day." */
export function cardsPerDay(progress: WeeklyGoalProgress) {
  const left = Math.max(0, progress.cards.goal - progress.cards.done);
  if (!progress.cards.goal || !left || !progress.daysLeft) return undefined;
  return { left, perDay: Math.ceil(left / progress.daysLeft) };
}
