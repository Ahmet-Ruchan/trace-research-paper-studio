import { readingDrillFor } from "./reading-drill";
import { applyReview, isDue, type StudyReview } from "./review-schedule";
import type { PrimerConcept, QuizQuestion, ResearchProject } from "./schema";
import { emptyStudyProgress, questionSignature, type StudyProgress } from "./study-path";

/**
 * Kütüphanenin tekrar kuyruğu: bütün makalelerin vadesi gelmiş kartları.
 *
 * Kart projenin içeriğinden okunuyor, ilerleme kaydından değil: kayıtta
 * yalnızca kimlik ve zamanlama var. Soru yeniden yazıldıysa (mühür tutmuyor),
 * kavram ya da proje silindiyse kart sessizce düşüyor; okuyucuya artık var
 * olmayan bir şeyi sormak anlamsız.
 *
 * Makaleler karıştırılıyor: aynı makalenin kartları arka arkaya gelseydi
 * okuyucu cevabı bir öncekinden çıkarabilirdi. Araya giren başka bir
 * makale hatırlamayı gerçekten sınıyor.
 */

type CardBase = { key: string; projectId: string; paperTitle: string; language: string; review: StudyReview };
export type ReviewCard =
  | (CardBase & { kind: "question"; question: QuizQuestion })
  | (CardBase & { kind: "concept"; concept: PrimerConcept });

export const REVIEW_SESSION_SIZE = 20;
/** Kısa molada önerilen en fazla kart: birkaç dakikalık molaya sığacak kadar. */
export const BREAK_REVIEW_SIZE = 3;

export function reviewCards(projects: readonly ResearchProject[], progress: ReadonlyMap<string, StudyProgress>): ReviewCard[] {
  const cards: ReviewCard[] = [];
  for (const project of projects) {
    const reviews = progress.get(project.id)?.reviews ?? [];
    if (!reviews.length) continue;
    const questions = new Map([...(project.quiz?.questions ?? []), ...(readingDrillFor(project)?.questions ?? [])].map((question) => [question.id, question]));
    const concepts = new Map((project.primer?.concepts ?? []).map((concept) => [concept.id, concept]));
    const base = { projectId: project.id, paperTitle: project.evidence.paper.title, language: project.language };
    for (const review of reviews) {
      const key = `${project.id}\u0000${review.id}`;
      if (review.id.startsWith("q:")) {
        const question = questions.get(review.id.slice(2));
        if (question && review.sig === questionSignature(question)) cards.push({ ...base, key, kind: "question", question, review });
      } else if (review.id.startsWith("c:")) {
        const concept = concepts.get(review.id.slice(2));
        if (concept) cards.push({ ...base, key, kind: "concept", concept, review });
      }
    }
  }
  return cards;
}

/** Vadesi gelmiş kartlar, en eskisi önce, makaleler sırayla karışık; en fazla bir oturumluk. */
export function dueCards(cards: readonly ReviewCard[], now: string, limit = REVIEW_SESSION_SIZE): ReviewCard[] {
  const byPaper = new Map<string, ReviewCard[]>();
  for (const card of [...cards].filter((item) => isDue(item.review, now)).sort((left, right) => left.review.due.localeCompare(right.review.due))) {
    byPaper.set(card.projectId, [...(byPaper.get(card.projectId) ?? []), card]);
  }
  const queues = [...byPaper.values()];
  const ordered: ReviewCard[] = [];
  while (ordered.length < limit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && ordered.length < limit) ordered.push(next);
    }
  }
  return ordered;
}

export type ReviewForecast = {
  /** Şu an vadesi gelmiş kart sayısı (oturum sınırından bağımsız). */
  due: number;
  /** Vadesi gelmiş kartların geldiği makale sayısı. */
  papers: number;
  total: number;
  /** Vadesi gelmemiş en yakın kartın zamanı. */
  nextDue?: string;
};

export function reviewForecast(cards: readonly ReviewCard[], now: string): ReviewForecast {
  const due = cards.filter((card) => isDue(card.review, now));
  const later = cards.filter((card) => !isDue(card.review, now)).map((card) => card.review.due).sort();
  return { due: due.length, papers: new Set(due.map((card) => card.projectId)).size, total: cards.length, nextDue: later[0] };
}

/** Kartın tekrar sonucunu projenin ilerleme kaydına yazar. */
export function recordReview(progress: StudyProgress | undefined, card: ReviewCard, remembered: boolean, now: string): StudyProgress {
  const base = progress ?? emptyStudyProgress(now);
  const reviews = base.reviews ?? [];
  const current = reviews.find((item) => item.id === card.review.id) ?? card.review;
  return { ...base, updatedAt: now, reviews: [...reviews.filter((item) => item.id !== current.id), applyReview(current, remembered, now)] };
}
