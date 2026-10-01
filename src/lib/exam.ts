import { readingDrillFor } from "./reading-drill";
import { applyReview, questionCardId, scheduleFirst } from "./review-schedule";
import type { QuizQuestion, ResearchProject } from "./schema";
import { countReviewDay } from "./review-queue";
import { dayKey } from "./work-log";
import { emptyStudyProgress, MAX_ENTRIES, questionSignature, type StudyProgress } from "./study-path";

/**
 * Sınav modu: kütüphanenin sorularından karışık, süreli bir deneme.
 *
 * Tekrar kuyruğu yalnızca vadesi gelen kartları soruyor; sınav ise bir
 * makalenin (ya da bütün kütüphanenin) bütün sorularından seçiyor: vadesi
 * gelmemiş, hatta hiç çalışılmamış sorular da. Sınav sırasında doğru yanıt
 * gösterilmiyor; sonuç sonda, her sorunun açıklaması ve sayfasıyla. Tekrar
 * takvimine kendiliğinden dokunmuyor; okuyucu isterse kaçırdıkları ertesi
 * gün tekrara giriyor (`missedToReview`).
 */

export type ExamQuestion = { key: string; projectId: string; paperTitle: string; language: string; question: QuizQuestion };
export type ExamAnswer = readonly number[];

export const EXAM_SIZES = [10, 20, 30] as const;
export const EXAM_MINUTES = [0, 10, 20, 30] as const;

/** Bütün sorular: quiz ve kanıttan üretilen okuma alıştırması; aynı soru bir kez. */
export function examPool(projects: readonly ResearchProject[]): ExamQuestion[] {
  return projects.flatMap((project) => {
    const seen = new Set<string>();
    return [...(project.quiz?.questions ?? []), ...(readingDrillFor(project)?.questions ?? [])].flatMap((question) => {
      if (seen.has(question.id)) return [];
      seen.add(question.id);
      return [{ key: `${project.id}\u0000${question.id}`, projectId: project.id, paperTitle: project.evidence.paper.title, language: project.language, question }];
    });
  });
}

/** Tohumlu karıştırma: aynı tohum aynı sınav (testler için), yoksa her seferinde başka. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], next: () => number) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/**
 * Sınavın soruları: makaleler sırayla karışık (bir makalenin soruları arka
 * arkaya gelmesin, bir yanıt ötekini ele vermesin), her makaleden eşit pay.
 */
export function buildExam(pool: readonly ExamQuestion[], size: number, seed: number): ExamQuestion[] {
  const next = random(seed);
  const byPaper = new Map<string, ExamQuestion[]>();
  for (const item of shuffle(pool, next)) byPaper.set(item.projectId, [...(byPaper.get(item.projectId) ?? []), item]);
  const queues = shuffle([...byPaper.values()], next);
  const exam: ExamQuestion[] = [];
  while (exam.length < size && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const item = queue.shift();
      if (item && exam.length < size) exam.push(item);
    }
  }
  return exam;
}

const correctSet = (question: QuizQuestion) => question.options.flatMap((option, index) => (option.correct ? [index] : []));

export function isRight(question: QuizQuestion, answer: ExamAnswer | undefined) {
  if (!answer?.length) return false;
  const right = correctSet(question);
  return right.length === answer.length && right.every((index) => answer.includes(index));
}

export type ExamResult = {
  total: number;
  correct: number;
  unanswered: number;
  byPaper: Array<{ projectId: string; paper: string; correct: number; total: number }>;
  items: Array<{ item: ExamQuestion; answer: number[]; right: boolean; correct: number[] }>;
};

export function gradeExam(exam: readonly ExamQuestion[], answers: ReadonlyMap<string, ExamAnswer>): ExamResult {
  const items = exam.map((item) => {
    const answer = [...(answers.get(item.key) ?? [])].sort((left, right) => left - right);
    return { item, answer, right: isRight(item.question, answer), correct: correctSet(item.question) };
  });
  const papers = new Map<string, { projectId: string; paper: string; correct: number; total: number }>();
  for (const { item, right } of items) {
    const entry = papers.get(item.projectId) ?? { projectId: item.projectId, paper: item.paperTitle, correct: 0, total: 0 };
    entry.total += 1;
    if (right) entry.correct += 1;
    papers.set(item.projectId, entry);
  }
  return {
    total: items.length,
    correct: items.filter((entry) => entry.right).length,
    unanswered: items.filter((entry) => !entry.answer.length).length,
    byPaper: [...papers.values()].sort((left, right) => left.correct / left.total - right.correct / right.total || left.paper.localeCompare(right.paper)),
    items,
  };
}

/**
 * Kaçırılan bir soru ertesi gün tekrarda: kartı varsa "hatırlanmadı" olarak
 * (ilk kutuya), yoksa ilk kutudan yeni bir kart olarak. Günün tekrar
 * sayısına giriyor, çünkü sınavda gerçekten soruldu.
 */
export function missedToReview(progress: StudyProgress | undefined, question: QuizQuestion, now: string): StudyProgress {
  const base = progress ?? emptyStudyProgress(now);
  const id = questionCardId(question.id);
  const sig = questionSignature(question);
  const reviews = base.reviews ?? [];
  const existing = reviews.find((item) => item.id === id && item.sig === sig);
  const card = existing ? applyReview(existing, false, now) : scheduleFirst(id, 0, now, sig);
  return {
    ...base,
    updatedAt: now,
    reviews: [...reviews.filter((item) => item.id !== id), card].slice(-MAX_ENTRIES),
    reviewDays: countReviewDay(base.reviewDays ?? [], dayKey(new Date(now)), false),
  };
}
