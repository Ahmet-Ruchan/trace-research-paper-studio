import type { ConceptAliases } from "./concept-links";
import { mergeReadingOrder, savedFrom, savedReason, type ReadingItem } from "./reading-list";
import { readingDrillFor } from "./reading-drill";
import { readingOrder, studyStatus } from "./reading-order";
import { dueCards, reviewCards, reviewForecast } from "./review-queue";
import type { ResearchProject } from "./schema";
import { studyPath, studySummary, type StudyProgress } from "./study-path";
import { hasWeeklyGoal, weeklyGoalProgress, weeklyGoalSentence, type WeeklyGoalProgress, type WeeklyGoals } from "./weekly-goals";
import { dailyTotals, dayKey, workSummary, type WorkLog } from "./work-log";
import { weekReport } from "./work-report";

/**
 * Günün özeti: bir ajan "bugün ne yapayım?" sorusunu tek komutla
 * cevaplasın (`trace-agent.mjs today`). Hepsi okuyucunun kendi kaydından,
 * model yok: vadesi gelen kartlar, yarım kalan makaleler, okuma sırasında
 * sıradaki çalışma, bugünün ve haftanın çalışma süresi, haftalık öğrenme
 * hedefi (`weekly-goals.ts`). `suggestions`
 * bunları önem sırasıyla, okuyucuya söylenecek cümleler olarak veriyor.
 */

export type TodayBrief = {
  day: string;
  review: { due: number; papers: Array<{ projectId: string; paper: string; due: number }>; nextDue?: string };
  continueStudying: Array<{ projectId: string; paper: string; done: number; total: number; lastStudied: string }>;
  /** `from`: okuma sırasından mı, yoksa sıraya girmeyen (bağı olmayan) başlanmamış bir makale mi. */
  readNext?: { kind: "paper"; projectId: string; paper: string; status: string; from: "reading order" | "library" } | { kind: "saved"; title: string; identifier?: string; why: string };
  work: { today: number; goal: number; week: number; lastWeekByNow: number; streak: number };
  /** Bu hafta bitirilen makaleler ve tekrar edilen kartlar, haftalık hedefle. */
  learning: WeeklyGoalProgress;
  suggestions: string[];
};

const minutes = (seconds: number) => {
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  return hours ? `${hours}h${total % 60 ? ` ${total % 60}m` : ""}` : `${total}m`;
};

export function todayBrief(input: {
  projects: readonly ResearchProject[];
  study: ReadonlyMap<string, StudyProgress>;
  readingList: readonly ReadingItem[];
  aliases?: ConceptAliases;
  log: WorkLog;
  goalMinutes: number;
  weeklyGoals?: WeeklyGoals;
  weekStart: 0 | 1;
  now: Date;
}): TodayBrief {
  const { projects, study, now } = input;
  const iso = now.toISOString();
  const byId = new Map(projects.map((project) => [project.id, project]));

  const cards = reviewCards(projects, study);
  const forecast = reviewForecast(cards, iso);
  const due = dueCards(cards, iso, Number.MAX_SAFE_INTEGER);
  const perPaper = new Map<string, number>();
  for (const card of due) perPaper.set(card.projectId, (perPaper.get(card.projectId) ?? 0) + 1);
  const review = {
    due: forecast.due,
    papers: [...perPaper].map(([projectId, count]) => ({ projectId, paper: byId.get(projectId)?.evidence.paper.title ?? projectId, due: count })).sort((left, right) => right.due - left.due),
    ...(forecast.nextDue ? { nextDue: forecast.nextDue } : {}),
  };

  const continueStudying = projects
    .flatMap((project) => {
      const progress = study.get(project.id);
      if (studyStatus(progress) !== "started") return [];
      const summary = studySummary(project, studyPath(project, readingDrillFor(project)), progress);
      return [{ projectId: project.id, paper: project.evidence.paper.title, done: summary.done, total: summary.total, lastStudied: progress!.updatedAt }];
    })
    .sort((left, right) => right.lastStudied.localeCompare(left.lastStudied))
    .slice(0, 3);

  const order = readingOrder(projects, study, input.aliases);
  const merged = mergeReadingOrder(order, input.readingList, projects);
  const first = merged.entries.find((entry) => entry.kind === "saved" || entry.step.status !== "finished");
  const saved = merged.others.find((place) => !place.owned);
  // Sıra yalnızca birbirine bağlı makalelerden; bağı olmayanlardan en yeni başlanmamış olan son seçenek.
  const unstarted = projects.filter((project) => studyStatus(study.get(project.id)) === "new").sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const readNext: TodayBrief["readNext"] = first
    ? first.kind === "paper"
      ? { kind: "paper", projectId: first.step.project.id, paper: first.step.project.evidence.paper.title, status: first.step.status, from: "reading order" }
      : { kind: "saved", title: first.place.item.title, ...(first.place.item.identifier ? { identifier: first.place.item.identifier } : {}), why: first.place.why ? savedReason(first.place.why) : "On your reading list." }
    : saved
      ? { kind: "saved", title: saved.item.title, ...(saved.item.identifier ? { identifier: saved.item.identifier } : {}), why: saved.why ? savedFrom(saved.why) : "On your reading list." }
      : unstarted
        ? { kind: "paper", projectId: unstarted.id, paper: unstarted.evidence.paper.title, status: "new", from: "library" }
        : undefined;

  const totals = dailyTotals(input.log);
  const summary = workSummary(totals, now, { weekStart: input.weekStart, goalMinutes: input.goalMinutes });
  const week = weekReport(input.log.sessions, totals, now, input.weekStart);
  const work = { today: summary.today, goal: input.goalMinutes * 60, week: summary.week, lastWeekByNow: week.lastWeek.byNow, streak: summary.currentStreak };

  const goals = input.weeklyGoals ?? { papers: 0, cards: 0 };
  const learning = weeklyGoalProgress(study, goals, now, input.weekStart);

  const suggestions: string[] = [];
  if (review.due) {
    const reviewMinutes = Math.max(1, Math.round(review.due * 0.75));
    suggestions.push(`Review ${review.due} ${review.due === 1 ? "card" : "cards"}${review.papers.length > 1 ? ` from ${review.papers.length} papers` : ` from ${review.papers[0]?.paper}`}, about ${reviewMinutes} ${reviewMinutes === 1 ? "minute" : "minutes"}.`);
  }
  const studying = continueStudying[0];
  if (studying) suggestions.push(`Continue studying ${studying.paper}: ${studying.done} of ${studying.total} steps done.`);
  if (readNext?.kind === "paper" && readNext.projectId !== studying?.projectId) suggestions.push(readNext.from === "reading order" ? `Next in your reading order: ${readNext.paper}.` : `Not started yet: ${readNext.paper}.`);
  if (readNext?.kind === "saved") suggestions.push(`Next on your reading list: ${readNext.title}. ${readNext.why}`);
  if (hasWeeklyGoal(goals)) suggestions.push(weeklyGoalSentence(learning).replace(/^./, (letter) => letter.toUpperCase()));
  if (work.today < work.goal) suggestions.push(`${minutes(work.goal - work.today)} to go for today's goal of ${minutes(work.goal)}${work.streak > 1 ? `, and a ${work.streak}-day streak to keep` : ""}.`);
  else suggestions.push(`Today's goal of ${minutes(work.goal)} is met.`);

  return { day: dayKey(now), review, continueStudying, ...(readNext ? { readNext } : {}), work, learning, suggestions };
}
