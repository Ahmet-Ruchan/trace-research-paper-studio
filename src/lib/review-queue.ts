import { readingDrillFor } from "./reading-drill";
import { applyReview, isDue, type Cloze, type StudyReview } from "./review-schedule";
import type { PrimerConcept, QuizQuestion, ResearchProject } from "./schema";
import { emptyStudyProgress, MAX_REVIEW_DAYS, questionSignature, type ReviewDay, type StudyProgress } from "./study-path";
import { dayKey } from "./work-log";

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
  | (CardBase & { kind: "concept"; concept: PrimerConcept })
  | (CardBase & { kind: "highlight"; cloze: Cloze });

/** Kartın türü ve okuyucuya tek satırlık hâli: istatistiklerde ve ajan çıktısında. */
export const CARD_KIND_LABELS: Record<ReviewCard["kind"], string> = { question: "Question", concept: "Concept", highlight: "Highlight" };

export function cardText(card: ReviewCard) {
  if (card.kind === "question") return card.question.prompt;
  if (card.kind === "concept") return card.concept.term;
  const { text, at, answer } = card.cloze;
  return `${text.slice(0, at)}_____${text.slice(at + answer.length)}`;
}

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
      } else if (review.id.startsWith("h:") && review.cloze) {
        cards.push({ ...base, key, kind: "highlight", cloze: review.cloze, review });
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
  return {
    ...base,
    updatedAt: now,
    reviews: [...reviews.filter((item) => item.id !== current.id), applyReview(current, remembered, now)],
    reviewDays: countReviewDay(base.reviewDays ?? [], dayKey(new Date(now)), remembered),
  };
}

/** Günün tekrar sayısına bir kart ekler; en eski günler sınırın dışında kalıyor. */
export function countReviewDay(days: readonly ReviewDay[], day: string, remembered: boolean): ReviewDay[] {
  const today = days.find((item) => item.day === day) ?? { day, reviewed: 0, remembered: 0 };
  const counted = { day, reviewed: today.reviewed + 1, remembered: today.remembered + (remembered ? 1 : 0) };
  return [...days.filter((item) => item.day !== day), counted].sort((left, right) => left.day.localeCompare(right.day)).slice(-MAX_REVIEW_DAYS);
}
