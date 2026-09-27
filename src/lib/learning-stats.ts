import { readingDrillFor } from "./reading-drill";
import { reviewCards, type ReviewCard } from "./review-queue";
import { addDays, isDue, MAX_REVIEW_BOX, REVIEW_INTERVALS_DAYS } from "./review-schedule";
import { studyStatus, type StudyStatus } from "./reading-order";
import type { ResearchProject } from "./schema";
import { studyPath, studySummary, type StudyProgress } from "./study-path";

/**
 * Öğrenme istatistikleri: kütüphanedeki çalışmanın dökümü.
 *
 * Hepsi sayım, tahmin yok: çalışma kaydında (`study.json`) ne varsa o. Tekrar
 * kartında her tekrar ve her unutuş sayılıyor, dolayısıyla "hatırlanan"
 * tekrarlar = tekrarlar − unutuşlar tam bir sayı. Oranlar hep sayılarıyla
 * birlikte veriliyor: üç tekrardan bir oran, üç yüz tekrardan bir oran değil.
 *
 * Kartlar projenin bugünkü içeriğinden okunuyor (`review-queue.ts`): yeniden
 * yazılan soru ya da silinen makale sayılmıyor.
 */

/** Bu kutudan itibaren kart "uzun süreli": bir sonraki tekrarı iki haftadan sonra. */
export const LONG_TERM_BOX = REVIEW_INTERVALS_DAYS.findIndex((days) => days >= 14);

export type PaperStats = {
  project: ResearchProject;
  status: StudyStatus;
  steps: { done: number; total: number };
  checks: { answered: number; firstTry: number };
  cards: { total: number; due: number; longTerm: number };
  recalls: { reviews: number; remembered: number };
  explanations: { sections: number; again: number };
  lastStudied: string;
};

export type ExplanationGain = { sections: number; before: number; after: number; total: number };

export type LearningStats = {
  papers: PaperStats[];
  totals: {
    finished: number;
    started: number;
    cards: number;
    due: number;
    longTerm: number;
    reviews: number;
    remembered: number;
    answered: number;
    firstTry: number;
  };
  /** Kutulara göre kart sayısı (0 → yarın, son kutu → 90 gün). */
  boxes: number[];
  /** Önümüzdeki yedi gün: bugün (vadesi geçmişler dahil) ve sonraki altı gün. */
  week: Array<{ day: string; due: number }>;
  /** En çok unutulan kartlar. */
  hardest: ReviewCard[];
  /** Birden çok kez anlatılan bölümler: ilk ve son anlatışta aktarılan iddialar. */
  explanationGain: ExplanationGain;
};

const HARDEST = 8;

const startOfDay = (iso: string) => `${iso.slice(0, 10)}T00:00:00.000Z`;

export function learningStats(projects: readonly ResearchProject[], study: ReadonlyMap<string, StudyProgress>, now: string): LearningStats {
  const cards = reviewCards(projects, study);
  const papers: PaperStats[] = [];
  const gain: ExplanationGain = { sections: 0, before: 0, after: 0, total: 0 };
  for (const project of projects) {
    const progress = study.get(project.id);
    if (!progress) continue;
    const path = studyPath(project, readingDrillFor(project));
    const summary = studySummary(project, path, progress);
    const own = cards.filter((card) => card.projectId === project.id);
    const bySection = new Map<string, NonNullable<StudyProgress["explanations"]>>();
    for (const item of progress.explanations ?? []) bySection.set(item.target, [...(bySection.get(item.target) ?? []), item]);
    const again = [...bySection.values()].filter((items) => items.length > 1);
    for (const items of again) {
      const ordered = [...items].sort((left, right) => left.at.localeCompare(right.at));
      gain.sections += 1;
      gain.before += ordered[0].covered.length;
      gain.after += ordered.at(-1)!.covered.length;
      gain.total += ordered.at(-1)!.total;
    }
    papers.push({
      project,
      status: studyStatus(progress),
      steps: { done: summary.done, total: summary.total },
      checks: { answered: summary.checks.answered, firstTry: summary.checks.firstTry },
      cards: {
        total: own.length,
        due: own.filter((card) => isDue(card.review, now)).length,
        longTerm: own.filter((card) => card.review.box >= LONG_TERM_BOX).length,
      },
      recalls: {
        reviews: own.reduce((sum, card) => sum + card.review.reviews, 0),
        remembered: own.reduce((sum, card) => sum + card.review.reviews - card.review.lapses, 0),
      },
      explanations: { sections: bySection.size, again: again.length },
      lastStudied: [progress.updatedAt, ...(progress.reviews ?? []).map((review) => review.last ?? "")].sort().at(-1)!,
    });
  }
  papers.sort((left, right) => right.lastStudied.localeCompare(left.lastStudied));

  const sum = (pick: (paper: PaperStats) => number) => papers.reduce((total, paper) => total + pick(paper), 0);
  const boxes = Array.from({ length: MAX_REVIEW_BOX + 1 }, (_, box) => cards.filter((card) => card.review.box === box).length);
  const today = startOfDay(now);
  const week = Array.from({ length: 7 }, (_, offset) => {
    const start = addDays(today, offset);
    const end = addDays(today, offset + 1);
    return {
      day: start.slice(0, 10),
      due: cards.filter((card) => (offset === 0 ? card.review.due < end : card.review.due >= start && card.review.due < end)).length,
    };
  });
  const hardest = cards
    .filter((card) => card.review.lapses > 0)
    .sort((left, right) => right.review.lapses - left.review.lapses || right.review.reviews - left.review.reviews || left.key.localeCompare(right.key))
    .slice(0, HARDEST);

  return {
    papers,
    totals: {
      finished: papers.filter((paper) => paper.status === "finished").length,
      started: papers.filter((paper) => paper.status === "started").length,
      cards: cards.length,
      due: cards.filter((card) => isDue(card.review, now)).length,
      longTerm: cards.filter((card) => card.review.box >= LONG_TERM_BOX).length,
      reviews: sum((paper) => paper.recalls.reviews),
      remembered: sum((paper) => paper.recalls.remembered),
      answered: sum((paper) => paper.checks.answered),
      firstTry: sum((paper) => paper.checks.firstTry),
    },
    boxes,
    week,
    hardest,
    explanationGain: gain,
  };
}
